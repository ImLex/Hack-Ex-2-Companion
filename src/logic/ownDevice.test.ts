// Fixtures are real uiautomator captures (window_dump_settings.xml,
// window_dump_ownapps.xml, window_dump_home.xml).

import { describe, expect, test } from 'bun:test';
import {
  classifyOwnAppsScreen,
  classifyOwnSettingsScreen,
  extractPlayerLevel,
} from './ownDevice';

const SETTINGS_TEXTS = [
  '// MY DEVICE',
  'Notepad',
  'Wallet:',
  '13.079',
  'Credits:',
  '5',
  '> IP Address',
  'IP',
  '100.72.90.104',
  'PROXY',
  'ACTIVE',
  '106h 45m Remaining',
  '> System',
  'DEVICE',
  'Bolt III',
  'Lv ',
  '6',
  '3.6 GHz Quad Core',
  'NETWORK',
  'Quantum Link',
  'Lv ',
  '11',
  '25 gbps / 5 gbps',
  '> Wallpaper',
  '▾ NETRUNNER (8)',
  '> Account',
  'L3X',
  'Change Username',
  '> Guide / Help',
  'LOGOUT',
];

const OWN_APPS_TEXTS = [
  '// APPS',
  'Notepad',
  'Wallet:',
  '13.153',
  'SPAM',
  '40 ',
  '/ 64',
  'Botnet - Nexus',
  '3,444/hr',
  '82,656/day',
  'SIPHON4836,461 siphoned>',
  '▼ Installed Applications',
  'List view',
  'Grid view',
  'Antivirus',
  'LVL 22',
  'LOCKEDLVL 23 available7,513 Crypto',
  'Firewall',
  'LVL 21',
  'LOCKEDLVL 31 available18,651 Crypto',
  'Password Encryptor',
  'LVL 20',
  'Proxy ',
  'STEALTH',
  '106h 42m',
  'LVL 23',
  'Trace',
  'LVL 20',
  'Bypasser',
  'LVL 26',
  'Password Cracker',
  'LVL 20',
  'Spam ',
  '3,444/hr',
  'LVL 22',
  'Rootkit',
  'LVL 12',
  'Siphon ',
  '36,461 siphoned',
  'LVL 17',
  'Keygen',
  'LVL 26',
  'Notepad',
  'Message Encryptor',
  '▼ Consumables',
  'Wallet Shield',
];

const HOME_TEXTS = ['> L3X_', 'MY DEVICE', 'LVL 41', '//', 'REP 29489', '92,263 ', 'SCORE'];

describe('classifyOwnSettingsScreen', () => {
  test('reads IP, proxy, device and network off the settings screen', () => {
    expect(classifyOwnSettingsScreen(SETTINGS_TEXTS)).toEqual({
      ip: '100.72.90.104',
      proxyActive: true,
      proxyRemaining: '106h 45m',
      deviceName: 'Bolt III',
      deviceLevel: 6,
      deviceSpec: '3.6 GHz Quad Core',
      networkName: 'Quantum Link',
      networkLevel: 11,
      networkSpeed: '25 gbps / 5 gbps',
    });
  });

  test('returns null on other screens', () => {
    expect(classifyOwnSettingsScreen(OWN_APPS_TEXTS)).toBeNull();
    expect(classifyOwnSettingsScreen(HOME_TEXTS)).toBeNull();
  });

  test('returns null while connected to an enemy', () => {
    expect(classifyOwnSettingsScreen(['DISCONNECT', ...SETTINGS_TEXTS])).toBeNull();
  });
});

describe('classifyOwnAppsScreen', () => {
  test('reads every software level, Keygen included', () => {
    const data = classifyOwnAppsScreen(OWN_APPS_TEXTS);
    expect(data?.software).toEqual([
      { name: 'Antivirus', level: 22 },
      { name: 'Firewall', level: 21 },
      { name: 'Password Encryptor', level: 20 },
      { name: 'Proxy', level: 23 },
      { name: 'Trace', level: 20 },
      { name: 'Bypasser', level: 26 },
      { name: 'Password Cracker', level: 20 },
      { name: 'Spam', level: 22 },
      { name: 'Rootkit', level: 12 },
      { name: 'Siphon', level: 17 },
      { name: 'Keygen', level: 26 },
    ]);
  });

  test("never reads an enemy's software list", () => {
    expect(classifyOwnAppsScreen(['DISCONNECT', ...OWN_APPS_TEXTS])).toBeNull();
  });

  test('returns null on other screens', () => {
    expect(classifyOwnAppsScreen(SETTINGS_TEXTS)).toBeNull();
  });
});

describe('extractPlayerLevel', () => {
  test('reads LVL off the own home screen', () => {
    expect(extractPlayerLevel(HOME_TEXTS)).toBe(41);
  });

  test('ignores software LVL rows without a home-screen context caller', () => {
    // The caller only invokes this after detecting the own home screen,
    // but the regex itself must not match "LVL 22" concatenations elsewhere.
    expect(extractPlayerLevel(['LOCKEDLVL 23 available7,513 Crypto'])).toBeNull();
  });
});
