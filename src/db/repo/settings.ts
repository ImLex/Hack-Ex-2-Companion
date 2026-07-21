// App preferences plus the player's own level/device (recommendations and scoring are
// relative to them). Level 0 means "not set" — consumers must say so, never guess.

import type { SQLiteDatabase } from 'expo-sqlite';

export interface UserProfile {
  level: number;
  device: string | null;
}

const KEY_LEVEL = 'user.level';
const KEY_DEVICE = 'user.device';

const DEFAULT_PROFILE: UserProfile = { level: 0, device: null };

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?;',
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SQLiteDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [key, value],
  );
}

export async function getUserProfile(db: SQLiteDatabase): Promise<UserProfile> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM settings WHERE key IN (?, ?);',
    [KEY_LEVEL, KEY_DEVICE],
  );

  const profile: UserProfile = { ...DEFAULT_PROFILE };
  for (const row of rows) {
    if (row.key === KEY_LEVEL) {
      const parsed = Number.parseInt(row.value, 10);
      // A non-numeric stored value reads as never-set, not as NaN leaking into scores.
      profile.level = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    } else if (row.key === KEY_DEVICE) {
      const cleaned = row.value.trim();
      profile.device = cleaned.length > 0 ? cleaned : null;
    }
  }
  return profile;
}

/** Fields left out of the patch are untouched. */
export async function setUserProfile(
  db: SQLiteDatabase,
  patch: Partial<UserProfile>,
): Promise<void> {
  if (patch.level !== undefined) {
    await setSetting(db, KEY_LEVEL, String(Math.max(0, Math.round(patch.level))));
  }
  if (patch.device !== undefined) {
    // Clearing stores '' rather than deleting the row, so "cleared" and "never set" read back the same.
    await setSetting(db, KEY_DEVICE, patch.device?.trim() ?? '');
  }
}
