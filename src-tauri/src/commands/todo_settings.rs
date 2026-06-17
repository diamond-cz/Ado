// Todo-specific settings, kept beside the todo database so the Todo window can
// be maintained independently from the launcher settings UI.
//
// File: `app_cache/todo/settings.json` (resolved via `resolve_base_dir`).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::commands::app::resolve_base_dir;
use crate::error::CmdResult;

const SETTINGS_FILE: &str = "app_cache/todo/settings.json";
const LEGACY_APP_SETTINGS_FILE: &str = "app_cache/app_settings.json";
const TODO_FONTS_DIR: &str = "resource/fonts";
const SUPPORTED_FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "woff", "woff2", "ttc", "otc"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoSettings {
    pub theme_mode: String,
    pub color_theme: String,
    pub color_themes: Vec<TodoColorTheme>,
    pub font_family: String,
    pub accent_color: String,
    pub accent_color_overridden: bool,
    pub checkbox_shape: String,
    pub idle_paper_effect_enabled: bool,
    pub idle_paper_light_effect: String,
    pub web_dav_url: String,
    pub web_dav_username: String,
    pub web_dav_password: String,
    pub web_dav_path: String,
    pub day_start_hour: i32,
    pub day_end_hour: i32,
    pub show_week_numbers: bool,
    pub show_chinese_calendar: bool,
    pub show_lunar_calendar: bool,
    pub first_day: i32,
    pub time_zones: Vec<String>,
    pub shortcuts: TodoShortcuts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoColorTheme {
    pub id: String,
    pub label: String,
    pub panel: String,
    pub middle: String,
    pub content: String,
    pub surface: String,
    pub accent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoShortcuts {
    pub undo: String,
    pub redo: String,
    pub delete: String,
    pub create_task: String,
    pub create_child: String,
    pub complete: String,
    pub search: String,
}

impl Default for TodoShortcuts {
    fn default() -> Self {
        Self {
            undo: "Control+Z".to_string(),
            redo: "Control+Shift+Z".to_string(),
            delete: "Delete".to_string(),
            create_task: "Control+N".to_string(),
            create_child: "Control+Enter".to_string(),
            complete: "Control+M".to_string(),
            search: "Control+F".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoFontEntry {
    pub id: String,
    pub label: String,
    pub file_name: String,
    pub path: String,
}

impl Default for TodoColorTheme {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Custom".to_string(),
            panel: "#f9f9f9".to_string(),
            middle: "#ffffff".to_string(),
            content: "#ffffff".to_string(),
            surface: "#f8fafc".to_string(),
            accent: "#2563eb".to_string(),
        }
    }
}

impl Default for TodoSettings {
    fn default() -> Self {
        Self {
            theme_mode: "system".to_string(),
            color_theme: "default".to_string(),
            color_themes: Vec::new(),
            font_family: String::new(),
            accent_color: "#2563eb".to_string(),
            accent_color_overridden: false,
            checkbox_shape: "square".to_string(),
            idle_paper_effect_enabled: true,
            idle_paper_light_effect: "random".to_string(),
            web_dav_url: String::new(),
            web_dav_username: String::new(),
            web_dav_password: String::new(),
            web_dav_path: "todo-backups".to_string(),
            day_start_hour: 6,
            day_end_hour: 22,
            show_week_numbers: false,
            show_chinese_calendar: true,
            show_lunar_calendar: false,
            first_day: 0,
            time_zones: Vec::new(),
            shortcuts: TodoShortcuts::default(),
        }
    }
}

fn settings_path() -> PathBuf {
    resolve_base_dir().join(SETTINGS_FILE)
}

fn legacy_app_settings_path() -> PathBuf {
    resolve_base_dir().join(LEGACY_APP_SETTINGS_FILE)
}

pub fn load_todo_settings() -> TodoSettings {
    let path = settings_path();
    if path.exists() {
        return fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<TodoSettings>(&raw).ok())
            .map(clamp_todo_settings)
            .unwrap_or_default();
    }

    if let Some(settings) = load_legacy_todo_settings() {
        let _ = save_todo_settings_inner(&settings);
        return settings;
    }

    TodoSettings::default()
}

#[tauri::command]
pub fn get_todo_settings() -> CmdResult<TodoSettings> {
    Ok(load_todo_settings())
}

#[tauri::command]
pub fn set_todo_settings(settings: TodoSettings) -> CmdResult<()> {
    let clamped = clamp_todo_settings(settings);
    save_todo_settings_inner(&clamped)
}

#[tauri::command]
pub fn list_todo_fonts(app: AppHandle) -> CmdResult<Vec<TodoFontEntry>> {
    let user_fonts_dir = resolve_base_dir().join(TODO_FONTS_DIR);
    fs::create_dir_all(&user_fonts_dir).map_err(|e| format!("mkdir resource/fonts: {}", e))?;

    let mut dirs = vec![user_fonts_dir];
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join(TODO_FONTS_DIR));
    }

    let mut seen = HashSet::new();
    let mut fonts = Vec::new();
    for dir in dirs {
        scan_todo_font_dir(&dir, &mut seen, &mut fonts);
    }
    fonts.sort_by(|a, b| {
        a.label
            .to_lowercase()
            .cmp(&b.label.to_lowercase())
            .then_with(|| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()))
    });
    Ok(fonts)
}

pub fn clamp_todo_settings(mut settings: TodoSettings) -> TodoSettings {
    settings.theme_mode = normalize_todo_theme_mode(settings.theme_mode);
    settings.color_themes = normalize_todo_color_themes(settings.color_themes);
    settings.color_theme = normalize_todo_color_theme(settings.color_theme, &settings.color_themes);
    settings.font_family = normalize_todo_font_family(settings.font_family);
    settings.accent_color = normalize_todo_accent_color(settings.accent_color);
    settings.checkbox_shape = normalize_todo_checkbox_shape(settings.checkbox_shape);
    settings.idle_paper_light_effect =
        normalize_todo_idle_light_effect(settings.idle_paper_light_effect);
    settings.web_dav_url = settings.web_dav_url.trim().to_string();
    settings.web_dav_username = settings.web_dav_username.trim().to_string();
    settings.web_dav_path = normalize_web_dav_path(settings.web_dav_path);
    settings.day_start_hour = settings.day_start_hour.clamp(0, 22);
    settings.day_end_hour = settings.day_end_hour.clamp(1, 23);
    if settings.day_end_hour <= settings.day_start_hour {
        settings.day_end_hour = (settings.day_start_hour + 1).min(23);
    }
    settings.first_day = settings.first_day.clamp(0, 6);
    settings.time_zones = normalize_todo_time_zones(settings.time_zones);
    settings.shortcuts = normalize_todo_shortcuts(settings.shortcuts);
    settings
}

fn save_todo_settings_inner(settings: &TodoSettings) -> CmdResult<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| format!("serialize: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("write todo/settings.json: {}", e))?;
    Ok(())
}

fn load_legacy_todo_settings() -> Option<TodoSettings> {
    let raw = fs::read_to_string(legacy_app_settings_path()).ok()?;
    let root = serde_json::from_str::<Value>(&raw).ok()?;
    let todo = root.get("todo")?.clone();
    serde_json::from_value::<TodoSettings>(todo)
        .ok()
        .map(clamp_todo_settings)
}

fn normalize_todo_time_zones(time_zones: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for time_zone in time_zones {
        let trimmed = time_zone.trim();
        if trimmed.is_empty() || out.iter().any(|entry| entry == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
        if out.len() >= 5 {
            break;
        }
    }
    out
}

fn normalize_todo_shortcuts(shortcuts: TodoShortcuts) -> TodoShortcuts {
    TodoShortcuts {
        undo: normalize_todo_shortcut(shortcuts.undo, "Control+Z"),
        redo: normalize_todo_shortcut(shortcuts.redo, "Control+Shift+Z"),
        delete: normalize_todo_shortcut(shortcuts.delete, "Delete"),
        create_task: normalize_todo_shortcut(shortcuts.create_task, "Control+N"),
        create_child: normalize_todo_shortcut(shortcuts.create_child, "Control+Enter"),
        complete: normalize_todo_shortcut(shortcuts.complete, "Control+M"),
        search: normalize_todo_shortcut(shortcuts.search, "Control+F"),
    }
}

fn normalize_todo_shortcut(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() > 80 {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_todo_theme_mode(theme_mode: String) -> String {
    match theme_mode.trim() {
        "light" => "light".to_string(),
        "dark" => "dark".to_string(),
        _ => "system".to_string(),
    }
}

fn normalize_todo_color_theme(color_theme: String, custom_themes: &[TodoColorTheme]) -> String {
    let trimmed = color_theme.trim();
    if is_builtin_todo_color_theme_id(trimmed)
        || custom_themes.iter().any(|theme| theme.id == trimmed)
    {
        trimmed.to_string()
    } else {
        "default".to_string()
    }
}

fn normalize_todo_color_themes(color_themes: Vec<TodoColorTheme>) -> Vec<TodoColorTheme> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for theme in color_themes {
        let Some(theme) = normalize_todo_color_theme_entry(theme) else {
            continue;
        };
        if !seen.insert(theme.id.clone()) {
            continue;
        }
        out.push(theme);
        if out.len() >= 32 {
            break;
        }
    }
    out
}

fn normalize_todo_color_theme_entry(theme: TodoColorTheme) -> Option<TodoColorTheme> {
    let id = theme.id.trim();
    if !is_valid_todo_color_theme_id(id) {
        return None;
    }
    Some(TodoColorTheme {
        id: id.to_string(),
        label: normalize_todo_color_theme_label(theme.label),
        panel: normalize_todo_panel_value(theme.panel, "#f9f9f9"),
        middle: normalize_todo_hex_color(theme.middle, "#ffffff"),
        content: normalize_todo_hex_color(theme.content, "#ffffff"),
        surface: normalize_todo_hex_color(theme.surface, "#f8fafc"),
        accent: normalize_todo_hex_color(theme.accent, "#2563eb"),
    })
}

fn is_builtin_todo_color_theme_id(id: &str) -> bool {
    matches!(
        id,
        "default"
            | "taoyao"
            | "qinglan"
            | "songshi"
            | "miqing"
            | "jianjia"
            | "xinghuang"
            | "mushanzi"
            | "chenxiang"
            | "macaron"
            | "mintsoda"
            | "peachoolong"
    )
}

fn is_valid_todo_color_theme_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && id
            .chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
}

fn normalize_todo_color_theme_label(label: String) -> String {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        "Custom".to_string()
    } else {
        trimmed.chars().take(40).collect()
    }
}

fn normalize_todo_panel_value(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if is_valid_todo_hex_color(trimmed) || is_safe_todo_linear_gradient(trimmed) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

fn normalize_todo_hex_color(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if is_valid_todo_hex_color(trimmed) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

fn is_valid_todo_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.chars().skip(1).all(|c| c.is_ascii_hexdigit())
}

fn is_safe_todo_linear_gradient(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value.len() <= 180
        && lower.starts_with("linear-gradient(")
        && value.ends_with(')')
        && !value.contains(';')
        && !value.contains('{')
        && !value.contains('}')
        && !value.contains('\0')
}

fn normalize_todo_font_family(font_family: String) -> String {
    let trimmed = font_family.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.len() > 240
    {
        return String::new();
    }
    let path = Path::new(trimmed);
    if path.file_name().and_then(|name| name.to_str()) != Some(trimmed) {
        return String::new();
    }
    if is_supported_font_path(path) {
        trimmed.to_string()
    } else {
        String::new()
    }
}

fn normalize_todo_accent_color(accent_color: String) -> String {
    let trimmed = accent_color.trim();
    let valid = trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed.chars().skip(1).all(|c| c.is_ascii_hexdigit());
    if valid {
        trimmed.to_string()
    } else {
        "#2563eb".to_string()
    }
}

fn normalize_todo_checkbox_shape(checkbox_shape: String) -> String {
    match checkbox_shape.trim() {
        "circle" => "circle".to_string(),
        _ => "square".to_string(),
    }
}

fn normalize_todo_idle_light_effect(effect: String) -> String {
    match effect.trim() {
        "leaves" => "leaves".to_string(),
        "rain" => "rain".to_string(),
        _ => "random".to_string(),
    }
}

fn normalize_web_dav_path(path: String) -> String {
    let trimmed = path.trim().trim_start_matches('/').to_string();
    if trimmed.is_empty() || trimmed == "todos.json" {
        "todo-backups".to_string()
    } else {
        trimmed
    }
}

fn scan_todo_font_dir(dir: &Path, seen: &mut HashSet<String>, fonts: &mut Vec<TodoFontEntry>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_supported_font_path(&path) {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let dedupe_key = file_name.to_lowercase();
        if !seen.insert(dedupe_key) {
            continue;
        }
        let label = path
            .file_stem()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(file_name)
            .to_string();
        fonts.push(TodoFontEntry {
            id: file_name.to_string(),
            label,
            file_name: file_name.to_string(),
            path: path.to_string_lossy().replace('\\', "/"),
        });
    }
}

fn is_supported_font_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SUPPORTED_FONT_EXTENSIONS
                .iter()
                .any(|allowed| ext.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false)
}
