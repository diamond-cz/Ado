mod commands;
mod error;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let window_settings = commands::window::load_window_settings();
    tauri::Builder::default()
        .manage(commands::window::CloseToTrayFlag::new(
            window_settings.close_to_tray,
        ))
        .manage(commands::window::AppQuitFlag::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            commands::window::install_system_tray(app)?;
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("todo") {
                let _ = commands::taskbar::apply_window_app_id(&window, "com.aebox.ado");
                commands::window::attach_todo_close_handler(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_init,
            commands::window::get_window_settings,
            commands::window::set_close_to_tray,
            commands::window::set_autostart,
            commands::todo_settings::get_todo_settings,
            commands::todo_settings::set_todo_settings,
            commands::todo_settings::list_todo_fonts,
            commands::todos::get_todo_data,
            commands::todos::save_todo_data,
            commands::todos::import_todo_data_from_json,
            commands::todos::export_todo_data_as_json,
            commands::todos::create_todo_db_backup,
            commands::todos::list_todo_db_backups,
            commands::todos::restore_todo_db_backup,
            commands::todos::delete_todo_db_backup,
            commands::todo_webdav::backup_todo_db_to_webdav,
            commands::todo_webdav::list_todo_webdav_backups,
            commands::todo_webdav::sync_todo_db_backups_from_webdav,
            commands::todo_webdav::restore_todo_db_backup_from_webdav,
            commands::todo_webdav::delete_todo_webdav_backup,
            commands::todos::get_tomato_data,
            commands::todos::save_tomato_data,
            commands::todos::save_todo_asset,
            commands::todos::read_todo_asset,
            commands::todos::parse_todo_time_text,
            commands::todos::open_todo_window,
            commands::todos::open_todo_widget_window,
            commands::todos::toggle_todo_widget_window,
            commands::todos::add_today_task,
            commands::todos::add_inbox_task,
            commands::todos::list_today_tasks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running todo application");
}
