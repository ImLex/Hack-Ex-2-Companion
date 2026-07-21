// Design tokens. Nothing else should hard-code a colour.

import { Platform } from 'react-native';
import { deriveAccent } from './palette';
import type { ActivityState } from '@/db/types';
import type { Recommendation } from '@/logic/recommendation';
import type { TrendDirection } from '@/logic/trend';
import type { ValueTier } from '@/logic/valueScale';

// "monospace" only resolves on Android; on iOS it silently falls back to the
// proportional system font, so name Menlo explicitly.
const monoFontFamily = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const colors = {
  // Backgrounds, back to front.
  background: '#0E1116',
  surface: '#161B22',
  surfaceRaised: '#1C232C',
  surfaceHigh: '#232B36',
  border: '#2A333F',
  borderStrong: '#3A4553',

  // Text.
  text: '#E8EDF4',
  textMuted: '#9BA7B7',
  textFaint: '#6B7889',
  textInverse: '#0E1116',

  // Single accent, used for anything interactive.
  accent: '#3ED2D0',
  accentMuted: '#1F5C5E',
  accentText: '#0E1116',

  // Semantic colours.
  success: '#42C08A',
  warning: '#F5B841',
  danger: '#E5484D',
  info: '#4FA3E3',
  purple: '#C77DFF',
  orange: '#FF7A45',
  pink: '#FF5C8A',

  // Crypto figures always use this colour so they read as money at a glance.
  crypto: '#F5B841',
};

// The accent trio is the only mutable part of the palette: ThemeProvider
// mutates it in place, then re-renders the tree. Everything reads colors.*
// inline at render time, so no colour may be captured in a module-level
// StyleSheet.create entry.
export function applyAccent(themeHex: string): void {
  const derived = deriveAccent(themeHex);
  colors.accent = derived.accent;
  colors.accentMuted = derived.accentMuted;
  colors.accentText = derived.accentText;
}

// Deliberately separate from the UI palette: checked against the #161B22 chart
// surface for contrast (>3:1) and colourblind separation. Re-check if changing.
export const chartColors = {
  crypto: '#B8811C',
  positive: '#2E9E6E',
  neutral: '#3D86C9',
  grid: '#232B36',
  axis: '#3A4553',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  label: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  /** For IPs, wallets and raw log text. */
  mono: {
    fontSize: 13,
    fontWeight: '400' as const,
    fontFamily: monoFontFamily,
  },
} as const;

export const activityColor: Record<ActivityState, string> = {
  ACTIVE: colors.success,
  SEMI_ACTIVE: colors.warning,
  INACTIVE: colors.textFaint,
  REVIEW: colors.info,
};

export const activityLabel: Record<ActivityState, string> = {
  ACTIVE: 'Active',
  SEMI_ACTIVE: 'Semi active',
  INACTIVE: 'Inactive',
  REVIEW: 'Needs review',
};

export const tierColor: Record<ValueTier, string> = {
  LOW: colors.textFaint,
  MEDIUM: colors.info,
  HIGH: colors.success,
  ULTRA: colors.purple,
  GODLY: colors.crypto,
};

// SKIP reads as "Not worth it": the list is scanned mid-game, so the useful
// reading is the verdict, not the verb.
export const recommendationLabel: Record<Recommendation, string> = {
  SIPHON: 'Siphon',
  SPAM: 'Spam',
  VIRUS: 'Virus',
  SKIP: 'Not worth it',
};

// Siphon borrows the crypto colour — it means money out.
export const recommendationColor: Record<Recommendation, string> = {
  SIPHON: colors.crypto,
  SPAM: colors.orange,
  VIRUS: colors.purple,
  SKIP: colors.textFaint,
};

// Only DECLINING gets an alarming colour — a target drying up is the news.
export function trendColor(direction: TrendDirection): string {
  switch (direction) {
    case 'RISING':
      return colors.success;
    case 'DECLINING':
      return colors.danger;
    case 'STEADY':
      return colors.textMuted;
    default:
      return colors.textFaint;
  }
}

/** Bands match scoreBand() in potentialScore.ts. */
export function scoreColor(score: number): string {
  if (score >= 75) return colors.crypto;
  if (score >= 55) return colors.success;
  if (score >= 35) return colors.info;
  return colors.textFaint;
}

export function eventColor(eventType: string): string {
  switch (eventType) {
    case 'CRYPTO_STEAL':
    case 'CRYPTO_TRANSFER':
      return colors.crypto;
    case 'CRACK_SUCCESS':
    case 'FIREWALL_BYPASS':
      return colors.success;
    case 'CRACK_FAIL':
      return colors.danger;
    case 'UPLOAD_DONE':
      return colors.purple;
    case 'UPLOAD_START':
    case 'CRACK_START':
      return colors.textFaint;
    case 'ACCESS':
      return colors.info;
    default:
      return colors.textMuted;
  }
}

/** Turns ACTIVE_LIKE_THIS into "Active like this". */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
