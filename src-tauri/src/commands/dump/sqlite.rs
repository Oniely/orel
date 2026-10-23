// SQLite: table DDL, row literals, and views for dumps.

use super::TableDump;
use crate::commands::sql_util::pg_quote;
use crate::commands::structure::sqlite::fetch_sqlite_ddl;

/// SQLite keeps each object's original CREATE statement, foreign keys
/// included, which is exactly what the dump needs, so it's used verbatim.
pub(super) async fn table_dump(pool: &sqlx::SqlitePool, table: &str) -> Result<TableDump, String> {
    let create = fetch_sqlite_ddl(pool.clone(), table).await?.ddl;
    // Autoindexes behind UNIQUE / PRIMARY KEY have no SQL and come with the table
    let indexes = sqlx::query_scalar::<_, String>(
        "SELECT sql FROM sqlite_master \
         WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL \
         ORDER BY name",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    // table_info leaves out generated columns, which can't be inserted into
    let columns = sqlx::query_scalar::<_, String>("SELECT name FROM pragma_table_info(?) ORDER BY cid")
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let qt = pg_quote(table);
    let names: Vec<String> = columns.iter().map(|c| pg_quote(c)).collect();
    let mut schema = vec![create];
    schema.extend(indexes);
    Ok(TableDump {
        schema,
        insert_prefix: format!("INSERT INTO {qt} ({}) VALUES", names.join(", ")),
        rows_sql: format!(
            "SELECT {} FROM {qt}",
            names.iter().map(|n| format!("quote({n})")).collect::<Vec<_>>().join(" || ', ' || ")
        ),
        after_data: vec![],
    })
}

pub(super) async fn view_statement(pool: &sqlx::SqlitePool, view: &str) -> Result<String, String> {
    sqlx::query_scalar::<_, String>("SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?")
        .bind(view)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}
