// Is this target drying up? Two-block average rather than a regression: haul
// sizes are wildly noisy, samples are usually under twenty events, and the user
// can verify the number by eye against the on-screen crypto history.

export type TrendDirection = 'RISING' | 'STEADY' | 'DECLINING' | 'UNKNOWN';

export interface YieldTrend {
  /** -100 to 100. Negative means recent hauls are smaller than the baseline. */
  percent: number;
  direction: TrendDirection;
  recentAverage: number;
  baselineAverage: number;
  sampleSize: number;
  /** e.g. "last 4 hauls average 120 against 300 before that". */
  detail: string;
}

/** How many of the newest events count as "recent". */
const RECENT_WINDOW = 5;

/** How many events before those form the baseline. */
const BASELINE_WINDOW = 10;

/** Below this, UNKNOWN — too little data is not the same as no change. */
const MINIMUM_SAMPLE = 4;

/** How far the percentage must move before it is a direction and not noise. */
const DIRECTION_THRESHOLD = 10;

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Compares a target's most recent hauls against the ones before them. */
export function yieldTrend(history: { amount: number; date: number }[]): YieldTrend {
  const sampleSize = history.length;

  const unknown = (detail: string): YieldTrend => ({
    percent: 0,
    direction: 'UNKNOWN',
    recentAverage: 0,
    baselineAverage: 0,
    sampleSize,
    detail,
  });

  if (sampleSize < MINIMUM_SAMPLE) {
    return unknown(
      sampleSize === 0
        ? 'No hauls recorded yet'
        : `Only ${sampleSize} ${sampleSize === 1 ? 'haul' : 'hauls'} recorded, too few to call a trend`,
    );
  }

  // Newest first; the caller's ordering is not trusted.
  const sorted = [...history].sort((a, b) => b.date - a.date);
  const recent = sorted.slice(0, RECENT_WINDOW);
  const baseline = sorted.slice(RECENT_WINDOW, RECENT_WINDOW + BASELINE_WINDOW);

  if (baseline.length === 0) {
    return unknown('Not enough earlier hauls to compare against');
  }

  const recentAverage = average(recent.map((h) => h.amount));
  const baselineAverage = average(baseline.map((h) => h.amount));

  // Divide by at least 1 so a zero baseline can't produce Infinity.
  const raw = ((recentAverage - baselineAverage) / Math.max(baselineAverage, 1)) * 100;
  const percent = Math.round(clamp(raw, -100, 100));

  let direction: TrendDirection = 'STEADY';
  if (percent >= DIRECTION_THRESHOLD) direction = 'RISING';
  else if (percent <= -DIRECTION_THRESHOLD) direction = 'DECLINING';

  const detail =
    `last ${recent.length} ${recent.length === 1 ? 'haul averages' : 'hauls average'} ` +
    `${Math.round(recentAverage)} against ${Math.round(baselineAverage)} before that`;

  return { percent, direction, recentAverage, baselineAverage, sampleSize, detail };
}
