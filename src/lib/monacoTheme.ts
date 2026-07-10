import type { Monaco } from "@monaco-editor/react";
import type { ThemeColors } from "./themes";

// ── Pure math oklch → hex conversion (no DOM needed) ──────────────────────────

/** Parse an oklch() string like "oklch(77% 0.13 305)" into [L, C, H]. */
function parseOklch(str: string): [number, number, number] | null {
  const m = str.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) return null;
  const L = parseFloat(m[1]) / 100; // percentage → 0-1
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  return [L, C, H];
}

/** oklch → oklab */
function oklchToOklab(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  return [L, C * Math.cos(hRad), C * Math.sin(hRad)];
}

/** oklab → linear sRGB */
function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Linear sRGB component → sRGB (gamma correction) */
function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Clamp 0-1 and convert to 0-255 byte */
function toByte(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}

/** Convert any oklch() string to a hex color. Falls back to the raw string if not oklch. */
function oklchToHex(color: string): string {
  if (color === "transparent") return "#00000000";
  const parsed = parseOklch(color);
  if (!parsed) {
    // Already hex or other format — return as-is
    if (color.startsWith("#")) return color;
    return "#000000";
  }
  const [L, C, H] = parsed;
  const [labL, labA, labB] = oklchToOklab(L, C, H);
  const [lr, lg, lb] = oklabToLinearSrgb(labL, labA, labB);
  const r = toByte(linearToSrgb(lr));
  const g = toByte(linearToSrgb(lg));
  const b = toByte(linearToSrgb(lb));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Monaco theme builder ──────────────────────────────────────────────────────

function withAlpha(hex: string, alpha: number): string {
  const base = hex.startsWith("#") ? hex.slice(1, 7) : hex;
  return `#${base}${alpha.toString(16).padStart(2, "0")}`;
}

const DARK_TOKENS: { token: string; foreground: string; fontStyle?: string }[] = [
  { token: "", foreground: "c0c3d1" },
  { token: "keyword", foreground: "7f93ff", fontStyle: "bold" },
  { token: "keyword.sql", foreground: "7f93ff", fontStyle: "bold" },
  { token: "string", foreground: "f28979" },
  { token: "string.sql", foreground: "f28979" },
  { token: "number", foreground: "c9b957" },
  { token: "number.sql", foreground: "c9b957" },
  { token: "comment", foreground: "464c63", fontStyle: "italic" },
  { token: "comment.sql", foreground: "464c63", fontStyle: "italic" },
  { token: "operator.sql", foreground: "808599" },
  { token: "predefined.sql", foreground: "a497ea" },
  { token: "identifier.sql", foreground: "c0c3d1" },
  { token: "delimiter", foreground: "808599" },
  { token: "delimiter.sql", foreground: "808599" },
];

const LIGHT_TOKENS: { token: string; foreground: string; fontStyle?: string }[] = [
  { token: "", foreground: "2e3440" },
  { token: "keyword", foreground: "1a5fb4", fontStyle: "bold" },
  { token: "keyword.sql", foreground: "1a5fb4", fontStyle: "bold" },
  { token: "string", foreground: "a3370a" },
  { token: "string.sql", foreground: "a3370a" },
  { token: "number", foreground: "8a6d0b" },
  { token: "number.sql", foreground: "8a6d0b" },
  { token: "comment", foreground: "93979f", fontStyle: "italic" },
  { token: "comment.sql", foreground: "93979f", fontStyle: "italic" },
  { token: "operator.sql", foreground: "5e6270" },
  { token: "predefined.sql", foreground: "7239b3" },
  { token: "identifier.sql", foreground: "2e3440" },
  { token: "delimiter", foreground: "5e6270" },
  { token: "delimiter.sql", foreground: "5e6270" },
];

export const THEME_DARK = "orel-dark";
export const THEME_LIGHT = "orel-light";

/**
 * Builds and registers a Monaco theme from a Theme's color values.
 * Uses pure math oklch→hex conversion — no DOM, no CSS variable reading.
 * Returns the theme name that was applied.
 */
export function buildOrelTheme(monaco: Monaco, colors: ThemeColors, isDark: boolean): string {
  const surface = oklchToHex(colors.surface);
  const background = oklchToHex(colors.background);
  const surfaceSecondary = oklchToHex(colors["surface-secondary"]);
  const separator = oklchToHex(colors.separator);
  const accent = oklchToHex(colors.accent);
  const foreground = oklchToHex(colors.foreground);
  const muted = oklchToHex(colors.muted);
  const border = oklchToHex(colors.border);

  const themeName = isDark ? THEME_DARK : THEME_LIGHT;

  monaco.editor.defineTheme(themeName, {
    base: isDark ? "vs-dark" : "vs",
    inherit: true,
    rules: isDark ? DARK_TOKENS : LIGHT_TOKENS,
    colors: {
      "editor.background": surface,
      "editor.foreground": foreground,
      "editorGutter.background": background,
      "editorLineNumber.foreground": border,
      "editorLineNumber.activeForeground": muted,
      "editorCursor.foreground": accent,
      "editor.selectionBackground": withAlpha(accent, 0x40),
      "editor.inactiveSelectionBackground": withAlpha(accent, 0x20),
      "editor.lineHighlightBackground": withAlpha(accent, 0x0c),
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background": separator,
      "editorIndentGuide.activeBackground": withAlpha(muted, 0x58),
      "editorWidget.background": surfaceSecondary,
      "editorWidget.border": separator,
      "editorSuggestWidget.background": surfaceSecondary,
      "editorSuggestWidget.border": separator,
      "editorSuggestWidget.selectedBackground": withAlpha(accent, 0x40),
      "editorSuggestWidget.selectedForeground": foreground,
      "editorHoverWidget.background": surfaceSecondary,
      "editorHoverWidget.border": separator,
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": withAlpha(muted, 0x30),
      "scrollbarSlider.hoverBackground": withAlpha(accent, 0x40),
      "scrollbarSlider.activeBackground": withAlpha(accent, 0x60),
      focusBorder: accent,
      "input.background": surfaceSecondary,
      "input.border": separator,
    },
  });

  monaco.editor.setTheme(themeName);
  return themeName;
}
