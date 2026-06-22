import { invoke } from "@tauri-apps/api/core";

export const ipc = {
  getWindowSettings: () => invoke<WindowSettingsPayload>("get_window_settings"),
  setCloseToTray: (enabled: boolean) => invoke<void>("set_close_to_tray", { enabled }),
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),
  getTodoSettings: () => invoke<TodoSettingsPayload>("get_todo_settings"),
  setTodoSettings: (settings: TodoSettingsPayload) =>
    invoke<void>("set_todo_settings", { settings }),
  listTodoFonts: () => invoke<TodoFontEntry[]>("list_todo_fonts"),
  getTodoData: <T = unknown>() => invoke<T>("get_todo_data"),
  saveTodoData: <T = unknown>(data: T) => invoke<void>("save_todo_data", { data }),
  importTodoDataFromJson: <T = unknown>(json: string) =>
    invoke<T>("import_todo_data_from_json", { json }),
  exportTodoDataAsJson: () => invoke<string>("export_todo_data_as_json"),
  createTodoDbBackup: () => invoke<TodoBackupEntry>("create_todo_db_backup"),
  listTodoDbBackups: () => invoke<TodoBackupEntry[]>("list_todo_db_backups"),
  restoreTodoDbBackup: (fileName: string) =>
    invoke<void>("restore_todo_db_backup", { fileName }),
  deleteTodoDbBackup: (fileName: string) =>
    invoke<void>("delete_todo_db_backup", { fileName }),
  backupTodoDbToWebDav: () => invoke<TodoBackupEntry>("backup_todo_db_to_webdav"),
  listTodoWebDavBackups: () => invoke<TodoBackupEntry[]>("list_todo_webdav_backups"),
  syncTodoDbBackupsFromWebDav: () =>
    invoke<TodoBackupEntry[]>("sync_todo_db_backups_from_webdav"),
  restoreTodoDbBackupFromWebDav: (fileName: string) =>
    invoke<void>("restore_todo_db_backup_from_webdav", { fileName }),
  deleteTodoWebDavBackup: (fileName: string) =>
    invoke<TodoBackupEntry[]>("delete_todo_webdav_backup", { fileName }),
  getTomatoData: <T = unknown>() => invoke<T>("get_tomato_data"),
  saveTomatoData: <T = unknown>(data: T) => invoke<void>("save_tomato_data", { data }),
  saveTodoAsset: (fileName: string, dataBase64: string) =>
    invoke<void>("save_todo_asset", { fileName, dataBase64 }),
  readTodoAsset: (fileName: string) =>
    invoke<{ fileName: string; dataBase64: string; mimeType: string }>(
      "read_todo_asset",
      { fileName },
    ),
  parseTodoTimeText: <T = unknown>(text: string, nowMs?: number) =>
    invoke<T>("parse_todo_time_text", { text, nowMs: nowMs ?? null }),
  openTodoWidgetWindow: () => invoke<void>("open_todo_widget_window"),
  toggleTodoWidgetWindow: () => invoke<void>("toggle_todo_widget_window"),
  addTodayTask: (content: string, dueAtMs: number) =>
    invoke<string>("add_today_task", { content, dueAtMs }),
  addInboxTask: (content: string) => invoke<string>("add_inbox_task", { content }),
  listTodayTasks: <T = unknown>(startMs: number, endMs: number) =>
    invoke<T[]>("list_today_tasks", { startMs, endMs }),
};

export interface WindowSettingsPayload {
  closeToTray: boolean;
  autostart: boolean;
}

export interface TodoSettingsPayload {
  themeMode: "light" | "dark" | "system";
  colorTheme: string;
  colorThemes: TodoColorThemePayload[];
  fontFamily: string;
  accentColor: string;
  accentColorOverridden: boolean;
  checkboxShape: "square" | "circle";
  widgetBackgroundOpacity: number;
  idlePaperEffectEnabled: boolean;
  idlePaperLightEffect: "random" | "leaves" | "rain";
  webDavUrl: string;
  webDavUsername: string;
  webDavPassword: string;
  webDavPath: string;
  dayStartHour: number;
  dayEndHour: number;
  showWeekNumbers: boolean;
  showChineseCalendar: boolean;
  showLunarCalendar: boolean;
  firstDay: number;
  timeZones: string[];
  shortcuts: TodoShortcutsPayload;
}

export interface TodoColorThemePayload {
  id: string;
  label: string;
  panel: string;
  middle: string;
  content: string;
  surface: string;
  accent: string;
}

export interface TodoShortcutsPayload {
  undo: string;
  redo: string;
  delete: string;
  createTask: string;
  createChild: string;
  complete: string;
  search: string;
}

export interface TodoFontEntry {
  id: string;
  label: string;
  fileName: string;
  path: string;
}

export interface TodoBackupEntry {
  id: string;
  fileName: string;
  createdAt: number;
  size: number;
  source: "local" | "webdav" | string;
}
