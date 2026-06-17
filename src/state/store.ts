import { create } from "zustand";
import { normalizeTodoTimeZones } from "../lib/timeZones";
import {
  DEFAULT_TODO_COLOR_THEME_ID,
  normalizeTodoColorThemes,
  readTodoColorThemeId,
  type TodoColorTheme,
  type TodoColorThemeId,
} from "../lib/todoColorThemes";

export type ThemeMode = "light" | "dark" | "system";
export type TodoIdleLightEffectMode = "random" | "leaves" | "rain";

export type TodoShortcutId =
  | "undo"
  | "redo"
  | "delete"
  | "createTask"
  | "createChild"
  | "complete"
  | "search";
export type TodoShortcuts = Record<TodoShortcutId, string>;
export const TODO_SHORTCUT_IDS: readonly TodoShortcutId[] = [
  "undo",
  "redo",
  "delete",
  "createTask",
  "createChild",
  "complete",
  "search",
];
export const DEFAULT_TODO_SHORTCUTS: TodoShortcuts = {
  undo: "Control+Z",
  redo: "Control+Shift+Z",
  delete: "Delete",
  createTask: "Control+N",
  createChild: "Control+Enter",
  complete: "Control+M",
  search: "Control+F",
};

interface Snack {
  id: number;
  message: string;
  severity: "success" | "error" | "info" | "warning";
}

export interface AppSettingsState {
  todoThemeMode: ThemeMode;
  todoColorTheme: TodoColorThemeId;
  todoColorThemes: TodoColorTheme[];
  todoFontFamily: string;
  todoAccentColor: string;
  todoAccentColorOverridden: boolean;
  todoCheckboxShape: "square" | "circle";
  todoIdlePaperEffectEnabled: boolean;
  todoIdlePaperLightEffect: TodoIdleLightEffectMode;
  todoWebDavUrl: string;
  todoWebDavUsername: string;
  todoWebDavPassword: string;
  todoWebDavPath: string;
  todoDayStartHour: number;
  todoDayEndHour: number;
  todoShowWeekNumbers: boolean;
  todoShowChineseCalendar: boolean;
  todoShowLunarCalendar: boolean;
  todoFirstDay: number;
  todoTimeZones: string[];
  todoShortcuts: TodoShortcuts;
}

export type TodoSettingsState = AppSettingsState;

interface State {
  appSettings: AppSettingsState;
  hotkeyRecording: boolean;
  hotkeys: Record<string, string>;
  snacks: Snack[];
}

interface Actions {
  setHotkeyRecording(recording: boolean): void;
  setTodoSettings(next: Partial<TodoSettingsState>): void;
  pushSnack(message: string, severity?: Snack["severity"]): void;
  dismissSnack(id: number): void;
}

export const TODO_SETTINGS_STORAGE_KEY = "aebox.todoSettings";

export const DEFAULT_APP_SETTINGS: AppSettingsState = {
  todoThemeMode: "system",
  todoColorTheme: DEFAULT_TODO_COLOR_THEME_ID,
  todoColorThemes: [],
  todoFontFamily: "",
  todoAccentColor: "#2563eb",
  todoAccentColorOverridden: false,
  todoCheckboxShape: "square",
  todoIdlePaperEffectEnabled: true,
  todoIdlePaperLightEffect: "random",
  todoWebDavUrl: "",
  todoWebDavUsername: "",
  todoWebDavPassword: "",
  todoWebDavPath: "todo-backups",
  todoDayStartHour: 6,
  todoDayEndHour: 22,
  todoShowWeekNumbers: false,
  todoShowChineseCalendar: true,
  todoShowLunarCalendar: false,
  todoFirstDay: 0,
  todoTimeZones: [],
  todoShortcuts: { ...DEFAULT_TODO_SHORTCUTS },
};

let snackId = 0;

function readInitialTodoSettings(): TodoSettingsState {
  try {
    const bootstrap = (window as unknown as {
      __AEBOX_BOOTSTRAP__?: { todoSettings?: unknown };
    }).__AEBOX_BOOTSTRAP__;
    if (bootstrap?.todoSettings) {
      return todoSettingsPayloadToState(bootstrap.todoSettings);
    }
  } catch {
    /* bootstrap is best-effort */
  }

  try {
    const raw = localStorage.getItem(TODO_SETTINGS_STORAGE_KEY);
    if (raw) return todoSettingsPayloadToState(JSON.parse(raw));
  } catch {
    /* localStorage may be stale or unavailable */
  }

  return todoSettingsPayloadToState({});
}

const initialAppSettings = mergeTodoSettings(DEFAULT_APP_SETTINGS, readInitialTodoSettings());

export const useStore = create<State & Actions>((set, get) => ({
  appSettings: initialAppSettings,
  hotkeyRecording: false,
  hotkeys: {},
  snacks: [],

  setHotkeyRecording: (recording) => set({ hotkeyRecording: recording }),
  setTodoSettings: (next) => {
    const merged = mergeTodoSettings(get().appSettings, next);
    set({ appSettings: merged });
    persistTodoSettings(merged);
  },
  pushSnack: (message, severity = "info") =>
    set((state) => ({
      snacks: [...state.snacks, { id: ++snackId, message, severity }],
    })),
  dismissSnack: (id) =>
    set((state) => ({ snacks: state.snacks.filter((snack) => snack.id !== id) })),
}));

function persistTodoSettings(state: AppSettingsState) {
  const payload = todoSettingsStateToPayload(state);
  try {
    localStorage.setItem(TODO_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* cross-window sync is best-effort */
  }
  import("../lib/ipc")
    .then(({ ipc }) => ipc.setTodoSettings(payload))
    .catch(() => {
      /* persist is best-effort */
    });
}

export function todoSettingsStateToPayload(state: AppSettingsState | TodoSettingsState) {
  return {
    themeMode: state.todoThemeMode,
    colorTheme: state.todoColorTheme,
    colorThemes: normalizeTodoColorThemes(state.todoColorThemes),
    fontFamily: readTodoFontFamily(state.todoFontFamily, ""),
    accentColor: state.todoAccentColor,
    accentColorOverridden: state.todoAccentColorOverridden,
    checkboxShape: state.todoCheckboxShape,
    idlePaperEffectEnabled: state.todoIdlePaperEffectEnabled,
    idlePaperLightEffect: state.todoIdlePaperLightEffect,
    webDavUrl: state.todoWebDavUrl.trim(),
    webDavUsername: state.todoWebDavUsername.trim(),
    webDavPassword: state.todoWebDavPassword,
    webDavPath: normalizeWebDavPath(state.todoWebDavPath),
    dayStartHour: state.todoDayStartHour,
    dayEndHour: state.todoDayEndHour,
    showWeekNumbers: state.todoShowWeekNumbers,
    showChineseCalendar: state.todoShowChineseCalendar,
    showLunarCalendar: state.todoShowLunarCalendar,
    firstDay: state.todoFirstDay,
    timeZones: normalizeTodoTimeZones(state.todoTimeZones),
    shortcuts: normalizeTodoShortcuts(state.todoShortcuts),
  };
}

export function todoSettingsPayloadToState(payload: unknown): TodoSettingsState {
  const d = DEFAULT_APP_SETTINGS;
  const todo = asRecord(payload);
  const colorThemes = normalizeTodoColorThemes(todo.colorThemes);
  const start = clampInt(readNumber(todo.dayStartHour, d.todoDayStartHour), 0, 22);
  const end = Math.max(
    start + 1,
    clampInt(readNumber(todo.dayEndHour, d.todoDayEndHour), 1, 23),
  );
  return {
    todoThemeMode: readThemeMode(todo.themeMode, d.todoThemeMode),
    todoColorTheme: readTodoColorTheme(todo.colorTheme, d.todoColorTheme, colorThemes),
    todoColorThemes: colorThemes,
    todoFontFamily: readTodoFontFamily(todo.fontFamily, d.todoFontFamily),
    todoAccentColor: readAccentColor(todo.accentColor, d.todoAccentColor),
    todoAccentColorOverridden: readBoolean(
      todo.accentColorOverridden,
      d.todoAccentColorOverridden,
    ),
    todoCheckboxShape: readTodoCheckboxShape(todo.checkboxShape, d.todoCheckboxShape),
    todoIdlePaperEffectEnabled: readBoolean(
      todo.idlePaperEffectEnabled,
      d.todoIdlePaperEffectEnabled,
    ),
    todoIdlePaperLightEffect: readTodoIdleLightEffectMode(
      todo.idlePaperLightEffect,
      d.todoIdlePaperLightEffect,
    ),
    todoWebDavUrl: readString(todo.webDavUrl, d.todoWebDavUrl).trim(),
    todoWebDavUsername: readString(todo.webDavUsername, d.todoWebDavUsername).trim(),
    todoWebDavPassword: readString(todo.webDavPassword, d.todoWebDavPassword),
    todoWebDavPath: normalizeWebDavPath(readString(todo.webDavPath, d.todoWebDavPath)),
    todoDayStartHour: start,
    todoDayEndHour: end,
    todoShowWeekNumbers: readBoolean(todo.showWeekNumbers, d.todoShowWeekNumbers),
    todoShowChineseCalendar: readBoolean(
      todo.showChineseCalendar,
      d.todoShowChineseCalendar,
    ),
    todoShowLunarCalendar: readBoolean(todo.showLunarCalendar, d.todoShowLunarCalendar),
    todoFirstDay: clampInt(readNumber(todo.firstDay, d.todoFirstDay), 0, 6),
    todoTimeZones: normalizeTodoTimeZones(todo.timeZones),
    todoShortcuts: normalizeTodoShortcuts(todo.shortcuts, d.todoShortcuts),
  };
}

export function mergeTodoSettings(
  current: AppSettingsState,
  next: Partial<TodoSettingsState>,
): AppSettingsState {
  const todoColorThemes = normalizeTodoColorThemes(
    next.todoColorThemes ?? current.todoColorThemes,
  );
  const start = clampInt(next.todoDayStartHour ?? current.todoDayStartHour, 0, 22);
  const end = Math.max(
    start + 1,
    clampInt(next.todoDayEndHour ?? current.todoDayEndHour, 1, 23),
  );
  return {
    ...current,
    ...next,
    todoThemeMode: readThemeMode(next.todoThemeMode, current.todoThemeMode),
    todoColorTheme: readTodoColorTheme(
      next.todoColorTheme,
      current.todoColorTheme,
      todoColorThemes,
    ),
    todoColorThemes,
    todoFontFamily: readTodoFontFamily(next.todoFontFamily, current.todoFontFamily),
    todoAccentColor: readAccentColor(next.todoAccentColor, current.todoAccentColor),
    todoAccentColorOverridden: readBoolean(
      next.todoAccentColorOverridden,
      current.todoAccentColorOverridden,
    ),
    todoCheckboxShape: readTodoCheckboxShape(next.todoCheckboxShape, current.todoCheckboxShape),
    todoIdlePaperEffectEnabled: readBoolean(
      next.todoIdlePaperEffectEnabled,
      current.todoIdlePaperEffectEnabled,
    ),
    todoIdlePaperLightEffect: readTodoIdleLightEffectMode(
      next.todoIdlePaperLightEffect,
      current.todoIdlePaperLightEffect,
    ),
    todoWebDavUrl: readString(next.todoWebDavUrl, current.todoWebDavUrl).trim(),
    todoWebDavUsername: readString(
      next.todoWebDavUsername,
      current.todoWebDavUsername,
    ).trim(),
    todoWebDavPassword: readString(next.todoWebDavPassword, current.todoWebDavPassword),
    todoWebDavPath: normalizeWebDavPath(readString(next.todoWebDavPath, current.todoWebDavPath)),
    todoDayStartHour: start,
    todoDayEndHour: end,
    todoShowWeekNumbers: readBoolean(
      next.todoShowWeekNumbers,
      current.todoShowWeekNumbers,
    ),
    todoShowChineseCalendar: readBoolean(
      next.todoShowChineseCalendar,
      current.todoShowChineseCalendar,
    ),
    todoShowLunarCalendar: readBoolean(
      next.todoShowLunarCalendar,
      current.todoShowLunarCalendar,
    ),
    todoFirstDay: clampInt(next.todoFirstDay ?? current.todoFirstDay, 0, 6),
    todoTimeZones: normalizeTodoTimeZones(next.todoTimeZones ?? current.todoTimeZones),
    todoShortcuts: normalizeTodoShortcuts(next.todoShortcuts, current.todoShortcuts),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readThemeMode(value: unknown, fallback: ThemeMode): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : fallback;
}

function readTodoColorTheme(
  value: unknown,
  fallback: TodoColorThemeId,
  customThemes?: unknown,
): TodoColorThemeId {
  return readTodoColorThemeId(value, fallback, customThemes);
}

function readAccentColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function readTodoCheckboxShape(
  value: unknown,
  fallback: "square" | "circle",
): "square" | "circle" {
  return value === "circle" || value === "square" ? value : fallback;
}

function readTodoIdleLightEffectMode(
  value: unknown,
  fallback: TodoIdleLightEffectMode,
): TodoIdleLightEffectMode {
  return value === "random" || value === "leaves" || value === "rain" ? value : fallback;
}

function readTodoFontFamily(value: unknown, fallback: string): string {
  const text = readString(value, fallback).trim();
  if (!text || text.length > 240 || /[/\\\0]/.test(text)) return "";
  return text;
}

function normalizeTodoShortcuts(
  value: unknown,
  fallback: TodoShortcuts = DEFAULT_TODO_SHORTCUTS,
): TodoShortcuts {
  const record = asRecord(value);
  const out = { ...DEFAULT_TODO_SHORTCUTS };
  for (const id of TODO_SHORTCUT_IDS) {
    const raw = readString(record[id], fallback[id]).trim();
    out[id] = raw.length <= 80 ? raw : fallback[id];
  }
  return out;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeWebDavPath(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "");
  return !trimmed || trimmed === "todos.json" ? "todo-backups" : trimmed;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
