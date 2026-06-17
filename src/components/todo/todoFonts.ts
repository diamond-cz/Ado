import { convertFileSrc } from "@tauri-apps/api/core";

import type { TodoFontEntry } from "../../lib/ipc";

export type { TodoFontEntry };

export const TODO_DEFAULT_FONT_ID = "";

const TODO_FONT_STYLE_ID = "aebox-todo-font-faces";
const TODO_FONT_FALLBACK =
  'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

export function ensureTodoFontsRegistered(fonts: TodoFontEntry[]) {
  if (typeof document === "undefined") return;
  let style = document.getElementById(TODO_FONT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = TODO_FONT_STYLE_ID;
    style.setAttribute("data-aebox-todo-fonts", "true");
    document.head.appendChild(style);
  }

  style.textContent = fonts
    .map((font) => {
      const family = cssString(todoFontFaceName(font.id));
      const url = cssString(convertFileSrc(font.path));
      return `@font-face{font-family:"${family}";src:url("${url}");font-display:swap;}`;
    })
    .join("\n");
}

export function todoFontCssFamily(
  fontId: string | null | undefined,
  fonts: TodoFontEntry[],
): string | undefined {
  const id = fontId?.trim();
  if (!id) return undefined;
  const font = fonts.find((entry) => entry.id === id);
  if (!font) return undefined;
  return `"${cssString(todoFontFaceName(font.id))}", ${TODO_FONT_FALLBACK}`;
}

export function todoFontFaceName(fontId: string): string {
  const stem = fontId.replace(/\.[^.]+$/, "");
  const readable = stem
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return `AeboxTodoFont_${readable || "font"}_${hashFontId(fontId)}`;
}

function hashFontId(input: string): string {
  let hash = 2166136261;
  for (let idx = 0; idx < input.length; idx += 1) {
    hash ^= input.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n|\r|\f/g, "");
}
