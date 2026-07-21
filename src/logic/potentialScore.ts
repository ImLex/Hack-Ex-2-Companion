import { thresholdFor } from './valueScale';
import { deviceRank, deviceStrength, normaliseDevice } from './devices';
import type { ActivityState, InstalledSoftwareWithName, CryptoTotals } from '@/db/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScoreInputs {
  level: number;
  /** Crypto currently held, as last observed. */
  crypto: number;
  activity: ActivityState;
  totals: CryptoTotals;
  software: InstalledSoftwareWithName[];
  attackCount: number;
  dateAdded: number;
  device: string | null;
  /** The player's own level, for the spam level-gap. 0 when not set. */
  userLevel: number;
}

export interface ScoreComponent {
  key: string;
  label: string;
  /** 0-1, before weighting. */
  value: number;
  weight: number;
  detail: string;
}

export interface ScoreBreakdown {
  score: number;
  components: ScoreComponent[];
}

// Sum to exactly 1. Device gets 0.15 at holdings' expense: holdings go stale
// the moment the target spends them; the device never changes.
const WEIGHTS = {
  currentValue: 0.2,
  refillSpeed: 0.25,
  provenYield: 0.2,
  activity: 0.12,
  defences: 0.08,
  device: 0.15,
} as const;

// Rises fast then flattens, so one 20k-crypto outlier doesn't zero everyone else.
function saturate(value: number, midpoint: number): number {
  if (value <= 0 || midpoint <= 0) return 0;
  return value / (value + midpoint);
}

export function explainScore(input: ScoreInputs): ScoreBreakdown {
  const { level, crypto, activity, totals, software, attackCount, dateAdded, device } = input;
  const now = Date.now();

  // userLevel is deliberately not scored: the level gap is about what to upload
  // (recommendation.ts), not how good the target is.

  // Current value, measured against GODLY at the target's own level so low-level
  // targets aren't buried by level 30 ones.
  const godly = thresholdFor(level, 'GODLY');
  const currentValue = godly > 0 ? Math.min(1, crypto / godly) : 0;

  // Refill speed is the most useful signal: a fast refiller can be farmed repeatedly.
  const refillPerDay = totals.averagePerActiveDay;
  const refillReference = Math.max(godly * 0.5, 100);
  const refillSpeed = saturate(refillPerDay, refillReference);

  const provenYield = saturate(totals.extractedTotal, Math.max(godly, 500));

  const activityScores: Record<ActivityState, number> = {
    ACTIVE: 1,
    SEMI_ACTIVE: 0.7,
    REVIEW: 0.5,
    INACTIVE: 0.2,
  };
  const activityScore = activityScores[activity];

  // Inverted: light defences score high.
  const defensive = software.filter((s) => s.category === 'DEFENSIVE' && s.owner === 'TARGET');
  const highestDefence = defensive.reduce((max, s) => Math.max(max, s.level), 0);
  // Relative to the target's own level: a level 30 target with a level 5
  // firewall is soft, a level 5 target with one is not.
  const defenceRatio = level > 0 ? Math.min(1, highestDefence / level) : highestDefence > 0 ? 1 : 0;
  const defences = 1 - defenceRatio;

  // Device is the only component knowable before a target has ever been farmed.
  const deviceValue = deviceStrength(device);
  const rank = deviceRank(device);

  const components: ScoreComponent[] = [
    {
      key: 'currentValue',
      label: 'Current holdings',
      value: currentValue,
      weight: WEIGHTS.currentValue,
      detail:
        godly > 0
          ? `${Math.round(crypto)} crypto against a GODLY line of ${godly} at level ${level}`
          : 'Set a level to score holdings',
    },
    {
      key: 'refillSpeed',
      label: 'Refill speed',
      value: refillSpeed,
      weight: WEIGHTS.refillSpeed,
      detail:
        totals.eventCount > 0
          ? `${Math.round(refillPerDay)} crypto per active day`
          : 'No extractions recorded yet',
    },
    {
      key: 'provenYield',
      label: 'Proven yield',
      value: provenYield,
      weight: WEIGHTS.provenYield,
      detail: `${Math.round(totals.extractedTotal)} crypto extracted across ${totals.eventCount} events`,
    },
    {
      key: 'activity',
      label: 'Activity',
      value: activityScore,
      weight: WEIGHTS.activity,
      detail: activity.replace('_', ' ').toLowerCase(),
    },
    {
      key: 'defences',
      label: 'Soft defences',
      value: defences,
      weight: WEIGHTS.defences,
      detail:
        defensive.length > 0
          ? `Strongest defence is level ${highestDefence}`
          : 'No defensive software recorded',
    },
    {
      key: 'device',
      label: 'Device',
      value: deviceValue,
      weight: WEIGHTS.device,
      detail:
        rank !== null
          ? `${normaliseDevice(device)} is #${rank} of 12`
          : 'Device not recorded',
    },
  ];

  let score = components.reduce((sum, c) => sum + c.value * c.weight, 0) * 100;

  // A new target with no history is an unknown, not a bad target: nudge it toward
  // the middle, with the benefit of the doubt fading over two weeks.
  const isUnproven = totals.eventCount === 0 && attackCount === 0;
  if (isUnproven) {
    const ageDays = (now - dateAdded) / DAY_MS;
    const freshness = Math.max(0, 1 - ageDays / 14);
    score = score + (50 - score) * 0.35 * freshness;
  }

  return {
    score: Math.round(Math.min(100, Math.max(0, score)) * 10) / 10,
    components,
  };
}

export function calculatePotentialScore(input: ScoreInputs): number {
  return explainScore(input).score;
}

export function scoreBand(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 75) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}
