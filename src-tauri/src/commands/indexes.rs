use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::commands::connection::{AppState, DbPool};

use super::sql_util::{fetch_column_info, mysql_quote, pg_quote, Dialect};

// ── Types ────────────────────────────────────────────────────────────────────

/// Display name for expression / functional key parts that have no column.
const EXPRESSION_PLACEHOLDER: &str = "(expression)";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumn {
    /// Column name, or the expression text for expression/functional indexes.
    pub name: String,
    pub descending: bool,
    pub is_expression: bool,
    /// MySQL prefix length (`SUB_PART`), e.g. `email(10)`.
    pub prefix_length: Option<u32>,
}

impl IndexColumn {
    pub fn plain(name: impl Into<String>) -> Self {
        Self { name: name.into(), ..Default::default() }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndex {
    pub name: String,
    pub columns: Vec<IndexColumn>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub method: Option<String>,
    /// False for primary keys and SQLite autoindexes (backing UNIQUE/PK column constraints).
    pub droppable: bool,
    /// Backend-only: Postgres index owned by a UNIQUE/EXCLUDE constraint, which
    /// must be dropped with DROP CONSTRAINT rather than DROP INDEX.
    #[serde(skip)]
    pub is_constraint: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumnPayload {
    pub name: String,
    #[serde(default)]
    pub descending: bool,
    #[serde(default)]
    pub prefix_length: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexAddPayload {
    pub name: String,
    pub unique: bool,
    pub columns: Vec<IndexColumnPayload>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexChanges {
    #[serde(default)]
    pub drops: Vec<String>,
    #[serde(default)]
    pub adds: Vec<IndexAddPayload>,
}

/// Groups one-row-per-index-column results into indexes, preserving row order.
fn push_index_column(indexes: &mut Vec<TableIndex>, index: TableIndex, column: IndexColumn) {
    match indexes.last_mut() {
        Some(last) if last.name == index.name => last.columns.push(column),
        _ => indexes.push(TableIndex { columns: vec![column], ..index }),
    }
}

// ── Fetch ────────────────────────────────────────────────────────────────────

pub(crate) async fn fetch_pg_indexes(pool: &sqlx::PgPool, table: &str) -> Result<Vec<TableIndex>, String> {
    let rows = sqlx::query_as::<_, (String, bool, bool, String, bool, i32, String, bool)>(
        "SELECT \
            ic.relname::text, \
            ix.indisunique, \
            ix.indisprimary, \
            am.amname::text, \
            EXISTS( \
                SELECT 1 FROM pg_catalog.pg_constraint con \
                WHERE con.conindid = ix.indexrelid \
                    AND con.conrelid = ix.indrelid \
                    AND con.contype IN ('u', 'x') \
            ), \
            k.attnum::int4, \
            COALESCE(a.attname::text, pg_catalog.pg_get_indexdef(ix.indexrelid, k.ord::int4, true)), \
            (k.opt::int4 & 1) = 1 \
         FROM pg_catalog.pg_index ix \
         JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_catalog.pg_class ic ON ic.oid = ix.indexrelid \
         JOIN pg_catalog.pg_am am ON am.oid = ic.relam \
         CROSS JOIN LATERAL unnest(ix.indkey::int2[], ix.indoption::int2[]) WITH ORDINALITY AS k(attnum, opt, ord) \
         LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND k.attnum > 0 \
         WHERE t.relname = $1 \
            AND n.nspname = 'public' \
            AND k.ord <= ix.indnkeyatts \
         ORDER BY ix.indisprimary DESC, ic.relname, k.ord",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut indexes = Vec::new();
    for (name, is_unique, is_primary, method, is_constraint, attnum, column, descending) in rows {
        push_index_column(
            &mut indexes,
            TableIndex {
                name,
                is_unique,
                is_primary,
                method: Some(method),
                droppable: !is_primary,
                is_constraint,
                ..Default::default()
            },
            IndexColumn { name: column, descending, is_expression: attnum == 0, prefix_length: None },
        );
    }
    Ok(indexes)
}

pub(crate) async fn fetch_mysql_indexes(pool: &sqlx::MySqlPool, table: &str) -> Result<Vec<TableIndex>, String> {
    let rows = sqlx::query_as::<_, (String, i64, Option<String>, Option<i64>, String, Option<String>)>(
        "SELECT \
            CAST(INDEX_NAME AS CHAR), \
            CAST(NON_UNIQUE AS SIGNED), \
            CAST(COLUMN_NAME AS CHAR), \
            CAST(SUB_PART AS SIGNED), \
            CAST(INDEX_TYPE AS CHAR), \
            CAST(COLLATION AS CHAR) \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? \
         ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut indexes = Vec::new();
    for (name, non_unique, column, sub_part, index_type, collation) in rows {
        let is_primary = name == "PRIMARY";
        push_index_column(
            &mut indexes,
            TableIndex {
                name,
                is_unique: non_unique == 0,
                is_primary,
                method: Some(index_type),
                droppable: !is_primary,
                ..Default::default()
            },
            IndexColumn {
                // Functional key parts (MySQL 8.0.13+) have no COLUMN_NAME
                is_expression: column.is_none(),
                name: column.unwrap_or_else(|| EXPRESSION_PLACEHOLDER.to_string()),
                descending: collation.as_deref() == Some("D"),
                prefix_length: sub_part.and_then(|p| u32::try_from(p).ok()),
            },
        );
    }
    Ok(indexes)
}

pub(crate) async fn fetch_sqlite_indexes(
    pool: &sqlx::SqlitePool,
    table: &str,
) -> Result<Vec<TableIndex>, String> {
    let rows = sqlx::query_as::<_, (String, i64, String, i64, Option<String>, i64)>(
        "SELECT il.name, il.\"unique\", il.origin, x.cid, x.name, x.\"desc\" \
         FROM pragma_index_list(?1) il \
         JOIN pragma_index_xinfo(il.name) x \
         WHERE x.key = 1 \
         ORDER BY il.origin = 'pk' DESC, il.name, x.seqno",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut indexes = Vec::new();
    for (name, unique, origin, cid, column, desc) in rows {
        push_index_column(
            &mut indexes,
            TableIndex {
                name,
                is_unique: unique != 0,
                is_primary: origin == "pk",
                // "pk"/"u" indexes come from column constraints and can't be dropped
                droppable: origin == "c",
                ..Default::default()
            },
            IndexColumn {
                // cid -2 marks an expression key part
                is_expression: cid == -2,
                name: column.unwrap_or_else(|| EXPRESSION_PLACEHOLDER.to_string()),
                descending: desc != 0,
                prefix_length: None,
            },
        );
    }

    // A rowid-alias PRIMARY KEY (`id INTEGER PRIMARY KEY`) has no index entry
    if !indexes.iter().any(|i| i.is_primary) {
        let pk_cols = sqlx::query_scalar::<_, String>(
            "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
        )
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
        if !pk_cols.is_empty() {
            indexes.insert(
                0,
                TableIndex {
                    name: "PRIMARY KEY".to_string(),
                    columns: pk_cols.into_iter().map(IndexColumn::plain).collect(),
                    is_unique: true,
                    is_primary: true,
                    ..Default::default()
                },
            );
        }
    }

    Ok(indexes)
}

async fn fetch_indexes(pool: &DbPool, table: &str) -> Result<Vec<TableIndex>, String> {
    match pool {
        DbPool::Postgres(pg) => fetch_pg_indexes(pg, table).await,
        DbPool::MySql(mysql) => fetch_mysql_indexes(mysql, table).await,
        DbPool::Sqlite(sqlite) => fetch_sqlite_indexes(sqlite, table).await,
    }
}

#[tauri::command]
pub async fn fetch_table_indexes(
    connection_id: String,
    table: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TableIndex>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    fetch_indexes(&pool, &table).await
}

// ── Apply (DROP / CREATE INDEX) ──────────────────────────────────────────────

/// Checks the changes against the live table so a stale UI gets a clear error
/// instead of a half-understood database one.
fn validate_index_changes(
    current: &[TableIndex],
    columns: &[String],
    changes: &IndexChanges,
) -> Result<(), String> {
    for drop in &changes.drops {
        let index = current
            .iter()
            .find(|i| &i.name == drop)
            .ok_or_else(|| format!("Index \"{drop}\" no longer exists. Refresh the structure and try again."))?;
        if index.is_primary {
            return Err("The primary key can't be dropped from the Indexes tab.".to_string());
        }
        if !index.droppable {
            return Err(format!(
                "Index \"{drop}\" belongs to a column constraint and can't be dropped on its own."
            ));
        }
    }

    // Names compare case-insensitively: MySQL index names are case-insensitive
    let mut taken: HashSet<String> = current
        .iter()
        .filter(|i| !changes.drops.contains(&i.name))
        .map(|i| i.name.to_lowercase())
        .collect();

    for add in &changes.adds {
        let name = add.name.trim();
        if name.is_empty() {
            return Err("Every new index needs a name.".to_string());
        }
        if !taken.insert(name.to_lowercase()) {
            return Err(format!("An index named \"{name}\" already exists."));
        }
        if add.columns.is_empty() {
            return Err(format!("Index \"{name}\" needs at least one column."));
        }
        let mut seen = HashSet::new();
        for col in &add.columns {
            if !columns.contains(&col.name) {
                return Err(format!(
                    "Column \"{}\" no longer exists. Refresh the structure and try again.",
                    col.name
                ));
            }
            if !seen.insert(col.name.as_str()) {
                return Err(format!("Index \"{name}\" lists column \"{}\" more than once.", col.name));
            }
        }
    }
    Ok(())
}

fn index_column_list(columns: &[IndexColumnPayload], dialect: Dialect) -> String {
    columns
        .iter()
        .map(|c| {
            let mut part = dialect.quote(&c.name);
            // Prefix lengths are MySQL-only
            if let (Dialect::MySql, Some(len)) = (dialect, c.prefix_length) {
                part.push_str(&format!("({len})"));
            }
            if c.descending {
                part.push_str(" DESC");
            }
            part
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn unique_keyword(unique: bool) -> &'static str {
    if unique { "UNIQUE " } else { "" }
}

/// Postgres and SQLite: drops first so a dropped name can be reused.
fn generate_standard_index_sql(table: &str, current: &[TableIndex], changes: &IndexChanges) -> Vec<String> {
    let qt = pg_quote(table);
    let mut stmts: Vec<String> = changes
        .drops
        .iter()
        .map(|name| {
            let is_constraint = current.iter().any(|i| &i.name == name && i.is_constraint);
            if is_constraint {
                format!("ALTER TABLE {qt} DROP CONSTRAINT {};", pg_quote(name))
            } else {
                format!("DROP INDEX {};", pg_quote(name))
            }
        })
        .collect();

    stmts.extend(changes.adds.iter().map(|add| {
        format!(
            "CREATE {}INDEX {} ON {qt} ({});",
            unique_keyword(add.unique),
            pg_quote(add.name.trim()),
            index_column_list(&add.columns, Dialect::Postgres)
        )
    }));
    stmts
}

/// MySQL: one ALTER TABLE so the save is all-or-nothing (DDL auto-commits).
fn generate_mysql_index_sql(table: &str, changes: &IndexChanges) -> Vec<String> {
    let mut clauses: Vec<String> = changes
        .drops
        .iter()
        .map(|name| format!("DROP INDEX {}", mysql_quote(name)))
        .collect();

    clauses.extend(changes.adds.iter().map(|add| {
        format!(
            "ADD {}INDEX {} ({})",
            unique_keyword(add.unique),
            mysql_quote(add.name.trim()),
            index_column_list(&add.columns, Dialect::MySql)
        )
    }));

    if clauses.is_empty() {
        return vec![];
    }
    vec![format!("ALTER TABLE {} {};", mysql_quote(table), clauses.join(", "))]
}

#[tauri::command]
pub async fn apply_index_changes(
    connection_id: String,
    table: String,
    changes: IndexChanges,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    // Column names are only needed to validate new indexes
    let (current, columns) = if changes.adds.is_empty() {
        (fetch_indexes(&pool, &table).await?, vec![])
    } else {
        let (current, info) =
            tokio::try_join!(fetch_indexes(&pool, &table), fetch_column_info(&pool, &table))?;
        (current, info.into_iter().map(|c| c.name).collect())
    };

    validate_index_changes(&current, &columns, &changes)?;

    let stmts = match pool.dialect() {
        Dialect::MySql => generate_mysql_index_sql(&table, &changes),
        Dialect::Postgres | Dialect::Sqlite => generate_standard_index_sql(&table, &current, &changes),
    };

    if stmts.is_empty() {
        return Ok(stmts);
    }

    pool.execute_in_transaction(&stmts)
        .await
        .map_err(|e| e.to_string())?;

    Ok(stmts)
}

#[cfg(test)]
#[path = "test/indexes.test.rs"]
mod tests;
