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
                "SELECT TABLE_NAME, \
                CASE TABLE_TYPE \
                    WHEN 'BASE TABLE' THEN 'table' \
                    WHEN 'VIEW' THEN 'view' \
                    ELSE 'table' \
                END, \
                TABLE_ROWS \
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
                .map(|(name, data_type, is_nullable, is_primary, has_default)| ColumnInfo {
                    name,
                    data_type,
                    is_nullable: is_nullable == "YES",
                    is_primary,
                    has_default,
                })
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
            let pk_cols: Vec<&str> = columns
                .iter()
                .filter(|c| c.is_primary)
                .map(|c| c.name.as_str())
                .collect();
            let order_clause = if pk_cols.is_empty() {
                String::new()
            } else {
                format!(
                    " ORDER BY {}",
                    pk_cols.iter().map(|c| pg_quote(c)).collect::<Vec<_>>().join(", ")
                )
            };
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

            let rows: Vec<Value> = raw
                .iter()
                .filter_map(|s| serde_json::from_str(s).ok())
                .collect();

            Ok(QueryResult {
                columns,
                rows,
                total_estimate,
            })
        }
        DbPool::MySql(mysql) => {
            // Column info
            let col_rows = sqlx::query_as::<_, (String, String, String, i8, i8)>(
                "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, IF(COLUMN_KEY = 'PRI', 1, 0), \
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
                .map(|(name, data_type, is_nullable, is_primary, has_default)| ColumnInfo {
                    name,
                    data_type,
                    is_nullable: is_nullable == "YES",
                    is_primary: is_primary != 0,
                    has_default: has_default != 0,
                })
                .collect();

            // Row count estimate
            let total_estimate: Option<i64> = sqlx::query_scalar::<_, Option<i64>>(
                "SELECT TABLE_ROWS FROM information_schema.TABLES \
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
                    let quoted_col = c.name.replace('`', "``");
                    format!("'{}', CAST(`{}` AS CHAR)", c.name, quoted_col)
                })
                .collect::<Vec<_>>()
                .join(", ");
            let quoted = mysql_quote(&table);
            let pk_cols: Vec<&str> = columns
                .iter()
                .filter(|c| c.is_primary)
                .map(|c| c.name.as_str())
                .collect();
            let order_clause = if pk_cols.is_empty() {
                String::new()
            } else {
                format!(
                    " ORDER BY {}",
                    pk_cols.iter().map(|c| mysql_quote(c)).collect::<Vec<_>>().join(", ")
                )
            };
            let row_query = format!(
                "SELECT JSON_OBJECT({}) FROM {}{} LIMIT ? OFFSET ?",
                col_refs, quoted, order_clause
            );
            let raw: Vec<String> = sqlx::query_scalar(&row_query)
                .bind(limit)
                .bind(offset)
                .fetch_all(&mysql)
                .await
                .map_err(|e| e.to_string())?;

            let rows: Vec<Value> = raw
                .iter()
                .filter_map(|s| serde_json::from_str(s).ok())
                .collect();

            Ok(QueryResult {
                columns,
                rows,
                total_estimate,
            })
        }
    }
}
