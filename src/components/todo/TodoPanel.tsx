// Root component for the standalone Todo window (`appView === "todo"`).
//
// Layout: top drag strip (Tauri windows are decorations=false) + sidebar
// on the left + task detail on the right. The store hydrates from
// SQLite-backed todo IPC on mount and persists via the debounced
// `scheduleSave` inside `useTodoStore`.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import FilterNoneIcon from "@mui/icons-material/FilterNone";
import MinimizeIcon from "@mui/icons-material/Minimize";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import TimerRoundedIcon from "@mui/icons-material/TimerRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { Allotment } from "allotment";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { collectAllTags, useTodoStore } from "./useTodoStore";
import { TodoSidebar } from "./TodoSidebar";
import { QuickAddTodoInput, TodoDetail } from "./TodoDetail";
import { TodoEditor } from "./TodoEditor";
import { TodoCalendar } from "./TodoCalendar";
import { TodoPomodoro } from "./TodoPomodoro";
import { QuadrantView } from "./QuadrantView";
import { TodoQuickSearch } from "./TodoQuickSearch";
import { TodoSettingsView } from "./TodoSettingsView";
import { TodoIdlePaperOverlay } from "./TodoIdlePaperOverlay";
import type { TodoItemContextTarget } from "./TodoItem";
import { listTodoFonts } from "./todoIpc";
import {
  ensureTodoFontsRegistered,
  todoFontCssFamily,
  type TodoFontEntry,
} from "./todoFonts";
import { useTodoReminders } from "./todoReminders";
import { listenTodoPomodoroStart } from "./todoPomodoroEvents";
import {
  DEFAULT_TODO_COLOR_THEME_ID,
  resolveTodoColorTheme,
} from "../../lib/todoColorThemes";
import { acceleratorsMatch, eventToAccelerator } from "../../lib/accelerator";
import {
  POMODORO_TIMER_STATE_CHANGED_EVENT,
  clampDurationMinutes,
  pomodoroElapsedMs,
  pomodoroTaskTitle,
  readPomodoroTimerState,
  switchRunningPomodoroFocus,
  usePomodoroDataHydration,
  usePomodoroCompletionNotification,
  type PomodoroTimerState,
} from "./todoPomodoroTimer";
import { useStore } from "../../state/store";
import type { TodoGroup, TodoItem as TodoItemT } from "./types";

const SPLIT_KEY = "aebox.todo.splitSizes";
const CONTENT_SPLIT_KEY = "aebox.todo.contentSplitSizes";
const NAV_RAIL_ORDER_KEY = "aebox.todo.navRailOrder";
const POMODORO_RUNNING_ICON_COLOR = "#f87171";
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const TODO_DRAG_TITLEBAR_HEIGHT = 20;
const TODO_DAY_MS = 24 * 60 * 60 * 1000;

type TodoRailView = "tasks" | "calendar" | "quadrant" | "pomodoro" | "settings";
type TodoRailAction = "tasks" | "calendar" | "quadrant" | "pomodoro" | "search";

const DEFAULT_NAV_RAIL_ORDER: TodoRailAction[] = [
  "tasks",
  "calendar",
  "quadrant",
  "pomodoro",
  "search",
];
const NAV_RAIL_ACTION_SET = new Set<string>(DEFAULT_NAV_RAIL_ORDER);

function pomodoroRunningForRail(state: PomodoroTimerState | null): boolean {
  if (!state?.running) return false;
  if (state.mode !== "pomodoro") return true;
  return pomodoroElapsedMs(state) < clampDurationMinutes(state.durationMinutes) * 60 * 1000;
}

function pomodoroRailRefreshDelayMs(state: PomodoroTimerState | null): number | null {
  if (!state?.running || state.mode !== "pomodoro") return null;
  const remainingMs =
    clampDurationMinutes(state.durationMinutes) * 60 * 1000 - pomodoroElapsedMs(state);
  if (remainingMs <= 0) return null;
  return Math.min(remainingMs + 100, MAX_TIMER_DELAY_MS);
}

function readSplitSizes(): number[] | undefined {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((n) => typeof n === "number")) {
      return parsed;
    }
  } catch {
    /* malformed — fall through */
  }
  return undefined;
}

function readContentSplitSizes(): number[] | undefined {
  try {
    const raw = localStorage.getItem(CONTENT_SPLIT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 2 && parsed.every((n) => typeof n === "number")) {
        return parsed;
      }
    }
  } catch {
    /* malformed - fall through */
  }
  const splitSizes = readSplitSizes();
  return splitSizes ? [splitSizes[1], splitSizes[2]] : undefined;
}

function saveContentSplitSizes(sizes: number[]) {
  if (sizes.length !== 2) return;
  try {
    localStorage.setItem(CONTENT_SPLIT_KEY, JSON.stringify(sizes));
  } catch {
    /* localStorage may be disabled */
  }
}

function isTodoRailAction(value: unknown): value is TodoRailAction {
  return typeof value === "string" && NAV_RAIL_ACTION_SET.has(value);
}

function normalizeNavRailOrder(value: unknown): TodoRailAction[] {
  const next: TodoRailAction[] = [];
  const seen = new Set<TodoRailAction>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isTodoRailAction(item) || seen.has(item)) continue;
      next.push(item);
      seen.add(item);
    }
  }
  for (const item of DEFAULT_NAV_RAIL_ORDER) {
    if (seen.has(item)) continue;
    next.push(item);
  }
  return next;
}

function readNavRailOrder(): TodoRailAction[] {
  try {
    const raw = localStorage.getItem(NAV_RAIL_ORDER_KEY);
    return normalizeNavRailOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_NAV_RAIL_ORDER;
  }
}

function saveNavRailOrder(order: TodoRailAction[]) {
  try {
    localStorage.setItem(NAV_RAIL_ORDER_KEY, JSON.stringify(normalizeNavRailOrder(order)));
  } catch {
    /* localStorage may be disabled */
  }
}

type TodoQuickCreateRequest =
  | { kind: "task" }
  | { kind: "child"; parentId: string };

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], .ProseMirror",
    ),
  );
}

function isOverlayShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest(".MuiMenu-root, .MuiPopover-root, .MuiDialog-root"));
}

function formatShortcutLabel(accelerator: string): string | undefined {
  const trimmed = accelerator.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split("+")
    .map((part) => {
      const key = part.trim();
      if (key === "Control" || key === "CommandOrControl") return "Ctrl";
      if (key === "Meta" || key === "Super") return "Win";
      return key;
    })
    .filter(Boolean)
    .join("+");
}

function selectedShortcutItems(state: ReturnType<typeof useTodoStore.getState>): TodoItemT[] {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const ids =
    state.multiSelectedItemIds.length > 0
      ? state.multiSelectedItemIds
      : state.selectedItemId != null
        ? [state.selectedItemId]
        : [];
  const seen = new Set<string>();
  const items: TodoItemT[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = byId.get(id);
    if (!item || item.deletedAt != null) continue;
    items.push(item);
  }
  return items;
}

function compareTodoGroupOrder(a: TodoGroup, b: TodoGroup): number {
  return a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name);
}

function startOfTodayMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export default function TodoPanel() {
  const theme = useTheme();
  const isMobileLayout = useMediaQuery(theme.breakpoints.down("sm"));
  const isDark = theme.palette.mode === "dark";
  const hydrate = useTodoStore((s) => s.hydrate);
  const reload = useTodoStore((s) => s.reload);
  const flush = useTodoStore((s) => s.flush);
  const selectedFilter = useTodoStore((s) => s.selectedFilter);
  const setSelectedFilter = useTodoStore((s) => s.setSelectedFilter);
  const items = useTodoStore((s) => s.items);
  const groups = useTodoStore((s) => s.groups);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const undoTodo = useTodoStore((s) => s.undo);
  const redoTodo = useTodoStore((s) => s.redo);
  const [activeView, setActiveView] = useState<TodoRailView>(() =>
    selectedFilter.kind === "calendar"
      ? "calendar"
      : selectedFilter.kind === "quadrant"
        ? "quadrant"
        : "tasks",
  );
  const [navRailOrder, setNavRailOrder] = useState<TodoRailAction[]>(readNavRailOrder);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [quickCreate, setQuickCreate] = useState<TodoQuickCreateRequest | null>(null);
  const [pomodoroItemId, setPomodoroItemId] = useState<string | null>(null);
  const [pendingPomodoroSwitch, setPendingPomodoroSwitch] = useState<{
    currentItemId: string | null;
    nextItemId: string | null;
  } | null>(null);
  const calendarMode = activeView === "calendar";
  const quadrantMode = activeView === "quadrant";
  const pomodoroMode = activeView === "pomodoro";
  const settingsMode = activeView === "settings";
  const scrollbarTimersRef = useRef<Map<HTMLElement, number>>(new Map());
  const [pomodoroRunning, setPomodoroRunning] = useState(() =>
    pomodoroRunningForRail(readPomodoroTimerState()),
  );
  useTodoReminders();
  usePomodoroDataHydration();
  usePomodoroCompletionNotification();
  const todoColorThemeId = useStore((s) => s.appSettings.todoColorTheme);
  const todoColorThemes = useStore((s) => s.appSettings.todoColorThemes);
  const todoFontFamily = useStore((s) => s.appSettings.todoFontFamily);
  const todoIdlePaperEffectEnabled = useStore((s) => s.appSettings.todoIdlePaperEffectEnabled);
  const todoIdlePaperLightEffect = useStore((s) => s.appSettings.todoIdlePaperLightEffect);
  const todoShortcuts = useStore((s) => s.appSettings.todoShortcuts);
  const hotkeyRecording = useStore((s) => s.hotkeyRecording);
  const [todoFonts, setTodoFonts] = useState<TodoFontEntry[]>([]);
  const allTags = useMemo(() => collectAllTags(items), [items]);
  const selectedListGroups = useMemo(
    () =>
      selectedFilter.kind === "list"
        ? groups
            .filter((group) => group.listId === selectedFilter.id)
            .sort(compareTodoGroupOrder)
        : [],
    [groups, selectedFilter],
  );
  const quickCreateParent = useMemo(
    () =>
      quickCreate?.kind === "child"
        ? items.find((item) => item.id === quickCreate.parentId && item.deletedAt == null) ??
          null
        : null,
    [items, quickCreate],
  );
  const quickCreateOpen = quickCreate != null && (quickCreate.kind !== "child" || quickCreateParent != null);

  useEffect(() => {
    if (quickCreate?.kind === "child" && quickCreateParent == null) {
      setQuickCreate(null);
    }
  }, [quickCreate, quickCreateParent]);

  useEffect(() => {
    if (activeView === "pomodoro" || activeView === "settings") return;
    const nextView =
      selectedFilter.kind === "calendar"
        ? "calendar"
        : selectedFilter.kind === "quadrant"
          ? "quadrant"
          : "tasks";
    if (nextView !== activeView) {
      setActiveView(nextView);
    }
  }, [activeView, selectedFilter.kind]);

  const openPomodoroFocus = useCallback((itemId: string | null) => {
    setPomodoroItemId(itemId);
    setActiveView("pomodoro");
  }, []);

  const requestPomodoroFocus = useCallback(
    (itemId: string | null) => {
      const timerState = readPomodoroTimerState();
      if (
        timerState?.running &&
        timerState.activeItemId !== itemId
      ) {
        setPendingPomodoroSwitch({
          currentItemId: timerState.activeItemId,
          nextItemId: itemId,
        });
        return;
      }
      openPomodoroFocus(itemId);
    },
    [openPomodoroFocus],
  );

  useEffect(
    () =>
      listenTodoPomodoroStart((detail) => {
        requestPomodoroFocus(detail.itemId ?? null);
      }),
    [requestPomodoroFocus],
  );

  const openTasksView = useCallback(() => {
    setSearchOpen(false);
    setActiveView("tasks");
    if (selectedFilter.kind === "calendar" || selectedFilter.kind === "quadrant") {
      setSelectedFilter({ kind: "today" });
    }
  }, [selectedFilter.kind, setSelectedFilter]);

  const openCalendarView = useCallback(() => {
    setSearchOpen(false);
    setActiveView("calendar");
    setSelectedFilter({ kind: "calendar" });
  }, [setSelectedFilter]);

  const openQuadrantView = useCallback(() => {
    setSearchOpen(false);
    setActiveView("quadrant");
    setSelectedFilter({ kind: "quadrant" });
  }, [setSelectedFilter]);

  const openPomodoroView = useCallback(() => {
    setSearchOpen(false);
    setActiveView("pomodoro");
  }, []);

  const openSettingsView = useCallback(() => {
    setSearchOpen(false);
    setActiveView("settings");
  }, []);

  const openTodoSearch = useCallback(() => {
    if (searchOpen) {
      setSearchFocusRequest((value) => value + 1);
      return;
    }
    setSearchOpen(true);
  }, [searchOpen]);

  const openMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(true);
  }, []);

  const openTodoContextTarget = useCallback(
    (target: TodoItemContextTarget) => {
      if (target.kind === "folder") {
        setSelectedFilter({ kind: "folder", id: target.id });
        return;
      }
      if (target.kind === "list") {
        setSelectedFilter({ kind: "list", id: target.id });
        return;
      }
      setSelectedFilter({ kind: "list", id: target.listId });
    },
    [setSelectedFilter],
  );

  const openQuickCreateTask = useCallback(() => {
    setQuickCreate({ kind: "task" });
  }, []);

  const openQuickCreateChild = useCallback(() => {
    const state = useTodoStore.getState();
    const targets = selectedShortcutItems(state);
    const parent = targets[0] ?? null;
    if (!parent) return;
    const todayStart = startOfTodayMs();
    const todayDueAt =
      state.selectedFilter.kind === "today"
        ? parent.dueAt != null && parent.dueAt >= todayStart && parent.dueAt < todayStart + TODO_DAY_MS
          ? parent.dueAt
          : todayStart
        : null;
    const child = state.addItem(parent.listId, "", {
      parentId: parent.id,
      allowEmpty: true,
      dueAt: todayDueAt,
    });
    if (child) {
      state.setSelectedItemId(child.id);
    }
  }, []);

  const deleteSelectedTodos = useCallback(() => {
    const state = useTodoStore.getState();
    const targets = selectedShortcutItems(state);
    state.deleteItems(targets.map((target) => target.id));
  }, []);

  const completeSelectedTodos = useCallback(() => {
    const state = useTodoStore.getState();
    const targets = selectedShortcutItems(state);
    state.setItemsStatus(targets.map((target) => target.id), "completed");
  }, []);

  const openRailAction = useCallback(
    (action: TodoRailAction) => {
      switch (action) {
        case "tasks":
          openTasksView();
          return;
        case "calendar":
          openCalendarView();
          return;
        case "quadrant":
          openQuadrantView();
          return;
        case "pomodoro":
          openPomodoroView();
          return;
        case "search":
          openTodoSearch();
          return;
      }
    },
    [
      openCalendarView,
      openPomodoroView,
      openQuadrantView,
      openTasksView,
      openTodoSearch,
    ],
  );

  useEffect(() => {
    let refreshTimer: number | null = null;
    const clearRefreshTimer = () => {
      if (refreshTimer == null) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    };
    const refreshPomodoroRunning = () => {
      clearRefreshTimer();
      const state = readPomodoroTimerState();
      setPomodoroRunning(pomodoroRunningForRail(state));
      const delay = pomodoroRailRefreshDelayMs(state);
      if (delay != null) {
        refreshTimer = window.setTimeout(refreshPomodoroRunning, delay);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshPomodoroRunning();
    };

    refreshPomodoroRunning();
    window.addEventListener(POMODORO_TIMER_STATE_CHANGED_EVENT, refreshPomodoroRunning);
    window.addEventListener("focus", refreshPomodoroRunning);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearRefreshTimer();
      window.removeEventListener(POMODORO_TIMER_STATE_CHANGED_EVENT, refreshPomodoroRunning);
      window.removeEventListener("focus", refreshPomodoroRunning);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (hotkeyRecording) return;
      const accelerator = eventToAccelerator(event, { allowSingleKey: true });
      if (!accelerator) return;
      const primaryModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const editableTarget = isEditableShortcutTarget(event.target);
      const matchesTodoShortcut = (shortcut: string) =>
        Boolean(shortcut.trim() && acceleratorsMatch(accelerator, shortcut));
      const todoActionShortcut = Object.values(todoShortcuts).some(matchesTodoShortcut);

      if (
        isOverlayShortcutTarget(event.target) ||
        quickCreate != null ||
        searchOpen ||
        (editableTarget && !todoActionShortcut)
      ) {
        return;
      }

      if (matchesTodoShortcut(todoShortcuts.delete)) {
        const targets = selectedShortcutItems(useTodoStore.getState());
        if (targets.length === 0) return;
        deleteSelectedTodos();
      } else if (matchesTodoShortcut(todoShortcuts.redo)) {
        redoTodo();
      } else if (matchesTodoShortcut(todoShortcuts.undo)) {
        undoTodo();
      } else if (matchesTodoShortcut(todoShortcuts.createTask)) {
        openQuickCreateTask();
      } else if (matchesTodoShortcut(todoShortcuts.createChild)) {
        const targets = selectedShortcutItems(useTodoStore.getState());
        if (targets.length === 0) return;
        openQuickCreateChild();
      } else if (matchesTodoShortcut(todoShortcuts.complete)) {
        const targets = selectedShortcutItems(useTodoStore.getState());
        if (targets.length === 0) return;
        completeSelectedTodos();
      } else if (matchesTodoShortcut(todoShortcuts.search)) {
        openTodoSearch();
      } else if (
        primaryModifier &&
        /^[1-9]$/.test(key) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        const action = navRailOrder[Number(key) - 1];
        if (!action) return;
        openRailAction(action);
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    completeSelectedTodos,
    deleteSelectedTodos,
    hotkeyRecording,
    navRailOrder,
    openQuickCreateChild,
    openQuickCreateTask,
    openRailAction,
    openTodoSearch,
    quickCreate,
    redoTodo,
    searchOpen,
    todoShortcuts,
    undoTodo,
  ]);

  const revealScrollbars = useCallback((event: UIEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const timers = scrollbarTimersRef.current;
    const existingTimer = timers.get(target);
    if (existingTimer != null) {
      window.clearTimeout(existingTimer);
    }

    target.classList.add("todo-scrollbar-visible");
    const timer = window.setTimeout(() => {
      target.classList.remove("todo-scrollbar-visible");
      timers.delete(target);
    }, 800);
    timers.set(target, timer);
  }, []);

  useEffect(() => {
    return () => {
      for (const [element, timer] of scrollbarTimersRef.current) {
        window.clearTimeout(timer);
        element.classList.remove("todo-scrollbar-visible");
      }
      scrollbarTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (isMobileLayout) {
      setMobileSidebarOpen(false);
    }
  }, [isMobileLayout, selectedFilter]);

  useEffect(() => {
    let cancelled = false;
    listTodoFonts()
      .then((fonts) => {
        if (cancelled) return;
        setTodoFonts(fonts);
        ensureTodoFontsRegistered(fonts);
      })
      .catch((err) => {
        console.error("[todo] list fonts failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [todoFontFamily]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listen("todo:data-changed", () => {
      void reload();
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch((err) => {
        console.error("[todo] listen todo:data-changed failed:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reload]);

  // Best-effort: flush pending saves when the window is hidden/closed so
  // we don't lose the last debounced edit.
  useEffect(() => {
    const handler = () => {
      flush().catch(() => {});
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    };
  }, [flush]);

  const colorTheme = useMemo(
    () => resolveTodoColorTheme(todoColorThemeId, todoColorThemes),
    [todoColorThemeId, todoColorThemes],
  );
  const todoFontCss = useMemo(
    () => todoFontCssFamily(todoFontFamily, todoFonts),
    [todoFontFamily, todoFonts],
  );
  const surfaceBg = isDark ? "#20293a" : colorTheme.surface;
  const cardBg = isDark ? "#20293a" : colorTheme.content;
  const railBg = isDark ? "#18202d" : colorTheme.panel;
  const columnDividerColor = alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.045 : 0.032);
  const columnDividerActiveColor = alpha(theme.palette.primary.main, isDark ? 0.34 : 0.24);
  const railActiveIconColor =
    colorTheme.id === DEFAULT_TODO_COLOR_THEME_ID ? theme.palette.primary.main : "#fff";
  const secondaryColumnBg = isDark ? "#20293a" : colorTheme.middle;
  const contentColumnBg = isDark ? "#20293a" : colorTheme.content;
  const currentDetailBg = quadrantMode ? secondaryColumnBg : contentColumnBg;
  const currentEditorBg = quadrantMode ? secondaryColumnBg : contentColumnBg;
  const pendingCurrentTitle = pendingPomodoroSwitch
    ? pomodoroTaskTitle(pendingPomodoroSwitch.currentItemId) || "直接专注"
    : "";
  const pendingNextTitle = pendingPomodoroSwitch
    ? pomodoroTaskTitle(pendingPomodoroSwitch.nextItemId) || "直接专注"
    : "";
  const todoSearchShortcutLabel = formatShortcutLabel(todoShortcuts.search);

  const confirmPomodoroSwitch = () => {
    if (!pendingPomodoroSwitch) return;
    const nextItemId = pendingPomodoroSwitch.nextItemId;
    switchRunningPomodoroFocus(nextItemId);
    openPomodoroFocus(nextItemId);
    setPendingPomodoroSwitch(null);
  };

  return (
    <Box
      onScrollCapture={revealScrollbars}
      sx={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        pt: { xs: "max(env(safe-area-inset-top), 28px)", sm: 0 },
        overflow: "hidden",
        isolation: "isolate",
        bgcolor: surfaceBg,
        color: "text.primary",
        fontFamily: todoFontCss,
        "--aebox-todo-font-family": todoFontCss ?? "inherit",
        "--separator-border": columnDividerColor,
        "--focus-border": columnDividerActiveColor,
        "--sash-hover-size": "2px",
        "--sash-hover-transition-duration": "120ms",
        "& .MuiTypography-root, & .MuiButton-root, & .MuiInputBase-root, & .MuiMenuItem-root, & .MuiChip-root, & .MuiFormLabel-root": {
          fontFamily: "var(--aebox-todo-font-family)",
        },
        "& *": {
          scrollbarWidth: "thin",
          scrollbarColor: "transparent transparent",
        },
        "& *::-webkit-scrollbar": {
          width: 8,
          height: 8,
        },
        "& *::-webkit-scrollbar-track": {
          background: "transparent",
        },
        "& *::-webkit-scrollbar-thumb": {
          borderRadius: 8,
          border: "2px solid transparent",
          backgroundClip: "padding-box",
          backgroundColor: "transparent",
        },
        "&.todo-scrollbar-visible, & .todo-scrollbar-visible": {
          scrollbarColor: `${alpha(isDark ? "#f8fafc" : "#0f172a", 0.34)} transparent`,
        },
        "&.todo-scrollbar-visible::-webkit-scrollbar-thumb, & .todo-scrollbar-visible::-webkit-scrollbar-thumb": {
          backgroundColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.34),
        },
        "&::before": {
          content: '""',
          display: { xs: "block", sm: "none" },
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "max(env(safe-area-inset-top), 28px)",
          pointerEvents: "none",
          zIndex: 60,
          background: isDark
            ? "rgba(15, 23, 42, 0.82)"
            : "linear-gradient(180deg, rgba(71, 85, 105, 0.96), rgba(100, 116, 139, 0.9))",
          borderBottom: `1px solid ${alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.12)}`,
        },
      }}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
        }}
      >
        <TodoNavRail
          isDark={isDark}
          mobile={isMobileLayout}
          background={railBg}
          activeIconColor={railActiveIconColor}
          activeView={activeView}
          searchActive={searchOpen}
          order={navRailOrder}
          searchShortcut={todoSearchShortcutLabel}
          pomodoroRunning={pomodoroRunning}
          onOrderChange={setNavRailOrder}
          onOpenTasks={openTasksView}
          onOpenCalendar={openCalendarView}
          onOpenQuadrant={openQuadrantView}
          onOpenPomodoro={openPomodoroView}
          onOpenSearch={openTodoSearch}
          onOpenSettings={openSettingsView}
        />
        <Box
          sx={{
            order: { xs: 1, sm: 0 },
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            boxSizing: "border-box",
            pb: { xs: "calc(58px + env(safe-area-inset-bottom))", sm: 0 },
          }}
        >
          <Box
            sx={{
              height: "100%",
              minHeight: 0,
              display: settingsMode ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <TodoSettingsView isDark={isDark} />
            </Box>
          </Box>
          {!settingsMode &&
            (pomodoroMode ? (
              <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
                <TitleDragStrip background={secondaryColumnBg} />
                <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                <TodoPomodoro
                  isDark={isDark}
                  surfaceBg={secondaryColumnBg}
                  primaryPaneBg={secondaryColumnBg}
                  secondaryPaneBg={secondaryColumnBg}
                  activeItemId={pomodoroItemId}
                  onActiveItemIdChange={setPomodoroItemId}
                />
                </Box>
              </Box>
            ) : calendarMode ? (
              <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: secondaryColumnBg }}>
                <TitleDragStrip background={secondaryColumnBg} />
                <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                  <TodoCalendar isDark={isDark} />
                </Box>
              </Box>
            ) : isMobileLayout ? (
              <Box
                sx={{
                  height: "100%",
                  minHeight: 0,
                  background: currentDetailBg,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                  <TodoDetail isDark={isDark} onOpenMobileSidebar={openMobileSidebar} />
                </Box>
              </Box>
            ) : (
                <Allotment
                  key={quadrantMode ? "quadrant" : "detail"}
                  className="todo-main-allotment"
                  defaultSizes={quadrantMode ? readContentSplitSizes() : readSplitSizes()}
                  onChange={(sizes) => {
                    if (quadrantMode) {
                      saveContentSplitSizes(sizes);
                      return;
                    }
                    if (sizes.length !== 3) return;
                    try {
                      localStorage.setItem(SPLIT_KEY, JSON.stringify(sizes));
                    } catch {
                      /* localStorage may be disabled */
                    }
                  }}
                >
                  {!quadrantMode && (
                    <Allotment.Pane minSize={160} preferredSize={200}>
                      <Box
                        sx={{
                          height: "100%",
                          background: secondaryColumnBg,
                          display: "flex",
                          flexDirection: "column",
                          minHeight: 0,
                        }}
                      >
                        <TitleDragStrip background={secondaryColumnBg} />
                        <Box
                          sx={{
                            flex: 1,
                            minHeight: 0,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <TodoSidebar isDark={isDark} />
                        </Box>
                      </Box>
                    </Allotment.Pane>
                  )}
                  <Allotment.Pane minSize={260} preferredSize={quadrantMode ? 720 : 360}>
                    <Box
                      sx={{
                        height: "100%",
                        background: currentDetailBg,
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                      }}
                    >
                      <TitleDragStrip background={currentDetailBg} />
                      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                        {quadrantMode ? (
                          <QuadrantView
                            isDark={isDark}
                            onOpenContextTarget={openTodoContextTarget}
                          />
                        ) : (
                          <TodoDetail isDark={isDark} />
                        )}
                      </Box>
                    </Box>
                  </Allotment.Pane>
                  {!quadrantMode && (
                    <Allotment.Pane minSize={260} preferredSize={360}>
                      <Box
                        sx={{
                          height: "100%",
                          background: currentEditorBg,
                          minHeight: 0,
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
                        <TitleDragStrip background={currentEditorBg} />
                        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                          <TodoEditor isDark={isDark} />
                        </Box>
                      </Box>
                    </Allotment.Pane>
                  )}
                </Allotment>
              ))}
        </Box>
      </Box>
      <TodoIdlePaperOverlay
        enabled={todoIdlePaperEffectEnabled}
        isDark={isDark}
        lightEffectMode={todoIdlePaperLightEffect}
      />
      <WindowControls isDark={isDark} />
      <Drawer
        anchor="left"
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        ModalProps={{ keepMounted: true }}
        slotProps={{
          backdrop: {
            sx: {
              bgcolor: alpha("#020617", isDark ? 0.48 : 0.38),
            },
          },
          paper: {
            sx: {
              display: { xs: "flex", sm: "none" },
              width: "min(84vw, 320px)",
              maxWidth: 340,
              height: "100dvh",
              boxSizing: "border-box",
              pt: "max(env(safe-area-inset-top), 28px)",
              pb: "max(env(safe-area-inset-bottom), 12px)",
              px: 1,
              borderRight: 0,
              borderTopRightRadius: 18,
              borderBottomRightRadius: 18,
              overflow: "hidden",
              bgcolor: isDark ? "#172033" : "#e7f3f3",
              color: "text.primary",
              boxShadow: isDark
                ? "18px 0 42px rgba(0, 0, 0, 0.44)"
                : "18px 0 42px rgba(15, 23, 42, 0.18)",
            },
          },
        }}
      >
        <Box sx={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>
          <TodoSidebar isDark={isDark} />
        </Box>
      </Drawer>
      <Dialog
        open={quickCreateOpen}
        onClose={() => setQuickCreate(null)}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: "14px",
              bgcolor: isDark ? "#1f2937" : "#ffffff",
              color: "text.primary",
              boxShadow: isDark
                ? "0 22px 55px rgba(0, 0, 0, 0.48)"
                : "0 22px 55px rgba(15, 23, 42, 0.18)",
              overflow: "visible",
            },
          },
          backdrop: {
            sx: {
              bgcolor: alpha(isDark ? "#020617" : "#f8fafc", isDark ? 0.34 : 0.16),
            },
          },
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          <QuickAddTodoInput
            isDark={isDark}
            selectedFilter={selectedFilter}
            groups={selectedListGroups}
            allTags={allTags}
            autoFocus
            forceExpanded
            surface="floating"
            parentItem={quickCreateParent}
            placeholder={
              quickCreateParent
                ? `为「${quickCreateParent.content.trim() || "待办"}」添加子待办`
                : "准备做什么？"
            }
            onCancel={() => setQuickCreate(null)}
            onAfterSubmit={(item) => {
              setSelectedItemId(item.id);
              setQuickCreate(null);
            }}
          />
        </DialogContent>
      </Dialog>
      <TodoQuickSearch
        isDark={isDark}
        open={searchOpen}
        focusRequest={searchFocusRequest}
        onClose={() => setSearchOpen(false)}
        onNavigate={() => setActiveView("tasks")}
        onStartPomodoro={requestPomodoroFocus}
      />
      <Dialog
        open={Boolean(pendingPomodoroSwitch)}
        onClose={() => setPendingPomodoroSwitch(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 1,
              bgcolor: cardBg,
            },
          },
        }}
      >
        <DialogTitle sx={{ fontSize: 18, fontWeight: 800 }}>
          切换专注待办？
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: "text.secondary", lineHeight: 1.7 }}>
            当前正在专注「{pendingCurrentTitle}」。切换到「{pendingNextTitle}」会结束当前专注，并重新开始新的番茄专注。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPendingPomodoroSwitch(null)}>取消</Button>
          <Button variant="contained" onClick={confirmPomodoroSwitch}>
            切换
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function TitleDragStrip({ background }: { background: string }) {
  return (
    <Box
      data-tauri-drag-region
      sx={{
        display: { xs: "none", sm: "block" },
        height: TODO_DRAG_TITLEBAR_HEIGHT,
        flexShrink: 0,
        background,
        userSelect: "none",
      }}
    />
  );
}

const TodoNavRail = memo(function TodoNavRail({
  isDark,
  mobile,
  background,
  activeIconColor,
  activeView,
  searchActive,
  order,
  searchShortcut,
  pomodoroRunning,
  onOrderChange,
  onOpenTasks,
  onOpenCalendar,
  onOpenQuadrant,
  onOpenPomodoro,
  onOpenSearch,
  onOpenSettings,
}: {
  isDark: boolean;
  mobile: boolean;
  background: string;
  activeIconColor: string;
  activeView: TodoRailView;
  searchActive: boolean;
  order: TodoRailAction[];
  searchShortcut?: string;
  pomodoroRunning: boolean;
  onOrderChange: (order: TodoRailAction[]) => void;
  onOpenTasks: () => void;
  onOpenCalendar: () => void;
  onOpenQuadrant: () => void;
  onOpenPomodoro: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}) {
  const todoCheckboxShape = useStore((s) => s.appSettings.todoCheckboxShape);
  const tasksIcon =
    todoCheckboxShape === "circle" ? (
      <CheckCircleRoundedIcon sx={{ fontSize: 22 }} />
    ) : (
      <CheckBoxIcon sx={{ fontSize: 22 }} />
    );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );
  const suppressNextClickRef = useRef(false);
  const normalizedOrder = useMemo(() => normalizeNavRailOrder(order), [order]);
  const shortcuts = useMemo(
    () =>
      new Map(
        normalizedOrder.map((action, index) => [action, `Ctrl+${index + 1}`] as const),
      ),
    [normalizedOrder],
  );
  const railActions = useMemo<
    Record<
      TodoRailAction,
      {
        label: string;
        active?: boolean;
        icon: React.ReactNode;
        highlightColor?: string;
        onClick: () => void;
      }
    >
  >(
    () => ({
      tasks: {
        label: "待办",
        active: !searchActive && activeView === "tasks",
        icon: tasksIcon,
        onClick: onOpenTasks,
      },
      calendar: {
        label: "日历",
        active: !searchActive && activeView === "calendar",
        icon: <CalendarRailIcon />,
        onClick: onOpenCalendar,
      },
      quadrant: {
        label: "四象限",
        active: !searchActive && activeView === "quadrant",
        icon: <GridViewRoundedIcon sx={{ fontSize: 22 }} />,
        onClick: onOpenQuadrant,
      },
      pomodoro: {
        label: "番茄专注",
        active: !searchActive && activeView === "pomodoro",
        icon: <TimerRoundedIcon sx={{ fontSize: 22 }} />,
        highlightColor: pomodoroRunning ? POMODORO_RUNNING_ICON_COLOR : undefined,
        onClick: onOpenPomodoro,
      },
      search: {
        label: "搜索",
        active: searchActive,
        icon: <SearchRoundedIcon sx={{ fontSize: 22 }} />,
        onClick: onOpenSearch,
      },
    }),
    [
      activeView,
      onOpenCalendar,
      onOpenPomodoro,
      onOpenQuadrant,
      onOpenSearch,
      onOpenTasks,
      pomodoroRunning,
      searchActive,
      tasksIcon,
    ],
  );

  const releaseSuppressedClick = () => {
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = event.active.id;
    const overId = event.over?.id;
    if (!isTodoRailAction(activeId) || !isTodoRailAction(overId)) {
      releaseSuppressedClick();
      return;
    }
    if (activeId !== overId) {
      const oldIndex = normalizedOrder.indexOf(activeId);
      const newIndex = normalizedOrder.indexOf(overId);
      if (oldIndex >= 0 && newIndex >= 0) {
        const next = arrayMove(normalizedOrder, oldIndex, newIndex);
        saveNavRailOrder(next);
        onOrderChange(next);
      }
    }
    releaseSuppressedClick();
  };

  const runRailAction = (action: TodoRailAction) => {
    if (suppressNextClickRef.current) return;
    railActions[action].onClick();
  };

  return (
    <Box
      sx={{
        order: { xs: 2, sm: 0 },
        position: { xs: "fixed", sm: "static" },
        left: { xs: 0, sm: "auto" },
        right: { xs: 0, sm: "auto" },
        bottom: { xs: 0, sm: "auto" },
        zIndex: { xs: 80, sm: "auto" },
        height: { xs: "calc(58px + env(safe-area-inset-bottom))", sm: "100%" },
        width: { xs: "100%", sm: 48 },
        boxSizing: "border-box",
        flexShrink: 0,
        transform: { xs: "translateZ(0)", sm: "none" },
        contain: { xs: "layout paint style", sm: "none" },
        pt: { xs: 0.5, sm: 0 },
        pb: { xs: "max(8px, env(safe-area-inset-bottom))", sm: 1.2 },
        px: { xs: 0.5, sm: 0 },
        display: "flex",
        flexDirection: { xs: "row", sm: "column" },
        alignItems: "center",
        justifyContent: { xs: "space-around", sm: "flex-start" },
        gap: { xs: 0, sm: 1.3 },
        background,
        borderRight: { xs: 0, sm: 1 },
        borderTop: { xs: 1, sm: 0 },
        borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.045 : 0.032),
      }}
    >
      {!mobile && <TitleDragStrip background={background} />}
      {mobile ? (
        normalizedOrder.map((action) => {
          const config = railActions[action];
          return (
            <RailButton
              key={action}
              label={config.label}
              active={config.active}
              icon={config.icon}
              activeIconColor={activeIconColor}
              highlightColor={config.highlightColor}
              shortcut={shortcuts.get(action)}
              secondaryShortcut={action === "search" ? searchShortcut : undefined}
              onClick={config.onClick}
              isDark={isDark}
              mobile
            />
          );
        })
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => {
            suppressNextClickRef.current = true;
          }}
          onDragCancel={releaseSuppressedClick}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={normalizedOrder} strategy={verticalListSortingStrategy}>
            {normalizedOrder.map((action) => {
              const config = railActions[action];
              return (
                <SortableRailButton
                  key={action}
                  id={action}
                  label={config.label}
                  active={config.active}
                  icon={config.icon}
                  activeIconColor={activeIconColor}
                  highlightColor={config.highlightColor}
                  shortcut={shortcuts.get(action)}
                  secondaryShortcut={action === "search" ? searchShortcut : undefined}
                  onClick={() => runRailAction(action)}
                  isDark={isDark}
                  mobile={mobile}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      )}
      <Box sx={{ flex: 1, display: { xs: "none", sm: "block" } }} />
      <RailButton
        label="设置"
        active={!searchActive && activeView === "settings"}
        icon={<SettingsSvgIcon />}
        activeIconColor={activeIconColor}
        onClick={onOpenSettings}
        isDark={isDark}
        mobile={mobile}
      />
    </Box>
  );
});

function SettingsSvgIcon() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      sx={{ width: 22, height: 22, display: "block" }}
    >
      <path
        d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Zm7.35 3.75c0-.35-.03-.69-.08-1.02l2.08-1.62-1.98-3.43-2.45.98a7.75 7.75 0 0 0-1.76-1.02L14.8 3.25h-5.6l-.36 2.64c-.63.25-1.22.59-1.76 1.02l-2.45-.98-1.98 3.43 2.08 1.62a7.01 7.01 0 0 0 0 2.04l-2.08 1.62 1.98 3.43 2.45-.98c.54.43 1.13.77 1.76 1.02l.36 2.64h5.6l.36-2.64c.63-.25 1.22-.59 1.76-1.02l2.45.98 1.98-3.43-2.08-1.62c.05-.33.08-.67.08-1.02Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

function CalendarRailIcon() {
  const day = new Date().getDate();
  return (
    <Box
      aria-hidden
      sx={{
        width: 24,
        height: 24,
        borderRadius: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        color: "currentColor",
        border: "2px solid currentColor",
        borderTopWidth: 5,
        boxSizing: "border-box",
        fontSize: day >= 10 ? 10.5 : 12,
        fontWeight: 850,
        lineHeight: 1,
        "&::before, &::after": {
          content: '""',
          position: "absolute",
          top: -6,
          width: 3,
          height: 5,
          borderRadius: 999,
          bgcolor: "currentColor",
        },
        "&::before": { left: 5 },
        "&::after": { right: 5 },
      }}
    >
      <Box component="span" sx={{ transform: "translateY(1px)" }}>
        {day}
      </Box>
    </Box>
  );
}

type SortableAttributes = ReturnType<typeof useSortable>["attributes"];
type SortableListeners = ReturnType<typeof useSortable>["listeners"];

interface RailButtonProps {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  activeIconColor: string;
  highlightColor?: string;
  shortcut?: string;
  secondaryShortcut?: string;
  onClick?: () => void;
  isDark: boolean;
  mobile?: boolean;
  rootRef?: (node: HTMLElement | null) => void;
  rootStyle?: CSSProperties;
  dragAttributes?: SortableAttributes;
  dragListeners?: SortableListeners;
  dragEnabled?: boolean;
}

function SortableRailButton({
  id,
  ...props
}: RailButtonProps & { id: TodoRailAction }) {
  const sortable = useSortable({ id });
  const style: CSSProperties = {
    transform: sortable.transform
      ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
      : undefined,
    transition: sortable.isDragging ? undefined : sortable.transition,
    opacity: sortable.isDragging ? 0.62 : 1,
    zIndex: sortable.isDragging ? 2 : undefined,
    position: "relative",
    willChange: sortable.isDragging ? "transform" : undefined,
  };

  return (
    <RailButton
      {...props}
      rootRef={sortable.setNodeRef}
      rootStyle={style}
      dragAttributes={sortable.attributes}
      dragListeners={sortable.listeners}
      dragEnabled
    />
  );
}

function RailButton({
  label,
  icon,
  active = false,
  disabled = false,
  activeIconColor,
  highlightColor,
  shortcut,
  secondaryShortcut,
  onClick,
  isDark,
  mobile = false,
  rootRef,
  rootStyle,
  dragAttributes,
  dragListeners,
  dragEnabled = false,
}: RailButtonProps) {
  const hoverBg = highlightColor
    ? alpha(highlightColor, isDark ? 0.24 : 0.18)
    : alpha(isDark ? "#f8fafc" : "#0f172a", 0.06);
  const activeHoverBg = alpha(activeIconColor, activeIconColor === "#fff" ? 0.18 : 0.1);
  const shortcutText =
    shortcut && secondaryShortcut
      ? `${shortcut} / ${secondaryShortcut}`
      : shortcut || secondaryShortcut;
  const tooltipTitle = shortcutText ? `${label} (${shortcutText})` : label;

  const button = (
    <span ref={rootRef} style={{ display: "inline-flex", ...rootStyle }}>
      <IconButton
          {...dragAttributes}
          {...dragListeners}
          size="small"
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
          disableRipple
          disableFocusRipple
          disableTouchRipple
          sx={{
            width: mobile ? 52 : 50,
            height: mobile ? 48 : 40,
            borderRadius: 1.2,
            border: 0,
            boxShadow: "none",
            color: active ? activeIconColor : highlightColor ?? "text.secondary",
            bgcolor: "transparent",
            opacity: disabled ? 0.42 : 1,
            cursor: dragEnabled && !disabled ? "grab" : "pointer",
            touchAction: dragEnabled ? "none" : undefined,
            "& svg": {
              border: 0,
              boxShadow: "none",
              width: 22,
              height: 22,
              fontSize: 22,
              display: "block",
              flexShrink: 0,
            },
            "& > *": {
              flexShrink: 0,
            },
            "&:active": {
              cursor: dragEnabled && !disabled ? "grabbing" : "pointer",
            },
            "&:hover": {
              bgcolor: active ? activeHoverBg : hoverBg,
              boxShadow: "none",
            },
            "&:focus-visible": {
              boxShadow: "none",
            },
          }}
      >
        {icon}
      </IconButton>
    </span>
  );

  if (mobile) return button;

  return (
    <Tooltip title={tooltipTitle} placement="right" arrow>
      {button}
    </Tooltip>
  );
}

function WindowControls({ isDark }: { isDark: boolean }) {
  const [maximized, setMaximized] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const syncMaximized = (win = getCurrentWebviewWindow()) => {
      win
        .isMaximized()
        .then((value) => {
          if (!cancelled) setMaximized(value);
        })
        .catch(() => {});
    };
    const timer = window.setTimeout(() => {
      const win = getCurrentWebviewWindow();
      syncMaximized(win);
      win
        .onResized(() => {
          syncMaximized(win);
        })
        .then((fn) => {
          if (cancelled) {
            fn();
          } else {
            unlisten = fn;
          }
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  const onMinimize = () => getCurrentWebviewWindow().minimize().catch(() => {});
  const onToggleMax = () => {
    const win = getCurrentWebviewWindow();
    win
      .toggleMaximize()
      .then(() => win.isMaximized())
      .then(setMaximized)
      .catch(() => {});
  };
  const onClose = () => getCurrentWebviewWindow().close().catch(() => {});
  const onTogglePinned = () => {
    const next = !pinned;
    getCurrentWindow().setAlwaysOnTop(next).then(() => setPinned(next)).catch(() => {});
  };

  const iconButtonSx = {
    borderRadius: 0,
    width: 36,
    height: 30,
    color: "text.secondary",
    "&:hover": {
      bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.1 : 0.06),
      color: "text.primary",
    },
  };

  return (
    <Box
      data-tauri-drag-region
      sx={{
        position: "absolute",
        top: 0,
        right: 0,
        zIndex: 40,
        height: 32,
        display: { xs: "none", sm: "flex" },
        alignItems: "center",
        justifyContent: "flex-end",
        pl: 0.5,
        pr: 0,
        bgcolor: "transparent",
        userSelect: "none",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Tooltip title={pinned ? "取消置顶" : "置顶窗口"}>
          <IconButton
            size="small"
            aria-label={pinned ? "取消置顶" : "置顶窗口"}
            onClick={onTogglePinned}
            sx={iconButtonSx}
          >
            {pinned ? (
              <PushPinRoundedIcon sx={{ fontSize: 16, color: "primary.main" }} />
            ) : (
              <PushPinOutlinedIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="最小化">
          <IconButton size="small" onClick={onMinimize} sx={iconButtonSx}>
            <MinimizeIcon sx={{ fontSize: 16, transform: "translateY(-4px)" }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={maximized ? "还原" : "最大化"}>
          <IconButton size="small" onClick={onToggleMax} sx={iconButtonSx}>
            {maximized ? (
              <FilterNoneIcon sx={{ fontSize: 13 }} />
            ) : (
              <CropSquareIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="关闭">
          <IconButton
            size="small"
            onClick={onClose}
            sx={{
              ...iconButtonSx,
              "&:hover": { bgcolor: "#e81123", color: "#fff" },
            }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
