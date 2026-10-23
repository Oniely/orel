// MySQL / MariaDB: DDL, structure introspection, and ALTER TABLE generation.

use super::*;
use crate::commands::sql_util::{mysql_quote, mysql_string_literal, normalize_mysql_type};

pub(super) async fn fetch_mysql_ddl(pool: sqlx::MySqlPool, table: &str) -> Result<TableDdl, String> {
    let table_type = sqlx::query_scalar::<_, String>(
        "SELECT CAST(TABLE_TYPE AS CHAR) \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    )
    .bind(table)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Table not found: {table}"))?;

    if table_type != "BASE TABLE" {
        return Err("DDL is only available for tables".to_string());
    }

    let sql = format!("SHOW CREATE TABLE {}", mysql_quote(table));
    let (_, ddl) = sqlx::query_as::<_, (String, String)>(sqlx::AssertSqlSafe(sql))
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(TableDdl {
        ddl: ensure_semicolon(ddl),
        dialect: "mysql".to_string(),
        source: "native".to_string(),
    })
}


#[derive(sqlx::FromRow)]
pub(super) struct MySqlColumnRow {
    pub(super) name: String,
    pub(super) data_type: String,
    pub(super) column_type: String,
    pub(super) is_nullable: String,
    pub(super) is_primary: i8,
    pub(super) is_fk: i8,
    pub(super) is_indexed: i8,
    pub(super) default_value: Option<String>,
    pub(super) extra: Option<String>,
    pub(super) comment: Option<String>,
    pub(super) charset: Option<String>,
    pub(super) collation: Option<String>,
    pub(super) generation_expr: Option<String>,
    pub(super) is_mariadb: i8,
}


pub(crate) async fn fetch_mysql_structure(
    pool: &sqlx::MySqlPool,
    table: &str,
) -> Result<TableStructure, String> {
    let rows = sqlx::query_as::<_, MySqlColumnRow>(
        "SELECT \
            CAST(c.COLUMN_NAME AS CHAR) AS name, \
            CAST(CASE \
                WHEN c.COLUMN_TYPE LIKE '% unsigned%' THEN CONCAT(c.DATA_TYPE, ' unsigned') \
                ELSE c.DATA_TYPE \
            END AS CHAR) AS data_type, \
            CAST(c.COLUMN_TYPE AS CHAR) AS column_type, \
            CAST(c.IS_NULLABLE AS CHAR) AS is_nullable, \
            IF(c.COLUMN_KEY = 'PRI', 1, 0) AS is_primary, \
            IF(EXISTS( \
                SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k \
                WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA \
                    AND k.TABLE_NAME = c.TABLE_NAME \
                    AND k.COLUMN_NAME = c.COLUMN_NAME \
                    AND k.REFERENCED_TABLE_NAME IS NOT NULL \
            ), 1, 0) AS is_fk, \
            IF(c.COLUMN_KEY IN ('MUL', 'UNI'), 1, 0) AS is_indexed, \
            CAST(c.COLUMN_DEFAULT AS CHAR) AS default_value, \
            CAST(c.EXTRA AS CHAR) AS extra, \
            CAST(c.COLUMN_COMMENT AS CHAR) AS comment, \
            CAST(c.CHARACTER_SET_NAME AS CHAR) AS charset, \
            CAST(c.COLLATION_NAME AS CHAR) AS collation, \
            CAST(c.GENERATION_EXPRESSION AS CHAR) AS generation_expr, \
            IF(VERSION() LIKE '%MariaDB%', 1, 0) AS is_mariadb \
        FROM information_schema.COLUMNS c \
        WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = ? \
        ORDER BY c.ORDINAL_POSITION",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let columns = rows
        .into_iter()
        .map(|row| {
            let data_type = normalize_mysql_type(&row.data_type);
            let extra = row.extra.unwrap_or_default();
            let default_value =
                mysql_default_sql(row.default_value, &extra, &data_type, row.is_mariadb != 0);
            StructureColumn {
                name: row.name,
                type_params: extract_type_params(&row.column_type),
                data_type,
                is_nullable: row.is_nullable == "YES",
                is_primary: row.is_primary != 0,
                is_foreign_key: row.is_fk != 0,
                is_indexed: row.is_indexed != 0,
                default_value,
                mysql: Some(MySqlColumnMeta {
                    column_type: row.column_type,
                    extra,
                    comment: row.comment.unwrap_or_default(),
                    charset: row.charset,
                    collation: row.collation,
                    generation_expr: row.generation_expr.filter(|e| !e.is_empty()),
                }),
            }
        })
        .collect();

    Ok(TableStructure {
        columns,
        dialect: "mysql".to_string(),
    })
}


/// MySQL's information_schema escapes quotes inside expressions
/// (`concat(_utf8mb4\'a\')`), which isn't valid SQL when pasted back.
pub(super) fn unescape_mysql_expr(expr: &str) -> String {
    expr.replace("\\'", "'")
}


pub(super) fn mysql_base_type(data_type: &str) -> &str {
    data_type.split(' ').next().unwrap_or(data_type)
}


pub(super) fn is_mysql_string_type(data_type: &str) -> bool {
    matches!(
        mysql_base_type(data_type),
        "char" | "varchar" | "tinytext" | "text" | "mediumtext" | "longtext" | "enum" | "set"
    )
}


pub(super) fn is_mysql_numeric_type(data_type: &str) -> bool {
    matches!(
        mysql_base_type(data_type),
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "decimal"
            | "numeric" | "float" | "double" | "real" | "year" | "bit"
    )
}


/// Turns COLUMN_DEFAULT into SQL that can follow `DEFAULT`, matching what
/// Postgres' pg_get_expr returns. MySQL reports string literals unquoted and
/// expression defaults without their required parentheses; MariaDB already
/// returns SQL but reports "no default" as the string `NULL`.
pub(super) fn mysql_default_sql(
    raw: Option<String>,
    extra: &str,
    data_type: &str,
    is_mariadb: bool,
) -> Option<String> {
    let raw = raw?;
    if is_mariadb {
        return (raw != "NULL").then_some(raw);
    }
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with("current_timestamp") || lower.starts_with("now(") || lower.starts_with("localtime") {
        return Some(raw);
    }
    if extra.to_ascii_lowercase().contains("default_generated") {
        return Some(format!("({})", unescape_mysql_expr(&raw)));
    }
    if is_mysql_numeric_type(data_type) {
        Some(raw)
    } else {
        Some(mysql_string_literal(&raw))
    }
}


/// Renders a MySQL type with params, keeping modifiers after the params
/// (`int(10) unsigned`, not `int unsigned(10)`).
pub(super) fn mysql_type_sql(data_type: &str, params: Option<&str>) -> String {
    match data_type.split_once(' ') {
        Some((base, modifiers)) => format!("{} {}", type_with_params(base, params), modifiers),
        None => type_with_params(data_type, params),
    }
}


pub(super) fn mysql_definition_changed(orig: &StructureColumn, edit: &ColumnEditPayload) -> bool {
    edit.data_type != orig.data_type
        || edit.type_params != orig.type_params
        || edit.nullable != orig.is_nullable
        || edit.default_value != orig.default_value
}


/// Full column definition for MODIFY/CHANGE COLUMN. MySQL replaces the whole
/// definition, so anything not restated here — AUTO_INCREMENT, COMMENT,
/// charset, ON UPDATE, generated expressions — would be silently dropped.
pub(crate) fn mysql_column_def(orig: &StructureColumn, edit: Option<&ColumnEditPayload>) -> String {
    let (name, data_type, type_params, nullable, default_value) = match edit {
        Some(e) => (&e.name, &e.data_type, &e.type_params, e.nullable, &e.default_value),
        None => (&orig.name, &orig.data_type, &orig.type_params, orig.is_nullable, &orig.default_value),
    };
    let meta = orig.mysql.as_ref();
    let type_unchanged = *data_type == orig.data_type && *type_params == orig.type_params;
    let full_type = match meta {
        Some(m) if type_unchanged && !m.column_type.is_empty() => m.column_type.clone(),
        _ => mysql_type_sql(data_type, type_params.as_deref()),
    };
    let mut def = format!("{} {}", mysql_quote(name), full_type);

    let extra = meta.map(|m| m.extra.to_ascii_lowercase()).unwrap_or_default();
    let generated = meta.and_then(|m| m.generation_expr.as_deref());

    if let Some(m) = meta {
        if let (true, Some(cs), Some(coll)) = (is_mysql_string_type(data_type), &m.charset, &m.collation) {
            def.push_str(&format!(" CHARACTER SET {cs} COLLATE {coll}"));
        }
    }
    if let Some(expr) = generated {
        let kind = if extra.contains("stored") { "STORED" } else { "VIRTUAL" };
        def.push_str(&format!(" GENERATED ALWAYS AS ({}) {kind}", unescape_mysql_expr(expr)));
    }
    def.push_str(if nullable { " NULL" } else { " NOT NULL" });
    if generated.is_none() {
        if let Some(d) = default_value.as_deref().filter(|d| !d.is_empty()) {
            def.push_str(" DEFAULT ");
            def.push_str(d);
        }
    }
    if let Some(m) = meta {
        if extra.contains("auto_increment") {
            def.push_str(" AUTO_INCREMENT");
        }
        if let Some(idx) = extra.find("on update ") {
            def.push_str(" ON UPDATE ");
            def.push_str(m.extra[idx + "on update ".len()..].trim());
        }
        if extra.contains("invisible") {
            def.push_str(" INVISIBLE");
        }
        if !m.comment.is_empty() {
            def.push_str(" COMMENT ");
            def.push_str(&mysql_string_literal(&m.comment));
        }
    }
    def
}


/// Emits one ALTER TABLE: MySQL auto-commits every DDL statement, so a single
/// statement is the only way to make a save all-or-nothing. Clauses apply in
/// order and later clauses see earlier renames, so drops go first and column
/// moves are emitted in the target order with AFTER using the new names.
pub(super) fn generate_mysql_alter(
    table: &str,
    current: &[StructureColumn],
    changes: &StructureChanges,
) -> Result<Vec<String>, String> {
    let cols = col_map(current);
    let edits: HashMap<&str, &ColumnEditPayload> = resolve_edits(&cols, changes)?
        .into_iter()
        .map(|(col, edit)| (col.name.as_str(), edit))
        .collect();
    let new_name = |orig: &str| edits.get(orig).map_or(orig.to_string(), |e| e.name.clone());

    let mut clauses: Vec<String> = changes
        .drops
        .iter()
        .map(|name| format!("DROP COLUMN {}", mysql_quote(name)))
        .collect();

    let surviving: Vec<&str> = current
        .iter()
        .map(|c| c.name.as_str())
        .filter(|name| !changes.drops.iter().any(|d| d == name))
        .collect();
    let target: Vec<&str> = match &changes.reorder {
        Some(order) => {
            let order: Vec<&str> = order
                .iter()
                .map(String::as_str)
                .filter(|name| !changes.drops.iter().any(|d| d == name))
                .collect();
            let mut sorted_order = order.clone();
            let mut sorted_surviving = surviving.clone();
            sorted_order.sort_unstable();
            sorted_surviving.sort_unstable();
            if sorted_order != sorted_surviving {
                return Err("The column order is out of date. Refresh the structure and try again.".to_string());
            }
            order
        }
        None => surviving.clone(),
    };

    // Replay moves on a simulated column list so only columns that actually
    // move get a FIRST/AFTER clause.
    let mut simulated = surviving;
    for (i, &orig_name) in target.iter().enumerate() {
        let col = cols[orig_name];
        let edit = edits.get(orig_name).copied();

        let position = if simulated[i] != orig_name {
            let from = simulated.iter().position(|n| *n == orig_name).unwrap_or(i);
            let moved = simulated.remove(from);
            simulated.insert(i, moved);
            if i == 0 {
                " FIRST".to_string()
            } else {
                format!(" AFTER {}", mysql_quote(&new_name(target[i - 1])))
            }
        } else {
            String::new()
        };

        let renamed = edit.is_some_and(|e| e.name != e.original_name);
        let definition_changed = edit.is_some_and(|e| mysql_definition_changed(col, e));

        if definition_changed || !position.is_empty() {
            let def = mysql_column_def(col, edit);
            if renamed {
                clauses.push(format!("CHANGE COLUMN {} {def}{position}", mysql_quote(orig_name)));
            } else {
                clauses.push(format!("MODIFY COLUMN {def}{position}"));
            }
        } else if renamed {
            // Rename only: leave the definition untouched.
            clauses.push(format!(
                "RENAME COLUMN {} TO {}",
                mysql_quote(orig_name),
                mysql_quote(&new_name(orig_name))
            ));
        }
    }

    for add in &changes.adds {
        let full_type = mysql_type_sql(&add.data_type, add.type_params.as_deref());
        clauses.push(format!("ADD COLUMN {}", add_column_def(mysql_quote(&add.name), full_type, add)));
    }

    if clauses.is_empty() {
        return Ok(vec![]);
    }
    Ok(vec![format!("ALTER TABLE {} {};", mysql_quote(table), clauses.join(", "))])
}

