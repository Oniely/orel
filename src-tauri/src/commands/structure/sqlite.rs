// SQLite: DDL, structure introspection, and ALTER TABLE generation.

use std::collections::HashSet;

use super::*;
use crate::commands::indexes::TableIndex;
use crate::commands::sql_util::{normalize_sqlite_type, pg_quote};

pub(super) async fn fetch_sqlite_ddl(pool: sqlx::SqlitePool, table: &str) -> Result<TableDdl, String> {
    let row = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT type, sql FROM sqlite_master \
         WHERE name = ? AND type IN ('table', 'view')",
    )
    .bind(table)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Table not found: {table}"))?;

    if row.0 != "table" {
        return Err("DDL is only available for tables".to_string());
    }

    let ddl = row
        .1
        .ok_or_else(|| format!("No CREATE TABLE SQL is available for {table}"))?;

    Ok(TableDdl {
        ddl: ensure_semicolon(ddl),
        dialect: "sqlite".to_string(),
        source: "native".to_string(),
    })
}


pub(super) async fn fetch_sqlite_structure(
    pool: &sqlx::SqlitePool,
    table: &str,
) -> Result<TableStructure, String> {
    let rows = sqlx::query_as::<_, (i32, String, String, i32, Option<String>, i32)>(
        "SELECT * FROM pragma_table_info(?)",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Collect FK column names
    let fk_rows = sqlx::query_as::<_, (String,)>(
        "SELECT \"from\" FROM pragma_foreign_key_list(?)",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let fk_cols: HashSet<String> = fk_rows.into_iter().map(|(c,)| c).collect();

    // Collect indexed column names (non-PK)
    let idx_rows = sqlx::query_as::<_, (String,)>(
        "SELECT ii.name FROM pragma_index_list(?) il, pragma_index_info(il.name) ii \
         WHERE il.origin != 'pk'",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let idx_cols: HashSet<String> = idx_rows.into_iter().map(|(c,)| c).collect();

    let columns = rows
        .into_iter()
        .map(|(_, name, declared_type, notnull, dflt_value, pk)| {
            let type_params = extract_type_params(&declared_type);
            let is_fk = fk_cols.contains(&name);
            let is_idx = idx_cols.contains(&name);
            StructureColumn {
                name,
                data_type: normalize_sqlite_type(&declared_type),
                type_params,
                is_nullable: notnull == 0,
                is_primary: pk > 0,
                is_foreign_key: is_fk,
                is_indexed: is_idx,
                default_value: dflt_value,
                mysql: None,
            }
        })
        .collect();

    Ok(TableStructure {
        columns,
        dialect: "sqlite".to_string(),
    })
}


/// Drops run first so a rename can reuse a dropped column's name. SQLite
/// refuses to drop an indexed column, so indexes covering a dropped column are
/// dropped just before it (Postgres and MySQL handle this themselves).
pub(super) fn generate_sqlite_alter(
    table: &str,
    current: &[StructureColumn],
    indexes: &[TableIndex],
    changes: &StructureChanges,
) -> Result<Vec<String>, String> {
    if changes.reorder.is_some() {
        return Err(
            "Column reordering is not supported for SQLite. Use the DDL tab to recreate the table."
                .to_string(),
        );
    }
    let mut stmts = Vec::new();
    let qt = pg_quote(table);
    let cols = col_map(current);
    let edits = resolve_edits(&cols, changes)?;

    for (orig, edit) in &edits {
        let new_type = type_with_params(&edit.data_type, edit.type_params.as_deref());
        let orig_type = type_with_params(&orig.data_type, orig.type_params.as_deref());

        if new_type != orig_type {
            return Err(
                "SQLite does not support changing column types. Use the DDL tab to recreate the table."
                    .to_string(),
            );
        }
        if edit.nullable != orig.is_nullable {
            return Err(
                "SQLite does not support changing column nullability. Use the DDL tab to recreate the table."
                    .to_string(),
            );
        }
        if edit.default_value != orig.default_value {
            return Err(
                "SQLite does not support changing column defaults. Use the DDL tab to recreate the table."
                    .to_string(),
            );
        }
    }

    for index in indexes {
        let covers_dropped = index.columns.iter().any(|c| changes.drops.contains(&c.name));
        if index.droppable && covers_dropped {
            stmts.push(format!("DROP INDEX {};", pg_quote(&index.name)));
        }
    }

    for col_name in &changes.drops {
        stmts.push(format!(
            "ALTER TABLE {} DROP COLUMN {};",
            qt,
            pg_quote(col_name)
        ));
    }

    for (_, edit) in &edits {
        if edit.name != edit.original_name {
            stmts.push(format!(
                "ALTER TABLE {} RENAME COLUMN {} TO {};",
                qt,
                pg_quote(&edit.original_name),
                pg_quote(&edit.name)
            ));
        }
    }

    for add in &changes.adds {
        let full_type = type_with_params(&add.data_type, add.type_params.as_deref());
        stmts.push(format!(
            "ALTER TABLE {} ADD COLUMN {};",
            qt,
            add_column_def(pg_quote(&add.name), full_type, add)
        ));
    }

    Ok(stmts)
}

