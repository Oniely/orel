// Maps each SQL type to a category used for color assignment
const TYPE_CATEGORY: Record<string, string> = {
  uuid: "uuid",
  varchar: "string",
  "character varying": "string",
  text: "string",
  tinytext: "string",
  mediumtext: "string",
  longtext: "string",
  char: "string",
  enum: "string",
  set: "string",
  boolean: "bool",
  bool: "bool",
  timestamp: "time",
  "timestamp with time zone": "time",
  "timestamp without time zone": "time",
  timestamptz: "time",
  date: "time",
  time: "time",
  datetime: "time",
  year: "time",
  interval: "time",
  integer: "number",
  int: "number",
  int2: "number",
  int4: "number",
  int8: "number",
  tinyint: "number",
  smallint: "number",
  mediumint: "number",
  bigint: "number",
  "tinyint unsigned": "number",
  "smallint unsigned": "number",
  "mediumint unsigned": "number",
  "int unsigned": "number",
  "bigint unsigned": "number",
  numeric: "number",
  decimal: "number",
  float: "number",
  float4: "number",
  float8: "number",
  double: "number",
  real: "number",
  "double precision": "number",
  serial: "number",
  bigserial: "number",
  jsonb: "json",
  json: "json",
  "jsonb[]": "json",
  "json[]": "json",
  "text[]": "string",
  "varchar[]": "string",
  "bpchar[]": "string",
  "int2[]": "number",
  "int4[]": "number",
  "int8[]": "number",
  "float4[]": "number",
  "float8[]": "number",
  "bool[]": "bool",
  "uuid[]": "uuid",
};

// Hue offsets from the theme accent for each category
const CATEGORY_HUE_OFFSET: Record<string, number> = {
  uuid: 0,
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
  const cat = TYPE_CATEGORY[type.toLowerCase()];
  const varName = cat ? `--type-color-${cat}` : "--type-color-default";
  return `var(${varName})`;
}
