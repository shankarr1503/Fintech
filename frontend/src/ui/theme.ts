// CoinQuest design tokens. See docs/design/DESIGN.md for the reasoning.
//
// Dark glassmorphism ("liquid glass"): every surface is frosted glass in one lit scene (see
// Backdrop in kit.tsx): a warm copper key light from the top left, a verdigris bounce from the
// bottom right. Voxel shading, card glare and keycap edges all use that same light. Surfaces are translucent fills with a hairline
// light border; one mint accent for progress and rewards; states are luminous tints that
// always also carry an icon and a word, so meaning never relies on colour alone.
// `C` always points at the active palette; styles built with `themed()` follow it.

type Palette = {
  /** Opaque base colour under the aurora (and behind anything that must not show through). */
  paper: string;
  paperDeep: string;
  surface: string;
  /** Denser glass for sheets, the tab bar and sticky footers, where content scrolls beneath. */
  glass: string;
  /** The liquid sheen across the top of glass surfaces. */
  sheen: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  lineStrong: string;
  night: string;
  night2: string;
  night3: string;
  nightText: string;
  nightMuted: string;
  primary: string;
  onPrimary: string;
  gold: string;
  goldDeep: string;
  goldSoft: string;
  green: string;
  greenSoft: string;
  red: string;
  redSoft: string;
  blue: string;
  blueSoft: string;
  amber: string;
  amberSoft: string;
  /** The backdrop's lights: warm key (top left), cool bounce (bottom right), and the floor. */
  aurora: [string, string, string];
  /** Keycaps: the cap's face and its side, lit from the top left like everything else. */
  keyCap: string;
  keySide: string;
};

// Text contrast is checked against the darkest and lightest the backdrop gets under glass;
// every pair used for text meets WCAG AA (4.5:1). See DESIGN.md.
const DARK: Palette = {
  paper: '#06080F',
  paperDeep: 'rgba(255,255,255,0.07)',
  surface: 'rgba(255,255,255,0.065)',
  glass: 'rgba(14,17,28,0.72)',
  sheen: 'rgba(255,255,255,0.09)',
  ink: '#F4F6FB',
  ink2: '#D2D7E4',
  ink3: '#B4BBCB',
  line: 'rgba(255,255,255,0.11)',
  lineStrong: 'rgba(255,255,255,0.24)',

  // The hero "vault" glass (balance, plans, rewards): a touch brighter, tinted by the aurora.
  night: 'rgba(255,255,255,0.09)',
  night2: 'rgba(255,255,255,0.12)',
  night3: 'rgba(255,255,255,0.2)',
  nightText: '#FFFFFF',
  nightMuted: '#BEC5D4',

  // Primary actions are bright liquid glass with dark text.
  primary: '#EEF1F8',
  onPrimary: '#0A0D16',

  gold: '#8CF0D2',
  goldDeep: '#8CF0D2',
  goldSoft: 'rgba(140,240,210,0.14)',

  green: '#7FE3A9',
  greenSoft: 'rgba(127,227,169,0.15)',
  red: '#FF9A9A',
  redSoft: 'rgba(255,154,154,0.15)',
  blue: '#9CC0FF',
  blueSoft: 'rgba(156,192,255,0.15)',
  amber: '#FFD68A',
  amberSoft: 'rgba(255,214,138,0.15)',

  // Copper key light and its verdigris patina: the coin's own materials, not a stock gradient.
  aurora: ['#C27A3A', '#1F7A68', '#000000'],
  keyCap: '#1B202C',
  keySide: '#090C13',
};

const LIGHT: Palette = {
  paper: '#EEEBE6',
  paperDeep: 'rgba(14,18,32,0.06)',
  surface: 'rgba(255,255,255,0.58)',
  glass: 'rgba(246,248,253,0.8)',
  sheen: 'rgba(255,255,255,0.7)',
  ink: '#0E1220',
  ink2: '#2E3447',
  ink3: '#525A6E',
  line: 'rgba(14,18,32,0.1)',
  lineStrong: 'rgba(14,18,32,0.22)',

  // In light mode the vault glass is smoked, so the balance still reads as the hero.
  night: 'rgba(14,18,32,0.82)',
  night2: 'rgba(255,255,255,0.12)',
  night3: 'rgba(255,255,255,0.22)',
  nightText: '#FFFFFF',
  nightMuted: '#C2C8D6',

  primary: '#0E1220',
  onPrimary: '#FFFFFF',

  gold: '#8CF0D2',
  goldDeep: '#0D6B57',
  goldSoft: 'rgba(13,107,87,0.12)',

  green: '#1C6E45',
  greenSoft: 'rgba(28,110,69,0.12)',
  red: '#A8222D',
  redSoft: 'rgba(168,34,45,0.1)',
  blue: '#2349B0',
  blueSoft: 'rgba(35,73,176,0.1)',
  amber: '#7A4F00',
  amberSoft: 'rgba(122,79,0,0.12)',

  aurora: ['#F3C698', '#A9E3D3', '#8A7F72'],
  keyCap: '#FBFCFE',
  keySide: '#C3CAD8',
};

/** Text and icons on the mint accent, in both modes. */
export const ON_ACCENT = '#06130F';

/** Full-screen receipt backgrounds: deep tinted glass; white text is 7:1 or better on each. */
export const STATUS_BG = {
  success: '#0C3A2C',
  pending: '#18203A',
  on_hold: '#3A2C0E',
  failed: '#3E1419',
  unknown: '#18203A',
};

/** Luminous categorical series for charts (spending by category, score bands). */
export const SERIES = ['#8CF0D2', '#9CC0FF', '#B9A2FF', '#FFD68A', '#FF9A9A'];

export type Scheme = 'light' | 'dark';
let active: Palette = DARK;
let scheme: Scheme = 'dark';
let version = 0;

/** Switch palettes. Call before rendering the tree that should use it. */
export function setScheme(next: Scheme) {
  if (next === scheme) return;
  scheme = next;
  active = next === 'dark' ? DARK : LIGHT;
  version++;
}

export const getScheme = () => scheme;

/** Live view of the active palette: `C.ink` always reads the current value. */
export const C = new Proxy({} as Palette, { get: (_t, key: string) => active[key as keyof Palette] });

/** Wrap a StyleSheet factory so its styles follow the active palette. Usage stays `styles.foo`. */
export function themed<T extends object>(factory: () => T): T {
  let cache: T | null = null;
  let builtFor = -1;
  return new Proxy({} as T, {
    get: (_t, key) => {
      if (!cache || builtFor !== version) {
        cache = factory();
        builtFor = version;
      }
      return cache[key as keyof T];
    },
  });
}

// One family throughout: Pixelify Sans, a pixel face that is still easy to read at body sizes.
// The files in assets/fonts add the ₹ sign and arrows it lacks (see scripts/build-fonts.py).
// Weight carries the hierarchy: 700 for big amounts, 600 headings, 500 labels, 400 reading.
export const F = {
  display: 'PixelifySans-SemiBold',
  displayBold: 'PixelifySans-Bold',
  displayItalic: 'PixelifySans-Medium',
  regular: 'PixelifySans-Regular',
  medium: 'PixelifySans-Medium',
  semibold: 'PixelifySans-SemiBold',
  bold: 'PixelifySans-Bold',
  mono: 'PixelifySans-Medium',
};

// Liquid glass wants soft, generous corners.
export const R = { sm: 14, md: 22, lg: 28, pill: 999 };
export const GUTTER = 20;

// Monogram avatars and category marks: tinted glass tiles with luminous marks.
const TINTS_DARK = [
  { bg: 'rgba(140,240,210,0.16)', fg: '#8CF0D2' },
  { bg: 'rgba(156,192,255,0.16)', fg: '#9CC0FF' },
  { bg: 'rgba(185,162,255,0.18)', fg: '#C9B8FF' },
  { bg: 'rgba(255,214,138,0.16)', fg: '#FFD68A' },
  { bg: 'rgba(255,154,154,0.16)', fg: '#FFB0B0' },
  { bg: 'rgba(255,255,255,0.12)', fg: '#F4F6FB' },
];
const TINTS_LIGHT = [
  { bg: 'rgba(13,107,87,0.12)', fg: '#0D6B57' },
  { bg: 'rgba(35,73,176,0.12)', fg: '#2349B0' },
  { bg: 'rgba(98,64,214,0.12)', fg: '#5233C4' },
  { bg: 'rgba(122,79,0,0.12)', fg: '#7A4F00' },
  { bg: 'rgba(168,34,45,0.1)', fg: '#A8222D' },
  { bg: 'rgba(14,18,32,0.82)', fg: '#FFFFFF' },
];

export const tintFor = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const set = scheme === 'dark' ? TINTS_DARK : TINTS_LIGHT;
  return set[h % set.length];
};

// Feather icon per spending category.
export const CATEGORY_ICON: Record<string, string> = {
  food: 'coffee',
  transport: 'navigation',
  shopping: 'shopping-bag',
  utilities: 'zap',
  entertainment: 'film',
  health: 'heart',
  education: 'book-open',
  salary: 'briefcase',
  investment: 'trending-up',
  transfer: 'repeat',
  emi: 'credit-card',
  subscription: 'refresh-cw',
  other: 'circle',
};
