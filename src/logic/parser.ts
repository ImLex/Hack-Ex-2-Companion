// Turns raw Hack Ex log text ("[7-18 19:00] Stole 172 Crypto from hx84d9...762d")
// into structured events.

import type { EventType } from '@/db/types';
import { isFullWalletAddress, shortenWallet } from './wallets';

/** [7-18 19:00] at the start of a line. The game prints no year. */
const TIMESTAMP_RE = /^\s*\[\s*(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*\]\s*/;

/** An IPv4 address, with each octet checked to be 0-255. */
const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

// Either form the game prints: shortened (hx84d9...762d) or full once cracked
// (hxcf6f90f2f558f95bc581c9ed61173a).
const WALLET_RE = /\bhx[0-9a-fA-F]{2,}(?:\.{2,}[0-9a-fA-F]{2,})?\b/g;

/** Pulls out "Lv3 Siphon". */
const SOFTWARE_LEVEL_RE = /Lv\.?\s*(\d+)\s+([A-Za-z][A-Za-z\s]*?)(?=\s+(?:to|on|from|at)\b|$)/i;

interface Rule {
  id: string;
  eventType: EventType;
  /** Tested against the message with the timestamp removed. */
  pattern: RegExp;
  /** Shown in the import preview. */
  label: string;
  /** True when this event proves the target owns the named software. */
  provesTargetSoftware?: boolean;
  /** True when this event means you uploaded software onto the target. */
  provesMySoftware?: boolean;
}

// Order is significant: first match wins, so specific patterns go before general
// ones. Rules marked "not seen in samples" are best guesses that just never fire
// if the wording differs.
export const RULES: Rule[] = [
  // --- Password cracking (specific before general) ---
  {
    id: 'crack_fail',
    eventType: 'CRACK_FAIL',
    pattern: /^Failed to crack password on\b/i,
    label: 'Password crack failed',
    provesTargetSoftware: true,
  },
  {
    id: 'crack_start',
    eventType: 'CRACK_START',
    pattern: /^Cracking password on\b/i,
    label: 'Password crack started',
  },
  {
    id: 'crack_success',
    eventType: 'CRACK_SUCCESS',
    pattern: /^Cracked password on\b/i,
    label: 'Password cracked',
  },

  {
    id: 'firewall_bypassed',
    eventType: 'FIREWALL_BYPASS',
    pattern: /^Bypassed firewall on\b/i,
    label: 'Firewall bypassed',
    provesTargetSoftware: true,
  },
  {
    id: 'firewall_bypassing',
    eventType: 'FIREWALL_BYPASS',
    pattern: /^Bypassing firewall on\b/i,
    label: 'Bypassing firewall',
    provesTargetSoftware: true,
  },

  // --- Software uploads (in progress before completed) ---
  {
    id: 'upload_start',
    eventType: 'UPLOAD_START',
    pattern: /^Uploading\b.*\bto\b/i,
    label: 'Upload started',
  },
  {
    id: 'upload_done',
    eventType: 'UPLOAD_DONE',
    pattern: /^Uploaded\b.*\bto\b/i,
    label: 'Upload finished',
    provesMySoftware: true,
  },

  {
    id: 'access',
    eventType: 'ACCESS',
    pattern: /^Accessed device at\b/i,
    label: 'Device accessed',
  },

  {
    id: 'crypto_steal',
    eventType: 'CRYPTO_STEAL',
    pattern: /^Stole\s+[\d,.]+\s*Crypto\s+from\b/i,
    label: 'Crypto stolen',
  },
  {
    id: 'crypto_transfer',
    // Not seen in samples.
    eventType: 'CRYPTO_TRANSFER',
    pattern: /^Transferred\s+[\d,.]+\s*Crypto\b/i,
    label: 'Crypto transferred',
  },

  // --- Plausible messages not seen in samples ---
  {
    id: 'download',
    eventType: 'DOWNLOAD',
    pattern: /^Downloaded\b.*\bfrom\b/i,
    label: 'Software downloaded',
    provesTargetSoftware: true,
  },
  {
    id: 'scan',
    eventType: 'SCAN',
    pattern: /^(?:Scanned|Scanning)\b/i,
    label: 'Scan',
  },
];

export interface ParsedLine {
  raw: string;
  /** The line with the timestamp stripped off. */
  message: string;
  /** Exactly as printed, e.g. "7-18 19:00". */
  rawTimestamp: string | null;
  /** ms since epoch; the year is inferred since the game prints none. */
  timestamp: number;
  eventType: EventType;
  ruleId: string | null;
  ruleLabel: string;
  ips: string[];
  /**
   * Always the canonical shortened form (hx84d9...762d), whichever form the line
   * used, so a cracked wallet and its shortened form land on one DB row.
   */
  wallets: string[];
  /** Full-length addresses as printed; seeing one proves the wallet cracked. */
  fullWallets: string[];
  cryptoAmount: number;
  software: string | null;
  softwareLevel: number | null;
  provesTargetSoftware: boolean;
  provesMySoftware: boolean;
  /** 0-1. Below 0.5 the event goes to the review inbox instead of being applied. */
  confidence: number;
  /** Dedup fingerprint. */
  hash: string;
}

export interface ParseResult {
  lines: ParsedLine[];
  /** Lines that were blank or produced nothing at all. */
  skipped: string[];
  /** Duplicates within this same paste. */
  duplicatesInBatch: number;
}

/**
 * The game prints no year, so assume the most recent occurrence: a date that
 * would land in the future belongs to last year.
 */
export function resolveTimestamp(
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  now: Date = new Date(),
): number {
  const candidate = new Date(now.getFullYear(), month - 1, day, hour, minute, second, 0);
  // One day of slack absorbs clock differences between the game and the phone.
  const tolerance = 24 * 60 * 60 * 1000;
  if (candidate.getTime() - now.getTime() > tolerance) {
    candidate.setFullYear(now.getFullYear() - 1);
  }
  return candidate.getTime();
}

// djb2, with the length mixed in. Only used for dedup, so no need to be cryptographic.
function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `${hash.toString(16)}-${input.length.toString(16)}`;
}

function matchAll(text: string, re: RegExp): string[] {
  // The global regexes are module-level; reset lastIndex before reuse.
  re.lastIndex = 0;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[0]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return [...found];
}

/**
 * Returns null only for blank lines; unmatched lines come back as UNKNOWN with
 * low confidence so nothing is silently thrown away.
 */
export function parseLogLine(line: string, now: Date = new Date()): ParsedLine | null {
  const raw = line.trim();
  if (raw.length === 0) return null;

  let message = raw;
  let rawTimestamp: string | null = null;
  let timestamp = now.getTime();

  const tsMatch = raw.match(TIMESTAMP_RE);
  if (tsMatch) {
    const [, month, day, hour, minute, second] = tsMatch;
    rawTimestamp = `${month}-${day} ${hour}:${minute}`;
    timestamp = resolveTimestamp(
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? 0),
      now,
    );
    message = raw.slice(tsMatch[0].length).trim();
  }

  // Wallets are extracted first and removed from the text so a full-length
  // wallet address can't be mistaken for an IP.
  const rawWallets = matchAll(message, WALLET_RE);
  let ipSearchText = message;
  for (const wallet of rawWallets) {
    ipSearchText = ipSearchText.split(wallet).join(' ');
  }
  const ips = matchAll(ipSearchText, IP_RE);

  // Both printed forms collapse onto the shortened one (the DB key); full
  // versions are kept separately as proof the wallet is cracked.
  const fullWallets = rawWallets.filter(isFullWalletAddress);
  const wallets = [...new Set(rawWallets.map(shortenWallet))];

  const rule = RULES.find((r) => r.pattern.test(message)) ?? null;
  const eventType: EventType = rule?.eventType ?? 'UNKNOWN';

  let cryptoAmount = 0;
  if (eventType === 'CRYPTO_STEAL' || eventType === 'CRYPTO_TRANSFER') {
    const amountMatch = message.match(/([\d,]+(?:\.\d+)?)\s*Crypto\b/i);
    if (amountMatch) {
      cryptoAmount = Number(amountMatch[1].replace(/,/g, '')) || 0;
    }
  }

  let software: string | null = null;
  let softwareLevel: number | null = null;
  if (
    eventType === 'UPLOAD_START' ||
    eventType === 'UPLOAD_DONE' ||
    eventType === 'DOWNLOAD'
  ) {
    const swMatch = message.match(SOFTWARE_LEVEL_RE);
    if (swMatch) {
      softwareLevel = Number(swMatch[1]);
      software = swMatch[2].trim();
    }
  } else if (eventType === 'FIREWALL_BYPASS') {
    software = 'Firewall';
  } else if (eventType === 'CRACK_FAIL' || eventType === 'CRACK_START') {
    // A password that resists cracking implies a Password Encryptor is present.
    software = eventType === 'CRACK_FAIL' ? 'Password Encryptor' : null;
  }

  const confidence = scoreConfidence({
    hasTimestamp: rawTimestamp !== null,
    hasRule: rule !== null,
    eventType,
    ipCount: ips.length,
    walletCount: wallets.length,
    cryptoAmount,
    software,
    softwareLevel,
  });

  return {
    raw,
    message,
    rawTimestamp,
    timestamp,
    eventType,
    ruleId: rule?.id ?? null,
    ruleLabel: rule?.label ?? 'Unrecognised line',
    ips,
    wallets,
    fullWallets,
    cryptoAmount,
    software,
    softwareLevel,
    provesTargetSoftware: rule?.provesTargetSoftware ?? false,
    provesMySoftware: rule?.provesMySoftware ?? false,
    confidence,
    // Printed timestamp + message: identical events in the same minute dedupe,
    // which is what re-pasting overlapping log dumps wants.
    hash: hashString(`${rawTimestamp ?? ''}|${message.toLowerCase()}`),
  };
}

interface ConfidenceInputs {
  hasTimestamp: boolean;
  hasRule: boolean;
  eventType: EventType;
  ipCount: number;
  walletCount: number;
  cryptoAmount: number;
  software: string | null;
  softwareLevel: number | null;
}

function scoreConfidence(input: ConfidenceInputs): number {
  if (!input.hasRule) {
    // Unrecognised wording, but it still contained something useful.
    if (input.ipCount > 0 || input.walletCount > 0) return 0.4;
    return 0.1;
  }

  let score = 0.7;
  if (input.hasTimestamp) score += 0.15;

  switch (input.eventType) {
    case 'CRYPTO_STEAL':
    case 'CRYPTO_TRANSFER':
      // Needs an amount and a wallet to be actionable.
      if (input.cryptoAmount > 0) score += 0.1;
      else score -= 0.35;
      if (input.walletCount > 0) score += 0.05;
      else score -= 0.2;
      break;

    case 'UPLOAD_START':
    case 'UPLOAD_DONE':
    case 'DOWNLOAD':
      if (input.ipCount > 0) score += 0.05;
      else score -= 0.3;
      if (input.software && input.softwareLevel !== null) score += 0.1;
      else score -= 0.1;
      break;

    default:
      // Everything else is an IP-based event.
      if (input.ipCount > 0) score += 0.15;
      else score -= 0.35;
      break;
  }

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

/**
 * Duplicates within the paste collapse here; duplicates against the database
 * are handled at insert time by the UNIQUE hash.
 */
export function parseLogText(text: string, now: Date = new Date()): ParseResult {
  const lines: ParsedLine[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let duplicatesInBatch = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const parsed = parseLogLine(rawLine, now);
    if (!parsed) continue;

    if (parsed.confidence <= 0.1 && parsed.ips.length === 0 && parsed.wallets.length === 0) {
      skipped.push(parsed.raw);
      continue;
    }

    if (seen.has(parsed.hash)) {
      duplicatesInBatch++;
      continue;
    }
    seen.add(parsed.hash);
    lines.push(parsed);
  }

  // Oldest first; game logs print newest first.
  lines.sort((a, b) => a.timestamp - b.timestamp);

  return { lines, skipped, duplicatesInBatch };
}

export function summariseParse(lines: ParsedLine[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const line of lines) {
    summary[line.eventType] = (summary[line.eventType] ?? 0) + 1;
  }
  return summary;
}
