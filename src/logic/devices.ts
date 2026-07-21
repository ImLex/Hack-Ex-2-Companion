// The Hack Ex device ladder; a target's position on it feeds the potential score.

/** Weakest first. Index + 1 is the device's rank. */
export const DEVICES = [
  'Raider',
  'Raider II',
  'Raider III',
  'Bolt',
  'Bolt II',
  'Bolt III',
  'Nova',
  'Nova II',
  'Nova III',
  'Nova S',
  'Nova X',
  'Nova Ultra',
] as const;

export type DeviceName = (typeof DEVICES)[number];

const BY_LOWER_NAME = new Map<string, { name: DeviceName; rank: number }>(
  DEVICES.map((name, index) => [name.toLowerCase(), { name, rank: index + 1 }]),
);

function lookup(device: string | null | undefined) {
  if (device == null) return null;
  const cleaned = device.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) return null;
  return BY_LOWER_NAME.get(cleaned.toLowerCase()) ?? null;
}

/** 1 (Raider) to 12 (Nova Ultra); null for unknown, so "no device" is distinct from "weakest". */
export function deviceRank(device: string | null | undefined): number | null {
  return lookup(device)?.rank ?? null;
}

/** Canonical casing for known devices; unrecognised free text survives as typed. */
export function normaliseDevice(device: string | null | undefined): string | null {
  const known = lookup(device);
  if (known) return known.name;
  const cleaned = device?.trim().replace(/\s+/g, ' ') ?? '';
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * 0-1 across the ladder. Unknown devices score a neutral 0.5, not 0 — scoring
 * them at zero would bury exactly the un-inspected targets worth looking at.
 */
export function deviceStrength(device: string | null | undefined): number {
  const rank = deviceRank(device);
  if (rank === null) return 0.5;
  if (DEVICES.length < 2) return 1;
  return (rank - 1) / (DEVICES.length - 1);
}
