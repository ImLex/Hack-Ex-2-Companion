// Warns before the proxy mask runs out. The game's Settings screen gives an
// exact expiry (capture time + "106h 45m Remaining"); the user picks how long
// before that moment the warning should fire. Re-synced after every capture,
// so the alarm follows the freshest timer.
//
// expo-notifications is only ever imported lazily — this module must stay
// loadable in bun tests and on web, where the native module does not exist.

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '@/db/repo/settings';
import { getOwnDevice, type OwnDeviceInfo } from '@/db/repo/ownDevice';

const KEY_ENABLED = 'notify.proxy.enabled';
const KEY_THRESHOLD = 'notify.proxy.thresholdMinutes';
const KEY_SCHEDULED_ID = 'notify.proxy.scheduledId';
const KEY_NOTIFIED_FOR = 'notify.proxy.notifiedFor';

const CHANNEL_ID = 'proxy-warnings';

export const DEFAULT_THRESHOLD_MINUTES = 12 * 60;

export interface ProxyNotifyPrefs {
  enabled: boolean;
  thresholdMinutes: number;
}

/** "106h 45m" / "45m" / "106h" → milliseconds; null when unreadable. */
export function parseDurationMs(text: string): number | null {
  const match = text.trim().match(/^(?:(\d+)h)?\s*(?:(\d+)m)?$/);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000;
}

export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** When the proxy runs out, from the last capture; null when unknown or inactive. */
export function proxyExpiresAt(device: OwnDeviceInfo | null): number | null {
  if (!device || !device.proxyActive || !device.proxyRemaining) return null;
  const duration = parseDurationMs(device.proxyRemaining);
  return duration === null ? null : device.capturedAt + duration;
}

export type ProxyNotifyPlan =
  | { kind: 'none' }
  | { kind: 'immediate'; expiresAt: number }
  | { kind: 'scheduled'; at: number; expiresAt: number };

export function planProxyNotification(
  prefs: ProxyNotifyPrefs,
  device: OwnDeviceInfo | null,
  now: number,
): ProxyNotifyPlan {
  if (!prefs.enabled) return { kind: 'none' };
  const expiresAt = proxyExpiresAt(device);
  // Already expired: warning would be nagging, not warning.
  if (expiresAt === null || expiresAt <= now) return { kind: 'none' };
  const at = expiresAt - prefs.thresholdMinutes * 60_000;
  if (at <= now) return { kind: 'immediate', expiresAt };
  return { kind: 'scheduled', at, expiresAt };
}

export async function getProxyNotifyPrefs(db: SQLiteDatabase): Promise<ProxyNotifyPrefs> {
  const [enabled, threshold] = await Promise.all([
    getSetting(db, KEY_ENABLED),
    getSetting(db, KEY_THRESHOLD),
  ]);
  const parsed = Number.parseInt(threshold ?? '', 10);
  return {
    enabled: enabled === '1',
    thresholdMinutes:
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_MINUTES,
  };
}

export async function setProxyNotifyPrefs(
  db: SQLiteDatabase,
  prefs: ProxyNotifyPrefs,
): Promise<void> {
  await setSetting(db, KEY_ENABLED, prefs.enabled ? '1' : '0');
  await setSetting(db, KEY_THRESHOLD, String(Math.max(1, Math.round(prefs.thresholdMinutes))));
}

/** Asks Android for notification permission. True when allowed. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const Notifications = await import('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

/**
 * Cancels and reschedules the warning to match the current prefs and the
 * freshest proxy capture. Cheap and idempotent — runs after every auto-import.
 */
export async function syncProxyNotification(db: SQLiteDatabase): Promise<void> {
  try {
    const prefs = await getProxyNotifyPrefs(db);
    const device = await getOwnDevice(db);
    const plan = planProxyNotification(prefs, device, Date.now());

    const Notifications = await import('expo-notifications');

    const previousId = await getSetting(db, KEY_SCHEDULED_ID);
    if (previousId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(previousId);
      } catch {}
      await setSetting(db, KEY_SCHEDULED_ID, '');
    }
    if (plan.kind === 'none') return;

    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;

    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Proxy warnings',
      importance: Notifications.AndroidImportance.HIGH,
    });

    if (plan.kind === 'immediate') {
      // Only once per proxy activation, or every app open would nag again.
      const alreadyFor = await getSetting(db, KEY_NOTIFIED_FOR);
      if (alreadyFor === String(plan.expiresAt)) return;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Proxy running out',
          body: `About ${formatDurationMs(plan.expiresAt - Date.now())} left on your proxy. Renew it in Hack EX 2 before your IP goes bare.`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 1,
          channelId: CHANNEL_ID,
        },
      });
      await setSetting(db, KEY_NOTIFIED_FOR, String(plan.expiresAt));
      return;
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Proxy running out',
        body: `Under ${formatDurationMs(prefs.thresholdMinutes * 60_000)} left on your proxy. Renew it in Hack EX 2 before your IP goes bare.`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: plan.at,
        channelId: CHANNEL_ID,
      },
    });
    await setSetting(db, KEY_SCHEDULED_ID, id);
    await setSetting(db, KEY_NOTIFIED_FOR, String(plan.expiresAt));
  } catch {
    // Web or missing native module: notifications simply stay off.
  }
}
