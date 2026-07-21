// Recommends what to upload to a target. Rules apply top to bottom, first match
// wins — the order encodes the priorities (rich+alive beats the spam gap, the
// gap beats a mediocre score), so don't reorder without being asked.

import { yieldTierFor } from './valueScale';
import type { ActivityState } from '@/db/types';

export const RECOMMENDATIONS = ['SIPHON', 'SPAM', 'VIRUS', 'SKIP'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export interface RecommendationInput {
  level: number;
  /** The player's own device level, from settings. 0 means "not set". */
  userLevel: number;
  activity: ActivityState;
  /** Potential score, 0-100. */
  score: number;
  /** Crypto extracted per active day. */
  ratePerActiveDay: number;
  device: string | null;
}

export interface RecommendationResult {
  action: Recommendation;
  reason: string;
  /** targetLevel - userLevel. */
  levelDelta: number;
  /** True when the level gap alone makes spam worthwhile. */
  spamGap: boolean;
  /** True when this target pays out well for its level. */
  rich: boolean;
}

/** Tiers that count as a target worth siphoning rather than merely poking. */
const RICH_TIERS = new Set(['HIGH', 'ULTRA', 'GODLY']);

/** How far below you a target must be before spam pays. */
const SPAM_GAP_BELOW = -9;

/** How far above you a target must be before spam pays. */
const SPAM_GAP_ABOVE = 10;

/** A score at or above this is worth a virus even with nothing else going for it. */
const VIRUS_SCORE = 35;

export function recommendAction(input: RecommendationInput): RecommendationResult {
  const { level, userLevel, activity, score, ratePerActiveDay, device } = input;

  // "Rich" is measured on extraction per active day, not last-seen holdings —
  // a stale observation must not recommend siphoning an empty target forever.
  const tier = yieldTierFor(level, ratePerActiveDay);
  const rich = tier !== null && RICH_TIERS.has(tier);

  // userLevel 0 means unset, so the gap can't be evaluated; skip spam rather than guess.
  const levelDelta = level - userLevel;
  const spamGap = userLevel > 0 && (levelDelta <= SPAM_GAP_BELOW || levelDelta >= SPAM_GAP_ABOVE);

  const noLevelNote =
    userLevel === 0 ? ' Set your own level in Settings to check the spam level gap.' : '';

  const result = (action: Recommendation, reason: string): RecommendationResult => ({
    action,
    reason,
    levelDelta,
    spamGap,
    rich,
  });

  if (rich && (activity === 'ACTIVE' || activity === 'SEMI_ACTIVE')) {
    return result(
      'SIPHON',
      `${tier} yield at ${Math.round(ratePerActiveDay)} crypto per active day and still ` +
        `${activity === 'ACTIVE' ? 'active' : 'semi-active'} — worth a siphon.`,
    );
  }

  if (!rich && spamGap) {
    return result(
      'SPAM',
      levelDelta >= SPAM_GAP_ABOVE
        ? `Level ${level} against your ${userLevel}, ${levelDelta} above you — spam pays at that gap.`
        : `Level ${level} against your ${userLevel}, ${Math.abs(levelDelta)} below you — spam pays at that gap.`,
    );
  }

  if (score >= VIRUS_SCORE) {
    return result('VIRUS', `Score of ${Math.round(score)} is worth a virus.${noLevelNote}`);
  }

  const deviceNote = device ? ` Running a ${device}.` : '';
  return result(
    'SKIP',
    `Low score, not worth a virus until something new turns up.${deviceNote}${noLevelNote}`,
  );
}
