// Drains the game reader's snapshot queue (Android accessibility service or
// iOS broadcast extension) through the same parse/ingest pipeline as manual
// paste.

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { getIosQueueDirectoryUri } from '../native/gameReader';
import type { SQLiteDatabase } from 'expo-sqlite';
import { parseLogText } from './parser';
import { ingestParsedLines } from './ingest';
import { classifyEnemyScreen, ingestEnemyScreen, isConnectedToEnemy } from './enemyCapture';
import {
  classifySiphonScreen,
  classifySpamScreen,
  ingestSiphonScreen,
  ingestSpamScreen,
} from './virusCapture';
import { detectOwnAccountName } from './accounts';
import {
  classifyOwnAppsScreen,
  classifyOwnSettingsScreen,
  extractPlayerLevel,
  ingestOwnAppsScreen,
  ingestOwnLevel,
  ingestOwnSettingsScreen,
} from './ownDevice';

export interface AutoImportResult {
  snapshotsProcessed: number;
  newLines: number;
  duplicatesSkipped: number;
  cryptoAdded: number;
  enemyScreens: number;
  virusCaptures: number;
  ownCaptures: number;
  /** The player's own name, when a home-screen snapshot was seen. */
  ownAccountName: string | null;
  /**
   * Set when the home screen showed an account other than the active one.
   * Draining stopped there — that snapshot and everything after it stay queued
   * for the next run against the right database.
   */
  accountSwitch: string | null;
}

interface SnapshotNode {
  text?: string;
}

let running = false;

// Android's service writes into the app's own documents directory; the iOS
// broadcast extension can only reach the shared App Group container.
function openQueueDirectory(): FileSystem.Directory | null {
  if (Platform.OS === 'ios') {
    const uri = getIosQueueDirectoryUri();
    return uri ? new FileSystem.Directory(uri) : null;
  }
  return new FileSystem.Directory(FileSystem.Paths.document, 'gamereader', 'queue');
}

/** Drains the Game Reader queue. Safe to call often; overlapping calls no-op. */
export async function runAutoImport(
  db: SQLiteDatabase,
  activeAccountName: string | null = null,
): Promise<AutoImportResult | null> {
  if (running || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return null;
  running = true;
  try {
    const queue = openQueueDirectory();
    if (!queue || !queue.exists) return null;

    const files = queue
      .list()
      .filter((entry): entry is FileSystem.File => entry instanceof FileSystem.File)
      .filter((file) => file.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (files.length === 0) return null;

    const result: AutoImportResult = {
      snapshotsProcessed: 0,
      newLines: 0,
      duplicatesSkipped: 0,
      cryptoAdded: 0,
      enemyScreens: 0,
      virusCaptures: 0,
      ownCaptures: 0,
      ownAccountName: null,
      accountSwitch: null,
    };

    for (const file of files) {
      let snapshot: { ts?: number; nodes?: SnapshotNode[] };
      try {
        snapshot = JSON.parse(await file.text());
      } catch {
        // Malformed snapshots can never succeed; retrying would wedge the queue.
        try {
          file.delete();
        } catch {}
        continue;
      }

      try {
        const texts = (snapshot.nodes ?? [])
          .map((node) => node.text ?? '')
          .filter(Boolean);
        const capturedAt = snapshot.ts ?? Date.now();

        const ownName = detectOwnAccountName(texts);
        if (ownName) {
          result.ownAccountName = ownName;
          // A different account's home screen: everything from here on belongs
          // in that account's database, which is not the one we hold.
          if (activeAccountName !== null && ownName !== activeAccountName) {
            result.accountSwitch = ownName;
            break;
          }
          // Our own home screen also shows our player level.
          const level = extractPlayerLevel(texts);
          if (level !== null) await ingestOwnLevel(db, level);
        }

        const ownSettings = classifyOwnSettingsScreen(texts);
        if (ownSettings) {
          await ingestOwnSettingsScreen(db, ownSettings, capturedAt);
          result.ownCaptures += 1;
        }
        const ownApps = classifyOwnAppsScreen(texts);
        if (ownApps) {
          await ingestOwnAppsScreen(db, ownApps, capturedAt);
          result.ownCaptures += 1;
        }

        const enemyScreen = classifyEnemyScreen(texts);
        if (enemyScreen) {
          await ingestEnemyScreen(db, enemyScreen, capturedAt);
          result.enemyScreens += 1;
        }

        // Both panels can be expanded in the same snapshot; check each.
        const spamScreen = classifySpamScreen(texts);
        if (spamScreen) {
          await ingestSpamScreen(db, spamScreen, capturedAt);
          result.virusCaptures += 1;
        }
        const siphonScreen = classifySiphonScreen(texts);
        if (siphonScreen) {
          await ingestSiphonScreen(db, siphonScreen, capturedAt);
          result.virusCaptures += 1;
        }

        // While connected to an enemy, any visible LOG lines are *their*
        // history, not ours — parsing them would pollute our own log.
        if (!isConnectedToEnemy(texts)) {
          // The snapshot's own capture time anchors the year of the game's
          // year-less [7-20 16:28] timestamps.
          const parsed = parseLogText(texts.join('\n'), new Date(capturedAt));
          if (parsed.lines.length > 0) {
            const report = await ingestParsedLines(db, parsed.lines);
            result.newLines += report.logsInserted;
            result.duplicatesSkipped += report.duplicatesSkipped;
            result.cryptoAdded += report.cryptoTotalAdded;
          }
        }

        result.snapshotsProcessed += 1;
        file.delete();
      } catch {
        // Database hiccup: keep the file so the next run retries it.
      }
    }

    return result;
  } finally {
    running = false;
  }
}
