// Todo list persistence for the search-launcher `!` panel.
//
// On-disk database: `app_cache/todo/todos.sqlite`. Frontend still owns the
// todo mutation model and sends whole `TodoData` snapshots, while the backend
// stores them in normalized SQLite tables. The legacy `todos.json` file is
// kept as an import/export interchange format and is imported once on first
// SQLite startup when the database is empty.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use chrono::{
    Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Timelike,
};
use jieba_rs::{Jieba, TokenizeMode};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteRow, SqliteSynchronous,
};
use sqlx::{Row, SqlitePool};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::OnceCell;

use crate::commands::app::resolve_base_dir;
use crate::commands::taskbar::apply_window_app_id;
use crate::error::CmdResult;

const TODOS_FILE: &str = "app_cache/todo/todos.json";
const TODOS_DB_FILE: &str = "app_cache/todo/todos.sqlite";
const TODO_BACKUPS_DIR: &str = "app_cache/todo/backups";
const TOMATO_FILE: &str = "app_cache/todo/Tomato.json";
const TODO_ASSETS_DIR: &str = "app_cache/todo/assets";
const TODO_ICON_REL: &str = "icon/todo.ico";
const WINDOW_LABEL: &str = "todo";
const WINDOW_TITLE: &str = "Todo";
const WINDOW_APP_ID: &str = "com.barrychen.aebox-lite.todo";
const WIDGET_WINDOW_LABEL: &str = "todo-widget";
const WIDGET_WINDOW_TITLE: &str = "Todo Widget";
const WIDGET_WINDOW_APP_ID: &str = "com.barrychen.aebox-lite.todo.widget";
const ORDER_STEP: f64 = 1024.0;
const DEFAULT_LIST_NAME: &str = "默认";
const DEFAULT_LIST_EMOJI: &str = "📋";
const INBOX_LIST_NAME: &str = "收集箱";
const INBOX_LIST_EMOJI: &str = "📥";
const EVENT_TODO_DATA_CHANGED: &str = "todo:data-changed";
const TODO_META_VERSION: &str = "version";
const TODO_META_DEFAULT_LIST_ID: &str = "default_list_id";
const TODO_META_LEGACY_JSON_IMPORTED: &str = "legacy_json_imported";
const TOMATO_META_VERSION: &str = "tomato_version";
const TOMATO_META_LEGACY_JSON_IMPORTED: &str = "tomato_legacy_json_imported";

static TODO_DB_POOL: OnceCell<SqlitePool> = OnceCell::const_new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoDataChangedPayload {
    source: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoBackupEntry {
    pub id: String,
    pub file_name: String,
    pub created_at: i64,
    pub size: u64,
    pub source: String,
}

impl Default for TodoBackupEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            file_name: String::new(),
            created_at: 0,
            size: 0,
            source: "local".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoAssetFile {
    pub file_name: String,
    pub data_base64: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoTimeSpan {
    pub start: usize,
    pub end: usize,
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoTimeParseResult {
    pub due_at: Option<i64>,
    pub due_end_at: Option<i64>,
    pub reminder_enabled: bool,
    pub label: Option<String>,
    pub cleaned_text: String,
    pub spans: Vec<TodoTimeSpan>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TodoStatus {
    Pending,
    Completed,
    Abandoned,
}

impl Default for TodoStatus {
    fn default() -> Self {
        TodoStatus::Pending
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TodoPriority {
    ImportantUrgent,
    ImportantNotUrgent,
    NotImportantUrgent,
    NotImportantNotUrgent,
}

impl Default for TodoPriority {
    fn default() -> Self {
        TodoPriority::NotImportantNotUrgent
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoList {
    pub id: String,
    pub name: String,
    pub emoji: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    pub order: f64,
    pub created_at: i64,
    pub archived_at: Option<i64>,
}

impl Default for TodoList {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            emoji: String::new(),
            folder_id: None,
            order: 0.0,
            created_at: 0,
            archived_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoFolder {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub order: f64,
    pub created_at: i64,
}

impl Default for TodoFolder {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            emoji: String::new(),
            order: 0.0,
            created_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoGroup {
    pub id: String,
    pub list_id: String,
    pub name: String,
    pub order: f64,
    pub created_at: i64,
}

impl Default for TodoGroup {
    fn default() -> Self {
        Self {
            id: String::new(),
            list_id: String::new(),
            name: String::new(),
            order: 0.0,
            created_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub list_id: String,
    pub content: String,
    pub status: TodoStatus,
    pub due_at: Option<i64>,
    #[serde(default)]
    pub due_end_at: Option<i64>,
    #[serde(default)]
    pub reminder_enabled: bool,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub predecessor_id: Option<String>,
    pub marked: bool,
    pub order: f64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub completed_at: Option<i64>,
    // Rich-text note rendered in the third (detail) column. Stored as
    // sanitized HTML produced by the contenteditable editor. Empty
    // string when the user hasn't written anything.
    #[serde(default)]
    pub note: String,
    // Soft-delete timestamp. Items with `deleted_at != None` live in the
    // trash and are purged 30 days after deletion on next hydrate.
    #[serde(default)]
    pub deleted_at: Option<i64>,
    // Free-form tags. Backwards-compatible: missing in older saves.
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub priority: Option<TodoPriority>,
    #[serde(default)]
    pub progress: u8,
}

impl Default for TodoItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            list_id: String::new(),
            content: String::new(),
            status: TodoStatus::Pending,
            due_at: None,
            due_end_at: None,
            reminder_enabled: false,
            parent_id: None,
            group_id: None,
            predecessor_id: None,
            marked: false,
            order: 0.0,
            created_at: 0,
            updated_at: 0,
            completed_at: None,
            note: String::new(),
            deleted_at: None,
            tags: Vec::new(),
            priority: None,
            progress: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AdvancedTodoFilter {
    pub list_id: String,
    pub keyword: String,
    pub time: String,
    pub time_range_start: Option<i64>,
    pub time_range_end: Option<i64>,
    pub priority: String,
    pub tag: String,
    pub marked: String,
    pub status: String,
    pub logic: String,
}

impl Default for AdvancedTodoFilter {
    fn default() -> Self {
        Self {
            list_id: "all".to_string(),
            keyword: String::new(),
            time: "all".to_string(),
            time_range_start: None,
            time_range_end: None,
            priority: "all".to_string(),
            tag: "all".to_string(),
            marked: "all".to_string(),
            status: "all".to_string(),
            logic: "and".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SavedTodoFilter {
    pub id: String,
    pub name: String,
    pub criteria: AdvancedTodoFilter,
    pub order: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for SavedTodoFilter {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            criteria: AdvancedTodoFilter::default(),
            order: 0.0,
            created_at: 0,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoData {
    pub version: u32,
    pub folders: Vec<TodoFolder>,
    pub lists: Vec<TodoList>,
    pub groups: Vec<TodoGroup>,
    pub items: Vec<TodoItem>,
    pub custom_filters: Vec<SavedTodoFilter>,
    // ID of the list that's used as the default destination for tasks
    // created from the search-launcher's `today` quick-add. Null/empty
    // when the user hasn't pinned one.
    pub default_list_id: Option<String>,
}

impl Default for TodoData {
    fn default() -> Self {
        Self {
            version: 2,
            folders: Vec::new(),
            lists: Vec::new(),
            groups: Vec::new(),
            items: Vec::new(),
            custom_filters: Vec::new(),
            default_list_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TomatoTimerState {
    pub mode: String,
    pub duration_minutes: u32,
    pub running: bool,
    pub base_elapsed_ms: i64,
    pub run_started_at: Option<i64>,
    pub session_started_at: Option<i64>,
    pub active_item_id: Option<String>,
    pub completion_notified_at: Option<i64>,
}

impl Default for TomatoTimerState {
    fn default() -> Self {
        Self {
            mode: "pomodoro".to_string(),
            duration_minutes: 25,
            running: false,
            base_elapsed_ms: 0,
            run_started_at: None,
            session_started_at: None,
            active_item_id: None,
            completion_notified_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TomatoSession {
    pub id: String,
    pub item_id: Option<String>,
    pub item_title: String,
    pub mode: String,
    pub start_at: i64,
    pub end_at: i64,
    pub duration_ms: i64,
}

impl Default for TomatoSession {
    fn default() -> Self {
        Self {
            id: String::new(),
            item_id: None,
            item_title: String::new(),
            mode: "pomodoro".to_string(),
            start_at: 0,
            end_at: 0,
            duration_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TomatoData {
    pub version: u32,
    pub timer_state: Option<TomatoTimerState>,
    pub sessions: Vec<TomatoSession>,
}

impl Default for TomatoData {
    fn default() -> Self {
        Self {
            version: 1,
            timer_state: None,
            sessions: Vec::new(),
        }
    }
}

fn todos_path() -> PathBuf {
    resolve_base_dir().join(TODOS_FILE)
}

fn todos_db_path() -> PathBuf {
    resolve_base_dir().join(TODOS_DB_FILE)
}

fn todo_backups_dir() -> PathBuf {
    resolve_base_dir().join(TODO_BACKUPS_DIR)
}

fn tomato_path() -> PathBuf {
    resolve_base_dir().join(TOMATO_FILE)
}

pub(crate) fn todo_assets_dir() -> PathBuf {
    resolve_base_dir().join(TODO_ASSETS_DIR)
}

pub(crate) fn todo_icon_path(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = vec![resolve_base_dir().join(TODO_ICON_REL)];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(TODO_ICON_REL));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(windows)]
fn apply_todo_taskbar_icon(window: &tauri::WebviewWindow, icon_path: &Path) -> CmdResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, ICON_SMALL2, IMAGE_ICON,
        LR_DEFAULTSIZE, LR_LOADFROMFILE, SM_CXICON, SM_CXSMICON, SM_CYICON, SM_CYSMICON,
        WM_SETICON,
    };

    let hwnd = {
        let raw = window.hwnd().map_err(|e| e.to_string())?.0;
        windows::Win32::Foundation::HWND(raw)
    };
    let wide_path: Vec<u16> = icon_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let name = PCWSTR::from_raw(wide_path.as_ptr());

    unsafe {
        let big_icon = LoadImageW(
            None,
            name,
            IMAGE_ICON,
            GetSystemMetrics(SM_CXICON),
            GetSystemMetrics(SM_CYICON),
            LR_DEFAULTSIZE | LR_LOADFROMFILE,
        )
        .map_err(|e| format!("load todo taskbar icon: {}", e))?;
        let small_icon = LoadImageW(
            None,
            name,
            IMAGE_ICON,
            GetSystemMetrics(SM_CXSMICON),
            GetSystemMetrics(SM_CYSMICON),
            LR_DEFAULTSIZE | LR_LOADFROMFILE,
        )
        .map_err(|e| format!("load todo small icon: {}", e))?;

        let big_lparam = LPARAM(big_icon.0 as isize);
        let small_lparam = LPARAM(small_icon.0 as isize);
        SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_BIG as usize), big_lparam);
        SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_SMALL as usize), small_lparam);
        SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_SMALL2 as usize), small_lparam);
    }

    Ok(())
}

#[cfg(not(windows))]
fn apply_todo_taskbar_icon(_window: &tauri::WebviewWindow, _icon_path: &Path) -> CmdResult<()> {
    Ok(())
}

pub(crate) fn sanitize_asset_file_name(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("invalid asset file name".into());
    }
    let name = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "invalid asset file name".to_string())?;
    if name != trimmed || name == "." || name == ".." {
        return Err("invalid asset file name".into());
    }
    Ok(name.to_string())
}

pub(crate) fn todo_asset_mime_type(file_name: &str) -> &'static str {
    match Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

static TODO_TIME_JIEBA: Lazy<Jieba> = Lazy::new(Jieba::new);
static TODO_RELATIVE_DURATION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?P<num>\d+|[一二两三四五六七八九十]{1,3})\s*(?P<unit>分钟|分|小时|钟头|天|周|星期|礼拜)\s*(?:后|以后|之后)")
        .expect("valid todo relative duration regex")
});
static TODO_ABSOLUTE_DATE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?x)
        (?:(?P<year>\d{4})\s*(?:年|[./-])\s*)?
        (?P<month>1[0-2]|0?[1-9])\s*(?:月|[./-])\s*
        (?P<day>3[01]|[12]\d|0?[1-9])\s*(?:日|号)?
        ",
    )
    .expect("valid todo absolute date regex")
});
static TODO_WEEKDAY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?P<prefix>下下周|下周|本周|这周|下下星期|下星期|本星期|这个星期|下下礼拜|下礼拜|本礼拜|这个礼拜)?(?P<weekday>周[一二三四五六日天1-7]|星期[一二三四五六日天1-7]|礼拜[一二三四五六日天1-7])")
        .expect("valid todo weekday regex")
});
static TODO_RELATIVE_DAY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"今天上午|今天下午|今天晚上|今上午|今下午|今晚上|今早|今晚|明天上午|明天下午|明天晚上|明早|明晚|大后天|后天|明天|今天")
        .expect("valid todo relative day regex")
});
static TODO_TIME_OF_DAY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?P<period>凌晨|早上|上午|中午|下午|晚上|今晚|傍晚|夜里|夜间)?\s*(?P<hour>[01]?\d|2[0-3])(?:(?:[:：](?P<minute>[0-5]\d))|(?:点(?P<half>半)?(?:(?P<minute_cn>[0-5]?\d)分?)?))")
        .expect("valid todo time-of-day regex")
});
static TODO_REMINDER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"提醒我|提醒|闹钟|通知|记得").expect("valid todo reminder regex"));

#[derive(Debug, Clone)]
struct TodoByteSpan {
    start: usize,
    end: usize,
    kind: &'static str,
}

#[derive(Debug, Clone)]
struct TodoDateCandidate {
    date: NaiveDate,
    span: TodoByteSpan,
}

#[derive(Debug, Clone)]
struct TodoTimeOfDayCandidate {
    hour: u32,
    minute: u32,
    span: TodoByteSpan,
}

fn byte_to_char_idx(text: &str, byte_idx: usize) -> usize {
    let capped = byte_idx.min(text.len());
    text.char_indices()
        .take_while(|(idx, _)| *idx < capped)
        .count()
}

fn char_to_byte_idx(text: &str, char_idx: usize) -> usize {
    text.char_indices()
        .nth(char_idx)
        .map(|(idx, _)| idx)
        .unwrap_or(text.len())
}

fn token_span(text: &str, start: usize, end: usize, kind: &'static str) -> TodoByteSpan {
    TodoByteSpan {
        start: char_to_byte_idx(text, start),
        end: char_to_byte_idx(text, end),
        kind,
    }
}

fn todo_span_from_byte(text: &str, span: &TodoByteSpan) -> TodoTimeSpan {
    let start = span.start.min(text.len());
    let end = span.end.min(text.len());
    let start = if text.is_char_boundary(start) {
        start
    } else {
        text.char_indices()
            .map(|(idx, _)| idx)
            .take_while(|idx| *idx < start)
            .last()
            .unwrap_or(0)
    };
    let end = if text.is_char_boundary(end) {
        end
    } else {
        text.char_indices()
            .map(|(idx, _)| idx)
            .find(|idx| *idx > end)
            .unwrap_or(text.len())
    };
    TodoTimeSpan {
        start: byte_to_char_idx(text, start),
        end: byte_to_char_idx(text, end),
        kind: span.kind.to_string(),
        text: text[start..end].to_string(),
    }
}

fn normalize_byte_spans(mut spans: Vec<TodoByteSpan>) -> Vec<TodoByteSpan> {
    spans.retain(|span| span.start < span.end);
    spans.sort_by(|a, b| a.start.cmp(&b.start).then(a.end.cmp(&b.end)));

    let mut out: Vec<TodoByteSpan> = Vec::new();
    for span in spans {
        if let Some(last) = out.last_mut() {
            if last.end >= span.start && last.kind != "reminder" && span.kind != "reminder" {
                last.end = last.end.max(span.end);
                if span.kind == "time" || last.kind == "time" {
                    last.kind = "time";
                } else if span.kind == "duration" || last.kind == "duration" {
                    last.kind = "duration";
                }
                continue;
            }
        }
        out.push(span);
    }
    out
}

fn cleaned_todo_text(text: &str, spans: &[TodoTimeSpan]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut remove = vec![false; chars.len()];
    for span in spans {
        if span.kind == "reminder" {
            continue;
        }
        let start = span.start.min(chars.len());
        let end = span.end.min(chars.len());
        for idx in start..end {
            remove[idx] = true;
        }
    }

    let cleaned: String = chars
        .into_iter()
        .enumerate()
        .filter_map(|(idx, ch)| if remove[idx] { None } else { Some(ch) })
        .collect();

    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|ch: char| {
            ch.is_whitespace()
                || matches!(ch, ',' | '，' | '.' | '。' | ';' | '；' | ':' | '：' | '、')
        })
        .to_string()
}

fn chinese_digit(ch: char) -> Option<i64> {
    match ch {
        '一' => Some(1),
        '二' => Some(2),
        '三' => Some(3),
        '四' => Some(4),
        '五' => Some(5),
        '六' => Some(6),
        '七' => Some(7),
        '八' => Some(8),
        '九' => Some(9),
        _ => None,
    }
}

fn parse_small_number(raw: &str) -> Option<i64> {
    if let Ok(value) = raw.parse::<i64>() {
        return Some(value);
    }

    let normalized = raw.replace('两', "二");
    if normalized == "十" {
        return Some(10);
    }

    if let Some((left, right)) = normalized.split_once('十') {
        let tens = if left.is_empty() {
            1
        } else {
            chinese_digit(left.chars().next()?)?
        };
        let ones = if right.is_empty() {
            0
        } else {
            chinese_digit(right.chars().next()?)?
        };
        return Some(tens * 10 + ones);
    }

    if normalized.chars().count() == 1 {
        return chinese_digit(normalized.chars().next()?);
    }

    None
}

fn local_ms(date: NaiveDate, hour: u32, minute: u32) -> Option<i64> {
    let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
    let naive = NaiveDateTime::new(date, time);
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(dt) => Some(dt.timestamp_millis()),
        LocalResult::Ambiguous(first, _) => Some(first.timestamp_millis()),
        LocalResult::None => None,
    }
}

fn local_from_ms(now_ms: Option<i64>) -> chrono::DateTime<Local> {
    now_ms
        .and_then(|ms| Local.timestamp_millis_opt(ms).single())
        .unwrap_or_else(Local::now)
}

fn find_relative_duration(text: &str, now: chrono::DateTime<Local>) -> Option<(i64, TodoByteSpan)> {
    let caps = TODO_RELATIVE_DURATION_RE.captures(text)?;
    let matched = caps.get(0)?;
    let num = parse_small_number(caps.name("num")?.as_str())?;
    let unit = caps.name("unit")?.as_str();
    let duration = match unit {
        "分钟" | "分" => Duration::minutes(num),
        "小时" | "钟头" => Duration::hours(num),
        "天" => Duration::days(num),
        "周" | "星期" | "礼拜" => Duration::weeks(num),
        _ => return None,
    };
    let due = (now + duration)
        .with_second(0)
        .and_then(|dt| dt.with_nanosecond(0))
        .unwrap_or(now + duration);
    Some((
        due.timestamp_millis(),
        TodoByteSpan {
            start: matched.start(),
            end: matched.end(),
            kind: "duration",
        },
    ))
}

fn relative_day_offset(word: &str) -> Option<i64> {
    if word.contains("大后天") {
        Some(3)
    } else if word.contains("后天") {
        Some(2)
    } else if word.contains('明') {
        Some(1)
    } else if word.contains('今') {
        Some(0)
    } else {
        None
    }
}

fn find_relative_day(text: &str, today: NaiveDate) -> Option<TodoDateCandidate> {
    for token in TODO_TIME_JIEBA.tokenize(text, TokenizeMode::Default, true) {
        if let Some(offset) = relative_day_offset(token.word) {
            return Some(TodoDateCandidate {
                date: today + Duration::days(offset),
                span: token_span(text, token.start, token.end, "date"),
            });
        }
    }

    let matched = TODO_RELATIVE_DAY_RE.find(text)?;
    let offset = relative_day_offset(matched.as_str())?;
    Some(TodoDateCandidate {
        date: today + Duration::days(offset),
        span: TodoByteSpan {
            start: matched.start(),
            end: matched.end(),
            kind: "date",
        },
    })
}

fn find_absolute_date(text: &str, today: NaiveDate) -> Option<TodoDateCandidate> {
    let caps = TODO_ABSOLUTE_DATE_RE.captures(text)?;
    let matched = caps.get(0)?;
    let month: u32 = caps.name("month")?.as_str().parse().ok()?;
    let day: u32 = caps.name("day")?.as_str().parse().ok()?;
    let mut year: i32 = caps
        .name("year")
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or_else(|| today.year());
    let mut date = NaiveDate::from_ymd_opt(year, month, day)?;
    if caps.name("year").is_none() && date < today {
        year += 1;
        date = NaiveDate::from_ymd_opt(year, month, day)?;
    }
    Some(TodoDateCandidate {
        date,
        span: TodoByteSpan {
            start: matched.start(),
            end: matched.end(),
            kind: "date",
        },
    })
}

fn weekday_index(raw: &str) -> Option<i64> {
    let ch = raw.chars().last()?;
    match ch {
        '一' | '1' => Some(0),
        '二' | '2' => Some(1),
        '三' | '3' => Some(2),
        '四' | '4' => Some(3),
        '五' | '5' => Some(4),
        '六' | '6' => Some(5),
        '日' | '天' | '7' => Some(6),
        _ => None,
    }
}

fn find_weekday_date(text: &str, today: NaiveDate) -> Option<TodoDateCandidate> {
    let caps = TODO_WEEKDAY_RE.captures(text)?;
    let matched = caps.get(0)?;
    let weekday = weekday_index(caps.name("weekday")?.as_str())?;
    let prefix = caps.name("prefix").map(|m| m.as_str()).unwrap_or("");
    let week_offset = if prefix.starts_with("下下") {
        2
    } else if prefix.starts_with('下') {
        1
    } else {
        0
    };
    let week_start = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    let mut date = week_start + Duration::days(week_offset * 7 + weekday);
    if prefix.is_empty() && date < today {
        date += Duration::weeks(1);
    }
    Some(TodoDateCandidate {
        date,
        span: TodoByteSpan {
            start: matched.start(),
            end: matched.end(),
            kind: "date",
        },
    })
}

fn find_date_candidate(text: &str, today: NaiveDate) -> Option<TodoDateCandidate> {
    let mut candidates = [
        find_relative_day(text, today),
        find_weekday_date(text, today),
        find_absolute_date(text, today),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    candidates.sort_by(|a, b| {
        a.span
            .start
            .cmp(&b.span.start)
            .then(a.span.end.cmp(&b.span.end))
    });
    candidates.into_iter().next()
}

fn find_time_of_day(text: &str) -> Option<TodoTimeOfDayCandidate> {
    let caps = TODO_TIME_OF_DAY_RE.captures(text)?;
    let matched = caps.get(0)?;
    let mut hour: u32 = caps.name("hour")?.as_str().parse().ok()?;
    let minute: u32 = if caps.name("half").is_some() {
        30
    } else if let Some(minute) = caps.name("minute") {
        minute.as_str().parse().ok()?
    } else if let Some(minute) = caps.name("minute_cn") {
        minute.as_str().parse().ok()?
    } else {
        0
    };
    let period = caps.name("period").map(|m| m.as_str()).unwrap_or("");
    if matches!(period, "下午" | "晚上" | "今晚" | "傍晚" | "夜里" | "夜间") && hour < 12
    {
        hour += 12;
    }
    if period == "中午" && hour < 11 {
        hour += 12;
    }
    if period == "凌晨" && hour == 12 {
        hour = 0;
    }
    Some(TodoTimeOfDayCandidate {
        hour,
        minute,
        span: TodoByteSpan {
            start: matched.start(),
            end: matched.end(),
            kind: "time",
        },
    })
}

fn default_time_for_text(text: &str) -> (u32, u32) {
    if text.contains("凌晨") {
        (1, 0)
    } else if text.contains('早') || text.contains("上午") {
        (9, 0)
    } else if text.contains("中午") {
        (12, 0)
    } else if text.contains("下午") {
        (15, 0)
    } else if text.contains("晚上") || text.contains("今晚") || text.contains("傍晚") {
        (20, 0)
    } else {
        (9, 0)
    }
}

fn find_reminder_span(text: &str) -> Option<TodoByteSpan> {
    for token in TODO_TIME_JIEBA.tokenize(text, TokenizeMode::Default, true) {
        if matches!(token.word, "提醒" | "闹钟" | "通知" | "记得") {
            return Some(token_span(text, token.start, token.end, "reminder"));
        }
    }
    TODO_REMINDER_RE.find(text).map(|matched| TodoByteSpan {
        start: matched.start(),
        end: matched.end(),
        kind: "reminder",
    })
}

fn format_todo_time_label(due_at: i64, now: chrono::DateTime<Local>) -> String {
    let due = Local
        .timestamp_millis_opt(due_at)
        .single()
        .unwrap_or_else(Local::now);
    let today = now.date_naive();
    let date = due.date_naive();
    let time = format!("{:02}:{:02}", due.hour(), due.minute());
    if date == today {
        format!("今天 {}", time)
    } else if date == today + Duration::days(1) {
        format!("明天 {}", time)
    } else {
        format!("{}/{} {}", date.month(), date.day(), time)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn todo_status_to_db(status: TodoStatus) -> &'static str {
    match status {
        TodoStatus::Pending => "pending",
        TodoStatus::Completed => "completed",
        TodoStatus::Abandoned => "abandoned",
    }
}

fn todo_status_from_db(raw: &str) -> TodoStatus {
    match raw {
        "completed" => TodoStatus::Completed,
        "abandoned" => TodoStatus::Abandoned,
        _ => TodoStatus::Pending,
    }
}

fn todo_priority_to_db(priority: Option<TodoPriority>) -> &'static str {
    match priority {
        Some(TodoPriority::ImportantUrgent) => "importantUrgent",
        Some(TodoPriority::ImportantNotUrgent) => "importantNotUrgent",
        Some(TodoPriority::NotImportantUrgent) => "notImportantUrgent",
        Some(TodoPriority::NotImportantNotUrgent) => "notImportantNotUrgent",
        None => "",
    }
}

fn todo_priority_from_db(raw: &str) -> Option<TodoPriority> {
    match raw {
        "importantUrgent" => Some(TodoPriority::ImportantUrgent),
        "importantNotUrgent" => Some(TodoPriority::ImportantNotUrgent),
        "notImportantUrgent" => Some(TodoPriority::NotImportantUrgent),
        "notImportantNotUrgent" => Some(TodoPriority::NotImportantNotUrgent),
        _ => None,
    }
}

fn bool_to_db(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn bool_from_db(value: i64) -> bool {
    value != 0
}

fn progress_from_db(value: i64) -> u8 {
    value.clamp(0, 100) as u8
}

async fn todo_db_pool() -> CmdResult<&'static SqlitePool> {
    let pool = TODO_DB_POOL
        .get_or_try_init(|| async {
            let path = todos_db_path();
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("mkdir todo db: {}", e))?;
            }
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Normal);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .map_err(|e| format!("open todo sqlite db: {}", e))?;
            init_todo_schema(&pool).await?;
            Ok::<SqlitePool, String>(pool)
        })
        .await?;
    import_legacy_todo_json_once(pool).await?;
    import_legacy_tomato_json_once(pool).await?;
    Ok(pool)
}

async fn init_todo_schema(pool: &SqlitePool) -> CmdResult<()> {
    const STATEMENTS: &[&str] = &[
        "PRAGMA foreign_keys = ON",
        "PRAGMA busy_timeout = 5000",
        "PRAGMA wal_autocheckpoint = 100",
        "PRAGMA journal_size_limit = 1048576",
        "CREATE TABLE IF NOT EXISTS todo_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS todo_folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            emoji TEXT NOT NULL,
            sort_order REAL NOT NULL,
            created_at INTEGER NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS todo_lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            emoji TEXT NOT NULL,
            folder_id TEXT NULL REFERENCES todo_folders(id) ON DELETE SET NULL,
            sort_order REAL NOT NULL,
            created_at INTEGER NOT NULL,
            archived_at INTEGER NULL
        )",
        "CREATE TABLE IF NOT EXISTS todo_groups (
            id TEXT PRIMARY KEY,
            list_id TEXT NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            sort_order REAL NOT NULL,
            created_at INTEGER NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS todo_items (
            id TEXT PRIMARY KEY,
            list_id TEXT NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            status TEXT NOT NULL,
            due_at INTEGER NULL,
            due_end_at INTEGER NULL,
            reminder_enabled INTEGER NOT NULL,
            parent_id TEXT NULL,
            group_id TEXT NULL REFERENCES todo_groups(id) ON DELETE SET NULL,
            predecessor_id TEXT NULL,
            marked INTEGER NOT NULL,
            sort_order REAL NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER NULL,
            note TEXT NOT NULL,
            deleted_at INTEGER NULL,
            priority TEXT NOT NULL,
            progress INTEGER NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS todo_item_tags (
            item_id TEXT NOT NULL REFERENCES todo_items(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (item_id, tag)
        )",
        "CREATE TABLE IF NOT EXISTS todo_custom_filters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            criteria_json TEXT NOT NULL,
            sort_order REAL NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS tomato_timer_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            mode TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            running INTEGER NOT NULL,
            base_elapsed_ms INTEGER NOT NULL,
            run_started_at INTEGER NULL,
            session_started_at INTEGER NULL,
            active_item_id TEXT NULL,
            completion_notified_at INTEGER NULL
        )",
        "CREATE TABLE IF NOT EXISTS tomato_sessions (
            id TEXT PRIMARY KEY,
            item_id TEXT NULL,
            item_title TEXT NOT NULL,
            mode TEXT NOT NULL,
            start_at INTEGER NOT NULL,
            end_at INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            position INTEGER NOT NULL
        )",
        "CREATE INDEX IF NOT EXISTS idx_todo_lists_folder ON todo_lists(folder_id)",
        "CREATE INDEX IF NOT EXISTS idx_todo_groups_list ON todo_groups(list_id)",
        "CREATE INDEX IF NOT EXISTS idx_todo_items_list_due ON todo_items(list_id, due_at)",
        "CREATE INDEX IF NOT EXISTS idx_todo_items_parent ON todo_items(parent_id)",
        "CREATE INDEX IF NOT EXISTS idx_todo_item_tags_tag ON todo_item_tags(tag)",
        "CREATE INDEX IF NOT EXISTS idx_tomato_sessions_end_at ON tomato_sessions(end_at)",
    ];

    for statement in STATEMENTS {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|e| format!("init todo schema: {}", e))?;
    }
    ensure_todo_schema_migrations(pool).await?;
    Ok(())
}

async fn sqlite_table_has_column(pool: &SqlitePool, table: &str, column: &str) -> CmdResult<bool> {
    let rows = sqlx::query(&format!("PRAGMA table_info({})", table))
        .fetch_all(pool)
        .await
        .map_err(|e| format!("inspect sqlite table {}: {}", table, e))?;
    for row in rows {
        let name: String = row
            .try_get("name")
            .map_err(|e| format!("read sqlite column name for {}: {}", table, e))?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn ensure_todo_schema_migrations(pool: &SqlitePool) -> CmdResult<()> {
    if !sqlite_table_has_column(pool, "todo_items", "predecessor_id").await? {
        sqlx::query("ALTER TABLE todo_items ADD COLUMN predecessor_id TEXT NULL")
            .execute(pool)
            .await
            .map_err(|e| format!("add todo predecessor column: {}", e))?;
    }
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_todo_items_predecessor ON todo_items(predecessor_id)",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("init todo predecessor index: {}", e))?;
    Ok(())
}

async fn checkpoint_todo_wal(pool: &SqlitePool, source: &str) {
    match sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .fetch_one(pool)
        .await
    {
        Ok(row) => {
            let busy = row.try_get::<i64, _>(0).unwrap_or(0);
            if busy != 0 {
                let log = row.try_get::<i64, _>(1).unwrap_or(0);
                let checkpointed = row.try_get::<i64, _>(2).unwrap_or(0);
                eprintln!(
                    "[todo] sqlite WAL checkpoint busy after {}: busy={}, log={}, checkpointed={}",
                    source, busy, log, checkpointed
                );
            }
        }
        Err(err) => {
            eprintln!(
                "[todo] sqlite WAL checkpoint failed after {}: {}",
                source, err
            );
        }
    }
}

async fn import_legacy_todo_json_once(pool: &SqlitePool) -> CmdResult<()> {
    let imported: Option<String> = sqlx::query_scalar("SELECT value FROM todo_meta WHERE key = ?1")
        .bind(TODO_META_LEGACY_JSON_IMPORTED)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("read todo legacy migration marker: {}", e))?;
    if imported.is_some() {
        return Ok(());
    }

    let row = sqlx::query(
        "SELECT
            (SELECT COUNT(*) FROM todo_folders) +
            (SELECT COUNT(*) FROM todo_lists) +
            (SELECT COUNT(*) FROM todo_groups) +
            (SELECT COUNT(*) FROM todo_items) +
            (SELECT COUNT(*) FROM todo_custom_filters) AS count",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("count todo sqlite rows: {}", e))?;
    let count: i64 = row
        .try_get("count")
        .map_err(|e| format!("read todo sqlite row count: {}", e))?;

    let legacy_path = todos_path();
    if count == 0 && legacy_path.exists() {
        if let Ok(raw) = fs::read_to_string(&legacy_path) {
            let data: TodoData = serde_json::from_str(&raw).unwrap_or_default();
            save_todo_data_to_db(pool, &data).await?;
        }
    }

    sqlx::query(
        "INSERT INTO todo_meta (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(TODO_META_LEGACY_JSON_IMPORTED)
    .bind(now_ms().to_string())
    .execute(pool)
    .await
    .map_err(|e| format!("write todo legacy migration marker: {}", e))?;
    checkpoint_todo_wal(pool, "todo legacy import marker").await;
    Ok(())
}

async fn import_legacy_tomato_json_once(pool: &SqlitePool) -> CmdResult<()> {
    let imported: Option<String> = sqlx::query_scalar("SELECT value FROM todo_meta WHERE key = ?1")
        .bind(TOMATO_META_LEGACY_JSON_IMPORTED)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("read tomato legacy migration marker: {}", e))?;
    if imported.is_some() {
        return Ok(());
    }

    let row = sqlx::query(
        "SELECT
            (SELECT COUNT(*) FROM tomato_timer_state) +
            (SELECT COUNT(*) FROM tomato_sessions) AS count",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("count tomato sqlite rows: {}", e))?;
    let count: i64 = row
        .try_get("count")
        .map_err(|e| format!("read tomato sqlite row count: {}", e))?;

    let legacy_path = tomato_path();
    if count == 0 && legacy_path.exists() {
        if let Ok(raw) = fs::read_to_string(&legacy_path) {
            let data: TomatoData = serde_json::from_str(&raw).unwrap_or_default();
            save_tomato_data_to_db(pool, &data).await?;
        }
    }

    sqlx::query(
        "INSERT INTO todo_meta (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(TOMATO_META_LEGACY_JSON_IMPORTED)
    .bind(now_ms().to_string())
    .execute(pool)
    .await
    .map_err(|e| format!("write tomato legacy migration marker: {}", e))?;
    checkpoint_todo_wal(pool, "tomato legacy import marker").await;
    Ok(())
}

async fn load_todo_data_from_db(pool: &SqlitePool) -> CmdResult<TodoData> {
    let version: u32 =
        sqlx::query_scalar::<_, String>("SELECT value FROM todo_meta WHERE key = ?1")
            .bind(TODO_META_VERSION)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("read todo version: {}", e))?
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(2);
    let default_list_id: Option<String> =
        sqlx::query_scalar("SELECT value FROM todo_meta WHERE key = ?1")
            .bind(TODO_META_DEFAULT_LIST_ID)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("read todo default list: {}", e))?;

    let folders = sqlx::query_as::<_, (String, String, String, f64, i64)>(
        "SELECT id, name, emoji, sort_order, created_at
         FROM todo_folders
         ORDER BY sort_order, created_at, name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("read todo folders: {}", e))?
    .into_iter()
    .map(|(id, name, emoji, order, created_at)| TodoFolder {
        id,
        name,
        emoji,
        order,
        created_at,
    })
    .collect();

    let lists = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            Option<String>,
            f64,
            i64,
            Option<i64>,
        ),
    >(
        "SELECT id, name, emoji, folder_id, sort_order, created_at, archived_at
         FROM todo_lists
         ORDER BY sort_order, created_at, name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("read todo lists: {}", e))?
    .into_iter()
    .map(
        |(id, name, emoji, folder_id, order, created_at, archived_at)| TodoList {
            id,
            name,
            emoji,
            folder_id,
            order,
            created_at,
            archived_at,
        },
    )
    .collect();

    let groups = sqlx::query_as::<_, (String, String, String, f64, i64)>(
        "SELECT id, list_id, name, sort_order, created_at
         FROM todo_groups
         ORDER BY sort_order, created_at, name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("read todo groups: {}", e))?
    .into_iter()
    .map(|(id, list_id, name, order, created_at)| TodoGroup {
        id,
        list_id,
        name,
        order,
        created_at,
    })
    .collect();

    let mut tags_by_item: HashMap<String, Vec<String>> = HashMap::new();
    for (item_id, tag) in sqlx::query_as::<_, (String, String)>(
        "SELECT item_id, tag
         FROM todo_item_tags
         ORDER BY item_id, position, tag",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("read todo tags: {}", e))?
    {
        tags_by_item.entry(item_id).or_default().push(tag);
    }

    let item_rows = sqlx::query(
        "SELECT id, list_id, content, status, due_at, due_end_at, reminder_enabled,
                parent_id, group_id, marked, sort_order, created_at, updated_at,
                completed_at, note, deleted_at, priority, progress, predecessor_id
         FROM todo_items
         ORDER BY sort_order, created_at, content",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("read todo items: {}", e))?;
    let mut items = Vec::with_capacity(item_rows.len());
    for row in item_rows {
        let id: String = todo_row_value(&row, "id")?;
        let status_raw: String = todo_row_value(&row, "status")?;
        let priority_raw: String = todo_row_value(&row, "priority")?;
        let reminder_enabled: i64 = todo_row_value(&row, "reminder_enabled")?;
        let marked: i64 = todo_row_value(&row, "marked")?;
        let progress: i64 = todo_row_value(&row, "progress")?;
        let tags = tags_by_item.remove(&id).unwrap_or_default();
        items.push(TodoItem {
            id,
            list_id: todo_row_value(&row, "list_id")?,
            content: todo_row_value(&row, "content")?,
            status: todo_status_from_db(&status_raw),
            due_at: todo_row_value(&row, "due_at")?,
            due_end_at: todo_row_value(&row, "due_end_at")?,
            reminder_enabled: bool_from_db(reminder_enabled),
            parent_id: todo_row_value(&row, "parent_id")?,
            group_id: todo_row_value(&row, "group_id")?,
            predecessor_id: todo_row_value(&row, "predecessor_id")?,
            marked: bool_from_db(marked),
            order: todo_row_value(&row, "sort_order")?,
            created_at: todo_row_value(&row, "created_at")?,
            updated_at: todo_row_value(&row, "updated_at")?,
            completed_at: todo_row_value(&row, "completed_at")?,
            note: todo_row_value(&row, "note")?,
            deleted_at: todo_row_value(&row, "deleted_at")?,
            tags,
            priority: todo_priority_from_db(&priority_raw),
            progress: progress_from_db(progress),
        });
    }

    let custom_filters = sqlx::query_as::<_, (String, String, String, f64, i64, i64)>(
        "SELECT id, name, criteria_json, sort_order, created_at, updated_at
         FROM todo_custom_filters
         ORDER BY sort_order, created_at, name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("read todo custom filters: {}", e))?
    .into_iter()
    .map(
        |(id, name, criteria_json, order, created_at, updated_at)| SavedTodoFilter {
            id,
            name,
            criteria: serde_json::from_str(&criteria_json).unwrap_or_default(),
            order,
            created_at,
            updated_at,
        },
    )
    .collect();

    Ok(TodoData {
        version,
        folders,
        lists,
        groups,
        items,
        custom_filters,
        default_list_id,
    })
}

fn tomato_duration_from_db(value: i64) -> u32 {
    if value <= 0 {
        25
    } else {
        value.min(i64::from(u32::MAX)) as u32
    }
}

async fn load_tomato_data_from_db(pool: &SqlitePool) -> CmdResult<TomatoData> {
    let version: u32 =
        sqlx::query_scalar::<_, String>("SELECT value FROM todo_meta WHERE key = ?1")
            .bind(TOMATO_META_VERSION)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("read tomato version: {}", e))?
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(1);

    let timer_row = sqlx::query(
        "SELECT mode, duration_minutes, running, base_elapsed_ms, run_started_at,
                session_started_at, active_item_id, completion_notified_at
         FROM tomato_timer_state
         WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("read tomato timer state: {}", e))?;
    let timer_state = match timer_row {
        Some(row) => {
            let duration_minutes: i64 = todo_row_value(&row, "duration_minutes")?;
            let running: i64 = todo_row_value(&row, "running")?;
            Some(TomatoTimerState {
                mode: todo_row_value(&row, "mode")?,
                duration_minutes: tomato_duration_from_db(duration_minutes),
                running: bool_from_db(running),
                base_elapsed_ms: todo_row_value(&row, "base_elapsed_ms")?,
                run_started_at: todo_row_value(&row, "run_started_at")?,
                session_started_at: todo_row_value(&row, "session_started_at")?,
                active_item_id: todo_row_value(&row, "active_item_id")?,
                completion_notified_at: todo_row_value(&row, "completion_notified_at")?,
            })
        }
        None => None,
    };

    let sessions = sqlx::query(
        "SELECT id, item_id, item_title, mode, start_at, end_at, duration_ms
         FROM tomato_sessions
         ORDER BY position, end_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("read tomato sessions: {}", e))?
    .into_iter()
    .map(|row| {
        Ok(TomatoSession {
            id: todo_row_value(&row, "id")?,
            item_id: todo_row_value(&row, "item_id")?,
            item_title: todo_row_value(&row, "item_title")?,
            mode: todo_row_value(&row, "mode")?,
            start_at: todo_row_value(&row, "start_at")?,
            end_at: todo_row_value(&row, "end_at")?,
            duration_ms: todo_row_value(&row, "duration_ms")?,
        })
    })
    .collect::<CmdResult<Vec<_>>>()?;

    Ok(TomatoData {
        version,
        timer_state,
        sessions,
    })
}

fn todo_row_value<T>(row: &SqliteRow, column: &str) -> CmdResult<T>
where
    for<'r> T: sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    row.try_get(column)
        .map_err(|e| format!("read todo sqlite column {}: {}", column, e))
}

async fn save_todo_data_to_db(pool: &SqlitePool, data: &TodoData) -> CmdResult<()> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin todo sqlite transaction: {}", e))?;

    sqlx::query("DELETE FROM todo_item_tags")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear todo tags: {}", e))?;
    sqlx::query("DELETE FROM todo_custom_filters")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear todo custom filters: {}", e))?;
    sqlx::query("DELETE FROM todo_items")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear todo items: {}", e))?;
    sqlx::query("DELETE FROM todo_groups")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear todo groups: {}", e))?;
    sqlx::query("DELETE FROM todo_lists")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear todo lists: {}", e))?;
    sqlx::query("DELETE FROM todo_folders")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear todo folders: {}", e))?;

    sqlx::query(
        "INSERT INTO todo_meta (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(TODO_META_VERSION)
    .bind(data.version.to_string())
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("write todo version: {}", e))?;
    if let Some(default_list_id) = &data.default_list_id {
        sqlx::query(
            "INSERT INTO todo_meta (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(TODO_META_DEFAULT_LIST_ID)
        .bind(default_list_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("write todo default list: {}", e))?;
    } else {
        sqlx::query("DELETE FROM todo_meta WHERE key = ?1")
            .bind(TODO_META_DEFAULT_LIST_ID)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("clear todo default list: {}", e))?;
    }

    for folder in &data.folders {
        sqlx::query(
            "INSERT INTO todo_folders (id, name, emoji, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&folder.id)
        .bind(&folder.name)
        .bind(&folder.emoji)
        .bind(folder.order)
        .bind(folder.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert todo folder {}: {}", folder.id, e))?;
    }

    for list in &data.lists {
        sqlx::query(
            "INSERT INTO todo_lists
                (id, name, emoji, folder_id, sort_order, created_at, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&list.id)
        .bind(&list.name)
        .bind(&list.emoji)
        .bind(list.folder_id.as_deref())
        .bind(list.order)
        .bind(list.created_at)
        .bind(list.archived_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert todo list {}: {}", list.id, e))?;
    }

    for group in &data.groups {
        sqlx::query(
            "INSERT INTO todo_groups (id, list_id, name, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&group.id)
        .bind(&group.list_id)
        .bind(&group.name)
        .bind(group.order)
        .bind(group.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert todo group {}: {}", group.id, e))?;
    }

    for item in &data.items {
        sqlx::query(
            "INSERT INTO todo_items
                (id, list_id, content, status, due_at, due_end_at, reminder_enabled,
                 parent_id, group_id, marked, sort_order, created_at, updated_at,
                 completed_at, note, deleted_at, priority, progress, predecessor_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                     ?14, ?15, ?16, ?17, ?18, ?19)",
        )
        .bind(&item.id)
        .bind(&item.list_id)
        .bind(&item.content)
        .bind(todo_status_to_db(item.status))
        .bind(item.due_at)
        .bind(item.due_end_at)
        .bind(bool_to_db(item.reminder_enabled))
        .bind(item.parent_id.as_deref())
        .bind(item.group_id.as_deref())
        .bind(bool_to_db(item.marked))
        .bind(item.order)
        .bind(item.created_at)
        .bind(item.updated_at)
        .bind(item.completed_at)
        .bind(&item.note)
        .bind(item.deleted_at)
        .bind(todo_priority_to_db(item.priority))
        .bind(i64::from(item.progress))
        .bind(item.predecessor_id.as_deref())
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert todo item {}: {}", item.id, e))?;

        for (position, tag) in item.tags.iter().enumerate() {
            sqlx::query(
                "INSERT OR IGNORE INTO todo_item_tags (item_id, tag, position)
                 VALUES (?1, ?2, ?3)",
            )
            .bind(&item.id)
            .bind(tag)
            .bind(position as i64)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert todo tag for {}: {}", item.id, e))?;
        }
    }

    for filter in &data.custom_filters {
        let criteria_json = serde_json::to_string(&filter.criteria)
            .map_err(|e| format!("serialize todo custom filter {}: {}", filter.id, e))?;
        sqlx::query(
            "INSERT INTO todo_custom_filters
                (id, name, criteria_json, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&filter.id)
        .bind(&filter.name)
        .bind(criteria_json)
        .bind(filter.order)
        .bind(filter.created_at)
        .bind(filter.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert todo custom filter {}: {}", filter.id, e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit todo sqlite transaction: {}", e))?;
    checkpoint_todo_wal(pool, "todo save").await;
    Ok(())
}

async fn save_tomato_data_to_db(pool: &SqlitePool, data: &TomatoData) -> CmdResult<()> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin tomato sqlite transaction: {}", e))?;

    sqlx::query("DELETE FROM tomato_sessions")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear tomato sessions: {}", e))?;
    sqlx::query("DELETE FROM tomato_timer_state")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear tomato timer state: {}", e))?;

    sqlx::query(
        "INSERT INTO todo_meta (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(TOMATO_META_VERSION)
    .bind(data.version.to_string())
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("write tomato version: {}", e))?;

    if let Some(state) = &data.timer_state {
        sqlx::query(
            "INSERT INTO tomato_timer_state
                (id, mode, duration_minutes, running, base_elapsed_ms, run_started_at,
                 session_started_at, active_item_id, completion_notified_at)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&state.mode)
        .bind(i64::from(state.duration_minutes))
        .bind(bool_to_db(state.running))
        .bind(state.base_elapsed_ms)
        .bind(state.run_started_at)
        .bind(state.session_started_at)
        .bind(state.active_item_id.as_deref())
        .bind(state.completion_notified_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert tomato timer state: {}", e))?;
    }

    for (position, session) in data.sessions.iter().enumerate() {
        sqlx::query(
            "INSERT INTO tomato_sessions
                (id, item_id, item_title, mode, start_at, end_at, duration_ms, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&session.id)
        .bind(session.item_id.as_deref())
        .bind(&session.item_title)
        .bind(&session.mode)
        .bind(session.start_at)
        .bind(session.end_at)
        .bind(session.duration_ms)
        .bind(position as i64)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert tomato session {}: {}", session.id, e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit tomato sqlite transaction: {}", e))?;
    checkpoint_todo_wal(pool, "tomato save").await;
    Ok(())
}

fn todo_backup_file_name() -> String {
    let now = Local::now();
    format!(
        "todos-{}-{:03}.sqlite",
        now.format("%Y%m%d-%H%M%S"),
        now.timestamp_subsec_millis()
    )
}

fn parse_todo_backup_created_at(file_name: &str) -> Option<i64> {
    let stem = file_name.strip_prefix("todos-")?.strip_suffix(".sqlite")?;
    let mut parts = stem.split('-');
    let date = parts.next()?;
    let time = parts.next()?;
    let parsed =
        NaiveDateTime::parse_from_str(&format!("{}-{}", date, time), "%Y%m%d-%H%M%S").ok()?;
    match Local.from_local_datetime(&parsed) {
        LocalResult::Single(value) => Some(value.timestamp_millis()),
        LocalResult::Ambiguous(first, _) => Some(first.timestamp_millis()),
        LocalResult::None => None,
    }
}

fn system_time_to_ms(time: std::time::SystemTime) -> Option<i64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

pub(crate) fn sanitize_todo_backup_file_name(file_name: &str) -> CmdResult<String> {
    let trimmed = file_name.trim();
    let name = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "invalid todo backup file name".to_string())?;
    if name != trimmed
        || !name.starts_with("todos-")
        || !name.ends_with(".sqlite")
        || name.contains('\\')
        || name.contains('/')
    {
        return Err("invalid todo backup file name".to_string());
    }
    Ok(name.to_string())
}

pub(crate) fn todo_backup_path(file_name: &str) -> CmdResult<PathBuf> {
    Ok(todo_backups_dir().join(sanitize_todo_backup_file_name(file_name)?))
}

fn todo_backup_entry_from_path(path: &Path, source: &str) -> Option<TodoBackupEntry> {
    let file_name = path.file_name()?.to_str()?.to_string();
    sanitize_todo_backup_file_name(&file_name).ok()?;
    let metadata = fs::metadata(path).ok()?;
    Some(TodoBackupEntry {
        id: file_name.clone(),
        created_at: parse_todo_backup_created_at(&file_name)
            .or_else(|| metadata.modified().ok().and_then(system_time_to_ms))
            .unwrap_or(0),
        size: metadata.len(),
        source: source.to_string(),
        file_name,
    })
}

pub(crate) fn list_todo_db_backups_inner() -> CmdResult<Vec<TodoBackupEntry>> {
    let dir = todo_backups_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("read todo backup dir: {}", e))? {
        let path = entry
            .map_err(|e| format!("read todo backup entry: {}", e))?
            .path();
        if !path.is_file() {
            continue;
        }
        if let Some(backup) = todo_backup_entry_from_path(&path, "local") {
            entries.push(backup);
        }
    }
    entries.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.file_name.cmp(&a.file_name))
    });
    Ok(entries)
}

async fn write_todo_db_snapshot(pool: &SqlitePool, target: &Path) -> CmdResult<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir todo backup dir: {}", e))?;
    }
    let target_str = target.to_string_lossy().to_string();
    match sqlx::query("VACUUM main INTO ?1")
        .bind(&target_str)
        .execute(pool)
        .await
    {
        Ok(_) => Ok(()),
        Err(err) => {
            eprintln!(
                "[todo] sqlite VACUUM INTO backup failed, falling back to file copy: {}",
                err
            );
            let _ = fs::remove_file(target);
            checkpoint_todo_wal(pool, "todo backup fallback").await;
            fs::copy(todos_db_path(), target)
                .map(|_| ())
                .map_err(|e| format!("copy todo sqlite backup: {}", e))
        }
    }
}

pub(crate) async fn create_local_todo_db_backup() -> CmdResult<TodoBackupEntry> {
    let pool = todo_db_pool().await?;
    let dir = todo_backups_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir todo backup dir: {}", e))?;

    let mut file_name = todo_backup_file_name();
    let mut path = dir.join(&file_name);
    for attempt in 1..10 {
        if !path.exists() {
            break;
        }
        file_name = file_name.replace(".sqlite", &format!("-{}.sqlite", attempt));
        path = dir.join(&file_name);
    }
    if path.exists() {
        return Err("todo backup file already exists".to_string());
    }

    write_todo_db_snapshot(pool, &path).await?;
    todo_backup_entry_from_path(&path, "local")
        .ok_or_else(|| "create todo backup entry failed".to_string())
}

async fn open_todo_backup_pool(path: &Path) -> CmdResult<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .read_only(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("open todo backup sqlite db: {}", e))
}

async fn load_todo_db_snapshot(path: &Path) -> CmdResult<(TodoData, TomatoData)> {
    if !path.is_file() {
        return Err("todo backup file not found".to_string());
    }
    let backup_pool = open_todo_backup_pool(path).await?;
    let todo = load_todo_data_from_db(&backup_pool).await;
    let tomato = load_tomato_data_from_db(&backup_pool).await;
    backup_pool.close().await;
    Ok((todo?, tomato?))
}

pub(crate) async fn restore_todo_db_snapshot(path: &Path) -> CmdResult<()> {
    let (todo, tomato) = load_todo_db_snapshot(path).await?;
    let pool = todo_db_pool().await?;
    save_todo_data_to_db(pool, &todo).await?;
    save_tomato_data_to_db(pool, &tomato).await?;
    Ok(())
}

#[tauri::command]
pub async fn create_todo_db_backup() -> CmdResult<TodoBackupEntry> {
    create_local_todo_db_backup().await
}

#[tauri::command]
pub fn list_todo_db_backups() -> CmdResult<Vec<TodoBackupEntry>> {
    list_todo_db_backups_inner()
}

#[tauri::command]
pub async fn restore_todo_db_backup(file_name: String) -> CmdResult<()> {
    let path = todo_backup_path(&file_name)?;
    restore_todo_db_snapshot(&path).await
}

#[tauri::command]
pub fn delete_todo_db_backup(file_name: String) -> CmdResult<()> {
    let path = todo_backup_path(&file_name)?;
    if !path.is_file() {
        return Err("todo backup file not found".to_string());
    }
    fs::remove_file(&path).map_err(|e| format!("delete todo backup: {}", e))
}

fn max_list_order(data: &TodoData) -> f64 {
    data.lists.iter().map(|l| l.order).fold(0.0_f64, f64::max)
}

fn ensure_named_list(data: &mut TodoData, name: &str, emoji: &str, now: i64) -> String {
    if let Some(existing) = data.lists.iter_mut().find(|l| l.name == name) {
        existing.emoji = emoji.to_string();
        existing.archived_at = None;
        return existing.id.clone();
    }

    let id = format!("list-{}-{}", now, data.lists.len());
    data.lists.push(TodoList {
        id: id.clone(),
        name: name.into(),
        emoji: emoji.into(),
        folder_id: None,
        order: max_list_order(data) + ORDER_STEP,
        created_at: now,
        archived_at: None,
    });
    id
}

fn ensure_default_list(data: &mut TodoData, now: i64) -> String {
    let default_id = data.default_list_id.clone().unwrap_or_default();
    let exists = data
        .lists
        .iter()
        .any(|l| l.id == default_id && l.archived_at.is_none());
    if exists {
        return default_id;
    }

    let id = ensure_named_list(data, DEFAULT_LIST_NAME, DEFAULT_LIST_EMOJI, now);
    data.default_list_id = Some(id.clone());
    id
}

fn push_quick_task(
    data: &mut TodoData,
    list_id: String,
    content: String,
    due_at: Option<i64>,
    now: i64,
) {
    let max_item_order = data
        .items
        .iter()
        .filter(|it| it.list_id == list_id && it.parent_id.is_none())
        .map(|it| it.order)
        .fold(0.0_f64, f64::max);

    data.items.push(TodoItem {
        id: format!("item-{}-{}", now, data.items.len()),
        list_id,
        content,
        status: TodoStatus::Pending,
        due_at,
        due_end_at: None,
        reminder_enabled: false,
        parent_id: None,
        group_id: None,
        predecessor_id: None,
        marked: false,
        order: max_item_order + ORDER_STEP,
        created_at: now,
        updated_at: now,
        completed_at: None,
        note: String::new(),
        deleted_at: None,
        tags: Vec::new(),
        priority: None,
        progress: 0,
    });
}

fn emit_todo_data_changed(app: &AppHandle, source: &'static str) {
    let _ = app.emit(EVENT_TODO_DATA_CHANGED, TodoDataChangedPayload { source });
}

#[tauri::command]
pub async fn get_todo_data() -> CmdResult<TodoData> {
    let pool = todo_db_pool().await?;
    load_todo_data_from_db(pool).await
}

#[tauri::command]
pub async fn save_todo_data(data: TodoData) -> CmdResult<()> {
    let pool = todo_db_pool().await?;
    save_todo_data_to_db(pool, &data).await
}

#[tauri::command]
pub async fn import_todo_data_from_json(json: String) -> CmdResult<TodoData> {
    let data: TodoData =
        serde_json::from_str(&json).map_err(|e| format!("parse todo json: {}", e))?;
    let pool = todo_db_pool().await?;
    save_todo_data_to_db(pool, &data).await?;
    load_todo_data_from_db(pool).await
}

#[tauri::command]
pub async fn export_todo_data_as_json() -> CmdResult<String> {
    let pool = todo_db_pool().await?;
    let data = load_todo_data_from_db(pool).await?;
    serde_json::to_string_pretty(&data).map_err(|e| format!("serialize todo json: {}", e))
}

#[tauri::command]
pub async fn get_tomato_data() -> CmdResult<TomatoData> {
    let pool = todo_db_pool().await?;
    load_tomato_data_from_db(pool).await
}

#[tauri::command]
pub async fn save_tomato_data(data: TomatoData) -> CmdResult<()> {
    let pool = todo_db_pool().await?;
    save_tomato_data_to_db(pool, &data).await
}

#[tauri::command]
pub fn save_todo_asset(file_name: String, data_base64: String) -> CmdResult<()> {
    let file_name = sanitize_asset_file_name(&file_name)?;
    let dir = todo_assets_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir todo assets: {}", e))?;
    let payload = data_base64
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(data_base64.as_str());
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("decode todo asset: {}", e))?;
    fs::write(dir.join(file_name), bytes).map_err(|e| format!("write todo asset: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn read_todo_asset(file_name: String) -> CmdResult<TodoAssetFile> {
    let file_name = sanitize_asset_file_name(&file_name)?;
    let path = todo_assets_dir().join(&file_name);
    let bytes = fs::read(&path).map_err(|e| format!("read todo asset: {}", e))?;
    Ok(TodoAssetFile {
        mime_type: todo_asset_mime_type(&file_name).to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        file_name,
    })
}

#[tauri::command]
pub fn parse_todo_time_text(text: String, now_ms: Option<i64>) -> CmdResult<TodoTimeParseResult> {
    if text.trim().is_empty() {
        return Ok(TodoTimeParseResult {
            due_at: None,
            due_end_at: None,
            reminder_enabled: false,
            label: None,
            cleaned_text: String::new(),
            spans: Vec::new(),
        });
    }

    let now = local_from_ms(now_ms);
    let today = now.date_naive();
    let mut byte_spans: Vec<TodoByteSpan> = Vec::new();
    let mut due_at = None;

    if let Some((relative_due, span)) = find_relative_duration(&text, now) {
        due_at = Some(relative_due);
        byte_spans.push(span);
    } else {
        let date_candidate = find_date_candidate(&text, today);
        let time_candidate = find_time_of_day(&text);

        if let Some(date_candidate) = date_candidate {
            let (hour, minute) = time_candidate
                .as_ref()
                .map(|candidate| (candidate.hour, candidate.minute))
                .unwrap_or_else(|| default_time_for_text(&text));
            due_at = local_ms(date_candidate.date, hour, minute);
            byte_spans.push(date_candidate.span);
            if let Some(candidate) = time_candidate {
                byte_spans.push(candidate.span);
            }
        } else if let Some(time_candidate) = time_candidate {
            let mut date = today;
            let mut candidate_due = local_ms(date, time_candidate.hour, time_candidate.minute);
            if candidate_due.is_some_and(|due| due <= now.timestamp_millis()) {
                date += Duration::days(1);
                candidate_due = local_ms(date, time_candidate.hour, time_candidate.minute);
            }
            due_at = candidate_due;
            byte_spans.push(time_candidate.span);
        }
    }

    if let Some(reminder_span) = find_reminder_span(&text) {
        byte_spans.push(reminder_span);
    }

    let byte_spans = normalize_byte_spans(byte_spans);
    let spans = byte_spans
        .iter()
        .map(|span| todo_span_from_byte(&text, span))
        .collect::<Vec<_>>();
    let cleaned_text = if due_at.is_some() {
        cleaned_todo_text(&text, &spans)
    } else {
        text.trim().to_string()
    };
    let label = due_at.map(|due| format_todo_time_label(due, now));

    Ok(TodoTimeParseResult {
        due_at,
        due_end_at: None,
        reminder_enabled: due_at.is_some() && spans.iter().any(|span| span.kind == "reminder"),
        label,
        cleaned_text,
        spans,
    })
}

// Open (or re-focus) the standalone Todo window. Mirrors the
// `open_aecx_lite_window` / `open_converter_window` shape so behaviour is
// consistent across our secondary tool windows. The window picks up
// `appView === "todo"` from its label and renders `<TodoPanel/>` instead
// of the launcher UI.
#[tauri::command]
pub async fn open_todo_window(app: AppHandle) -> CmdResult<()> {
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        let _ = apply_window_app_id(&win, WINDOW_APP_ID);
        let _ = win.show();
        #[cfg(not(mobile))]
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }

    let initial_settings = crate::commands::todo_settings::load_todo_settings();
    let initial_settings_json =
        serde_json::to_string(&initial_settings).unwrap_or_else(|_| "{}".into());
    let initial_script = todo_initialization_script("todo", &initial_settings_json);
    let initial_background = if initial_settings.theme_mode == "dark" {
        Color(32, 41, 58, 255)
    } else {
        Color(248, 250, 252, 255)
    };
    let initial_bounds = initial_todo_window_bounds(&app);

    let mut builder =
        WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title(WINDOW_TITLE)
            .inner_size(960.0, 640.0)
            .min_inner_size(720.0, 480.0)
            .background_color(initial_background)
            .initialization_script(initial_script)
            .visible(true);

    #[cfg(not(mobile))]
    {
        builder = builder.decorations(false);
    }

    if let Some((x, y, w, h)) = initial_bounds {
        builder = builder.inner_size(w, h).position(x, y);
    }

    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = apply_window_app_id(&window, WINDOW_APP_ID);
    if let Some(icon_path) = todo_icon_path(&app) {
        let _ = apply_todo_taskbar_icon(&window, &icon_path);
    }
    crate::commands::window::attach_todo_close_handler(&window);
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn open_todo_widget_window(app: AppHandle) -> CmdResult<()> {
    if let Some(win) = app.get_webview_window(WIDGET_WINDOW_LABEL) {
        let _ = apply_window_app_id(&win, WIDGET_WINDOW_APP_ID);
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }

    let initial_settings = crate::commands::todo_settings::load_todo_settings();
    let initial_settings_json =
        serde_json::to_string(&initial_settings).unwrap_or_else(|_| "{}".into());
    let initial_script = todo_initialization_script("todo-widget", &initial_settings_json);
    let initial_bounds = initial_todo_widget_window_bounds(&app);

    let mut builder = WebviewWindowBuilder::new(
        &app,
        WIDGET_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(WIDGET_WINDOW_TITLE)
    .inner_size(420.0, 660.0)
    .min_inner_size(320.0, 420.0)
    .decorations(false)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .resizable(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .initialization_script(initial_script)
    .visible(false);

    if let Some((x, y, w, h)) = initial_bounds {
        builder = builder.inner_size(w, h).position(x, y);
    }

    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = apply_window_app_id(&window, WIDGET_WINDOW_APP_ID);
    if let Some(icon_path) = todo_icon_path(&app) {
        let _ = apply_todo_taskbar_icon(&window, &icon_path);
    }
    crate::commands::window::attach_hide_on_close_handler(&window);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn toggle_todo_widget_window(app: AppHandle) -> CmdResult<()> {
    if let Some(win) = app.get_webview_window(WIDGET_WINDOW_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return Ok(());
        }
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }

    open_todo_widget_window(app).await
}

fn todo_initialization_script(view: &str, initial_settings_json: &str) -> String {
    let view_json = serde_json::to_string(view).unwrap_or_else(|_| "\"todo\"".into());
    format!(
        "try{{var s={};window.__AEBOX_BOOTSTRAP__=Object.assign({{}},window.__AEBOX_BOOTSTRAP__,{{view:{},todoSettings:s}});localStorage.setItem('aebox.todoSettings',JSON.stringify(s));}}catch(e){{}}",
        initial_settings_json, view_json
    )
}

fn initial_todo_window_bounds(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let cursor = app.cursor_position().ok();
    let target = cursor
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    target.map(|m| {
        let mw = m.size().width;
        let mh = m.size().height;
        let w = (mw * 6 / 10).min(1500);
        let h = (mh * 7 / 10).min(1000);
        let mp = m.position();
        let x = mp.x + ((mw as i32 - w as i32) / 2);
        let y = mp.y + ((mh as i32 - h as i32) / 2);
        let scale = m.scale_factor().max(1.0);

        (
            x as f64 / scale,
            y as f64 / scale,
            w as f64 / scale,
            h as f64 / scale,
        )
    })
}

fn initial_todo_widget_window_bounds(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let cursor = app.cursor_position().ok();
    let target = cursor
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    target.map(|m| {
        let mw = m.size().width as i32;
        let mh = m.size().height as i32;
        let mp = m.position();
        let scale = m.scale_factor().max(1.0);
        let margin = (32.0 * scale).round() as i32;
        let preferred_w = (420.0 * scale).round() as i32;
        let preferred_h = (660.0 * scale).round() as i32;
        let w = preferred_w.min((mw as f64 * 0.9).round() as i32).max(320);
        let h = preferred_h.min((mh as f64 * 0.86).round() as i32).max(420);
        let x = mp.x + mw - w - margin;
        let y = mp.y + ((mh - h) / 2).max(margin);

        (
            x as f64 / scale,
            y as f64 / scale,
            w as f64 / scale,
            h as f64 / scale,
        )
    })
}

// Quick-add a task to today's calendar without opening the todo window.
// Used by the search launcher's `today <text>` shortcut. If a default
// list is pinned, the task lands there; otherwise we ensure a "默认"
// list exists and pin it. The frontend passes `due_at_ms` (today's
// local midnight) so we don't need a timezone library on this side.
// Returns the (possibly newly-created) default list id.
#[tauri::command]
pub async fn add_today_task(app: AppHandle, content: String, due_at_ms: i64) -> CmdResult<String> {
    let text = content.trim().to_string();
    if text.is_empty() {
        return Err("内容为空".into());
    }
    let pool = todo_db_pool().await?;
    let mut data = load_todo_data_from_db(pool).await?;
    let now = now_ms();
    let default_id = ensure_default_list(&mut data, now);
    push_quick_task(&mut data, default_id.clone(), text, Some(due_at_ms), now);

    save_todo_data_to_db(pool, &data).await?;
    emit_todo_data_changed(&app, "todayQuickAdd");
    Ok(default_id)
}

// Quick-add a task into the collection inbox without assigning it to a
// user list yet. The inbox is stored as a hidden built-in list so existing
// move/copy/edit flows can keep using list_id.
#[tauri::command]
pub async fn add_inbox_task(app: AppHandle, content: String) -> CmdResult<String> {
    let text = content.trim().to_string();
    if text.is_empty() {
        return Err("内容为空".into());
    }

    let pool = todo_db_pool().await?;
    let mut data = load_todo_data_from_db(pool).await?;
    let now = now_ms();
    let inbox_id = ensure_named_list(&mut data, INBOX_LIST_NAME, INBOX_LIST_EMOJI, now);
    push_quick_task(&mut data, inbox_id.clone(), text, None, now);

    save_todo_data_to_db(pool, &data).await?;
    emit_todo_data_changed(&app, "inboxQuickAdd");
    Ok(inbox_id)
}

// Read all items whose dueAt falls within today's local-midnight range.
// Used by the search launcher to preview today's tasks inline. Caller
// passes the local midnight bounds.
#[tauri::command]
pub async fn list_today_tasks(start_ms: i64, end_ms: i64) -> CmdResult<Vec<TodoItem>> {
    let pool = todo_db_pool().await?;
    let data = load_todo_data_from_db(pool).await?;
    let archived_list_ids: Vec<String> = data
        .lists
        .iter()
        .filter(|l| l.archived_at.is_some())
        .map(|l| l.id.clone())
        .collect();
    let mut out: Vec<TodoItem> = data
        .items
        .into_iter()
        .filter(|it| {
            it.deleted_at.is_none()
                && !archived_list_ids.iter().any(|id| id == &it.list_id)
                && it
                    .due_at
                    .map(|start| {
                        if let Some(end) = it.due_end_at.filter(|end| *end > start) {
                            start < end_ms && end > start_ms
                        } else {
                            start >= start_ms && start < end_ms
                        }
                    })
                    .unwrap_or(false)
        })
        .collect();
    out.sort_by(|a, b| a.due_at.cmp(&b.due_at));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_jieba_token_offsets_without_panicking() {
        let parsed = parse_todo_time_text("明天其提醒我".to_string(), Some(1764547200000)).unwrap();

        assert!(parsed.due_at.is_some());
        assert!(parsed.spans.iter().any(|span| span.text == "明天"));
        assert!(parsed.reminder_enabled);
    }

    #[test]
    fn cleans_detected_time_from_quick_add_title() {
        let parsed =
            parse_todo_time_text("明天下午3点开会提醒我".to_string(), Some(1764547200000)).unwrap();

        assert!(parsed.due_at.is_some());
        assert!(!parsed.cleaned_text.contains("明天"));
        assert!(!parsed.cleaned_text.contains("下午3点"));
        assert!(parsed.cleaned_text.contains("开会"));
    }
}
