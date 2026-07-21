import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';
import { LATEST_VERSION, MIGRATIONS } from './schema';
import { SEED_SOFTWARE, SEED_TAGS } from './seed';
import {
  createTarget,
  getTargetWithDetails,
  listTargetSummaries,
  updateTargetInfo,
} from './repo/targets';
import { addIp, listUnassignedWallets, upsertWallet, assignWalletToTarget } from './repo/intel';
import { getCryptoTotals, findExistingHashes } from './repo/logs';
import { searchEverything } from './repo/search';
import { getDashboardStats } from './repo/stats';
import { createBackup, restoreBackup, serialiseBackup, exportTargetsCsv } from './repo/backup';
import { listOpenReviews } from './repo/reviews';
import { parseLogText } from '@/logic/parser';
import { ingestParsedLines, previewIngest } from '@/logic/ingest';
import { ingestEnemyScreen } from '@/logic/enemyCapture';

/** Adapts bun:sqlite to the expo-sqlite API the app uses — same engine, same SQL. */
function adapt(raw: Database): SQLiteDatabase {
  const api = {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      const result = raw.query(sql).run(...(params as never[]));
      return {
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: Number(result.changes),
      };
    },
    getAllAsync: async (sql: string, params: unknown[] = []) =>
      raw.query(sql).all(...(params as never[])),
    getFirstAsync: async (sql: string, params: unknown[] = []) =>
      raw.query(sql).get(...(params as never[])) ?? null,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      raw.exec('BEGIN;');
      try {
        await fn();
        raw.exec('COMMIT;');
      } catch (error) {
        raw.exec('ROLLBACK;');
        throw error;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}

async function freshDatabase(): Promise<SQLiteDatabase> {
  const raw = new Database(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  const db = adapt(raw);

  for (const migration of MIGRATIONS) {
    await db.execAsync(migration.sql);
  }
  for (const item of SEED_SOFTWARE) {
    await db.runAsync('INSERT OR IGNORE INTO software (name, category) VALUES (?, ?);', [
      item.name,
      item.category,
    ]);
  }
  for (const tag of SEED_TAGS) {
    await db.runAsync(
      'INSERT OR IGNORE INTO tags (name, category, color, is_system) VALUES (?, ?, ?, 1);',
      [tag.name, tag.category, tag.color],
    );
  }
  return db;
}

const SAMPLE = `[7-18 19:00] Uploaded Lv3 Siphon to 216.22.206.218
[7-18 19:00] Failed to crack password on 216.22.206.218
[7-18 18:04] Cracked password on 113.39.182.104
[7-18 18:03] Accessed device at 154.9.12.100
[7-18 18:02] Accessed device at 216.22.206.218
[7-18 18:01] Accessed device at 113.39.182.104
[7-18 18:00] Stole 172 Crypto from hx84d9...762d
[7-18 17:59] Stole 435 Crypto from hxbef6...beba
[7-18 17:56] Bypassed firewall on 216.22.206.218
[7-18 17:56] Stole 866 Crypto from hx786b...08d0`;

// A crypto line and the access line for the same break-in, joined only by timestamp.
const PAIRED = `[7-19 0:11] Stole 8 Crypto from hxee62...ce13
[7-19 0:11] Accessed device at 197.14.234.139`;

// Two devices broken into in the same minute — the wallet's owner is unknowable.
const AMBIGUOUS = `[7-19 0:11] Stole 8 Crypto from hxee62...ce13
[7-19 0:11] Accessed device at 197.14.234.139
[7-19 0:11] Accessed device at 12.34.56.78`;

const NOW = new Date(2026, 6, 18, 20, 0, 0);

describe('schema', () => {
  it('creates every table the app expects', async () => {
    const db = await freshDatabase();
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    );
    const names = tables.map((t) => t.name);

    for (const expected of [
      'targets',
      'target_info',
      'tags',
      'target_tags',
      'logs',
      'ip_relations',
      'wallets',
      'crypto_history',
      'software',
      'installed_software',
      'reviews',
      'settings',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('has exactly one migration per version number, ending at LATEST_VERSION', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...new Set(versions)].sort((a, b) => a - b));
    expect(Math.max(...versions)).toBe(LATEST_VERSION);
  });

  it('deletes a target’s whole footprint via cascade', async () => {
    const db = await freshDatabase();
    const targetId = await createTarget(db, { name: 'Nova3', level: 10, crypto: 500 });
    await addIp(db, { targetId, address: '1.2.3.4' });
    await ingestParsedLines(db, parseLogText(SAMPLE, NOW).lines, { forceTargetId: targetId });

    await db.runAsync('DELETE FROM targets WHERE id = ?;', [targetId]);

    for (const table of ['target_info', 'ip_relations', 'logs', 'crypto_history']) {
      const row = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE target_id = ?;`,
        [targetId],
      );
      expect(row?.n).toBe(0);
    }
  });
});

describe('importing real logs', () => {
  let db: SQLiteDatabase;

  beforeEach(async () => {
    db = await freshDatabase();
  });

  it('turns an unknown IP into a target under review instead of a chore', async () => {
    const { lines } = parseLogText(SAMPLE, NOW);
    const report = await ingestParsedLines(db, lines);

    expect(report.logsInserted).toBe(10);
    expect(report.cryptoTotalAdded).toBe(1473);

    // Three distinct IPs in the capture, none known beforehand.
    const created = report.targetsCreated.map((t) => t.name).sort();
    expect(created).toEqual(['113.39.182.104', '154.9.12.100', '216.22.206.218']);
    expect(report.unknownIps.sort()).toEqual(created);

    const summaries = await listTargetSummaries(db);
    const fresh = summaries.find((t) => t.name === '216.22.206.218')!;
    expect(fresh.activity).toBe('REVIEW');
    expect(fresh.ipCount).toBe(1);
  });

  it('creates a target from any line that names an IP, whatever the line says', async () => {
    const text = `[7-19 6:35] Uploaded Lv7 Spam to 165.31.178.181
[7-19 6:35] Cracked password on 24.200.58.68
[7-19 6:35] Bypassed firewall on 255.32.169.70`;

    const report = await ingestParsedLines(db, parseLogText(text, NOW).lines);

    expect(report.targetsCreated.map((t) => t.name).sort()).toEqual([
      '165.31.178.181',
      '24.200.58.68',
      '255.32.169.70',
    ]);
    expect(await listOpenReviews(db)).toHaveLength(0);
  });

  it('tags an auto-created target REVIEW, and drops the tag once you rate it', async () => {
    const report = await ingestParsedLines(db, parseLogText(PAIRED, NOW).lines);
    const targetId = report.targetsCreated[0].targetId;

    const before = await getTargetWithDetails(db, targetId);
    expect(before!.tags.map((t) => t.name)).toContain('REVIEW');

    await updateTargetInfo(db, targetId, { activity: 'ACTIVE' });

    const after = await getTargetWithDetails(db, targetId);
    expect(after!.tags.map((t) => t.name)).not.toContain('REVIEW');
  });

  it('pairs a crypto line to the device broken into at the same moment', async () => {
    const report = await ingestParsedLines(db, parseLogText(PAIRED, NOW).lines);

    expect(report.targetsCreated.map((t) => t.name)).toEqual(['197.14.234.139']);

    const targetId = report.targetsCreated[0].targetId;
    const details = await getTargetWithDetails(db, targetId)!;

    expect(details!.wallets.map((w) => w.displayAddress)).toEqual(['hxee62...ce13']);
    expect(details!.wallets[0].cracked).toBe(false);
    expect(details!.totals.extractedTotal).toBe(8);

    expect(await listUnassignedWallets(db)).toHaveLength(0);
  });

  it('refuses to guess when two devices share the timestamp', async () => {
    const report = await ingestParsedLines(db, parseLogText(AMBIGUOUS, NOW).lines);

    // The IPs are unambiguous; the wallet could belong to either, so it belongs to neither.
    expect(report.targetsCreated).toHaveLength(2);
    expect(report.unassignedWallets).toEqual(['hxee62...ce13']);
    const orphans = await listUnassignedWallets(db);
    expect(orphans).toHaveLength(1);

    const reviews = await listOpenReviews(db);
    expect(reviews.some((r) => r.kind === 'UNRESOLVED_WALLET')).toBe(true);
  });

  it('marks a wallet cracked when it sees the full address', async () => {
    const shortened = '[7-19 0:11] Stole 8 Crypto from hxcf6f...173a';
    const full = '[7-19 0:20] Stole 40 Crypto from hxcf6f90f2f558f95bc581c9ed61173a';

    await ingestParsedLines(db, parseLogText(shortened, NOW).lines);
    const report = await ingestParsedLines(db, parseLogText(full, NOW).lines);
    expect(report.walletsCracked).toBe(1);

    // One wallet, not two: the full address collapses onto the shortened row.
    const wallets = await db.getAllAsync<{ display_address: string; full_address: string | null; cracked: number }>(
      'SELECT display_address, full_address, cracked FROM wallets;',
    );
    expect(wallets).toHaveLength(1);
    expect(wallets[0].display_address).toBe('hxcf6f...173a');
    expect(wallets[0].full_address).toBe('hxcf6f90f2f558f95bc581c9ed61173a');
    expect(wallets[0].cracked).toBe(1);
  });

  it('attaches events to the right target when the IP is known', async () => {
    const targetId = await createTarget(db, { name: 'Nova3', level: 10 });
    await addIp(db, { targetId, address: '216.22.206.218' });

    const { lines } = parseLogText(SAMPLE, NOW);
    await ingestParsedLines(db, lines);

    const details = await getTargetWithDetails(db, targetId);
    expect(details).not.toBeNull();
    // 4 lines name the IP, plus the 17:56 theft paired by timestamp.
    expect(details!.logs.length).toBe(5);
    // Upload proves Siphon, bypass proves Firewall, failed crack proves Password Encryptor.
    const softwareNames = details!.software.map((s) => s.name).sort();
    expect(softwareNames).toEqual(['Firewall', 'Password Encryptor', 'Siphon']);
    // Only the completed access counts as an attack.
    expect(details!.target.attackCount).toBe(1);
  });

  it('records the Siphon as mine and the firewall as theirs', async () => {
    const targetId = await createTarget(db, { name: 'Nova3' });
    await addIp(db, { targetId, address: '216.22.206.218' });
    await ingestParsedLines(db, parseLogText(SAMPLE, NOW).lines);

    const details = await getTargetWithDetails(db, targetId);
    const siphon = details!.software.find((s) => s.name === 'Siphon');
    const firewall = details!.software.find((s) => s.name === 'Firewall');

    expect(siphon?.owner).toBe('MINE');
    expect(siphon?.level).toBe(3);
    expect(firewall?.owner).toBe('TARGET');
  });

  it('never counts the same log line twice', async () => {
    const { lines } = parseLogText(SAMPLE, NOW);

    const first = await ingestParsedLines(db, lines);
    const second = await ingestParsedLines(db, parseLogText(SAMPLE, NOW).lines);

    expect(first.logsInserted).toBe(10);
    expect(second.logsInserted).toBe(0);
    expect(second.duplicatesSkipped).toBe(10);
    expect(second.cryptoTotalAdded).toBe(0);

    const totals = await getCryptoTotals(db, 0);
    const row = await db.getFirstAsync<{ total: number }>(
      'SELECT SUM(amount) AS total FROM crypto_history;',
    );
    expect(row?.total).toBe(1473);
    expect(totals.extractedTotal).toBe(0); // target 0 does not exist
  });

  it('raises reviews only for what it genuinely could not place', async () => {
    // Unknown IPs become targets, not reviews.
    await ingestParsedLines(db, parseLogText(SAMPLE, NOW).lines);
    expect(await listOpenReviews(db)).toHaveLength(0);

    await ingestParsedLines(db, parseLogText(AMBIGUOUS, NOW).lines);
    const reviews = await listOpenReviews(db);
    expect(reviews.some((r) => r.kind === 'UNRESOLVED_WALLET')).toBe(true);
    expect(reviews.some((r) => r.kind === 'UNRESOLVED_IP')).toBe(false);
  });

  it('credits historic crypto when a wallet is finally assigned', async () => {
    await ingestParsedLines(db, parseLogText(AMBIGUOUS, NOW).lines);
    const targetId = await createTarget(db, { name: 'Nova3', level: 10 });

    const orphans = await listUnassignedWallets(db);
    const wallet = orphans.find((w) => w.displayAddress === 'hxee62...ce13')!;
    const credited = await assignWalletToTarget(db, wallet.id, targetId);

    expect(credited).toBe(1);

    const totals = await getCryptoTotals(db, targetId, NOW);
    expect(totals.extractedTotal).toBe(8);
    expect(totals.eventCount).toBe(1);
  });

  it('previews an import without writing anything', async () => {
    const { lines } = parseLogText(SAMPLE, NOW);
    const preview = await previewIngest(db, lines, new Set());

    expect(preview.newLines).toBe(10);
    expect(preview.cryptoTotal).toBe(1473);
    expect(preview.targetsToCreate.sort()).toEqual([
      '113.39.182.104',
      '154.9.12.100',
      '216.22.206.218',
    ]);
    expect(preview.unknownWallets).toHaveLength(0);

    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM logs;');
    expect(row?.n).toBe(0);
  });

  it('recognises already-imported lines by hash', async () => {
    const { lines } = parseLogText(SAMPLE, NOW);
    await ingestParsedLines(db, lines);

    const hashes = await findExistingHashes(db, lines.map((l) => l.hash));
    expect(hashes.size).toBe(10);
  });
});

describe('reading data back', () => {
  let db: SQLiteDatabase;
  let targetId: number;

  beforeEach(async () => {
    db = await freshDatabase();
    targetId = await createTarget(db, {
      name: 'Nova3',
      device: 'Laptop',
      level: 30,
      crypto: 2600,
      activity: 'ACTIVE',
      notes: 'Refills fast overnight',
    });
    await addIp(db, { targetId, address: '216.22.206.218' });
    await ingestParsedLines(db, parseLogText(SAMPLE, NOW).lines);
  });

  it('returns everything about a target in one call', async () => {
    const details = await getTargetWithDetails(db, targetId);
    expect(details).not.toBeNull();
    expect(details!.target.name).toBe('Nova3');
    expect(details!.info.level).toBe(30);
    expect(details!.ips.length).toBeGreaterThan(0);
    expect(details!.software.length).toBeGreaterThan(0);
    expect(details!.logs.length).toBeGreaterThan(0);
    expect(details!.totals).toBeDefined();
  });

  it('scores a rich target above an empty one', async () => {
    const emptyId = await createTarget(db, { name: 'Nobody', level: 30 });
    const list = await listTargetSummaries(db, { sort: 'score' });

    const rich = list.find((t) => t.id === targetId)!;
    const empty = list.find((t) => t.id === emptyId)!;
    expect(rich.potentialScore).toBeGreaterThan(empty.potentialScore);
  });

  it('sorts and filters the target list', async () => {
    await createTarget(db, { name: 'Aardvark', level: 1, activity: 'INACTIVE' });

    // IP-named targets sort ahead of letters, so check ordering rather than a fixed first row.
    const byName = await listTargetSummaries(db, { sort: 'name' });
    expect(byName.map((t) => t.name)).toContain('Aardvark');
    expect(byName.map((t) => t.name)).toEqual(
      [...byName.map((t) => t.name)].sort((a, b) => a.localeCompare(b)),
    );

    const active = await listTargetSummaries(db, { activity: 'ACTIVE' });
    expect(active.every((t) => t.activity === 'ACTIVE')).toBe(true);

    const searched = await listTargetSummaries(db, { query: 'nov' });
    expect(searched.map((t) => t.name)).toContain('Nova3');
  });

  it('searches across every kind of record', async () => {
    const byName = await searchEverything(db, 'Nova3');
    expect(byName.some((r) => r.kind === 'TARGET')).toBe(true);

    const byIp = await searchEverything(db, '216.22.206.218');
    expect(byIp.some((r) => r.kind === 'IP')).toBe(true);

    const byWallet = await searchEverything(db, 'hx786b');
    expect(byWallet.some((r) => r.kind === 'WALLET')).toBe(true);

    const bySoftware = await searchEverything(db, 'Siphon');
    expect(bySoftware.some((r) => r.kind === 'SOFTWARE')).toBe(true);

    const byLogText = await searchEverything(db, 'Bypassed firewall');
    expect(byLogText.some((r) => r.kind === 'LOG')).toBe(true);

    const byNote = await searchEverything(db, 'overnight');
    expect(byNote.some((r) => r.kind === 'NOTE')).toBe(true);
  });

  it('builds the dashboard without error', async () => {
    const stats = await getDashboardStats(db, NOW);
    // Nova3 plus the two unowned IPs in the capture.
    expect(stats.targetCount).toBe(3);
    expect(stats.daily).toHaveLength(30);
    expect(stats.ipCount).toBeGreaterThan(0);
    expect(stats.activityCounts.ACTIVE).toBe(1);
  });
});

describe('enemy screen capture', () => {
  let db: SQLiteDatabase;

  beforeEach(async () => {
    db = await freshDatabase();
  });

  it('a visit with nothing to loot still counts as recent activity', async () => {
    await createTarget(db, { name: 'OldTimer' });
    const visitAt = Date.now() + 60_000;
    await ingestEnemyScreen(
      db,
      { kind: 'wallet', name: 'Visited', fullAddress: null, hotCrypto: 0, coldCrypto: 0 },
      visitAt,
    );

    const recent = await listTargetSummaries(db, { sort: 'recent' });
    expect(recent[0].name).toBe('Visited');
    expect(recent[0].lastActivityAt).toBe(visitAt);
  });

  it('fills a target from the three screens without creating duplicates', async () => {
    // Reproduces a real duplicate: discovered once as a bare IP, once by name.
    await ingestParsedLines(
      db,
      parseLogText('[7-18 18:01] Accessed device at 94.172.36.66', NOW).lines,
    );
    await ingestEnemyScreen(
      db,
      {
        kind: 'wallet',
        name: 'Lord-Dumblestark',
        fullAddress: 'hx973bc81bfe269e0c05563ebb93ed4c',
        hotCrypto: 811,
        coldCrypto: 12991,
      },
      NOW.getTime(),
    );
    expect((await listTargetSummaries(db)).length).toBe(2);

    // The profile links name and IP, so the two records must merge.
    await ingestEnemyScreen(
      db,
      {
        kind: 'profile',
        name: 'Lord-Dumblestark',
        level: 12,
        rep: 6799,
        score: 8984,
        ip: '94.172.36.66',
        device: 'Raider II',
        network: 'Cable',
        firewallLevel: 6,
        encryptorLevel: 4,
      },
      NOW.getTime(),
    );
    await ingestEnemyScreen(
      db,
      {
        kind: 'apps',
        name: 'Lord-Dumblestark',
        software: [
          { name: 'Antivirus', level: 5 },
          { name: 'Firewall', level: 6 },
          { name: 'Keygen', level: 9 },
        ],
      },
      NOW.getTime(),
    );

    const list = await listTargetSummaries(db);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Lord-Dumblestark');

    const details = await getTargetWithDetails(db, list[0].id);
    expect(details!.info.level).toBe(12);
    expect(details!.info.crypto).toBe(811);
    expect(details!.target.device).toBe('Raider II');
    expect(details!.ips.map((i) => i.address)).toContain('94.172.36.66');

    const wallet = details!.wallets[0];
    expect(wallet.fullAddress).toBe('hx973bc81bfe269e0c05563ebb93ed4c');
    expect(wallet.cracked).toBe(true);

    const softwareNames = details!.software.map((s) => s.name);
    expect(softwareNames).toContain('Antivirus');
    expect(softwareNames).toContain('Keygen');
    // Profile defence readings and the apps list agree on the firewall — one row, not two.
    expect(softwareNames.filter((n) => n === 'Firewall')).toHaveLength(1);
  });

  it('keeps the higher software level when merging two records of one player', async () => {
    // Name-record saw Firewall 8, IP-record only Firewall 6; 8 must survive the merge.
    await ingestParsedLines(
      db,
      parseLogText('[7-18 18:01] Accessed device at 94.172.36.66', NOW).lines,
    );
    await ingestEnemyScreen(
      db,
      {
        kind: 'apps',
        name: 'Duplicated',
        software: [{ name: 'Firewall', level: 8 }],
      },
      NOW.getTime(),
    );
    await ingestEnemyScreen(
      db,
      {
        kind: 'profile',
        name: 'Duplicated',
        level: 10,
        rep: null,
        score: null,
        ip: '94.172.36.66',
        device: null,
        network: null,
        firewallLevel: 6,
        encryptorLevel: null,
      },
      NOW.getTime(),
    );

    const list = await listTargetSummaries(db);
    expect(list.length).toBe(1);

    const details = await getTargetWithDetails(db, list[0].id);
    const firewall = details!.software.find((s) => s.name === 'Firewall');
    expect(firewall?.level).toBe(8);
  });
});

describe('backup and restore', () => {
  it('survives a full round trip', async () => {
    const db = await freshDatabase();
    const targetId = await createTarget(db, { name: 'Nova3', level: 30, crypto: 2600 });
    await addIp(db, { targetId, address: '216.22.206.218' });
    await ingestParsedLines(db, parseLogText(SAMPLE, NOW).lines);

    const before = await getTargetWithDetails(db, targetId);
    const backup = serialiseBackup(await createBackup(db));

    await db.runAsync('DELETE FROM targets;');
    expect((await listTargetSummaries(db)).length).toBe(0);

    const result = await restoreBackup(db, backup);
    expect(result.ok).toBe(true);

    const after = await getTargetWithDetails(db, targetId);
    expect(after!.target.name).toBe(before!.target.name);
    expect(after!.logs.length).toBe(before!.logs.length);
    expect(after!.ips.length).toBe(before!.ips.length);
  });

  it('refuses a file that is not a Trakker backup', async () => {
    const db = await freshDatabase();
    expect((await restoreBackup(db, 'not json at all')).ok).toBe(false);
    expect((await restoreBackup(db, '{"format":"something-else"}')).ok).toBe(false);
    expect(
      (await restoreBackup(db, '{"format":"trakker3-backup","version":999,"tables":{}}')).ok,
    ).toBe(false);
  });

  it('exports a CSV that defends against formula injection', async () => {
    const db = await freshDatabase();
    // A name starting with = would be executed as a formula by Excel.
    await createTarget(db, { name: '=cmd|calc', level: 5 });
    const csv = await exportTargetsCsv(db);

    expect(csv.split('\n')[0]).toContain('Name');
    expect(csv).toContain("'=cmd|calc");
  });
});
