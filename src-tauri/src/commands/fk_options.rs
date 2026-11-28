use serde::Serialize;

use crate::commands::connection::{AppState, DbPool};

use super::foreign_keys::{fetch_foreign_keys, ForeignKey};
use super::sql_util::{cast_to_text, fetch_column_info, ColumnInfo, Dialect};

const FK_OPTIONS_LIMIT: u32 = 100;
const LABEL_COLUMNS: [&str; 7] = ["name", "title", "full_name", "username", "label", "display_name", "email"];

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FkOption {
    pub value: String,
    pub label: Option<String>,
}

fn is_text_type(data_type: &str) -> bool {
    let t = data_type.to_ascii_lowercase();
    t.contains("char") || t.contains("text")
}

/// A well-known display column (name, title, email, ...), else the first text column that isn't a key.
fn pick_label_column(columns: &[ColumnInfo], key: &str) -> Option<String> {
    let others = || columns.iter().filter(|c| c.name != key);
    LABEL_COLUMNS
        .iter()
        .find_map(|n| others().find(|c| c.name.eq_ignore_ascii_case(n)))
        .or_else(|| others().find(|c| !c.is_primary && is_text_type(&c.data_type)))
        .map(|c| c.name.clone())
}

/// Returns the SQL and how many times to bind the search pattern
fn fk_options_sql(dialect: Dialect, fk: &ForeignKey, label: Option<&str>) -> (String, usize) {
    let q = |name: &str| dialect.quote(name);
    let table = match &fk.referenced_schema {
        Some(schema) => format!("{}.{}", q(schema), q(&fk.referenced_table)),
        None => q(&fk.referenced_table),
    };
    let key = q(&fk.referenced_columns[0]);
    let key_text = cast_to_text(dialect, &key);
    let label_text = cast_to_text(dialect, &label.map(q).unwrap_or_else(|| "NULL".to_string()));
    let mut filters = vec![format!("LOWER({key_text}) LIKE {} ESCAPE '!'", dialect.placeholder(1))];
    if label.is_some() {
        filters.push(format!("LOWER({label_text}) LIKE {} ESCAPE '!'", dialect.placeholder(2)));
    }
    // Qualified so Postgres sorts by the column, not by the same-named text output
    let sql = format!(
        "SELECT {key_text}, {label_text} FROM {table} WHERE {key} IS NOT NULL AND ({}) ORDER BY {table}.{key} LIMIT {FK_OPTIONS_LIMIT}",
        filters.join(" OR "),
    );
    (sql, filters.len())
}

fn like_pattern(search: &str) -> String {
    let escaped = search.trim().to_lowercase().replace('!', "!!").replace('%', "!%").replace('_', "!_");
    format!("%{escaped}%")
}

pub(crate) async fn fetch_fk_options_on_pool(
    pool: &DbPool,
    table: &str,
    column: &str,
    search: &str,
) -> Result<Vec<FkOption>, String> {
    let fks = fetch_foreign_keys(pool, table).await?;
    let fk = fks
        .iter()
        .find(|f| f.columns.len() == 1 && f.columns[0] == column)
        .ok_or_else(|| format!("Column \"{column}\" isn't a single-column foreign key."))?;
    // Another schema's columns can't be listed through fetch_column_info, so those show keys only
    let label = match fk.referenced_schema {
        Some(_) => None,
        None => pick_label_column(&fetch_column_info(pool, &fk.referenced_table).await?, &fk.referenced_columns[0]),
    };
    let (sql, binds) = fk_options_sql(pool.dialect(), fk, label.as_deref());
    let pattern = like_pattern(search);

    macro_rules! fetch {
        ($pool:expr) => {{
            let mut query = sqlx::query_as::<_, (String, Option<String>)>(sqlx::AssertSqlSafe(sql));
            for _ in 0..binds {
                query = query.bind(pattern.as_str());
            }
            query.fetch_all($pool).await
        }};
    }
    let rows = match pool {
        DbPool::Postgres(pg) => fetch!(pg),
        DbPool::MySql(mysql) => fetch!(mysql),
        DbPool::Sqlite(sqlite) => fetch!(sqlite),
    }
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(value, label)| FkOption { value, label }).collect())
}

#[tauri::command]
pub async fn fetch_fk_options(
    connection_id: String,
    table: String,
    column: String,
    search: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<FkOption>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    fetch_fk_options_on_pool(&pool, &table, &column, &search).await
}

#[cfg(test)]
#[path = "test/fk_options.test.rs"]
mod tests;
