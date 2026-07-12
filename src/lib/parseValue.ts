const INT_TYPES = /^(integer|int|int2|int4|int8|bigint|smallint|serial|bigserial|smallserial|tinyint|mediumint)$/i;
const FLOAT_TYPES = /^(numeric|decimal|float|float4|float8|real|double precision|double)$/i;
const BOOL_TYPES = /^(boolean|bool|tinyint\(1\))$/i;

/**
 * Parse a string value from an inline edit input into a typed JS value
 * based on the column's SQL data type.
 */
export function parseEditValue(raw: string, dataType: string, isNullable: boolean): unknown {
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

  return trimmed;
}
