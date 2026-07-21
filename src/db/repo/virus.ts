// Your own virus deployments (spam + siphon) and each panel's summary numbers.

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from './settings';

export type VirusKind = 'SPAM' | 'SIPHON';

const SUMMARY_KEYS: Record<VirusKind, string> = {
  SPAM: 'spam.summary',
  SIPHON: 'siphon.summary',
};

export interface VirusDeploymentInput {
  address: string;
  level: number | null;
  /** Spam only: crypto per hour. */
  ratePerHour: number | null;
  /** Siphon only: skim percentage. */
  percent: number | null;
  earned: number;
  /** Fractional — the game shows siphon ages down to the hour. */
  ageDays: number | null;
}

export interface VirusDeployment extends VirusDeploymentInput {
  id: number;
  kind: VirusKind;
  active: boolean;
  firstSeen: number;
  lastSeen: number;
  targetId: number | null;
  targetName: string | null;
}

export interface SpamSummary {
  kind: 'SPAM';
  deployed: number | null;
  slotsUsed: number | null;
  slotsTotal: number | null;
  ratePerHour: number | null;
  dailyRate: number | null;
  botnet: string | null;
  feePercent: number | null;
  totalEarned: number | null;
  dailyFees: number | null;
  capturedAt: number;
}

export interface SiphonSummary {
  kind: 'SIPHON';
  deployed: number | null;
  totalSiphoned: number | null;
  capturedAt: number;
}

/**
 * Each panel always shows its complete list, so anything of this kind not in
 * the capture is no longer deployed and goes inactive.
 */
export async function syncVirusDeployments(
  db: SQLiteDatabase,
  kind: VirusKind,
  rows: VirusDeploymentInput[],
  capturedAt: number,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO virus_deployments
           (kind, address, level, rate_per_hour, percent, earned, age_days, active, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(kind, address) DO UPDATE SET
           level         = excluded.level,
           rate_per_hour = excluded.rate_per_hour,
           percent       = excluded.percent,
           earned        = excluded.earned,
           age_days      = excluded.age_days,
           active        = 1,
           last_seen     = excluded.last_seen;`,
        [
          kind,
          row.address,
          row.level,
          row.ratePerHour,
          row.percent,
          row.earned,
          row.ageDays,
          capturedAt,
          capturedAt,
        ],
      );
    }

    const placeholders = rows.map(() => '?').join(', ');
    await db.runAsync(
      rows.length > 0
        ? `UPDATE virus_deployments SET active = 0 WHERE kind = ? AND address NOT IN (${placeholders});`
        : 'UPDATE virus_deployments SET active = 0 WHERE kind = ?;',
      [kind, ...rows.map((row) => row.address)],
    );
  });
}

/** Active first, best earners on top, then the dead ones by last sighting. */
export async function listVirusDeployments(
  db: SQLiteDatabase,
  kind: VirusKind,
): Promise<VirusDeployment[]> {
  const rows = await db.getAllAsync<{
    id: number;
    kind: string;
    address: string;
    level: number | null;
    rate_per_hour: number | null;
    percent: number | null;
    earned: number;
    age_days: number | null;
    active: number;
    first_seen: number;
    last_seen: number;
    target_id: number | null;
    target_name: string | null;
  }>(
    `
    SELECT vd.*, ip.target_id, t.name AS target_name
      FROM virus_deployments vd
      LEFT JOIN ip_relations ip ON ip.address = vd.address
      LEFT JOIN targets t ON t.id = ip.target_id
     WHERE vd.kind = ?
     ORDER BY vd.active DESC, vd.earned DESC, vd.last_seen DESC;
  `,
    [kind],
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as VirusKind,
    address: row.address,
    level: row.level,
    ratePerHour: row.rate_per_hour,
    percent: row.percent,
    earned: row.earned,
    ageDays: row.age_days,
    active: row.active === 1,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    targetId: row.target_id,
    targetName: row.target_name,
  }));
}

async function getSummary<T>(db: SQLiteDatabase, kind: VirusKind): Promise<T | null> {
  const raw = await getSetting(db, SUMMARY_KEYS[kind]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const getSpamSummary = (db: SQLiteDatabase) => getSummary<SpamSummary>(db, 'SPAM');
export const getSiphonSummary = (db: SQLiteDatabase) => getSummary<SiphonSummary>(db, 'SIPHON');

export async function setVirusSummary(
  db: SQLiteDatabase,
  summary: SpamSummary | SiphonSummary,
): Promise<void> {
  await setSetting(db, SUMMARY_KEYS[summary.kind], JSON.stringify(summary));
}
