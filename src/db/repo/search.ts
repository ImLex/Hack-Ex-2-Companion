import type { SQLiteDatabase } from 'expo-sqlite';

export type SearchResultKind =
  | 'TARGET'
  | 'IP'
  | 'WALLET'
  | 'SOFTWARE'
  | 'LOG'
  | 'NOTE'
  | 'TAG';

export interface SearchResult {
  kind: SearchResultKind;
  /** The target this result belongs to, if any. Null for unassigned wallets. */
  targetId: number | null;
  targetName: string | null;
  title: string;
  subtitle: string;
  /** Higher sorts first. */
  rank: number;
}

/** Ranking: exact > prefix > substring; targets outrank the details that hang off them. */
export async function searchEverything(
  db: SQLiteDatabase,
  rawQuery: string,
  limitPerKind = 25,
): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length === 0) return [];

  const like = `%${query}%`;
  const prefix = `${query}%`;
  const results: SearchResult[] = [];

  // --- targets: name and device ---
  const targets = await db.getAllAsync<{
    id: number;
    name: string;
    device: string | null;
    level: number;
    crypto: number;
    activity: string;
    potential_score: number;
  }>(
    `SELECT t.id, t.name, t.device, i.level, i.crypto, i.activity, i.potential_score
     FROM targets t JOIN target_info i ON i.target_id = t.id
     WHERE t.name LIKE ? COLLATE NOCASE OR t.device LIKE ? COLLATE NOCASE
     ORDER BY i.potential_score DESC LIMIT ?;`,
    [like, like, limitPerKind],
  );
  for (const t of targets) {
    const exact = t.name.toLowerCase() === query.toLowerCase();
    const starts = t.name.toLowerCase().startsWith(query.toLowerCase());
    results.push({
      kind: 'TARGET',
      targetId: t.id,
      targetName: t.name,
      title: t.name,
      subtitle: `Level ${t.level} · ${Math.round(t.crypto)} crypto · ${t.activity.replace('_', ' ')}${
        t.device ? ` · ${t.device}` : ''
      }`,
      rank: 1000 + (exact ? 300 : starts ? 150 : 0) + t.potential_score,
    });
  }

  // --- IP addresses ---
  const ips = await db.getAllAsync<{
    address: string;
    status: string;
    target_id: number;
    name: string;
  }>(
    `SELECT ip.address, ip.status, ip.target_id, t.name
     FROM ip_relations ip JOIN targets t ON t.id = ip.target_id
     WHERE ip.address LIKE ? LIMIT ?;`,
    [like, limitPerKind],
  );
  for (const ip of ips) {
    results.push({
      kind: 'IP',
      targetId: ip.target_id,
      targetName: ip.name,
      title: ip.address,
      subtitle: `${ip.status.toLowerCase()} · ${ip.name}`,
      rank: 800 + (ip.address === query ? 300 : ip.address.startsWith(query) ? 100 : 0),
    });
  }

  // --- wallets, including ones with no owner yet ---
  const wallets = await db.getAllAsync<{
    display_address: string;
    full_address: string | null;
    cracked: number;
    target_id: number | null;
    name: string | null;
  }>(
    `SELECT w.display_address, w.full_address, w.cracked, w.target_id, t.name
     FROM wallets w LEFT JOIN targets t ON t.id = w.target_id
     WHERE w.display_address LIKE ? COLLATE NOCASE
        OR w.full_address    LIKE ? COLLATE NOCASE
     LIMIT ?;`,
    [like, like, limitPerKind],
  );
  for (const w of wallets) {
    results.push({
      kind: 'WALLET',
      targetId: w.target_id,
      targetName: w.name,
      title: w.full_address ?? w.display_address,
      subtitle: `${w.cracked === 1 ? 'cracked' : 'not cracked'} · ${w.name ?? 'unassigned'}`,
      rank: 780 + (w.display_address === query ? 300 : 0),
    });
  }

  // --- installed software, by name ---
  const software = await db.getAllAsync<{
    name: string;
    level: number;
    owner: string;
    target_id: number;
    target_name: string;
  }>(
    `SELECT s.name, ins.level, ins.owner, ins.target_id, t.name AS target_name
     FROM installed_software ins
     JOIN software s ON s.id = ins.software_id
     JOIN targets  t ON t.id = ins.target_id
     WHERE s.name LIKE ? COLLATE NOCASE
     ORDER BY ins.level DESC LIMIT ?;`,
    [like, limitPerKind],
  );
  for (const s of software) {
    results.push({
      kind: 'SOFTWARE',
      targetId: s.target_id,
      targetName: s.target_name,
      title: `${s.name} Lv${s.level}`,
      subtitle: `${s.target_name} · ${s.owner === 'MINE' ? 'uploaded by me' : "target's own"}`,
      rank: 700 + s.level,
    });
  }

  // --- notes ---
  const notes = await db.getAllAsync<{ target_id: number; notes: string; name: string }>(
    `SELECT i.target_id, i.notes, t.name
     FROM target_info i JOIN targets t ON t.id = i.target_id
     WHERE i.notes LIKE ? COLLATE NOCASE AND LENGTH(i.notes) > 0
     LIMIT ?;`,
    [like, limitPerKind],
  );
  for (const n of notes) {
    results.push({
      kind: 'NOTE',
      targetId: n.target_id,
      targetName: n.name,
      title: `Note on ${n.name}`,
      subtitle: excerpt(n.notes, query),
      rank: 650,
    });
  }

  // --- tags ---
  const tags = await db.getAllAsync<{ id: number; name: string; n: number }>(
    `SELECT t.id, t.name, COUNT(tt.target_id) AS n
     FROM tags t LEFT JOIN target_tags tt ON tt.tag_id = t.id
     WHERE t.name LIKE ? COLLATE NOCASE
     GROUP BY t.id ORDER BY n DESC LIMIT ?;`,
    [like, limitPerKind],
  );
  for (const t of tags) {
    results.push({
      kind: 'TAG',
      targetId: null,
      targetName: null,
      title: t.name,
      subtitle: `${t.n} ${t.n === 1 ? 'target' : 'targets'}`,
      rank: 600 + t.n,
    });
  }

  // --- raw log contents ---
  const logs = await db.getAllAsync<{
    id: number;
    raw_log: string;
    timestamp: number;
    event_type: string;
    target_id: number | null;
    name: string | null;
  }>(
    `SELECT l.id, l.raw_log, l.timestamp, l.event_type, l.target_id, t.name
     FROM logs l LEFT JOIN targets t ON t.id = l.target_id
     WHERE l.raw_log LIKE ? COLLATE NOCASE
     ORDER BY l.timestamp DESC LIMIT ?;`,
    [like, limitPerKind],
  );
  for (const l of logs) {
    results.push({
      kind: 'LOG',
      targetId: l.target_id,
      targetName: l.name,
      title: l.raw_log,
      subtitle: `${l.event_type.replace(/_/g, ' ').toLowerCase()} · ${l.name ?? 'unassigned'}`,
      rank: 500,
    });
  }

  // --- numeric searches: level, crypto and score ---
  const asNumber = Number(query);
  if (Number.isFinite(asNumber) && query.length > 0) {
    const numeric = await db.getAllAsync<{
      id: number;
      name: string;
      level: number;
      crypto: number;
      potential_score: number;
    }>(
      `SELECT t.id, t.name, i.level, i.crypto, i.potential_score
       FROM targets t JOIN target_info i ON i.target_id = t.id
       WHERE i.level = ?
          OR (i.crypto          BETWEEN ? AND ?)
          OR (i.potential_score BETWEEN ? AND ?)
       ORDER BY i.potential_score DESC LIMIT ?;`,
      [
        Math.round(asNumber),
        asNumber * 0.9,
        asNumber * 1.1,
        asNumber - 2,
        asNumber + 2,
        limitPerKind,
      ],
    );
    for (const t of numeric) {
      // Skip targets already returned by the name search.
      if (results.some((r) => r.kind === 'TARGET' && r.targetId === t.id)) continue;
      results.push({
        kind: 'TARGET',
        targetId: t.id,
        targetName: t.name,
        title: t.name,
        subtitle: `Level ${t.level} · ${Math.round(t.crypto)} crypto · score ${t.potential_score}`,
        rank: 400,
      });
    }
  }

  results.sort((a, b) => b.rank - a.rank);
  return results;
}

function excerpt(text: string, query: string, radius = 40): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
