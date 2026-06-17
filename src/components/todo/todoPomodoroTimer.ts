import { useEffect } from "react";

import { getTomatoData, saveTomatoData } from "./todoIpc";
import { showTodoNotification } from "./todoReminders";
import { useTodoStore } from "./useTodoStore";

export type PomodoroMode = "pomodoro" | "stopwatch";

export interface PomodoroTimerState {
  mode: PomodoroMode;
  durationMinutes: number;
  running: boolean;
  baseElapsedMs: number;
  runStartedAt: number | null;
  sessionStartedAt: number | null;
  activeItemId: string | null;
  completionNotifiedAt?: number | null;
}

export interface PomodoroSession {
  id: string;
  itemId: string | null;
  itemTitle: string;
  mode: PomodoroMode;
  startAt: number;
  endAt: number;
  durationMs: number;
}

export interface TomatoData {
  version: number;
  timerState: PomodoroTimerState | null;
  sessions: PomodoroSession[];
}

export const DEFAULT_DURATION_MINUTES = 25;
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 60;

const TIMER_STATE_KEY = "aebox.todo.pomodoro.timer.v1";
const SESSION_KEY = "aebox.todo.pomodoro.sessions.v1";
export const POMODORO_TIMER_STATE_CHANGED_EVENT =
  "aebox:todo-pomodoro-timer-changed";
export const POMODORO_SESSION_CHANGED_EVENT =
  "aebox:todo-pomodoro-session-changed";
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const TOMATO_DATA_VERSION = 1;

const notifiedCompletionTokens = new Set<number>();
let tomatoDataCache: TomatoData = emptyTomatoData();
let legacyStorageSeeded = false;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistPromise: Promise<void> = Promise.resolve();
let persistQueuedBeforeHydration = false;

export function clampDurationMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DURATION_MINUTES;
  return Math.max(
    MIN_DURATION_MINUTES,
    Math.min(MAX_DURATION_MINUTES, Math.round(value)),
  );
}

function emptyTomatoData(): TomatoData {
  return {
    version: TOMATO_DATA_VERSION,
    timerState: null,
    sessions: [],
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cloneTimerState(
  state: PomodoroTimerState | null,
): PomodoroTimerState | null {
  return state ? { ...state } : null;
}

function cloneSessions(sessions: PomodoroSession[]): PomodoroSession[] {
  return sessions.map((session) => ({ ...session }));
}

function cloneTomatoData(data: TomatoData): TomatoData {
  return {
    version: TOMATO_DATA_VERSION,
    timerState: cloneTimerState(data.timerState),
    sessions: cloneSessions(data.sessions),
  };
}

function normalizePomodoroTimerState(
  value: unknown,
  previous?: PomodoroTimerState | null,
): PomodoroTimerState | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Record<string, unknown>;
  const runStartedAt = finiteNumber(parsed.runStartedAt);
  const running = parsed.running === true && runStartedAt != null;
  const completionNotifiedAt = Object.prototype.hasOwnProperty.call(
    parsed,
    "completionNotifiedAt",
  )
    ? finiteNumber(parsed.completionNotifiedAt)
    : previous?.completionNotifiedAt ?? null;

  return {
    mode: parsed.mode === "stopwatch" ? "stopwatch" : "pomodoro",
    durationMinutes: clampDurationMinutes(
      finiteNumber(parsed.durationMinutes) ?? DEFAULT_DURATION_MINUTES,
    ),
    running,
    baseElapsedMs: Math.max(0, finiteNumber(parsed.baseElapsedMs) ?? 0),
    runStartedAt: running ? runStartedAt : null,
    sessionStartedAt: finiteNumber(parsed.sessionStartedAt),
    activeItemId:
      typeof parsed.activeItemId === "string" ? parsed.activeItemId : null,
    completionNotifiedAt,
  };
}

function normalizePomodoroSessions(value: unknown): PomodoroSession[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((session) => {
      const row = session as Record<string, unknown> | null;
      return (
        row != null &&
        typeof row.id === "string" &&
        finiteNumber(row.startAt) != null &&
        finiteNumber(row.endAt) != null &&
        (finiteNumber(row.durationMs) ?? 0) > 0
      );
    })
    .map((session) => {
      const row = session as Record<string, unknown>;
      const mode: PomodoroMode =
        row.mode === "stopwatch" ? "stopwatch" : "pomodoro";
      return {
        id: row.id as string,
        itemId: typeof row.itemId === "string" ? row.itemId : null,
        itemTitle:
          typeof row.itemTitle === "string" ? row.itemTitle : "\u672a\u5173\u8054\u5f85\u529e",
        mode,
        startAt: finiteNumber(row.startAt) ?? 0,
        endAt: finiteNumber(row.endAt) ?? 0,
        durationMs: Math.max(0, finiteNumber(row.durationMs) ?? 0),
      };
    })
    .slice(0, 300);
}

function normalizeTomatoData(value: unknown): TomatoData {
  if (!value || typeof value !== "object") return emptyTomatoData();
  const parsed = value as Record<string, unknown>;
  return {
    version: TOMATO_DATA_VERSION,
    timerState: normalizePomodoroTimerState(parsed.timerState),
    sessions: normalizePomodoroSessions(parsed.sessions),
  };
}

function hasTomatoContent(data: TomatoData): boolean {
  return data.timerState != null || data.sessions.length > 0;
}

function isDefaultIdleTimerState(state: PomodoroTimerState): boolean {
  return (
    state.mode === "pomodoro" &&
    state.durationMinutes === DEFAULT_DURATION_MINUTES &&
    !state.running &&
    state.baseElapsedMs === 0 &&
    state.runStartedAt == null &&
    state.sessionStartedAt == null &&
    state.activeItemId == null &&
    state.completionNotifiedAt == null
  );
}

function timerStatesEqual(
  a: PomodoroTimerState | null,
  b: PomodoroTimerState | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.mode === b.mode &&
    a.durationMinutes === b.durationMinutes &&
    a.running === b.running &&
    a.baseElapsedMs === b.baseElapsedMs &&
    a.runStartedAt === b.runStartedAt &&
    a.sessionStartedAt === b.sessionStartedAt &&
    a.activeItemId === b.activeItemId &&
    (a.completionNotifiedAt ?? null) === (b.completionNotifiedAt ?? null)
  );
}

function sessionsEqual(a: PomodoroSession[], b: PomodoroSession[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((session, index) => {
    const other = b[index];
    return (
      session.id === other.id &&
      session.itemId === other.itemId &&
      session.itemTitle === other.itemTitle &&
      session.mode === other.mode &&
      session.startAt === other.startAt &&
      session.endAt === other.endAt &&
      session.durationMs === other.durationMs
    );
  });
}

function dispatchPomodoroDataEvents() {
  window.dispatchEvent(new Event(POMODORO_TIMER_STATE_CHANGED_EVENT));
  window.dispatchEvent(new Event(POMODORO_SESSION_CHANGED_EVENT));
}

function dispatchPomodoroTimerEvent() {
  window.dispatchEvent(new Event(POMODORO_TIMER_STATE_CHANGED_EVENT));
}

function dispatchPomodoroSessionEvent() {
  window.dispatchEvent(new Event(POMODORO_SESSION_CHANGED_EVENT));
}

function readLegacyPomodoroTimerState(): PomodoroTimerState | null {
  try {
    const raw = localStorage.getItem(TIMER_STATE_KEY);
    if (!raw) return null;
    return normalizePomodoroTimerState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readLegacyPomodoroSessions(): PomodoroSession[] {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    return normalizePomodoroSessions(JSON.parse(raw));
  } catch {
    return [];
  }
}

function clearLegacyPomodoroStorage() {
  try {
    localStorage.removeItem(TIMER_STATE_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* localStorage may be disabled */
  }
}

function seedCacheFromLegacyStorage() {
  if (legacyStorageSeeded) return;
  legacyStorageSeeded = true;
  tomatoDataCache = {
    version: TOMATO_DATA_VERSION,
    timerState: readLegacyPomodoroTimerState(),
    sessions: readLegacyPomodoroSessions(),
  };
}

function queueTomatoPersist() {
  if (!hydrated) {
    persistQueuedBeforeHydration = true;
    return;
  }
  const snapshot = cloneTomatoData(tomatoDataCache);
  persistPromise = persistPromise
    .catch(() => undefined)
    .then(async () => {
      try {
        await saveTomatoData<TomatoData>(snapshot);
        clearLegacyPomodoroStorage();
      } catch (error) {
        console.warn("save tomato data failed", error);
      }
    });
}

export function hydratePomodoroData(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  seedCacheFromLegacyStorage();
  hydratePromise = getTomatoData<TomatoData>()
    .then((raw) => {
      const diskData = normalizeTomatoData(raw);
      const legacyData = cloneTomatoData(tomatoDataCache);
      const shouldMigrateLegacy =
        !hasTomatoContent(diskData) && hasTomatoContent(legacyData);

      if (!persistQueuedBeforeHydration) {
        tomatoDataCache = shouldMigrateLegacy ? legacyData : diskData;
      }
      hydrated = true;
      dispatchPomodoroDataEvents();

      if (shouldMigrateLegacy || persistQueuedBeforeHydration) {
        persistQueuedBeforeHydration = false;
        queueTomatoPersist();
      } else {
        clearLegacyPomodoroStorage();
      }
    })
    .catch((error) => {
      hydrated = true;
      console.warn("load tomato data failed", error);
      dispatchPomodoroDataEvents();
    });
  return hydratePromise;
}

export function usePomodoroDataHydration() {
  useEffect(() => {
    void hydratePomodoroData();
  }, []);
}

export function readPomodoroTimerState(): PomodoroTimerState | null {
  seedCacheFromLegacyStorage();
  void hydratePomodoroData();
  return cloneTimerState(tomatoDataCache.timerState);
}

export function savePomodoroTimerState(state: PomodoroTimerState) {
  seedCacheFromLegacyStorage();
  const next = normalizePomodoroTimerState(state, tomatoDataCache.timerState);
  if (!next) return;
  if (!hydrated && tomatoDataCache.timerState == null && isDefaultIdleTimerState(next)) {
    return;
  }
  if (timerStatesEqual(tomatoDataCache.timerState, next)) return;
  tomatoDataCache = {
    ...tomatoDataCache,
    timerState: next,
  };
  dispatchPomodoroTimerEvent();
  queueTomatoPersist();
}

export function readPomodoroSessions(): PomodoroSession[] {
  seedCacheFromLegacyStorage();
  void hydratePomodoroData();
  return cloneSessions(tomatoDataCache.sessions);
}

export function savePomodoroSessions(sessions: PomodoroSession[]) {
  seedCacheFromLegacyStorage();
  const next = normalizePomodoroSessions(sessions);
  if (sessionsEqual(tomatoDataCache.sessions, next)) return;
  tomatoDataCache = {
    ...tomatoDataCache,
    sessions: next,
  };
  dispatchPomodoroSessionEvent();
  queueTomatoPersist();
}

export function appendPomodoroSession(session: PomodoroSession) {
  savePomodoroSessions([session, ...readPomodoroSessions()]);
}

function pomodoroDurationMs(state: PomodoroTimerState): number {
  return clampDurationMinutes(state.durationMinutes) * 60 * 1000;
}

export function pomodoroElapsedMs(
  state: PomodoroTimerState,
  now = Date.now(),
): number {
  return (
    Math.max(0, state.baseElapsedMs) +
    (state.running && state.runStartedAt != null
      ? Math.max(0, now - state.runStartedAt)
      : 0)
  );
}

function completionToken(state: PomodoroTimerState): number | null {
  return state.sessionStartedAt ?? state.runStartedAt;
}

export function pomodoroTaskTitle(itemId: string | null): string {
  if (!itemId) return "";
  return (
    useTodoStore.getState().items.find((item) => item.id === itemId)?.content?.trim() ??
    ""
  );
}

export async function notifyPomodoroCompleted(state: PomodoroTimerState) {
  if (state.mode !== "pomodoro") return;
  const token = completionToken(state);
  if (token == null) return;
  if (state.completionNotifiedAt === token || notifiedCompletionTokens.has(token)) {
    return;
  }

  notifiedCompletionTokens.add(token);
  const title = pomodoroTaskTitle(state.activeItemId);
  const durationText = `${clampDurationMinutes(state.durationMinutes)} 分钟`;
  await showTodoNotification({
    id: `pomodoro:${token}`,
    title: "番茄专注完成",
    body: title
      ? `已完成 ${durationText} 专注\n${title}`
      : `已完成 ${durationText} 专注`,
  });
}

export function sessionFromTimerState(
  state: PomodoroTimerState,
  endAt = Date.now(),
): PomodoroSession | null {
  const durationMs = pomodoroElapsedMs(state, endAt);
  if (durationMs < 1000) return null;
  const itemTitle = pomodoroTaskTitle(state.activeItemId) || "未关联待办";
  return {
    id: `pomodoro-${endAt}-${Math.random().toString(36).slice(2, 7)}`,
    itemId: state.activeItemId,
    itemTitle,
    mode: state.mode,
    startAt: state.sessionStartedAt ?? endAt - durationMs,
    endAt,
    durationMs,
  };
}

export function switchRunningPomodoroFocus(nextItemId: string | null) {
  const now = Date.now();
  const current = readPomodoroTimerState();
  if (current?.running) {
    const session = sessionFromTimerState(current, now);
    if (session) appendPomodoroSession(session);
  }

  savePomodoroTimerState({
    mode: "pomodoro",
    durationMinutes: current?.durationMinutes ?? DEFAULT_DURATION_MINUTES,
    running: true,
    baseElapsedMs: 0,
    runStartedAt: now,
    sessionStartedAt: now,
    activeItemId: nextItemId,
    completionNotifiedAt: null,
  });
}

export function usePomodoroCompletionNotification() {
  useEffect(() => {
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer == null) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      const state = readPomodoroTimerState();
      if (
        !state ||
        state.mode !== "pomodoro" ||
        !state.running ||
        state.runStartedAt == null
      ) {
        return;
      }

      const token = completionToken(state);
      if (token == null || state.completionNotifiedAt === token) return;

      const remainingMs = pomodoroDurationMs(state) - pomodoroElapsedMs(state);
      if (remainingMs <= 0) {
        void notifyPomodoroCompleted(state).then(() => {
          const latest = readPomodoroTimerState();
          const latestToken = latest ? completionToken(latest) : null;
          if (
            latest &&
            latest.mode === "pomodoro" &&
            latest.running &&
            latestToken === token
          ) {
            savePomodoroTimerState({
              ...latest,
              completionNotifiedAt: token,
            });
          }
        });
        return;
      }

      timer = window.setTimeout(schedule, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") schedule();
    };

    schedule();
    void hydratePomodoroData().then(schedule);
    window.addEventListener(POMODORO_TIMER_STATE_CHANGED_EVENT, schedule);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearTimer();
      window.removeEventListener(POMODORO_TIMER_STATE_CHANGED_EVENT, schedule);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
