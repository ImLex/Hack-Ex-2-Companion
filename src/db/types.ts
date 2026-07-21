// Types mirror the tables one-to-one; the repos in src/db/repo translate snake_case to camelCase.

import type { ValueTier } from '@/logic/valueScale';
import type { TrendDirection } from '@/logic/trend';
import type { Recommendation } from '@/logic/recommendation';

/** Milliseconds since epoch. */
export type Timestamp = number;

export const ACTIVITY_STATES = ['ACTIVE', 'SEMI_ACTIVE', 'INACTIVE', 'REVIEW'] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];

export const IP_STATUSES = ['ACTIVE', 'DEAD', 'CHANGED', 'UNKNOWN'] as const;
export type IpStatus = (typeof IP_STATUSES)[number];

export const DATA_SOURCES = ['MANUAL', 'PARSER', 'IMPORT'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const SOFTWARE_OWNERS = ['TARGET', 'MINE'] as const;
export type SoftwareOwner = (typeof SOFTWARE_OWNERS)[number];

export const SOFTWARE_CATEGORIES = ['DEFENSIVE', 'OFFENSIVE', 'UTILITY'] as const;
export type SoftwareCategory = (typeof SOFTWARE_CATEGORIES)[number];

/** Keep in sync with src/logic/parser.ts. */
export const EVENT_TYPES = [
  'ACCESS',
  'CRACK_START',
  'CRACK_SUCCESS',
  'CRACK_FAIL',
  'FIREWALL_BYPASS',
  'UPLOAD_START',
  'UPLOAD_DONE',
  'CRYPTO_STEAL',
  'CRYPTO_TRANSFER',
  'DOWNLOAD',
  'SCAN',
  'UNKNOWN',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const CRYPTO_SOURCES = ['STEAL', 'SIPHON', 'BANK', 'TRANSFER', 'MANUAL'] as const;
export type CryptoSource = (typeof CRYPTO_SOURCES)[number];

export const REVIEW_KINDS = [
  'UNRESOLVED_IP',
  'UNRESOLVED_WALLET',
  'LOW_CONFIDENCE',
  'UNPARSED',
  'CONFLICT',
  'MANUAL',
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const REVIEW_STATUSES = ['OPEN', 'RESOLVED', 'IGNORED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const TAG_CATEGORIES = ['VALUE', 'ACTIVITY', 'PRIORITY', 'BEHAVIOUR', 'CUSTOM'] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

export interface Target {
  id: number;
  name: string;
  device: string | null;
  dateAdded: Timestamp;
  attackCount: number;
}

/**
 * Extracted-crypto totals are never stored here — they derive from crypto_history.
 * potentialScore IS stored because SQL sorts by it; it is recalculated on every relevant change.
 */
export interface TargetInfo {
  targetId: number;
  level: number;
  /** Crypto the target is currently holding, as last observed. */
  crypto: number;
  activity: ActivityState;
  potentialScore: number;
  notes: string;
  lastUpdated: Timestamp;
}

export interface IpRelation {
  id: number;
  targetId: number;
  address: string;
  status: IpStatus;
  foundFromLogId: number | null;
  source: DataSource;
  discoveredAt: Timestamp;
}

/** targetId is nullable: crypto log lines name a wallet but never an IP, so a wallet can be known before its owner. */
export interface Wallet {
  id: number;
  targetId: number | null;
  displayAddress: string;
  fullAddress: string | null;
  cracked: boolean;
  foundFromLogId: number | null;
  discoveredAt: Timestamp;
}

export interface LogRecord {
  id: number;
  targetId: number | null;
  rawLog: string;
  timestamp: Timestamp;
  /** As the game printed it, e.g. "7-18 19:00". */
  rawTimestamp: string | null;
  eventType: EventType;
  cryptoExtracted: number;
  extractedIpCount: number;
  extractedWalletCount: number;
  /** Comma-separated, display/search only; the real rows live in ip_relations. */
  extractedIps: string;
  extractedWallets: string;
  extractedSoftware: string | null;
  extractedSoftwareLevel: number | null;
  parserConfidence: number;
  importedAt: Timestamp;
  /** Line fingerprint; duplicates are skipped when logs are re-pasted. */
  hash: string;
}

export interface CryptoHistory {
  id: number;
  targetId: number | null;
  walletId: number | null;
  amount: number;
  date: Timestamp;
  source: CryptoSource;
  sourceLogId: number | null;
}

export interface CryptoHistoryWithLog extends CryptoHistory {
  log: LogRecord | null;
  walletDisplayAddress: string | null;
}

export interface Software {
  id: number;
  name: string;
  category: SoftwareCategory;
}

export interface InstalledSoftware {
  id: number;
  targetId: number;
  softwareId: number;
  level: number;
  owner: SoftwareOwner;
  source: DataSource;
  updatedAt: Timestamp;
}

export interface InstalledSoftwareWithName extends InstalledSoftware {
  name: string;
  category: SoftwareCategory;
}

export interface Tag {
  id: number;
  name: string;
  category: TagCategory;
  color: string | null;
  isSystem: boolean;
}

export interface Review {
  id: number;
  targetId: number | null;
  logId: number | null;
  kind: ReviewKind;
  reason: string;
  /** JSON blob of whatever the parser could not place. */
  payload: string | null;
  status: ReviewStatus;
  createdAt: Timestamp;
  resolvedAt: Timestamp | null;
}

/** Derived from crypto_history on read, never stored. */
export interface CryptoTotals {
  extractedTotal: number;
  extractedToday: number;
  extracted7Days: number;
  extracted30Days: number;
  eventCount: number;
  firstExtraction: Timestamp | null;
  lastExtraction: Timestamp | null;
  /** Average per day, counting only days that had extractions. */
  averagePerActiveDay: number;
}

export interface TargetWithDetails {
  target: Target;
  info: TargetInfo;
  totals: CryptoTotals;
  tags: Tag[];
  ips: IpRelation[];
  wallets: Wallet[];
  logs: LogRecord[];
  cryptoHistory: CryptoHistoryWithLog[];
  software: InstalledSoftwareWithName[];
  reviews: Review[];
}

/** List row. The last five fields are derived in listTargetSummaries() to avoid a query per row. */
export interface TargetSummary {
  id: number;
  name: string;
  device: string | null;
  level: number;
  crypto: number;
  activity: ActivityState;
  potentialScore: number;
  attackCount: number;
  dateAdded: Timestamp;
  extractedTotal: number;
  /** Most recently discovered bound IP; null when none are known. */
  ip: string | null;
  ipCount: number;
  walletCount: number;
  logCount: number;
  softwareCount: number;
  lastActivityAt: Timestamp | null;
  tags: Tag[];
  /** Crypto extracted per active day — what the value tags measure. */
  extractedPerActiveDay: number;
  yieldTier: ValueTier | null;
  trendPercent: number;
  trendDirection: TrendDirection;
  recommendation: Recommendation;
}
