// Maps each normalized SQL type to a category used for color assignment.
// Suffixes like [], " unsigned", and "(…)" are stripped by getTypeColor before lookup.
const TYPE_CATEGORY: Record<string, string> = {
  // String
  varchar: "string",
  text: "string",
  char: "string",
  tinytext: "string",
  mediumtext: "string",
  longtext: "string",
  enum: "string",
  set: "string",
  xml: "string",
  inet: "string",
  cidr: "string",
  macaddr: "string",
  macaddr8: "string",
  // Boolean
  boolean: "bool",
  // Time
  timestamp: "time",
  timestamptz: "time",
  timetz: "time",
  date: "time",
  time: "time",
  datetime: "time",
  year: "time",
  interval: "time",
  // Number
  integer: "number",
  int: "number",
  smallint: "number",
  bigint: "number",
  tinyint: "number",
  mediumint: "number",
  numeric: "number",
  decimal: "number",
  float: "number",
  double: "number",
  real: "number",
  "double precision": "number",
  money: "number",
  bit: "number",
  varbit: "number",
  // JSON
  json: "json",
  jsonb: "json",
  // UUID
  uuid: "uuid",
  // Binary
  bytea: "binary",
  blob: "binary",
  tinyblob: "binary",
  mediumblob: "binary",
  longblob: "binary",
  binary: "binary",
  varbinary: "binary",
};

// Hue offsets from the theme accent for each category
const CATEGORY_HUE_OFFSET: Record<string, number> = {
  uuid: 0,
  binary: 30,
  string: 90,
  bool: 150,
  time: 210,
  number: 270,
  json: 330,
};

const DEFAULT_HUE_OFFSET = 45;

/**
 * Sets type-color CSS variables on :root based on the theme accent hue.
 * Called from applyTheme.
 */
export function applyTypeColors(accentOklch: string, isDark: boolean): void {
  const hue = parseOklchHue(accentOklch);
  const lightness = isDark ? "74%" : "52%";
  const chroma = isDark ? "0.13" : "0.14";
  const root = document.documentElement;

  for (const [cat, offset] of Object.entries(CATEGORY_HUE_OFFSET)) {
    const h = (hue + offset) % 360;
    root.style.setProperty(`--type-color-${cat}`, `oklch(${lightness} ${chroma} ${h})`);
  }

  const defaultH = (hue + DEFAULT_HUE_OFFSET) % 360;
  root.style.setProperty("--type-color-default", `oklch(${lightness} 0.03 ${defaultH})`);
}

function parseOklchHue(oklch: string): number {
  // Extract hue from "oklch(L% C H)" format
  const parts = oklch
    .replace(/oklch\(|\)/g, "")
    .trim()
    .split(/\s+/);
  return parseFloat(parts[2]) || 0;
}

export function getTypeColor(type: string): string {
  const lower = type.toLowerCase();
  let cat = TYPE_CATEGORY[lower];

  if (!cat && lower.endsWith("[]")) {
    cat = TYPE_CATEGORY[lower.slice(0, -2)];
  }
  if (!cat && lower.endsWith(" unsigned")) {
    cat = TYPE_CATEGORY[lower.slice(0, -9)];
  }
  if (!cat) {
    const paren = lower.indexOf("(");
    if (paren > 0) cat = TYPE_CATEGORY[lower.slice(0, paren)];
  }

  return `var(${cat ? `--type-color-${cat}` : "--type-color-default"})`;
}
