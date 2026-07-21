// The player's own hardware and software, read off the game's Settings and
// APPS screens. Stored as JSON blobs like the virus summaries.

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from './settings';

const KEY_DEVICE = 'own.device';
const KEY_SOFTWARE = 'own.software';

export interface OwnDeviceInfo {
  ip: string | null;
  proxyActive: boolean;
  /** "106h 45m" — as printed by the game. */
  proxyRemaining: string | null;
  deviceName: string | null;
  deviceLevel: number | null;
  /** "3.6 GHz Quad Core" */
  deviceSpec: string | null;
  networkName: string | null;
  networkLevel: number | null;
  /** "25 gbps / 5 gbps" */
  networkSpeed: string | null;
  capturedAt: number;
}

export interface OwnSoftwareInfo {
  software: { name: string; level: number }[];
  capturedAt: number;
}

async function getJson<T>(db: SQLiteDatabase, key: string): Promise<T | null> {
  const raw = await getSetting(db, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const getOwnDevice = (db: SQLiteDatabase) => getJson<OwnDeviceInfo>(db, KEY_DEVICE);
export const getOwnSoftware = (db: SQLiteDatabase) => getJson<OwnSoftwareInfo>(db, KEY_SOFTWARE);

export async function setOwnDevice(db: SQLiteDatabase, info: OwnDeviceInfo): Promise<void> {
  await setSetting(db, KEY_DEVICE, JSON.stringify(info));
}

export async function setOwnSoftware(db: SQLiteDatabase, info: OwnSoftwareInfo): Promise<void> {
  await setSetting(db, KEY_SOFTWARE, JSON.stringify(info));
}
