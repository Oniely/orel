import type { ReferentialAction } from "../types/database";

// Per-dialect type lists for the structure editor type dropdown.
// Names match the normalized types returned by the backend (same as DataGrid/EditorResultGrid).

export const DIALECT_TYPES: Record<string, string[]> = {
  postgres: [
    "smallint", "integer", "bigint", "serial", "bigserial",
    "real", "double precision", "numeric", "decimal",
    "boolean",
    "varchar", "char", "text",
    "date", "time", "timestamp", "timestamptz", "interval",
    "uuid", "json", "jsonb",
    "bytea", "inet", "cidr", "macaddr", "xml", "money",
    "bit", "varbit",
  ],
  mysql: [
    "tinyint", "smallint", "int", "mediumint", "bigint",
    "float", "double", "decimal", "numeric",
    "varchar", "char", "text", "tinytext", "mediumtext", "longtext",
    "date", "time", "datetime", "timestamp", "year",
    "json", "boolean",
    "enum", "set",
    "binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob",
    "bit",
  ],
  sqlite: [
    "integer", "text", "real", "blob", "numeric",
    "boolean", "date", "time", "datetime",
  ],
};

interface TypeParamsMeta {
  placeholder: string;
  /** Set when the type can't be declared without params, e.g. "a length" */
  required?: string;
  /** Filled in when a column switches to this type, so it can be saved as-is */
  defaultParams?: string;
}

// Types that show a secondary parameter input (length, precision, enum values)
export const TYPE_PARAMS_META: Record<string, Record<string, TypeParamsMeta>> = {
  postgres: {
    varchar: { placeholder: "255" },
    char: { placeholder: "1" },
    numeric: { placeholder: "10,2" },
    decimal: { placeholder: "10,2" },
    bit: { placeholder: "1" },
    varbit: { placeholder: "64" },
  },
  mysql: {
    varchar: { placeholder: "255", required: "a length", defaultParams: "255" },
    char: { placeholder: "1" },
    decimal: { placeholder: "10,2" },
    numeric: { placeholder: "10,2" },
    enum: { placeholder: "'val1','val2'", required: "a list of values" },
    set: { placeholder: "'val1','val2'", required: "a list of values" },
    binary: { placeholder: "1" },
    varbinary: { placeholder: "255", required: "a length", defaultParams: "255" },
  },
  sqlite: {},
};

/** Params a column starts with when it switches to `dataType` */
export function defaultTypeParams(dialect: string, dataType: string): string | null {
  return TYPE_PARAMS_META[dialect]?.[dataType]?.defaultParams ?? null;
}

/** Why a column of this type can't be saved with these params, or null if it can */
export function missingTypeParams(
  dialect: string,
  column: { name: string; dataType: string; typeParams: string | null },
): string | null {
  const required = TYPE_PARAMS_META[dialect]?.[column.dataType]?.required;
  if (!required || column.typeParams?.trim()) return null;
  const name = column.name.trim();
  const label = name ? `Column "${name}"` : "A new column";
  return `${label} (${column.dataType}) needs ${required}.`;
}

// ON UPDATE / ON DELETE choices for new foreign keys. InnoDB rejects SET DEFAULT.
export const REFERENTIAL_ACTIONS: Record<string, ReferentialAction[]> = {
  postgres: ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"],
  mysql: ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL"],
  sqlite: ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"],
};

// Why a dialect's foreign keys can't be changed from the Structure view (absent = editable)
export const FOREIGN_KEYS_READ_ONLY_REASON: Record<string, string | undefined> = {
  sqlite: "SQLite can't change foreign keys without rebuilding the table",
};
