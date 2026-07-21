import { describe, expect, test } from 'bun:test';
import {
  contrast,
  deriveAccent,
  findTheme,
  THEME_OPTIONS,
} from './palette';

const BACKGROUND = '#0E1116';

describe('deriveAccent', () => {
  test('light accents get dark on-accent text, so white never sits on white', () => {
    expect(deriveAccent('#FFFFFF').accentText).toBe('#0E1116');
    expect(deriveAccent('#FFFF99').accentText).toBe('#0E1116');
    expect(deriveAccent('#3ED2D0').accentText).toBe('#0E1116');
  });

  test('dark accents keep white on-accent text', () => {
    expect(deriveAccent('#8B0000').accentText).toBe('#FFFFFF');
    expect(deriveAccent('#2424FF').accentText).toBe('#FFFFFF');
  });

  test('near-black accents are lightened until visible on the dark background', () => {
    const { accent } = deriveAccent('#000000');
    expect(accent).not.toBe('#000000');
    expect(contrast(accent, BACKGROUND)).toBeGreaterThanOrEqual(2.5);
  });

  test('already-bright accents pass through untouched', () => {
    expect(deriveAccent('#3ED2D0').accent).toBe('#3ED2D0');
    expect(deriveAccent('#FFFF00').accent).toBe('#FFFF00');
  });

  test('every theme option ends up readable on the dark background', () => {
    for (const option of THEME_OPTIONS) {
      const derived = deriveAccent(option.hex);
      expect(contrast(derived.accent, BACKGROUND)).toBeGreaterThanOrEqual(2.5);
      // And its label text is readable on the accent itself.
      expect(contrast(derived.accent, derived.accentText)).toBeGreaterThanOrEqual(2.5);
    }
  });
});

describe('findTheme', () => {
  test('falls back to Default for unknown or missing names', () => {
    expect(findTheme('Cyan').name).toBe('Cyan');
    expect(findTheme('Nonsense').name).toBe('Default');
    expect(findTheme(null).name).toBe('Default');
  });

  test('theme names are unique', () => {
    const names = THEME_OPTIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
