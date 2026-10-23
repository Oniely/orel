// MySQL / MariaDB: table DDL, row literals, and views for dumps.

use super::TableDump;
use crate::commands::indexes::{fetch_mysql_indexes, TableIndex};
use crate::commands::sql_util::{is_mysql_binary_type, mysql_quote};
use crate::commands::structure::mysql::{fetch_mysql_structure, mysql_column_def};

pub(super) async fn current_database(pool: &sqlx::MySqlPool) -> Result<String, String> {
    sqlx::query_scalar::<_, Option<String>>("SELECT CAST(DATABASE() AS CHAR)")
        .fetch_one(pool)
        .await
        .map(Option::unwrap_or_default)
        .map_err(|e| e.to_string())
}

/// `PRIMARY KEY (...)`, `UNIQUE KEY name (...)`, ... for inside CREATE TABLE.
fn index_definition(index: &TableIndex) -> String {
    let parts = index
        .columns
        .iter()
        .map(|c| {
            let mut part = mysql_quote(&c.name);
            if let Some(len) = c.prefix_length {
                part.push_str(&format!("({len})"));
            }
            if c.descending {
                part.push_str(" DESC");
            }
            part
        })
        .collect::<Vec<_>>()
        .join(", ");
    let kind = match index.method.as_deref() {
        _ if index.is_primary => return format!("PRIMARY KEY ({parts})"),
        Some("FULLTEXT") => "FULLTEXT KEY",
        Some("SPATIAL") => "SPATIAL KEY",
        _ if index.is_unique => "UNIQUE KEY",
        _ => "KEY",
    };
    format!("{kind} {} ({parts})", mysql_quote(&index.name))
}

/// Foreign keys are left out of CREATE TABLE; the dump adds them at the end.
/// Keys are kept inline because AUTO_INCREMENT needs its key in the same
/// statement. Known limitation: functional (expression) indexes are skipped,
/// and table options (ENGINE, charset) use the server defaults.
pub(super) async fn table_dump(pool: &sqlx::MySqlPool, table: &str) -> Result<TableDump, String> {
    let (structure, indexes) =
        tokio::try_join!(fetch_mysql_structure(pool, table), fetch_mysql_indexes(pool, table))?;
    let columns = structure.columns;

    let mut definitions: Vec<String> = columns.iter().map(|c| format!("  {}", mysql_column_def(c, None))).collect();
    definitions.extend(
        indexes
            .iter()
            .filter(|i| !i.columns.iter().any(|c| c.is_expression))
            .map(|i| format!("  {}", index_definition(i))),
    );
    let qt = mysql_quote(table);
    let create = format!("CREATE TABLE {qt} (\n{}\n)", definitions.join(",\n"));

    // Generated columns can't be inserted into. Binary and BIT values are
    // written as hex / bit literals; QUOTE() renders everything else.
    let inserted: Vec<_> = columns
        .iter()
        .filter(|c| c.mysql.as_ref().map_or(true, |m| m.generation_expr.is_none()))
        .collect();
    let literals = inserted
        .iter()
        .map(|c| {
            let col = mysql_quote(&c.name);
            if is_mysql_binary_type(&c.data_type) {
                format!("IF({col} IS NULL, 'NULL', CONCAT('X''', HEX({col}), ''''))")
            } else if c.data_type == "bit" {
                format!("IF({col} IS NULL, 'NULL', CONCAT('b''', BIN({col}), ''''))")
            } else {
                format!("CONVERT(QUOTE({col}) USING utf8mb4)")
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    let names = inserted.iter().map(|c| mysql_quote(&c.name)).collect::<Vec<_>>().join(", ");

    Ok(TableDump {
        schema: vec![create],
        insert_prefix: format!("INSERT INTO {qt} ({names}) VALUES"),
        rows_sql: format!("SELECT CAST(CONCAT_WS(', ', {literals}) AS CHAR) FROM {qt}"),
        after_data: vec![],
    })
}

/// SHOW CREATE VIEW, minus its DEFINER / ALGORITHM / SQL SECURITY header so the
/// view imports under any account. (information_schema.VIEWS would qualify
/// every table with the source database name.)
pub(super) async fn view_statement(pool: &sqlx::MySqlPool, view: &str) -> Result<String, String> {
    let sql = format!("SHOW CREATE VIEW {}", mysql_quote(view));
    let (_, create, _, _) = sqlx::query_as::<_, (String, String, String, String)>(sqlx::AssertSqlSafe(sql))
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let header = format!(" VIEW {} AS ", mysql_quote(view));
    let body = create
        .find(&header)
        .map(|at| &create[at + header.len()..])
        .ok_or_else(|| format!("Couldn't read the definition of view {view}"))?;
    Ok(format!("CREATE VIEW {} AS {body}", mysql_quote(view)))
}
