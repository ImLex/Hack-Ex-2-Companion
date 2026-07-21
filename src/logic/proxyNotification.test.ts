import { describe, expect, test } from 'bun:test';
import {
  formatDurationMs,
  parseDurationMs,
  planProxyNotification,
  proxyExpiresAt,
} from './proxyNotification';
import type { OwnDeviceInfo } from '@/db/repo/ownDevice';

const HOUR = 3_600_000;
const MINUTE = 60_000;

function device(overrides: Partial<OwnDeviceInfo> = {}): OwnDeviceInfo {
  return {
    ip: '100.72.90.104',
    proxyActive: true,
    proxyRemaining: '106h 45m',
    deviceName: 'Bolt III',
    deviceLevel: 6,
    deviceSpec: '3.6 GHz Quad Core',
    networkName: 'Quantum Link',
    networkLevel: 11,
    networkSpeed: '25 gbps / 5 gbps',
    capturedAt: 1_000_000,
    ...overrides,
  };
}

describe('parseDurationMs', () => {
  test('reads hours and minutes as the game prints them', () => {
    expect(parseDurationMs('106h 45m')).toBe(106 * HOUR + 45 * MINUTE);
    expect(parseDurationMs('45m')).toBe(45 * MINUTE);
    expect(parseDurationMs('106h')).toBe(106 * HOUR);
    expect(parseDurationMs(' 2h 5m ')).toBe(2 * HOUR + 5 * MINUTE);
  });

  test('rejects anything else', () => {
    expect(parseDurationMs('')).toBeNull();
    expect(parseDurationMs('Remaining')).toBeNull();
    expect(parseDurationMs('106')).toBeNull();
  });
});

describe('formatDurationMs', () => {
  test('mirrors the game format', () => {
    expect(formatDurationMs(106 * HOUR + 45 * MINUTE)).toBe('106h 45m');
    expect(formatDurationMs(45 * MINUTE)).toBe('45m');
    expect(formatDurationMs(2 * HOUR)).toBe('2h');
    expect(formatDurationMs(0)).toBe('0m');
    expect(formatDurationMs(-5 * MINUTE)).toBe('0m');
  });
});

describe('proxyExpiresAt', () => {
  test('anchors the remaining time to the capture moment', () => {
    expect(proxyExpiresAt(device())).toBe(1_000_000 + 106 * HOUR + 45 * MINUTE);
  });

  test('null when there is no capture, no proxy, or an unreadable timer', () => {
    expect(proxyExpiresAt(null)).toBeNull();
    expect(proxyExpiresAt(device({ proxyActive: false }))).toBeNull();
    expect(proxyExpiresAt(device({ proxyRemaining: null }))).toBeNull();
    expect(proxyExpiresAt(device({ proxyRemaining: 'soonish' }))).toBeNull();
  });
});

describe('planProxyNotification', () => {
  const prefs = { enabled: true, thresholdMinutes: 12 * 60 };
  const expiresAt = 1_000_000 + 106 * HOUR + 45 * MINUTE;

  test('schedules threshold minutes before expiry', () => {
    const now = 1_000_000;
    expect(planProxyNotification(prefs, device(), now)).toEqual({
      kind: 'scheduled',
      at: expiresAt - 12 * HOUR,
      expiresAt,
    });
  });

  test('fires immediately when already inside the warning window', () => {
    const now = expiresAt - HOUR;
    expect(planProxyNotification(prefs, device(), now)).toEqual({
      kind: 'immediate',
      expiresAt,
    });
  });

  test('stays silent when disabled, expired, or without a timer', () => {
    expect(planProxyNotification({ ...prefs, enabled: false }, device(), 0)).toEqual({
      kind: 'none',
    });
    expect(planProxyNotification(prefs, device(), expiresAt)).toEqual({ kind: 'none' });
    expect(planProxyNotification(prefs, device(), expiresAt + HOUR)).toEqual({ kind: 'none' });
    expect(planProxyNotification(prefs, null, 0)).toEqual({ kind: 'none' });
  });
});
