mod commands;

use std::{collections::HashMap, io, sync::Mutex};

use commands::connection::{
    connect, delete_connection, disconnect, list_databases, load_connections, save_connection,
    switch_database, test_connection, update_connection, AppState,
};
use commands::query::{fetch_rows, list_tables};
use commands::write_queue::{apply_write_queue, generate_sql};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // ── Native menu bar ────────────────────────────────────────────
            // Start with the default OS menu (Edit, View, Window all work natively)
            let menu = Menu::default(app.handle())?;

            // Build a custom app submenu with Settings added
            let settings_item = MenuItemBuilder::with_id("settings", "Settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let refresh_item = MenuItemBuilder::with_id("refresh", "Refresh")
                .accelerator("CmdOrCtrl+R")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "Orel")
                .about(Some(AboutMetadata::default()))
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View")
                .item(&refresh_item)
                .build()?;

            // Replace the default app submenu with ours
            let default_items = menu.items()?;
            menu.prepend(&view_submenu)?;
            menu.prepend(&app_submenu)?;
            if let Some(first_default) = default_items.first() {
                menu.remove(first_default)?;
            }
            // Remove the default View submenu if it exists
            for item in menu.items()? {
                if let tauri::menu::MenuItemKind::Submenu(sub) = &item {
                    if sub.text()? == "View" && sub.id() != view_submenu.id() {
                        menu.remove(&item)?;
                        break;
                    }
                }
            }

            app.set_menu(menu)?;

            // Listen for menu events
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                if event.id() == "settings" {
                    let _ = app_handle.emit("open-settings", ());
                } else if event.id() == "refresh" {
                    let _ = app_handle.emit("refresh", ());
                }
            });
            let app_path = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_path)?;
            let db_path = app_path.join("orel_spacecraft.db");
            let options = SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(true);

            let pool = tauri::async_runtime::block_on(async {
                let pool = SqlitePoolOptions::new()
                    .connect_with(options)
                    .await
                    .map_err(io::Error::other)?;
                sqlx::migrate!("./migrations")
                    .run(&pool)
                    .await
                    .map_err(io::Error::other)?;

                Ok::<SqlitePool, io::Error>(pool)
            })?;

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
