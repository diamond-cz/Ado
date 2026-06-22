use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, WindowEvent};

use crate::commands::app::resolve_base_dir;
use crate::error::CmdResult;

const WINDOW_SETTINGS_FILE: &str = "app_cache/todo/window.json";
const TRAY_ID: &str = "ado-main-tray";
const TRAY_OPEN_TODO_ID: &str = "open-todo";
const TRAY_TOGGLE_WIDGET_ID: &str = "toggle-widget";
const TRAY_QUIT_ID: &str = "quit";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowSettings {
    pub close_to_tray: bool,
    pub autostart: bool,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            close_to_tray: false,
            autostart: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CloseToTrayFlag(Arc<AtomicBool>);

impl CloseToTrayFlag {
    pub fn new(enabled: bool) -> Self {
        Self(Arc::new(AtomicBool::new(enabled)))
    }

    pub fn handle(&self) -> Arc<AtomicBool> {
        self.0.clone()
    }

    pub fn set(&self, enabled: bool) {
        self.0.store(enabled, Ordering::SeqCst);
    }

    pub fn get(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

impl Default for CloseToTrayFlag {
    fn default() -> Self {
        Self::new(false)
    }
}

#[derive(Debug, Clone)]
pub struct AppQuitFlag(Arc<AtomicBool>);

impl AppQuitFlag {
    pub fn handle(&self) -> Arc<AtomicBool> {
        self.0.clone()
    }
}

impl Default for AppQuitFlag {
    fn default() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

pub fn load_window_settings() -> WindowSettings {
    fs::read_to_string(window_settings_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<WindowSettings>(&raw).ok())
        .unwrap_or_default()
}

fn save_window_settings(settings: &WindowSettings) -> CmdResult<()> {
    let path = window_settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir window settings: {}", e))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write window settings: {}", e))
}

fn window_settings_path() -> std::path::PathBuf {
    resolve_base_dir().join(WINDOW_SETTINGS_FILE)
}

#[tauri::command]
pub fn get_window_settings(app: AppHandle) -> CmdResult<WindowSettings> {
    let mut settings = load_window_settings();
    settings.close_to_tray = app.state::<CloseToTrayFlag>().inner().get();
    Ok(settings)
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) -> CmdResult<()> {
    app.state::<CloseToTrayFlag>().inner().set(enabled);
    let mut settings = load_window_settings();
    settings.close_to_tray = enabled;
    save_window_settings(&settings)
}

#[tauri::command]
pub fn set_autostart(_app: AppHandle, enabled: bool) -> CmdResult<()> {
    apply_autostart(enabled)?;
    let mut settings = load_window_settings();
    settings.autostart = enabled;
    save_window_settings(&settings)
}

#[cfg(windows)]
fn apply_autostart(enabled: bool) -> CmdResult<()> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE_NAME: &str = "Ado";

    let run_key = wide_null(RUN_KEY);
    let value_name = wide_null(VALUE_NAME);
    let mut key = HKEY::default();
    let create_result = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR::from_raw(run_key.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    };
    if create_result != ERROR_SUCCESS {
        return Err(format!("open autostart registry key: {:?}", create_result).into());
    }

    let result = if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("current exe: {}", e))?;
        let command = format!("\"{}\"", exe.display());
        let command = wide_null(&command);
        let bytes = unsafe {
            std::slice::from_raw_parts(command.as_ptr() as *const u8, command.len() * 2)
        };
        unsafe {
            RegSetValueExW(
                key,
                PCWSTR::from_raw(value_name.as_ptr()),
                0,
                REG_SZ,
                Some(bytes),
            )
        }
    } else {
        unsafe { RegDeleteValueW(key, PCWSTR::from_raw(value_name.as_ptr())) }
    };

    let _ = unsafe { RegCloseKey(key) };
    if result == ERROR_SUCCESS || (!enabled && result == ERROR_FILE_NOT_FOUND) {
        Ok(())
    } else {
        Err(format!("update autostart registry value: {:?}", result).into())
    }
}

#[cfg(not(windows))]
fn apply_autostart(_enabled: bool) -> CmdResult<()> {
    Ok(())
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

pub fn install_system_tray(app: &mut App) -> tauri::Result<()> {
    let open_todo = MenuItem::with_id(app, TRAY_OPEN_TODO_ID, "打开 Ado", true, None::<&str>)?;
    let toggle_widget =
        MenuItem::with_id(app, TRAY_TOGGLE_WIDGET_ID, "显示/隐藏桌面小组件", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open_todo, &toggle_widget, &separator, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .or_else(|| tauri::image::Image::from_bytes(include_bytes!("../../icons/icon.ico")).ok());

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Ado")
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_OPEN_TODO_ID => open_todo_window_from_tray(app),
            TRAY_TOGGLE_WIDGET_ID => toggle_widget_window_from_tray(app),
            TRAY_QUIT_ID => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_todo_window_from_tray(tray.app_handle());
            }
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub fn attach_todo_close_handler(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    let close_flag = app.state::<CloseToTrayFlag>().inner().handle();
    let quitting_flag = app.state::<AppQuitFlag>().inner().handle();
    let win_for_close = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if quitting_flag.load(Ordering::SeqCst) {
                return;
            }
            if close_flag.load(Ordering::SeqCst) {
                api.prevent_close();
                let _ = win_for_close.hide();
                return;
            }
            quitting_flag.store(true, Ordering::SeqCst);
            let _ = win_for_close.app_handle().exit(0);
        }
    });
}

pub fn attach_hide_on_close_handler(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    let quitting_flag = app.state::<AppQuitFlag>().inner().handle();
    let win_for_close = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if quitting_flag.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            let _ = win_for_close.hide();
        }
    });
}

fn open_todo_window_from_tray(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::commands::todos::open_todo_window(app).await;
    });
}

fn toggle_widget_window_from_tray(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::commands::todos::toggle_todo_widget_window(app).await;
    });
}

fn quit_app(app: &AppHandle) {
    app.state::<AppQuitFlag>()
        .inner()
        .handle()
        .store(true, Ordering::SeqCst);
    app.exit(0);
}
