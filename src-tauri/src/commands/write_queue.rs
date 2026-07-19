use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::commands::connection::{AppState, DbPool};
use crate::commands::query::{mysql_quote, pg_quote};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowIdentity {
    pub pk_columns: Vec<String>,
    pub pk_values: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnChange {
    pub column: String,
    pub old_value: Value,
    pub new_value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum PendingChange {
    Update {
        identity: RowIdentity,
        changes: Vec<ColumnChange>,
    },
    Delete {
        identity: RowIdentity,
    },
    Insert {
        values: serde_json::Map<String, Value>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub applied: Vec<usize>,
    pub failed: Option<(usize, String)>,
    pub not_attempted: Vec<usize>,
}

// ── SQL helpers ──────────────────────────────────────────────────────────────

enum Driver {
    Postgres,
    MySql,
}

fn quote_ident(name: &str, driver: &Driver) -> String {
    match driver {
        Driver::Postgres => pg_quote(name),
        Driver::MySql => mysql_quote(name),
    }
}

fn format_sql_value(val: &Value, driver: &Driver) -> String {
    match val {
        Value::Null => "NULL".to_string(),
        Value::Bool(b) => match driver {
            Driver::Postgres => {
                if *b {
                    "TRUE".to_string()
                } else {
                    "FALSE".to_string()
                }
            }
            Driver::MySql => {
                if *b {
                    "1".to_string()
                } else {
                    "0".to_string()
                }
            }
        },
        Value::Number(n) => n.to_string(),
        Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        // JSON arrays/objects — serialize as string literal
        Value::Array(_) | Value::Object(_) => {
            let json = serde_json::to_string(val).unwrap_or_default();
            format!("'{}'", json.replace('\'', "''"))
        }
    }
}

fn build_where_clause(identity: &RowIdentity, driver: &Driver) -> String {
    identity
        .pk_columns
        .iter()
        .zip(identity.pk_values.iter())
        .map(|(col, val)| format!("{} = {}", quote_ident(col, driver), format_sql_value(val, driver)))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn change_to_sql(table: &str, change: &PendingChange, driver: &Driver) -> String {
    let qt = quote_ident(table, driver);
    match change {
        PendingChange::Update { identity, changes } => {
            let set_clause = changes
                .iter()
                .map(|c| {
                    format!(
                        "{} = {}",
                        quote_ident(&c.column, driver),
                        format_sql_value(&c.new_value, driver)
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            let where_clause = build_where_clause(identity, driver);
            format!("UPDATE {} SET {} WHERE {}", qt, set_clause, where_clause)
        }
        PendingChange::Delete { identity } => {
            let where_clause = build_where_clause(identity, driver);
            format!("DELETE FROM {} WHERE {}", qt, where_clause)
        }
        PendingChange::Insert { values } => {
            if values.is_empty() {
                // Empty insert — use DEFAULT VALUES for Postgres, () VALUES () for MySQL
                return match driver {
                    Driver::Postgres => format!("INSERT INTO {} DEFAULT VALUES", qt),
                    Driver::MySql => format!("INSERT INTO {} () VALUES ()", qt),
                };
            }
            let cols = values
                .keys()
                .map(|k| quote_ident(k, driver))
                .collect::<Vec<_>>()
                .join(", ");
            let vals = values
                .values()
                .map(|v| format_sql_value(v, driver))
                .collect::<Vec<_>>()
                .join(", ");
            format!("INSERT INTO {} ({}) VALUES ({})", qt, cols, vals)
        }
    }
}

fn driver_from_pool(pool: &DbPool) -> Driver {
    match pool {
        DbPool::Postgres(_) => Driver::Postgres,
        DbPool::MySql(_) => Driver::MySql,
    }
}

// ── Transaction capability check ─────────────────────────────────────────────

async fn is_transactional(
    pool: &DbPool,
    connection_id: &str,
    table: &str,
    cache: &Mutex<HashMap<String, HashMap<String, bool>>>,
) -> Result<bool, String> {
    // Postgres always supports transactions
    if matches!(pool, DbPool::Postgres(_)) {
        return Ok(true);
    }

    // Check cache first
    {
        let c = cache.lock().unwrap();
        if let Some(inner) = c.get(connection_id) {
            if let Some(&v) = inner.get(table) {
                return Ok(v);
            }
        }
    }

    // MySQL: check engine type
    let mysql = match pool {
        DbPool::MySql(m) => m,
        _ => unreachable!(),
    };

    let engine: String = sqlx::query_scalar(
        "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    )
    .bind(table)
    .fetch_one(mysql)
    .await
    .map_err(|e| e.to_string())?;

    let result = engine.eq_ignore_ascii_case("InnoDB");

    // Cache the result
    {
        let mut c = cache.lock().unwrap();
        c.entry(connection_id.to_string())
            .or_default()
            .insert(table.to_string(), result);
    }

    Ok(result)
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_sql(
    connection_id: String,
    table: String,
    changes: Vec<PendingChange>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    let driver = driver_from_pool(&pool);
    let sqls = changes
        .iter()
        .map(|c| change_to_sql(&table, c, &driver))
        .collect();

    Ok(sqls)
}

#[tauri::command]
pub async fn apply_write_queue(
    connection_id: String,
    table: String,
    changes: Vec<PendingChange>,
    state: tauri::State<'_, AppState>,
) -> Result<ApplyResult, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    let driver = driver_from_pool(&pool);
    let sqls: Vec<String> = changes
        .iter()
        .map(|c| change_to_sql(&table, c, &driver))
        .collect();

    let total = sqls.len();
    if total == 0 {
        return Ok(ApplyResult {
            applied: vec![],
            failed: None,
            not_attempted: vec![],
        });
    }

    let transactional = is_transactional(&pool, &connection_id, &table, &state.engine_cache).await?;

    if transactional {
        apply_transactional(&pool, &sqls).await
    } else {
        apply_sequential(&pool, &sqls).await
    }
}

async fn apply_transactional(pool: &DbPool, sqls: &[String]) -> Result<ApplyResult, String> {
    let total = sqls.len();

    macro_rules! run_tx {
        ($pool:expr) => {{
            let mut tx = $pool.begin().await.map_err(|e| e.to_string())?;
            for (i, sql) in sqls.iter().enumerate() {
                if let Err(e) = sqlx::query(sql).execute(&mut *tx).await {
                    tx.rollback().await.ok();
                    return Ok(ApplyResult {
                        applied: vec![],
                        failed: Some((i, e.to_string())),
                        not_attempted: ((i + 1)..total).collect(),
                    });
                }
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }};
    }

    match pool {
        DbPool::Postgres(pg) => run_tx!(pg),
        DbPool::MySql(mysql) => run_tx!(mysql),
    }

    Ok(ApplyResult {
        applied: (0..total).collect(),
        failed: None,
        not_attempted: vec![],
    })
}

async fn apply_sequential(pool: &DbPool, sqls: &[String]) -> Result<ApplyResult, String> {
    let total = sqls.len();
    let mut applied = Vec::new();

    for (i, sql) in sqls.iter().enumerate() {
        let err = match pool {
            DbPool::Postgres(pg) => sqlx::query(sql).execute(pg).await.err(),
            DbPool::MySql(mysql) => sqlx::query(sql).execute(mysql).await.err(),
        };

        if let Some(e) = err {
            return Ok(ApplyResult {
                applied,
                failed: Some((i, e.to_string())),
                not_attempted: ((i + 1)..total).collect(),
            });
        }
        applied.push(i);
    }

    Ok(ApplyResult {
        applied,
        failed: None,
        not_attempted: vec![],
    })
}
