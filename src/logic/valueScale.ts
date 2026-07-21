// Value tier thresholds scale linearly from 0 at level 0 to the level 30 anchors,
// per the spec's "LOW = level x 8.33, MEDIUM = LOW x 2, ..." formula.

export const VALUE_TIERS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA', 'GODLY'] as const;
export type ValueTier = (typeof VALUE_TIERS)[number];

/** The level the reference values are quoted at. */
const ANCHOR_LEVEL = 30;

/** Crypto value of each tier at ANCHOR_LEVEL. */
const ANCHOR_VALUES: Record<ValueTier, number> = {
  LOW: 250,
  MEDIUM: 500,
  HIGH: 1000,
  ULTRA: 1500,
  GODLY: 2500,
};

// 'floor' reproduces the spec's level 1, 10 and 30 example tables; its level 20
// table contradicts its own formula and would need 'ceil'.
const ROUNDING: 'floor' | 'ceil' | 'round' = 'floor';

function applyRounding(value: number): number {
  if (ROUNDING === 'ceil') return Math.ceil(value);
  if (ROUNDING === 'round') return Math.round(value);
  return Math.floor(value);
}

/** thresholdFor(30, 'GODLY') === 2500; thresholdFor(10, 'HIGH') === 333. */
export function thresholdFor(level: number, tier: ValueTier): number {
  const safeLevel = Math.max(0, level);
  return applyRounding((ANCHOR_VALUES[tier] / ANCHOR_LEVEL) * safeLevel);
}

export function thresholdsFor(level: number): Record<ValueTier, number> {
  return {
    LOW: thresholdFor(level, 'LOW'),
    MEDIUM: thresholdFor(level, 'MEDIUM'),
    HIGH: thresholdFor(level, 'HIGH'),
    ULTRA: thresholdFor(level, 'ULTRA'),
    GODLY: thresholdFor(level, 'GODLY'),
  };
}

/** Null when below even the LOW threshold. */
export function tierFor(level: number, crypto: number): ValueTier | null {
  for (let i = VALUE_TIERS.length - 1; i >= 0; i--) {
    const tier = VALUE_TIERS[i];
    const threshold = thresholdFor(level, tier);
    if (threshold > 0 && crypto >= threshold) return tier;
  }
  return null;
}

/**
 * The same scale read against extraction rate instead of holdings. The value
 * tags use this one: holdings go stale, and a target that holds 2000 but never
 * lets you have any is not GODLY.
 */
export function yieldTierFor(level: number, ratePerActiveDay: number): ValueTier | null {
  return tierFor(level, ratePerActiveDay);
}

/** 0-1 progress toward GODLY; drives the profile progress bar. */
export function tierProgress(level: number, crypto: number): number {
  const godly = thresholdFor(level, 'GODLY');
  if (godly <= 0) return 0;
  return Math.min(1, Math.max(0, crypto / godly));
}

/** True when a target holds enough to be worth a dedicated refill run. */
export function isTargettable(level: number, crypto: number): boolean {
  return crypto >= thresholdFor(level, 'ULTRA');
}

/** The spec's "10K+" bracket. */
export function isTenKPlus(level: number, crypto: number): boolean {
  const godly = thresholdFor(level, 'GODLY');
  return godly > 0 && crypto >= godly * 2;
}
