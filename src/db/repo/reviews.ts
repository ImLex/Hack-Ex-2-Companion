// Review inbox: anything the parser can't place is stored and queued, never guessed at or dropped.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { Review, ReviewKind, ReviewStatus } from '../types';

interface ReviewRow {
  id: number;
  target_id: number | null;
  log_id: number | null;
  kind: string;
  reason: string;
  payload: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

const mapReview = (r: ReviewRow): Review => ({
  id: r.id,
  targetId: r.target_id,
  logId: r.log_id,
  kind: r.kind as ReviewKind,
  reason: r.reason,
  payload: r.payload,
  status: r.status as ReviewStatus,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

export interface CreateReviewInput {
  kind: ReviewKind;
  reason: string;
  targetId?: number | null;
  logId?: number | null;
  payload?: unknown;
}

export async function createReview(
  db: SQLiteDatabase,
  input: CreateReviewInput,
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO reviews (target_id, log_id, kind, reason, payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?);`,
    [
      input.targetId ?? null,
      input.logId ?? null,
      input.kind,
      input.reason,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      Date.now(),
    ],
  );
  return result.lastInsertRowId;
}

export async function listOpenReviews(db: SQLiteDatabase, limit = 300): Promise<Review[]> {
  const rows = await db.getAllAsync<ReviewRow>(
    "SELECT * FROM reviews WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT ?;",
    [limit],
  );
  return rows.map(mapReview);
}

export async function listReviewsForTarget(
  db: SQLiteDatabase,
  targetId: number,
): Promise<Review[]> {
  const rows = await db.getAllAsync<ReviewRow>(
    'SELECT * FROM reviews WHERE target_id = ? ORDER BY created_at DESC;',
    [targetId],
  );
  return rows.map(mapReview);
}

export async function countOpenReviews(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reviews WHERE status = 'OPEN';",
  );
  return row?.n ?? 0;
}

export async function setReviewStatus(
  db: SQLiteDatabase,
  reviewId: number,
  status: ReviewStatus,
): Promise<void> {
  await db.runAsync('UPDATE reviews SET status = ?, resolved_at = ? WHERE id = ?;', [
    status,
    status === 'OPEN' ? null : Date.now(),
    reviewId,
  ]);
}

export async function resolveReviewsForWallet(
  db: SQLiteDatabase,
  displayAddress: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE reviews
     SET status = 'RESOLVED', resolved_at = ?
     WHERE status = 'OPEN'
       AND kind = 'UNRESOLVED_WALLET'
       AND payload LIKE ?;`,
    [Date.now(), `%${displayAddress}%`],
  );
}

export async function resolveReviewsForIp(
  db: SQLiteDatabase,
  address: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE reviews
     SET status = 'RESOLVED', resolved_at = ?
     WHERE status = 'OPEN'
       AND kind = 'UNRESOLVED_IP'
       AND payload LIKE ?;`,
    [Date.now(), `%"${address}"%`],
  );
}

export async function deleteReview(db: SQLiteDatabase, reviewId: number): Promise<void> {
  await db.runAsync('DELETE FROM reviews WHERE id = ?;', [reviewId]);
}

export async function clearResolvedReviews(db: SQLiteDatabase): Promise<number> {
  const result = await db.runAsync("DELETE FROM reviews WHERE status != 'OPEN';");
  return result.changes;
}

/** Returns null rather than throwing on bad payload JSON. */
export function parseReviewPayload<T = Record<string, unknown>>(review: Review): T | null {
  if (!review.payload) return null;
  try {
    return JSON.parse(review.payload) as T;
  } catch {
    return null;
  }
}
