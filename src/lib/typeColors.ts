export const TYPE_COLORS: Record<string, string> = {
  uuid: "oklch(72% 0.12 290)",
  varchar: "oklch(76% 0.13 150)",
  "character varying": "oklch(76% 0.13 150)",
  text: "oklch(76% 0.13 150)",
  boolean: "oklch(74% 0.13 30)",
  bool: "oklch(74% 0.13 30)",
  timestamp: "oklch(78% 0.06 250)",
  "timestamp with time zone": "oklch(78% 0.06 250)",
  timestamptz: "oklch(78% 0.06 250)",
  integer: "oklch(74% 0.12 220)",
  int: "oklch(74% 0.12 220)",
  int4: "oklch(74% 0.12 220)",
  bigint: "oklch(74% 0.12 220)",
  int8: "oklch(74% 0.12 220)",
  numeric: "oklch(74% 0.12 220)",
  decimal: "oklch(74% 0.12 220)",
  float4: "oklch(74% 0.12 220)",
  float8: "oklch(74% 0.12 220)",
  real: "oklch(74% 0.12 220)",
  "double precision": "oklch(74% 0.12 220)",
  jsonb: "oklch(74% 0.12 330)",
  json: "oklch(74% 0.12 330)",
};

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? "oklch(70% 0.02 273)";
}
