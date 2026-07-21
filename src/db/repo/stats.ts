import type { SQLiteDatabase } from 'expo-sqlite';
import type { ActivityState, CryptoTotals, TargetSummary } from '../types';
import { getDailyCrypto, getGlobalCryptoTotals, type DailyCrypto } from './logs';
import { listTargetSummaries } from './targets';
import { countOpenReviews } from './reviews';

export interface DashboardStats {
  targetCount: number;
  activityCounts: Record<ActivityState, number>;
  totals: CryptoTotals;
  daily: DailyCrypto[];
  topTargets: TargetSummary[];
  /** Most earned, all time. */
  topEarners: TargetSummary[];
  openReviews: number;
  unassignedWallets: number;
  unassignedLogs: number;
  ipCount: number;
  walletCount: number;
  logCount: number;
  softwareCount: number;
  /** Timestamp of the most recent log line. */
  lastActivityAt: number | null;
}

export async function getDashboardStats(
  db: SQLiteDatabase,
  now: Date = new Date(),
): Promise<DashboardStats> {
  const [counts, totals, daily, topTargets, topEarners, openReviews] = await Promise.all([
    getCounts(db),
    getGlobalCryptoTotals(db, now),
    getDailyCrypto(db, { days: 30, now }),
    listTargetSummaries(db, { sort: 'score', limit: 5 }),
    listTargetSummaries(db, { sort: 'extracted', limit: 5 }),
    countOpenReviews(db),
  ]);

  return {
    ...counts,
    totals,
    daily,
    topTargets,
    topEarners: topEarners.filter((t) => t.extractedTotal > 0),
    openReviews,
  };
}

interface CountsResult {
  targetCount: number;
  activityCounts: Record<ActivityState, number>;
  unassignedWallets: number;
  unassignedLogs: number;
  ipCount: number;
  walletCount: number;
  logCount: number;
  softwareCount: number;
  lastActivityAt: number | null;
}

/** All the simple counts in one round trip. */
async function getCounts(db: SQLiteDatabase): Promise<CountsResult> {
  const row = await db.getFirstAsync<{
    target_count: number;
    active: number;
    semi_active: number;
    inactive: number;
    review: number;
    unassigned_wallets: number;
    unassigned_logs: number;
    ip_count: number;
    wallet_count: number;
    log_count: number;
    software_count: number;
    last_activity_at: number | null;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM targets)                                          AS target_count,
      (SELECT COUNT(*) FROM target_info WHERE activity = 'ACTIVE')            AS active,
      (SELECT COUNT(*) FROM target_info WHERE activity = 'SEMI_ACTIVE')       AS semi_active,
      (SELECT COUNT(*) FROM target_info WHERE activity = 'INACTIVE')          AS inactive,
      (SELECT COUNT(*) FROM target_info WHERE activity = 'REVIEW')            AS review,
      (SELECT COUNT(*) FROM wallets WHERE target_id IS NULL)                  AS unassigned_wallets,
      (SELECT COUNT(*) FROM logs    WHERE target_id IS NULL)                  AS unassigned_logs,
      (SELECT COUNT(*) FROM ip_relations)                                     AS ip_count,
      (SELECT COUNT(*) FROM wallets)                                          AS wallet_count,
      (SELECT COUNT(*) FROM logs)                                             AS log_count,
      (SELECT COUNT(*) FROM installed_software)                               AS software_count,
      (SELECT MAX(timestamp) FROM logs)                                       AS last_activity_at;
  `);

  return {
    targetCount: row?.target_count ?? 0,
    activityCounts: {
      ACTIVE: row?.active ?? 0,
      SEMI_ACTIVE: row?.semi_active ?? 0,
      INACTIVE: row?.inactive ?? 0,
      REVIEW: row?.review ?? 0,
    },
    unassignedWallets: row?.unassigned_wallets ?? 0,
    unassignedLogs: row?.unassigned_logs ?? 0,
    ipCount: row?.ip_count ?? 0,
    walletCount: row?.wallet_count ?? 0,
    logCount: row?.log_count ?? 0,
    softwareCount: row?.software_count ?? 0,
    lastActivityAt: row?.last_activity_at ?? null,
  };
}

export interface EventTypeCount {
  eventType: string;
  count: number;
}

export async function getEventTypeCounts(db: SQLiteDatabase): Promise<EventTypeCount[]> {
  const rows = await db.getAllAsync<{ event_type: string; n: number }>(
    'SELECT event_type, COUNT(*) AS n FROM logs GROUP BY event_type ORDER BY n DESC;',
  );
  return rows.map((r) => ({ eventType: r.event_type, count: r.n }));
}

export async function getSoftwareBreakdown(
  db: SQLiteDatabase,
): Promise<{ name: string; count: number; averageLevel: number; maxLevel: number }[]> {
  return db.getAllAsync<{ name: string; count: number; averageLevel: number; maxLevel: number }>(
    `SELECT s.name,
            COUNT(*)        AS count,
            AVG(ins.level)  AS averageLevel,
            MAX(ins.level)  AS maxLevel
     FROM installed_software ins
     JOIN software s ON s.id = ins.software_id
     GROUP BY s.id
     ORDER BY count DESC;`,
  );
}
