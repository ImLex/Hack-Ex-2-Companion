// Seeded via INSERT OR IGNORE on every launch — safe to append to at any time.

import type { SoftwareCategory, TagCategory } from './types';

export interface SeedSoftware {
  name: string;
  category: SoftwareCategory;
}

/**
 * In-game order, used verbatim as the display order for installed-software
 * cards (see SOFTWARE_ORDER) — do not sort by name or category.
 */
export const SEED_SOFTWARE: SeedSoftware[] = [
  { name: 'Antivirus', category: 'DEFENSIVE' },
  { name: 'Spam', category: 'OFFENSIVE' },
  { name: 'Rootkit', category: 'OFFENSIVE' },
  { name: 'Firewall', category: 'DEFENSIVE' },
  { name: 'Bypasser', category: 'OFFENSIVE' },
  { name: 'Password Cracker', category: 'OFFENSIVE' },
  { name: 'Password Encryptor', category: 'DEFENSIVE' },
  { name: 'Proxy', category: 'DEFENSIVE' },
  { name: 'Trace', category: 'DEFENSIVE' },
  { name: 'Siphon', category: 'OFFENSIVE' },
];

export const SOFTWARE_ORDER: string[] = SEED_SOFTWARE.map((s) => s.name);

/** Built once — looked up per row when sorting. */
const SOFTWARE_ORDER_INDEX = new Map<string, number>(
  SOFTWARE_ORDER.map((name, index) => [name.toLowerCase(), index]),
);

/** Position in SOFTWARE_ORDER, case-insensitive. Unknown (parser-invented) names sort last. */
export function softwareSortIndex(name: string): number {
  return SOFTWARE_ORDER_INDEX.get(name.trim().toLowerCase()) ?? SOFTWARE_ORDER.length;
}

export interface SeedTag {
  name: string;
  category: TagCategory;
  color: string;
}

export const SEED_TAGS: SeedTag[] = [
  // Value tiers — line up with the level scaling in src/logic/valueScale.ts
  { name: 'LOW', category: 'VALUE', color: '#8A93A0' },
  { name: 'MEDIUM', category: 'VALUE', color: '#4FA3E3' },
  { name: 'HIGH', category: 'VALUE', color: '#42C08A' },
  { name: 'ULTRA', category: 'VALUE', color: '#C77DFF' },
  { name: 'GODLY', category: 'VALUE', color: '#F5B841' },
  { name: '10K+', category: 'VALUE', color: '#FF7A45' },
  { name: 'TARGETTED', category: 'VALUE', color: '#FF5C8A' },
  { name: 'LOW_CRYPTO', category: 'VALUE', color: '#6B7280' },
  { name: 'HIGH_CRYPTO', category: 'VALUE', color: '#F5B841' },

  // Activity
  { name: 'ACTIVE', category: 'ACTIVITY', color: '#42C08A' },
  { name: 'SEMI_ACTIVE', category: 'ACTIVITY', color: '#F5B841' },
  { name: 'INACTIVE', category: 'ACTIVITY', color: '#6B7280' },
  { name: 'REVIEW', category: 'ACTIVITY', color: '#4FA3E3' },
  { name: 'LONG_TERM', category: 'ACTIVITY', color: '#42C08A' },
  { name: 'SHORT_TERM', category: 'ACTIVITY', color: '#8A93A0' },

  // Priority
  { name: 'VIP', category: 'PRIORITY', color: '#F5B841' },
  { name: 'IMPORTANT', category: 'PRIORITY', color: '#FF7A45' },
  { name: 'FAVORITE', category: 'PRIORITY', color: '#FF5C8A' },
  { name: 'IGNORE', category: 'PRIORITY', color: '#6B7280' },
  { name: 'BLACKLIST', category: 'PRIORITY', color: '#E5484D' },
  { name: 'MANUAL', category: 'PRIORITY', color: '#8A93A0' },

  // Behaviour and defences
  { name: 'BANK', category: 'BEHAVIOUR', color: '#42C08A' },
  { name: 'SPAMMER', category: 'BEHAVIOUR', color: '#FF7A45' },
  { name: 'SAFE', category: 'BEHAVIOUR', color: '#42C08A' },
  { name: 'RISKY', category: 'BEHAVIOUR', color: '#E5484D' },
  { name: 'SIPHON', category: 'BEHAVIOUR', color: '#4FA3E3' },
  { name: 'ROOTKIT', category: 'BEHAVIOUR', color: '#C77DFF' },
  { name: 'FIREWALL', category: 'BEHAVIOUR', color: '#4FA3E3' },
  { name: 'PASSWORD', category: 'BEHAVIOUR', color: '#8A93A0' },
  { name: 'ENCRYPTED', category: 'BEHAVIOUR', color: '#C77DFF' },

  // Trend — applied/removed automatically by syncDerivedTags() in repo/targets.ts, never set by hand.
  { name: 'DECLINING', category: 'BEHAVIOUR', color: '#E5484D' },
  { name: 'RISING', category: 'BEHAVIOUR', color: '#42C08A' },
];
