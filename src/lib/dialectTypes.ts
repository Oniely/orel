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

// Types that show a secondary parameter input (length, precision, enum values)
export const TYPE_PARAMS_META: Record<string, Record<string, { placeholder: string }>> = {
  postgres: {
    varchar: { placeholder: "255" },
    char: { placeholder: "1" },
    numeric: { placeholder: "10,2" },
    decimal: { placeholder: "10,2" },
    bit: { placeholder: "1" },
    varbit: { placeholder: "64" },
  },
  mysql: {
    varchar: { placeholder: "255" },
    char: { placeholder: "1" },
    decimal: { placeholder: "10,2" },
    numeric: { placeholder: "10,2" },
    enum: { placeholder: "'val1','val2'" },
    set: { placeholder: "'val1','val2'" },
  },
  sqlite: {},
};
