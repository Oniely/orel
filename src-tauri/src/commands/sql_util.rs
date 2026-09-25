use std::collections::HashSet;

use serde::Serialize;
use sqlx::{mysql::MySqlConnection, postgres::PgConnection, sqlite::SqliteConnection};

use super::connection::DbPool;

// ── Dialect ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Dialect {
    Postgres,
    MySql,
    Sqlite,
}

impl Dialect {
    pub fn quote(&self, name: &str) -> String {
        match self {
            Self::Postgres | Self::Sqlite => pg_quote(name),
            Self::MySql => mysql_quote(name),
        }
    }
}

impl DbPool {
    pub fn dialect(&self) -> Dialect {
        match self {
            Self::Postgres(_) => Dialect::Postgres,
            Self::MySql(_) => Dialect::MySql,
            Self::Sqlite(_) => Dialect::Sqlite,
        }
    }

    pub async fn execute(&self, sql: &str) -> Result<u64, sqlx::Error> {
        let rows = match self {
            Self::Postgres(pg) => sqlx::query(sqlx::AssertSqlSafe(sql))
                .execute(pg)
                .await?
                .rows_affected(),
            Self::MySql(mysql) => sqlx::query(sqlx::AssertSqlSafe(sql))
                .execute(mysql)
                .await?
                .rows_affected(),
            Self::Sqlite(sqlite) => sqlx::query(sqlx::AssertSqlSafe(sql))
                .execute(sqlite)
                .await?
                .rows_affected(),
        };
        Ok(rows)
    }

    /// Runs every statement in one transaction so a failure rolls all of them
    /// back. Postgres and SQLite DDL is transactional; MySQL implicitly commits
    /// each DDL statement, so MySQL callers should send a single statement.
    pub async fn execute_in_transaction(&self, stmts: &[String]) -> Result<(), sqlx::Error> {
        match self {
            Self::Postgres(pg) => {
                let mut tx = pg.begin().await?;
                for stmt in stmts {
                    sqlx::query(sqlx::AssertSqlSafe(stmt.as_str())).execute(&mut *tx).await?;
                }
                tx.commit().await?;
            }
            Self::MySql(mysql) => {
                let mut tx = mysql.begin().await?;
                for stmt in stmts {
                    sqlx::query(sqlx::AssertSqlSafe(stmt.as_str())).execute(&mut *tx).await?;
                }
                tx.commit().await?;
            }
            Self::Sqlite(sqlite) => {
                let mut tx = sqlite.begin().await?;
                for stmt in stmts {
                    sqlx::query(sqlx::AssertSqlSafe(stmt.as_str())).execute(&mut *tx).await?;
                }
                tx.commit().await?;
            }
        }
        Ok(())
    }
}

// ── Identifier quoting ──────────────────────────────────────────────────────

pub(crate) fn pg_quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(crate) fn mysql_quote(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// Plain single-quoted MySQL string literal, for places that only accept a
/// literal (DEFAULT, COMMENT). Assumes NO_BACKSLASH_ESCAPES is off (the default).
pub(crate) fn mysql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

// ── Type normalization ──────────────────────────────────────────────────────

pub(crate) fn normalize_type(dialect: Dialect, raw: &str) -> String {
    match dialect {
        Dialect::Postgres => normalize_pg_type(raw),
        Dialect::MySql => normalize_mysql_type(raw),
        Dialect::Sqlite => normalize_sqlite_type(raw),
    }
}

/// Normalizes a Postgres type name to SQL standard form.
/// Maps internal names (int4, bool, float8) to canonical names (integer, boolean, double precision).
/// Handles array prefix: _text -> text[], _int4 -> integer[].
pub(crate) fn normalize_pg_type(raw: &str) -> String {
    let s = raw.to_ascii_lowercase();

    // Array types: pg prefixes with '_' (e.g. _text, _int4)
    if let Some(inner) = s.strip_prefix('_') {
        return format!("{}[]", normalize_pg_type(inner));
    }

    match s.as_str() {
        "bool" => "boolean".to_string(),
        "int2" => "smallint".to_string(),
        "int4" => "integer".to_string(),
        "int8" => "bigint".to_string(),
        "float4" => "real".to_string(),
        "float8" => "double precision".to_string(),
        "bpchar" => "char".to_string(),
        _ => s,
    }
}

/// Normalizes a MySQL type name. Lowercases and maps internal aliases.
pub(crate) fn normalize_mysql_type(raw: &str) -> String {
    let s = raw.to_ascii_lowercase();
    match s.as_str() {
        "newdecimal" => "decimal".to_string(),
        // MySQL BOOLEAN/BOOL is an alias for TINYINT(1), not a real boolean type
        "boolean" | "bool" => "tinyint".to_string(),
        _ => s,
    }
}

/// Normalizes a SQLite declared column type to the canonical name sqlx uses,
/// mirroring sqlx-sqlite's DataType::from_str affinity rules.
pub(crate) fn normalize_sqlite_type(declared: &str) -> String {
    let s = declared.to_ascii_lowercase();
    match s.as_str() {
        "boolean" | "bool" => "boolean".to_string(),
        "date" => "date".to_string(),
        "time" => "time".to_string(),
        "datetime" | "timestamp" => "datetime".to_string(),
        _ if s.contains("int") => "integer".to_string(),
        _ if s.contains("char") || s.contains("clob") || s.contains("text") => "text".to_string(),
        _ if s.contains("blob") => "blob".to_string(),
        _ if s.contains("real") || s.contains("floa") || s.contains("doub") => "real".to_string(),
        _ => s,
    }
}

// ── ColumnInfo ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary: bool,
    pub has_default: bool,
}

// ── Column metadata fetch ───────────────────────────────────────────────────

pub(crate) async fn fetch_column_info(
    pool: &DbPool,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    match pool {
        DbPool::Postgres(pg) => {
            let col_rows = sqlx::query_as::<_, (String, String, String, bool, bool)>(
                "SELECT \
                    a.attname, \
                    t.typname, \
                    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, \
                    EXISTS( \
                        SELECT 1 FROM pg_catalog.pg_constraint con \
                        WHERE con.conrelid = cl.oid \
                            AND con.contype = 'p' \
                            AND a.attnum = ANY(con.conkey) \
                    ), \
                    (a.atthasdef OR a.attidentity != '') \
                FROM pg_catalog.pg_attribute a \
                JOIN pg_catalog.pg_class cl ON cl.oid = a.attrelid \
                JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace \
                JOIN pg_catalog.pg_type t ON t.oid = a.atttypid \
                WHERE cl.relname = $1 \
                    AND n.nspname = 'public' \
                    AND a.attnum > 0 \
                    AND NOT a.attisdropped \
                ORDER BY a.attnum",
            )
            .bind(table)
            .fetch_all(pg)
            .await
            .map_err(|e| e.to_string())?;

            Ok(col_rows
                .into_iter()
                .map(
                    |(name, data_type, is_nullable, is_primary, has_default)| ColumnInfo {
                        name,
                        data_type: normalize_pg_type(&data_type),
                        is_nullable: is_nullable == "YES",
                        is_primary,
                        has_default,
                    },
                )
                .collect())
        }
        DbPool::MySql(mysql) => {
            let col_rows = sqlx::query_as::<_, (String, String, String, i8, i8)>(
                "SELECT CAST(COLUMN_NAME AS CHAR), \
                CAST(CASE \
                  WHEN COLUMN_TYPE LIKE '% unsigned' THEN CONCAT(DATA_TYPE, ' unsigned') \
                  ELSE DATA_TYPE \
                END AS CHAR), \
                CAST(IS_NULLABLE AS CHAR), IF(COLUMN_KEY = 'PRI', 1, 0), \
                IF(COLUMN_DEFAULT IS NOT NULL OR EXTRA LIKE '%auto_increment%', 1, 0) \
                FROM information_schema.COLUMNS \
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? \
                ORDER BY ORDINAL_POSITION",
            )
            .bind(table)
            .fetch_all(mysql)
            .await
            .map_err(|e| e.to_string())?;

            Ok(col_rows
                .into_iter()
                .map(
                    |(name, data_type, is_nullable, is_primary, has_default)| ColumnInfo {
                        name,
                        data_type,
                        is_nullable: is_nullable == "YES",
                        is_primary: is_primary != 0,
                        has_default: has_default != 0,
                    },
                )
                .collect())
        }
        DbPool::Sqlite(sqlite) => {
            let col_rows = sqlx::query_as::<_, (i32, String, String, i32, Option<String>, i32)>(
                "SELECT * FROM pragma_table_info(?)",
            )
            .bind(table)
            .fetch_all(sqlite)
            .await
            .map_err(|e| e.to_string())?;

            Ok(col_rows
                .into_iter()
                .map(|(_, name, data_type, notnull, dflt_value, pk)| ColumnInfo {
                    name,
                    data_type: normalize_sqlite_type(&data_type),
                    is_nullable: notnull == 0,
                    is_primary: pk > 0,
                    has_default: dflt_value.is_some(),
                })
                .collect())
        }
    }
}

// ── JSON row query builders ─────────────────────────────────────────────────

pub(crate) fn mysql_utf8_literal(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let bytes = value.as_bytes();
    let mut encoded = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }

    format!("CONVERT(X'{encoded}' USING utf8mb4)")
}

/// Build a SELECT that returns one JSON-string per row for Postgres.
/// Uses row_to_json(t)::text with subquery wrapping.
/// `param_count` is the number of filter params already bound ($1..$n).
pub(crate) fn pg_json_row_sql(
    table: &str,
    filter_sql: &str,
    order_clause: &str,
    param_count: usize,
) -> String {
    let quoted = pg_quote(table);
    format!(
        "SELECT row_to_json(t)::text FROM \
        (SELECT * FROM {} {} {} LIMIT ${} OFFSET ${}) t",
        quoted,
        filter_sql,
        order_clause,
        param_count + 1,
        param_count + 2,
    )
}

/// Build a SELECT that returns one JSON-string per row for MySQL.
/// JSON_OBJECT would encode BIGINT/DECIMAL as JSON numbers (precision lost in
/// serde_json and JS), FLOAT as widened doubles, BIT as base64, and DATETIME
/// with a `.000000` suffix, so only types that round-trip exactly are passed
/// raw; binary columns are hex-encoded, BIT as a bit string, the rest CAST to text.
pub(crate) fn mysql_json_row_sql(
    table: &str,
    columns: &[ColumnInfo],
    filter_sql: &str,
    order_clause: &str,
) -> String {
    let quoted = mysql_quote(table);
    let col_refs: String = columns
        .iter()
        .map(|c| {
            let key = mysql_utf8_literal(&c.name);
            let col = mysql_quote(&c.name);
            if is_mysql_binary_type(&c.data_type) {
                format!("{key}, CONCAT('0x', HEX({col}))")
            } else if c.data_type == "bit" {
                format!("{key}, BIN({col})")
            } else if is_mysql_json_safe_type(&c.data_type) {
                format!("{key}, {col}")
            } else {
                format!("{key}, CAST({col} AS CHAR)")
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "SELECT CAST(JSON_OBJECT({}) AS CHAR) FROM {} {} {} LIMIT ? OFFSET ?",
        col_refs, quoted, filter_sql, order_clause,
    )
}

/// Types JSON_OBJECT encodes without loss: integers that fit in a JS number
/// (up to INT UNSIGNED) and JSON itself.
fn is_mysql_json_safe_type(data_type: &str) -> bool {
    matches!(
        data_type,
        "tinyint"
            | "tinyint unsigned"
            | "smallint"
            | "smallint unsigned"
            | "mediumint"
            | "mediumint unsigned"
            | "int"
            | "int unsigned"
            | "year"
            | "json"
    )
}

pub(crate) fn is_mysql_binary_type(data_type: &str) -> bool {
    matches!(
        data_type,
        "tinyblob" | "blob" | "mediumblob" | "longblob" | "binary" | "varbinary"
    )
}

/// Build a SELECT that returns one JSON-string per row for SQLite.
/// Uses json_object with IIF(typeof()='blob', hex(), col) wrapping.
pub(crate) fn sqlite_json_row_sql(
    table: &str,
    columns: &[ColumnInfo],
    filter_sql: &str,
    order_clause: &str,
) -> String {
    let quoted = pg_quote(table);
    let col_refs: String = columns
        .iter()
        .map(|c| {
            let quoted_col = pg_quote(&c.name);
            let key = c.name.replace('\'', "''");
            format!(
                "'{}', IIF(typeof({}) = 'blob', '0x' || hex({}), {})",
                key, quoted_col, quoted_col, quoted_col
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "SELECT json_object({}) FROM {} {} {} LIMIT ? OFFSET ?",
        col_refs, quoted, filter_sql, order_clause,
    )
}

// ── Primary key queries ─────────────────────────────────────────────────────

pub(crate) async fn pg_primary_columns(
    connection: &mut PgConnection,
    tables: &[String],
) -> HashSet<String> {
    let mut primary_columns = HashSet::new();
    for table in tables {
        let names = sqlx::query_scalar::<_, String>(
            "SELECT kcu.column_name FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name \
             AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name \
             WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1",
        )
        .bind(table)
        .fetch_all(&mut *connection)
        .await
        .unwrap_or_default();
        primary_columns.extend(names);
    }
    primary_columns
}

pub(crate) async fn mysql_primary_columns(
    connection: &mut MySqlConnection,
    tables: &[String],
) -> HashSet<String> {
    let mut primary_columns = HashSet::new();
    for table in tables {
        let names = sqlx::query_scalar::<_, String>(
            "SELECT CAST(COLUMN_NAME AS CHAR) FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'",
        )
        .bind(table)
        .fetch_all(&mut *connection)
        .await
        .unwrap_or_default();
        primary_columns.extend(names);
    }
    primary_columns
}

pub(crate) async fn sqlite_primary_columns(
    connection: &mut SqliteConnection,
    tables: &[String],
) -> HashSet<String> {
    let mut primary_columns = HashSet::new();
    for table in tables {
        let names =
            sqlx::query_scalar::<_, String>("SELECT name FROM pragma_table_info(?) WHERE pk > 0")
                .bind(table)
                .fetch_all(&mut *connection)
                .await
                .unwrap_or_default();
        primary_columns.extend(names);
    }
    primary_columns
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pg_type_normalization() {
        assert_eq!(normalize_pg_type("int4"), "integer");
        assert_eq!(normalize_pg_type("int8"), "bigint");
        assert_eq!(normalize_pg_type("int2"), "smallint");
        assert_eq!(normalize_pg_type("bool"), "boolean");
        assert_eq!(normalize_pg_type("float4"), "real");
        assert_eq!(normalize_pg_type("float8"), "double precision");
        assert_eq!(normalize_pg_type("bpchar"), "char");
        assert_eq!(normalize_pg_type("varchar"), "varchar");
        assert_eq!(normalize_pg_type("text"), "text");
        assert_eq!(normalize_pg_type("timestamptz"), "timestamptz");
    }

    #[test]
    fn pg_array_type_normalization() {
        assert_eq!(normalize_pg_type("_text"), "text[]");
        assert_eq!(normalize_pg_type("_int4"), "integer[]");
        assert_eq!(normalize_pg_type("_bool"), "boolean[]");
        assert_eq!(normalize_pg_type("_float8"), "double precision[]");
        assert_eq!(normalize_pg_type("_jsonb"), "jsonb[]");
    }

    #[test]
    fn mysql_type_normalization() {
        assert_eq!(normalize_mysql_type("NEWDECIMAL"), "decimal");
        assert_eq!(normalize_mysql_type("INT"), "int");
        assert_eq!(normalize_mysql_type("VARCHAR"), "varchar");
        // MySQL BOOLEAN/BOOL is just TINYINT(1), not a real boolean
        assert_eq!(normalize_mysql_type("BOOLEAN"), "tinyint");
        assert_eq!(normalize_mysql_type("BOOL"), "tinyint");
    }

    #[test]
    fn sqlite_type_normalization() {
        assert_eq!(normalize_sqlite_type("INTEGER"), "integer");
        assert_eq!(normalize_sqlite_type("TEXT"), "text");
        assert_eq!(normalize_sqlite_type("BOOLEAN"), "boolean");
        assert_eq!(normalize_sqlite_type("BLOB"), "blob");
        assert_eq!(normalize_sqlite_type("REAL"), "real");
    }

    #[test]
    fn mysql_unsigned_passthrough() {
        assert_eq!(normalize_mysql_type("BIGINT UNSIGNED"), "bigint unsigned");
        assert_eq!(normalize_mysql_type("INT UNSIGNED"), "int unsigned");
        assert_eq!(
            normalize_mysql_type("TINYINT UNSIGNED"),
            "tinyint unsigned"
        );
    }

    #[test]
    fn mysql_utf8_literal_handles_quotes_backslashes_and_unicode() {
        assert_eq!(
            mysql_utf8_literal("owner's\\猫"),
            "CONVERT(X'6F776E657227735CE78CAB' USING utf8mb4)"
        );
    }

    #[tokio::test]
    #[ignore = "requires Docker"]
    async fn mysql_json_rows_preserve_exact_values() {
        use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
        use testcontainers_modules::{mysql::Mysql, testcontainers::runners::AsyncRunner};

        let container = Mysql::default().start().await.unwrap();
        let port = container.get_host_port_ipv4(3306).await.unwrap();
        let host = container.get_host().await.unwrap().to_string();
        let opts = MySqlConnectOptions::new().host(&host).port(port).username("root").database("test");
        let pool = MySqlPoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();

        sqlx::query(
            "CREATE TABLE vals (id INT PRIMARY KEY, big BIGINT UNSIGNED, amount DECIMAL(20,4), \
             f FLOAT, flag BIT(1), dt DATETIME, doc JSON, blobby BLOB, missing VARCHAR(5))",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO vals VALUES (1, 9007199254740993, 12345678901234.5678, 0.1, b'1', \
             '2024-01-02 03:04:05', '{\"a\": 1}', X'CAFE', NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let db = DbPool::MySql(pool.clone());
        let columns = fetch_column_info(&db, "vals").await.unwrap();
        let sql = mysql_json_row_sql("vals", &columns, "", "");
        let raw: String = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
            .bind(10i64)
            .bind(0i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        let row: serde_json::Value = serde_json::from_str(&raw).unwrap();

        assert_eq!(row["id"], serde_json::json!(1));
        assert_eq!(row["big"], "9007199254740993");
        assert_eq!(row["amount"], "12345678901234.5678");
        assert_eq!(row["f"], "0.1");
        assert_eq!(row["flag"], "1");
        assert_eq!(row["dt"], "2024-01-02 03:04:05");
        assert_eq!(row["doc"], serde_json::json!({"a": 1}));
        assert_eq!(row["blobby"], "0xCAFE");
        assert!(row["missing"].is_null());
    }
}
