// Every crypto figure derives from crypto_history; each row points back at its source log.

import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  CryptoHistory,
  CryptoHistoryWithLog,
  CryptoSource,
  CryptoTotals,
  EventType,
  LogRecord,
} from '../types';
import { daysAgo, placeholders, startOfToday } from './shared';

interface LogRow {
  id: number;
  target_id: number | null;
  raw_log: string;
  timestamp: number;
  raw_timestamp: string | null;
  event_type: string;
  crypto_extracted: number;
  extracted_ip_count: number;
  extracted_wallet_count: number;
  extracted_ips: string;
  extracted_wallets: string;
  extracted_software: string | null;
  extracted_software_level: number | null;
  parser_confidence: number;
  imported_at: number;
  hash: string;
}

const mapLog = (r: LogRow): LogRecord => ({
  id: r.id,
  targetId: r.target_id,
  rawLog: r.raw_log,
  timestamp: r.timestamp,
  rawTimestamp: r.raw_timestamp,
  eventType: r.event_type as EventType,
  cryptoExtracted: r.crypto_extracted,
  extractedIpCount: r.extracted_ip_count,
  extractedWalletCount: r.extracted_wallet_count,
  extractedIps: r.extracted_ips,
  extractedWallets: r.extracted_wallets,
  extractedSoftware: r.extracted_software,
  extractedSoftwareLevel: r.extracted_software_level,
  parserConfidence: r.parser_confidence,
  importedAt: r.imported_at,
  hash: r.hash,
});

export interface InsertLogInput {
  targetId: number | null;
  rawLog: string;
  timestamp: number;
  rawTimestamp: string | null;
  eventType: EventType;
  cryptoExtracted: number;
  extractedIps: string[];
  extractedWallets: string[];
  extractedSoftware: string | null;
  extractedSoftwareLevel: number | null;
  parserConfidence: number;
  hash: string;
}

/** Returns null when the hash already exists — re-pasted dumps must not double-count crypto. */
export async function insertLog(
  db: SQLiteDatabase,
  input: InsertLogInput,
): Promise<number | null> {
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM logs WHERE hash = ?;', [
    input.hash,
  ]);
  if (existing) return null;

  const result = await db.runAsync(
    `INSERT INTO logs (
       target_id, raw_log, timestamp, raw_timestamp, event_type, crypto_extracted,
       extracted_ip_count, extracted_wallet_count, extracted_ips, extracted_wallets,
       extracted_software, extracted_software_level, parser_confidence, imported_at, hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      input.targetId,
      input.rawLog,
      input.timestamp,
      input.rawTimestamp,
      input.eventType,
      input.cryptoExtracted,
      input.extractedIps.length,
      input.extractedWallets.length,
      input.extractedIps.join(', '),
      input.extractedWallets.join(', '),
      input.extractedSoftware,
      input.extractedSoftwareLevel,
      input.parserConfidence,
      Date.now(),
      input.hash,
    ],
  );
  return result.lastInsertRowId;
}

export async function listLogs(
  db: SQLiteDatabase,
  targetId: number,
  limit = 200,
): Promise<LogRecord[]> {
  const rows = await db.getAllAsync<LogRow>(
    'SELECT * FROM logs WHERE target_id = ? ORDER BY timestamp DESC LIMIT ?;',
    [targetId, limit],
  );
  return rows.map(mapLog);
}

export async function listRecentLogs(db: SQLiteDatabase, limit = 100): Promise<LogRecord[]> {
  const rows = await db.getAllAsync<LogRow>(
    'SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?;',
    [limit],
  );
  return rows.map(mapLog);
}

export async function listUnassignedLogs(db: SQLiteDatabase, limit = 200): Promise<LogRecord[]> {
  const rows = await db.getAllAsync<LogRow>(
    'SELECT * FROM logs WHERE target_id IS NULL ORDER BY timestamp DESC LIMIT ?;',
    [limit],
  );
  return rows.map(mapLog);
}

export async function assignLogToTarget(
  db: SQLiteDatabase,
  logId: number,
  targetId: number,
): Promise<void> {
  await db.runAsync('UPDATE logs SET target_id = ? WHERE id = ?;', [targetId, logId]);
  await db.runAsync(
    'UPDATE crypto_history SET target_id = ? WHERE source_log_id = ? AND target_id IS NULL;',
    [targetId, logId],
  );
}

export async function deleteLog(db: SQLiteDatabase, logId: number): Promise<void> {
  await db.runAsync('DELETE FROM logs WHERE id = ?;', [logId]);
}

export async function findExistingHashes(
  db: SQLiteDatabase,
  hashes: string[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();

  const found = new Set<string>();
  // SQLite caps parameters per statement, so query in batches.
  const BATCH = 400;
  for (let i = 0; i < hashes.length; i += BATCH) {
    const batch = hashes.slice(i, i + BATCH);
    const rows = await db.getAllAsync<{ hash: string }>(
      `SELECT hash FROM logs WHERE hash IN (${placeholders(batch.length)});`,
      batch,
    );
    for (const row of rows) found.add(row.hash);
  }
  return found;
}

interface CryptoRow {
  id: number;
  target_id: number | null;
  wallet_id: number | null;
  amount: number;
  date: number;
  source: string;
  source_log_id: number | null;
}

const mapCrypto = (r: CryptoRow): CryptoHistory => ({
  id: r.id,
  targetId: r.target_id,
  walletId: r.wallet_id,
  amount: r.amount,
  date: r.date,
  source: r.source as CryptoSource,
  sourceLogId: r.source_log_id,
});

export async function insertCryptoEvent(
  db: SQLiteDatabase,
  input: {
    targetId: number | null;
    walletId: number | null;
    amount: number;
    date: number;
    source: CryptoSource;
    sourceLogId: number | null;
  },
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO crypto_history (target_id, wallet_id, amount, date, source, source_log_id)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [input.targetId, input.walletId, input.amount, input.date, input.source, input.sourceLogId],
  );
  return result.lastInsertRowId;
}

export async function deleteCryptoEvent(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM crypto_history WHERE id = ?;', [id]);
}

export async function listCryptoHistory(
  db: SQLiteDatabase,
  targetId: number,
  limit = 300,
): Promise<CryptoHistoryWithLog[]> {
  const rows = await db.getAllAsync<CryptoRow & { log_id: number | null; w_display: string | null } & Partial<LogRow>>(
    `SELECT
       ch.id, ch.target_id, ch.wallet_id, ch.amount, ch.date, ch.source, ch.source_log_id,
       w.display_address AS w_display,
       l.id AS log_id, l.raw_log, l.timestamp, l.raw_timestamp, l.event_type,
       l.crypto_extracted, l.extracted_ip_count, l.extracted_wallet_count,
       l.extracted_ips, l.extracted_wallets, l.extracted_software,
       l.extracted_software_level, l.parser_confidence, l.imported_at, l.hash
     FROM crypto_history ch
     LEFT JOIN wallets w ON w.id = ch.wallet_id
     LEFT JOIN logs    l ON l.id = ch.source_log_id
     WHERE ch.target_id = ?
     ORDER BY ch.date DESC
     LIMIT ?;`,
    [targetId, limit],
  );

  return rows.map((r) => ({
    ...mapCrypto(r),
    walletDisplayAddress: r.w_display,
    log:
      r.log_id != null
        ? mapLog({
            id: r.log_id,
            target_id: r.target_id,
            raw_log: r.raw_log!,
            timestamp: r.timestamp!,
            raw_timestamp: r.raw_timestamp ?? null,
            event_type: r.event_type!,
            crypto_extracted: r.crypto_extracted!,
            extracted_ip_count: r.extracted_ip_count!,
            extracted_wallet_count: r.extracted_wallet_count!,
            extracted_ips: r.extracted_ips!,
            extracted_wallets: r.extracted_wallets!,
            extracted_software: r.extracted_software ?? null,
            extracted_software_level: r.extracted_software_level ?? null,
            parser_confidence: r.parser_confidence!,
            imported_at: r.imported_at!,
            hash: r.hash!,
          })
        : null,
  }));
}

interface TotalsRow {
  extracted_total: number | null;
  today: number | null;
  d7: number | null;
  d30: number | null;
  cnt: number;
  first_at: number | null;
  last_at: number | null;
  active_days: number | null;
}

const EMPTY_TOTALS: CryptoTotals = {
  extractedTotal: 0,
  extractedToday: 0,
  extracted7Days: 0,
  extracted30Days: 0,
  eventCount: 0,
  firstExtraction: null,
  lastExtraction: null,
  averagePerActiveDay: 0,
};

const TOTALS_SELECT = `
  SELECT
    SUM(amount)                                        AS extracted_total,
    SUM(CASE WHEN date >= ? THEN amount ELSE 0 END)    AS today,
    SUM(CASE WHEN date >= ? THEN amount ELSE 0 END)    AS d7,
    SUM(CASE WHEN date >= ? THEN amount ELSE 0 END)    AS d30,
    COUNT(*)                                           AS cnt,
    MIN(date)                                          AS first_at,
    MAX(date)                                          AS last_at,
    COUNT(DISTINCT CAST(date / 86400000 AS INTEGER))   AS active_days
  FROM crypto_history
`;

function buildTotals(row: TotalsRow | null): CryptoTotals {
  if (!row || row.cnt === 0) return EMPTY_TOTALS;
  const total = row.extracted_total ?? 0;
  const activeDays = Math.max(1, row.active_days ?? 1);
  return {
    extractedTotal: total,
    extractedToday: row.today ?? 0,
    extracted7Days: row.d7 ?? 0,
    extracted30Days: row.d30 ?? 0,
    eventCount: row.cnt,
    firstExtraction: row.first_at,
    lastExtraction: row.last_at,
    averagePerActiveDay: total / activeDays,
  };
}

/** "Active days" counts only days with an extraction, so idle stretches don't dilute the average. */
export async function getCryptoTotals(
  db: SQLiteDatabase,
  targetId: number,
  now: Date = new Date(),
): Promise<CryptoTotals> {
  const row = await db.getFirstAsync<TotalsRow>(`${TOTALS_SELECT} WHERE target_id = ?;`, [
    startOfToday(now),
    daysAgo(7, now),
    daysAgo(30, now),
    targetId,
  ]);
  return buildTotals(row);
}

export async function getGlobalCryptoTotals(
  db: SQLiteDatabase,
  now: Date = new Date(),
): Promise<CryptoTotals> {
  const row = await db.getFirstAsync<TotalsRow>(`${TOTALS_SELECT};`, [
    startOfToday(now),
    daysAgo(7, now),
    daysAgo(30, now),
  ]);
  return buildTotals(row);
}

export interface DailyCrypto {
  /** Midnight of the day, local time. */
  day: number;
  amount: number;
}

/** Grouped in JS so day boundaries follow the phone's timezone — SQL would bucket by UTC. */
export async function getDailyCrypto(
  db: SQLiteDatabase,
  options: { targetId?: number; days?: number; now?: Date } = {},
): Promise<DailyCrypto[]> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const since = daysAgo(days - 1, now);

  const rows = options.targetId
    ? await db.getAllAsync<{ date: number; amount: number }>(
        'SELECT date, amount FROM crypto_history WHERE target_id = ? AND date >= ?;',
        [options.targetId, since],
      )
    : await db.getAllAsync<{ date: number; amount: number }>(
        'SELECT date, amount FROM crypto_history WHERE date >= ?;',
        [since],
      );

  // Pre-fill every day at zero so the chart has no gaps.
  const buckets = new Map<number, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    buckets.set(d.getTime(), 0);
  }

  for (const row of rows) {
    const d = new Date(row.date);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (buckets.has(key)) buckets.set(key, buckets.get(key)! + row.amount);
  }

  return [...buckets.entries()]
    .map(([day, amount]) => ({ day, amount }))
    .sort((a, b) => a.day - b.day);
}
