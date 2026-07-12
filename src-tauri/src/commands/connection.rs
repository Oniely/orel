use serde::{Deserialize, Serialize};
use sqlx::{MySqlPool, PgPool, SqlitePool};
use std::collections::HashMap;
use std::sync::Mutex;

// Mirrors the SavedConnection from Frontend TypeScript type.
// #[serde(rename_all = "camelCase")] maps snake_case fields to camelCase JSON.
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub db_type: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub ssl: bool,
    pub default_database: Option<String>,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// Minimal config used for test_connection — no id/createdAt/updatedAt needed.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    #[serde(rename = "type")]
    pub db_type: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub ssl: bool,
    pub default_database: Option<String>,
}

// Holds active DB connection pools keyed by connection id.
#[allow(dead_code)]
#[derive(Clone)]
pub enum DbPool {
    Postgres(PgPool),
    MySql(MySqlPool),
}

// AppState type for Tauri app state, holding database connection pools as well as the app db.
pub struct AppState {
    pub db: SqlitePool,                                   // app db
    pub pools: Mutex<HashMap<String, DbPool>>,            // connections pool
    pub configs: Mutex<HashMap<String, SavedConnection>>, // connection config
    pub engine_cache: Mutex<HashMap<String, HashMap<String, bool>>>, // connection_id -> table -> is_transactional
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async fn close_pool(pool: DbPool) {
    match pool {
        DbPool::Postgres(pg) => pg.close().await,
        DbPool::MySql(mysql) => mysql.close().await,
    }
}

async fn create_pool(config: &SavedConnection, database: Option<&str>) -> Result<DbPool, String> {
    match config.db_type.as_str() {
        "postgres" => {
            let pool = PgPool::connect_with(pg_opts(
                &config.host,
                config.port,
                &config.username,
                &config.password,
                config.ssl,
                database,
            ))
            .await
            .map_err(|e| e.to_string())?;
            Ok(DbPool::Postgres(pool))
        }
        "mysql" => {
            let pool = MySqlPool::connect_with(mysql_opts(
                &config.host,
                config.port,
                &config.username,
                &config.password,
                config.ssl,
                database,
            ))
            .await
            .map_err(|e| e.to_string())?;
            Ok(DbPool::MySql(pool))
        }
        other => Err(format!("Unsupported database type: {}", other)),
    }
}

async fn fetch_databases(pool: &DbPool) -> Result<Vec<String>, String> {
    match pool {
        DbPool::Postgres(pg) => sqlx::query_scalar::<_, String>(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
        )
        .fetch_all(pg)
        .await
        .map_err(|e| e.to_string()),
        DbPool::MySql(mysql) => sqlx::query_scalar::<_, String>("SHOW DATABASES")
            .fetch_all(mysql)
            .await
            .map_err(|e| e.to_string()),
    }
}

fn pg_opts(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    ssl: bool,
    database: Option<&str>,
) -> sqlx::postgres::PgConnectOptions {
    use sqlx::postgres::{PgConnectOptions, PgSslMode};

    let mut opts = PgConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .password(password)
        .ssl_mode(if ssl {
            PgSslMode::Require
        } else {
            PgSslMode::Disable
        });

    if let Some(db) = database {
        if !db.is_empty() {
            opts = opts.database(db);
        }
    }
    opts
}

fn mysql_opts(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    ssl: bool,
    database: Option<&str>,
) -> sqlx::mysql::MySqlConnectOptions {
    use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};

    let mut opts = MySqlConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .password(password)
        .ssl_mode(if ssl {
            MySqlSslMode::Required
        } else {
            MySqlSslMode::Disabled
        });

    if let Some(db) = database {
        if !db.is_empty() {
            opts = opts.database(db);
        }
    }
    opts
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn load_connections(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SavedConnection>, String> {
    let connections =
        sqlx::query_as::<_, SavedConnection>("SELECT * FROM connections ORDER BY created_at DESC")
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    Ok(connections)
}

#[tauri::command]
pub async fn save_connection(
    state: tauri::State<'_, AppState>,
    config: SavedConnection,
) -> Result<(), String> {
    sqlx::query("INSERT INTO connections (id, name, type, host, port, username, password, ssl, default_database, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(config.id)
        .bind(config.name)
        .bind(config.db_type)
        .bind(config.host)
        .bind(config.port)
        .bind(config.username)
        .bind(config.password)
        .bind(config.ssl as u8)
        .bind(config.default_database)
        .bind(config.color)
        .bind(config.created_at)
        .bind(config.updated_at)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn update_connection(
    state: tauri::State<'_, AppState>,
    config: SavedConnection,
) -> Result<(), String> {
    sqlx::query("UPDATE connections SET name = ?, type = ?, host = ?, port = ?, username = ?, password = ?, ssl = ?, default_database = ?, color = ?, updated_at = ? WHERE id = ?")
        .bind(config.name)
        .bind(config.db_type)
        .bind(config.host)
        .bind(config.port)
        .bind(config.username)
        .bind(config.password)
        .bind(config.ssl as u8)
        .bind(config.default_database)
        .bind(config.color)
        .bind(config.updated_at)
        .bind(config.id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_connection(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    sqlx::query("DELETE FROM connections WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let old_pool = {
        let mut pools = state.pools.lock().unwrap();
        pools.remove(&id)
    };

    if let Some(pool) = old_pool {
        close_pool(pool).await;
    }

    state.configs.lock().unwrap().remove(&id);

    Ok(())
}

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<String, String> {
    let db = config.default_database.as_deref();

    match config.db_type.as_str() {
        "postgres" => {
            use sqlx::postgres::PgPoolOptions;
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(std::time::Duration::from_secs(5))
                .connect_with(pg_opts(
                    &config.host,
                    config.port,
                    &config.username,
                    &config.password,
                    config.ssl,
                    db,
                ))
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
            pool.close().await;
        }
        "mysql" => {
            use sqlx::mysql::MySqlPoolOptions;
            let pool = MySqlPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(std::time::Duration::from_secs(5))
                .connect_with(mysql_opts(
                    &config.host,
                    config.port,
                    &config.username,
                    &config.password,
                    config.ssl,
                    db,
                ))
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
            pool.close().await;
        }
        other => return Err(format!("Unsupported database type: {}", other)),
    }

    Ok("Connection successful".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub databases: Vec<String>,
    pub active_database: String,
}

#[tauri::command]
pub async fn connect(
    config: SavedConnection,
    state: tauri::State<'_, AppState>,
) -> Result<ConnectResult, String> {
    let connection_id = config.id.clone();
    let default_db = config.default_database.as_deref().filter(|s| !s.is_empty());

    // Connect to a catalog-safe database to list available databases.
    // Postgres: "postgres" (always exists). MySQL: no database needed.
    let initial_db = match config.db_type.as_str() {
        "postgres" => Some("postgres"),
        _ => None,
    };
    let initial_pool = create_pool(&config, initial_db).await?;
    let databases = fetch_databases(&initial_pool).await?;

    // Determine which database to actually connect to
    let target_db = if let Some(db) = default_db {
        if !databases.iter().any(|d| d == db) {
            close_pool(initial_pool).await;
            return Err(format!(
                "Default database '{}' does not exist on the server",
                db
            ));
        }
        db.to_string()
    } else {
        databases
            .first()
            .cloned()
            .ok_or_else(|| "No databases available on the server".to_string())?
    };

    // Reuse the initial pool if it's already connected to the target, otherwise reconnect
    let final_pool = if initial_db == Some(target_db.as_str()) {
        initial_pool
    } else {
        close_pool(initial_pool).await;
        create_pool(&config, Some(&target_db)).await?
    };

    state
        .pools
        .lock()
        .unwrap()
        .insert(connection_id.clone(), final_pool);
    state.configs.lock().unwrap().insert(connection_id, config);

    Ok(ConnectResult {
        databases,
        active_database: target_db,
    })
}

#[tauri::command]
pub async fn list_databases(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(&connection_id)
            .ok_or_else(|| "Connection not found".to_string())?
            .clone()
    };

    fetch_databases(&pool).await
}

#[tauri::command]
pub async fn switch_database(
    connection_id: String,
    database: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let database = database.trim().to_string();
    if database.is_empty() {
        return Err("Database name is required".to_string());
    }

    let config = {
        let configs = state.configs.lock().unwrap();
        configs
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| "Connection not found".to_string())?
    };

    let new_pool = create_pool(&config, Some(&database)).await?;

    let old_pool = {
        let mut pools = state.pools.lock().unwrap();
        pools.insert(connection_id.clone(), new_pool)
    };

    if let Some(old_pool) = old_pool {
        close_pool(old_pool).await;
    }

    {
        let mut configs = state.configs.lock().unwrap();
        if let Some(existing) = configs.get_mut(&connection_id) {
            existing.default_database = Some(database);
        }
    }

    Ok(())
}
