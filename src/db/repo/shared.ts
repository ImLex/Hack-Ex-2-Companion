const DAY_MS = 24 * 60 * 60 * 1000;

export const toDbBool = (value: boolean): number => (value ? 1 : 0);
export const fromDbBool = (value: number | null): boolean => value === 1;

/** Midnight today, local time. */
export function startOfToday(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function daysAgo(days: number, now: Date = new Date()): number {
  return now.getTime() - days * DAY_MS;
}

/** "?, ?, ?" for an IN (...) clause. */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

export function groupBy<T>(rows: T[], key: (row: T) => number | null): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const existing = map.get(k);
    if (existing) existing.push(row);
    else map.set(k, [row]);
  }
  return map;
}
