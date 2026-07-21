// Home-screen texts are from a real uiautomator capture (window_dump_home.xml).

import { describe, expect, it } from 'bun:test';
import { defaultRegistry, detectOwnAccountName, resolveDetectedAccount } from './accounts';

/** Own dashboard — the account name renders as a terminal prompt. */
const HOME_TEXTS = [
  '> L3X_',
  'MY DEVICE',
  'LVL 41',
  '//',
  'REP 29489',
  '92,263 ',
  'SCORE',
  '// XP PROGRESS',
  '20545 / 36330',
  '57%',
  '// CRYPTO',
  '8,648',
  'SCAN',
  'PROCESSES',
];

/** Enemy profile also has a "> Name" prompt but is always CONNECTED. */
const ENEMY_TEXTS = [
  'CONNECTED',
  'DISCONNECT',
  '> Lord-Dumblestark _',
  'LVL 12',
  '// SYSTEM INFO',
];

describe('detectOwnAccountName', () => {
  it('reads the name off the own home screen, dropping the glued cursor', () => {
    // Rendered "L3X_" is nickname "L3X" plus the game's blinking cursor.
    expect(detectOwnAccountName(HOME_TEXTS)).toBe('L3X');
  });

  it('ignores enemy screens', () => {
    expect(detectOwnAccountName(ENEMY_TEXTS)).toBeNull();
  });

  it('ignores screens without the MY DEVICE anchor', () => {
    expect(detectOwnAccountName(['> L3X_', 'LVL 41'])).toBeNull();
  });

  it('keeps a real trailing underscore when the cursor follows it', () => {
    // Nickname "L3X_" renders as "L3X__" once the cursor is appended.
    expect(detectOwnAccountName(['> L3X__', 'MY DEVICE'])).toBe('L3X_');
  });

  it('strips a crew tag from the prompt', () => {
    expect(detectOwnAccountName(['> L3X_ [CREW]', 'MY DEVICE'])).toBe('L3X');
  });
});

describe('resolveDetectedAccount', () => {
  it('first sighting claims the default database', () => {
    const outcome = resolveDetectedAccount(defaultRegistry(), 'L3X_', 1000);
    expect(outcome.switched).toBe(false);
    expect(outcome.registry.accounts).toHaveLength(1);
    expect(outcome.registry.accounts[0]).toMatchObject({
      name: 'L3X_',
      dbName: 'trakker3.db',
      lastSeenAt: 1000,
    });
  });

  it('a second name creates a new database and switches to it', () => {
    const first = resolveDetectedAccount(defaultRegistry(), 'L3X_', 1000).registry;
    const outcome = resolveDetectedAccount(first, 'AltAcct', 2000);
    expect(outcome.switched).toBe(true);
    expect(outcome.registry.accounts).toHaveLength(2);
    expect(outcome.registry.activeDbName).toBe('trakker3-altacct.db');
  });

  it('seeing a known inactive account switches back to its database', () => {
    const first = resolveDetectedAccount(defaultRegistry(), 'L3X_', 1000).registry;
    const second = resolveDetectedAccount(first, 'AltAcct', 2000).registry;
    const outcome = resolveDetectedAccount(second, 'L3X_', 3000);
    expect(outcome.switched).toBe(true);
    expect(outcome.registry.activeDbName).toBe('trakker3.db');
    expect(outcome.registry.accounts.find((a) => a.name === 'L3X_')?.lastSeenAt).toBe(3000);
  });

  it('seeing the active account only bumps lastSeenAt', () => {
    const first = resolveDetectedAccount(defaultRegistry(), 'L3X_', 1000).registry;
    const outcome = resolveDetectedAccount(first, 'L3X_', 2000);
    expect(outcome.switched).toBe(false);
    expect(outcome.registry.accounts).toHaveLength(1);
    expect(outcome.registry.accounts[0].lastSeenAt).toBe(2000);
  });

  it('names that slug to nothing still get a usable db file', () => {
    const first = resolveDetectedAccount(defaultRegistry(), 'L3X_', 1000).registry;
    const outcome = resolveDetectedAccount(first, '___', 2000);
    expect(outcome.registry.activeDbName).toMatch(/^trakker3-.+\.db$/);
  });
});
