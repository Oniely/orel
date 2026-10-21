const INT_TYPES = /^(integer|int|bigint|smallint|tinyint|mediumint)( unsigned)?$/i;
const FLOAT_TYPES = /^(numeric|decimal|float|real|double precision|double)( unsigned)?$/i;
const BOOL_TYPES = /^boolean$/i;
const JSON_TYPES = /^jsonb?$/i;
const TEXT_TYPES = /char|text|clob/i;
const LONG_TEXT_LENGTH = 80;

const isJsonObject = (value: unknown) => typeof value === "object" && value !== null;

/**
 * Render a cell value as the initial text of an inline edit input.
 * JSON objects/arrays are stringified — String() would give "[object Object]".
 */
export function formatEditValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * A column holds JSON when its type says so (json/jsonb) or the driver
 * returned an object/array. SQLite reports `json` but returns plain strings.
 */
export function isJsonValue(dataType: string, original: unknown): boolean {
  return JSON_TYPES.test(dataType) || isJsonObject(original);
}

/** Text-ish values too long or multi-line to edit comfortably in a single-line input. */
export function isLongText(dataType: string, value: unknown): boolean {
  return (
    TEXT_TYPES.test(dataType) &&
    typeof value === "string" &&
    (value.length > LONG_TEXT_LENGTH || value.includes("\n"))
  );
}

/** Pretty-print a JSON value (object or JSON text) with 2-space indent; invalid text is returned as-is. */
export function formatJsonForEditor(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export interface JsonEditError {
  message: string;
  /** Only known when the engine reports an offset (V8 does, WebKit's JavaScriptCore doesn't) */
  line?: number;
  column?: number;
}

/**
 * Validate the text of a JSON cell edit. Empty / NULL text on a nullable
 * column is a valid way to set NULL. Returns null when the edit can be staged.
 */
export function jsonEditError(raw: string, isNullable: boolean): JsonEditError | null {
  const trimmed = raw.trim();
  if (isNullable && (trimmed === "" || trimmed === "NULL" || trimmed === "null")) return null;
  try {
    JSON.parse(trimmed);
    return null;
  } catch (e) {
    const text = (e instanceof Error ? e.message : String(e))
      .replace(/^JSON Parse error: /, "")
      .replace(/^JSON\.parse: /, "");
    const match = /^(.*?)(?: in JSON)? at position (\d+)/.exec(text);
    if (!match) return { message: text };
    // Offsets are reported against the trimmed text — shift back onto the raw text
    const before = raw.slice(0, Number(match[2]) + raw.indexOf(trimmed)).split("\n");
    return { message: match[1], line: before.length, column: before[before.length - 1].length + 1 };
  }
}

/**
 * Parse a string value from an inline edit input into a typed JS value
 * based on the column's SQL data type. When `original` is a JSON object/array
 * (Postgres/MySQL json columns), valid JSON input is parsed back into one so
 * the change round-trips and an unchanged edit stays a no-op. JSON held as
 * text (SQLite, NULL cells) stays text, but a semantically unchanged edit
 * returns the original string so reformatting alone isn't a change.
 * Invalid JSON is passed through as text — callers reject it via `jsonEditError`.
 */
export function parseEditValue(raw: string, dataType: string, isNullable: boolean, original?: unknown): unknown {
  const trimmed = raw.trim();

  // NULL handling
  if ((trimmed === "NULL" || trimmed === "null") && isNullable) {
    return null;
  }
  if (trimmed === "" && isNullable) {
    return null;
  }

  if (INT_TYPES.test(dataType)) {
    const n = parseInt(trimmed, 10);
    return Number.isNaN(n) ? trimmed : n;
  }

  if (FLOAT_TYPES.test(dataType)) {
    const n = parseFloat(trimmed);
    return Number.isNaN(n) ? trimmed : n;
  }

  if (BOOL_TYPES.test(dataType)) {
    const lower = trimmed.toLowerCase();
    if (lower === "true" || lower === "1" || lower === "t") return true;
    if (lower === "false" || lower === "0" || lower === "f") return false;
    return trimmed;
  }

  if (isJsonValue(dataType, original)) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      // Only objects/arrays go back as parsed values — a bare JSON string like
      // "hi" must stay quoted text or the database would get invalid JSON
      if (isJsonObject(original) && isJsonObject(parsed)) return parsed;
      if (typeof original === "string" && JSON.stringify(parsed) === JSON.stringify(JSON.parse(original))) {
        return original;
      }
    } catch {
      // invalid input or a non-JSON original — keep the text
    }
    return trimmed;
  }

  return trimmed;
}
