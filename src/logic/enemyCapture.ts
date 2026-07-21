// Structured intel from the enemy screens (profile / wallet / apps) shown while
// connected to a player. The player's name appears on all three and is the join key.

import type { SQLiteDatabase } from 'expo-sqlite';
import { SOFTWARE_ORDER } from '@/db/seed';
import {
  addIp,
  assignWalletToTarget,
  ensureSoftware,
  findTargetIdByIp,
  findTargetIdByWallet,
  setInstalledSoftware,
  upsertWallet,
} from '@/db/repo/intel';
import {
  createTarget,
  findTargetByName,
  getTarget,
  mergeTargets,
  touchTargetSeen,
  updateTarget,
  updateTargetInfo,
} from '@/db/repo/targets';

export interface EnemyProfile {
  kind: 'profile';
  name: string;
  level: number | null;
  rep: number | null;
  score: number | null;
  ip: string | null;
  device: string | null;
  network: string | null;
  firewallLevel: number | null;
  encryptorLevel: number | null;
}

export interface EnemyWallet {
  kind: 'wallet';
  name: string;
  fullAddress: string | null;
  hotCrypto: number | null;
  coldCrypto: number | null;
}

export interface EnemyApps {
  kind: 'apps';
  name: string;
  software: { name: string; level: number }[];
}

export type EnemyScreen = EnemyProfile | EnemyWallet | EnemyApps;

/** Full IPv4 only — masked IPs render as "94.172.xxx.xxx". */
const FULL_IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** Full wallet address; log lines only ever show the shortened 6+4 form. */
const FULL_WALLET_RE = /\bhx[0-9a-fA-F]{16,}\b/;

const LEVEL_VALUE_RE = /^Lv\.?\s*(\d+)$/i;

// Keygen isn't in the catalogue (can't be installed on a target), but the enemy's
// screen shows theirs, so recognise it.
const KNOWN_SOFTWARE = new Set(
  [...SOFTWARE_ORDER, 'Keygen'].map((name) => name.toLowerCase()),
);

// The profile prompt renders as "> Name _ [CREWTAG]"; the cursor and crew tag
// must be stripped or the same player gets duplicated under two names.
export function cleanPlayerName(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, '')
    .replace(/(^|\s)_+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function isConnectedToEnemy(texts: string[]): boolean {
  return texts.some((t) => t === 'DISCONNECT' || t === 'CONNECTED');
}

/** Returns null when the snapshot is not an enemy screen. */
export function classifyEnemyScreen(texts: string[]): EnemyScreen | null {
  if (!isConnectedToEnemy(texts)) return null;

  for (const text of texts) {
    const wallet = text.match(/^(.+)'s wallet$/);
    if (wallet) return extractWallet(wallet[1], texts);

    const apps = text.match(/^(.+)'s installed software$/);
    if (apps) return extractApps(apps[1], texts);
  }

  if (texts.some((t) => t.includes('SYSTEM INFO'))) return extractProfile(texts);

  return null;
}

function extractProfile(texts: string[]): EnemyProfile | null {
  // The name renders as a terminal prompt: "> Lord-Dumblestark _".
  let name: string | null = null;
  let level: number | null = null;
  let rep: number | null = null;
  let score: number | null = null;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!name) {
      const match = text.match(/^>\s*(\S.*)$/);
      if (match) {
        const cleaned = cleanPlayerName(match[1]);
        if (cleaned) name = cleaned;
      }
      continue;
    }
    const lvl = text.match(/^LVL\s+([\d,]+)$/);
    if (lvl) level = toNumber(lvl[1]);
    const repMatch = text.match(/^REP\s+([\d,]+)$/);
    if (repMatch) rep = toNumber(repMatch[1]);
    if (text === 'SCORE' && i > 0) score = toNumber(texts[i - 1].trim());
  }
  if (!name) return null;

  // SYSTEM INFO is label-then-value pairs in node order.
  const valueAfter = (label: string): string | null => {
    const index = texts.findIndex((t) => t === label);
    return index >= 0 && index + 1 < texts.length ? texts[index + 1] : null;
  };
  const levelAfter = (label: string): number | null => {
    const match = valueAfter(label)?.match(LEVEL_VALUE_RE);
    return match ? toNumber(match[1]) : null;
  };

  const rawIp = valueAfter('IP');
  return {
    kind: 'profile',
    name,
    level,
    rep,
    score,
    ip: rawIp && FULL_IP_RE.test(rawIp) ? rawIp : null,
    device: valueAfter('DEVICE'),
    network: valueAfter('NETWORK'),
    firewallLevel: levelAfter('FIREWALL'),
    encryptorLevel: levelAfter('ENCRYPTOR'),
  };
}

function extractWallet(name: string, texts: string[]): EnemyWallet {
  // The WebView flattens this screen into concatenated runs like
  // "HHOT WALLET811 CryptoCCOLD STORAGESecured...", so match the joined text.
  const joined = texts.join('\n');
  const hot = joined.match(/HOT WALLET\s*([\d,.]+)\s*Crypto/);
  const cold = joined.match(/COLD STORAGE(?:\s*Secured)?\s*([\d,.]+)\s*Crypto/);

  return {
    kind: 'wallet',
    name,
    fullAddress: joined.match(FULL_WALLET_RE)?.[0] ?? null,
    hotCrypto: hot ? toNumber(hot[1]) : null,
    coldCrypto: cold ? toNumber(cold[1]) : null,
  };
}

function extractApps(name: string, texts: string[]): EnemyApps {
  const software: { name: string; level: number }[] = [];
  let pending: string | null = null;

  for (const text of texts) {
    const catalogued = KNOWN_SOFTWARE.has(text.trim().toLowerCase());
    if (catalogued) {
      pending = text.trim();
      continue;
    }
    if (pending) {
      const lvl = text.match(/^LVL\s+(\d+)$/);
      if (lvl) {
        software.push({ name: pending, level: Number(lvl[1]) });
        pending = null;
      }
    }
  }

  return { kind: 'apps', name, software };
}

export interface EnemyCaptureReport {
  targetId: number;
  created: boolean;
  softwareRecorded: number;
  walletCaptured: boolean;
}

/** The game names the defence "ENCRYPTOR"; the catalogue "Password Encryptor". */
const DEFENCE_NAMES: Record<string, string> = {
  FIREWALL: 'Firewall',
  ENCRYPTOR: 'Password Encryptor',
};

/**
 * IP-named placeholder targets get upgraded to the real name; human-typed names
 * are left alone. If IP and name hit two different records, this screen proves
 * they are the same player, so the records are merged.
 */
async function resolveTarget(
  db: SQLiteDatabase,
  name: string,
  ip: string | null,
): Promise<{ targetId: number; created: boolean }> {
  const byName = await findTargetByName(db, name);
  if (ip) {
    const byIp = await findTargetIdByIp(db, ip);
    if (byIp !== null) {
      if (byName && byName.id !== byIp) {
        await mergeTargets(db, byName.id, byIp);
        await updateTarget(db, byIp, { name });
        return { targetId: byIp, created: false };
      }
      const target = await getTarget(db, byIp);
      if (target && FULL_IP_RE.test(target.name)) {
        await updateTarget(db, byIp, { name });
      }
      return { targetId: byIp, created: false };
    }
  }
  if (byName) return { targetId: byName.id, created: false };
  return { targetId: await createTarget(db, { name }), created: true };
}

export async function ingestEnemyScreen(
  db: SQLiteDatabase,
  screen: EnemyScreen,
  capturedAt: number,
): Promise<EnemyCaptureReport> {
  const { targetId, created } = await resolveTarget(
    db,
    screen.name,
    screen.kind === 'profile' ? screen.ip : null,
  );
  const report: EnemyCaptureReport = {
    targetId,
    created,
    softwareRecorded: 0,
    walletCaptured: false,
  };

  // Any screen proves a visit — an empty wallet leaves no log line, but the
  // target should still surface under the "recent" sort.
  await touchTargetSeen(db, targetId, capturedAt);

  if (screen.kind === 'profile') {
    if (screen.ip) {
      await addIp(db, {
        targetId,
        address: screen.ip,
        status: 'ACTIVE',
        source: 'PARSER',
        discoveredAt: capturedAt,
      });
    }
    if (screen.device) await updateTarget(db, targetId, { device: screen.device });
    if (screen.level !== null) {
      await updateTargetInfo(db, targetId, { level: screen.level, activity: 'ACTIVE' });
    }
    for (const [label, level] of [
      ['FIREWALL', screen.firewallLevel],
      ['ENCRYPTOR', screen.encryptorLevel],
    ] as const) {
      if (level === null) continue;
      const softwareId = await ensureSoftware(db, DEFENCE_NAMES[label]);
      await setInstalledSoftware(db, {
        targetId,
        softwareId,
        level,
        owner: 'TARGET',
        source: 'PARSER',
        overwrite: false,
      });
      report.softwareRecorded++;
    }
  }

  if (screen.kind === 'wallet' && screen.fullAddress) {
    const walletId = await upsertWallet(db, {
      displayAddress: screen.fullAddress,
      fullAddress: screen.fullAddress,
      targetId,
      discoveredAt: capturedAt,
    });
    // Credit any historic orphaned crypto events to the wallet's current owner.
    const ownerId = await findTargetIdByWallet(db, screen.fullAddress);
    if (ownerId !== null) await assignWalletToTarget(db, walletId, ownerId);
    report.walletCaptured = true;

    if (screen.hotCrypto !== null) {
      // Cold storage is secured and can't be stolen; only the hot balance feeds the score.
      await updateTargetInfo(db, targetId, { crypto: screen.hotCrypto });
    }
  }

  if (screen.kind === 'apps') {
    for (const app of screen.software) {
      const softwareId = await ensureSoftware(db, app.name);
      await setInstalledSoftware(db, {
        targetId,
        softwareId,
        level: app.level,
        owner: 'TARGET',
        source: 'PARSER',
        overwrite: false,
      });
      report.softwareRecorded++;
    }
  }

  return report;
}
