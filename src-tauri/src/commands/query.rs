use serde::Serialize;
use serde_json::Value;
use sqlx::Arguments as _;

use super::sql_util::{
    fetch_column_info, mysql_json_row_sql, mysql_quote, pg_json_row_sql, pg_quote,
    sqlite_json_row_sql,
};
use crate::commands::connection::{AppState, DbPool};

pub use super::sql_util::ColumnInfo;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub table_type: String, // "table" | "view"
    pub row_estimate: Option<i64>,
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

    let columns = fetch_column_info(&pool, &table).await?;

    match pool {
        DbPool::Postgres(pg) => {
            let order_clause = build_pk_order_clause(&columns, pg_quote);
            let filter_clause = build_filter_clause(&filters, pg_quote, ParamStyle::Numbered);

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
                let quoted = pg_quote(&table);
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

            let row_sql = pg_json_row_sql(
                &table,
                &filter_clause.sql,
                &order_clause,
                filter_clause.values.len(),
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
            if columns.is_empty() {
                return Ok(QueryResult {
                    columns,
                    rows: vec![],
                    total_results: 0,
                    total_pages: 1,
                });
            }

            let order_clause = build_pk_order_clause(&columns, mysql_quote);
            let filter_clause = build_filter_clause(&filters, mysql_quote, ParamStyle::Positional);

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
                let quoted = mysql_quote(&table);
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

            let row_sql = mysql_json_row_sql(&table, &columns, &filter_clause.sql, &order_clause);
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
            if columns.is_empty() {
                return Ok(QueryResult {
                    columns,
                    rows: vec![],
                    total_results: 0,
                    total_pages: 1,
                });
            }

            let order_clause = build_pk_order_clause(&columns, pg_quote);
            let filter_clause = build_filter_clause(&filters, pg_quote, ParamStyle::Positional);

            let quoted = pg_quote(&table);
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

            let row_sql = sqlite_json_row_sql(&table, &columns, &filter_clause.sql, &order_clause);
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
    use super::super::sql_util::mysql_utf8_literal;
    use super::parse_json_rows;
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
