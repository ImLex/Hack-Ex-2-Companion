// Multi-account support. Each game account gets its own database file; a small
// JSON registry (outside any database) remembers which accounts exist and which
// one is active. The account name is read off the game's own home screen, which
// renders it as a terminal prompt ("> L3X_") next to the MY DEVICE button.

import { DATABASE_NAME } from '@/db/database';
import { cleanPlayerName, isConnectedToEnemy } from './enemyCapture';

export interface GameAccount {
  /** null until the account has been seen on the game's home screen. */
  name: string | null;
  dbName: string;
  lastSeenAt: number | null;
}

export interface AccountRegistry {
  accounts: GameAccount[];
  activeDbName: string;
}

const REGISTRY_FILENAME = 'accounts.json';

// Lazy so this module stays importable where the native module is missing (tests, web).
async function registryFile() {
  const FileSystem = await import('expo-file-system');
  return new FileSystem.File(FileSystem.Paths.document, REGISTRY_FILENAME);
}

/** The pre-multi-account database becomes the first account's database. */
export function defaultRegistry(): AccountRegistry {
  return {
    accounts: [{ name: null, dbName: DATABASE_NAME, lastSeenAt: null }],
    activeDbName: DATABASE_NAME,
  };
}

export async function loadRegistry(): Promise<AccountRegistry> {
  try {
    const file = await registryFile();
    if (!file.exists) return defaultRegistry();
    const parsed = JSON.parse(await file.text()) as AccountRegistry;
    if (
      !Array.isArray(parsed.accounts) ||
      parsed.accounts.length === 0 ||
      !parsed.accounts.some((a) => a.dbName === parsed.activeDbName)
    ) {
      return defaultRegistry();
    }
    return parsed;
  } catch {
    // Web, or an unreadable file: run on the default database, in memory only.
    return defaultRegistry();
  }
}

export async function saveRegistry(registry: AccountRegistry): Promise<void> {
  try {
    const file = await registryFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(registry));
  } catch {
    // Nowhere to persist (web); the in-memory registry still works this session.
  }
}

function newDbName(name: string, taken: GameAccount[]): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `account-${Date.now()}`;
  const used = new Set(taken.map((a) => a.dbName));
  let candidate = `trakker3-${slug}.db`;
  for (let i = 2; used.has(candidate); i++) candidate = `trakker3-${slug}-${i}.db`;
  return candidate;
}

export interface DetectionOutcome {
  registry: AccountRegistry;
  /** True when the active database changed and the app must reopen on the new one. */
  switched: boolean;
}

/**
 * Reconciles a name seen on the game's home screen with the registry.
 * The first name ever seen claims the existing (pre-multi-account) database
 * rather than starting an empty one.
 */
export function resolveDetectedAccount(
  registry: AccountRegistry,
  name: string,
  now: number,
): DetectionOutcome {
  const accounts = registry.accounts.map((account) => ({ ...account }));

  const existing = accounts.find((account) => account.name === name);
  if (existing) {
    existing.lastSeenAt = now;
    return {
      registry: { accounts, activeDbName: existing.dbName },
      switched: existing.dbName !== registry.activeDbName,
    };
  }

  const active = accounts.find((account) => account.dbName === registry.activeDbName);
  if (active && active.name === null) {
    active.name = name;
    active.lastSeenAt = now;
    return { registry: { accounts, activeDbName: active.dbName }, switched: false };
  }

  const dbName = newDbName(name, accounts);
  accounts.push({ name, dbName, lastSeenAt: now });
  return { registry: { accounts, activeDbName: dbName }, switched: true };
}

export function switchActiveAccount(
  registry: AccountRegistry,
  dbName: string,
): AccountRegistry {
  if (!registry.accounts.some((account) => account.dbName === dbName)) return registry;
  return { ...registry, activeDbName: dbName };
}

/**
 * Returns the player's own name when the snapshot shows their home screen
 * (dashboard), else null. Anchors: the MY DEVICE button only exists there, and
 * enemy screens always carry CONNECTED/DISCONNECT, so an enemy profile's
 * "> Name" prompt can never be mistaken for our own.
 */
export function detectOwnAccountName(texts: string[]): string | null {
  if (isConnectedToEnemy(texts)) return null;
  if (!texts.some((text) => text.trim() === 'MY DEVICE')) return null;

  for (const text of texts) {
    const match = text.match(/^>\s*(\S.*)$/);
    if (match) {
      // The game draws a blinking cursor glued straight onto the nickname
      // ("L3X" renders as "L3X_"); exactly one trailing underscore is cosmetic.
      const cleaned = cleanPlayerName(match[1]).replace(/_$/, '');
      if (cleaned) return cleaned;
    }
  }
  return null;
}
