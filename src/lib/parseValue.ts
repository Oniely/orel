const INT_TYPES = /^(integer|int|bigint|smallint|tinyint|mediumint)( unsigned)?$/i;
const FLOAT_TYPES = /^(numeric|decimal|float|real|double precision|double)( unsigned)?$/i;
const BOOL_TYPES = /^boolean$/i;

/**
 * Render a cell value as the initial text of an inline edit input.
 * JSON objects/arrays are stringified — String() would give "[object Object]".
 */
export function formatEditValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Parse a string value from an inline edit input into a typed JS value
 * based on the column's SQL data type. When `original` is a JSON object/array
 * (Postgres/MySQL json columns), valid JSON input is parsed back into one so
 * the change round-trips and an unchanged edit stays a no-op.
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

  if (typeof original === "object" && original !== null) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}
