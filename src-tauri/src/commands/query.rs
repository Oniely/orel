use serde::Serialize;
use serde_json::Value;
use sqlx::Arguments as _;

use crate::commands::connection::{AppState, DbPool};

/// Normalizes a SQLite declared column type to the canonical name sqlx uses,
/// mirroring sqlx-sqlite's DataType::from_str affinity rules.
fn normalize_sqlite_type(declared: &str) -> String {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub table_type: String, // "table" | "view"
    pub row_estimate: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary: bool,
    pub has_default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Value>,
    pub total_results: i64,
    pub total_pages: i64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterRow {
    pub col: String,
    pub op: String,
    pub val: String,
    pub conjunction: String,
}

#[derive(Debug, Clone, Copy)]
enum ParamStyle {
    Numbered,   // Postgres $1, $2, ...
    Positional, // MySQL / SQLite ?
}

struct FilterClause {
    sql: String,
    values: Vec<String>,
}

fn next_param(idx: &mut usize, style: ParamStyle) -> String {
    match style {
        ParamStyle::Numbered => {
            let ph = format!("${}", *idx);
            *idx += 1;
            ph
        }
        ParamStyle::Positional => "?".to_string(),
    }
}

/// Builds a SQL WHERE clause from a list of filter rows.
///
/// Column names are quoted via `quote_fn`. Values are always bound as
/// parameters — never interpolated — so SQL injection is not possible.
/// The resulting SQL fragment is injected into a dynamically-built query
/// that is wrapped in `AssertSqlSafe` at the call site.
fn build_filter_clause(
    filters: &[FilterRow],
    quote_fn: fn(&str) -> String,
    style: ParamStyle,
) -> FilterClause {
    if filters.is_empty() {
        return FilterClause {
            sql: String::new(),
            values: vec![],
        };
    }

    let mut parts: Vec<String> = Vec::new();
    let mut values: Vec<String> = Vec::new();
    let mut param_idx: usize = 1;

    for f in filters.iter() {
        if f.col.is_empty() {
            continue;
        }

        let col = quote_fn(&f.col);
        let prefix = if parts.is_empty() {
            "WHERE"
        } else {
            f.conjunction.as_str()
        };

        let condition: String = match f.op.as_str() {
            "is null" => format!("{col} IS NULL"),
            "is not null" => format!("{col} IS NOT NULL"),
            "in" | "not in" => {
                let items: Vec<&str> = f
                    .val
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .collect();
                if items.is_empty() {
                    continue;
                }
                let not = if f.op == "not in" { "NOT " } else { "" };
                let phs: Vec<String> = items
                    .iter()
                    .map(|v| {
                        values.push(v.to_string());
                        next_param(&mut param_idx, style)
                    })
                    .collect();
                format!("{col} {not}IN ({})", phs.join(", "))
            }
            op => {
                if f.val.is_empty() {
                    continue;
                }
                let (sql_op, val) = match op {
                    "equals" => ("=", f.val.clone()),
                    "not equals" => ("!=", f.val.clone()),
                    "contains" => ("LIKE", format!("%{}%", f.val)),
                    "starts with" => ("LIKE", format!("{}%", f.val)),
                    ">" | "<" | ">=" | "<=" => (op, f.val.clone()),
                    _ => continue,
                };
                values.push(val);
                let ph = next_param(&mut param_idx, style);
                format!("{col} {sql_op} {ph}")
            }
        };

        parts.push(format!("{prefix} {condition}"));
    }

    FilterClause {
        sql: parts.join(" "),
        values,
    }
}

pub(crate) fn pg_quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(crate) fn mysql_quote(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

fn mysql_utf8_literal(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let bytes = value.as_bytes();
    let mut encoded = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }

    format!("CONVERT(X'{encoded}' USING utf8mb4)")
}

fn parse_json_rows(raw: Vec<String>) -> Result<Vec<Value>, String> {
    raw.into_iter()
        .enumerate()
        .map(|(index, row)| {
            serde_json::from_str(&row).map_err(|error| {
                format!("Failed to decode result row {} as JSON: {error}", index + 1)
            })
        })
        .collect()
}

fn build_pk_order_clause(columns: &[ColumnInfo], quote_fn: fn(&str) -> String) -> String {
    let pk_cols: Vec<&str> = columns
        .iter()
        .filter(|c| c.is_primary)
        .map(|c| c.name.as_str())
        .collect();
    if pk_cols.is_empty() {
        String::new()
    } else {
        format!(
            " ORDER BY {}",
            pk_cols
                .iter()
                .map(|c| quote_fn(c))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

#[tauri::command]
pub async fn list_tables(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TableInfo>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    match pool {
        DbPool::Postgres(pg) => {
            let rows = sqlx::query_as::<_, (String, String, Option<i64>)>(
                "SELECT t.table_name, \
                CASE t.table_type \
                    WHEN 'BASE TABLE' THEN 'table' \
                    WHEN 'VIEW' THEN 'view' \
                    ELSE 'table' \
                END, \
                (SELECT reltuples::bigint FROM pg_class c \
                    JOIN pg_namespace n ON n.oid = c.relnamespace \
                    WHERE c.relname = t.table_name AND n.nspname = t.table_schema \
                    LIMIT 1) \
                FROM information_schema.tables t \
                WHERE t.table_schema = 'public' \
                ORDER BY t.table_type DESC, t.table_name",
            )
            .fetch_all(&pg)
            .await
            .map_err(|e| e.to_string())?;

            Ok(rows
                .into_iter()
                .map(|(name, table_type, row_estimate)| TableInfo {
                    name,
                    table_type,
                    row_estimate: row_estimate.filter(|&n| n >= 0),
                })
                .collect())
        }
        DbPool::MySql(mysql) => {
            let rows = sqlx::query_as::<_, (String, String, Option<i64>)>(
                "SELECT CAST(TABLE_NAME AS CHAR), \
                CAST(CASE TABLE_TYPE \
                    WHEN 'BASE TABLE' THEN 'table' \
                    WHEN 'VIEW' THEN 'view' \
                    ELSE 'table' \
                END AS CHAR), \
                CAST(TABLE_ROWS AS SIGNED) \
                FROM information_schema.TABLES \
                WHERE TABLE_SCHEMA = DATABASE() \
                ORDER BY TABLE_TYPE DESC, TABLE_NAME",
            )
            .fetch_all(&mysql)
            .await
            .map_err(|e| e.to_string())?;

            Ok(rows
                .into_iter()
                .map(|(name, table_type, row_estimate)| TableInfo {
                    name,
                    table_type,
                    row_estimate,
                })
                .collect())
        }
        DbPool::Sqlite(sqlite) => {
            let rows = sqlx::query_as::<_, (String, String)>(
                "SELECT name, type FROM sqlite_master \
                WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
                ORDER BY type DESC, name",
            )
            .fetch_all(&sqlite)
            .await
            .map_err(|e| e.to_string())?;

            Ok(rows
                .into_iter()
                .map(|(name, obj_type)| TableInfo {
                    name,
                    table_type: if obj_type == "view" {
                        "view".to_string()
                    } else {
                        "table".to_string()
                    },
                    row_estimate: None,
                })
                .collect())
        }
    }
}

#[tauri::command]
pub async fn fetch_rows(
    connection_id: String,
    table: String,
    limit: i64,
    offset: i64,
    filters: Vec<FilterRow>,
    state: tauri::State<'_, AppState>,
) -> Result<QueryResult, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    match pool {
        DbPool::Postgres(pg) => {
            // Column info
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
            .bind(&table)
            .fetch_all(&pg)
            .await
            .map_err(|e| e.to_string())?;

            let columns: Vec<ColumnInfo> = col_rows
                .into_iter()
                .map(
                    |(name, data_type, is_nullable, is_primary, has_default)| ColumnInfo {
                        name,
                        // pg_type.typname prefixes array types with '_' (e.g. _text, _jsonb).
                        // Normalize to bracket notation (text[], jsonb[]) to match sqlx's display name.
                        data_type: if data_type.starts_with('_') {
                            format!("{}[]", &data_type[1..])
                        } else {
                            data_type
                        },
                        is_nullable: is_nullable == "YES",
                        is_primary,
                        has_default,
                    },
                )
                .collect();

            let quoted = pg_quote(&table);
            let order_clause = build_pk_order_clause(&columns, pg_quote);
            let filter_clause = build_filter_clause(&filters, pg_quote, ParamStyle::Numbered);

            // COUNT: use fast stats estimate when unfiltered, exact COUNT(*) when filtered
            let total_results: i64 = if filter_clause.sql.is_empty() {
                sqlx::query_scalar::<_, i64>(
                    "SELECT reltuples::bigint FROM pg_class WHERE relname = $1",
                )
                .bind(&table)
                .fetch_optional(&pg)
                .await
                .ok()
                .flatten()
                .filter(|&n| n >= 0)
                .unwrap_or(0)
            } else {
                let count_sql = format!("SELECT COUNT(*) FROM {} {}", quoted, filter_clause.sql);
                let mut count_args = sqlx::postgres::PgArguments::default();
                for v in filter_clause.values.iter() {
                    count_args.add(v.as_str()).map_err(|e| e.to_string())?;
                }
                sqlx::query_scalar_with::<_, i64, _>(sqlx::AssertSqlSafe(count_sql), count_args)
                    .fetch_one(&pg)
                    .await
                    .map_err(|e| e.to_string())?
            };

            // Row query — filter params are $1..$n, limit is $(n+1), offset is $(n+2)
            let n = filter_clause.values.len();
            let row_sql = format!(
                "SELECT row_to_json(t)::text FROM \
                (SELECT * FROM {} {} {} LIMIT ${} OFFSET ${}) t",
                quoted,
                filter_clause.sql,
                order_clause,
                n + 1,
                n + 2,
            );
            let mut row_args = sqlx::postgres::PgArguments::default();
            for v in filter_clause.values.into_iter() {
                row_args.add(v).map_err(|e| e.to_string())?;
            }
            row_args.add(limit).map_err(|e| e.to_string())?;
            row_args.add(offset).map_err(|e| e.to_string())?;

            let raw: Vec<String> =
                sqlx::query_scalar_with::<_, String, _>(sqlx::AssertSqlSafe(row_sql), row_args)
                    .fetch_all(&pg)
                    .await
                    .map_err(|e| e.to_string())?;

            let rows = parse_json_rows(raw)?;
            let total_pages = if limit > 0 {
                (total_results + limit - 1) / limit
            } else {
                1
            };

            Ok(QueryResult {
                columns,
                rows,
                total_results,
                total_pages,
            })
        }
        DbPool::MySql(mysql) => {
            // Column info
            let col_rows = sqlx::query_as::<_, (String, String, String, i8, i8)>(
                "SELECT CAST(COLUMN_NAME AS CHAR), \
                CAST(CASE \
                  WHEN COLUMN_TYPE = 'tinyint(1)' THEN 'boolean' \
                  WHEN COLUMN_TYPE LIKE '% unsigned' THEN CONCAT(DATA_TYPE, ' unsigned') \
                  ELSE DATA_TYPE \
                END AS CHAR), \
                CAST(IS_NULLABLE AS CHAR), IF(COLUMN_KEY = 'PRI', 1, 0), \
                IF(COLUMN_DEFAULT IS NOT NULL OR EXTRA LIKE '%auto_increment%', 1, 0) \
                FROM information_schema.COLUMNS \
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? \
                ORDER BY ORDINAL_POSITION",
            )
            .bind(&table)
            .fetch_all(&mysql)
            .await
            .map_err(|e| e.to_string())?;

            let columns: Vec<ColumnInfo> = col_rows
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
                .collect();

            if columns.is_empty() {
                return Ok(QueryResult {
                    columns,
                    rows: vec![],
                    total_results: 0,
                    total_pages: 1,
                });
            }

            let quoted = mysql_quote(&table);
            let order_clause = build_pk_order_clause(&columns, mysql_quote);
            let filter_clause = build_filter_clause(&filters, mysql_quote, ParamStyle::Positional);

            // COUNT: use fast stats estimate when unfiltered, exact COUNT(*) when filtered
            let total_results: i64 = if filter_clause.sql.is_empty() {
                sqlx::query_scalar::<_, Option<i64>>(
                    "SELECT CAST(TABLE_ROWS AS SIGNED) FROM information_schema.TABLES \
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
                )
                .bind(&table)
                .fetch_optional(&mysql)
                .await
                .ok()
                .flatten()
                .flatten()
                .unwrap_or(0)
            } else {
                let count_sql = format!("SELECT COUNT(*) FROM {} {}", quoted, filter_clause.sql);
                let mut count_args = sqlx::mysql::MySqlArguments::default();
                for v in filter_clause.values.iter() {
                    count_args.add(v.as_str()).map_err(|e| e.to_string())?;
                }
                sqlx::query_scalar_with::<_, i64, _>(sqlx::AssertSqlSafe(count_sql), count_args)
                    .fetch_one(&mysql)
                    .await
                    .map_err(|e| e.to_string())?
            };

            // Build JSON_OBJECT query for MySQL
            let col_refs: String = columns
                .iter()
                .map(|c| {
                    format!(
                        "{}, CAST({} AS CHAR)",
                        mysql_utf8_literal(&c.name),
                        mysql_quote(&c.name)
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            let row_sql = format!(
                "SELECT CAST(JSON_OBJECT({}) AS CHAR) FROM {} {} {} LIMIT ? OFFSET ?",
                col_refs, quoted, filter_clause.sql, order_clause,
            );
            let mut row_args = sqlx::mysql::MySqlArguments::default();
            for v in filter_clause.values.into_iter() {
                row_args.add(v).map_err(|e| e.to_string())?;
            }
            row_args.add(limit).map_err(|e| e.to_string())?;
            row_args.add(offset).map_err(|e| e.to_string())?;

            let raw: Vec<String> =
                sqlx::query_scalar_with::<_, String, _>(sqlx::AssertSqlSafe(row_sql), row_args)
                    .fetch_all(&mysql)
                    .await
                    .map_err(|e| e.to_string())?;

            let rows = parse_json_rows(raw)?;
            let total_pages = if limit > 0 {
                (total_results + limit - 1) / limit
            } else {
                1
            };

            Ok(QueryResult {
                columns,
                rows,
                total_results,
                total_pages,
            })
        }
        DbPool::Sqlite(sqlite) => {
            // Column info via pragma_table_info (table-valued function, supports bound params)
            let col_rows = sqlx::query_as::<_, (i32, String, String, i32, Option<String>, i32)>(
                "SELECT * FROM pragma_table_info(?)",
            )
            .bind(&table)
            .fetch_all(&sqlite)
            .await
            .map_err(|e| e.to_string())?;

            let columns: Vec<ColumnInfo> = col_rows
                .into_iter()
                .map(|(_, name, data_type, notnull, dflt_value, pk)| ColumnInfo {
                    name,
                    data_type: normalize_sqlite_type(&data_type),
                    is_nullable: notnull == 0,
                    is_primary: pk > 0,
                    has_default: dflt_value.is_some(),
                })
                .collect();

            if columns.is_empty() {
                return Ok(QueryResult {
                    columns,
                    rows: vec![],
                    total_results: 0,
                    total_pages: 1,
                });
            }

            let quoted = pg_quote(&table);
            let order_clause = build_pk_order_clause(&columns, pg_quote);
            let filter_clause = build_filter_clause(&filters, pg_quote, ParamStyle::Positional);

            // COUNT: SQLite has no catalog stats, always run COUNT(*)
            let count_sql = format!("SELECT COUNT(*) FROM {} {}", quoted, filter_clause.sql);
            let mut count_args = sqlx::sqlite::SqliteArguments::default();
            for v in filter_clause.values.iter() {
                count_args.add(v.as_str()).map_err(|e| e.to_string())?;
            }
            let total_results: i64 =
                sqlx::query_scalar_with::<_, i64, _>(sqlx::AssertSqlSafe(count_sql), count_args)
                    .fetch_one(&sqlite)
                    .await
                    .map_err(|e| e.to_string())?;

            // Build json_object() query; wrap each column with IIF(typeof()='blob',hex(),col)
            // so BLOB values (including untyped columns storing binary data) are hex-encoded
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
            let row_sql = format!(
                "SELECT json_object({}) FROM {} {} {} LIMIT ? OFFSET ?",
                col_refs, quoted, filter_clause.sql, order_clause,
            );
            let mut row_args = sqlx::sqlite::SqliteArguments::default();
            for v in filter_clause.values.into_iter() {
                row_args.add(v).map_err(|e| e.to_string())?;
            }
            row_args.add(limit).map_err(|e| e.to_string())?;
            row_args.add(offset).map_err(|e| e.to_string())?;

            let raw: Vec<String> =
                sqlx::query_scalar_with::<_, String, _>(sqlx::AssertSqlSafe(row_sql), row_args)
                    .fetch_all(&sqlite)
                    .await
                    .map_err(|e| e.to_string())?;

            let rows = parse_json_rows(raw)?;
            let total_pages = if limit > 0 {
                (total_results + limit - 1) / limit
            } else {
                1
            };

            Ok(QueryResult {
                columns,
                rows,
                total_results,
                total_pages,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{mysql_utf8_literal, parse_json_rows};
    use serde_json::json;

    #[test]
    fn mysql_utf8_literal_handles_quotes_backslashes_and_unicode() {
        assert_eq!(
            mysql_utf8_literal("owner's\\猫"),
            "CONVERT(X'6F776E657227735CE78CAB' USING utf8mb4)"
        );
    }

    #[test]
    fn json_rows_preserve_every_valid_row() {
        let rows = parse_json_rows(vec!["{\"id\":1}".to_string(), "{\"id\":2}".to_string()]);

        assert_eq!(rows.unwrap(), vec![json!({ "id": 1 }), json!({ "id": 2 })]);
    }

    #[test]
    fn invalid_json_row_returns_its_position() {
        let error =
            parse_json_rows(vec!["{\"id\":1}".to_string(), "invalid".to_string()]).unwrap_err();

        assert!(error.contains("row 2"));
    }
}
