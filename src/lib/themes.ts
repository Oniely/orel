export interface ThemeColors {
  accent: string;
  "accent-foreground": string;
  background: string;
  border: string;
  danger: string;
  "danger-foreground": string;
  default: string;
  "default-foreground": string;
  "field-background": string;
  "field-border": string;
  "field-foreground": string;
  "field-placeholder": string;
  focus: string;
  foreground: string;
  muted: string;
  overlay: string;
  "overlay-foreground": string;
  scrollbar: string;
  segment: string;
  "segment-foreground": string;
  separator: string;
  success: string;
  "success-foreground": string;
  surface: string;
  "surface-foreground": string;
  "surface-secondary": string;
  "surface-secondary-foreground": string;
  "surface-tertiary": string;
  "surface-tertiary-foreground": string;
  warning: string;
  "warning-foreground": string;
}

export interface Theme {
  id: string;
  name: string;
  isDark: boolean;
  colors: ThemeColors;
}

// ── Theme presets ──────────────────────────────────────────────────────────────

const light: Theme = {
  id: "light",
  name: "Light",
  isDark: false,
  colors: {
    accent: "oklch(77% 0.13 305)",
    "accent-foreground": "oklch(15% 0.026 305)",
    background: "oklch(97.02% 0.008 305)",
    border: "oklch(90% 0.006 305)",
    danger: "oklch(65.32% 0.2335 31.88)",
    "danger-foreground": "oklch(99.11% 0 0)",
    default: "oklch(94% 0.006 305)",
    "default-foreground": "oklch(21.03% 0.006 305)",
    "field-background": "oklch(100% 0.004 305)",
    "field-border": "transparent",
    "field-foreground": "oklch(21.03% 0.005 305)",
    "field-placeholder": "oklch(55.17% 0.012 305)",
    focus: "oklch(77% 0.13 305)",
    foreground: "oklch(21.03% 0.005 305)",
    muted: "oklch(55.17% 0.012 305)",
    overlay: "oklch(100% 0.003 305)",
    "overlay-foreground": "oklch(21.03% 0.005 305)",
    scrollbar: "oklch(87.1% 0.006 305)",
    segment: "oklch(100% 0.005 305)",
    "segment-foreground": "oklch(21.03% 0.005 305)",
    separator: "oklch(92% 0.006 305)",
    success: "oklch(73.29% 0.1941 156.95)",
    "success-foreground": "oklch(21.03% 0.0059 156.95)",
    surface: "oklch(100% 0.005 305)",
    "surface-foreground": "oklch(21.03% 0.005 305)",
    "surface-secondary": "oklch(95.24% 0.007 305)",
    "surface-secondary-foreground": "oklch(21.03% 0.005 305)",
    "surface-tertiary": "oklch(93.73% 0.007 305)",
    "surface-tertiary-foreground": "oklch(21.03% 0.005 305)",
    warning: "oklch(78.19% 0.159 78.47)",
    "warning-foreground": "oklch(21.03% 0.0059 78.47)",
  },
};

const dark: Theme = {
  id: "dark",
  name: "Dark",
  isDark: true,
  colors: {
    accent: "oklch(77% 0.13 305)",
    "accent-foreground": "oklch(15% 0.026 305)",
    background: "oklch(12% 0.012 305)",
    border: "oklch(28% 0.01 305)",
    danger: "oklch(59.4% 0.1973 30.77)",
    "danger-foreground": "oklch(99.11% 0 0)",
    default: "oklch(27.4% 0.01 305)",
    "default-foreground": "oklch(99.11% 0 0)",
    "field-background": "oklch(21.03% 0.014 305)",
    "field-border": "transparent",
    "field-foreground": "oklch(99.11% 0.005 305)",
    "field-placeholder": "oklch(70.5% 0.015 305)",
    focus: "oklch(77% 0.13 305)",
    foreground: "oklch(99.11% 0.005 305)",
    muted: "oklch(70.5% 0.015 305)",
    overlay: "oklch(21.03% 0.014 305)",
    "overlay-foreground": "oklch(99.11% 0.005 305)",
    scrollbar: "oklch(70.5% 0.01 305)",
    segment: "oklch(39.64% 0.01 305)",
    "segment-foreground": "oklch(99.11% 0.005 305)",
    separator: "oklch(25% 0.008 305)",
    success: "oklch(73.29% 0.1941 156.95)",
    "success-foreground": "oklch(21.03% 0.0059 156.95)",
    surface: "oklch(21.03% 0.014 305)",
    "surface-foreground": "oklch(99.11% 0.005 305)",
    "surface-secondary": "oklch(25.7% 0.012 305)",
    "surface-secondary-foreground": "oklch(99.11% 0.005 305)",
    "surface-tertiary": "oklch(27.21% 0.012 305)",
    "surface-tertiary-foreground": "oklch(99.11% 0.005 305)",
    warning: "oklch(82.03% 0.1392 82.48)",
    "warning-foreground": "oklch(21.03% 0.0059 82.48)",
  },
};

const nord: Theme = {
  id: "nord",
  name: "Nord",
  isDark: true,
  colors: {
    accent: "oklch(70% 0.1 240)",
    "accent-foreground": "oklch(97% 0.005 240)",
    background: "oklch(22% 0.02 240)",
    border: "oklch(32% 0.015 240)",
    danger: "oklch(62% 0.2 20)",
    "danger-foreground": "oklch(97% 0 0)",
    default: "oklch(30% 0.015 240)",
    "default-foreground": "oklch(92% 0.008 240)",
    "field-background": "oklch(26% 0.018 240)",
    "field-border": "transparent",
    "field-foreground": "oklch(92% 0.008 240)",
    "field-placeholder": "oklch(62% 0.015 240)",
    focus: "oklch(70% 0.1 240)",
    foreground: "oklch(92% 0.008 240)",
    muted: "oklch(62% 0.015 240)",
    overlay: "oklch(26% 0.018 240)",
    "overlay-foreground": "oklch(92% 0.008 240)",
    scrollbar: "oklch(50% 0.015 240)",
    segment: "oklch(36% 0.015 240)",
    "segment-foreground": "oklch(92% 0.008 240)",
    separator: "oklch(30% 0.015 240)",
    success: "oklch(72% 0.15 160)",
    "success-foreground": "oklch(20% 0.01 160)",
    surface: "oklch(26% 0.018 240)",
    "surface-foreground": "oklch(92% 0.008 240)",
    "surface-secondary": "oklch(30% 0.016 240)",
    "surface-secondary-foreground": "oklch(92% 0.008 240)",
    "surface-tertiary": "oklch(32% 0.016 240)",
    "surface-tertiary-foreground": "oklch(92% 0.008 240)",
    warning: "oklch(80% 0.14 80)",
    "warning-foreground": "oklch(20% 0.01 80)",
  },
};

const dracula: Theme = {
  id: "dracula",
  name: "Dracula",
  isDark: true,
  colors: {
    accent: "oklch(72% 0.18 320)",
    "accent-foreground": "oklch(97% 0.005 320)",
    background: "oklch(18% 0.02 280)",
    border: "oklch(30% 0.02 280)",
    danger: "oklch(65% 0.22 25)",
    "danger-foreground": "oklch(97% 0 0)",
    default: "oklch(28% 0.018 280)",
    "default-foreground": "oklch(94% 0.008 280)",
    "field-background": "oklch(22% 0.02 280)",
    "field-border": "transparent",
    "field-foreground": "oklch(94% 0.008 280)",
    "field-placeholder": "oklch(60% 0.015 280)",
    focus: "oklch(72% 0.18 320)",
    foreground: "oklch(94% 0.008 280)",
    muted: "oklch(60% 0.015 280)",
    overlay: "oklch(22% 0.02 280)",
    "overlay-foreground": "oklch(94% 0.008 280)",
    scrollbar: "oklch(45% 0.015 280)",
    segment: "oklch(34% 0.018 280)",
    "segment-foreground": "oklch(94% 0.008 280)",
    separator: "oklch(28% 0.018 280)",
    success: "oklch(76% 0.17 145)",
    "success-foreground": "oklch(18% 0.01 145)",
    surface: "oklch(22% 0.02 280)",
    "surface-foreground": "oklch(94% 0.008 280)",
    "surface-secondary": "oklch(26% 0.02 280)",
    "surface-secondary-foreground": "oklch(94% 0.008 280)",
    "surface-tertiary": "oklch(28% 0.02 280)",
    "surface-tertiary-foreground": "oklch(94% 0.008 280)",
    warning: "oklch(82% 0.16 80)",
    "warning-foreground": "oklch(18% 0.01 80)",
  },
};

const sunset: Theme = {
  id: "sunset",
  name: "Sunset",
  isDark: true,
  colors: {
    accent: "oklch(72% 0.18 35)",
    "accent-foreground": "oklch(15% 0.02 35)",
    background: "oklch(14% 0.015 30)",
    border: "oklch(28% 0.015 30)",
    danger: "oklch(60% 0.22 15)",
    "danger-foreground": "oklch(97% 0 0)",
    default: "oklch(26% 0.012 30)",
    "default-foreground": "oklch(93% 0.01 30)",
    "field-background": "oklch(20% 0.015 30)",
    "field-border": "transparent",
    "field-foreground": "oklch(93% 0.01 30)",
    "field-placeholder": "oklch(60% 0.02 30)",
    focus: "oklch(72% 0.18 35)",
    foreground: "oklch(93% 0.01 30)",
    muted: "oklch(60% 0.02 30)",
    overlay: "oklch(20% 0.015 30)",
    "overlay-foreground": "oklch(93% 0.01 30)",
    scrollbar: "oklch(45% 0.015 30)",
    segment: "oklch(32% 0.015 30)",
    "segment-foreground": "oklch(93% 0.01 30)",
    separator: "oklch(25% 0.012 30)",
    success: "oklch(72% 0.15 160)",
    "success-foreground": "oklch(20% 0.01 160)",
    surface: "oklch(20% 0.015 30)",
    "surface-foreground": "oklch(93% 0.01 30)",
    "surface-secondary": "oklch(24% 0.015 30)",
    "surface-secondary-foreground": "oklch(93% 0.01 30)",
    "surface-tertiary": "oklch(26% 0.015 30)",
    "surface-tertiary-foreground": "oklch(93% 0.01 30)",
    warning: "oklch(82% 0.15 65)",
    "warning-foreground": "oklch(20% 0.01 65)",
  },
};

const forest: Theme = {
  id: "forest",
  name: "Forest",
  isDark: true,
  colors: {
    accent: "oklch(70% 0.15 155)",
    "accent-foreground": "oklch(15% 0.02 155)",
    background: "oklch(14% 0.015 155)",
    border: "oklch(26% 0.012 155)",
    danger: "oklch(62% 0.2 25)",
    "danger-foreground": "oklch(97% 0 0)",
    default: "oklch(25% 0.012 155)",
    "default-foreground": "oklch(92% 0.01 155)",
    "field-background": "oklch(19% 0.014 155)",
    "field-border": "transparent",
    "field-foreground": "oklch(92% 0.01 155)",
    "field-placeholder": "oklch(58% 0.015 155)",
    focus: "oklch(70% 0.15 155)",
    foreground: "oklch(92% 0.01 155)",
    muted: "oklch(58% 0.015 155)",
    overlay: "oklch(19% 0.014 155)",
    "overlay-foreground": "oklch(92% 0.01 155)",
    scrollbar: "oklch(45% 0.012 155)",
    segment: "oklch(32% 0.012 155)",
    "segment-foreground": "oklch(92% 0.01 155)",
    separator: "oklch(24% 0.01 155)",
    success: "oklch(74% 0.18 145)",
    "success-foreground": "oklch(18% 0.01 145)",
    surface: "oklch(19% 0.014 155)",
    "surface-foreground": "oklch(92% 0.01 155)",
    "surface-secondary": "oklch(23% 0.013 155)",
    "surface-secondary-foreground": "oklch(92% 0.01 155)",
    "surface-tertiary": "oklch(25% 0.013 155)",
    "surface-tertiary-foreground": "oklch(92% 0.01 155)",
    warning: "oklch(80% 0.14 80)",
    "warning-foreground": "oklch(18% 0.01 80)",
  },
};

const cyberpunk: Theme = {
  id: "cyberpunk",
  name: "Cyberpunk",
  isDark: true,
  colors: {
    accent: "oklch(75% 0.22 340)",
    "accent-foreground": "oklch(12% 0.02 340)",
    background: "oklch(10% 0.015 290)",
    border: "oklch(25% 0.02 290)",
    danger: "oklch(65% 0.25 25)",
    "danger-foreground": "oklch(97% 0 0)",
    default: "oklch(22% 0.018 290)",
    "default-foreground": "oklch(93% 0.01 290)",
    "field-background": "oklch(16% 0.018 290)",
    "field-border": "transparent",
    "field-foreground": "oklch(93% 0.01 290)",
    "field-placeholder": "oklch(55% 0.02 290)",
    focus: "oklch(75% 0.22 340)",
    foreground: "oklch(93% 0.01 290)",
    muted: "oklch(55% 0.02 290)",
    overlay: "oklch(16% 0.018 290)",
    "overlay-foreground": "oklch(93% 0.01 290)",
    scrollbar: "oklch(40% 0.015 290)",
    segment: "oklch(28% 0.018 290)",
    "segment-foreground": "oklch(93% 0.01 290)",
    separator: "oklch(22% 0.016 290)",
    success: "oklch(80% 0.2 150)",
    "success-foreground": "oklch(15% 0.01 150)",
    surface: "oklch(16% 0.018 290)",
    "surface-foreground": "oklch(93% 0.01 290)",
    "surface-secondary": "oklch(20% 0.018 290)",
    "surface-secondary-foreground": "oklch(93% 0.01 290)",
    "surface-tertiary": "oklch(22% 0.018 290)",
    "surface-tertiary-foreground": "oklch(93% 0.01 290)",
    warning: "oklch(85% 0.18 85)",
    "warning-foreground": "oklch(15% 0.01 85)",
  },
};

const pastel: Theme = {
  id: "pastel",
  name: "Pastel",
  isDark: false,
  colors: {
    accent: "oklch(70% 0.12 330)",
    "accent-foreground": "oklch(20% 0.02 330)",
    background: "oklch(96% 0.012 330)",
    border: "oklch(88% 0.01 330)",
    danger: "oklch(68% 0.15 20)",
    "danger-foreground": "oklch(97% 0 0)",
    default: "oklch(92% 0.01 330)",
    "default-foreground": "oklch(25% 0.008 330)",
    "field-background": "oklch(98% 0.008 330)",
    "field-border": "transparent",
    "field-foreground": "oklch(25% 0.008 330)",
    "field-placeholder": "oklch(60% 0.015 330)",
    focus: "oklch(70% 0.12 330)",
    foreground: "oklch(25% 0.008 330)",
    muted: "oklch(60% 0.015 330)",
    overlay: "oklch(98% 0.006 330)",
    "overlay-foreground": "oklch(25% 0.008 330)",
    scrollbar: "oklch(82% 0.01 330)",
    segment: "oklch(98% 0.008 330)",
    "segment-foreground": "oklch(25% 0.008 330)",
    separator: "oklch(90% 0.01 330)",
    success: "oklch(72% 0.12 155)",
    "success-foreground": "oklch(22% 0.008 155)",
    surface: "oklch(98% 0.008 330)",
    "surface-foreground": "oklch(25% 0.008 330)",
    "surface-secondary": "oklch(94% 0.01 330)",
    "surface-secondary-foreground": "oklch(25% 0.008 330)",
    "surface-tertiary": "oklch(92% 0.01 330)",
    "surface-tertiary-foreground": "oklch(25% 0.008 330)",
    warning: "oklch(78% 0.12 75)",
    "warning-foreground": "oklch(22% 0.008 75)",
  },
};

const coffee: Theme = {
  id: "coffee",
  name: "Coffee",
  isDark: true,
  colors: {
    accent: "oklch(65% 0.1 55)",
    "accent-foreground": "oklch(95% 0.008 55)",
    background: "oklch(15% 0.012 45)",
    border: "oklch(28% 0.012 45)",
    danger: "oklch(60% 0.2 20)",
    "danger-foreground": "oklch(97% 0 0)",
    default: "oklch(26% 0.01 45)",
    "default-foreground": "oklch(90% 0.01 45)",
    "field-background": "oklch(20% 0.012 45)",
    "field-border": "transparent",
    "field-foreground": "oklch(90% 0.01 45)",
    "field-placeholder": "oklch(58% 0.015 45)",
    focus: "oklch(65% 0.1 55)",
    foreground: "oklch(90% 0.01 45)",
    muted: "oklch(58% 0.015 45)",
    overlay: "oklch(20% 0.012 45)",
    "overlay-foreground": "oklch(90% 0.01 45)",
    scrollbar: "oklch(42% 0.01 45)",
    segment: "oklch(32% 0.01 45)",
    "segment-foreground": "oklch(90% 0.01 45)",
    separator: "oklch(24% 0.01 45)",
    success: "oklch(72% 0.14 155)",
    "success-foreground": "oklch(18% 0.01 155)",
    surface: "oklch(20% 0.012 45)",
    "surface-foreground": "oklch(90% 0.01 45)",
    "surface-secondary": "oklch(24% 0.012 45)",
    "surface-secondary-foreground": "oklch(90% 0.01 45)",
    "surface-tertiary": "oklch(26% 0.012 45)",
    "surface-tertiary-foreground": "oklch(90% 0.01 45)",
    warning: "oklch(78% 0.13 70)",
    "warning-foreground": "oklch(18% 0.01 70)",
  },
};

const abyss: Theme = {
  id: "abyss",
  name: "Abyss",
  isDark: true,
  colors: {
    accent: "oklch(68% 0.14 210)",
    "accent-foreground": "oklch(15% 0.02 210)",
    background: "oklch(11% 0.018 220)",
    border: "oklch(24% 0.015 220)",
    danger: "oklch(62% 0.2 20)",
    "danger-foreground": "oklch(97% 0 0)",
    default: "oklch(22% 0.015 220)",
    "default-foreground": "oklch(92% 0.008 220)",
    "field-background": "oklch(17% 0.016 220)",
    "field-border": "transparent",
    "field-foreground": "oklch(92% 0.008 220)",
    "field-placeholder": "oklch(56% 0.015 220)",
    focus: "oklch(68% 0.14 210)",
    foreground: "oklch(92% 0.008 220)",
    muted: "oklch(56% 0.015 220)",
    overlay: "oklch(17% 0.016 220)",
    "overlay-foreground": "oklch(92% 0.008 220)",
    scrollbar: "oklch(40% 0.012 220)",
    segment: "oklch(30% 0.014 220)",
    "segment-foreground": "oklch(92% 0.008 220)",
    separator: "oklch(21% 0.012 220)",
    success: "oklch(72% 0.15 160)",
    "success-foreground": "oklch(18% 0.01 160)",
    surface: "oklch(17% 0.016 220)",
    "surface-foreground": "oklch(92% 0.008 220)",
    "surface-secondary": "oklch(21% 0.016 220)",
    "surface-secondary-foreground": "oklch(92% 0.008 220)",
    "surface-tertiary": "oklch(23% 0.016 220)",
    "surface-tertiary-foreground": "oklch(92% 0.008 220)",
    warning: "oklch(80% 0.14 80)",
    "warning-foreground": "oklch(18% 0.01 80)",
  },
};

// ── Exports ────────────────────────────────────────────────────────────────────

export const THEMES: Theme[] = [light, dark, nord, dracula, sunset, forest, cyberpunk, pastel, coffee, abyss];

/**
 * Applies a theme by setting all CSS custom properties on :root
 * and toggling the dark/light class for HeroUI compatibility.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  // Set dark/light class for HeroUI base mode
  root.classList.remove("dark", "light");
  root.classList.add(theme.isDark ? "dark" : "light");

  // Apply all color variables
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${key}`, value);
  }
}

/**
 * Returns the 4 preview swatch colors for a theme card.
 */
export function getPreviewColors(theme: Theme): string[] {
  return [theme.colors.accent, theme.colors.success, theme.colors.warning, theme.colors.danger];
}
