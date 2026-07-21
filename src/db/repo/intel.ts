// Things discovered about a target: IPs, wallets, installed software, tags.

import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  DataSource,
  InstalledSoftwareWithName,
  IpRelation,
  IpStatus,
  Software,
  SoftwareOwner,
  Tag,
  TagCategory,
  Wallet,
} from '../types';
import { fromDbBool, groupBy, placeholders, toDbBool } from './shared';
import { softwareSortIndex } from '../seed';
import { shortenWallet } from '@/logic/wallets';

interface IpRow {
  id: number;
  target_id: number;
  address: string;
  status: string;
  found_from_log_id: number | null;
  source: string;
  discovered_at: number;
}

const mapIp = (r: IpRow): IpRelation => ({
  id: r.id,
  targetId: r.target_id,
  address: r.address,
  status: r.status as IpStatus,
  foundFromLogId: r.found_from_log_id,
  source: r.source as DataSource,
  discoveredAt: r.discovered_at,
});

export async function listIps(db: SQLiteDatabase, targetId: number): Promise<IpRelation[]> {
  const rows = await db.getAllAsync<IpRow>(
    'SELECT * FROM ip_relations WHERE target_id = ? ORDER BY discovered_at DESC;',
    [targetId],
  );
  return rows.map(mapIp);
}

export async function listIpsForTargets(
  db: SQLiteDatabase,
  targetIds: number[],
): Promise<Map<number, IpRelation[]>> {
  if (targetIds.length === 0) return new Map();
  const rows = await db.getAllAsync<IpRow>(
    `SELECT * FROM ip_relations WHERE target_id IN (${placeholders(targetIds.length)}) ORDER BY discovered_at DESC;`,
    targetIds,
  );
  return groupBy(rows.map(mapIp), (r) => r.targetId);
}

export async function findTargetIdByIp(
  db: SQLiteDatabase,
  address: string,
): Promise<number | null> {
  const row = await db.getFirstAsync<{ target_id: number }>(
    'SELECT target_id FROM ip_relations WHERE address = ?;',
    [address],
  );
  return row?.target_id ?? null;
}

/**
 * Addresses are globally unique, so adding an IP that belongs to another target
 * moves it — correct in Hack Ex, where an IP change means the old owner no longer holds it.
 */
export async function addIp(
  db: SQLiteDatabase,
  input: {
    targetId: number;
    address: string;
    status?: IpStatus;
    source?: DataSource;
    foundFromLogId?: number | null;
    discoveredAt?: number;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO ip_relations (target_id, address, status, found_from_log_id, source, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       target_id = excluded.target_id,
       status    = excluded.status,
       source    = excluded.source;`,
    [
      input.targetId,
      input.address,
      input.status ?? 'ACTIVE',
      input.foundFromLogId ?? null,
      input.source ?? 'MANUAL',
      input.discoveredAt ?? Date.now(),
    ],
  );
}

export async function setIpStatus(
  db: SQLiteDatabase,
  ipId: number,
  status: IpStatus,
): Promise<void> {
  await db.runAsync('UPDATE ip_relations SET status = ? WHERE id = ?;', [status, ipId]);
}

export async function deleteIp(db: SQLiteDatabase, ipId: number): Promise<void> {
  await db.runAsync('DELETE FROM ip_relations WHERE id = ?;', [ipId]);
}

interface WalletRow {
  id: number;
  target_id: number | null;
  display_address: string;
  full_address: string | null;
  cracked: number;
  found_from_log_id: number | null;
  discovered_at: number;
}

const mapWallet = (r: WalletRow): Wallet => ({
  id: r.id,
  targetId: r.target_id,
  displayAddress: r.display_address,
  fullAddress: r.full_address,
  cracked: fromDbBool(r.cracked),
  foundFromLogId: r.found_from_log_id,
  discoveredAt: r.discovered_at,
});

export async function listWallets(db: SQLiteDatabase, targetId: number): Promise<Wallet[]> {
  const rows = await db.getAllAsync<WalletRow>(
    'SELECT * FROM wallets WHERE target_id = ? ORDER BY discovered_at DESC;',
    [targetId],
  );
  return rows.map(mapWallet);
}

/** Crypto log lines never contain an IP, so a wallet can be seen before its owner is known. */
export async function listUnassignedWallets(db: SQLiteDatabase): Promise<Wallet[]> {
  const rows = await db.getAllAsync<WalletRow>(
    'SELECT * FROM wallets WHERE target_id IS NULL ORDER BY discovered_at DESC;',
  );
  return rows.map(mapWallet);
}

/** Shortens the address first, so a full cracked address finds the row created from shortened sightings. */
export async function findTargetIdByWallet(
  db: SQLiteDatabase,
  displayAddress: string,
): Promise<number | null> {
  const row = await db.getFirstAsync<{ target_id: number | null }>(
    'SELECT target_id FROM wallets WHERE display_address = ?;',
    [shortenWallet(displayAddress)],
  );
  return row?.target_id ?? null;
}

/**
 * Keyed on the shortened address, so full and short forms collapse to one row.
 * target_id is only filled in, never cleared; full_address and cracked only move
 * forward (a fullAddress sighting implies cracked).
 */
export async function upsertWallet(
  db: SQLiteDatabase,
  input: {
    displayAddress: string;
    targetId?: number | null;
    fullAddress?: string | null;
    cracked?: boolean;
    foundFromLogId?: number | null;
    discoveredAt?: number;
  },
): Promise<number> {
  const displayAddress = shortenWallet(input.displayAddress);
  const fullAddress = input.fullAddress?.trim() || null;
  const cracked = input.cracked ?? fullAddress !== null;

  await db.runAsync(
    `INSERT INTO wallets (target_id, display_address, full_address, cracked, found_from_log_id, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(display_address) DO UPDATE SET
       target_id    = COALESCE(wallets.target_id, excluded.target_id),
       full_address = COALESCE(excluded.full_address, wallets.full_address),
       cracked      = MAX(wallets.cracked, excluded.cracked);`,
    [
      input.targetId ?? null,
      displayAddress,
      fullAddress,
      toDbBool(cracked || fullAddress !== null),
      input.foundFromLogId ?? null,
      input.discoveredAt ?? Date.now(),
    ],
  );

  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM wallets WHERE display_address = ?;',
    [displayAddress],
  );
  return row!.id;
}

/** Also back-fills crypto events and logs recorded while the wallet's owner was unknown. */
export async function assignWalletToTarget(
  db: SQLiteDatabase,
  walletId: number,
  targetId: number,
): Promise<number> {
  await db.runAsync('UPDATE wallets SET target_id = ? WHERE id = ?;', [targetId, walletId]);
  const result = await db.runAsync(
    'UPDATE crypto_history SET target_id = ? WHERE wallet_id = ? AND target_id IS NULL;',
    [targetId, walletId],
  );
  await db.runAsync(
    `UPDATE logs SET target_id = ?
     WHERE target_id IS NULL
       AND id IN (SELECT source_log_id FROM crypto_history WHERE wallet_id = ? AND source_log_id IS NOT NULL);`,
    [targetId, walletId],
  );
  return result.changes;
}

export async function setWalletCracked(
  db: SQLiteDatabase,
  walletId: number,
  cracked: boolean,
): Promise<void> {
  await db.runAsync('UPDATE wallets SET cracked = ? WHERE id = ?;', [toDbBool(cracked), walletId]);
}

export async function setWalletFullAddress(
  db: SQLiteDatabase,
  walletId: number,
  fullAddress: string,
): Promise<void> {
  await db.runAsync('UPDATE wallets SET full_address = ? WHERE id = ?;', [fullAddress, walletId]);
}

export async function deleteWallet(db: SQLiteDatabase, walletId: number): Promise<void> {
  await db.runAsync('DELETE FROM wallets WHERE id = ?;', [walletId]);
}

/** Sorted in JS — the order is the hand-written list in src/db/seed.ts, not anything SQL could express. */
export async function listSoftwareCatalogue(db: SQLiteDatabase): Promise<Software[]> {
  const rows = await db.getAllAsync<Software>('SELECT id, name, category FROM software;');
  return rows.sort(bySoftwareOrder);
}

/** Game order first, then parser-invented names alphabetically. */
function bySoftwareOrder(a: { name: string }, b: { name: string }): number {
  const difference = softwareSortIndex(a.name) - softwareSortIndex(b.name);
  if (difference !== 0) return difference;
  return a.name.localeCompare(b.name);
}

export async function ensureSoftware(db: SQLiteDatabase, name: string): Promise<number> {
  const cleaned = name.trim();
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM software WHERE name = ? COLLATE NOCASE;',
    [cleaned],
  );
  if (existing) return existing.id;

  const result = await db.runAsync('INSERT INTO software (name, category) VALUES (?, ?);', [
    cleaned,
    'UTILITY',
  ]);
  return result.lastInsertRowId;
}

interface InstalledRow {
  id: number;
  target_id: number;
  software_id: number;
  level: number;
  owner: string;
  source: string;
  updated_at: number;
  name: string;
  category: string;
}

const mapInstalled = (r: InstalledRow): InstalledSoftwareWithName => ({
  id: r.id,
  targetId: r.target_id,
  softwareId: r.software_id,
  level: r.level,
  owner: r.owner as SoftwareOwner,
  source: r.source as DataSource,
  updatedAt: r.updated_at,
  name: r.name,
  category: r.category as InstalledSoftwareWithName['category'],
});

const INSTALLED_SELECT = `
  SELECT ins.*, s.name, s.category
  FROM installed_software ins
  JOIN software s ON s.id = ins.software_id
`;

/**
 * Sorted here so every caller gets the same stable order — sorting by level
 * alone made the cards rearrange on every edit.
 */
export async function listInstalledSoftware(
  db: SQLiteDatabase,
  targetId: number,
): Promise<InstalledSoftwareWithName[]> {
  const rows = await db.getAllAsync<InstalledRow>(
    `${INSTALLED_SELECT} WHERE ins.target_id = ?;`,
    [targetId],
  );
  return rows.map(mapInstalled).sort(byOrderThenLevel);
}

export async function listInstalledForTargets(
  db: SQLiteDatabase,
  targetIds: number[],
): Promise<Map<number, InstalledSoftwareWithName[]>> {
  if (targetIds.length === 0) return new Map();
  const rows = await db.getAllAsync<InstalledRow>(
    `${INSTALLED_SELECT} WHERE ins.target_id IN (${placeholders(targetIds.length)});`,
    targetIds,
  );
  return groupBy(rows.map(mapInstalled).sort(byOrderThenLevel), (r) => r.targetId);
}

/** Catalogue order, then highest level first for duplicated names. */
function byOrderThenLevel(
  a: InstalledSoftwareWithName,
  b: InstalledSoftwareWithName,
): number {
  const difference = softwareSortIndex(a.name) - softwareSortIndex(b.name);
  if (difference !== 0) return difference;
  if (b.level !== a.level) return b.level - a.level;
  return a.name.localeCompare(b.name);
}

/** Parsed levels only ever raise; an explicit manual edit (overwrite) always wins. */
export async function setInstalledSoftware(
  db: SQLiteDatabase,
  input: {
    targetId: number;
    softwareId: number;
    level: number;
    owner?: SoftwareOwner;
    source?: DataSource;
    /** Manual edits overwrite; parsed data only raises the level. */
    overwrite?: boolean;
  },
): Promise<void> {
  const owner = input.owner ?? 'TARGET';
  const levelExpression = input.overwrite ? 'excluded.level' : 'MAX(installed_software.level, excluded.level)';

  await db.runAsync(
    `INSERT INTO installed_software (target_id, software_id, level, owner, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(target_id, software_id, owner) DO UPDATE SET
       level      = ${levelExpression},
       source     = excluded.source,
       updated_at = excluded.updated_at;`,
    [
      input.targetId,
      input.softwareId,
      Math.max(0, Math.round(input.level)),
      owner,
      input.source ?? 'MANUAL',
      Date.now(),
    ],
  );
}

export async function deleteInstalledSoftware(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM installed_software WHERE id = ?;', [id]);
}

interface TagRow {
  id: number;
  name: string;
  category: string;
  color: string | null;
  is_system: number;
}

const mapTag = (r: TagRow): Tag => ({
  id: r.id,
  name: r.name,
  category: r.category as TagCategory,
  color: r.color,
  isSystem: fromDbBool(r.is_system),
});

export async function listAllTags(db: SQLiteDatabase): Promise<Tag[]> {
  const rows = await db.getAllAsync<TagRow>('SELECT * FROM tags ORDER BY category, name;');
  return rows.map(mapTag);
}

export async function listTagsForTarget(db: SQLiteDatabase, targetId: number): Promise<Tag[]> {
  const rows = await db.getAllAsync<TagRow>(
    `SELECT t.* FROM tags t
     JOIN target_tags tt ON tt.tag_id = t.id
     WHERE tt.target_id = ?
     ORDER BY t.category, t.name;`,
    [targetId],
  );
  return rows.map(mapTag);
}

/** One query for many targets, so the list screen doesn't fire N queries. */
export async function listTagsForTargets(
  db: SQLiteDatabase,
  targetIds: number[],
): Promise<Map<number, Tag[]>> {
  if (targetIds.length === 0) return new Map();
  const rows = await db.getAllAsync<TagRow & { target_id: number }>(
    `SELECT t.*, tt.target_id FROM tags t
     JOIN target_tags tt ON tt.tag_id = t.id
     WHERE tt.target_id IN (${placeholders(targetIds.length)})
     ORDER BY t.category, t.name;`,
    targetIds,
  );

  const map = new Map<number, Tag[]>();
  for (const row of rows) {
    const list = map.get(row.target_id) ?? [];
    list.push(mapTag(row));
    map.set(row.target_id, list);
  }
  return map;
}

export async function ensureTag(
  db: SQLiteDatabase,
  name: string,
  category: TagCategory = 'CUSTOM',
): Promise<number> {
  const cleaned = name.trim().toUpperCase().replace(/\s+/g, '_');
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM tags WHERE name = ?;', [
    cleaned,
  ]);
  if (existing) return existing.id;

  const result = await db.runAsync('INSERT INTO tags (name, category) VALUES (?, ?);', [
    cleaned,
    category,
  ]);
  return result.lastInsertRowId;
}

export async function addTagToTarget(
  db: SQLiteDatabase,
  targetId: number,
  tagId: number,
): Promise<void> {
  await db.runAsync(
    'INSERT OR IGNORE INTO target_tags (target_id, tag_id) VALUES (?, ?);',
    [targetId, tagId],
  );
}

export async function removeTagFromTarget(
  db: SQLiteDatabase,
  targetId: number,
  tagId: number,
): Promise<void> {
  await db.runAsync('DELETE FROM target_tags WHERE target_id = ? AND tag_id = ?;', [
    targetId,
    tagId,
  ]);
}

export async function deleteTag(db: SQLiteDatabase, tagId: number): Promise<void> {
  await db.runAsync('DELETE FROM tags WHERE id = ? AND is_system = 0;', [tagId]);
}
