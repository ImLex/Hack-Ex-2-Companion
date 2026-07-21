// Writes parsed log lines into the database. Invariants: parsed software levels
// only ever raise (never overwrite manual data); unknown-but-confident IPs become
// targets named after the address; ambiguity goes to the review inbox, never guessed.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { ParsedLine } from './parser';
import { walletsMatch } from './wallets';
import { insertCryptoEvent, insertLog } from '@/db/repo/logs';
import {
  addIp,
  ensureSoftware,
  findTargetIdByIp,
  findTargetIdByWallet,
  setInstalledSoftware,
  upsertWallet,
} from '@/db/repo/intel';
import { createReview } from '@/db/repo/reviews';
import { incrementAttackCount, recalculateScores } from '@/db/repo/targets';

/** Below this, a line is stored but not acted on. */
const CONFIDENCE_THRESHOLD = 0.5;

// The game prints timestamps to the minute and an access-and-steal takes seconds,
// so 3 minutes is generous; the real protection is the exactly-one-target rule.
const CORRELATION_WINDOW_MS = 3 * 60 * 1000;

export interface IngestOptions {
  /** Attach every line to this target and skip IP lookups (per-target import). */
  forceTargetId?: number | null;
}

export interface IngestReport {
  linesParsed: number;
  logsInserted: number;
  duplicatesSkipped: number;
  cryptoEventsAdded: number;
  cryptoTotalAdded: number;
  ipsRecorded: number;
  walletsRecorded: number;
  softwareRecorded: number;
  reviewsRaised: number;
  targetsTouched: number[];
  unassignedWallets: string[];
  /** IPs that belonged to no target yet; each one became a new target. */
  unknownIps: string[];
  targetsCreated: { targetId: number; name: string }[];
  /** Wallets seen in full, and therefore marked cracked. */
  walletsCracked: number;
}

type TimestampMap = Map<number, Set<number>>;

function noteTimestamp(map: TimestampMap, timestamp: number, targetId: number): void {
  const existing = map.get(timestamp);
  if (existing) existing.add(targetId);
  else map.set(timestamp, new Set([targetId]));
}

/**
 * Which target was being broken into at this moment. Crypto lines name a wallet
 * but never an IP; the access line of the same break-in carries the IP and the
 * same printed timestamp, so the timestamp is the join. Returns null unless
 * exactly one target is a candidate — a wallet attached to the wrong target
 * corrupts its history forever, so ties refuse to resolve.
 */
function correlateByTimestamp(map: TimestampMap, timestamp: number): number | null {
  const exact = map.get(timestamp);
  if (exact && exact.size === 1) return [...exact][0];
  if (exact && exact.size > 1) return null;

  // Nothing at that exact moment, so look for the nearest one nearby.
  let bestDistance = Number.POSITIVE_INFINITY;
  let candidates = new Set<number>();

  for (const [candidateTime, targetIds] of map) {
    const distance = Math.abs(candidateTime - timestamp);
    if (distance > CORRELATION_WINDOW_MS) continue;

    if (distance < bestDistance) {
      bestDistance = distance;
      candidates = new Set(targetIds);
    } else if (distance === bestDistance) {
      // Equally close. Merge, so a disagreement shows up as ambiguity below.
      for (const id of targetIds) candidates.add(id);
    }
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}

/**
 * createTarget() opens its own transaction and SQLite can't nest them, so the
 * inserts are duplicated here. Score stays 0; the recalc pass fills it in.
 */
async function createTargetForIp(db: SQLiteDatabase, address: string): Promise<number> {
  const now = Date.now();
  const result = await db.runAsync(
    'INSERT INTO targets (name, device, date_added, attack_count) VALUES (?, NULL, ?, 0);',
    [address, now],
  );
  const targetId = result.lastInsertRowId;

  await db.runAsync(
    `INSERT INTO target_info (target_id, level, crypto, activity, potential_score, notes, last_updated)
     VALUES (?, 0, 0, 'REVIEW', 0, '', ?);`,
    [targetId, now],
  );
  return targetId;
}

/** Runs inside one transaction: an import fully applies or leaves the DB untouched. */
export async function ingestParsedLines(
  db: SQLiteDatabase,
  lines: ParsedLine[],
  options: IngestOptions = {},
): Promise<IngestReport> {
  const report: IngestReport = {
    linesParsed: lines.length,
    logsInserted: 0,
    duplicatesSkipped: 0,
    cryptoEventsAdded: 0,
    cryptoTotalAdded: 0,
    ipsRecorded: 0,
    walletsRecorded: 0,
    softwareRecorded: 0,
    reviewsRaised: 0,
    targetsTouched: [],
    unassignedWallets: [],
    unknownIps: [],
    targetsCreated: [],
    walletsCracked: 0,
  };

  const touched = new Set<number>();
  const unassignedWallets = new Set<string>();
  const unknownIps = new Set<string>();
  const targetsCreated: { targetId: number; name: string }[] = [];
  const crackedWallets = new Set<string>();

  const ipTargets = new Map<string, number>();
  const timestampTargets: TimestampMap = new Map();

  await db.withTransactionAsync(async () => {
    // Pass one: resolve every IP to a target first, so pass two has a complete
    // timestamp map for wallets that name no IP of their own.
    if (options.forceTargetId == null) {
      for (const line of lines) {
        if (line.ips.length === 0) continue;

        for (const ip of line.ips) {
          let targetId = ipTargets.get(ip) ?? null;

          if (targetId === null) {
            targetId = await findTargetIdByIp(db, ip);
          }

          if (targetId === null) {
            // A low-confidence line may attach to an existing target but never invents one.
            if (line.confidence < CONFIDENCE_THRESHOLD) continue;

            targetId = await createTargetForIp(db, ip);
            targetsCreated.push({ targetId, name: ip });
            unknownIps.add(ip);
          }

          ipTargets.set(ip, targetId);
          noteTimestamp(timestampTargets, line.timestamp, targetId);
        }
      }
    }

    // Pass two: apply every line.
    for (const line of lines) {
      let targetId: number | null = options.forceTargetId ?? null;

      if (targetId === null && line.ips.length > 0) {
        for (const ip of line.ips) {
          const found = ipTargets.get(ip) ?? (await findTargetIdByIp(db, ip));
          if (found != null) {
            targetId = found;
            break;
          }
        }
      }

      if (targetId === null && line.wallets.length > 0) {
        for (const wallet of line.wallets) {
          const found = await findTargetIdByWallet(db, wallet);
          if (found !== null) {
            targetId = found;
            break;
          }
        }
      }

      // Clock join: an ownerless wallet line matched to the break-in at the same moment.
      if (targetId === null && line.wallets.length > 0 && line.ips.length === 0) {
        targetId = correlateByTimestamp(timestampTargets, line.timestamp);
      }

      const logId = await insertLog(db, {
        targetId,
        rawLog: line.raw,
        timestamp: line.timestamp,
        rawTimestamp: line.rawTimestamp,
        eventType: line.eventType,
        cryptoExtracted: line.cryptoAmount,
        extractedIps: line.ips,
        extractedWallets: line.wallets,
        extractedSoftware: line.software,
        extractedSoftwareLevel: line.softwareLevel,
        parserConfidence: line.confidence,
        hash: line.hash,
      });

      // null = duplicate hash; skip entirely so nothing is counted twice.
      if (logId === null) {
        report.duplicatesSkipped++;
        continue;
      }
      report.logsInserted++;
      if (targetId !== null) touched.add(targetId);

      // Low confidence lines are parked in the review inbox, not applied.
      if (line.confidence < CONFIDENCE_THRESHOLD) {
        await createReview(db, {
          kind: line.eventType === 'UNKNOWN' ? 'UNPARSED' : 'LOW_CONFIDENCE',
          reason:
            line.eventType === 'UNKNOWN'
              ? 'This log line did not match any known pattern.'
              : `Only ${Math.round(line.confidence * 100)}% sure about this line.`,
          targetId,
          logId,
          payload: { raw: line.raw, ips: line.ips, wallets: line.wallets },
        });
        report.reviewsRaised++;
        continue;
      }

      for (const ip of line.ips) {
        if (targetId !== null) {
          await addIp(db, {
            targetId,
            address: ip,
            status: 'ACTIVE',
            source: 'PARSER',
            foundFromLogId: logId,
            discoveredAt: line.timestamp,
          });
          report.ipsRecorded++;
        }
      }

      // Ownerless wallets are still stored — crypto lines never contain an IP.
      const walletIds: number[] = [];
      for (const wallet of line.wallets) {
        // Seeing the full address is what proves a wallet cracked.
        const fullAddress = line.fullWallets.find((full) => walletsMatch(full, wallet)) ?? null;

        const walletId = await upsertWallet(db, {
          displayAddress: wallet,
          targetId,
          fullAddress,
          foundFromLogId: logId,
          discoveredAt: line.timestamp,
        });
        walletIds.push(walletId);
        report.walletsRecorded++;
        if (fullAddress !== null) crackedWallets.add(wallet);
        if (targetId === null) unassignedWallets.add(wallet);
      }

      if (line.cryptoAmount > 0) {
        await insertCryptoEvent(db, {
          targetId,
          walletId: walletIds[0] ?? null,
          amount: line.cryptoAmount,
          date: line.timestamp,
          source: line.eventType === 'CRYPTO_TRANSFER' ? 'TRANSFER' : 'STEAL',
          sourceLogId: logId,
        });
        report.cryptoEventsAdded++;
        report.cryptoTotalAdded += line.cryptoAmount;

        if (targetId === null) {
          await createReview(db, {
            kind: 'UNRESOLVED_WALLET',
            reason: `${line.cryptoAmount} crypto from a wallet with no known owner.`,
            logId,
            payload: {
              wallets: line.wallets,
              amount: line.cryptoAmount,
              raw: line.raw,
            },
          });
          report.reviewsRaised++;
        }
      }

      if (line.software && targetId !== null) {
        const softwareId = await ensureSoftware(db, line.software);
        await setInstalledSoftware(db, {
          targetId,
          softwareId,
          // A firewall we bypassed proves a firewall exists but not its level.
          level: line.softwareLevel ?? 1,
          owner: line.provesMySoftware ? 'MINE' : 'TARGET',
          source: 'PARSER',
          overwrite: false,
        });
        report.softwareRecorded++;
      }

      // Only completed accesses count, so one break-in isn't counted three
      // times by its start, success and upload lines.
      if (line.eventType === 'ACCESS' && targetId !== null) {
        await incrementAttackCount(db, targetId);
      }
    }
  });

  // Targets created in pass one need a score even if no line applied to them.
  for (const created of targetsCreated) touched.add(created.targetId);

  // Recalculate after commit so scores see the final crypto history.
  const targetIds = [...touched];
  await recalculateScores(db, targetIds);

  report.targetsTouched = targetIds;
  report.unassignedWallets = [...unassignedWallets];
  report.unknownIps = [...unknownIps];
  report.targetsCreated = targetsCreated;
  report.walletsCracked = crackedWallets.size;
  return report;
}

/**
 * Dry run of an import. Runs the same target resolution as the real import,
 * including timestamp correlation, so the counts match what would actually happen.
 */
export interface IngestPreview {
  totalLines: number;
  newLines: number;
  duplicateLines: number;
  cryptoTotal: number;
  knownTargets: { targetId: number; lines: number }[];
  /** IPs belonging to no target yet; each one will become a new target. */
  unknownIps: string[];
  unknownWallets: string[];
  targetsToCreate: string[];
  lowConfidence: number;
  byEventType: Record<string, number>;
}

export async function previewIngest(
  db: SQLiteDatabase,
  lines: ParsedLine[],
  existingHashes: Set<string>,
  options: IngestOptions = {},
): Promise<IngestPreview> {
  const preview: IngestPreview = {
    totalLines: lines.length,
    newLines: 0,
    duplicateLines: 0,
    cryptoTotal: 0,
    knownTargets: [],
    unknownIps: [],
    unknownWallets: [],
    targetsToCreate: [],
    lowConfidence: 0,
    byEventType: {},
  };

  const perTarget = new Map<number, number>();
  const unknownIps = new Set<string>();
  const unknownWallets = new Set<string>();

  // Would-be targets don't exist yet; negative placeholder ids keep them distinct
  // in the timestamp map without colliding with real row ids.
  const ipTargets = new Map<string, number>();
  const timestampTargets: TimestampMap = new Map();
  let nextPlaceholderId = -1;

  const fresh = lines.filter((line) => !existingHashes.has(line.hash));

  // Pass one: the same IP resolution the real import would do.
  if (options.forceTargetId == null) {
    for (const line of fresh) {
      for (const ip of line.ips) {
        let targetId = ipTargets.get(ip) ?? null;
        if (targetId === null) targetId = await findTargetIdByIp(db, ip);
        if (targetId === null) {
          if (line.confidence < CONFIDENCE_THRESHOLD) continue;
          targetId = nextPlaceholderId--;
          unknownIps.add(ip);
        }
        ipTargets.set(ip, targetId);
        noteTimestamp(timestampTargets, line.timestamp, targetId);
      }
    }
  }

  // Pass two: count what would happen.
  preview.duplicateLines = lines.length - fresh.length;

  for (const line of fresh) {
    preview.newLines++;
    preview.cryptoTotal += line.cryptoAmount;
    preview.byEventType[line.eventType] = (preview.byEventType[line.eventType] ?? 0) + 1;
    if (line.confidence < CONFIDENCE_THRESHOLD) preview.lowConfidence++;

    let targetId: number | null = options.forceTargetId ?? null;

    if (targetId === null) {
      for (const ip of line.ips) {
        const found = ipTargets.get(ip) ?? null;
        if (found !== null) {
          targetId = found;
          break;
        }
      }
    }
    if (targetId === null) {
      for (const wallet of line.wallets) {
        const found = await findTargetIdByWallet(db, wallet);
        if (found !== null) {
          targetId = found;
          break;
        }
      }
    }
    if (targetId === null && line.wallets.length > 0 && line.ips.length === 0) {
      targetId = correlateByTimestamp(timestampTargets, line.timestamp);
    }

    // Placeholders (negative ids) are reported through targetsToCreate instead.
    if (targetId !== null && targetId > 0) {
      perTarget.set(targetId, (perTarget.get(targetId) ?? 0) + 1);
    } else if (targetId === null) {
      for (const wallet of line.wallets) unknownWallets.add(wallet);
    }
  }

  preview.knownTargets = [...perTarget.entries()]
    .map(([targetId, count]) => ({ targetId, lines: count }))
    .sort((a, b) => b.lines - a.lines);
  preview.unknownIps = [...unknownIps];
  preview.targetsToCreate = [...unknownIps];
  preview.unknownWallets = [...unknownWallets];
  return preview;
}
