import type { SQLiteDatabase } from 'expo-sqlite';

export const BACKUP_FORMAT_VERSION = 1;

/** In an order safe to restore in; deletes run in reverse. */
const TABLES = [
  'targets',
  'target_info',
  'tags',
  'target_tags',
  'logs',
  'ip_relations',
  'wallets',
  'crypto_history',
  'software',
  'installed_software',
  'reviews',
  'virus_deployments',
  'settings',
] as const;

export interface BackupFile {
  format: 'trakker3-backup';
  version: number;
  createdAt: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function createBackup(db: SQLiteDatabase): Promise<BackupFile> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};

  for (const table of TABLES) {
    const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table};`);
    tables[table] = rows;
    counts[table] = rows.length;
  }

  return {
    format: 'trakker3-backup',
    version: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    counts,
    tables,
  };
}

export function serialiseBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
  restored: Record<string, number>;
}

/**
 * Replaces the entire database with the backup. Destructive by design; runs in
 * one transaction so a corrupt file leaves current data untouched.
 */
export async function restoreBackup(
  db: SQLiteDatabase,
  json: string,
): Promise<RestoreResult> {
  let backup: BackupFile;
  try {
    backup = JSON.parse(json) as BackupFile;
  } catch {
    return { ok: false, error: 'That file is not valid JSON.', restored: {} };
  }

  if (backup.format !== 'trakker3-backup') {
    return { ok: false, error: 'That file is not a Hack EX 2 Companion backup.', restored: {} };
  }
  if (typeof backup.version !== 'number' || backup.version > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      error: `That backup was made by a newer version of Hack EX 2 Companion (format ${backup.version}). Update the app first.`,
      restored: {},
    };
  }
  if (!backup.tables || typeof backup.tables !== 'object') {
    return { ok: false, error: 'That backup file has no data in it.', restored: {} };
  }

  const restored: Record<string, number> = {};

  try {
    // FKs off during restore — rows arrive in an order the constraints would reject.
    await db.execAsync('PRAGMA foreign_keys = OFF;');

    await db.withTransactionAsync(async () => {
      for (const table of [...TABLES].reverse()) {
        await db.execAsync(`DELETE FROM ${table};`);
      }

      for (const table of TABLES) {
        const rows = backup.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) {
          restored[table] = 0;
          continue;
        }

        for (const row of rows) {
          const columns = Object.keys(row);
          if (columns.length === 0) continue;
          const values = columns.map((c) => row[c] as string | number | null);
          await db.runAsync(
            `INSERT OR REPLACE INTO ${table} (${columns.join(', ')})
             VALUES (${columns.map(() => '?').join(', ')});`,
            values,
          );
        }
        restored[table] = rows.length;
      }
    });

    return { ok: true, restored };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Restore failed.',
      restored: {},
    };
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}

/** Spreadsheet export — unlike a backup, a CSV cannot be restored from. */
export async function exportTargetsCsv(db: SQLiteDatabase): Promise<string> {
  const rows = await db.getAllAsync<{
    name: string;
    device: string | null;
    level: number;
    crypto: number;
    activity: string;
    potential_score: number;
    attack_count: number;
    date_added: number;
    notes: string;
    extracted_total: number | null;
    ips: string | null;
    wallets: string | null;
    software: string | null;
    tags: string | null;
  }>(`
    SELECT
      t.name, t.device, t.attack_count, t.date_added,
      i.level, i.crypto, i.activity, i.potential_score, i.notes,
      (SELECT SUM(amount) FROM crypto_history ch WHERE ch.target_id = t.id) AS extracted_total,
      (SELECT GROUP_CONCAT(address, ' ')     FROM ip_relations ip WHERE ip.target_id = t.id) AS ips,
      (SELECT GROUP_CONCAT(display_address, ' ') FROM wallets w  WHERE w.target_id  = t.id) AS wallets,
      (SELECT GROUP_CONCAT(s.name || ' Lv' || ins.level, ' ')
         FROM installed_software ins JOIN software s ON s.id = ins.software_id
        WHERE ins.target_id = t.id) AS software,
      (SELECT GROUP_CONCAT(tg.name, ' ')
         FROM target_tags tt JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.target_id = t.id) AS tags
    FROM targets t
    JOIN target_info i ON i.target_id = t.id
    ORDER BY i.potential_score DESC;
  `);

  const header = [
    'Name',
    'Device',
    'Level',
    'Crypto',
    'Extracted total',
    'Activity',
    'Potential score',
    'Attacks',
    'Tags',
    'IPs',
    'Wallets',
    'Software',
    'Added',
    'Notes',
  ];

  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.device ?? '',
        r.level,
        Math.round(r.crypto),
        Math.round(r.extracted_total ?? 0),
        r.activity,
        r.potential_score,
        r.attack_count,
        r.tags ?? '',
        r.ips ?? '',
        r.wallets ?? '',
        r.software ?? '',
        new Date(r.date_added).toISOString().slice(0, 10),
        r.notes,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return lines.join('\n');
}

/**
 * CSV injection defence: a cell starting with = + - or @ is executed as a
 * formula by Excel/Sheets, so those are prefixed with a quote.
 */
function csvCell(value: string | number): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}
