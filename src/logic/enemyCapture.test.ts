// Sample node texts are real uiautomator captures (window_dump5/6/7).

import { describe, expect, it } from 'bun:test';
import { classifyEnemyScreen, isConnectedToEnemy } from './enemyCapture';

/** window_dump5.xml — enemy home screen while connected. */
const PROFILE_TEXTS = [
  'CONNECTED',
  'DISCONNECT',
  '> Lord-Dumblestark _',
  'LVL 12',
  '//',
  'REP 6,799',
  '8,984 ',
  'SCORE',
  '// XP PROGRESS',
  '2887 / 7421',
  '39%',
  'WALLET',
  'APPS',
  'PROCESSES',
  'LOG',
  'CREWS',
  '// SYSTEM INFO',
  'IP',
  '94.172.36.66',
  'DEVICE',
  'Raider II',
  'NETWORK',
  'Cable',
  'FIREWALL',
  'Lv.6',
  'ENCRYPTOR',
  'Lv.4',
];

/** window_dump6.xml — enemy wallet screen. */
const WALLET_TEXTS = [
  '< back',
  'DISCONNECT',
  '// CRYPTO WALLET',
  "Lord-Dumblestark's wallet",
  'WALLET ADDRESS',
  'hx973bc81bfe269e0c05563ebb93ed4c',
  'HHOT WALLET811 CryptoCCOLD STORAGESecured12,991 Crypto/ 41,835 max',
  '// External Transfer',
  'Amount (Crypto)',
  'MAX',
  'TRANSFER TO MY WALLET',
];

/** window_dump7_a.xml — enemy apps screen (trimmed to the interesting parts). */
const APPS_TEXTS = [
  '< back',
  'DISCONNECT',
  '// APPS',
  "Lord-Dumblestark's installed software",
  '+ UPLOAD VIRUS 2 / 2 slots ▼',
  'Antivirus',
  'Scans and removes viruses. Restores 90% of lost reputation.',
  'LVL 5',
  '-17',
  'Spam',
  'Generates passive Crypto income from deployed devices.',
  'LVL 4',
  '-18',
  'Rootkit',
  'Weakens victim defenses for you and your crew.',
  'LVL 3',
  '-9',
  'Firewall',
  'Blocks unauthorized access. Higher levels increase bypass difficulty and duration for attackers.',
  'LVL 6',
  '-15',
  'Bypasser',
  'Bypasses target firewalls. Higher levels improve success rate and reduce hack time.',
  'LVL 6',
  '-20',
  'Password Cracker',
  'Cracks encrypted passwords to access victim devices.',
  'LVL 6',
  '-14',
  'Password Encryptor',
  'Encrypts your password. Higher levels make cracking harder and slower.',
  'LVL 4',
  '-16',
  'Proxy',
  'Routes traffic through proxy hops to mask IP when activated. Higher levels mask more octets and resist Trace.',
  'LVL 3',
  '-20',
  'Trace',
  'Traces connections back through proxy hops to reveal masked IPs. Higher levels have a greater chance of unmasking.',
  'LVL 3',
  '-17',
  'Keygen',
  'Hardware-bound key generator. Cannot be downloaded.',
  'LVL 9',
  'DEVICE-BOUND',
  'Siphon',
  "Skims a percentage of Crypto flowing through the victim's account.",
  'LVL 4',
  '-13',
];

/** window_dump_enemylog.xml — the enemy's LOG tab (red border in game). */
const ENEMY_LOG_TEXTS = [
  '< back',
  '// VICTIM LOG',
  'DISCONNECT',
  'SAVE',
  '~/victim_log.txt',
  '[7-20 18:20] Device accessed from xxx.xxx.xxx.xxx',
  '[7-20 16:40] Device accessed from 100.72.90.104 [TRACED]',
  '[7-20 14:13] 416 Crypto transferred to hxd2aa...45ec [TRACED]',
  '[7-20 14:13] Device accessed from 20.230.226.106 [TRACED]',
];

describe('isConnectedToEnemy', () => {
  it('sees the DISCONNECT marker on every enemy screen', () => {
    expect(isConnectedToEnemy(PROFILE_TEXTS)).toBe(true);
    expect(isConnectedToEnemy(WALLET_TEXTS)).toBe(true);
    expect(isConnectedToEnemy(APPS_TEXTS)).toBe(true);
  });

  it("sees it on the enemy LOG tab, so their log is never parsed as ours", () => {
    expect(isConnectedToEnemy(ENEMY_LOG_TEXTS)).toBe(true);
    expect(classifyEnemyScreen(ENEMY_LOG_TEXTS)).toBeNull();
  });

  it('is false on our own screens', () => {
    expect(isConnectedToEnemy(['// CRYPTO WALLET', 'My wallet', 'WALLET'])).toBe(false);
  });
});

describe('classifyEnemyScreen', () => {
  it('returns null when not connected', () => {
    expect(classifyEnemyScreen(['// SYSTEM INFO', 'IP', '1.2.3.4'])).toBeNull();
  });

  it('extracts the profile screen', () => {
    const screen = classifyEnemyScreen(PROFILE_TEXTS);
    expect(screen).toEqual({
      kind: 'profile',
      name: 'Lord-Dumblestark',
      level: 12,
      rep: 6799,
      score: 8984,
      ip: '94.172.36.66',
      device: 'Raider II',
      network: 'Cable',
      firewallLevel: 6,
      encryptorLevel: 4,
    });
  });

  it('strips the cursor and crew tag from the profile name', () => {
    // Seen live: "> LineTheNekomata _ [BINA]" duplicated the target.
    const texts = PROFILE_TEXTS.map((t) =>
      t === '> Lord-Dumblestark _' ? '> LineTheNekomata _ [BINA]' : t,
    );
    const screen = classifyEnemyScreen(texts);
    expect(screen?.name).toBe('LineTheNekomata');
  });

  it('rejects a masked IP on the profile screen', () => {
    const masked = PROFILE_TEXTS.map((t) => (t === '94.172.36.66' ? '94.172.xxx.xxx' : t));
    const screen = classifyEnemyScreen(masked);
    expect(screen?.kind).toBe('profile');
    if (screen?.kind === 'profile') expect(screen.ip).toBeNull();
  });

  it('extracts the wallet screen, including the concatenated balance run', () => {
    const screen = classifyEnemyScreen(WALLET_TEXTS);
    expect(screen).toEqual({
      kind: 'wallet',
      name: 'Lord-Dumblestark',
      fullAddress: 'hx973bc81bfe269e0c05563ebb93ed4c',
      hotCrypto: 811,
      coldCrypto: 12991,
    });
  });

  it('extracts every app on the apps screen, Keygen included', () => {
    const screen = classifyEnemyScreen(APPS_TEXTS);
    expect(screen?.kind).toBe('apps');
    if (screen?.kind !== 'apps') return;
    expect(screen.name).toBe('Lord-Dumblestark');
    expect(screen.software).toEqual([
      { name: 'Antivirus', level: 5 },
      { name: 'Spam', level: 4 },
      { name: 'Rootkit', level: 3 },
      { name: 'Firewall', level: 6 },
      { name: 'Bypasser', level: 6 },
      { name: 'Password Cracker', level: 6 },
      { name: 'Password Encryptor', level: 4 },
      { name: 'Proxy', level: 3 },
      { name: 'Trace', level: 3 },
      { name: 'Keygen', level: 9 },
      { name: 'Siphon', level: 4 },
    ]);
  });
});
