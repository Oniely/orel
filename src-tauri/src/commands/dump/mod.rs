// Full-database SQL dump: export to a plain .sql file and import one back.

use std::collections::{HashMap, HashSet};

use futures_util::TryStreamExt;
use serde::Serialize;
use tokio::io::{AsyncWrite, AsyncWriteExt, BufWriter};

use crate::commands::connection::{AppState, DbPool};

use super::foreign_keys::{
    fetch_foreign_keys, generate_mysql_fk_sql, generate_pg_fk_sql, ForeignKey,
    ForeignKeyAddPayload, ForeignKeyChanges,
};
use super::query::fetch_tables;
use super::sql_split::split_sql_statements;
use super::sql_util::Dialect;
use super::structure::ensure_semicolon;

mod mysql;
mod postgres;
mod sqlite;

/// Rows per INSERT statement, small enough to stay well under MySQL's max_allowed_packet.
const ROWS_PER_INSERT: usize = 100;
const SNIPPET_CHARS: usize = 200;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub tables_exported: u32,
    pub views_exported: u32,
    pub rows_exported: u64,
    pub file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub statements_executed: u32,
    pub statements_failed: u32,
    pub tables_affected: u32,
    pub errors: Vec<ImportError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub message: String,
    /// 1-indexed line of the failing statement; None when no statement ran.
    pub line: Option<usize>,
    pub snippet: Option<String>,
    /// Plain-language hint when the dump looks like it's for another database.
    pub hint: Option<String>,
}

/// One base table, as each dialect module describes it for the export.
struct TableDump {
    /// CREATE TABLE, then any CREATE INDEX statements.
    schema: Vec<String>,
    /// `INSERT INTO t (cols) VALUES`; row tuples are appended.
    insert_prefix: String,
    /// SELECT returning each row as one `v1, v2, ...` string of SQL literals.
    rows_sql: String,
    /// Run once all data is loaded (Postgres sequence resets).
    after_data: Vec<String>,
}

// ── Export ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_database_dump(
    connection_id: String,
    database: Option<String>,
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<ExportSummary, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    // The pool is bound to one database; refuse to dump a different one than asked for
    let current = match &pool {
        DbPool::Postgres(pg) => Some(postgres::current_database(pg).await?),
        DbPool::MySql(mysql) => Some(mysql::current_database(mysql).await?),
        DbPool::Sqlite(_) => None,
    };
    if let (Some(wanted), Some(current)) = (database, current) {
        if wanted != current {
            return Err(format!(
                "The connection is using database \"{current}\", not \"{wanted}\". Switch to \"{wanted}\" before exporting."
            ));
        }
    }

    export_dump(&pool, &file_path).await
}

/// Writes CREATE TYPE statements for Postgres enums, then CREATE TABLE
/// statements, then the data, then (Postgres / MySQL) every foreign key as
/// ALTER TABLE, then views. Deferring foreign keys means table order never
/// matters and circular references just work. SQLite can't add a foreign
/// key after CREATE TABLE, so there tables are ordered parents first
/// instead, and a cycle fails the export before the file is created.
/// Triggers, routines, and non-enum Postgres types/extensions are not
/// exported.
pub(crate) async fn export_dump(pool: &DbPool, file_path: &str) -> Result<ExportSummary, String> {
    let dialect = pool.dialect();
    let (tables, views): (Vec<_>, Vec<_>) = fetch_tables(pool)
        .await?
        .into_iter()
        .partition(|t| t.table_type == "table");
    let tables: Vec<String> = tables.into_iter().map(|t| t.name).collect();

    let type_statements = match pool {
        DbPool::Postgres(pg) => postgres::enum_type_statements(pg).await?,
        DbPool::MySql(_) | DbPool::Sqlite(_) => vec![],
    };

    let mut foreign_keys = Vec::with_capacity(tables.len());
    let mut dumps = Vec::with_capacity(tables.len());
    for table in &tables {
        foreign_keys.push(fetch_foreign_keys(pool, table).await?);
        dumps.push(table_dump(pool, table).await?);
    }

    let (order, fk_statements) = if dialect == Dialect::Sqlite {
        (creation_order(&tables, &foreign_keys)?, vec![])
    } else {
        ((0..tables.len()).collect(), foreign_key_statements(dialect, &tables, &foreign_keys))
    };

    let mut view_statements = Vec::with_capacity(views.len());
    for view in &views {
        view_statements.push((view.name.clone(), view_statement(pool, &view.name).await?));
    }
    let view_statements = order_views(view_statements);

    let file = tokio::fs::File::create(file_path)
        .await
        .map_err(|e| format!("Couldn't create {file_path}: {e}"))?;
    let mut out = BufWriter::new(file);
    let ordered: Vec<&TableDump> = order.iter().map(|&i| &dumps[i]).collect();
    let written = write_dump(pool, &mut out, &type_statements, &ordered, &fk_statements, &view_statements).await;
    drop(out);

    match written {
        Ok(rows_exported) => Ok(ExportSummary {
            tables_exported: tables.len() as u32,
            views_exported: view_statements.len() as u32,
            rows_exported,
            file_path: file_path.to_string(),
        }),
        Err(e) => {
            // Don't leave a truncated dump behind that looks complete
            let _ = tokio::fs::remove_file(file_path).await;
            Err(e)
        }
    }
}

async fn table_dump(pool: &DbPool, table: &str) -> Result<TableDump, String> {
    match pool {
        DbPool::Postgres(pg) => postgres::table_dump(pg, table).await,
        DbPool::MySql(mysql) => mysql::table_dump(mysql, table).await,
        DbPool::Sqlite(sqlite) => sqlite::table_dump(sqlite, table).await,
    }
}

async fn view_statement(pool: &DbPool, view: &str) -> Result<String, String> {
    match pool {
        DbPool::Postgres(pg) => postgres::view_statement(pg, view).await,
        DbPool::MySql(mysql) => mysql::view_statement(mysql, view).await,
        DbPool::Sqlite(sqlite) => sqlite::view_statement(sqlite, view).await,
    }
}

/// Returns the number of rows written.
async fn write_dump<W: AsyncWrite + Unpin>(
    pool: &DbPool,
    out: &mut W,
    type_statements: &[String],
    tables: &[&TableDump],
    fk_statements: &[String],
    view_statements: &[String],
) -> Result<u64, String> {
    for stmt in type_statements {
        write_statement(out, stmt).await?;
    }
    for stmt in tables.iter().flat_map(|t| &t.schema) {
        write_statement(out, stmt).await?;
    }
    let mut rows = 0;
    for table in tables {
        rows += write_rows(pool, out, table).await?;
    }
    let after_data = tables.iter().flat_map(|t| &t.after_data);
    for stmt in after_data.chain(fk_statements).chain(view_statements) {
        write_statement(out, stmt).await?;
    }
    out.flush().await.map_err(|e| e.to_string())?;
    Ok(rows)
}

async fn write_statement<W: AsyncWrite + Unpin>(out: &mut W, stmt: &str) -> Result<(), String> {
    let stmt = ensure_semicolon(stmt.to_string());
    out.write_all(stmt.as_bytes()).await.map_err(|e| e.to_string())?;
    out.write_all(b"\n\n").await.map_err(|e| e.to_string())
}

/// Streams the table's rows from one query and writes them in batched INSERTs,
/// so neither the table nor the dump is ever held in memory.
async fn write_rows<W: AsyncWrite + Unpin>(
    pool: &DbPool,
    out: &mut W,
    table: &TableDump,
) -> Result<u64, String> {
    macro_rules! stream_rows {
        ($pool:expr) => {{
            let mut stream =
                sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(table.rows_sql.as_str())).fetch($pool);
            let mut batch = Vec::with_capacity(ROWS_PER_INSERT);
            let mut total = 0;
            while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                batch.push(format!("({row})"));
                if batch.len() == ROWS_PER_INSERT {
                    total += write_insert(out, &table.insert_prefix, &mut batch).await?;
                }
            }
            total + write_insert(out, &table.insert_prefix, &mut batch).await?
        }};
    }

    Ok(match pool {
        DbPool::Postgres(pg) => stream_rows!(pg),
        DbPool::MySql(mysql) => stream_rows!(mysql),
        DbPool::Sqlite(sqlite) => stream_rows!(sqlite),
    })
}

/// Writes and clears the batch; returns how many rows it held.
async fn write_insert<W: AsyncWrite + Unpin>(
    out: &mut W,
    insert_prefix: &str,
    batch: &mut Vec<String>,
) -> Result<u64, String> {
    if batch.is_empty() {
        return Ok(0);
    }
    write_statement(out, &format!("{insert_prefix}\n{}", batch.join(",\n"))).await?;
    let count = batch.len() as u64;
    batch.clear();
    Ok(count)
}

/// Postgres / MySQL: every foreign key as ALTER TABLE ... ADD CONSTRAINT.
fn foreign_key_statements(dialect: Dialect, tables: &[String], foreign_keys: &[Vec<ForeignKey>]) -> Vec<String> {
    tables
        .iter()
        .zip(foreign_keys)
        .flat_map(|(table, keys)| {
            let changes = ForeignKeyChanges {
                drops: vec![],
                adds: keys
                    .iter()
                    .map(|fk| ForeignKeyAddPayload {
                        name: fk.name.clone().unwrap_or_default(),
                        columns: fk.columns.clone(),
                        referenced_table: fk.referenced_table.clone(),
                        referenced_columns: fk.referenced_columns.clone(),
                        on_update: fk.on_update,
                        on_delete: fk.on_delete,
                    })
                    .collect(),
            };
            match dialect {
                Dialect::MySql => generate_mysql_fk_sql(table, &changes),
                Dialect::Postgres | Dialect::Sqlite => generate_pg_fk_sql(table, &changes),
            }
        })
        .collect()
}

/// SQLite: orders tables so each comes after every table its foreign keys
/// reference, keeping the alphabetical order wherever dependencies allow.
/// Self-references are fine inline; any other cycle can't be dumped.
fn creation_order(tables: &[String], foreign_keys: &[Vec<ForeignKey>]) -> Result<Vec<usize>, String> {
    let position: HashMap<&str, usize> = tables.iter().enumerate().map(|(i, t)| (t.as_str(), i)).collect();
    let parents: Vec<Vec<usize>> = foreign_keys
        .iter()
        .enumerate()
        .map(|(i, keys)| {
            keys.iter()
                .filter_map(|fk| position.get(fk.referenced_table.as_str()).copied())
                .filter(|&parent| parent != i)
                .collect()
        })
        .collect();

    let mut placed = vec![false; tables.len()];
    let mut order = Vec::with_capacity(tables.len());
    while order.len() < tables.len() {
        let before = order.len();
        for i in 0..tables.len() {
            if !placed[i] && parents[i].iter().all(|&p| placed[p]) {
                placed[i] = true;
                order.push(i);
            }
        }
        if order.len() == before {
            return Err(cycle_error(tables, &parents, &placed));
        }
    }
    Ok(order)
}

/// Every unplaced table has an unplaced parent, so following those links from
/// any unplaced table must loop back; the loop is the cycle to report.
fn cycle_error(tables: &[String], parents: &[Vec<usize>], placed: &[bool]) -> String {
    let mut path: Vec<usize> = (0..tables.len()).filter(|&i| !placed[i]).take(1).collect();
    let mut cycle_start = 0;
    while let Some(next) = path.last().and_then(|&last| parents[last].iter().copied().find(|&p| !placed[p])) {
        if let Some(seen) = path.iter().position(|&i| i == next) {
            cycle_start = seen;
            break;
        }
        path.push(next);
    }

    let names: Vec<String> = path[cycle_start..].iter().map(|&i| format!("'{}'", tables[i])).collect();
    let listed = match names.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
        _ => names.join(""),
    };
    format!(
        "Cannot export: circular foreign key dependency between tables {listed}. SQLite does not support \
         adding foreign key constraints after table creation, so circular references cannot be dumped as valid SQL."
    )
}

/// Puts each view after any other view whose name its SQL mentions. The check
/// is textual, so a false match only reorders; a real cycle (impossible in a
/// valid database) or an unresolvable tangle falls back to listing order.
fn order_views(mut pending: Vec<(String, String)>) -> Vec<String> {
    let mut ordered = Vec::with_capacity(pending.len());
    while !pending.is_empty() {
        let ready = pending.iter().position(|(name, sql)| {
            !pending.iter().any(|(other, _)| other != name && sql.contains(other.as_str()))
        });
        ordered.push(pending.remove(ready.unwrap_or(0)).1);
    }
    ordered
}

// ── Import ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn import_sql_dump(
    connection_id: String,
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<ImportSummary, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    import_dump(&pool, &file_path).await
}

/// Runs every statement in the file, continuing past failures so one bad
/// statement doesn't block the rest; every failure is collected and reported
/// together. No DROP TABLE is added, so importing over existing tables fails
/// with the database's own "already exists" error, by design.
/// MySQL commits DDL implicitly, so there a failed statement can leave
/// tables created around it behind either way; the other dialects behave the
/// same way now since statements run outside a shared transaction too.
/// The file is read into memory whole; multi-GB dumps are a known v1 limitation.
pub(crate) async fn import_dump(pool: &DbPool, file_path: &str) -> Result<ImportSummary, String> {
    let sql = tokio::fs::read_to_string(file_path)
        .await
        .map_err(|e| format!("Couldn't read {file_path}: {e}"))?;
    let dialect = pool.dialect();
    let (statements, lines): (Vec<String>, Vec<usize>) = split_sql_statements(&sql, dialect)
        .into_iter()
        .map(|s| (s.sql, s.line))
        .unzip();
    if statements.is_empty() {
        return Err("The file doesn't contain any SQL statements.".to_string());
    }

    let failures = pool.execute_continue_on_error(&statements).await;
    let failed: HashSet<usize> = failures.iter().map(|(index, _)| *index).collect();
    let errors: Vec<ImportError> = failures
        .into_iter()
        .map(|(index, source)| {
            let raw_message = source.to_string();
            ImportError {
                message: strip_misleading_source_line(&raw_message).to_string(),
                line: Some(lines[index]),
                snippet: Some(snippet(&statements[index])),
                hint: dialect_mismatch_hint(dialect, &statements[index]).or_else(|| undefined_type_hint(&raw_message)),
            }
        })
        .collect();

    let succeeded: Vec<&str> =
        statements.iter().enumerate().filter(|(i, _)| !failed.contains(i)).map(|(_, s)| s.as_str()).collect();

    Ok(ImportSummary {
        statements_executed: succeeded.len() as u32,
        statements_failed: errors.len() as u32,
        tables_affected: count_tables(&succeeded),
        errors,
    })
}

/// sqlx's Postgres driver appends `at line N` to a database error's Display,
/// but that "line" is where Postgres's own C source raised the error (a
/// backend debugging detail), not any line in the submitted SQL or the dump
/// file. Shown next to our own (correct) file line number, it looks like a
/// contradiction, so strip it rather than confuse users with it.
fn strip_misleading_source_line(message: &str) -> &str {
    const MARKER: &str = " at line ";
    match message.rfind(MARKER) {
        Some(idx) => {
            let suffix = &message[idx + MARKER.len()..];
            if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
                &message[..idx]
            } else {
                message
            }
        }
        None => message,
    }
}

/// Points at the likely cause when Postgres reports a missing type: Orel
/// doesn't export custom types/enums (a documented limitation), so a dump
/// that uses one (e.g. a `status` column typed as a custom enum) fails on
/// import unless that type already exists in the target database.
fn undefined_type_hint(message: &str) -> Option<String> {
    if !message.contains("does not exist") {
        return None;
    }
    let start = message.find("type \"")? + 6;
    let end = start + message[start..].find('"')?;
    let type_name = &message[start..end];
    Some(format!(
        "The type \"{type_name}\" doesn't exist in the target database. Orel doesn't export custom Postgres types/enums yet — create \"{type_name}\" in the target database (or add its CREATE TYPE statement to the file) before importing."
    ))
}

fn snippet(statement: &str) -> String {
    let mut snippet: String = statement.chars().take(SNIPPET_CHARS).collect();
    if snippet.len() < statement.len() {
        snippet.push('…');
    }
    snippet
}

fn dialect_mismatch_hint(dialect: Dialect, statement: &str) -> Option<String> {
    let upper = statement.to_ascii_uppercase();
    let looks_mysql = statement.contains('`') || upper.contains("AUTO_INCREMENT") || upper.contains("ENGINE=");
    let looks_postgres = statement.contains("$$")
        || statement.contains("::")
        || upper.contains("SERIAL")
        || upper.contains("RETURNING");
    let connected = match dialect {
        Dialect::Postgres => "PostgreSQL",
        Dialect::MySql => "MySQL",
        Dialect::Sqlite => "SQLite",
    };
    let looks_like = if dialect != Dialect::MySql && looks_mysql {
        "MySQL"
    } else if dialect != Dialect::Postgres && looks_postgres {
        "PostgreSQL"
    } else {
        return None;
    };
    Some(format!("This looks like a {looks_like} dump; this connection is {connected}."))
}

/// Best-effort count of distinct tables named by CREATE TABLE, INSERT INTO,
/// and ALTER TABLE statements.
fn count_tables<S: AsRef<str>>(statements: &[S]) -> u32 {
    let mut names = HashSet::new();
    for stmt in statements {
        let stmt = stmt.as_ref();
        let words: Vec<&str> = stmt.split_whitespace().take(6).collect();
        let upper: Vec<String> = words.iter().map(|w| w.to_ascii_uppercase()).collect();
        let upper: Vec<&str> = upper.iter().map(String::as_str).collect();
        let name = match upper.as_slice() {
            ["CREATE", "TABLE", "IF", "NOT", "EXISTS", ..] => words.get(5),
            ["ALTER", "TABLE", "ONLY", ..] => words.get(3),
            ["CREATE", "TABLE", ..] | ["INSERT", "INTO", ..] | ["ALTER", "TABLE", ..] => words.get(2),
            _ => None,
        };
        if let Some(name) = name {
            let name = name.split('(').next().unwrap_or(name);
            names.insert(name.trim_matches(['"', '`']).to_lowercase());
        }
    }
    names.len() as u32
}

#[cfg(test)]
#[path = "../test/dump.test.rs"]
mod tests;

#[cfg(test)]
mod error_message_tests {
    use super::{strip_misleading_source_line, undefined_type_hint};

    #[test]
    fn strips_postgres_internal_source_line() {
        let msg = "error returned from database: type \"account_status\" does not exist at line 270";
        assert_eq!(
            strip_misleading_source_line(msg),
            "error returned from database: type \"account_status\" does not exist"
        );
    }

    #[test]
    fn leaves_messages_without_the_suffix_alone() {
        let msg = "error returned from database: relation \"accounts\" already exists";
        assert_eq!(strip_misleading_source_line(msg), msg);
    }

    #[test]
    fn leaves_a_trailing_non_numeric_at_line_alone() {
        // Only strip when what follows "at line" is purely digits — anything
        // else is presumably part of the real message, not sqlx's suffix.
        let msg = "something went wrong at line of business logic";
        assert_eq!(strip_misleading_source_line(msg), msg);
    }

    #[test]
    fn undefined_type_hint_names_the_missing_type() {
        let msg = "error returned from database: type \"account_status\" does not exist";
        let hint = undefined_type_hint(msg).unwrap();
        assert!(hint.contains("\"account_status\""));
        assert!(hint.contains("custom Postgres types/enums"));
    }

    #[test]
    fn no_undefined_type_hint_for_unrelated_errors() {
        let msg = "error returned from database: relation \"accounts\" already exists";
        assert!(undefined_type_hint(msg).is_none());
    }
}
