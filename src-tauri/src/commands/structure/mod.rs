use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::commands::connection::{AppState, DbPool};

use super::indexes::fetch_sqlite_indexes;

pub(crate) mod mysql;
pub(crate) mod postgres;
pub(crate) mod sqlite;

use mysql::*;
use postgres::*;
use sqlite::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDdl {
    pub ddl: String,
    pub dialect: String,
    pub source: String,
}

pub(super) fn ensure_semicolon(sql: String) -> String {
    let trimmed = sql.trim();
    if trimmed.ends_with(';') {
        trimmed.to_string()
    } else {
        format!("{trimmed};")
    }
}

#[tauri::command]
pub async fn fetch_table_ddl(
    connection_id: String,
    table: String,
    state: tauri::State<'_, AppState>,
) -> Result<TableDdl, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    match pool {
        DbPool::Postgres(pg) => fetch_postgres_ddl(pg, &table).await,
        DbPool::MySql(mysql) => fetch_mysql_ddl(mysql, &table).await,
        DbPool::Sqlite(sqlite) => fetch_sqlite_ddl(sqlite, &table).await,
    }
}

// ── Table Structure (Columns tab) ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureColumn {
    pub name: String,
    pub data_type: String,
    pub type_params: Option<String>,
    pub is_nullable: bool,
    pub is_primary: bool,
    pub is_foreign_key: bool,
    pub is_indexed: bool,
    pub default_value: Option<String>,
    /// Backend-only: attributes MySQL's MODIFY/CHANGE must restate.
    #[serde(skip)]
    pub mysql: Option<MySqlColumnMeta>,
}

/// Column attributes that MySQL's MODIFY/CHANGE COLUMN reset unless restated.
#[derive(Debug, Clone, Default)]
pub struct MySqlColumnMeta {
    /// Full COLUMN_TYPE, e.g. `int(10) unsigned zerofill` or `enum('a','b')`.
    pub column_type: String,
    pub extra: String,
    pub comment: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub generation_expr: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    pub columns: Vec<StructureColumn>,
    pub dialect: String,
}

pub(super) fn extract_type_params(full_type: &str) -> Option<String> {
    let open = full_type.find('(')?;
    let close = full_type.rfind(')')?;
    if close > open + 1 {
        Some(full_type[open + 1..close].trim().to_string())
    } else {
        None
    }
}

pub(super) fn type_with_params(base_type: &str, params: Option<&str>) -> String {
    match params {
        Some(p) if !p.is_empty() => format!("{}({})", base_type, p),
        _ => base_type.to_string(),
    }
}

#[tauri::command]
pub async fn fetch_table_structure(
    connection_id: String,
    table: String,
    state: tauri::State<'_, AppState>,
) -> Result<TableStructure, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    match &pool {
        DbPool::Postgres(pg) => fetch_pg_structure(pg, &table).await,
        DbPool::MySql(mysql) => fetch_mysql_structure(mysql, &table).await,
        DbPool::Sqlite(sqlite) => fetch_sqlite_structure(sqlite, &table).await,
    }
}

// ── Structure changes (ALTER TABLE) ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnEditPayload {
    pub original_name: String,
    pub name: String,
    pub data_type: String,
    pub type_params: Option<String>,
    pub nullable: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnAddPayload {
    pub name: String,
    pub data_type: String,
    pub type_params: Option<String>,
    pub nullable: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureChanges {
    pub edits: Vec<ColumnEditPayload>,
    pub drops: Vec<String>,
    pub adds: Vec<ColumnAddPayload>,
    pub reorder: Option<Vec<String>>,
}

pub(super) fn col_map(current: &[StructureColumn]) -> HashMap<&str, &StructureColumn> {
    current.iter().map(|c| (c.name.as_str(), c)).collect()
}

/// Pairs each edit with its current column, skipping columns that are also
/// being dropped. An edit for a column that no longer exists means the UI is
/// out of date, so it's an error rather than a silent no-op.
pub(super) fn resolve_edits<'a>(
    cols: &HashMap<&str, &'a StructureColumn>,
    changes: &'a StructureChanges,
) -> Result<Vec<(&'a StructureColumn, &'a ColumnEditPayload)>, String> {
    changes
        .edits
        .iter()
        .filter(|edit| !changes.drops.contains(&edit.original_name))
        .map(|edit| {
            cols.get(edit.original_name.as_str())
                .map(|&col| (col, edit))
                .ok_or_else(|| stale_column_error(&edit.original_name))
        })
        .collect()
}

pub(super) fn stale_column_error(name: &str) -> String {
    format!("Column \"{name}\" no longer exists. Refresh the structure and try again.")
}

pub(super) fn add_column_def(quoted_name: String, full_type: String, add: &ColumnAddPayload) -> String {
    let mut def = format!("{quoted_name} {full_type}");
    if !add.nullable {
        def.push_str(" NOT NULL");
    }
    if let Some(d) = add.default_value.as_deref().filter(|d| !d.is_empty()) {
        def.push_str(" DEFAULT ");
        def.push_str(d);
    }
    def
}

#[tauri::command]
pub async fn apply_structure_changes(
    connection_id: String,
    table: String,
    changes: StructureChanges,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    // Fetch current structure to compute diffs
    let current = match &pool {
        DbPool::Postgres(pg) => fetch_pg_structure(pg, &table).await?,
        DbPool::MySql(mysql) => fetch_mysql_structure(mysql, &table).await?,
        DbPool::Sqlite(sqlite) => fetch_sqlite_structure(sqlite, &table).await?,
    };

    let stmts = match &pool {
        DbPool::Postgres(_) => generate_pg_alter(&table, &current.columns, &changes),
        DbPool::MySql(_) => generate_mysql_alter(&table, &current.columns, &changes),
        DbPool::Sqlite(sqlite) => {
            // Only needed to drop indexes covering dropped columns
            let indexes = if changes.drops.is_empty() {
                vec![]
            } else {
                fetch_sqlite_indexes(sqlite, &table).await?
            };
            generate_sqlite_alter(&table, &current.columns, &indexes, &changes)
        }
    }?;

    if stmts.is_empty() {
        return Ok(stmts);
    }

    pool.execute_in_transaction(&stmts)
        .await
        .map_err(|e| e.to_string())?;

    Ok(stmts)
}


#[cfg(test)]
#[path = "../test/structure.test.rs"]
mod tests;
