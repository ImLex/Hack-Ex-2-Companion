// The player's own device: the game's Settings screen ("// MY DEVICE" with
// "> IP Address") carries IP/proxy/hardware, the APPS screen ("Installed
// Applications") carries software levels, and the home screen carries the
// player level. All three are own-screens only — anything shown while
// connected to an enemy is theirs, not ours.

import type { SQLiteDatabase } from 'expo-sqlite';
import { isConnectedToEnemy } from './enemyCapture';
import { SOFTWARE_ORDER } from '@/db/seed';
import { getUserProfile, setUserProfile } from '@/db/repo/settings';
import { recalculateAllScores } from '@/db/repo/targets';
import {
  setOwnDevice,
  setOwnSoftware,
  type OwnDeviceInfo,
  type OwnSoftwareInfo,
} from '@/db/repo/ownDevice';

const FULL_IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export type OwnSettingsData = Omit<OwnDeviceInfo, 'capturedAt'>;
export type OwnAppsData = Omit<OwnSoftwareInfo, 'capturedAt'>;

const KNOWN_SOFTWARE = new Set([...SOFTWARE_ORDER, 'Keygen'].map((name) => name.toLowerCase()));

function valueAfter(texts: string[], label: string): string | null {
  const index = texts.findIndex((t) => t.trim() === label);
  return index >= 0 && index + 1 < texts.length ? texts[index + 1].trim() : null;
}

/** DEVICE and NETWORK render as: label, name, "Lv ", number, spec line. */
function parseHardware(
  texts: string[],
  label: 'DEVICE' | 'NETWORK',
): { name: string | null; level: number | null; spec: string | null } {
  const index = texts.findIndex((t) => t.trim() === label);
  if (index < 0) return { name: null, level: null, spec: null };

  const name = texts[index + 1]?.trim() || null;
  let level: number | null = null;
  let spec: string | null = null;

  for (let j = index + 2; j < Math.min(index + 6, texts.length); j++) {
    const text = texts[j].trim();
    if (text === 'DEVICE' || text === 'NETWORK' || text.startsWith('>')) break;
    if (text === 'Lv') {
      const value = Number(texts[j + 1]?.trim());
      if (Number.isFinite(value)) level = value;
    }
    if (/GHz|gbps/i.test(text)) spec = text;
  }

  return { name, level, spec };
}

/** Returns null when the snapshot is not the game's own Settings screen. */
export function classifyOwnSettingsScreen(texts: string[]): OwnSettingsData | null {
  if (isConnectedToEnemy(texts)) return null;
  const isSettings =
    texts.some((t) => t.trim() === '// MY DEVICE') &&
    texts.some((t) => t.trim() === '> IP Address');
  if (!isSettings) return null;

  const rawIp = valueAfter(texts, 'IP');
  const device = parseHardware(texts, 'DEVICE');
  const network = parseHardware(texts, 'NETWORK');

  return {
    ip: rawIp && FULL_IP_RE.test(rawIp) ? rawIp : null,
    proxyActive: valueAfter(texts, 'PROXY') === 'ACTIVE',
    proxyRemaining:
      texts
        .map((t) => t.trim().match(/^(.+?)\s+Remaining$/i)?.[1])
        .find((match) => match !== undefined) ?? null,
    deviceName: device.name,
    deviceLevel: device.level,
    deviceSpec: device.spec,
    networkName: network.name,
    networkLevel: network.level,
    networkSpeed: network.spec,
  };
}

/** Returns null unless the snapshot shows our own installed-applications list. */
export function classifyOwnAppsScreen(texts: string[]): OwnAppsData | null {
  if (isConnectedToEnemy(texts)) return null;
  if (!texts.some((t) => t.trim().endsWith('Installed Applications'))) return null;

  const software: { name: string; level: number }[] = [];
  let pending: string | null = null;

  for (const text of texts) {
    const trimmed = text.trim();
    if (KNOWN_SOFTWARE.has(trimmed.toLowerCase())) {
      pending = trimmed;
      continue;
    }
    if (pending) {
      const lvl = trimmed.match(/^LVL\s+(\d+)$/);
      if (lvl) {
        software.push({ name: pending, level: Number(lvl[1]) });
        pending = null;
      }
    }
  }

  return software.length > 0 ? { software } : null;
}

/** Player level from the own home screen ("LVL 41" beside the nickname). */
export function extractPlayerLevel(texts: string[]): number | null {
  for (const text of texts) {
    const match = text.trim().match(/^LVL\s+([\d,]+)$/);
    if (match) {
      const value = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

export async function ingestOwnSettingsScreen(
  db: SQLiteDatabase,
  data: OwnSettingsData,
  capturedAt: number,
): Promise<void> {
  await setOwnDevice(db, { ...data, capturedAt });
  if (data.deviceName) await setUserProfile(db, { device: data.deviceName });
}

export async function ingestOwnAppsScreen(
  db: SQLiteDatabase,
  data: OwnAppsData,
  capturedAt: number,
): Promise<void> {
  await setOwnSoftware(db, { ...data, capturedAt });
}

/** Spam recommendations compare against this level, so a change rescores everything. */
export async function ingestOwnLevel(db: SQLiteDatabase, level: number): Promise<boolean> {
  const profile = await getUserProfile(db);
  if (profile.level === level) return false;
  await setUserProfile(db, { level });
  await recalculateAllScores(db);
  return true;
}
