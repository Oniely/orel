mod commands;

use std::{collections::HashMap, sync::Mutex};

use commands::connection::{
    connect, delete_connection, disconnect, list_databases, load_connections, save_connection,
    switch_database, test_connection, AppState,
};
use commands::query::{fetch_rows, list_tables};
use sqlx::SqlitePool;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_path = app.path().app_data_dir()?;
            let db_path = app_path.join("orel_spacecraft.db");
            let db = format!("sqlite:{}?mode=rwc", db_path.display());

            let pool = tauri::async_runtime::block_on(async {
                let pool = SqlitePool::connect(&db)
                    .await
                    .expect("Failed to connect to database.");
                sqlx::migrate!("./migrations")
                    .run(&pool)
                    .await
                    .expect("Failed to run migrations.");

                pool // return the pool
            });

            app.manage(AppState {
                db: pool,
                pools: Mutex::new(HashMap::new()),
                configs: Mutex::new(HashMap::new()),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_connections,
            save_connection,
            delete_connection,
            test_connection,
            connect,
            disconnect,
            list_databases,
            switch_database,
            list_tables,
            fetch_rows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
