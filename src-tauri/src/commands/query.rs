use serde::Serialize;
use sqlx::Arguments as _;

use crate::commands::connection::{AppState, DbPool};
use crate::commands::decode::SqlCell;
use crate::commands::executor::{
    mysql_describe_types, mysql_fetch, pg_describe_types, pg_fetch_with, sqlite_describe_types,
    sqlite_fetch,
};
use crate::commands::sql;

// ── Query types ───────────────────────────────────────────────────────────────

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
    pub rows: Vec<Vec<SqlCell>>,
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

// ── Filter helpers ────────────────────────────────────────────────────────────

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
        return FilterClause { sql: String::new(), values: vec![] };
    }

    let mut parts: Vec<String> = Vec::new();
    let mut values: Vec<String> = Vec::new();
    let mut param_idx: usize = 1;

    for f in filters.iter() {
        if f.col.is_empty() {
            continue;
        }

        let col = quote_fn(&f.col);
        let prefix = if parts.is_empty() { "WHERE" } else { f.conjunction.as_str() };

        let condition: String = match f.op.as_str() {
            "is null" => format!("{col} IS NULL"),
            "is not null" => format!("{col} IS NOT NULL"),
            "in" | "not in" => {
                let items: Vec<&str> =
                    f.val.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
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

    FilterClause { sql: parts.join(" "), values }
}

pub(crate) fn pg_quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(crate) fn mysql_quote(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

fn build_pk_order_clause(columns: &[ColumnInfo], quote_fn: fn(&str) -> String) -> String {
    let pk_cols: Vec<&str> =
        columns.iter().filter(|c| c.is_primary).map(|c| c.name.as_str()).collect();
    if pk_cols.is_empty() {
        String::new()
    } else {
        format!(
            " ORDER BY {}",
            pk_cols.iter().map(|c| quote_fn(c)).collect::<Vec<_>>().join(", ")
        )
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

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
            let rows = sqlx::query_as::<_, (String, String, Option<i64>)>(sql::PG_LIST_TABLES)
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
            let rows = sqlx::query_as::<_, (String, String, Option<i64>)>(sql::MYSQL_LIST_TABLES)
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
            let rows = sqlx::query_as::<_, (String, String)>(sql::SQLITE_LIST_TABLES)
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
            // Acquire one connection for all steps so describe() is available.
            let mut conn = pg.acquire().await.map_err(|e| e.to_string())?;

            // Schema: name, nullable, primary, has_default (no data_type — comes from describe).
            let col_rows = sqlx::query_as::<_, (String, String, bool, bool)>(sql::PG_COLUMN_INFO)
                .bind(&table)
                .fetch_all(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

            // describe() yields type names via type_info() — identical to EditorResultGrid.
            let desc_sql = format!("SELECT * FROM {}", pg_quote(&table));
            let type_names = pg_describe_types(&mut *conn, &desc_sql).await;

            let columns: Vec<ColumnInfo> = col_rows
                .into_iter()
                .enumerate()
                .map(|(i, (name, is_nullable, is_primary, has_default))| ColumnInfo {
                    data_type: type_names.get(i).cloned().unwrap_or_default(),
                    name,
                    is_nullable: is_nullable == "YES",
                    is_primary,
                    has_default,
                })
                .collect();

            let quoted = pg_quote(&table);
            let order_clause = build_pk_order_clause(&columns, pg_quote);
            let filter_clause = build_filter_clause(&filters, pg_quote, ParamStyle::Numbered);

            // COUNT: fast estimate when unfiltered, exact COUNT(*) when filtered.
            let total_results: i64 = if filter_clause.sql.is_empty() {
                sqlx::query_scalar::<_, i64>(sql::PG_ROW_ESTIMATE)
                    .bind(&table)
                    .fetch_optional(&mut *conn)
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
                    .fetch_one(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?
            };

            // Row query — Postgres requires typed i64 for LIMIT/OFFSET.
            let n = filter_clause.values.len();
            let row_sql = format!(
                "SELECT * FROM {} {} {} LIMIT ${} OFFSET ${}",
                quoted, filter_clause.sql, order_clause, n + 1, n + 2,
            );
            let mut row_args = sqlx::postgres::PgArguments::default();
            for v in filter_clause.values.into_iter() {
                row_args.add(v).map_err(|e| e.to_string())?;
            }
            row_args.add(limit).map_err(|e| e.to_string())?;
            row_args.add(offset).map_err(|e| e.to_string())?;
            let rows = pg_fetch_with(&mut *conn, &row_sql, row_args).await?;

            let total_pages = if limit > 0 { (total_results + limit - 1) / limit } else { 1 };
            Ok(QueryResult { columns, rows, total_results, total_pages })
        }
        DbPool::MySql(mysql) => {
            let mut conn = mysql.acquire().await.map_err(|e| e.to_string())?;

            // Schema: name, nullable, primary, has_default (no data_type — comes from describe).
            let col_rows =
                sqlx::query_as::<_, (String, String, i8, i8)>(sql::MYSQL_COLUMN_INFO)
                    .bind(&table)
                    .fetch_all(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

            if col_rows.is_empty() {
                return Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    total_results: 0,
                    total_pages: 1,
                });
            }

            // describe() yields type names via type_info() — identical to EditorResultGrid.
            let desc_sql = format!("SELECT * FROM {}", mysql_quote(&table));
            let type_names = mysql_describe_types(&mut *conn, &desc_sql).await;

            let columns: Vec<ColumnInfo> = col_rows
                .into_iter()
                .enumerate()
                .map(|(i, (name, is_nullable, is_primary, has_default))| ColumnInfo {
                    data_type: type_names.get(i).cloned().unwrap_or_default(),
                    name,
                    is_nullable: is_nullable == "YES",
                    is_primary: is_primary != 0,
                    has_default: has_default != 0,
                })
                .collect();

            let quoted = mysql_quote(&table);
            let order_clause = build_pk_order_clause(&columns, mysql_quote);
            let filter_clause =
                build_filter_clause(&filters, mysql_quote, ParamStyle::Positional);

            // COUNT: fast estimate when unfiltered, exact COUNT(*) when filtered.
            let total_results: i64 = if filter_clause.sql.is_empty() {
                sqlx::query_scalar::<_, Option<i64>>(sql::MYSQL_ROW_ESTIMATE)
                    .bind(&table)
                    .fetch_optional(&mut *conn)
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
                    .fetch_one(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?
            };

            // Row query — executor decodes all cells via decode_mysql.
            let row_sql = format!(
                "SELECT * FROM {} {} {} LIMIT ? OFFSET ?",
                quoted, filter_clause.sql, order_clause,
            );
            let mut params = filter_clause.values;
            params.push(limit.to_string());
            params.push(offset.to_string());
            let rows = mysql_fetch(&mut *conn, &row_sql, &params).await?;

            let total_pages = if limit > 0 { (total_results + limit - 1) / limit } else { 1 };
            Ok(QueryResult { columns, rows, total_results, total_pages })
        }
        DbPool::Sqlite(sqlite) => {
            let mut conn = sqlite.acquire().await.map_err(|e| e.to_string())?;

            // Schema: cid, name, type (ignored), notnull, dflt_value, pk.
            let col_rows = sqlx::query_as::<_, (i32, String, String, i32, Option<String>, i32)>(
                sql::SQLITE_COLUMN_INFO,
            )
            .bind(&table)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

            if col_rows.is_empty() {
                return Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    total_results: 0,
                    total_pages: 1,
                });
            }

            // describe() yields type names via type_info() — identical to EditorResultGrid.
            let desc_sql = format!("SELECT * FROM {}", pg_quote(&table));
            let type_names = sqlite_describe_types(&mut *conn, &desc_sql).await;

            let columns: Vec<ColumnInfo> = col_rows
                .into_iter()
                .enumerate()
                .map(|(i, (_, name, _, notnull, dflt_value, pk))| ColumnInfo {
                    data_type: type_names.get(i).cloned().unwrap_or_default(),
                    name,
                    is_nullable: notnull == 0,
                    is_primary: pk > 0,
                    has_default: dflt_value.is_some(),
                })
                .collect();

            let quoted = pg_quote(&table);
            let order_clause = build_pk_order_clause(&columns, pg_quote);
            let filter_clause = build_filter_clause(&filters, pg_quote, ParamStyle::Positional);

            // COUNT: SQLite has no catalog stats, always exact.
            let count_sql = format!("SELECT COUNT(*) FROM {} {}", quoted, filter_clause.sql);
            let mut count_args = sqlx::sqlite::SqliteArguments::default();
            for v in filter_clause.values.iter() {
                count_args.add(v.as_str()).map_err(|e| e.to_string())?;
            }
            let total_results: i64 =
                sqlx::query_scalar_with::<_, i64, _>(sqlx::AssertSqlSafe(count_sql), count_args)
                    .fetch_one(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

            // Row query — executor decodes all cells via decode_sqlite.
            let row_sql = format!(
                "SELECT * FROM {} {} {} LIMIT ? OFFSET ?",
                quoted, filter_clause.sql, order_clause,
            );
            let mut params = filter_clause.values;
            params.push(limit.to_string());
            params.push(offset.to_string());
            let rows = sqlite_fetch(&mut *conn, &row_sql, &params).await?;

            let total_pages = if limit > 0 { (total_results + limit - 1) / limit } else { 1 };
            Ok(QueryResult { columns, rows, total_results, total_pages })
        }
    }
}
