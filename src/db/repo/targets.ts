import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  ActivityState,
  TagCategory,
  Target,
  TargetInfo,
  TargetSummary,
  TargetWithDetails,
} from '../types';
import { calculatePotentialScore } from '@/logic/potentialScore';
import { VALUE_TIERS, yieldTierFor } from '@/logic/valueScale';
import type { ValueTier } from '@/logic/valueScale';
import { yieldTrend } from '@/logic/trend';
import type { TrendDirection } from '@/logic/trend';
import { recommendAction } from '@/logic/recommendation';
import { getCryptoTotals, insertCryptoEvent, listCryptoHistory, listLogs } from './logs';
import {
  addTagToTarget,
  ensureTag,
  listInstalledSoftware,
  listIps,
  listTagsForTarget,
  listTagsForTargets,
  listWallets,
  removeTagFromTarget,
} from './intel';
import { listReviewsForTarget } from './reviews';
import { getUserProfile } from './settings';
import type { UserProfile } from './settings';
import { groupBy, placeholders } from './shared';

interface TargetRow {
  id: number;
  name: string;
  device: string | null;
  date_added: number;
  attack_count: number;
}

const mapTarget = (r: TargetRow): Target => ({
  id: r.id,
  name: r.name,
  device: r.device,
  dateAdded: r.date_added,
  attackCount: r.attack_count,
});

interface InfoRow {
  target_id: number;
  level: number;
  crypto: number;
  activity: string;
  potential_score: number;
  notes: string;
  last_updated: number;
}

const mapInfo = (r: InfoRow): TargetInfo => ({
  targetId: r.target_id,
  level: r.level,
  crypto: r.crypto,
  activity: r.activity as ActivityState,
  potentialScore: r.potential_score,
  notes: r.notes,
  lastUpdated: r.last_updated,
});

export async function getTarget(db: SQLiteDatabase, id: number): Promise<Target | null> {
  const row = await db.getFirstAsync<TargetRow>('SELECT * FROM targets WHERE id = ?;', [id]);
  return row ? mapTarget(row) : null;
}

export async function findTargetByName(db: SQLiteDatabase, name: string): Promise<Target | null> {
  const row = await db.getFirstAsync<TargetRow>(
    'SELECT * FROM targets WHERE name = ? COLLATE NOCASE;',
    [name.trim()],
  );
  return row ? mapTarget(row) : null;
}

export async function getTargetWithDetails(
  db: SQLiteDatabase,
  id: number,
): Promise<TargetWithDetails | null> {
  const target = await getTarget(db, id);
  if (!target) return null;

  const infoRow = await db.getFirstAsync<InfoRow>(
    'SELECT * FROM target_info WHERE target_id = ?;',
    [id],
  );
  if (!infoRow) return null;

  const [totals, tags, ips, wallets, logs, cryptoHistory, software, reviews] = await Promise.all([
    getCryptoTotals(db, id),
    listTagsForTarget(db, id),
    listIps(db, id),
    listWallets(db, id),
    listLogs(db, id),
    listCryptoHistory(db, id),
    listInstalledSoftware(db, id),
    listReviewsForTarget(db, id),
  ]);

  return {
    target,
    info: mapInfo(infoRow),
    totals,
    tags,
    ips,
    wallets,
    logs,
    cryptoHistory,
    software,
    reviews,
  };
}

export type TargetSort =
  | 'score'
  | 'crypto'
  | 'level'
  | 'name'
  | 'recent'
  | 'extracted'
  | 'attacks';

export interface TargetListOptions {
  sort?: TargetSort;
  activity?: ActivityState | null;
  tagId?: number | null;
  minLevel?: number | null;
  /** Matches name or device only; full-text search lives in src/db/repo/search.ts. */
  query?: string | null;
  limit?: number;
}

interface SummaryRow extends TargetRow, Omit<InfoRow, 'target_id' | 'notes' | 'last_updated'> {
  extracted_total: number | null;
  ip: string | null;
  ip_count: number;
  wallet_count: number;
  log_count: number;
  software_count: number;
  last_activity_at: number | null;
  active_days: number | null;
}

const DAY_MS = 86400000;

/** yieldTrend() compares the 5 newest events against the 10 before them — 15 is all it can use. */
const TREND_SAMPLE = 15;

/**
 * Newest crypto events for many targets in one query. Per-target trim happens in
 * JS because SQLite can't LIMIT within a group without window functions.
 */
async function listTrendHistories(
  db: SQLiteDatabase,
  targetIds: number[],
): Promise<Map<number, { amount: number; date: number }[]>> {
  if (targetIds.length === 0) return new Map();

  const rows = await db.getAllAsync<{ target_id: number; amount: number; date: number }>(
    `SELECT target_id, amount, date
     FROM crypto_history
     WHERE target_id IN (${placeholders(targetIds.length)})
     ORDER BY date DESC;`,
    targetIds,
  );

  const grouped = groupBy(rows, (r) => r.target_id);
  const trimmed = new Map<number, { amount: number; date: number }[]>();
  for (const [targetId, history] of grouped) {
    trimmed.set(
      targetId,
      history.slice(0, TREND_SAMPLE).map((r) => ({ amount: r.amount, date: r.date })),
    );
  }
  return trimmed;
}

/** Counts are gathered via sub-selects — plain JOINs would multiply rows and inflate every total. */
export async function listTargetSummaries(
  db: SQLiteDatabase,
  options: TargetListOptions = {},
): Promise<TargetSummary[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (options.activity) {
    where.push('i.activity = ?');
    params.push(options.activity);
  }
  if (options.minLevel != null) {
    where.push('i.level >= ?');
    params.push(options.minLevel);
  }
  if (options.query && options.query.trim().length > 0) {
    where.push('(t.name LIKE ? COLLATE NOCASE OR t.device LIKE ? COLLATE NOCASE)');
    const like = `%${options.query.trim()}%`;
    params.push(like, like);
  }
  if (options.tagId != null) {
    where.push('EXISTS (SELECT 1 FROM target_tags tt WHERE tt.target_id = t.id AND tt.tag_id = ?)');
    params.push(options.tagId);
  }

  const orderBy: Record<TargetSort, string> = {
    score: 'i.potential_score DESC, i.crypto DESC',
    crypto: 'i.crypto DESC',
    level: 'i.level DESC, i.crypto DESC',
    name: 't.name COLLATE NOCASE ASC',
    recent: 'COALESCE(last_activity_at, t.date_added) DESC',
    extracted: 'COALESCE(extracted_total, 0) DESC',
    attacks: 't.attack_count DESC',
  };

  const sql = `
    SELECT
      t.id, t.name, t.device, t.date_added, t.attack_count,
      i.level, i.crypto, i.activity, i.potential_score,
      (SELECT SUM(amount)     FROM crypto_history     ch  WHERE ch.target_id  = t.id) AS extracted_total,
      (SELECT address FROM ip_relations ipl
        WHERE ipl.target_id = t.id ORDER BY ipl.discovered_at DESC LIMIT 1)             AS ip,
      (SELECT COUNT(*)        FROM ip_relations       ipr WHERE ipr.target_id = t.id) AS ip_count,
      (SELECT COUNT(*)        FROM wallets            w   WHERE w.target_id   = t.id) AS wallet_count,
      (SELECT COUNT(*)        FROM logs               l   WHERE l.target_id   = t.id) AS log_count,
      (SELECT COUNT(*)        FROM installed_software s   WHERE s.target_id   = t.id) AS software_count,
      NULLIF(MAX(
        COALESCE((SELECT MAX(timestamp) FROM logs l2 WHERE l2.target_id = t.id), 0),
        COALESCE(i.last_seen_at, 0)
      ), 0) AS last_activity_at,
      (SELECT COUNT(DISTINCT CAST(date / ${DAY_MS} AS INTEGER))
         FROM crypto_history ch2 WHERE ch2.target_id = t.id) AS active_days
    FROM targets t
    JOIN target_info i ON i.target_id = t.id
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderBy[options.sort ?? 'score']}
    LIMIT ?;
  `;

  const rows = await db.getAllAsync<SummaryRow>(sql, [...params, options.limit ?? 500]);
  const ids = rows.map((r) => r.id);

  // Three round trips for the whole list, regardless of length.
  const [tagMap, historyMap, profile] = await Promise.all([
    listTagsForTargets(db, ids),
    listTrendHistories(db, ids),
    getUserProfile(db),
  ]);

  return rows.map((r) => {
    const extractedTotal = r.extracted_total ?? 0;
    // Days without an extraction don't count against the average.
    const activeDays = Math.max(1, r.active_days ?? 1);
    const extractedPerActiveDay = extractedTotal / activeDays;

    const trend = yieldTrend(historyMap.get(r.id) ?? []);
    const level = r.level;

    return {
      id: r.id,
      name: r.name,
      device: r.device,
      level,
      crypto: r.crypto,
      activity: r.activity as ActivityState,
      potentialScore: r.potential_score,
      attackCount: r.attack_count,
      dateAdded: r.date_added,
      extractedTotal,
      ip: r.ip,
      ipCount: r.ip_count,
      walletCount: r.wallet_count,
      logCount: r.log_count,
      softwareCount: r.software_count,
      lastActivityAt: r.last_activity_at,
      tags: tagMap.get(r.id) ?? [],
      extractedPerActiveDay,
      yieldTier: yieldTierFor(level, extractedPerActiveDay),
      trendPercent: trend.percent,
      trendDirection: trend.direction,
      recommendation: recommendAction({
        level,
        userLevel: profile.level,
        activity: r.activity as ActivityState,
        score: r.potential_score,
        ratePerActiveDay: extractedPerActiveDay,
        device: r.device,
      }).action,
    };
  });
}

export interface CreateTargetInput {
  name: string;
  device?: string | null;
  level?: number;
  crypto?: number;
  activity?: ActivityState;
  notes?: string;
}

/** targets and target_info rows always exist as a pair. */
export async function createTarget(
  db: SQLiteDatabase,
  input: CreateTargetInput,
): Promise<number> {
  const now = Date.now();
  let targetId = 0;

  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      'INSERT INTO targets (name, device, date_added, attack_count) VALUES (?, ?, ?, 0);',
      [input.name.trim(), input.device?.trim() || null, now],
    );
    targetId = result.lastInsertRowId;

    await db.runAsync(
      `INSERT INTO target_info (target_id, level, crypto, activity, potential_score, notes, last_updated)
       VALUES (?, ?, ?, ?, 0, ?, ?);`,
      [
        targetId,
        input.level ?? 0,
        input.crypto ?? 0,
        input.activity ?? 'REVIEW',
        input.notes ?? '',
        now,
      ],
    );
  });

  await recalculateScore(db, targetId);
  return targetId;
}

export async function ensureTargetByName(db: SQLiteDatabase, name: string): Promise<number> {
  const existing = await findTargetByName(db, name);
  if (existing) return existing.id;
  return createTarget(db, { name });
}

export async function updateTarget(
  db: SQLiteDatabase,
  id: number,
  changes: { name?: string; device?: string | null; attackCount?: number },
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (changes.name !== undefined) {
    sets.push('name = ?');
    params.push(changes.name.trim());
  }
  if (changes.device !== undefined) {
    sets.push('device = ?');
    params.push(changes.device?.trim() || null);
  }
  if (changes.attackCount !== undefined) {
    sets.push('attack_count = ?');
    params.push(Math.max(0, changes.attackCount));
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE targets SET ${sets.join(', ')} WHERE id = ?;`, params);
}

export async function updateTargetInfo(
  db: SQLiteDatabase,
  targetId: number,
  changes: {
    level?: number;
    crypto?: number;
    activity?: ActivityState;
    notes?: string;
  },
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (changes.level !== undefined) {
    sets.push('level = ?');
    params.push(Math.max(0, Math.round(changes.level)));
  }
  if (changes.crypto !== undefined) {
    sets.push('crypto = ?');
    params.push(Math.max(0, changes.crypto));
  }
  if (changes.activity !== undefined) {
    sets.push('activity = ?');
    params.push(changes.activity);
  }
  if (changes.notes !== undefined) {
    sets.push('notes = ?');
    params.push(changes.notes);
  }
  if (sets.length === 0) return;

  sets.push('last_updated = ?');
  params.push(Date.now(), targetId);

  await db.runAsync(`UPDATE target_info SET ${sets.join(', ')} WHERE target_id = ?;`, params);
  await recalculateScore(db, targetId);
}

/** Only moves forward — snapshots can be imported out of order. */
export async function touchTargetSeen(
  db: SQLiteDatabase,
  targetId: number,
  seenAt: number,
): Promise<void> {
  await db.runAsync(
    'UPDATE target_info SET last_seen_at = MAX(COALESCE(last_seen_at, 0), ?) WHERE target_id = ?;',
    [seenAt, targetId],
  );
}

export async function incrementAttackCount(
  db: SQLiteDatabase,
  targetId: number,
  by = 1,
): Promise<void> {
  await db.runAsync('UPDATE targets SET attack_count = attack_count + ? WHERE id = ?;', [
    by,
    targetId,
  ]);
}

/** ON DELETE CASCADE removes everything belonging to the target. */
export async function deleteTarget(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM targets WHERE id = ?;', [id]);
}

/**
 * Folds source into dest, then deletes source. The same player can be discovered
 * twice (by IP, by name); where both sides know a fact the stronger wins —
 * higher level, real activity over REVIEW, notes concatenated.
 */
export async function mergeTargets(
  db: SQLiteDatabase,
  sourceId: number,
  destId: number,
): Promise<void> {
  if (sourceId === destId) return;

  await db.withTransactionAsync(async () => {
    for (const table of ['logs', 'crypto_history', 'wallets', 'ip_relations', 'reviews']) {
      await db.runAsync(`UPDATE ${table} SET target_id = ? WHERE target_id = ?;`, [
        destId,
        sourceId,
      ]);
    }

    // OR IGNORE: tags the destination already has would collide on the primary key.
    await db.runAsync('UPDATE OR IGNORE target_tags SET target_id = ? WHERE target_id = ?;', [
      destId,
      sourceId,
    ]);
    await db.runAsync('DELETE FROM target_tags WHERE target_id = ?;', [sourceId]);

    // Software both sides know: destination keeps the higher level.
    await db.runAsync(
      `UPDATE installed_software AS d
          SET level = MAX(d.level,
                (SELECT s.level FROM installed_software s
                  WHERE s.target_id = ? AND s.software_id = d.software_id AND s.owner = d.owner)),
              updated_at = ?
        WHERE d.target_id = ?
          AND EXISTS (SELECT 1 FROM installed_software s
                       WHERE s.target_id = ? AND s.software_id = d.software_id AND s.owner = d.owner);`,
      [sourceId, Date.now(), destId, sourceId],
    );
    await db.runAsync(
      'UPDATE OR IGNORE installed_software SET target_id = ? WHERE target_id = ?;',
      [destId, sourceId],
    );
    await db.runAsync('DELETE FROM installed_software WHERE target_id = ?;', [sourceId]);

    const src = await db.getFirstAsync<InfoRow>(
      'SELECT * FROM target_info WHERE target_id = ?;',
      [sourceId],
    );
    const dst = await db.getFirstAsync<InfoRow>(
      'SELECT * FROM target_info WHERE target_id = ?;',
      [destId],
    );
    if (src && dst) {
      const notes = [dst.notes, src.notes]
        .map((n) => n.trim())
        .filter(Boolean)
        .join('\n');
      await db.runAsync(
        `UPDATE target_info
            SET level = ?, crypto = ?, activity = ?, notes = ?, last_updated = ?
          WHERE target_id = ?;`,
        [
          Math.max(src.level, dst.level),
          Math.max(src.crypto, dst.crypto),
          dst.activity === 'REVIEW' ? src.activity : dst.activity,
          notes,
          Date.now(),
          destId,
        ],
      );
    }

    await db.runAsync(
      `UPDATE targets
          SET device = COALESCE(device, (SELECT device FROM targets WHERE id = ?)),
              attack_count = attack_count + (SELECT attack_count FROM targets WHERE id = ?)
        WHERE id = ?;`,
      [sourceId, sourceId, destId],
    );
    await db.runAsync('DELETE FROM targets WHERE id = ?;', [sourceId]);
  });

  await recalculateScore(db, destId);
}

// Tags below are managed automatically — never set by hand.
const MANAGED_VALUE_TAGS: readonly string[] = VALUE_TIERS;

const MANAGED_TREND_TAGS: readonly string[] = ['RISING', 'DECLINING'];

// REVIEW means "arrived from a log import, not looked at yet"; it clears when a real activity state is set.
const MANAGED_ACTIVITY_TAGS: readonly string[] = ['REVIEW'];

/**
 * At most one value tag and one trend tag per target; stale tags are removed, and
 * no tag is applied when the data can't support one. The value tier reads the
 * extraction rate per active day, not last-seen holdings.
 */
export async function syncDerivedTags(
  db: SQLiteDatabase,
  targetId: number,
  tier: ValueTier | null,
  direction: TrendDirection,
  activity: ActivityState,
): Promise<void> {
  const wanted = new Set<string>();
  if (tier !== null) wanted.add(tier);
  if (direction === 'RISING' || direction === 'DECLINING') wanted.add(direction);
  if (activity === 'REVIEW') wanted.add('REVIEW');

  const current = await listTagsForTarget(db, targetId);
  const held = new Map(
    current
      .filter(
        (t) =>
          MANAGED_VALUE_TAGS.includes(t.name) ||
          MANAGED_TREND_TAGS.includes(t.name) ||
          MANAGED_ACTIVITY_TAGS.includes(t.name),
      )
      .map((t) => [t.name, t.id] as const),
  );

  for (const [name, tagId] of held) {
    if (!wanted.has(name)) await removeTagFromTarget(db, targetId, tagId);
  }

  for (const name of wanted) {
    if (held.has(name)) continue;
    // ensureTag only inserts if seeding hasn't run — safe on a DB restored from an old backup.
    const tagId = await ensureTag(db, name, categoryForManagedTag(name));
    await addTagToTarget(db, targetId, tagId);
  }
}

function categoryForManagedTag(name: string): TagCategory {
  if (MANAGED_TREND_TAGS.includes(name)) return 'BEHAVIOUR';
  if (MANAGED_ACTIVITY_TAGS.includes(name)) return 'ACTIVITY';
  return 'VALUE';
}

/**
 * Score is stored (not computed on read) because SQL sorts by it — call after anything
 * that feeds it changes. Pass `profile` when looping to avoid re-reading settings per target.
 */
export async function recalculateScore(
  db: SQLiteDatabase,
  targetId: number,
  profile?: UserProfile,
): Promise<number> {
  const target = await getTarget(db, targetId);
  if (!target) return 0;

  const infoRow = await db.getFirstAsync<InfoRow>(
    'SELECT * FROM target_info WHERE target_id = ?;',
    [targetId],
  );
  if (!infoRow) return 0;

  const [totals, software, resolvedProfile, history] = await Promise.all([
    getCryptoTotals(db, targetId),
    listInstalledSoftware(db, targetId),
    profile ? Promise.resolve(profile) : getUserProfile(db),
    db.getAllAsync<{ amount: number; date: number }>(
      'SELECT amount, date FROM crypto_history WHERE target_id = ? ORDER BY date DESC LIMIT ?;',
      [targetId, TREND_SAMPLE],
    ),
  ]);

  const score = calculatePotentialScore({
    level: infoRow.level,
    crypto: infoRow.crypto,
    activity: infoRow.activity as ActivityState,
    totals,
    software,
    attackCount: target.attackCount,
    dateAdded: target.dateAdded,
    device: target.device,
    userLevel: resolvedProfile.level,
  });

  await db.runAsync('UPDATE target_info SET potential_score = ? WHERE target_id = ?;', [
    score,
    targetId,
  ]);

  await syncDerivedTags(
    db,
    targetId,
    yieldTierFor(infoRow.level, totals.averagePerActiveDay),
    yieldTrend(history).direction,
    infoRow.activity as ActivityState,
  );

  return score;
}

export async function recalculateScores(
  db: SQLiteDatabase,
  targetIds: number[],
): Promise<void> {
  const unique = new Set(targetIds);
  if (unique.size === 0) return;

  const profile = await getUserProfile(db);
  for (const id of unique) {
    await recalculateScore(db, id, profile);
  }
}

export async function recalculateAllScores(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ id: number }>('SELECT id FROM targets;');
  const profile = await getUserProfile(db);
  for (const row of rows) {
    await recalculateScore(db, row.id, profile);
  }
  return rows.length;
}

/**
 * Records an attack and any crypto taken with it. The crypto becomes a real
 * crypto_history row — totals are always derived from that table, never stored.
 */
export async function logAttack(
  db: SQLiteDatabase,
  targetId: number,
  input: { crypto?: number; walletId?: number | null; date?: number },
): Promise<void> {
  const amount = Math.max(0, input.crypto ?? 0);
  const date = input.date ?? Date.now();

  await db.withTransactionAsync(async () => {
    await incrementAttackCount(db, targetId);

    if (amount > 0) {
      await insertCryptoEvent(db, {
        targetId,
        walletId: input.walletId ?? null,
        amount,
        date,
        // Typed in by hand — no log line behind it, so sourceLogId stays null.
        source: 'STEAL',
        sourceLogId: null,
      });
    }

    await recalculateScore(db, targetId);
  });
}

export async function countTargets(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM targets;');
  return row?.n ?? 0;
}

export async function findExistingNames(
  db: SQLiteDatabase,
  names: string[],
): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM targets WHERE name IN (${placeholders(names.length)}) COLLATE NOCASE;`,
    names,
  );
  return new Set(rows.map((r) => r.name.toLowerCase()));
}
