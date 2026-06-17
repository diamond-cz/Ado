import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import FiberManualRecordRoundedIcon from "@mui/icons-material/FiberManualRecordRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import {
  isRegistered as isShortcutRegistered,
  unregister as unregisterShortcut,
} from "@tauri-apps/plugin-global-shortcut";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { useStore } from "../state/store";
import { eventCodeToKey, isModifierCode, isStandaloneShortcutKey } from "../lib/accelerator";

// Accelerator format mirrors Tauri's global-shortcut plugin:
// "Modifier+Modifier+Key" with modifiers in {Control, Shift, Alt, Meta}.
// The frontend renders Control as "Ctrl" and Meta as "Win" for Windows users.

const MODIFIER_LABELS: Record<string, string> = {
  Control: "Ctrl",
  CommandOrControl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Meta: "Win",
  Super: "Win",
};

const VALID_MODIFIERS = new Set([
  "Control",
  "CommandOrControl",
  "Shift",
  "Alt",
  "Meta",
  "Super",
]);

function parseAccelerator(accel: string): string[] {
  if (!accel) return [];
  return accel
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => MODIFIER_LABELS[part] ?? part);
}

// Loose validation: must contain at least one "+" (i.e. modifier + key) OR be
// an F-key. We don't try to be exhaustive here — Tauri will reject anything
// genuinely malformed at register time.
function looksLikeAccelerator(s: string, allowSingleKey = false): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (/^F\d{1,2}$/.test(trimmed)) return true;
  const parts = trimmed.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return allowSingleKey && isStandaloneShortcutKey(parts[0]);
  if (parts.length < 2) return false;
  // Every part except the last must be a known modifier.
  const mods = parts.slice(0, -1);
  if (!mods.every((m) => VALID_MODIFIERS.has(m))) return false;
  // Last part — a single key, F-key, or named key.
  const last = parts[parts.length - 1];
  return last.length >= 1 && !VALID_MODIFIERS.has(last);
}

interface ShortcutInputProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  conflict?: boolean;
  conflictMessage?: string;
  allowSingleKey?: boolean;
  onChange: (next: string) => void;
}

export function ShortcutInput({
  value,
  placeholder,
  disabled,
  conflict,
  conflictMessage,
  allowSingleKey = false,
  onChange,
}: ShortcutInputProps) {
  const [recording, setRecording] = useState(false);
  // True while we're synchronously releasing the OS-level RegisterHotKey
  // locks on every currently configured hotkey. Without this gating step
  // there's a ~100ms race where the user can press the same combo that
  // was just bound and the OS hands the keystroke to the existing
  // callback instead of our keydown listener — which is exactly what
  // made Alt+Space "not very responsive". See the comment in
  // `startRecording` for the full chain.
  const [preparing, setPreparing] = useState(false);
  // Manual text-entry mode — needed for combos like Ctrl+Space that the IME
  // intercepts before the keydown event reaches the browser.
  const [manualMode, setManualMode] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const setHotkeyRecording = useStore((s) => s.setHotkeyRecording);

  // Mirror the local recording / manual flags into the app-wide store so
  // App.tsx can unregister all global shortcuts for the duration. Without
  // this, the OS-level interception (e.g. the Alt+Space binding for the
  // search launcher) swallows the keydown before our recorder sees it.
  useEffect(() => {
    setHotkeyRecording(recording || manualMode || preparing);
    return () => {
      setHotkeyRecording(false);
    };
  }, [recording, manualMode, preparing, setHotkeyRecording]);

  const chips = parseAccelerator(value);

  const stopRecording = useCallback(() => setRecording(false), []);

  const startRecording = useCallback(async () => {
    if (disabled) return;
    setManualMode(false);
    // Race fix for "Alt+Space recording isn't responsive":
    //
    //   1. The plugin uses RegisterHotKey under the hood. Once a combo
    //      is bound the OS sends the keystroke to the bound callback
    //      and the focused window never sees a WM_KEYDOWN.
    //   2. App.tsx's effect *does* unregister on `hotkeyRecording`
    //      becoming true, but only via async IPC on the next render
    //      tick. A fast user can press the key during the gap.
    //
    // Eagerly unregister every known accelerator here, awaiting the
    // IPC roundtrip before we attach the keydown listener. `preparing`
    // also flips `hotkeyRecording` in the store so App.tsx skips
    // re-registering during the gap.
    setPreparing(true);
    try {
      const { hotkeys } = useStore.getState();
      const accels = Array.from(
        new Set(
          (Object.values(hotkeys) as string[])
            .map((a) => a.trim())
            .filter(Boolean),
        ),
      );
      await Promise.all(
        accels.map(async (a) => {
          try {
            if (await isShortcutRegistered(a)) {
              await unregisterShortcut(a);
            }
          } catch {
            // Best-effort: a stale registration error here is harmless,
            // the keydown listener works regardless.
          }
        }),
      );
    } finally {
      setPreparing(false);
      setRecording(true);
    }
  }, [disabled]);

  const startManual = useCallback(() => {
    if (disabled) return;
    setRecording(false);
    setManualDraft(value);
    setManualError(null);
    setManualMode(true);
  }, [disabled, value]);

  const commitManual = useCallback(() => {
    const next = manualDraft.trim();
    if (!next) {
      onChange("");
      setManualMode(false);
      setManualError(null);
      return;
    }
    if (!looksLikeAccelerator(next, allowSingleKey)) {
      setManualError("格式示例: Control+Space / Alt+Shift+S / F8");
      return;
    }
    onChange(next);
    setManualMode(false);
    setManualError(null);
  }, [allowSingleKey, manualDraft, onChange]);

  const cancelManual = useCallback(() => {
    setManualMode(false);
    setManualError(null);
  }, []);

  useEffect(() => {
    if (manualMode) {
      manualInputRef.current?.focus();
      manualInputRef.current?.select();
    }
  }, [manualMode]);

  // While recording, swallow every keydown the window receives and assemble
  // the accelerator. First non-modifier key commits the combo. Escape cancels.
  //
  // Edge case: Ctrl+Space on Windows with Chinese IME — IME consumes the
  // Space keydown before the browser sees it (it's the default IME toggle
  // shortcut). We work around this two ways:
  //   1. Also listen on keyup — IME usually lets keyup through even when it
  //      ate the keydown.
  //   2. Listen on compositionstart — fires when the IME activates. If it
  //      triggers while a modifier is held, infer the combo from the
  //      tracked modifier state plus Space.
  useEffect(() => {
    if (!recording) return;
    // Tracks the most recent modifier state seen on keydown — needed for the
    // compositionstart fallback, which carries no key info itself.
    let lastMods = { ctrl: false, shift: false, alt: false, meta: false };
    let committed = false;

    const commit = (parts: string[]) => {
      if (committed) return;
      committed = true;
      onChange(parts.join("+"));
      stopRecording();
    };

    const handleKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        stopRecording();
        return;
      }
      // Track modifier state on every event so the IME fallback has fresh data.
      lastMods = {
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      };
      if (isModifierCode(event.code)) return;
      // event.key === "Process" means the IME is mid-composition; the code
      // still carries the physical key, so we can recover the real binding.
      const key = eventCodeToKey(event.code, event.key);
      if (!key) return;
      const parts: string[] = [];
      if (event.ctrlKey) parts.push("Control");
      if (event.shiftKey) parts.push("Shift");
      if (event.altKey) parts.push("Alt");
      if (event.metaKey) parts.push("Meta");
      const isFKey = /^F\d{1,2}$/.test(key);
      if (parts.length === 0 && !isFKey && !(allowSingleKey && isStandaloneShortcutKey(key))) {
        return;
      }
      parts.push(key);
      commit(parts);
    };

    const handleComposition = (event: CompositionEvent) => {
      event.preventDefault();
      // IME woke up while we were recording. The only common path to this
      // during a hotkey capture is Ctrl+Space (the IME toggle). Require at
      // least one modifier so we don't false-positive on a plain Space.
      if (!lastMods.ctrl && !lastMods.alt && !lastMods.shift && !lastMods.meta) return;
      const parts: string[] = [];
      if (lastMods.ctrl) parts.push("Control");
      if (lastMods.shift) parts.push("Shift");
      if (lastMods.alt) parts.push("Alt");
      if (lastMods.meta) parts.push("Meta");
      parts.push("Space");
      commit(parts);
    };

    window.addEventListener("keydown", handleKey, { capture: true });
    window.addEventListener("keyup", handleKey, { capture: true });
    window.addEventListener("compositionstart", handleComposition, { capture: true });

    // Rust-side fallback for Alt+<key> combos that the WebView2 host
    // doesn't deliver to JS. When the user presses Alt first then Space
    // (or any Alt+letter), Windows fires WM_SYSKEYDOWN which WebView2
    // treats as a host accelerator and skips the page entirely — no JS
    // keydown ever fires. Our WndProc subclass catches the resulting
    // SC_KEYMENU and emits this event with the OS-decoded character.
    let unlistenSysKey: UnlistenFn | null = null;
    let disposed = false;
    listen<{ ch: number }>("syskey:alt", (event) => {
      const ch = event.payload.ch;
      if (ch === 0) return; // Alt alone — not a recordable combo.
      let key: string | null = null;
      if (ch === 0x20) key = "Space";
      else if (ch >= 0x41 && ch <= 0x5a) key = String.fromCharCode(ch); // A–Z
      else if (ch >= 0x61 && ch <= 0x7a) key = String.fromCharCode(ch).toUpperCase();
      else if (ch >= 0x30 && ch <= 0x39) key = String.fromCharCode(ch); // 0–9
      if (!key) return;
      // The OS only fires SC_KEYMENU when Alt is held, so Alt is always
      // a modifier here. The user may also have Ctrl/Shift held; we
      // don't get that info from SC_KEYMENU lParam, so we fall back to
      // last-known modifier state.
      const parts: string[] = [];
      if (lastMods.ctrl) parts.push("Control");
      if (lastMods.shift) parts.push("Shift");
      parts.push("Alt");
      if (lastMods.meta) parts.push("Meta");
      parts.push(key);
      commit(parts);
    }).then((fn) => {
      if (disposed) fn();
      else unlistenSysKey = fn;
    });

    return () => {
      window.removeEventListener("keydown", handleKey, { capture: true });
      window.removeEventListener("keyup", handleKey, { capture: true });
      window.removeEventListener("compositionstart", handleComposition, { capture: true });
      disposed = true;
      if (unlistenSysKey) unlistenSysKey();
    };
  }, [allowSingleKey, recording, onChange, stopRecording]);

  const handleClear = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onChange("");
    },
    [onChange],
  );

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flex: 1 }}>
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 38,
          display: "flex",
          alignItems: "center",
          gap: 0.6,
          px: 1.3,
          py: 0.6,
          borderRadius: 1.2,
          border: 1,
          borderColor: recording || manualMode
            ? (theme) => alpha(theme.palette.primary.main, 0.7)
            : conflict
              ? (theme) => alpha(theme.palette.error.main, 0.7)
              : "divider",
          bgcolor: "transparent",
          transition: "border-color 120ms ease",
        }}
      >
        {manualMode ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%" }}>
            <TextField
              inputRef={manualInputRef}
              value={manualDraft}
              onChange={(e) => {
                setManualDraft(e.target.value);
                if (manualError) setManualError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitManual();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelManual();
                }
              }}
              placeholder="Control+Space"
              variant="standard"
              fullWidth
              error={Boolean(manualError)}
              helperText={manualError ?? undefined}
              slotProps={{
                input: { disableUnderline: true, sx: { fontSize: 13 } },
                formHelperText: { sx: { fontSize: 11, mx: 0, mt: 0.2 } },
              }}
            />
            <Button size="small" onClick={commitManual} sx={{ minWidth: 48, fontWeight: 700 }}>
              确定
            </Button>
            <IconButton size="small" onClick={cancelManual}>
              <CloseRoundedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ) : recording ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "primary.main" }}>
            <FiberManualRecordRoundedIcon sx={{ fontSize: 12 }} />
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
              按下组合键... (Esc 取消)
            </Typography>
          </Box>
        ) : preparing ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>准备中...</Typography>
          </Box>
        ) : chips.length > 0 ? (
          <>
            {chips.map((chip, idx) => (
              <KeyChip key={`${chip}-${idx}`} label={chip} />
            ))}
            <Box sx={{ flex: 1 }} />
            {conflict && (
              <Tooltip title={conflictMessage ?? "与其他快捷键冲突，请更换"} arrow>
                <ErrorOutlineRoundedIcon
                  sx={{ fontSize: 18, color: "error.main", mr: 0.2 }}
                />
              </Tooltip>
            )}
            <IconButton size="small" onClick={handleClear} title="清除快捷键" sx={{ ml: 0.5 }}>
              <CloseRoundedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </>
        ) : (
          <Typography sx={{ fontSize: 12, color: "text.secondary", flex: 1 }}>
            {placeholder ?? "未设置"}
          </Typography>
        )}
      </Box>
      {!manualMode && (
        <Tooltip title="手动输入（适用于 IME 拦截的组合键）">
          <span>
            <IconButton
              size="small"
              onClick={startManual}
              disabled={disabled || recording || preparing}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}
            >
              <EditRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      )}
      <Button
        variant={recording ? "contained" : "outlined"}
        size="small"
        disabled={disabled || manualMode || preparing}
        onClick={recording ? stopRecording : startRecording}
        sx={{
          minWidth: 64,
          fontWeight: 700,
          ...(recording
            ? {
                bgcolor: "primary.main",
                "&:hover": { bgcolor: "primary.dark" },
              }
            : {}),
        }}
      >
        {recording ? "停止" : "录制"}
      </Button>
    </Box>
  );
}

function KeyChip({ label }: { label: string }) {
  return (
    <Box
      sx={{
        px: 1,
        py: 0.2,
        minWidth: 28,
        textAlign: "center",
        borderRadius: 0.8,
        border: 1,
        borderColor: "divider",
        bgcolor: alpha("#f8fafc", 0.08),
        fontSize: 12,
        fontWeight: 600,
        fontFamily:
          "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
        color: "text.primary",
        boxShadow: "none",
      }}
    >
      {label}
    </Box>
  );
}
