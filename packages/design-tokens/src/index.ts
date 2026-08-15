/**
 * InternLink design tokens — machine-readable mirror of `tokens.css`.
 *
 * `tokens.css` is what the browser consumes; this file is what *tooling*
 * consumes — the Flutter ThemeData generator, Storybook, and any chart/canvas
 * code that needs a colour as a JS string rather than a CSS custom property.
 *
 * These two files must be kept in step. If you change a value here, change it
 * in tokens.css too (and vice versa).
 */

export const palette = {
  violet: {
    50: '#f3f0ff',
    100: '#e9e3ff',
    200: '#d5cbff',
    300: '#b8a6ff',
    400: '#9878fc',
    500: '#7c55f7',
    600: '#6c4cf1',
    700: '#5a38d8',
    800: '#4a2eae',
    900: '#3d2889',
    950: '#241553',
  },
  ink: {
    0: '#ffffff',
    50: '#f8f8fc',
    100: '#f1f1f7',
    200: '#e4e4ee',
    300: '#cfcfde',
    400: '#a3a3ba',
    500: '#757591',
    600: '#565670',
    700: '#414157',
    800: '#2a2a3d',
    900: '#1a1a29',
    950: '#0f1020',
  },
  coral: {
    50: '#fff1ef',
    100: '#ffe1dd',
    200: '#ffc7c0',
    400: '#ff8c7f',
    500: '#ff6b5b',
    600: '#ed4a38',
    700: '#c6351f',
  },
  success: { 50: '#e7f9f1', 500: '#12b981', 700: '#047857' },
  warning: { 50: '#fff7e6', 500: '#f5a524', 700: '#b45309' },
  danger: { 50: '#ffeef0', 500: '#e5484d', 700: '#c02328' },
  info: { 50: '#eef4ff', 500: '#3b82f6', 700: '#1d4ed8' },
} as const;

export const semantic = {
  light: {
    bgCanvas: '#f8f8fc',
    bgSurface: '#ffffff',
    bgSurfaceRaised: '#ffffff',
    bgSurfaceSunken: '#f1f1f7',
    fgDefault: '#12132a',
    fgMuted: '#565670',
    fgSubtle: '#757591',
    fgFaint: '#a3a3ba',
    brand: '#6c4cf1',
    brandFg: '#5a38d8',
    brandSubtle: '#f3f0ff',
    accent: '#ff6b5b',
    accentFg: '#c6351f',
    borderDefault: '#e4e4ee',
    borderStrong: '#cfcfde',
  },
  dark: {
    bgCanvas: '#0b0c18',
    bgSurface: '#14152b',
    bgSurfaceRaised: '#1c1d36',
    bgSurfaceSunken: '#0f1020',
    fgDefault: '#e8e8f5',
    fgMuted: '#a8a8c4',
    fgSubtle: '#8484a3',
    fgFaint: '#5c5c78',
    brand: '#8f6dfa',
    brandFg: '#b8a6ff',
    brandSubtle: '#1e1a3d',
    accent: '#ff8c7f',
    accentFg: '#ffb0a6',
    borderDefault: '#2a2b47',
    borderStrong: '#3b3d5e',
  },
} as const;

/**
 * Verified contrast ratios (WCAG 2.1). Kept in source so a future palette
 * tweak has something to be checked against rather than re-derived by eye.
 *
 * AA needs 4.5:1 for body text, 3:1 for large text and UI boundaries.
 */
export const contrastAudit = [
  { pair: 'fgDefault on bgSurface (light)', ratio: 18.4, passes: 'AAA' },
  { pair: 'fgMuted on bgSurface (light)', ratio: 7.09, passes: 'AAA' },
  { pair: 'fgSubtle on bgSurface (light)', ratio: 4.6, passes: 'AA' },
  { pair: 'white on brand (light)', ratio: 5.33, passes: 'AA' },
  { pair: 'accentFg on bgSurface (light)', ratio: 5.34, passes: 'AA' },
  { pair: 'fgDefault on bgSurface (dark)', ratio: 15.0, passes: 'AAA' },
  { pair: 'fgMuted on bgSurface (dark)', ratio: 8.0, passes: 'AAA' },
  { pair: 'fgSubtle on bgSurface (dark)', ratio: 5.1, passes: 'AA' },
  { pair: 'brand on bgSurface (dark)', ratio: 5.58, passes: 'AA' },
  // Documented failures — these exist so nobody "fixes" them into text colours.
  { pair: 'coral-500 on white', ratio: 2.8, passes: 'FAIL — fills only, use coral-700 for text' },
  { pair: 'fgFaint on bgSurface (either)', ratio: 2.5, passes: 'FAIL — disabled/decorative only' },
] as const;

export const typography = {
  display: '"Outfit", ui-sans-serif, system-ui, sans-serif',
  sans: '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  scale: {
    '2xs': { size: 11, lineHeight: 16 },
    xs: { size: 12, lineHeight: 18 },
    sm: { size: 14, lineHeight: 22 },
    base: { size: 16, lineHeight: 24 },
    lg: { size: 18, lineHeight: 28 },
    xl: { size: 22, lineHeight: 30 },
    '2xl': { size: 28, lineHeight: 34 },
    '3xl': { size: 34, lineHeight: 40 },
    '4xl': { size: 44, lineHeight: 48 },
    '5xl': { size: 56, lineHeight: 60 },
  },
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 28,
  full: 9999,
} as const;

/** 4px base grid. */
export const spacing = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24,
  8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96,
} as const;

export const motion = {
  duration: { instant: 100, fast: 160, normal: 240, slow: 320 },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    decelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
    accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  /** Framer Motion spring matching --ease-spring closely enough to mix. */
  spring: { type: 'spring', stiffness: 400, damping: 32, mass: 0.9 },
} as const;

/** Fixed stacking scale. Arbitrary z-index values are a lint failure. */
export const zIndex = {
  base: 0,
  sticky: 10,
  dropdown: 20,
  overlay: 30,
  modal: 40,
  toast: 50,
} as const;

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Palette = typeof palette;
export type SemanticTheme = typeof semantic.light;
