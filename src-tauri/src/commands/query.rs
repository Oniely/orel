use serde::Serialize;
use serde_json::Value;

use crate::commands::connection::{AppState, DbPool};

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
    pub total_estimate: Option<i64>,
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
                "SELECT c.column_name, c.data_type, c.is_nullable, \
                EXISTS( \
                    SELECT 1 FROM information_schema.table_constraints tc \
                    JOIN information_schema.key_column_usage kcu \
                        ON tc.constraint_name = kcu.constraint_name \
                        AND tc.table_schema = kcu.table_schema \
                        AND tc.table_name = kcu.table_name \
                    WHERE tc.constraint_type = 'PRIMARY KEY' \
                        AND tc.table_name = c.table_name \
                        AND tc.table_schema = c.table_schema \
                        AND kcu.column_name = c.column_name \
                ), \
                (c.column_default IS NOT NULL) \
                FROM information_schema.columns c \
                WHERE c.table_name = $1 \
                AND c.table_schema = 'public' \
                ORDER BY c.ordinal_position",
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
                        data_type,
                        is_nullable: is_nullable == "YES",
                        is_primary,
                        has_default,
                    },
                )
                .collect();

            // Row count estimate
            let total_estimate: Option<i64> = sqlx::query_scalar::<_, i64>(
                "SELECT reltuples::bigint FROM pg_class WHERE relname = $1",
            )
            .bind(&table)
            .fetch_optional(&pg)
            .await
            .ok()
            .flatten()
            .filter(|&n| n >= 0);

            // Fetch rows as JSON using PostgreSQL's row_to_json
            let quoted = pg_quote(&table);
            let order_clause = build_pk_order_clause(&columns, pg_quote);
            let row_query = format!(
                "SELECT row_to_json(t)::text FROM (SELECT * FROM {}{} LIMIT $1 OFFSET $2) t",
                quoted, order_clause
            );
            let raw: Vec<String> = sqlx::query_scalar(&row_query)
                .bind(limit)
                .bind(offset)
                .fetch_all(&pg)
                .await
                .map_err(|e| e.to_string())?;

            let rows = parse_json_rows(raw)?;

            Ok(QueryResult {
                columns,
                rows,
                total_estimate,
            })
        }
        DbPool::MySql(mysql) => {
            // Column info
            let col_rows = sqlx::query_as::<_, (String, String, String, i8, i8)>(
                "SELECT CAST(COLUMN_NAME AS CHAR), CAST(DATA_TYPE AS CHAR), \
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

            // Row count estimate
            let total_estimate: Option<i64> = sqlx::query_scalar::<_, Option<i64>>(
                "SELECT CAST(TABLE_ROWS AS SIGNED) FROM information_schema.TABLES \
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
            )
            .bind(&table)
            .fetch_optional(&mysql)
            .await
            .ok()
            .flatten()
            .flatten();

            if columns.is_empty() {
                return Ok(QueryResult {
                    columns,
                    rows: vec![],
                    total_estimate,
                });
            }

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
            let quoted = mysql_quote(&table);
            let order_clause = build_pk_order_clause(&columns, mysql_quote);
            let row_query = format!(
                "SELECT CAST(JSON_OBJECT({}) AS CHAR) FROM {}{} LIMIT ? OFFSET ?",
                col_refs, quoted, order_clause
            );
            let raw: Vec<String> = sqlx::query_scalar(&row_query)
                .bind(limit)
                .bind(offset)
                .fetch_all(&mysql)
                .await
                .map_err(|e| e.to_string())?;

            let rows = parse_json_rows(raw)?;

            Ok(QueryResult {
                columns,
                rows,
                total_estimate,
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
                    data_type: data_type.to_lowercase(),
                    is_nullable: notnull == 0,
                    is_primary: pk > 0,
                    has_default: dflt_value.is_some(),
                })
                .collect();

            if columns.is_empty() {
                return Ok(QueryResult {
                    columns,
                    rows: vec![],
                    total_estimate: None,
                });
            }

            // Build json_object() query
            let col_refs: String = columns
                .iter()
                .map(|c| {
                    let quoted_col = pg_quote(&c.name);
                    format!("'{}', {}", c.name.replace('\'', "''"), quoted_col)
                })
                .collect::<Vec<_>>()
                .join(", ");
            let quoted = pg_quote(&table);
            let order_clause = build_pk_order_clause(&columns, pg_quote);
            let row_query = format!(
                "SELECT json_object({}) FROM {}{} LIMIT ? OFFSET ?",
                col_refs, quoted, order_clause
            );
            let raw: Vec<String> = sqlx::query_scalar(&row_query)
                .bind(limit)
                .bind(offset)
                .fetch_all(&sqlite)
                .await
                .map_err(|e| e.to_string())?;

            let rows = parse_json_rows(raw)?;

            Ok(QueryResult {
                columns,
                rows,
                total_estimate: None,
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
