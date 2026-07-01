import { useEffect, useMemo, useRef, useState } from "react";
import { Knob } from "react-rotary-knob";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { Allotment } from "allotment";
import { alpha, useTheme } from "@mui/material/styles";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import ViewAgendaRoundedIcon from "@mui/icons-material/ViewAgendaRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import RadioButtonCheckedRoundedIcon from "@mui/icons-material/RadioButtonCheckedRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";

import { useTodoStore } from "./useTodoStore";
import {
  DEFAULT_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  POMODORO_SESSION_CHANGED_EVENT,
  POMODORO_TIMER_STATE_CHANGED_EVENT,
  clampDurationMinutes,
  notifyPomodoroCompleted,
  readPomodoroSessions,
  readPomodoroTimerState,
  savePomodoroSessions,
  savePomodoroTimerState,
  switchRunningPomodoroFocus,
  type PomodoroMode,
  type PomodoroSession,
  type PomodoroTimerState,
} from "./todoPomodoroTimer";
import type { TodoFolder, TodoGroup, TodoItem, TodoList } from "./types";

interface PomodoroSessionGroup {
  key: string;
  itemId: string | null;
  itemTitle: string;
  sessions: PomodoroSession[];
  totalDuration: number;
  latestEndAt: number;
}

interface TodoPomodoroProps {
  isDark: boolean;
  surfaceBg?: string;
  primaryPaneBg?: string;
  secondaryPaneBg?: string;
  activeItemId: string | null;
  onActiveItemIdChange: (itemId: string | null) => void;
}

const POMODORO_SPLIT_KEY = "aebox.todo.pomodoro.splitSizes";
const POMODORO_KNOB_SKIN = {
  knobX: 100,
  knobY: 100,
  updateAttributes: [],
  svg: `
<svg width="200px" height="200px" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <g id="knob">
    <circle cx="100" cy="14" r="5.5" fill="#3f6ee8" />
  </g>
</svg>
`,
};

function readPomodoroSplitSizes(): number[] | undefined {
  try {
    const raw = localStorage.getItem(POMODORO_SPLIT_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every((n) => typeof n === "number")) {
      return parsed;
    }
  } catch {
    /* localStorage may be disabled */
  }
  return undefined;
}

export function TodoPomodoro({
  isDark,
  surfaceBg,
  primaryPaneBg,
  secondaryPaneBg,
  activeItemId,
  onActiveItemIdChange,
}: TodoPomodoroProps) {
  const theme = useTheme();
  const isMobilePomodoro = useMediaQuery(theme.breakpoints.down("sm"));
  const items = useTodoStore((s) => s.items);
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const groups = useTodoStore((s) => s.groups);
  const [initialTimerState] = useState(readPomodoroTimerState);
  const [mode, setMode] = useState<PomodoroMode>(
    () => initialTimerState?.mode ?? "pomodoro",
  );
  const [durationMinutes, setDurationMinutes] = useState(
    () => initialTimerState?.durationMinutes ?? DEFAULT_DURATION_MINUTES,
  );
  const [durationAdjusting, setDurationAdjusting] = useState(false);
  const [running, setRunning] = useState(() => initialTimerState?.running ?? false);
  const [baseElapsedMs, setBaseElapsedMs] = useState(
    () => initialTimerState?.baseElapsedMs ?? 0,
  );
  const [runStartedAt, setRunStartedAt] = useState<number | null>(
    () => initialTimerState?.runStartedAt ?? null,
  );
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(
    () => initialTimerState?.sessionStartedAt ?? null,
  );
  const [now, setNow] = useState(Date.now());
  const [sessions, setSessions] = useState<PomodoroSession[]>(readPomodoroSessions);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskPickerAnchor, setTaskPickerAnchor] = useState<HTMLElement | null>(null);
  const [recordMenu, setRecordMenu] = useState<{
    anchor: HTMLElement;
    groupKey: string;
  } | null>(null);
  const [recordsMenuAnchor, setRecordsMenuAnchor] = useState<HTMLElement | null>(null);
  const [timelineGroupKey, setTimelineGroupKey] = useState<string | null>(null);
  const durationDragLastRef = useRef(DEFAULT_DURATION_MINUTES);
  const durationBoundaryLockRef = useRef<"min" | "max" | null>(null);
  const finishingSessionRef = useRef(false);
  const timerItemRestoreAttemptedRef = useRef(false);
  const timerActiveItemIdRef = useRef<string | null>(
    activeItemId ?? initialTimerState?.activeItemId ?? null,
  );

  const listById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const activeItem = activeItemId
    ? (() => {
        const item = itemById.get(activeItemId) ?? null;
        return item && item.deletedAt == null && item.status === "pending" ? item : null;
      })()
    : null;
  const rootBg = surfaceBg ?? (isDark ? "#20293a" : "#ffffff");
  const mainPaneBg = primaryPaneBg ?? rootBg;
  const asidePaneBg = secondaryPaneBg ?? (isDark ? "#1b2331" : "#f8fafc");

  useEffect(() => {
    timerActiveItemIdRef.current = activeItemId;
  }, [activeItemId]);

  useEffect(() => {
    if (timerItemRestoreAttemptedRef.current) return;
    timerItemRestoreAttemptedRef.current = true;
    if (activeItemId == null && initialTimerState?.activeItemId) {
      timerActiveItemIdRef.current = initialTimerState.activeItemId;
      onActiveItemIdChange(initialTimerState.activeItemId);
    }
  }, [activeItemId, initialTimerState, onActiveItemIdChange]);

  useEffect(() => {
    if (activeItemId && !activeItem) onActiveItemIdChange(null);
  }, [activeItem, activeItemId, onActiveItemIdChange]);

  useEffect(() => {
    savePomodoroSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    const handleSessionChanged = () => {
      const next = readPomodoroSessions();
      setSessions((current) =>
        areSameSessions(current, next) ? current : next,
      );
    };
    window.addEventListener(POMODORO_SESSION_CHANGED_EVENT, handleSessionChanged);
    return () =>
      window.removeEventListener(POMODORO_SESSION_CHANGED_EVENT, handleSessionChanged);
  }, []);

  useEffect(() => {
    const handleTimerStateChanged = () => {
      const next = readPomodoroTimerState();
      if (!next) return;
      setMode(next.mode);
      setDurationMinutes(next.durationMinutes);
      setRunning(next.running);
      setBaseElapsedMs(next.baseElapsedMs);
      setRunStartedAt(next.runStartedAt);
      setSessionStartedAt(next.sessionStartedAt);
      setNow(Date.now());
      timerActiveItemIdRef.current = next.activeItemId;
      if (next.activeItemId !== activeItemId) {
        onActiveItemIdChange(next.activeItemId);
      }
    };
    window.addEventListener(
      POMODORO_TIMER_STATE_CHANGED_EVENT,
      handleTimerStateChanged,
    );
    return () =>
      window.removeEventListener(
        POMODORO_TIMER_STATE_CHANGED_EVENT,
        handleTimerStateChanged,
      );
  }, [activeItemId, onActiveItemIdChange]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const effectiveDurationMinutes = clampDurationMinutes(durationMinutes);
  const durationMs = effectiveDurationMinutes * 60 * 1000;
  const liveElapsedMs =
    baseElapsedMs + (running && runStartedAt != null ? now - runStartedAt : 0);
  const remainingMs = Math.max(0, durationMs - liveElapsedMs);
  const displayMs = mode === "pomodoro" ? remainingMs : liveElapsedMs;
  const progress =
    mode === "pomodoro"
      ? Math.min(1, liveElapsedMs / durationMs)
      : (liveElapsedMs % 60000) / 60000;
  const showTimerSecondaryControls = running || liveElapsedMs > 0;

  useEffect(() => {
    savePomodoroTimerState({
      mode,
      durationMinutes: effectiveDurationMinutes,
      running,
      baseElapsedMs,
      runStartedAt,
      sessionStartedAt,
      activeItemId: timerActiveItemIdRef.current,
    });
  }, [
    activeItemId,
    baseElapsedMs,
    effectiveDurationMinutes,
    mode,
    runStartedAt,
    running,
    sessionStartedAt,
  ]);

  const focusableItems = useMemo(() => {
    const q = taskQuery.trim().toLocaleLowerCase();
    const activeItems = items.filter(
      (item) => item.deletedAt == null && item.status === "pending",
    );
    if (!q) return activeItems;

    const activeById = new Map(activeItems.map((item) => [item.id, item]));
    const visibleIds = new Set<string>();
    for (const item of activeItems) {
      const list = listById.get(item.listId);
      const folder = list?.folderId ? folderById.get(list.folderId) : null;
      const group = item.groupId ? groupById.get(item.groupId) : null;
      const matched = [
        item.content,
        item.note,
        item.tags.join(" "),
        list?.name,
        folder?.name,
        group?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(q);
      if (!matched) continue;

      let current: TodoItem | undefined = item;
      while (current && !visibleIds.has(current.id)) {
        visibleIds.add(current.id);
        current = current.parentId ? activeById.get(current.parentId) : undefined;
      }
    }
    return activeItems.filter((item) => visibleIds.has(item.id));
  }, [folderById, groupById, items, listById, taskQuery]);

  const todayStart = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }, []);

  const stats = useMemo(() => {
    const todaySessions = sessions.filter((session) => session.endAt >= todayStart);
    const sum = (rows: PomodoroSession[]) =>
      rows.reduce((total, session) => total + session.durationMs, 0);
    return {
      todayCount: todaySessions.filter((session) => session.mode === "pomodoro").length,
      todayDuration: sum(todaySessions),
      totalCount: sessions.filter((session) => session.mode === "pomodoro").length,
      totalDuration: sum(sessions),
    };
  }, [sessions, todayStart]);

  const focusedMsByItemId = useMemo(() => {
    const totals = new Map<string, number>();
    for (const session of sessions) {
      if (!session.itemId) continue;
      totals.set(
        session.itemId,
        (totals.get(session.itemId) ?? 0) + session.durationMs,
      );
    }
    return totals;
  }, [sessions]);

  const sessionGroups = useMemo(
    () => buildSessionGroups(sessions, itemById),
    [itemById, sessions],
  );
  const activeTimelineGroup = useMemo(
    () => sessionGroups.find((group) => group.key === timelineGroupKey) ?? null,
    [sessionGroups, timelineGroupKey],
  );

  const activeItemTotalFocusMs = activeItem
    ? (focusedMsByItemId.get(activeItem.id) ?? 0) + liveElapsedMs
    : 0;

  const persistTimerState = (next: Partial<PomodoroTimerState>) => {
    savePomodoroTimerState({
      mode,
      durationMinutes: effectiveDurationMinutes,
      running,
      baseElapsedMs,
      runStartedAt,
      sessionStartedAt,
      activeItemId: timerActiveItemIdRef.current,
      ...next,
    });
  };

  const resetTimer = () => {
    setRunning(false);
    setBaseElapsedMs(0);
    setRunStartedAt(null);
    setSessionStartedAt(null);
    setNow(Date.now());
    persistTimerState({
      running: false,
      baseElapsedMs: 0,
      runStartedAt: null,
      sessionStartedAt: null,
    });
  };

  const toggleRunning = () => {
    const timestamp = Date.now();
    if (running) {
      const nextBaseElapsedMs =
        baseElapsedMs + (runStartedAt != null ? timestamp - runStartedAt : 0);
      setBaseElapsedMs(nextBaseElapsedMs);
      setRunStartedAt(null);
      setRunning(false);
      setNow(timestamp);
      persistTimerState({
        running: false,
        baseElapsedMs: nextBaseElapsedMs,
        runStartedAt: null,
      });
      return;
    }
    const nextSessionStartedAt = sessionStartedAt ?? timestamp;
    setSessionStartedAt(nextSessionStartedAt);
    setRunStartedAt(timestamp);
    setRunning(true);
    setNow(timestamp);
    persistTimerState({
      running: true,
      runStartedAt: timestamp,
      sessionStartedAt: nextSessionStartedAt,
    });
  };

  const finishSession = (forcedDurationMs?: number, notifyOnFinish = false) => {
    const timestamp = Date.now();
    const actualElapsed =
      forcedDurationMs ??
      baseElapsedMs + (running && runStartedAt != null ? timestamp - runStartedAt : 0);
    if (actualElapsed < 1000) {
      resetTimer();
      return;
    }
    if (finishingSessionRef.current) return;
    finishingSessionRef.current = true;
    const roundedDurationMs = forcedDurationMs ?? actualElapsed;
    const sessionItemId = activeItem?.id ?? timerActiveItemIdRef.current;
    const sessionItem = sessionItemId ? itemById.get(sessionItemId) : null;
    const itemTitle = sessionItem?.content?.trim() || "未关联待办";
    const nextSession: PomodoroSession = {
      id: `pomodoro-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
      itemId: sessionItemId,
      itemTitle,
      mode,
      startAt: sessionStartedAt ?? timestamp - roundedDurationMs,
      endAt: timestamp,
      durationMs: roundedDurationMs,
    };
    if (notifyOnFinish && mode === "pomodoro") {
      const latestTimerState = readPomodoroTimerState();
      void notifyPomodoroCompleted({
        mode,
        durationMinutes: effectiveDurationMinutes,
        running,
        baseElapsedMs,
        runStartedAt,
        sessionStartedAt,
        activeItemId: sessionItemId,
        completionNotifiedAt: latestTimerState?.completionNotifiedAt ?? null,
      });
    }
    setSessions((current) => {
      const latest = current[0];
      if (
        latest &&
        latest.itemId === nextSession.itemId &&
        latest.mode === nextSession.mode &&
        latest.startAt === nextSession.startAt &&
        Math.abs(latest.endAt - nextSession.endAt) < 1500
      ) {
        return current;
      }
      return [nextSession, ...current];
    });
    resetTimer();
    window.setTimeout(() => {
      finishingSessionRef.current = false;
    }, 0);
  };

  useEffect(() => {
    if (mode !== "pomodoro" || !running || liveElapsedMs < durationMs) return;
    finishSession(durationMs, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, liveElapsedMs, mode, running]);

  const confirmSwitchRunningFocus = (nextTitle: string) => {
    const currentTitle = activeItem?.content?.trim() || "直接专注";
    return window.confirm(
      `当前正在专注「${currentTitle}」。切换到「${nextTitle}」会结束当前专注，并重新开始新的番茄专注。`,
    );
  };

  const selectTask = (item: TodoItem) => {
    if (running && activeItemId !== item.id) {
      const nextTitle = item.content?.trim() || "未命名待办";
      if (!confirmSwitchRunningFocus(nextTitle)) return;
      switchRunningPomodoroFocus(item.id);
      setTaskQuery("");
      setTaskPickerAnchor(null);
      return;
    }
    timerActiveItemIdRef.current = item.id;
    onActiveItemIdChange(item.id);
    setTaskQuery("");
    setTaskPickerAnchor(null);
  };

  const directFocus = () => {
    if (running && activeItemId !== null) {
      if (!confirmSwitchRunningFocus("直接专注")) return;
      switchRunningPomodoroFocus(null);
      setTaskQuery("");
      setTaskPickerAnchor(null);
      return;
    }
    timerActiveItemIdRef.current = null;
    onActiveItemIdChange(null);
    setTaskQuery("");
    setTaskPickerAnchor(null);
  };

  const handleDurationAdjustingChange = (adjusting: boolean) => {
    setDurationAdjusting(adjusting);
    if (adjusting) {
      durationDragLastRef.current = effectiveDurationMinutes;
      durationBoundaryLockRef.current = null;
    }
  };

  const handleDurationChange = (rawValue: number) => {
    const next = clampDurationMinutes(rawValue);
    const last = durationDragLastRef.current;
    const lock = durationBoundaryLockRef.current;
    let guarded = next;

    if (lock === "max") {
      if (next >= MAX_DURATION_MINUTES - 1) {
        durationBoundaryLockRef.current = null;
      } else {
        guarded = MAX_DURATION_MINUTES;
      }
    } else if (lock === "min") {
      if (next <= MIN_DURATION_MINUTES + 1) {
        durationBoundaryLockRef.current = null;
      } else {
        guarded = MIN_DURATION_MINUTES;
      }
    } else if (
      last >= MAX_DURATION_MINUTES - 1 &&
      next <= MIN_DURATION_MINUTES + 5
    ) {
      durationBoundaryLockRef.current = "max";
      guarded = MAX_DURATION_MINUTES;
    } else if (
      last <= MIN_DURATION_MINUTES + 1 &&
      next >= MAX_DURATION_MINUTES - 5
    ) {
      durationBoundaryLockRef.current = "min";
      guarded = MIN_DURATION_MINUTES;
    }

    durationDragLastRef.current = guarded;
    setDurationMinutes(guarded);
  };

  const deleteSessionGroup = (groupKey: string) => {
    setSessions((current) =>
      current.filter((session) => getSessionGroupKey(session) !== groupKey),
    );
    setRecordMenu(null);
    if (timelineGroupKey === groupKey) setTimelineGroupKey(null);
  };

  const clearSessions = () => {
    setSessions([]);
    setRecordsMenuAnchor(null);
    setRecordMenu(null);
    setTimelineGroupKey(null);
  };

  const timerPane = (
    <Box
      sx={{
        width: "100%",
        height: { xs: "auto", sm: "100%" },
        minHeight: 0,
        boxSizing: "border-box",
        p: { xs: 2, md: 3 },
        pt: { xs: 1.4, md: 3 },
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflow: { xs: "visible", sm: "auto" },
        background: mainPaneBg,
      }}
    >
      <Box
        sx={{
          width: "100%",
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          gap: { xs: 1, sm: 1 },
        }}
      >
        <Typography
          sx={{
            fontSize: { xs: 24, sm: 22 },
            fontWeight: 850,
            lineHeight: 1.15,
            flex: 1,
          }}
        >
          番茄专注
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_, next: PomodoroMode | null) => {
            if (!next || next === mode || running) return;
            resetTimer();
            setMode(next);
          }}
          sx={{
            width: { xs: "100%", sm: "auto" },
            alignSelf: { xs: "stretch", sm: "auto" },
            "& .MuiToggleButtonGroup-grouped": {
              flex: { xs: 1, sm: "0 0 auto" },
              minHeight: { xs: 40, sm: 34 },
              px: { xs: 1, sm: 1.4 },
              whiteSpace: "nowrap",
            },
          }}
        >
          <ToggleButton value="pomodoro">番茄计时</ToggleButton>
          <ToggleButton value="stopwatch">正计时</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box
        sx={{
          flex: { xs: "0 0 auto", sm: 1 },
          minHeight: { xs: "auto", sm: 0 },
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: { xs: "flex-start", sm: "center" },
          pt: { xs: 1.4, sm: 2 },
          pb: { xs: 1.8, sm: 0 },
        }}
      >
        <Button
          variant="outlined"
          onClick={(event) => {
            setTaskQuery("");
            setTaskPickerAnchor(event.currentTarget);
          }}
          startIcon={<RadioButtonCheckedRoundedIcon />}
          endIcon={<ChevronRightRoundedIcon />}
          sx={{
            width: "auto",
            maxWidth: { xs: 360, sm: 320 },
            minWidth: 132,
            height: { xs: 42, sm: 38 },
            px: { xs: 1.8, sm: 1.6 },
            borderRadius: 999,
            borderColor: alpha(theme.palette.primary.main, isDark ? 0.42 : 0.34),
            color: activeItem ? "text.primary" : "text.secondary",
            bgcolor: alpha(theme.palette.primary.main, isDark ? 0.1 : 0.055),
            boxShadow: isDark
              ? "0 10px 24px rgba(0, 0, 0, 0.18)"
              : "0 10px 24px rgba(37, 99, 235, 0.08)",
            fontSize: { xs: 14, sm: 13 },
            fontWeight: 700,
            textTransform: "none",
            "& .MuiButton-startIcon": {
              mr: 0.8,
              color: "primary.main",
              "& svg": { fontSize: 18 },
            },
            "& .MuiButton-endIcon": {
              ml: 0.4,
              color: "text.secondary",
              "& svg": { fontSize: 18 },
            },
            "&:hover": {
              borderColor: alpha(theme.palette.primary.main, isDark ? 0.62 : 0.52),
              bgcolor: alpha(theme.palette.primary.main, isDark ? 0.16 : 0.09),
              boxShadow: isDark
                ? "0 12px 28px rgba(0, 0, 0, 0.24)"
                : "0 12px 28px rgba(37, 99, 235, 0.12)",
            },
          }}
        >
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeItem?.content || "专注"}
          </Box>
        </Button>
        {activeItem ? (
          <Typography
            sx={{
              mt: 0.4,
              maxWidth: { xs: 360, sm: 320 },
              fontSize: 12,
              color: "text.secondary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={`已专注 ${formatStatDuration(activeItemTotalFocusMs)}`}
          >
            已专注 {formatStatDuration(activeItemTotalFocusMs)}
          </Typography>
        ) : null}

        <Box sx={{ mt: { xs: 2.2, sm: 3 }, display: "flex", justifyContent: "center" }}>
          <TimerDial
            isDark={isDark}
            color={theme.palette.primary.main}
            variant={mode}
            progress={progress}
            display={formatTimer(displayMs)}
            subText={mode === "pomodoro" ? "" : "正计时"}
            durationMinutes={effectiveDurationMinutes}
            adjusting={durationAdjusting}
            editable={mode === "pomodoro" && !running && liveElapsedMs === 0}
            onAdjustingChange={handleDurationAdjustingChange}
            onDurationChange={handleDurationChange}
          />
        </Box>

        <Box
          sx={{
            mt: { xs: 2.2, sm: 3 },
            width: "100%",
            maxWidth: { xs: 360, sm: 420 },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
          }}
        >
          {showTimerSecondaryControls && (
            <Tooltip title="重置">
              <span style={{ flex: 1, minWidth: 0, display: "flex" }}>
                <IconButton
                  disabled={running && liveElapsedMs <= 0}
                  onClick={resetTimer}
                  sx={{
                    width: "100%",
                    height: { xs: 54, sm: 48 },
                    borderRadius: 1,
                    color: "text.secondary",
                    bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.06 : 0.04),
                    "&:hover": {
                      bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.1 : 0.07),
                    },
                  }}
                >
                  <ReplayRoundedIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Button
            variant="contained"
            size="large"
            startIcon={running ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
            onClick={toggleRunning}
            sx={{
              flex: showTimerSecondaryControls ? 3 : 1,
              minWidth: 0,
              height: { xs: 54, sm: 48 },
              borderRadius: 1,
              fontSize: { xs: 16, sm: 15 },
              "& .MuiButton-startIcon": { mr: 0.9 },
            }}
          >
            {running ? "暂停" : liveElapsedMs > 0 ? "继续" : "开始"}
          </Button>
          {showTimerSecondaryControls && (
            <Tooltip title={mode === "pomodoro" ? "提前结束" : "完成记录"}>
              <span style={{ flex: 1, minWidth: 0, display: "flex" }}>
                <IconButton
                  disabled={liveElapsedMs < 1000}
                  onClick={() => finishSession()}
                  sx={{
                    width: "100%",
                    height: { xs: 54, sm: 48 },
                    borderRadius: 1,
                    color: "text.secondary",
                    bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.06 : 0.04),
                    "&:hover": {
                      bgcolor: alpha(theme.palette.error.main, isDark ? 0.18 : 0.08),
                      color: "error.main",
                    },
                  }}
                >
                  <StopRoundedIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>

        <TaskPickerPopover
          isDark={isDark}
          anchorEl={taskPickerAnchor}
          activeItemId={activeItem?.id ?? null}
          query={taskQuery}
          items={focusableItems}
          folders={folders}
          lists={lists}
          groups={groups}
          listById={listById}
          focusedMsByItemId={focusedMsByItemId}
          onQueryChange={setTaskQuery}
          onClose={() => setTaskPickerAnchor(null)}
          onDirectFocus={directFocus}
          onSelectTask={selectTask}
        />
      </Box>
    </Box>
  );

  const overviewPane = (
    <Box
      sx={{
        width: "100%",
        height: { xs: "auto", sm: "100%" },
        minHeight: 0,
        boxSizing: "border-box",
        p: { xs: 1.6, sm: 2 },
        overflow: { xs: "visible", sm: "auto" },
        background: asidePaneBg,
        borderTop: {
          xs: `1px solid ${alpha(isDark ? "#f8fafc" : "#0f172a", 0.08)}`,
          sm: 0,
        },
      }}
    >
      <Typography sx={{ fontSize: 16, fontWeight: 800 }}>专注概览</Typography>
      <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
        <StatBox label="今日番茄" value={`${stats.todayCount}`} isDark={isDark} />
        <StatBox
          label="今日专注"
          value={formatStatDuration(stats.todayDuration)}
          isDark={isDark}
        />
        <StatBox label="总番茄" value={`${stats.totalCount}`} isDark={isDark} />
        <StatBox
          label="总专注"
          value={formatStatDuration(stats.totalDuration)}
          isDark={isDark}
        />
      </Box>

      <Box sx={{ mt: 2.5, mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 800, flex: 1 }}>
          专注记录
        </Typography>
        <Tooltip title="更多">
          <span>
            <IconButton
              size="small"
              disabled={sessionGroups.length === 0}
              onClick={(event) => setRecordsMenuAnchor(event.currentTarget)}
              sx={{ width: 28, height: 28 }}
            >
              <MoreHorizRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {sessionGroups.length === 0 ? (
        <Box
          sx={{
            height: { xs: 96, sm: 160 },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "text.secondary",
            fontSize: 13,
          }}
        >
          暂无记录
        </Box>
      ) : (
        <Box sx={{ display: "grid", gap: 0.8 }}>
          {sessionGroups.slice(0, 30).map((group) => (
            <Box
              key={group.key}
              sx={{
                p: 1,
                borderRadius: 1,
                bgcolor: isDark ? alpha("#000", 0.18) : "#ffffff",
                border: 1,
                borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                  title={group.itemTitle}
                >
                  {group.itemTitle}
                </Typography>
                <Tooltip title="更多">
                  <IconButton
                    size="small"
                    onClick={(event) =>
                      setRecordMenu({
                        anchor: event.currentTarget,
                        groupKey: group.key,
                      })
                    }
                    sx={{ width: 24, height: 24, color: "text.secondary" }}
                  >
                    <MoreHorizRoundedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              </Box>
              <Typography sx={{ mt: 0.3, fontSize: 12, color: "text.secondary" }}>
                累计专注 {formatStatDuration(group.totalDuration)} ·{" "}
                {group.sessions.length} 次 · 最近 {formatRecordTime(group.latestEndAt)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      <Menu
        open={Boolean(recordsMenuAnchor)}
        anchorEl={recordsMenuAnchor}
        onClose={() => setRecordsMenuAnchor(null)}
      >
        <MenuItem onClick={clearSessions} disabled={sessionGroups.length === 0}>
          <ListItemIcon>
            <DeleteOutlineRoundedIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>清空专注记录</ListItemText>
        </MenuItem>
      </Menu>
      <Menu
        open={Boolean(recordMenu)}
        anchorEl={recordMenu?.anchor ?? null}
        onClose={() => setRecordMenu(null)}
      >
        <MenuItem
          onClick={() => {
            if (!recordMenu) return;
            setTimelineGroupKey(recordMenu.groupKey);
            setRecordMenu(null);
          }}
        >
          <ListItemIcon>
            <ViewAgendaRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>专注时间线</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (recordMenu) deleteSessionGroup(recordMenu.groupKey);
          }}
        >
          <ListItemIcon>
            <DeleteOutlineRoundedIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>删除记录</ListItemText>
        </MenuItem>
      </Menu>
      <FocusTimelineDialog
        open={Boolean(activeTimelineGroup)}
        group={activeTimelineGroup}
        isDark={isDark}
        onClose={() => setTimelineGroupKey(null)}
      />
    </Box>
  );

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        background: rootBg,
      }}
    >
      {isMobilePomodoro ? (
        <Box
          sx={{
            height: "100%",
            minHeight: 0,
            overflowY: "auto",
            background: mainPaneBg,
          }}
        >
          {timerPane}
          {overviewPane}
        </Box>
      ) : (
        <Allotment
          defaultSizes={readPomodoroSplitSizes() ?? [760, 340]}
          onChange={(sizes) => {
            if (sizes.length !== 2) return;
            try {
              localStorage.setItem(POMODORO_SPLIT_KEY, JSON.stringify(sizes));
            } catch {
              /* localStorage may be disabled */
            }
          }}
        >
          <Allotment.Pane minSize={420}>{timerPane}</Allotment.Pane>
          <Allotment.Pane minSize={280} preferredSize={340}>
            {overviewPane}
          </Allotment.Pane>
        </Allotment>
      )}
    </Box>
  );
}

function TaskPickerPopover({
  isDark,
  anchorEl,
  activeItemId,
  query,
  items,
  folders,
  lists,
  groups,
  listById,
  focusedMsByItemId,
  onQueryChange,
  onClose,
  onDirectFocus,
  onSelectTask,
}: {
  isDark: boolean;
  anchorEl: HTMLElement | null;
  activeItemId: string | null;
  query: string;
  items: TodoItem[];
  folders: TodoFolder[];
  lists: TodoList[];
  groups: TodoGroup[];
  listById: Map<string, TodoList>;
  focusedMsByItemId: Map<string, number>;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onDirectFocus: () => void;
  onSelectTask: (item: TodoItem) => void;
}) {
  const open = Boolean(anchorEl);
  const rows = useMemo(
    () => buildTaskPickerRows(items, folders, lists, groups),
    [folders, groups, items, lists],
  );
  const firstSelectableItem = rows.find((row) => row.kind === "item")?.item;

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      transformOrigin={{ vertical: "top", horizontal: "center" }}
      slotProps={{
        paper: {
          sx: {
            mt: 0.7,
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            borderRadius: 1,
            bgcolor: isDark ? "#20293a" : "#ffffff",
            border: 1,
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
            overflow: "hidden",
          },
        },
      }}
    >
      <Box
        sx={{
          p: 1,
          display: "flex",
          alignItems: "center",
          gap: 0.8,
          borderBottom: 1,
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
        }}
      >
        <SearchRoundedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        <InputBase
          autoFocus
          fullWidth
          value={query}
          placeholder="搜索待办"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && firstSelectableItem) {
              onSelectTask(firstSelectableItem);
            }
          }}
          sx={{ fontSize: 13 }}
        />
      </Box>
      <Box sx={{ maxHeight: 360, overflowY: "auto", py: 0.6 }}>
        <ListItemButton
          selected={activeItemId == null}
          onClick={onDirectFocus}
          sx={{ mx: 0.6, borderRadius: 1, minHeight: 44 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>直接专注</Typography>
            <Typography sx={{ mt: 0.2, fontSize: 12, color: "text.secondary" }}>
              不关联待办
            </Typography>
          </Box>
        </ListItemButton>
        {rows.length === 0 ? (
          <Box
            sx={{
              height: 96,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "text.secondary",
              fontSize: 13,
            }}
          >
            没有匹配待办
          </Box>
        ) : (
          rows.map((row) =>
            row.kind === "item" ? (
              <TaskPickerItemRow
                key={row.key}
                row={row}
                active={activeItemId === row.item.id}
                focusMs={focusedMsByItemId.get(row.item.id) ?? 0}
                onSelect={() => onSelectTask(row.item)}
              />
            ) : (
              <TaskPickerSectionRow
                key={row.key}
                row={row}
                isDark={isDark}
                listById={listById}
              />
            ),
          )
        )}
      </Box>
    </Popover>
  );
}

type TaskPickerRow =
  | {
      kind: "folder" | "list" | "group";
      key: string;
      label: string;
      depth: number;
      listId?: string;
    }
  | {
      kind: "item";
      key: string;
      label: string;
      depth: number;
      item: TodoItem;
    };

function TaskPickerSectionRow({
  row,
  isDark,
  listById,
}: {
  row: Extract<TaskPickerRow, { kind: "folder" | "list" | "group" }>;
  isDark: boolean;
  listById: Map<string, TodoList>;
}) {
  const color =
    row.kind === "folder"
      ? "text.secondary"
      : row.kind === "list"
        ? "text.primary"
        : "text.secondary";
  const fontWeight = row.kind === "list" ? 700 : 600;
  const list = row.listId ? listById.get(row.listId) : null;
  return (
    <Box
      sx={{
        minHeight: 28,
        px: 1,
        pl: 1 + row.depth * 2,
        display: "flex",
        alignItems: "center",
        gap: 0.7,
        color,
      }}
    >
      <Box
        sx={{
          width: 18,
          height: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: alpha(isDark ? "#f8fafc" : "#0f172a", row.kind === "list" ? 0.62 : 0.5),
          flexShrink: 0,
        }}
      >
        {row.kind === "folder" && <FolderRoundedIcon sx={{ fontSize: 16 }} />}
        {row.kind === "list" && <FormatListBulletedRoundedIcon sx={{ fontSize: 16 }} />}
        {row.kind === "group" && <ViewAgendaRoundedIcon sx={{ fontSize: 15 }} />}
      </Box>
      <Typography
        sx={{
          minWidth: 0,
          fontSize: row.kind === "list" ? 13 : 12,
          fontWeight,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={list ? `${list.name} / ${row.label}` : row.label}
      >
        {row.label}
      </Typography>
    </Box>
  );
}

function TaskPickerItemRow({
  row,
  active,
  focusMs,
  onSelect,
}: {
  row: Extract<TaskPickerRow, { kind: "item" }>;
  active: boolean;
  focusMs: number;
  onSelect: () => void;
}) {
  return (
    <ListItemButton
      selected={active}
      onClick={onSelect}
      sx={{
        mx: 0.6,
        borderRadius: 1,
        minHeight: focusMs > 0 ? 48 : 34,
        gap: 0.8,
        pl: 1 + row.depth * 2,
        py: 0.35,
        alignItems: focusMs > 0 ? "flex-start" : "center",
      }}
    >
      <CheckBoxOutlineBlankRoundedIcon
        sx={{
          mt: focusMs > 0 ? 0.45 : 0,
          fontSize: 17,
          color: "text.secondary",
          flexShrink: 0,
        }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            minWidth: 0,
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={row.label}
        >
          {row.label}
        </Typography>
        {focusMs > 0 ? (
          <Typography
            sx={{
              mt: 0.15,
              fontSize: 11,
              color: "text.secondary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            已专注 {formatStatDuration(focusMs)}
          </Typography>
        ) : null}
      </Box>
    </ListItemButton>
  );
}

function buildTaskPickerRows(
  items: TodoItem[],
  folders: TodoFolder[],
  lists: TodoList[],
  groups: TodoGroup[],
): TaskPickerRow[] {
  if (items.length === 0) return [];

  const visibleIds = new Set(items.map((item) => item.id));
  const itemsByParent = new Map<string | null, TodoItem[]>();
  for (const item of items) {
    const parentKey =
      item.parentId != null && visibleIds.has(item.parentId) ? item.parentId : null;
    const bucket = itemsByParent.get(parentKey) ?? [];
    bucket.push(item);
    itemsByParent.set(parentKey, bucket);
  }
  for (const bucket of itemsByParent.values()) {
    bucket.sort(compareTodoItems);
  }

  const rows: TaskPickerRow[] = [];
  const itemsByList = new Map<string, TodoItem[]>();
  for (const root of itemsByParent.get(null) ?? []) {
    const bucket = itemsByList.get(root.listId) ?? [];
    bucket.push(root);
    itemsByList.set(root.listId, bucket);
  }

  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const listsWithItems = lists
    .filter((list) => itemsByList.has(list.id))
    .sort(compareTodoLists);
  const listsByFolder = new Map<string | null, TodoList[]>();
  for (const list of listsWithItems) {
    const folderId =
      list.folderId != null && folderById.has(list.folderId) ? list.folderId : null;
    const bucket = listsByFolder.get(folderId) ?? [];
    bucket.push(list);
    listsByFolder.set(folderId, bucket);
  }

  const orderedFolderIds = Array.from(listsByFolder.keys()).sort((a, b) => {
    if (a == null) return -1;
    if (b == null) return 1;
    return compareTodoFolders(folderById.get(a), folderById.get(b));
  });

  for (const folderId of orderedFolderIds) {
    const folder = folderId ? folderById.get(folderId) : null;
    const folderDepth = folder ? 0 : -1;
    if (folder) {
      rows.push({
        kind: "folder",
        key: `folder-${folder.id}`,
        label: folder.name,
        depth: folderDepth,
      });
    }

    for (const list of listsByFolder.get(folderId) ?? []) {
      const listDepth = folder ? 1 : 0;
      rows.push({
        kind: "list",
        key: `list-${list.id}`,
        label: list.name,
        depth: listDepth,
        listId: list.id,
      });
      appendListTaskRows({
        rows,
        list,
        roots: itemsByList.get(list.id) ?? [],
        groups,
        itemsByParent,
        depth: listDepth + 1,
      });
    }
  }

  return rows;
}

function appendListTaskRows({
  rows,
  list,
  roots,
  groups,
  itemsByParent,
  depth,
}: {
  rows: TaskPickerRow[];
  list: TodoList;
  roots: TodoItem[];
  groups: TodoGroup[];
  itemsByParent: Map<string | null, TodoItem[]>;
  depth: number;
}) {
  const listGroups = groups
    .filter((group) => group.listId === list.id)
    .sort(compareTodoGroups);
  const rootsByGroup = new Map<string | null, TodoItem[]>();
  for (const root of roots) {
    const groupId = root.groupId ?? null;
    const bucket = rootsByGroup.get(groupId) ?? [];
    bucket.push(root);
    rootsByGroup.set(groupId, bucket);
  }

  const ungrouped = rootsByGroup.get(null) ?? [];
  appendTaskRows(rows, ungrouped, itemsByParent, depth);

  for (const group of listGroups) {
    const scopedRoots = rootsByGroup.get(group.id) ?? [];
    if (scopedRoots.length === 0) continue;
    rows.push({
      kind: "group",
      key: `group-${group.id}`,
      label: group.name,
      depth,
      listId: list.id,
    });
    appendTaskRows(rows, scopedRoots, itemsByParent, depth + 1);
  }

  for (const [groupId, scopedRoots] of rootsByGroup) {
    if (groupId == null || listGroups.some((group) => group.id === groupId)) continue;
    appendTaskRows(rows, scopedRoots, itemsByParent, depth);
  }
}

function appendTaskRows(
  rows: TaskPickerRow[],
  roots: TodoItem[],
  itemsByParent: Map<string | null, TodoItem[]>,
  depth: number,
) {
  for (const item of [...roots].sort(compareTodoItems)) {
    rows.push({
      kind: "item",
      key: `item-${item.id}`,
      label: item.content || "未命名待办",
      depth,
      item,
    });
    appendTaskRows(rows, itemsByParent.get(item.id) ?? [], itemsByParent, depth + 1);
  }
}

function compareTodoFolders(a: TodoFolder | undefined, b: TodoFolder | undefined) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name);
}

function compareTodoLists(a: TodoList, b: TodoList) {
  return a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name);
}

function compareTodoGroups(a: TodoGroup, b: TodoGroup) {
  return a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name);
}

function compareTodoItems(a: TodoItem, b: TodoItem) {
  return a.order - b.order || a.createdAt - b.createdAt || a.content.localeCompare(b.content);
}

function TimerDial({
  isDark,
  color,
  variant,
  progress,
  display,
  subText,
  durationMinutes,
  adjusting,
  editable,
  onAdjustingChange,
  onDurationChange,
}: {
  isDark: boolean;
  color: string;
  variant: PomodoroMode;
  progress: number;
  display: string;
  subText: string;
  durationMinutes: number;
  adjusting: boolean;
  editable: boolean;
  onAdjustingChange: (adjusting: boolean) => void;
  onDurationChange: (value: number) => void;
}) {
  const track = alpha(isDark ? "#f8fafc" : "#0f172a", 0.1);
  const clampedDuration = clampDurationMinutes(durationMinutes);
  const showClockGuide = editable && adjusting;
  const showSecondTicks = variant === "stopwatch";
  return (
    <Tooltip
      title={editable ? "拖拽番茄钟调整时长（5-60 分钟）" : ""}
      placement="top"
      arrow
    >
    <Box
      sx={{
        width: { xs: "clamp(220px, 66vw, 280px)", sm: 250 },
        height: { xs: "clamp(220px, 66vw, 280px)", sm: 250 },
        borderRadius: "50%",
        p: 1.1,
        background: showSecondTicks
          ? "transparent"
          : `conic-gradient(${color} ${Math.round(
              progress * 360,
            )}deg, ${track} 0deg)`,
        position: "relative",
        boxShadow: isDark
          ? "0 0 34px rgba(0,0,0,0.42), 0 0 14px rgba(0,0,0,0.24), inset 0 0 0 1px rgba(255,255,255,0.08)"
          : "0 0 34px rgba(15,23,42,0.16), 0 0 14px rgba(15,23,42,0.1), inset 0 0 0 1px rgba(255,255,255,0.9)",
      }}
    >
      {showSecondTicks ? (
        <SecondTickRing isDark={isDark} color={color} progress={progress} />
      ) : null}
      {editable && (
        <Knob
          aria-label="番茄时长"
          min={MIN_DURATION_MINUTES}
          max={MAX_DURATION_MINUTES}
          step={1}
          value={durationMinutes}
          skin={POMODORO_KNOB_SKIN}
          clampMin={4}
          clampMax={356}
          rotateDegrees={2}
          preciseMode={false}
          onStart={() => onAdjustingChange(true)}
          onEnd={() => onAdjustingChange(false)}
          onChange={onDurationChange}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: "grab",
            zIndex: 2,
          }}
        />
      )}
      <Box
        sx={{
          height: "100%",
          borderRadius: "50%",
          bgcolor: isDark ? "#20293a" : "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: isDark
            ? "inset 0 0 18px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.05)"
            : "inset 0 0 18px rgba(15,23,42,0.08), inset 0 0 0 1px rgba(15,23,42,0.05)",
          pointerEvents: "none",
          position: "relative",
          zIndex: 3,
        }}
      >
        {showClockGuide ? (
          <ClockDurationGuide
            isDark={isDark}
            color={color}
            durationMinutes={clampedDuration}
          />
        ) : (
          <>
            <Typography sx={{ fontSize: { xs: "clamp(40px, 12vw, 52px)", sm: 48 }, fontWeight: 800 }}>
              {display}
            </Typography>
            {subText && (
              <Typography sx={{ mt: 0.5, color: "text.secondary", fontSize: 13 }}>
                {subText}
              </Typography>
            )}
          </>
        )}
      </Box>
    </Box>
    </Tooltip>
  );
}

function SecondTickRing({
  isDark,
  color,
  progress,
}: {
  isDark: boolean;
  color: string;
  progress: number;
}) {
  const activeTicks = Math.min(60, Math.ceil(Math.max(0, progress) * 60));
  const inactiveColor = alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.12 : 0.14);
  const ticks = Array.from({ length: 60 }, (_, index) => {
    const angle = (index * 6 - 90) * (Math.PI / 180);
    const isMajor = index % 5 === 0;
    const inner = isMajor ? 82 : 84;
    const outer = 94;
    return {
      x1: 100 + Math.cos(angle) * inner,
      y1: 100 + Math.sin(angle) * inner,
      x2: 100 + Math.cos(angle) * outer,
      y2: 100 + Math.sin(angle) * outer,
      active: index < activeTicks,
      major: isMajor,
    };
  });

  return (
    <Box
      component="svg"
      viewBox="0 0 200 200"
      sx={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 4,
        pointerEvents: "none",
      }}
    >
      {ticks.map((tick, index) => (
        <line
          key={index}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
          stroke={tick.active ? color : inactiveColor}
          strokeWidth={tick.major ? 1.8 : 1.35}
          strokeLinecap="round"
          opacity={tick.active ? 0.95 : 1}
        />
      ))}
    </Box>
  );
}

function ClockDurationGuide({
  isDark,
  color,
  durationMinutes,
}: {
  isDark: boolean;
  color: string;
  durationMinutes: number;
}) {
  const tickColor = alpha(isDark ? "#f8fafc" : "#0f172a", 0.48);
  const gearTicks = Array.from({ length: durationMinutes }, (_, index) => {
    const angle = (index * 6 - 90) * (Math.PI / 180);
    const inner = 76;
    const outer = 90;
    return {
      x1: 100 + Math.cos(angle) * inner,
      y1: 100 + Math.sin(angle) * inner,
      x2: 100 + Math.cos(angle) * outer,
      y2: 100 + Math.sin(angle) * outer,
      major: index % 5 === 0,
    };
  });

  return (
    <Box
      aria-hidden
      sx={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 200 200"
        sx={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        {gearTicks.map((tick, index) => (
            <line
              key={index}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke={tick.major ? color : tickColor}
              strokeWidth={tick.major ? 3 : 2}
              strokeLinecap="round"
            />
          ))}
      </Box>
      <Box sx={{ textAlign: "center" }}>
        <Typography sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>
          {durationMinutes}
        </Typography>
        <Typography sx={{ mt: 0.5, fontSize: 12, color: "text.secondary" }}>
          分钟
        </Typography>
      </Box>
    </Box>
  );
}

function StatBox({
  label,
  value,
  isDark,
}: {
  label: string;
  value: string;
  isDark: boolean;
}) {
  return (
    <Box
      sx={{
        p: 1.1,
        borderRadius: 1,
        bgcolor: isDark ? alpha("#000", 0.18) : "#ffffff",
        border: 1,
        borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
        minHeight: 74,
      }}
    >
      <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ mt: 0.8, fontSize: 18, fontWeight: 800 }}>{value}</Typography>
    </Box>
  );
}

function FocusTimelineDialog({
  open,
  group,
  isDark,
  onClose,
}: {
  open: boolean;
  group: PomodoroSessionGroup | null;
  isDark: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Dialog
      open={open && Boolean(group)}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          sx: {
            borderRadius: 1,
            bgcolor: isDark ? "#20293a" : "#ffffff",
          },
        },
      }}
    >
      <DialogTitle sx={{ pb: 1.2 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 800 }}>专注时间线</Typography>
        {group ? (
          <Typography
            sx={{
              mt: 0.5,
              fontSize: 13,
              color: "text.secondary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={group.itemTitle}
          >
            {group.itemTitle}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {group ? (
          <>
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                display: "flex",
                gap: 1,
                alignItems: "center",
                bgcolor: isDark ? alpha("#000", 0.12) : "#f8fafc",
              }}
            >
              <Typography sx={{ fontSize: 13, color: "text.secondary", flex: 1 }}>
                共 {group.sessions.length} 次
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                累计 {formatStatDuration(group.totalDuration)}
              </Typography>
            </Box>
            <Box sx={{ px: 2, py: 1.5 }}>
              {group.sessions.map((session, index) => (
                <Box
                  key={session.id}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "82px 22px minmax(0, 1fr)",
                    gap: 1,
                    minHeight: 70,
                  }}
                >
                  <Typography
                    sx={{
                      pt: 0.6,
                      fontSize: 12,
                      color: "text.secondary",
                      textAlign: "right",
                      lineHeight: 1.4,
                    }}
                  >
                    {formatRecordTime(session.endAt)}
                  </Typography>
                  <Box
                    sx={{
                      position: "relative",
                      display: "flex",
                      justifyContent: "center",
                      minHeight: 70,
                    }}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        top: index === 0 ? 10 : 0,
                        bottom: index === group.sessions.length - 1 ? 36 : 0,
                        width: 1,
                        bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.14),
                      }}
                    />
                    <Box
                      sx={{
                        mt: 0.9,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        bgcolor: theme.palette.primary.main,
                        boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.14)}`,
                        zIndex: 1,
                      }}
                    />
                  </Box>
                  <Box sx={{ minWidth: 0, pb: 1.2 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 800 }}>
                      {formatSessionMode(session.mode)} ·{" "}
                      {formatStatDuration(session.durationMs)}
                    </Typography>
                    <Typography
                      sx={{
                        mt: 0.35,
                        fontSize: 12,
                        color: "text.secondary",
                      }}
                    >
                      {formatTimeRange(session.startAt, session.endAt)}
                    </Typography>
                    {index < group.sessions.length - 1 ? (
                      <Divider sx={{ mt: 1.1 }} />
                    ) : null}
                  </Box>
                </Box>
              ))}
            </Box>
          </>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.2 }}>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

function getSessionGroupKey(
  session: Pick<PomodoroSession, "itemId" | "itemTitle">,
): string {
  return session.itemId
    ? `item:${session.itemId}`
    : `direct:${session.itemTitle || "未关联待办"}`;
}

function buildSessionGroups(
  sessions: PomodoroSession[],
  itemById: Map<string, TodoItem>,
): PomodoroSessionGroup[] {
  const groups = new Map<string, PomodoroSessionGroup>();
  for (const session of sessions) {
    const key = getSessionGroupKey(session);
    const itemTitle =
      (session.itemId ? itemById.get(session.itemId)?.content?.trim() : "") ||
      session.itemTitle ||
      "未关联待办";
    const group =
      groups.get(key) ??
      ({
        key,
        itemId: session.itemId,
        itemTitle,
        sessions: [],
        totalDuration: 0,
        latestEndAt: 0,
      } satisfies PomodoroSessionGroup);
    group.itemTitle = itemTitle;
    group.sessions.push(session);
    group.totalDuration += session.durationMs;
    group.latestEndAt = Math.max(group.latestEndAt, session.endAt);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((a, b) => b.endAt - a.endAt),
    }))
    .sort((a, b) => b.latestEndAt - a.latestEndAt);
}

function areSameSessions(a: PomodoroSession[], b: PomodoroSession[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((session, index) => session.id === b[index]?.id);
}

function formatTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function formatStatDuration(ms: number): string {
  const totalMinutes = ms > 0 ? Math.max(1, Math.ceil(ms / 60000)) : 0;
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}分钟`);
  return parts.join("");
}

function formatSessionMode(mode: PomodoroMode): string {
  return mode === "pomodoro" ? "番茄计时" : "正计时";
}

function formatRecordTime(ts: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
}

function formatTimeRange(startAt: number, endAt: number): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(startAt)} - ${formatter.format(endAt)}`;
}
