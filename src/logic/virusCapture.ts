// Reads the game's SPAM EARNINGS and SIPHON EARNINGS panels (APPS screen with
// the respective row expanded). The accessibility tree exposes the whole list
// even when it scrolls, so one snapshot is always the complete current state
// of every deployment of that kind.

import type { SQLiteDatabase } from 'expo-sqlite';
import {
  setVirusSummary,
  syncVirusDeployments,
  type SiphonSummary,
  type SpamSummary,
  type VirusDeploymentInput,
} from '@/db/repo/virus';

export interface SpamScreenData {
  summary: Omit<SpamSummary, 'capturedAt'>;
  rows: VirusDeploymentInput[];
}

export interface SiphonScreenData {
  summary: Omit<SiphonSummary, 'capturedAt'>;
  rows: VirusDeploymentInput[];
}

// Octets may be masked: "204.31.xxx.xxx". Fully masked rows are unusable —
// two of them cannot be told apart.
const ADDRESS_RE = /^(?:\d{1,3}|xxx)\.(?:\d{1,3}|xxx)\.(?:\d{1,3}|xxx)\.(?:\d{1,3}|xxx)$/;
const FULLY_MASKED = 'xxx.xxx.xxx.xxx';

function toNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(value) ? value : null;
}

function valueAfter(texts: string[], label: string): string | null {
  const index = texts.findIndex((t) => t.trim() === label);
  return index >= 0 && index + 1 < texts.length ? texts[index + 1] : null;
}

/** "today" -> 0, "6d" / "30d ago" -> days, "17h ago" -> fraction of a day. */
function parseAge(text: string): number | null {
  if (text === 'today') return 0;
  const days = text.match(/^(\d+)d(?: ago)?$/);
  if (days) return Number(days[1]);
  const hours = text.match(/^(\d+)h(?: ago)?$/);
  if (hours) return Number(hours[1]) / 24;
  return null;
}

/**
 * Deployment rows render as consecutive nodes after each address:
 * spam   — LV.n, rate/hr, "N earned", age
 * siphon — LV.n, percent, "N siphoned", age
 */
function extractRows(texts: string[], earnedWord: 'earned' | 'siphoned'): VirusDeploymentInput[] {
  const earnedRe = new RegExp(`^([\\d,.]+) ${earnedWord}$`);
  const rows: VirusDeploymentInput[] = [];

  for (let i = 0; i < texts.length; i++) {
    const address = texts[i].trim();
    if (!ADDRESS_RE.test(address) || address === FULLY_MASKED) continue;

    const row: VirusDeploymentInput = {
      address,
      level: null,
      ratePerHour: null,
      percent: null,
      earned: 0,
      ageDays: null,
    };
    let sawEarned = false;

    for (let j = i + 1; j < Math.min(i + 6, texts.length); j++) {
      const value = texts[j].trim();
      if (ADDRESS_RE.test(value)) break;
      const level = value.match(/^LV\.(\d+)$/i);
      if (level) row.level = Number(level[1]);
      const rate = value.match(/^([\d,]+)\/hr$/);
      if (rate) row.ratePerHour = toNumber(rate[1]);
      const percent = value.match(/^([\d.]+)%$/);
      if (percent) row.percent = Number(percent[1]);
      const earned = value.match(earnedRe);
      if (earned) {
        row.earned = toNumber(earned[1]) ?? 0;
        sawEarned = true;
      }
      const age = parseAge(value);
      if (age !== null) row.ageDays = age;
    }

    // Ignore addresses from other parts of the screen that lack the row shape.
    if (sawEarned) rows.push(row);
  }

  return rows;
}

/** Returns null when the snapshot does not show the SPAM EARNINGS panel. */
export function classifySpamScreen(texts: string[]): SpamScreenData | null {
  const hasPanel =
    texts.some((t) => t.trim() === 'SPAM EARNINGS') &&
    texts.some((t) => t.trim() === 'CURRENT DEPLOYED EARNED');
  if (!hasPanel) return null;

  const summary: SpamScreenData['summary'] = {
    kind: 'SPAM',
    deployed: toNumber(valueAfter(texts, 'DEPLOYED')),
    slotsUsed: null,
    slotsTotal: null,
    ratePerHour: toNumber(valueAfter(texts, 'RATE')?.match(/^([\d,]+)\/hr$/)?.[1] ?? null),
    dailyRate: toNumber(valueAfter(texts, 'DAILY')?.match(/^([\d,]+)\/d$/)?.[1] ?? null),
    botnet: null,
    feePercent: null,
    totalEarned: toNumber(valueAfter(texts, 'CURRENT DEPLOYED EARNED')),
    dailyFees: toNumber(valueAfter(texts, 'DAILY BOTNET FEES')),
  };

  for (const raw of texts) {
    const text = raw.trim();
    const botnet = text.match(/^Botnet - (.+)$/);
    if (botnet) summary.botnet = botnet[1];
    const slots = text.match(/^(\d+)\/(\d+) slots$/);
    if (slots) {
      summary.slotsUsed = Number(slots[1]);
      summary.slotsTotal = Number(slots[2]);
    }
    const fee = text.match(/^([\d.]+)% fee$/);
    if (fee) summary.feePercent = Number(fee[1]);
  }

  const rows = extractRows(texts, 'earned');

  // The panel header alone (list collapsed off-screen) is not worth storing.
  if (rows.length === 0 && summary.deployed !== 0) return null;

  return { summary, rows };
}

/** Returns null when the snapshot does not show the SIPHON EARNINGS panel. */
export function classifySiphonScreen(texts: string[]): SiphonScreenData | null {
  const hasPanel =
    texts.some((t) => t.trim() === 'SIPHON EARNINGS') &&
    texts.some((t) => t.trim() === 'TOTAL SIPHONED');
  if (!hasPanel) return null;

  const summary: SiphonScreenData['summary'] = {
    kind: 'SIPHON',
    deployed: toNumber(valueAfter(texts, 'DEPLOYED')),
    totalSiphoned: toNumber(valueAfter(texts, 'TOTAL SIPHONED')),
  };

  const rows = extractRows(texts, 'siphoned');
  if (rows.length === 0 && summary.deployed !== 0) return null;

  return { summary, rows };
}

export async function ingestSpamScreen(
  db: SQLiteDatabase,
  data: SpamScreenData,
  capturedAt: number,
): Promise<void> {
  await syncVirusDeployments(db, 'SPAM', data.rows, capturedAt);
  await setVirusSummary(db, { ...data.summary, capturedAt });
}

export async function ingestSiphonScreen(
  db: SQLiteDatabase,
  data: SiphonScreenData,
  capturedAt: number,
): Promise<void> {
  await syncVirusDeployments(db, 'SIPHON', data.rows, capturedAt);
  await setVirusSummary(db, { ...data.summary, capturedAt });
}
