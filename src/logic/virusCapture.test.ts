// Fixtures are lifted from real accessibility dumps of the APPS screen
// (window_dump_spam1.xml / window_dump_siphon1.xml).

import { describe, expect, test } from 'bun:test';
import { classifySiphonScreen, classifySpamScreen } from './virusCapture';

const SPAM_TEXTS = [
  '// APPS',
  'Wallet:',
  '8.793',
  'SPAM',
  '40 ',
  '/ 64',
  'Botnet - Nexus',
  '3,444/hr',
  '82,656/day',
  'SIPHON4836,215 siphoned>',
  '▼ Installed Applications',
  'Spam ',
  '3,444/hr',
  'LVL 22',
  'SPAM EARNINGS',
  'DEPLOYED',
  '40',
  'RATE',
  '3,444/hr',
  'DAILY',
  '82,656/d',
  'Botnet - Nexus',
  '40/64 slots',
  '19% fee',
  'CURRENT DEPLOYED EARNED',
  '461,898',
  'DAILY BOTNET FEES',
  '15,705 ',
  '/ day',
  '246.236.98.91',
  'LV.21',
  '100/hr',
  '12,860 earned',
  '6d',
  'xxx.xxx.xxx.xxx',
  'LV.22',
  '100/hr',
  '5,966 earned',
  '3d',
  '105.79.195.32',
  'LV.21',
  '100/hr',
  '12,434 earned',
  '6d',
];

const SIPHON_TEXTS = [
  '// APPS',
  'Wallet:',
  '10.867',
  'SIPHON4836,225 siphoned>',
  '▼ Installed Applications',
  'Siphon ',
  '36,225 siphoned',
  'LVL 17',
  'SIPHON EARNINGS',
  'DEPLOYED',
  '48',
  'TOTAL SIPHONED',
  '36,225',
  '52.85.72.123',
  'LV.7',
  '2.5%',
  '2,918 siphoned',
  '30d ago',
  '204.31.xxx.xxx',
  'LV.17',
  '5%',
  '440 siphoned',
  '17h ago',
  '166.213.200.73',
  'LV.17',
  '5%',
  '332 siphoned',
  '7h ago',
];

describe('classifySpamScreen', () => {
  test('returns null when the panel is not on screen', () => {
    expect(classifySpamScreen(SIPHON_TEXTS)).toBeNull();
    expect(classifySpamScreen(['HOME', 'SCAN', 'APPS'])).toBeNull();
  });

  test('parses the summary numbers', () => {
    const data = classifySpamScreen(SPAM_TEXTS);
    expect(data).not.toBeNull();
    expect(data!.summary).toEqual({
      kind: 'SPAM',
      deployed: 40,
      slotsUsed: 40,
      slotsTotal: 64,
      ratePerHour: 3444,
      dailyRate: 82656,
      botnet: 'Nexus',
      feePercent: 19,
      totalEarned: 461898,
      dailyFees: 15705,
    });
  });

  test('extracts rows and skips the fully masked address', () => {
    const data = classifySpamScreen(SPAM_TEXTS)!;
    expect(data.rows.map((row) => row.address)).toEqual(['246.236.98.91', '105.79.195.32']);
    expect(data.rows[0]).toEqual({
      address: '246.236.98.91',
      level: 21,
      ratePerHour: 100,
      percent: null,
      earned: 12860,
      ageDays: 6,
    });
  });
});

describe('classifySiphonScreen', () => {
  test('returns null when the panel is not on screen', () => {
    expect(classifySiphonScreen(SPAM_TEXTS)).toBeNull();
  });

  test('parses the summary numbers', () => {
    const data = classifySiphonScreen(SIPHON_TEXTS);
    expect(data).not.toBeNull();
    expect(data!.summary).toEqual({
      kind: 'SIPHON',
      deployed: 48,
      totalSiphoned: 36225,
    });
  });

  test('extracts rows with percent, keeps partial masks, parses hour ages', () => {
    const data = classifySiphonScreen(SIPHON_TEXTS)!;
    expect(data.rows).toEqual([
      {
        address: '52.85.72.123',
        level: 7,
        ratePerHour: null,
        percent: 2.5,
        earned: 2918,
        ageDays: 30,
      },
      {
        address: '204.31.xxx.xxx',
        level: 17,
        ratePerHour: null,
        percent: 5,
        earned: 440,
        ageDays: 17 / 24,
      },
      {
        address: '166.213.200.73',
        level: 17,
        ratePerHour: null,
        percent: 5,
        earned: 332,
        ageDays: 7 / 24,
      },
    ]);
  });
});

describe('both panels expanded in one snapshot', () => {
  const COMBINED = [...SPAM_TEXTS, ...SIPHON_TEXTS];

  test('the earned/siphoned word keeps each panel to its own rows', () => {
    const spam = classifySpamScreen(COMBINED)!;
    expect(spam.rows.map((row) => row.address)).toEqual(['246.236.98.91', '105.79.195.32']);
    const siphon = classifySiphonScreen(COMBINED)!;
    expect(siphon.rows.map((row) => row.address)).toEqual([
      '52.85.72.123',
      '204.31.xxx.xxx',
      '166.213.200.73',
    ]);
  });
});
