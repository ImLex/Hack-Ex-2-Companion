// The 51 selectable theme colours, matching the game's own colour list, plus
// the app's original teal as the default. A theme only swaps the accent — the
// dark background scheme stays, so derivation handles the two failure modes:
// near-black accents vanish on the dark background (lightened until readable)
// and light accents make white-on-accent text invisible (accentText flips dark).

export interface ThemeOption {
  name: string;
  hex: string;
}

export const DEFAULT_THEME_NAME = 'Default';

export const THEME_OPTIONS: ThemeOption[] = [
  { name: DEFAULT_THEME_NAME, hex: '#3ED2D0' },
  { name: 'Black', hex: '#000000' },
  { name: 'Grey', hex: '#808080' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Dark red', hex: '#8B0000' },
  { name: 'Rose', hex: '#FF007F' },
  { name: 'Mona', hex: '#FFA194' },
  { name: 'Red', hex: '#FF0000' },
  { name: 'Vermilion', hex: '#FF4D00' },
  { name: 'Tangerine', hex: '#FFB86C' },
  { name: 'Orange', hex: '#FF7F00' },
  { name: 'Mango Tango', hex: '#E77200' },
  { name: 'Koromiko', hex: '#FFBD5F' },
  { name: 'Yellow', hex: '#FFFF00' },
  { name: 'Lemon Yellow', hex: '#FFF44F' },
  { name: 'Pale Canary', hex: '#FFFF99' },
  { name: 'Lime', hex: '#BFFF00' },
  { name: 'Green Yellow', hex: '#ADFF2F' },
  { name: 'Reef', hex: '#C9FFA2' },
  { name: 'Green', hex: '#00D93B' },
  { name: "Screamin' Green", hex: '#66FF66' },
  { name: 'Mint Green', hex: '#98FF98' },
  { name: 'Spring Green', hex: '#00FF7F' },
  { name: 'Aquamarine', hex: '#7FFFD4' },
  { name: 'Aero', hex: '#7CB9E8' },
  { name: 'Bright Turquoise', hex: '#08E8DE' },
  { name: 'Aqua', hex: '#00FFFF' },
  { name: 'Fresh Air', hex: '#A6E7FF' },
  { name: 'Cyan', hex: '#00E5FF' },
  { name: 'Malibu', hex: '#7DC8FF' },
  { name: 'Clear Water', hex: '#BFEFFF' },
  { name: 'Azure Radiance', hex: '#007FFF' },
  { name: 'Blueberry', hex: '#4F86F7' },
  { name: 'Anakiwa', hex: '#9DEFFF' },
  { name: 'Blue Ribbon', hex: '#0066FF' },
  { name: 'Indigo', hex: '#4F69C6' },
  { name: 'Melrose', hex: '#C7C1FF' },
  { name: 'Blue', hex: '#2424FF' },
  { name: 'Royal Blue', hex: '#4169E1' },
  { name: 'Ship Cove', hex: '#788BBA' },
  { name: 'Electric Violet', hex: '#8B00FF' },
  { name: 'Heliotrope', hex: '#DF73FF' },
  { name: 'Mauve', hex: '#E0B0FF' },
  { name: 'Violet', hex: '#9F00C5' },
  { name: 'Amethyst', hex: '#9966CC' },
  { name: 'East Side', hex: '#AC91CE' },
  { name: 'Magenta', hex: '#FF00FF' },
  { name: 'Pink Flamingo', hex: '#FC74FD' },
  { name: 'Lavender Rose', hex: '#FBA0E3' },
  { name: 'Hollywood Cerise', hex: '#F400A1' },
  { name: 'Hot Pink', hex: '#FF69B4' },
  { name: 'Cotton Candy', hex: '#FFB7D5' },
];

export function findTheme(name: string | null | undefined): ThemeOption {
  return THEME_OPTIONS.find((t) => t.name === name) ?? THEME_OPTIONS[0];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a: string, b: string, amount: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([
    ca[0] + (cb[0] - ca[0]) * amount,
    ca[1] + (cb[1] - ca[1]) * amount,
    ca[2] + (cb[2] - ca[2]) * amount,
  ]);
}

const BACKGROUND = '#0E1116';
const DARK_TEXT = '#0E1116';
const LIGHT_TEXT = '#FFFFFF';

export interface DerivedAccent {
  /** The picked colour, lightened if it would vanish on the dark background. */
  accent: string;
  /** Dimmed version for fills behind text (selection states, track colours). */
  accentMuted: string;
  /** Text drawn ON an accent-filled surface — dark on light accents. */
  accentText: string;
}

export function deriveAccent(hex: string): DerivedAccent {
  let accent = hex.toUpperCase();
  // Black/dark-red class accents: pull towards white until readable on the
  // dark background. 2.5 keeps the hue recognisable without going pastel.
  for (let i = 0; contrast(accent, BACKGROUND) < 2.5 && i < 20; i++) {
    accent = mix(accent, '#FFFFFF', 0.12);
  }
  return {
    accent,
    accentMuted: mix(accent, BACKGROUND, 0.72),
    // Dark text on light accents, so white labels never sit on white-ish fills.
    accentText: contrast(accent, DARK_TEXT) >= contrast(accent, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT,
  };
}
