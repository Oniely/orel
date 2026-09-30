use std::collections::{HashMap, HashSet};

use futures_util::future::try_join_all;
use serde::{Deserialize, Serialize};

use crate::commands::connection::{AppState, DbPool};

use super::indexes::{fetch_indexes, TableIndex};
use super::sql_util::{fetch_column_info, mysql_quote, pg_quote, ColumnInfo, Dialect};

// ── Types ────────────────────────────────────────────────────────────────────

const SQLITE_READ_ONLY: &str =
    "SQLite can't change foreign keys without rebuilding the table. Use the DDL tab to recreate the table.";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReferentialAction {
    #[default]
    #[serde(rename = "NO ACTION")]
    NoAction,
    #[serde(rename = "RESTRICT")]
    Restrict,
    #[serde(rename = "CASCADE")]
    Cascade,
    #[serde(rename = "SET NULL")]
    SetNull,
    #[serde(rename = "SET DEFAULT")]
    SetDefault,
}

impl ReferentialAction {
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::NoAction => "NO ACTION",
            Self::Restrict => "RESTRICT",
            Self::Cascade => "CASCADE",
            Self::SetNull => "SET NULL",
            Self::SetDefault => "SET DEFAULT",
        }
    }

    /// Rule names as MySQL and SQLite report them ("CASCADE", "SET NULL", ...).
    fn from_rule(rule: &str) -> Self {
        match rule.to_ascii_uppercase().as_str() {
            "RESTRICT" => Self::Restrict,
            "CASCADE" => Self::Cascade,
            "SET NULL" => Self::SetNull,
            "SET DEFAULT" => Self::SetDefault,
            _ => Self::NoAction,
        }
    }

    /// Postgres `confupdtype` / `confdeltype` codes.
    fn from_pg_code(code: &str) -> Self {
        match code {
            "r" => Self::Restrict,
            "c" => Self::Cascade,
            "n" => Self::SetNull,
            "d" => Self::SetDefault,
            _ => Self::NoAction,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    /// None on SQLite, whose pragma doesn't expose constraint names.
    pub name: Option<String>,
    pub columns: Vec<String>,
    /// Set only when the referenced table lives outside `public` / the current database.
    pub referenced_schema: Option<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
    pub on_update: ReferentialAction,
    pub on_delete: ReferentialAction,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyAddPayload {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
    #[serde(default)]
    pub on_update: ReferentialAction,
    #[serde(default)]
    pub on_delete: ReferentialAction,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyChanges {
    #[serde(default)]
    pub drops: Vec<String>,
    #[serde(default)]
    pub adds: Vec<ForeignKeyAddPayload>,
}

/// Groups one-row-per-column results into foreign keys, preserving row order.
/// `starts_new` marks the first column of each key.
fn push_fk_column(
    fks: &mut Vec<ForeignKey>,
    starts_new: bool,
    fk: ForeignKey,
    column: String,
    referenced_column: String,
) {
    match fks.last_mut() {
        Some(last) if !starts_new => {
            last.columns.push(column);
            last.referenced_columns.push(referenced_column);
        }
        _ => fks.push(ForeignKey {
            columns: vec![column],
            referenced_columns: vec![referenced_column],
            ..fk
        }),
    }
}

// ── Fetch ────────────────────────────────────────────────────────────────────

pub(crate) async fn fetch_pg_foreign_keys(pool: &sqlx::PgPool, table: &str) -> Result<Vec<ForeignKey>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, i64)>(
        "SELECT \
            con.conname::text, \
            a.attname::text, \
            fn.nspname::text, \
            ft.relname::text, \
            fa.attname::text, \
            con.confupdtype::text, \
            con.confdeltype::text, \
            k.ord \
         FROM pg_catalog.pg_constraint con \
         JOIN pg_catalog.pg_class t ON t.oid = con.conrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_catalog.pg_class ft ON ft.oid = con.confrelid \
         JOIN pg_catalog.pg_namespace fn ON fn.oid = ft.relnamespace \
         CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord) \
         JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum \
         JOIN pg_catalog.pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = k.fattnum \
         WHERE con.contype = 'f' \
            AND t.relname = $1 \
            AND n.nspname = 'public' \
         ORDER BY con.conname, k.ord",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut fks = Vec::new();
    for (name, column, ref_schema, ref_table, ref_column, on_update, on_delete, ord) in rows {
        push_fk_column(
            &mut fks,
            ord == 1,
            ForeignKey {
                name: Some(name),
                referenced_schema: (ref_schema != "public").then_some(ref_schema),
                referenced_table: ref_table,
                on_update: ReferentialAction::from_pg_code(&on_update),
                on_delete: ReferentialAction::from_pg_code(&on_delete),
                ..Default::default()
            },
            column,
            ref_column,
        );
    }
    Ok(fks)
}

pub(crate) async fn fetch_mysql_foreign_keys(
    pool: &sqlx::MySqlPool,
    table: &str,
) -> Result<Vec<ForeignKey>, String> {
    let rows = sqlx::query_as::<_, (String, String, Option<String>, String, String, String, String, i64)>(
        "SELECT \
            CAST(k.CONSTRAINT_NAME AS CHAR), \
            CAST(k.COLUMN_NAME AS CHAR), \
            IF(k.REFERENCED_TABLE_SCHEMA = DATABASE(), NULL, CAST(k.REFERENCED_TABLE_SCHEMA AS CHAR)), \
            CAST(k.REFERENCED_TABLE_NAME AS CHAR), \
            CAST(k.REFERENCED_COLUMN_NAME AS CHAR), \
            CAST(r.UPDATE_RULE AS CHAR), \
            CAST(r.DELETE_RULE AS CHAR), \
            CAST(k.ORDINAL_POSITION AS SIGNED) \
         FROM information_schema.KEY_COLUMN_USAGE k \
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r \
            ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA \
            AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME \
            AND r.TABLE_NAME = k.TABLE_NAME \
         WHERE k.TABLE_SCHEMA = DATABASE() \
            AND k.TABLE_NAME = ? \
            AND k.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut fks = Vec::new();
    for (name, column, ref_schema, ref_table, ref_column, on_update, on_delete, ord) in rows {
        push_fk_column(
            &mut fks,
            ord == 1,
            ForeignKey {
                name: Some(name),
                referenced_schema: ref_schema,
                referenced_table: ref_table,
                on_update: ReferentialAction::from_rule(&on_update),
                on_delete: ReferentialAction::from_rule(&on_delete),
                ..Default::default()
            },
            column,
            ref_column,
        );
    }
    Ok(fks)
}

pub(crate) async fn fetch_sqlite_foreign_keys(
    pool: &sqlx::SqlitePool,
    table: &str,
) -> Result<Vec<ForeignKey>, String> {
    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, String, String)>(
        "SELECT seq, \"table\", \"from\", \"to\", on_update, on_delete \
         FROM pragma_foreign_key_list(?1) \
         ORDER BY id, seq",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // A NULL "to" means the key references the parent's primary key; fetch
    // every such parent's primary key columns in one query
    let mut parent_pks: HashMap<String, Vec<String>> = HashMap::new();
    if rows.iter().any(|(_, _, _, to, _, _)| to.is_none()) {
        let pk_rows = sqlx::query_as::<_, (String, String)>(
            "SELECT p.tbl, i.name \
             FROM (SELECT DISTINCT \"table\" AS tbl FROM pragma_foreign_key_list(?1) WHERE \"to\" IS NULL) p \
             JOIN pragma_table_info(p.tbl) i \
             WHERE i.pk > 0 \
             ORDER BY p.tbl, i.pk",
        )
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
        for (tbl, column) in pk_rows {
            parent_pks.entry(tbl).or_default().push(column);
        }
    }

    let mut fks = Vec::new();
    for (seq, ref_table, column, ref_column, on_update, on_delete) in rows {
        let ref_column = ref_column.unwrap_or_else(|| {
            parent_pks
                .get(&ref_table)
                .and_then(|pk| pk.get(usize::try_from(seq).ok()?))
                .cloned()
                .unwrap_or_default()
        });
        push_fk_column(
            &mut fks,
            seq == 0,
            ForeignKey {
                referenced_table: ref_table,
                on_update: ReferentialAction::from_rule(&on_update),
                on_delete: ReferentialAction::from_rule(&on_delete),
                ..Default::default()
            },
            column,
            ref_column,
        );
    }
    Ok(fks)
}

async fn fetch_foreign_keys(pool: &DbPool, table: &str) -> Result<Vec<ForeignKey>, String> {
    match pool {
        DbPool::Postgres(pg) => fetch_pg_foreign_keys(pg, table).await,
        DbPool::MySql(mysql) => fetch_mysql_foreign_keys(mysql, table).await,
        DbPool::Sqlite(sqlite) => fetch_sqlite_foreign_keys(sqlite, table).await,
    }
}

#[tauri::command]
pub async fn fetch_table_foreign_keys(
    connection_id: String,
    table: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ForeignKey>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    fetch_foreign_keys(&pool, &table).await
}

// ── Apply (DROP / ADD CONSTRAINT) ────────────────────────────────────────────

fn stale_column_error(column: &str, table: &str) -> String {
    format!("Column \"{column}\" no longer exists on \"{table}\". Refresh the structure and try again.")
}

/// Checks the changes against the live tables so a stale UI gets a clear error
/// instead of a half-understood database one. `referenced` maps each referenced
/// table to its columns (empty when the table doesn't exist); `indexes` are the
/// table's indexes, only needed for MySQL adds.
fn validate_fk_changes(
    dialect: Dialect,
    table: &str,
    current: &[ForeignKey],
    local: &[ColumnInfo],
    referenced: &HashMap<String, Vec<ColumnInfo>>,
    indexes: &[TableIndex],
    changes: &ForeignKeyChanges,
) -> Result<(), String> {
    if dialect == Dialect::Sqlite && (!changes.drops.is_empty() || !changes.adds.is_empty()) {
        return Err(SQLITE_READ_ONLY.to_string());
    }

    for drop in &changes.drops {
        if !current.iter().any(|f| f.name.as_deref() == Some(drop.as_str())) {
            return Err(format!("Foreign key \"{drop}\" no longer exists. Refresh the structure and try again."));
        }
    }

    // Names compare case-insensitively: MySQL constraint names are case-insensitive
    let mut taken: HashSet<String> = current
        .iter()
        .filter_map(|f| f.name.as_deref())
        .filter(|n| !changes.drops.iter().any(|d| d == n))
        .map(str::to_lowercase)
        .collect();

    for add in &changes.adds {
        let name = add.name.trim();
        if name.is_empty() {
            return Err("Every new foreign key needs a name.".to_string());
        }
        if !taken.insert(name.to_lowercase()) {
            return Err(format!("A foreign key named \"{name}\" already exists."));
        }
        if dialect == Dialect::MySql {
            validate_mysql_fk_name(name, add, indexes, changes)?;
        }
        if add.columns.is_empty() {
            return Err(format!("Foreign key \"{name}\" needs at least one column."));
        }
        if add.columns.len() != add.referenced_columns.len() {
            return Err(format!(
                "Foreign key \"{name}\" must reference as many columns as it uses."
            ));
        }
        if dialect == Dialect::MySql
            && (add.on_update == ReferentialAction::SetDefault || add.on_delete == ReferentialAction::SetDefault)
        {
            return Err("MySQL doesn't support SET DEFAULT on foreign keys.".to_string());
        }

        let uses_set_null =
            add.on_update == ReferentialAction::SetNull || add.on_delete == ReferentialAction::SetNull;
        let mut seen = HashSet::new();
        for col in &add.columns {
            let info = local
                .iter()
                .find(|c| &c.name == col)
                .ok_or_else(|| stale_column_error(col, table))?;
            if !seen.insert(col.as_str()) {
                return Err(format!("Foreign key \"{name}\" lists column \"{col}\" more than once."));
            }
            if uses_set_null && !info.is_nullable {
                return Err(format!(
                    "Column \"{col}\" is NOT NULL, so foreign key \"{name}\" can't use SET NULL."
                ));
            }
        }

        let ref_table = add.referenced_table.as_str();
        if ref_table.trim().is_empty() {
            return Err(format!("Foreign key \"{name}\" needs a referenced table."));
        }
        let ref_cols = referenced
            .get(ref_table)
            .filter(|cols| !cols.is_empty())
            .ok_or_else(|| format!("Table \"{ref_table}\" no longer exists. Refresh the structure and try again."))?;
        for ref_col in &add.referenced_columns {
            if !ref_cols.iter().any(|c| &c.name == ref_col) {
                return Err(stale_column_error(ref_col, ref_table));
            }
        }
    }
    Ok(())
}

/// MySQL-only naming limits, found against MySQL 8: a name dropped in this save
/// can't be re-added in the same ALTER TABLE (error 1826), and a new foreign key
/// gets an index named after it unless one already covers its columns, so its
/// name can't match an existing index (error 1061).
fn validate_mysql_fk_name(
    name: &str,
    add: &ForeignKeyAddPayload,
    indexes: &[TableIndex],
    changes: &ForeignKeyChanges,
) -> Result<(), String> {
    if changes.drops.iter().any(|d| d.eq_ignore_ascii_case(name)) {
        return Err(format!(
            "MySQL can't reuse the name \"{name}\" in the same save that drops it. Pick another name, or save the drop first."
        ));
    }
    let covered = indexes.iter().any(|i| {
        i.columns.len() >= add.columns.len() && i.columns.iter().zip(&add.columns).all(|(c, a)| &c.name == a)
    });
    if !covered && indexes.iter().any(|i| i.name.eq_ignore_ascii_case(name)) {
        return Err(format!(
            "An index named \"{name}\" already exists, and MySQL names a foreign key's index after the foreign key. Pick another name."
        ));
    }
    Ok(())
}

fn quoted_list(names: &[String], dialect: Dialect) -> String {
    names.iter().map(|n| dialect.quote(n)).collect::<Vec<_>>().join(", ")
}

/// `CONSTRAINT name FOREIGN KEY (...) REFERENCES t (...) ON UPDATE ... ON DELETE ...`
fn constraint_definition(add: &ForeignKeyAddPayload, dialect: Dialect) -> String {
    format!(
        "CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON UPDATE {} ON DELETE {}",
        dialect.quote(add.name.trim()),
        quoted_list(&add.columns, dialect),
        dialect.quote(&add.referenced_table),
        quoted_list(&add.referenced_columns, dialect),
        add.on_update.as_sql(),
        add.on_delete.as_sql(),
    )
}

/// Postgres: drops first so a dropped name can be reused; run in one transaction.
fn generate_pg_fk_sql(table: &str, changes: &ForeignKeyChanges) -> Vec<String> {
    let qt = pg_quote(table);
    let mut stmts: Vec<String> = changes
        .drops
        .iter()
        .map(|name| format!("ALTER TABLE {qt} DROP CONSTRAINT {};", pg_quote(name)))
        .collect();

    stmts.extend(
        changes
            .adds
            .iter()
            .map(|add| format!("ALTER TABLE {qt} ADD {};", constraint_definition(add, Dialect::Postgres))),
    );
    stmts
}

/// MySQL: one ALTER TABLE so the save is all-or-nothing (DDL auto-commits).
fn generate_mysql_fk_sql(table: &str, changes: &ForeignKeyChanges) -> Vec<String> {
    let mut clauses: Vec<String> = changes
        .drops
        .iter()
        .map(|name| format!("DROP FOREIGN KEY {}", mysql_quote(name)))
        .collect();

    clauses.extend(
        changes
            .adds
            .iter()
            .map(|add| format!("ADD {}", constraint_definition(add, Dialect::MySql))),
    );

    if clauses.is_empty() {
        return vec![];
    }
    vec![format!("ALTER TABLE {} {};", mysql_quote(table), clauses.join(", "))]
}

/// Validates the changes against the live tables and applies them. This is
/// `apply_foreign_key_changes` minus the pool lookup, so tests can drive it.
pub(crate) async fn apply_changes(
    pool: &DbPool,
    table: &str,
    changes: &ForeignKeyChanges,
) -> Result<Vec<String>, String> {
    if changes.drops.is_empty() && changes.adds.is_empty() {
        return Ok(vec![]);
    }

    let dialect = pool.dialect();
    let has_adds = !changes.adds.is_empty();

    // Column lists (and MySQL's indexes) are only needed to validate new foreign keys
    let ref_tables: Vec<&str> = changes
        .adds
        .iter()
        .map(|a| a.referenced_table.as_str())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let (current, local, ref_columns, indexes) = tokio::try_join!(
        fetch_foreign_keys(pool, table),
        async {
            if has_adds {
                fetch_column_info(pool, table).await
            } else {
                Ok(vec![])
            }
        },
        try_join_all(ref_tables.iter().map(|t| fetch_column_info(pool, t))),
        async {
            if has_adds && dialect == Dialect::MySql {
                fetch_indexes(pool, table).await
            } else {
                Ok(vec![])
            }
        },
    )?;
    let referenced: HashMap<String, Vec<ColumnInfo>> = ref_tables
        .into_iter()
        .map(str::to_string)
        .zip(ref_columns)
        .collect();

    validate_fk_changes(dialect, table, &current, &local, &referenced, &indexes, changes)?;

    let stmts = match dialect {
        Dialect::MySql => generate_mysql_fk_sql(table, changes),
        Dialect::Postgres | Dialect::Sqlite => generate_pg_fk_sql(table, changes),
    };

    pool.execute_in_transaction(&stmts)
        .await
        .map_err(|e| e.to_string())?;

    Ok(stmts)
}

#[tauri::command]
pub async fn apply_foreign_key_changes(
    connection_id: String,
    table: String,
    changes: ForeignKeyChanges,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    apply_changes(&pool, &table, &changes).await
}

#[cfg(test)]
#[path = "test/foreign_keys.test.rs"]
mod tests;
