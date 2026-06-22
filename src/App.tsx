import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import "allotment/dist/style.css";

import TodoPanel from "./components/todo/TodoPanel";
import TodoWidgetWindow from "./components/todo/TodoWidgetWindow";
import { SnackbarHost } from "./components/SnackbarHost";
import { buildTheme } from "./theme";
import {
  TODO_SETTINGS_STORAGE_KEY,
  mergeTodoSettings,
  todoSettingsPayloadToState,
  todoSettingsStateToPayload,
  useStore,
} from "./state/store";
import { resolveTodoAccentColor, resolveTodoColorTheme } from "./lib/todoColorThemes";
import { ipc } from "./lib/ipc";

export default function App() {
  const todoThemeMode = useStore((s) => s.appSettings.todoThemeMode);
  const todoAccentColor = useStore((s) => s.appSettings.todoAccentColor);
  const todoAccentColorOverridden = useStore((s) => s.appSettings.todoAccentColorOverridden);
  const todoColorThemeId = useStore((s) => s.appSettings.todoColorTheme);
  const todoColorThemes = useStore((s) => s.appSettings.todoColorThemes);
  const hotkeyRecording = useStore((s) => s.hotkeyRecording);
  const todoWidgetHotkey = useStore((s) => s.hotkeys.todoWidget);
  const [systemDarkMode, setSystemDarkMode] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [appView] = useState(() => readBootstrapView());

  const effectiveMode =
    todoThemeMode === "system" ? (systemDarkMode ? "dark" : "light") : todoThemeMode;
  const todoColorTheme = useMemo(
    () => resolveTodoColorTheme(todoColorThemeId, todoColorThemes),
    [todoColorThemeId, todoColorThemes],
  );
  const effectiveAccentColor = resolveTodoAccentColor(
    todoColorTheme,
    todoAccentColor,
    todoAccentColorOverridden,
  );
  const todoPrepaintBg = effectiveMode === "dark" ? "#20293a" : todoColorTheme.surface;
  const theme = useMemo(
    () => buildTheme(effectiveMode, effectiveAccentColor),
    [effectiveAccentColor, effectiveMode],
  );

  useLayoutEffect(() => {
    document.documentElement.style.backgroundColor = todoPrepaintBg;
    document.documentElement.style.colorScheme = effectiveMode;
    document.documentElement.style.setProperty("--aebox-prepaint-bg", todoPrepaintBg);
  }, [effectiveMode, todoPrepaintBg]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDarkMode(mq.matches);
    const handler = (event: MediaQueryListEvent) => setSystemDarkMode(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    let alive = true;
    ipc
      .getTodoSettings()
      .then((cfg) => {
        if (!alive) return;
        const todoSettings = todoSettingsPayloadToState(cfg);
        const appSettings = mergeTodoSettings(useStore.getState().appSettings, todoSettings);
        useStore.setState({ appSettings });
        try {
          localStorage.setItem(
            TODO_SETTINGS_STORAGE_KEY,
            JSON.stringify(todoSettingsStateToPayload(todoSettings)),
          );
        } catch {
          /* localStorage sync is best-effort */
        }
      })
      .catch(() => {
        /* No settings file yet: defaults stay active. */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    ipc
      .getWindowSettings()
      .then((settings) => {
        if (!alive) return;
        useStore.setState({
          autostart: settings.autostart,
          closeToTray: settings.closeToTray,
        });
      })
      .catch(() => {
        /* Window settings are optional on first run. */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const shortcut = todoWidgetHotkey.trim();
    if (!shortcut || hotkeyRecording) return;
    let registered = false;

    register(shortcut, (event) => {
      if (event.state === "Pressed") {
        ipc.toggleTodoWidgetWindow().catch(() => {});
      }
    })
      .then(() => {
        registered = true;
      })
      .catch(() => {});

    return () => {
      if (registered) {
        unregister(shortcut).catch(() => {});
      }
    };
  }, [hotkeyRecording, todoWidgetHotkey]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {appView === "todo-widget" ? <TodoWidgetWindow /> : <TodoPanel />}
      <SnackbarHost />
    </ThemeProvider>
  );
}

function readBootstrapView(): "todo" | "todo-widget" {
  try {
    const bootstrap = (window as unknown as {
      __AEBOX_BOOTSTRAP__?: { view?: unknown };
    }).__AEBOX_BOOTSTRAP__;
    return bootstrap?.view === "todo-widget" ? "todo-widget" : "todo";
  } catch {
    return "todo";
  }
}
