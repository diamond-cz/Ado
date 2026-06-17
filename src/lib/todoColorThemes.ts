export type TodoColorThemeId = string;

export interface TodoColorTheme {
  id: TodoColorThemeId;
  label: string;
  panel: string;
  middle: string;
  content: string;
  surface: string;
  accent: string;
}

export const DEFAULT_TODO_COLOR_THEME_ID: TodoColorThemeId = "default";

const TODO_COLOR_THEME_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_CUSTOM_TODO_COLOR_THEMES = 32;

export const TODO_COLOR_THEMES: readonly TodoColorTheme[] = [
  {
    id: "default",
    label: "默认",
    panel: "#f9f9f9",
    middle: "#ffffff",
    content: "#ffffff",
    surface: "#f8fafc",
    accent: "#2563eb",
  },
  {
    id: "taoyao",
    label: "桃夭",
    panel: "linear-gradient(180deg, #ff7aa4 0%, #ffaea6 100%)",
    middle: "#ffe3e9",
    content: "#fff9fa",
    surface: "#fff9fa",
    accent: "#e11d48",
  },
  {
    id: "qinglan",
    label: "晴蓝",
    panel: "#6187fd",
    middle: "#f2f5ff",
    content: "#fcfdff",
    surface: "#fcfdff",
    accent: "#4f6ff4",
  },
  {
    id: "songshi",
    label: "松石",
    panel: "#40caac",
    middle: "#e1f7f2",
    content: "#f4fcfa",
    surface: "#f4fcfa",
    accent: "#0f9f83",
  },
  {
    id: "miqing",
    label: "秘青",
    panel: "#7ebec2",
    middle: "#dfeff0",
    content: "#f8fbfc",
    surface: "#f8fbfc",
    accent: "#278b92",
  },
  {
    id: "jianjia",
    label: "蒹葭",
    panel: "#b5c5a8",
    middle: "#e8ede4",
    content: "#fbfcfa",
    surface: "#fbfcfa",
    accent: "#748b62",
  },
  {
    id: "xinghuang",
    label: "杏黄",
    panel: "linear-gradient(180deg, #f3c268 0%, #f4aa8b 100%)",
    middle: "#fcefdc",
    content: "#fefbf8",
    surface: "#fefbf8",
    accent: "#d97706",
  },
  {
    id: "mushanzi",
    label: "暮山紫",
    panel: "linear-gradient(180deg, #919ae7 0%, #e4c4eb 100%)",
    middle: "#efecfa",
    content: "#fcfbfe",
    surface: "#fcfbfe",
    accent: "#7c3aed",
  },
  {
    id: "chenxiang",
    label: "沉香",
    panel: "linear-gradient(180deg, #b0988a 0%, #9e8573 100%)",
    middle: "#ece6e3",
    content: "#fbf9f9",
    surface: "#fbf9f9",
    accent: "#7c5f50",
  },
  {
    id: "macaron",
    label: "马卡龙",
    panel: "linear-gradient(180deg, #f9cfe8 0%, #c8e8ff 48%, #c7f0df 100%)",
    middle: "#f7efff",
    content: "#fbfffd",
    surface: "#f6fbff",
    accent: "#ec4899",
  },
  {
    id: "mintsoda",
    label: "薄荷苏打",
    panel: "linear-gradient(180deg, #7dd3c7 0%, #b7f7d8 48%, #bfdbfe 100%)",
    middle: "#e9fbf4",
    content: "#fbfffd",
    surface: "#f4fffb",
    accent: "#0f9f83",
  },
  {
    id: "peachoolong",
    label: "蜜桃乌龙",
    panel: "linear-gradient(180deg, #fda4af 0%, #fed7aa 48%, #bbf7d0 100%)",
    middle: "#fff1ec",
    content: "#fffdf9",
    surface: "#fffaf4",
    accent: "#f97316",
  },
] as const;

const BUILTIN_TODO_COLOR_THEME_MAP = new Map(
  TODO_COLOR_THEMES.map((theme) => [theme.id, theme]),
);
const DEFAULT_TODO_COLOR_THEME = TODO_COLOR_THEMES[0] as TodoColorTheme;

export function isBuiltinTodoColorThemeId(value: unknown): value is TodoColorThemeId {
  return typeof value === "string" && BUILTIN_TODO_COLOR_THEME_MAP.has(value);
}

export function builtinTodoColorThemeFor(value: unknown): TodoColorTheme | null {
  if (!isBuiltinTodoColorThemeId(value)) return null;
  return BUILTIN_TODO_COLOR_THEME_MAP.get(value) ?? null;
}

export function isValidTodoColorThemeId(value: unknown): value is TodoColorThemeId {
  return typeof value === "string" && TODO_COLOR_THEME_ID_RE.test(value.trim());
}

export function isTodoHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value.trim());
}

export function normalizeTodoColorTheme(value: unknown): TodoColorTheme | null {
  const record = asRecord(value);
  const id = readString(record.id, "").trim();
  if (!isValidTodoColorThemeId(id)) return null;

  const fallback = builtinTodoColorThemeFor(id) ?? DEFAULT_TODO_COLOR_THEME;
  return {
    id,
    label: normalizeThemeLabel(record.label, fallback.label),
    panel: normalizePanelValue(record.panel, fallback.panel),
    middle: normalizeHexColor(record.middle, fallback.middle),
    content: normalizeHexColor(record.content, fallback.content),
    surface: normalizeHexColor(record.surface, fallback.surface),
    accent: normalizeHexColor(record.accent, fallback.accent),
  };
}

export function normalizeTodoColorThemes(value: unknown): TodoColorTheme[] {
  if (!Array.isArray(value)) return [];
  const themes: TodoColorTheme[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const theme = normalizeTodoColorTheme(item);
    if (!theme || seen.has(theme.id) || isBuiltinTodoColorThemeId(theme.id)) continue;
    seen.add(theme.id);
    themes.push(theme);
    if (themes.length >= MAX_CUSTOM_TODO_COLOR_THEMES) break;
  }
  return themes;
}

export function mergeTodoColorThemes(customThemes: unknown): TodoColorTheme[] {
  const custom = normalizeTodoColorThemes(customThemes);
  const byId = new Map<string, TodoColorTheme>();
  for (const theme of TODO_COLOR_THEMES) byId.set(theme.id, theme);
  for (const theme of custom) byId.set(theme.id, theme);

  const merged: TodoColorTheme[] = [];
  const appended = new Set<string>();
  for (const theme of TODO_COLOR_THEMES) {
    const resolved = byId.get(theme.id);
    if (resolved) {
      merged.push(resolved);
      appended.add(resolved.id);
    }
  }
  for (const theme of custom) {
    if (appended.has(theme.id)) continue;
    merged.push(theme);
  }
  return merged;
}

export function isTodoColorThemeId(value: unknown, customThemes?: unknown): value is TodoColorThemeId {
  if (typeof value !== "string") return false;
  return mergeTodoColorThemes(customThemes).some((theme) => theme.id === value);
}

export function readTodoColorThemeId(
  value: unknown,
  fallback: TodoColorThemeId = DEFAULT_TODO_COLOR_THEME_ID,
  customThemes?: unknown,
): TodoColorThemeId {
  if (isTodoColorThemeId(value, customThemes)) return value;
  if (isTodoColorThemeId(fallback, customThemes)) return fallback;
  return DEFAULT_TODO_COLOR_THEME_ID;
}

export function resolveTodoColorTheme(
  value: unknown,
  customThemes?: unknown,
): TodoColorTheme {
  const themes = mergeTodoColorThemes(customThemes);
  return themes.find((theme) => theme.id === value) ?? DEFAULT_TODO_COLOR_THEME;
}

export function resolveTodoAccentColor(
  colorTheme: TodoColorTheme,
  customAccentColor: string,
  customAccentOverridden: boolean,
): string {
  if (colorTheme.id === DEFAULT_TODO_COLOR_THEME_ID || customAccentOverridden) {
    return normalizeHexColor(customAccentColor, DEFAULT_TODO_COLOR_THEME.accent);
  }
  return colorTheme.accent;
}

export function upsertTodoColorTheme(
  customThemes: unknown,
  nextTheme: TodoColorTheme,
): TodoColorTheme[] {
  const normalized = normalizeTodoColorTheme(nextTheme);
  if (!normalized || isBuiltinTodoColorThemeId(normalized.id)) {
    return normalizeTodoColorThemes(customThemes);
  }

  const out = normalizeTodoColorThemes(customThemes).filter(
    (theme) => theme.id !== normalized.id,
  );
  out.push(normalized);
  return out.slice(0, MAX_CUSTOM_TODO_COLOR_THEMES);
}

export function removeTodoColorTheme(
  customThemes: unknown,
  id: TodoColorThemeId,
): TodoColorTheme[] {
  return normalizeTodoColorThemes(customThemes).filter((theme) => theme.id !== id);
}

export function createTodoColorThemeId(existingThemes: unknown): TodoColorThemeId {
  const existing = new Set(mergeTodoColorThemes(existingThemes).map((theme) => theme.id));
  const base = `custom-${Date.now().toString(36)}`;
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `custom-${Math.random().toString(36).slice(2, 10)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeThemeLabel(value: unknown, fallback: string): string {
  const trimmed = readString(value, fallback).trim();
  return trimmed ? trimmed.slice(0, 40) : fallback;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  const trimmed = readString(value, fallback).trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : fallback;
}

function normalizePanelValue(value: unknown, fallback: string): string {
  const trimmed = readString(value, fallback).trim();
  if (HEX_COLOR_RE.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const safeGradient =
    trimmed.length <= 180 &&
    lower.startsWith("linear-gradient(") &&
    trimmed.endsWith(")") &&
    !/[;{}\0]/.test(trimmed);
  return safeGradient ? trimmed : fallback;
}
