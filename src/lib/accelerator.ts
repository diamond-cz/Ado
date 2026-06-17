// Helpers for working with Tauri-style accelerator strings
// ("Control+Shift+A", "Alt+Space", "F8") in the browser.
//
// Shared between the settings recorder (ShortcutInput) and the in-webview
// fallback handler (App.tsx) — the latter exists because Windows reserves
// Alt+Space for the system menu, and Tauri's global-shortcut plugin can't
// always reliably intercept it. When the launcher window has focus we
// catch the keydown ourselves, preventDefault the system menu, and run
// the same action the global shortcut would.

export function isModifierCode(code: string): boolean {
  return (
    code === "ControlLeft" ||
    code === "ControlRight" ||
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "AltLeft" ||
    code === "AltRight" ||
    code === "MetaLeft" ||
    code === "MetaRight"
  );
}

// Browser KeyboardEvent.code → accelerator main-key. Covers letters,
// digits, arrows, function keys, common punctuation. Unknowns map to
// themselves.
export function eventCodeToKey(code: string, key: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("F") && /^F\d{1,2}$/.test(code)) return code;
  if (code.startsWith("Arrow")) return code;
  if (code.startsWith("Numpad")) return code;
  const map: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Escape: "Escape",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
  };
  if (map[code]) return map[code];
  if (key && key.length === 1) return key.toUpperCase();
  return null;
}

const STANDALONE_SHORTCUT_KEYS = new Set([
  "backspace",
  "delete",
  "enter",
  "escape",
  "tab",
  "home",
  "end",
  "pageup",
  "pagedown",
  "insert",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

export function isStandaloneShortcutKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return /^f\d{1,2}$/.test(normalized) || STANDALONE_SHORTCUT_KEYS.has(normalized);
}

// Build the accelerator string for a KeyboardEvent, or null if the event
// is just a modifier press / not a usable combo. Returns the canonical
// form used elsewhere in the app: "Control+Shift+A".
export function eventToAccelerator(
  event: KeyboardEvent,
  options: { allowSingleKey?: boolean } = {},
): string | null {
  if (isModifierCode(event.code)) return null;
  const key = eventCodeToKey(event.code, event.key);
  if (!key) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  const isFKey = /^F\d{1,2}$/.test(key);
  if (parts.length === 0 && !isFKey && !(options.allowSingleKey && isStandaloneShortcutKey(key))) {
    return null;
  }
  parts.push(key);
  return parts.join("+");
}

// Normalize accelerator strings so canonical variants compare equal:
// modifiers sorted, lowercase, CommandOrControl→control, Super→meta.
export function normalizeAccelerator(accel: string): string {
  const trimmed = accel.trim();
  if (!trimmed) return "";
  const parts = trimmed
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lower = p.toLowerCase();
      if (lower === "commandorcontrol") return "control";
      if (lower === "super") return "meta";
      return lower;
    });
  if (parts.length === 0) return "";
  const last = parts.pop()!;
  parts.sort();
  return [...parts, last].join("+");
}

export function acceleratorsMatch(a: string, b: string): boolean {
  const na = normalizeAccelerator(a);
  if (!na) return false;
  return na === normalizeAccelerator(b);
}
