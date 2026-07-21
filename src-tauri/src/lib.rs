mod commands;

use std::{collections::HashMap, sync::Mutex};

use commands::connection::{
    connect, delete_connection, disconnect, list_databases, load_connections, save_connection,
    switch_database, test_connection, update_connection, AppState,
};
use commands::query::{fetch_rows, list_tables};
use commands::write_queue::{apply_write_queue, generate_sql};
use sqlx::SqlitePool;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // ── Native menu bar ────────────────────────────────────────────
            let settings_item = MenuItemBuilder::with_id("settings", "Settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "Orel")
                .item(&PredefinedMenuItem::about(app, Some("About Orel"), None)?)
                .separator()
                .item(&settings_item)
                .separator()
                .item(&PredefinedMenuItem::quit(app, Some("Quit"))?)
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .build()?;

            app.set_menu(menu)?;

            // Listen for menu events
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                if event.id() == "settings" {
                    let _ = app_handle.emit("open-settings", ());
                }
            });
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
                engine_cache: Mutex::new(HashMap::new()),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_connections,
            save_connection,
            update_connection,
            delete_connection,
            test_connection,
            connect,
            disconnect,
            list_databases,
            switch_database,
            list_tables,
            fetch_rows,
            apply_write_queue,
            generate_sql,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
