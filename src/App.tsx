import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import "allotment/dist/style.css";

import TodoPanel from "./components/todo/TodoPanel";
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
  const [systemDarkMode, setSystemDarkMode] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <TodoPanel />
      <SnackbarHost />
    </ThemeProvider>
  );
}
