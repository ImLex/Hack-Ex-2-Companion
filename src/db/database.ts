import type { SQLiteDatabase } from 'expo-sqlite';
import { LATEST_VERSION, MIGRATIONS } from './schema';
import { SEED_SOFTWARE, SEED_TAGS } from './seed';

export const DATABASE_NAME = 'trakker3.db';

/**
 * Called by SQLiteProvider in app/_layout.tsx before any screen renders.
 */
export async function initialiseDatabase(db: SQLiteDatabase): Promise<void> {
  // Foreign keys are off by default per-connection; without this ON DELETE CASCADE silently does nothing.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  await runMigrations(db);
  await seedReferenceData(db);
}

async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  let currentVersion = row?.user_version ?? 0;

  if (currentVersion >= LATEST_VERSION) return;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
    });

    // PRAGMA can't take a bound parameter; the value comes from our constant list, never user input.
    await db.execAsync(`PRAGMA user_version = ${migration.version};`);
    currentVersion = migration.version;
  }
}

// INSERT OR IGNORE: safe to run every launch; new seed entries appear automatically.
async function seedReferenceData(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const item of SEED_SOFTWARE) {
      await db.runAsync('INSERT OR IGNORE INTO software (name, category) VALUES (?, ?);', [
        item.name,
        item.category,
      ]);
    }

    for (const tag of SEED_TAGS) {
      await db.runAsync(
        'INSERT OR IGNORE INTO tags (name, category, color, is_system) VALUES (?, ?, ?, 1);',
        [tag.name, tag.category, tag.color],
      );
    }
  });
}

/** Deletes all target data but keeps the software list and system tags. */
export async function eraseAllData(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      DELETE FROM reviews;
      DELETE FROM virus_deployments;
      DELETE FROM crypto_history;
      DELETE FROM installed_software;
      DELETE FROM wallets;
      DELETE FROM ip_relations;
      DELETE FROM logs;
      DELETE FROM target_tags;
      DELETE FROM target_info;
      DELETE FROM targets;
    `);
  });
}
