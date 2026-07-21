// Checked against the worked example tables in the original spec.

import { describe, expect, it } from 'bun:test';
import { isTenKPlus, thresholdsFor, tierFor, thresholdFor } from './valueScale';

describe('thresholdsFor — spec example tables', () => {
  it('matches the level 30 reference values', () => {
    expect(thresholdsFor(30)).toEqual({
      LOW: 250,
      MEDIUM: 500,
      HIGH: 1000,
      ULTRA: 1500,
      GODLY: 2500,
    });
  });

  it('matches the level 1 table', () => {
    expect(thresholdsFor(1)).toEqual({
      LOW: 8,
      MEDIUM: 16,
      HIGH: 33,
      ULTRA: 50,
      GODLY: 83,
    });
  });

  it('matches the level 10 table', () => {
    expect(thresholdsFor(10)).toEqual({
      LOW: 83,
      MEDIUM: 166,
      HIGH: 333,
      ULTRA: 500,
      GODLY: 833,
    });
  });

  // The spec's level 20 table rounds up (167/334/…) but its own formula gives
  // 166.6; we follow the formula, which matches levels 1, 10 and 30 exactly.
  it('follows the formula at level 20, not the inconsistent table', () => {
    expect(thresholdsFor(20)).toEqual({
      LOW: 166,
      MEDIUM: 333,
      HIGH: 666,
      ULTRA: 1000,
      GODLY: 1666,
    });
  });

  it('scales to zero at level 0', () => {
    expect(thresholdFor(0, 'GODLY')).toBe(0);
  });
});

describe('tierFor', () => {
  it('picks the highest tier a target clears', () => {
    expect(tierFor(30, 2500)).toBe('GODLY');
    expect(tierFor(30, 2499)).toBe('ULTRA');
    expect(tierFor(30, 1000)).toBe('HIGH');
    expect(tierFor(30, 500)).toBe('MEDIUM');
    expect(tierFor(30, 250)).toBe('LOW');
  });

  it('returns null below the LOW line', () => {
    expect(tierFor(30, 249)).toBeNull();
    expect(tierFor(30, 0)).toBeNull();
  });

  it('judges a target against its own level, not an absolute number', () => {
    // At level 5 the tier lines sit at 41 / 83 / 166 / 250 / 416.
    expect(tierFor(30, 400)).toBe('LOW');
    expect(tierFor(5, 400)).toBe('ULTRA');
    expect(tierFor(5, 420)).toBe('GODLY');
  });

  it('never awards a tier at level 0, where every threshold is zero', () => {
    expect(tierFor(0, 5000)).toBeNull();
  });
});

describe('isTenKPlus', () => {
  it('flags targets holding double the GODLY line', () => {
    expect(isTenKPlus(30, 5000)).toBe(true);
    expect(isTenKPlus(30, 4999)).toBe(false);
  });
});
