// PostgreSQL: table DDL, row literals, sequence resets, and views for dumps.

use super::TableDump;
use crate::commands::sql_util::pg_quote;
use crate::commands::structure::postgres::{
    fetch_pg_column_ddl, fetch_pg_constraint_ddl, render_pg_create_table,
};

pub(super) async fn current_database(pool: &sqlx::PgPool) -> Result<String, String> {
    sqlx::query_scalar::<_, String>("SELECT current_database()::text")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

fn string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Foreign keys are left out of CREATE TABLE; the dump adds them at the end.
/// serial / identity columns get their sequence moved past the loaded ids.
/// Known limitation: generated columns, and columns of user-defined types,
/// don't round-trip (types aren't exported).
pub(super) async fn table_dump(pool: &sqlx::PgPool, table: &str) -> Result<TableDump, String> {
    let (columns, constraints) = tokio::try_join!(
        fetch_pg_column_ddl(pool, table),
        fetch_pg_constraint_ddl(pool, table, false),
    )?;
    // Indexes not already created by a PRIMARY KEY / UNIQUE / EXCLUDE constraint
    let indexes = sqlx::query_scalar::<_, String>(
        "SELECT pg_catalog.pg_get_indexdef(ix.indexrelid) \
         FROM pg_catalog.pg_index ix \
         JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_catalog.pg_class ic ON ic.oid = ix.indexrelid \
         WHERE t.relname = $1 \
            AND n.nspname = 'public' \
            AND NOT EXISTS ( \
                SELECT 1 FROM pg_catalog.pg_constraint con \
                WHERE con.conindid = ix.indexrelid \
                    AND con.conrelid = ix.indrelid \
                    AND con.contype IN ('p', 'u', 'x') \
            ) \
         ORDER BY ic.relname",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let qt = pg_quote(table);
    let names: Vec<String> = columns.iter().map(|c| pg_quote(&c.name)).collect();
    let overriding = if columns.iter().any(|c| c.identity == "a") {
        " OVERRIDING SYSTEM VALUE"
    } else {
        ""
    };
    let after_data = columns
        .iter()
        .filter(|c| c.serial_type.is_some() || !c.identity.is_empty())
        .map(|c| {
            format!(
                "SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence({}, {}), MAX({})) FROM {qt}",
                string_literal(&qt),
                string_literal(&c.name),
                pg_quote(&c.name),
            )
        })
        .collect();
    let rows_sql = format!(
        "SELECT {} FROM {qt}",
        names.iter().map(|n| format!("quote_nullable({n})")).collect::<Vec<_>>().join(" || ', ' || ")
    );
    let insert_prefix = format!("INSERT INTO {qt} ({}){overriding} VALUES", names.join(", "));

    let mut schema = vec![render_pg_create_table(table, columns, constraints)];
    schema.extend(indexes);
    Ok(TableDump { schema, insert_prefix, rows_sql, after_data })
}

pub(super) async fn view_statement(pool: &sqlx::PgPool, view: &str) -> Result<String, String> {
    let definition = sqlx::query_scalar::<_, String>(
        "SELECT pg_catalog.pg_get_viewdef(c.oid, true) \
         FROM pg_catalog.pg_class c \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE c.relname = $1 AND n.nspname = 'public'",
    )
    .bind(view)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(format!("CREATE VIEW {} AS\n{}", pg_quote(view), definition.trim().trim_end_matches(';')))
}
