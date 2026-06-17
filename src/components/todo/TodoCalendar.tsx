import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AlarmRoundedIcon from "@mui/icons-material/AlarmRounded";
import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import iCalendarPlugin from "@fullcalendar/icalendar";
import { Allotment } from "allotment";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import interactionPlugin, {
  type DateClickArg,
  type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import zhCnLocale from "@fullcalendar/core/locales/zh-cn";
import chineseDays from "chinese-days";
import { Lunar } from "lunar-typescript";
import type {
  DateSelectArg,
  DayCellContentArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventSourceInput,
  SlotLabelContentArg,
} from "@fullcalendar/core";

import { isInboxList, todoCompletionBlocker, useTodoStore } from "./useTodoStore";
import { TodoEmoji } from "./TodoEmoji";
import { TodoItem } from "./TodoItem";
import { priorityMeta } from "./priority";
import type { TodoFolder, TodoItem as TodoItemT, TodoList, TodoStatus } from "./types";
import { ensureTodoReminderPermission } from "./todoReminders";
import { registerTodoCalendarDropTarget } from "./todoCalendarDrag";
import { useStore } from "../../state/store";
import { formatTodoZonedTime, todoTimeZoneShortLabel } from "../../lib/timeZones";

interface Props {
  isDark: boolean;
  initialView?: string;
  compact?: boolean;
}

interface CalendarDraft {
  mode: "create" | "edit";
  itemId: string | null;
  content: string;
  note: string;
  status: Exclude<TodoStatus, "abandoned">;
  dueAt: number;
  dueEndAt: number | null;
  reminderEnabled: boolean;
  listId: string;
}

interface CalendarListFilterSection {
  id: string;
  label: string;
  emoji: string;
  lists: TodoList[];
}

const DEFAULT_EVENT_DURATION_MS = 30 * 60 * 1000;
const CUSTOM_DAY_MIN = 2;
const CUSTOM_DAY_MAX = 14;
const CUSTOM_WEEK_MIN = 2;
const CUSTOM_WEEK_MAX = 12;
const CUSTOM_MONTH_MIN = 2;
const CUSTOM_MONTH_MAX = 6;
const CUSTOM_AGENDA_MIN = 1;
const CUSTOM_AGENDA_MAX = 31;

type CustomDurationKind = "days" | "weeks" | "months" | "agenda";

type CalendarSubscriptionType = "url" | "file";

interface CalendarSubscription {
  id: string;
  type: CalendarSubscriptionType;
  name: string;
  enabled: boolean;
  url: string;
  sourceUrl: string;
  color: string;
  fileName?: string;
  icsText?: string;
}

interface StoredCalendarSubscription {
  id?: string;
  type?: CalendarSubscriptionType;
  name?: string;
  enabled?: boolean;
  url?: string;
  color?: string;
  fileName?: string;
  icsText?: string;
}

const CALENDAR_SUBSCRIPTIONS_STORAGE_KEY = "aebox.todo.calendarSubscriptions.v1";
const TODO_SPLIT_KEY = "aebox.todo.splitSizes";
const CALENDAR_INBOX_SPLIT_KEY = "aebox.todo.calendarInboxSplitSizes";
const CALENDAR_INBOX_COLLAPSED_KEY = "aebox.todo.calendarInboxCollapsed";
const TODO_DETAIL_PANE_WIDTH = 360;
const CALENDAR_INBOX_ANIMATION_MS = 180;
const CALENDAR_INBOX_COLLAPSE_ICON =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\'%3E%3Cpath fill=\'black\' d=\'M5.7 12 10 7.7 8.6 6.3 2.9 12l5.7 5.7 1.4-1.4L5.7 12ZM12 7h8v2h-8V7Zm0 4h8v2h-8v-2Zm0 4h8v2h-8v-2Z\'/%3E%3C/svg%3E")';
const CALENDAR_INBOX_EXPAND_ICON =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\'%3E%3Cpath fill=\'black\' d=\'M4 7h8v2H4V7Zm0 4h8v2H4v-2Zm0 4h8v2H4v-2Zm11.4-8.7L14 7.7l4.3 4.3-4.3 4.3 1.4 1.4 5.7-5.7-5.7-5.7Z\'/%3E%3C/svg%3E")';
const CALENDAR_SUBSCRIPTION_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
] as const;

const MONTH_LABELS = [
  "一月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function readStoredNumberArray(key: string, length: number): number[] | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === length &&
      parsed.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      return parsed;
    }
  } catch {
    /* localStorage may be disabled or contain stale data */
  }
  return undefined;
}

function readTodoDetailPaneWidth(): number {
  const sizes = readStoredNumberArray(TODO_SPLIT_KEY, 3);
  return sizes?.[1] ?? TODO_DETAIL_PANE_WIDTH;
}

function readCalendarInboxSplitSizes(): number[] | undefined {
  return readStoredNumberArray(CALENDAR_INBOX_SPLIT_KEY, 2);
}

function saveCalendarInboxSplitSizes(sizes: number[]): void {
  if (sizes.length !== 2) return;
  try {
    localStorage.setItem(CALENDAR_INBOX_SPLIT_KEY, JSON.stringify(sizes));
  } catch {
    /* localStorage may be disabled */
  }
}

function readCalendarInboxCollapsed(): boolean {
  try {
    return localStorage.getItem(CALENDAR_INBOX_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveCalendarInboxCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(CALENDAR_INBOX_COLLAPSED_KEY, collapsed ? "true" : "false");
  } catch {
    /* localStorage may be disabled */
  }
}

function pickListId(lists: TodoList[], defaultListId: string | null): string {
  if (defaultListId && lists.some((list) => list.id === defaultListId)) {
    return defaultListId;
  }
  return lists[0]?.id ?? "";
}

function clickDateToDueAt(arg: DateClickArg): number {
  const date = new Date(arg.date);
  date.setSeconds(0, 0);
  if (arg.allDay) {
    date.setHours(9, 0, 0, 0);
  }
  return date.getTime();
}

function formatDateRange(startTs: number, endTs: number | null): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (endTs != null && endTs > startTs) {
    return `${formatter.format(new Date(startTs))} - ${formatter.format(new Date(endTs))}`;
  }
  return formatter.format(new Date(startTs));
}

function selectRangeToDraft(arg: DateSelectArg): Pick<CalendarDraft, "dueAt" | "dueEndAt"> {
  const start = new Date(arg.start);
  const end = new Date(arg.end);
  start.setSeconds(0, 0);
  end.setSeconds(0, 0);
  if (arg.allDay) {
    start.setHours(9, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    end.setHours(18, 0, 0, 0);
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  return {
    dueAt: startMs,
    dueEndAt: endMs > startMs ? endMs : null,
  };
}

function itemToDraft(item: TodoItemT): CalendarDraft {
  return {
    mode: "edit",
    itemId: item.id,
    content: item.content,
    note: noteHtmlToText(item.note),
    status: item.status === "completed" ? "completed" : "pending",
    dueAt: item.dueAt ?? Date.now(),
    dueEndAt: item.dueEndAt,
    reminderEnabled: item.reminderEnabled,
    listId: item.listId,
  };
}

function formatEventTime(start: Date | null, end: Date | null, hasRange: boolean): string {
  if (!start) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  const startText = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  if (!hasRange || !end || end.getTime() <= start.getTime()) return startText;
  return `${startText}-${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

function toDatetimeLocalValue(ts: number | null): string {
  if (ts == null) return "";
  const d = new Date(ts);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const ts = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  ).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function noteHtmlToText(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) return "";
  const withLineBreaks = trimmed
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p/gi, "</p>\n\n<p")
    .replace(/<\/div>\s*<div/gi, "</div>\n<div");
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = withLineBreaks;
    return normalizeNoteText(container.textContent ?? "");
  }
  return normalizeNoteText(withLineBreaks.replace(/<[^>]*>/g, " "));
}

function localDayKey(input: Date | number): string {
  const d = typeof input === "number" ? new Date(input) : input;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfLocalDayMs(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addLocalDaysMs(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function addLocalYears(date: Date, years: number): Date {
  return new Date(date.getFullYear() + years, date.getMonth(), date.getDate());
}

function buildMonthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const d = new Date(start);
    d.setDate(start.getDate() + index);
    return d;
  });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hourToFullCalendarTime(hour: number): string {
  const h = clampNumber(Math.floor(hour), 0, 24);
  return `${h.toString().padStart(2, "0")}:00:00`;
}

function fullCalendarTimeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function localDateKeyToDate(value: string | null): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function itemCalendarDurationMs(item: TodoItemT): number {
  return item.dueAt != null && item.dueEndAt != null && item.dueEndAt > item.dueAt
    ? item.dueEndAt - item.dueAt
    : DEFAULT_EVENT_DURATION_MS;
}

function densityBucket(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  return clampNumber(Math.ceil((count / maxCount) * 5), 1, 5);
}

function createCalendarSubscriptionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `calendar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function calendarSubscriptionColor(index: number): string {
  return CALENDAR_SUBSCRIPTION_COLORS[index % CALENDAR_SUBSCRIPTION_COLORS.length];
}

function createIcsBlobUrl(icsText: string): string {
  return URL.createObjectURL(new Blob([icsText], { type: "text/calendar;charset=utf-8" }));
}

function normalizeCalendarSubscriptionUrl(value: string): string {
  const trimmed = value.trim();
  if (/^webcal:\/\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^webcal:\/\//i, "")}`;
  }
  return trimmed;
}

function isValidCalendarSubscriptionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidIcsText(value: string): boolean {
  return /BEGIN:VCALENDAR/i.test(value);
}

async function fetchIcsText(url: string): Promise<string> {
  const response = await tauriFetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!isValidIcsText(text)) {
    throw new Error("Invalid ICS");
  }
  return text;
}

function calendarNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const filename = parts[parts.length - 1];
    const cleanFilename = filename
      ? decodeURIComponent(filename).replace(/\.ics$/i, "").trim()
      : "";
    return cleanFilename || parsed.hostname || "日历订阅";
  } catch {
    return "日历订阅";
  }
}

function calendarNameFromFileName(fileName: string): string {
  return fileName.replace(/\.ics$/i, "").trim() || "本地日历";
}

function reviveCalendarSubscription(
  raw: StoredCalendarSubscription,
  index: number,
): CalendarSubscription | null {
  const type = raw.type === "file" ? "file" : raw.type === "url" ? "url" : null;
  if (!type) return null;
  const id = raw.id || createCalendarSubscriptionId();
  const color = raw.color || calendarSubscriptionColor(index);
  const enabled = raw.enabled !== false;
  if (type === "url") {
    const url = normalizeCalendarSubscriptionUrl(raw.url ?? "");
    if (!isValidCalendarSubscriptionUrl(url)) return null;
    const icsText = raw.icsText?.trim() ? raw.icsText : undefined;
    return {
      id,
      type,
      name: raw.name?.trim() || calendarNameFromUrl(url),
      enabled,
      url,
      sourceUrl: icsText ? createIcsBlobUrl(icsText) : "",
      color,
      icsText,
    };
  }

  const icsText = raw.icsText ?? "";
  if (!icsText.trim()) return null;
  const fileName = raw.fileName || "calendar.ics";
  return {
    id,
    type,
    name: raw.name?.trim() || calendarNameFromFileName(fileName),
    enabled,
    url: fileName,
    sourceUrl: createIcsBlobUrl(icsText),
    color,
    fileName,
    icsText,
  };
}

function loadCalendarSubscriptions(): CalendarSubscription[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CALENDAR_SUBSCRIPTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((subscription, index) => reviveCalendarSubscription(subscription, index))
      .filter((subscription): subscription is CalendarSubscription => subscription != null);
  } catch {
    return [];
  }
}

function serializeCalendarSubscriptions(
  subscriptions: CalendarSubscription[],
): StoredCalendarSubscription[] {
  return subscriptions.map((subscription) => ({
    id: subscription.id,
    type: subscription.type,
    name: subscription.name,
    enabled: subscription.enabled,
    url: subscription.type === "url" ? subscription.url : undefined,
    color: subscription.color,
    fileName: subscription.fileName,
    icsText: subscription.icsText,
  }));
}

function isTodoCalendarStatus(status: unknown): status is Exclude<TodoStatus, "abandoned"> {
  return status === "pending" || status === "completed";
}

type CalendarDayBadgeKind = "holiday" | "rest" | "workday" | "term";

interface ChineseCalendarMeta {
  holidayName: string | null;
  solarTerm: string | null;
  isRestDay: boolean;
  isAdjustedWorkday: boolean;
}

function isMonthDayGridView(viewType: string): boolean {
  return viewType === "dayGridMonth" || viewType === "customMonths";
}

function isTodoDayGridView(viewType: string): boolean {
  return isMonthDayGridView(viewType) || viewType === "dayGridWeek" || viewType === "customWeeks";
}

function isTodoTimeGridView(viewType: string): boolean {
  return (
    viewType === "timeGridDay" ||
    viewType === "customDays"
  );
}

function parseChineseHolidayName(name: string): string | null {
  const [, chineseName] = name.split(",");
  return chineseName?.trim() || null;
}

function getChineseCalendarMeta(date: Date): ChineseCalendarMeta {
  const key = localDayKey(date);
  const dayDetail = chineseDays.getDayDetail(key);
  const relatedHolidayName = parseChineseHolidayName(dayDetail.name);
  const solarTerm = chineseDays.getSolarTerms(key, key)[0]?.name ?? null;
  return {
    holidayName: dayDetail.work ? null : relatedHolidayName,
    solarTerm,
    isRestDay: !dayDetail.work,
    isAdjustedWorkday: dayDetail.work && relatedHolidayName != null,
  };
}

function formatLunarDateLabel(date: Date): string {
  const lunar = Lunar.fromDate(date);
  if (lunar.getDay() === 1) {
    return `${lunar.getMonthInChinese()}月`;
  }
  return lunar.getDayInChinese();
}

function plainTextToNoteHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block).replace(/\n/g, "<br>"))
    .filter(Boolean)
    .map((block) => `<p>${block}</p>`)
    .join("");
}

function normalizeNoteText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function compareCalendarOrderName<T extends { order: number; name: string; createdAt: number }>(
  a: T,
  b: T,
): number {
  return (
    a.order - b.order ||
    a.createdAt - b.createdAt ||
    a.name.localeCompare(b.name, "zh-Hans-CN")
  );
}

function buildCalendarListFilterSections(
  folders: TodoFolder[],
  activeLists: TodoList[],
): { rootLists: TodoList[]; folderSections: CalendarListFilterSection[] } {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const rootLists = activeLists
    .filter((list) => list.folderId == null || !folderIds.has(list.folderId))
    .sort(compareCalendarOrderName);

  const folderSections = [...folders]
    .sort(compareCalendarOrderName)
    .map((folder) => ({
      id: folder.id,
      label: folder.name,
      emoji: folder.emoji,
      lists: activeLists
        .filter((list) => list.folderId === folder.id)
        .sort(compareCalendarOrderName),
    }))
    .filter((section) => section.lists.length > 0);

  return { rootLists, folderSections };
}

export function TodoCalendar({
  isDark,
  initialView = "dayGridMonth",
  compact = false,
}: Props) {
  const theme = useTheme();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const calendarSurfaceRef = useRef<HTMLDivElement | null>(null);
  const yearViewScrollRef = useRef<HTMLDivElement | null>(null);
  const yearViewMonthRefs = useRef<Array<HTMLDivElement | null>>([]);
  const calendarRef = useRef<FullCalendar | null>(null);
  const items = useTodoStore((s) => s.items);
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const defaultListId = useTodoStore((s) => s.defaultListId);
  const addItem = useTodoStore((s) => s.addItem);
  const updateItem = useTodoStore((s) => s.updateItem);
  const setStatus = useTodoStore((s) => s.setStatus);
  const setDueRange = useTodoStore((s) => s.setDueRange);
  const moveItem = useTodoStore((s) => s.moveItem);
  const ensureDefaultList = useTodoStore((s) => s.ensureDefaultList);
  const ensureInboxList = useTodoStore((s) => s.ensureInboxList);
  const selectedItemId = useTodoStore((s) => s.selectedItemId);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const todoDayStartHour = useStore((s) => s.appSettings.todoDayStartHour);
  const todoDayEndHour = useStore((s) => s.appSettings.todoDayEndHour);
  const todoShowWeekNumbers = useStore((s) => s.appSettings.todoShowWeekNumbers);
  const todoShowChineseCalendar = useStore((s) => s.appSettings.todoShowChineseCalendar);
  const todoShowLunarCalendar = useStore((s) => s.appSettings.todoShowLunarCalendar);
  const todoFirstDay = useStore((s) => s.appSettings.todoFirstDay);
  const todoTimeZones = useStore((s) => s.appSettings.todoTimeZones);
  const visibleTodoTimeZones = useMemo(() => todoTimeZones.slice(0, 5), [todoTimeZones]);
  const timeZoneSlotRemoteColumnCount = visibleTodoTimeZones.length;
  const timeZoneSlotColumnCount =
    timeZoneSlotRemoteColumnCount > 0 ? timeZoneSlotRemoteColumnCount + 1 : 0;
  const timeZoneSlotRemoteColumnWidth = 54;
  const timeZoneSlotLocalColumnWidth = 68;
  const timeZoneSlotGapWidth = 2;
  const timeZoneSlotColumnWidth =
    timeZoneSlotColumnCount > 0
      ? timeZoneSlotRemoteColumnCount * timeZoneSlotRemoteColumnWidth +
        timeZoneSlotLocalColumnWidth +
        Math.max(0, timeZoneSlotColumnCount - 1) * timeZoneSlotGapWidth
      : undefined;
  const timeZoneSlotGridTemplate =
    timeZoneSlotColumnCount > 0
      ? `${Array.from(
          { length: timeZoneSlotRemoteColumnCount },
          () => `minmax(${timeZoneSlotRemoteColumnWidth}px, 1fr)`,
        ).join(" ")} minmax(${timeZoneSlotLocalColumnWidth}px, 1.2fr)`.trim()
      : undefined;
  const timeZoneSlotAxisWidth =
    timeZoneSlotColumnWidth !== undefined ? `${timeZoneSlotColumnWidth}px !important` : undefined;

  const activeLists = useMemo(
    () =>
      [...lists]
        .filter((list) => list.archivedAt == null || isInboxList(list))
        .sort((a, b) => a.order - b.order),
    [lists],
  );
  const { rootLists: calendarRootLists, folderSections: calendarFolderSections } = useMemo(
    () => buildCalendarListFilterSections(folders, activeLists),
    [activeLists, folders],
  );
  const listId = useMemo(
    () => pickListId(activeLists, defaultListId),
    [activeLists, defaultListId],
  );
  const inboxList = useMemo(() => lists.find(isInboxList) ?? null, [lists]);
  const inboxItems = useMemo(
    () =>
      inboxList
        ? items
            .filter(
              (item) =>
                item.listId === inboxList.id &&
                item.deletedAt == null &&
                item.status === "pending",
            )
            .sort((a, b) => a.order - b.order)
        : [],
    [inboxList, items],
  );

  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [viewMenuAnchor, setViewMenuAnchor] = useState<HTMLElement | null>(null);
  const [calendarViewType, setCalendarViewType] = useState(initialView);
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [customDayCount, setCustomDayCount] = useState(3);
  const [customWeekCount, setCustomWeekCount] = useState(2);
  const [customMonthCount, setCustomMonthCount] = useState(2);
  const [agendaDayCount, setAgendaDayCount] = useState(3);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listFilterFolderCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const refreshedUrlSubscriptionIdsRef = useRef<Set<string>>(new Set());
  const keepYearViewOnNextDatesSetRef = useRef(false);
  const knownCalendarListIdsRef = useRef<Set<string>>(
    new Set(activeLists.map((list) => list.id)),
  );
  const [listFilterMenuAnchor, setListFilterMenuAnchor] = useState<HTMLElement | null>(null);
  const [listFilterFolderAnchor, setListFilterFolderAnchor] = useState<{
    el: HTMLElement;
    folderId: string;
  } | null>(null);
  const [calendarShowCompleted, setCalendarShowCompleted] = useState(true);
  const [calendarVisibleListIds, setCalendarVisibleListIds] = useState<Set<string>>(
    () => new Set(activeLists.map((list) => list.id)),
  );
  const [subscriptionMenuAnchor, setSubscriptionMenuAnchor] = useState<HTMLElement | null>(null);
  const [calendarSubscriptions, setCalendarSubscriptions] = useState<CalendarSubscription[]>(
    loadCalendarSubscriptions,
  );
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const [urlImportName, setUrlImportName] = useState("");
  const [urlImportValue, setUrlImportValue] = useState("");
  const [urlImportLoading, setUrlImportLoading] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [isTodoDragOver, setIsTodoDragOver] = useState(false);
  const [inboxPaneCollapsed, setInboxPaneCollapsed] = useState(readCalendarInboxCollapsed);
  const [inboxPaneAnimationReady, setInboxPaneAnimationReady] = useState(false);

  useEffect(() => {
    const activeIds = new Set(activeLists.map((list) => list.id));
    const knownIds = knownCalendarListIdsRef.current;

    setCalendarVisibleListIds((current) => {
      const next = new Set<string>();
      for (const list of activeLists) {
        if (current.has(list.id) || !knownIds.has(list.id)) {
          next.add(list.id);
        }
      }
      return areStringSetsEqual(current, next) ? current : next;
    });
    knownCalendarListIdsRef.current = activeIds;
  }, [activeLists]);

  const selectedCalendarListCount = useMemo(
    () =>
      activeLists.reduce(
        (count, list) => count + (calendarVisibleListIds.has(list.id) ? 1 : 0),
        0,
      ),
    [activeLists, calendarVisibleListIds],
  );
  const allCalendarListsVisible =
    activeLists.length > 0 && selectedCalendarListCount === activeLists.length;
  const partiallyFilteredCalendarLists =
    selectedCalendarListCount > 0 && selectedCalendarListCount < activeLists.length;
  const listFilterButtonText =
    activeLists.length > 0 && selectedCalendarListCount !== activeLists.length
      ? `筛选 ${selectedCalendarListCount}/${activeLists.length}`
      : "筛选";
  const activeCalendarFilterFolderSection =
    listFilterFolderAnchor != null
      ? calendarFolderSections.find((section) => section.id === listFilterFolderAnchor.folderId) ??
        null
      : null;

  const clearListFilterFolderCloseTimer = useCallback(() => {
    if (listFilterFolderCloseTimerRef.current == null) return;
    window.clearTimeout(listFilterFolderCloseTimerRef.current);
    listFilterFolderCloseTimerRef.current = null;
  }, []);

  const scheduleListFilterFolderClose = useCallback(() => {
    clearListFilterFolderCloseTimer();
    listFilterFolderCloseTimerRef.current = window.setTimeout(() => {
      setListFilterFolderAnchor(null);
      listFilterFolderCloseTimerRef.current = null;
    }, 160);
  }, [clearListFilterFolderCloseTimer]);

  const openListFilterFolder = useCallback(
    (el: HTMLElement, folderId: string) => {
      clearListFilterFolderCloseTimer();
      setListFilterFolderAnchor((current) =>
        current?.el === el && current.folderId === folderId ? current : { el, folderId },
      );
    },
    [clearListFilterFolderCloseTimer],
  );

  const closeListFilterMenu = useCallback(() => {
    clearListFilterFolderCloseTimer();
    setListFilterFolderAnchor(null);
    setListFilterMenuAnchor(null);
  }, [clearListFilterFolderCloseTimer]);

  const toggleAllCalendarListsVisible = useCallback(() => {
    setCalendarVisibleListIds((current) => {
      if (activeLists.length === 0) return current;
      const activeIds = activeLists.map((list) => list.id);
      const allVisible = activeIds.every((id) => current.has(id));
      return new Set(allVisible ? [] : activeIds);
    });
  }, [activeLists]);

  const toggleCalendarListGroupVisible = useCallback((listIds: string[]) => {
    setCalendarVisibleListIds((current) => {
      if (listIds.length === 0) return current;
      const allVisible = listIds.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of listIds) {
        if (allVisible) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  const toggleCalendarListVisible = useCallback((listId: string) => {
    setCalendarVisibleListIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) {
        next.delete(listId);
      } else {
        next.add(listId);
      }
      return next;
    });
  }, []);

  useEffect(() => () => clearListFilterFolderCloseTimer(), [clearListFilterFolderCloseTimer]);

  const dayTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (
        item.deletedAt != null ||
        item.dueAt == null ||
        !calendarVisibleListIds.has(item.listId) ||
        (item.status !== "pending" && (!calendarShowCompleted || item.status !== "completed"))
      ) {
        continue;
      }
      const endSource =
        item.dueEndAt != null && item.dueEndAt > item.dueAt
          ? item.dueEndAt
          : item.dueAt;
      const startDay = startOfLocalDayMs(item.dueAt);
      const endDay = startOfLocalDayMs(endSource);
      let guard = 0;
      for (let day = startDay; day <= endDay && guard < 370; day = addLocalDaysMs(day, 1)) {
        const key = localDayKey(day);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        guard += 1;
      }
    }
    return counts;
  }, [calendarShowCompleted, calendarVisibleListIds, items]);

  const maxDayTaskCount = useMemo(
    () => Math.max(0, ...Array.from(dayTaskCounts.values())),
    [dayTaskCounts],
  );

  const viewPickerLabel =
    calendarViewType === "customDays"
      ? `${customDayCount}日`
      : calendarViewType === "customWeeks"
        ? `${customWeekCount}周`
        : calendarViewType === "customMonths"
          ? `${customMonthCount}月`
          : calendarViewType === "customAgenda"
            ? `日程 ${agendaDayCount}天`
          : "自定义";
  const isYearView = calendarViewType === "todoYear";
  const showInboxPane = !compact;
  const showInboxToggle = showInboxPane;
  const inboxPaneVisible = showInboxPane && !inboxPaneCollapsed;
  const calendarInboxDefaultSizes = useMemo(() => readCalendarInboxSplitSizes(), []);
  const calendarInboxPreferredSize = useMemo(() => readTodoDetailPaneWidth(), []);
  const todoDayTimeRange = useMemo(() => {
    const startHour = clampNumber(Math.floor(todoDayStartHour), 0, 22);
    const endHour = Math.max(
      startHour + 1,
      clampNumber(Math.floor(todoDayEndHour), 1, 23),
    );
    // Settings store the last visible hour; FullCalendar end times are exclusive.
    const exclusiveEndHour = Math.min(24, endHour + 1);
    const startTime = hourToFullCalendarTime(startHour);
    const endTime = hourToFullCalendarTime(exclusiveEndHour);
    return {
      slotMinTime: startTime,
      slotMaxTime: endTime,
      businessHours: {
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime,
        endTime,
      },
    };
  }, [todoDayEndHour, todoDayStartHour]);

  const updateCalendarSize = useCallback(() => {
    calendarRef.current?.getApi().updateSize();
  }, []);

  const onCalendarSplitChange = useCallback(() => {
    updateCalendarSize();
    window.requestAnimationFrame(updateCalendarSize);
  }, [updateCalendarSize]);

  const toggleInboxPaneCollapsed = useCallback(() => {
    setInboxPaneCollapsed((collapsed) => {
      const next = !collapsed;
      saveCalendarInboxCollapsed(next);
      return next;
    });
    window.requestAnimationFrame(updateCalendarSize);
    window.setTimeout(updateCalendarSize, 80);
    window.setTimeout(updateCalendarSize, CALENDAR_INBOX_ANIMATION_MS + 40);
  }, [updateCalendarSize]);

  const onCalendarSplitDragEnd = useCallback(
    (sizes: number[]) => {
      if (!inboxPaneVisible) {
        onCalendarSplitChange();
        return;
      }
      saveCalendarInboxSplitSizes(sizes);
      onCalendarSplitChange();
    },
    [inboxPaneVisible, onCalendarSplitChange],
  );

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setInboxPaneAnimationReady(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(() => {
    if (!compact) {
      ensureInboxList();
    }
  }, [compact, ensureInboxList]);

  useEffect(() => {
    const firstFrame = window.requestAnimationFrame(() => {
      updateCalendarSize();
      window.requestAnimationFrame(updateCalendarSize);
    });
    const timers = [
      window.setTimeout(updateCalendarSize, 80),
      window.setTimeout(updateCalendarSize, 240),
    ];
    const observer =
      rootRef.current && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateCalendarSize)
        : null;

    if (rootRef.current) {
      observer?.observe(rootRef.current);
    }
    window.addEventListener("resize", updateCalendarSize);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      timers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
      window.removeEventListener("resize", updateCalendarSize);
    };
  }, [updateCalendarSize]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CALENDAR_SUBSCRIPTIONS_STORAGE_KEY,
        JSON.stringify(serializeCalendarSubscriptions(calendarSubscriptions)),
      );
    } catch {
      // Local ICS files can exceed browser storage quotas; keep the in-memory import usable.
    }
  }, [calendarSubscriptions]);

  useEffect(() => {
    let cancelled = false;
    const targets = calendarSubscriptions.filter(
      (subscription) =>
        subscription.type === "url" &&
        !refreshedUrlSubscriptionIdsRef.current.has(subscription.id),
    );
    targets.forEach((subscription) => {
      refreshedUrlSubscriptionIdsRef.current.add(subscription.id);
      fetchIcsText(subscription.url)
        .then((icsText) => {
          if (cancelled) return;
          setCalendarSubscriptions((current) =>
            current.map((item) =>
              item.id === subscription.id
                ? { ...item, icsText, sourceUrl: createIcsBlobUrl(icsText) }
                : item,
            ),
          );
        })
        .catch(() => {
          if (!cancelled) {
            setSubscriptionError(`订阅加载失败：${subscription.name}`);
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [calendarSubscriptions]);

  const events = useMemo<EventInput[]>(
    () =>
      items
        .filter(
          (item) =>
            item.deletedAt == null &&
            (item.status === "pending" ||
              (calendarShowCompleted && item.status === "completed")) &&
            item.dueAt != null &&
            calendarVisibleListIds.has(item.listId),
        )
        .map((item) => {
          const priority = priorityMeta(item.priority);
          const start = item.dueAt ?? Date.now();
          const hasRange = item.dueEndAt != null && item.dueEndAt > start;
          return {
            id: item.id,
            title: item.content,
            start,
            end: hasRange ? item.dueEndAt ?? undefined : start + DEFAULT_EVENT_DURATION_MS,
            display: "block",
            backgroundColor:
              item.status === "completed"
                ? alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.1 : 0.055)
                : alpha(priority.color, isDark ? 0.3 : 0.14),
            borderColor:
              item.status === "completed"
                ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.2)
                : alpha(priority.color, isDark ? 0.75 : 0.45),
            textColor: isDark ? "#f8fafc" : "#0f172a",
            extendedProps: {
              priority: item.priority,
              progress: item.progress,
              status: item.status,
              hasRange,
              dueAt: item.dueAt,
              dueEndAt: item.dueEndAt,
              reminderEnabled: item.reminderEnabled,
            },
          };
        }),
    [calendarShowCompleted, calendarVisibleListIds, isDark, items],
  );

  const calendarSubscriptionIds = useMemo(
    () => new Set(calendarSubscriptions.map((subscription) => subscription.id)),
    [calendarSubscriptions],
  );
  const calendarSubscriptionById = useMemo(
    () => new Map(calendarSubscriptions.map((subscription) => [subscription.id, subscription])),
    [calendarSubscriptions],
  );
  const subscriptionEventSources = useMemo<EventSourceInput[]>(
    () =>
      calendarSubscriptions
        .filter((subscription) => subscription.enabled && subscription.sourceUrl)
        .map(
          (subscription) =>
            ({
              id: subscription.id,
              url: subscription.sourceUrl,
              format: "ics",
              color: alpha(subscription.color, isDark ? 0.72 : 0.16),
              borderColor: alpha(subscription.color, isDark ? 0.95 : 0.42),
              textColor: isDark ? "#f8fafc" : "#0f172a",
              editable: false,
              startEditable: false,
              durationEditable: false,
            }) as EventSourceInput,
        ),
    [calendarSubscriptions, isDark],
  );
  const calendarEventSources = useMemo<EventSourceInput[]>(
    () => [events, ...subscriptionEventSources],
    [events, subscriptionEventSources],
  );

  const openUrlImportDialog = () => {
    setSubscriptionMenuAnchor(null);
    setSubscriptionError(null);
    setUrlImportName("");
    setUrlImportValue("");
    setUrlImportOpen(true);
  };

  const closeUrlImportDialog = () => {
    setUrlImportOpen(false);
    setUrlImportLoading(false);
    setSubscriptionError(null);
  };

  const submitUrlSubscription = async () => {
    const normalizedUrl = normalizeCalendarSubscriptionUrl(urlImportValue);
    if (!isValidCalendarSubscriptionUrl(normalizedUrl)) {
      setSubscriptionError("请输入 http(s) 或 webcal 订阅地址");
      return;
    }
    if (calendarSubscriptions.some((subscription) => subscription.url === normalizedUrl)) {
      setSubscriptionError("这个订阅已经导入");
      return;
    }
    setUrlImportLoading(true);
    let icsText: string;
    try {
      icsText = await fetchIcsText(normalizedUrl);
    } catch {
      setUrlImportLoading(false);
      setSubscriptionError("订阅加载失败，请检查地址或网络权限");
      return;
    }
    const id = createCalendarSubscriptionId();
    refreshedUrlSubscriptionIdsRef.current.add(id);
    setCalendarSubscriptions((current) => [
      ...current,
      {
        id,
        type: "url",
        name: urlImportName.trim() || calendarNameFromUrl(normalizedUrl),
        enabled: true,
        url: normalizedUrl,
        sourceUrl: createIcsBlobUrl(icsText),
        color: calendarSubscriptionColor(current.length),
        icsText,
      },
    ]);
    closeUrlImportDialog();
  };

  const openLocalIcsPicker = () => {
    setSubscriptionError(null);
    fileInputRef.current?.click();
  };

  const onLocalIcsFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const icsText = await file.text();
      if (!isValidIcsText(icsText)) {
        setSubscriptionError("请选择有效的 .ics 日历文件");
        return;
      }
      setCalendarSubscriptions((current) => [
        ...current,
        {
          id: createCalendarSubscriptionId(),
          type: "file",
          name: calendarNameFromFileName(file.name),
          enabled: true,
          url: file.name,
          sourceUrl: createIcsBlobUrl(icsText),
          color: calendarSubscriptionColor(current.length),
          fileName: file.name,
          icsText,
        },
      ]);
      setSubscriptionError(null);
    } catch {
      setSubscriptionError("无法读取该 .ics 文件");
    }
  };

  const toggleCalendarSubscription = (id: string) => {
    setCalendarSubscriptions((current) =>
      current.map((subscription) =>
        subscription.id === id
          ? { ...subscription, enabled: !subscription.enabled }
          : subscription,
      ),
    );
  };

  const deleteCalendarSubscription = (id: string) => {
    refreshedUrlSubscriptionIdsRef.current.delete(id);
    setCalendarSubscriptions((current) =>
      current.filter((subscription) => subscription.id !== id),
    );
  };

  const openCreateDialog = (arg: DateClickArg) => {
    const dueAt = clickDateToDueAt(arg);
    setDraft({
      mode: "create",
      itemId: null,
      content: "",
      note: "",
      status: "pending",
      dueAt,
      dueEndAt: null,
      reminderEnabled: false,
      listId,
    });
  };

  const openCreateForDate = (date: Date) => {
    const due = new Date(date);
    due.setHours(9, 0, 0, 0);
    setDraft({
      mode: "create",
      itemId: null,
      content: "",
      note: "",
      status: "pending",
      dueAt: due.getTime(),
      dueEndAt: null,
      reminderEnabled: false,
      listId,
    });
  };

  const openSelectDialog = (arg: DateSelectArg) => {
    const range = selectRangeToDraft(arg);
    setDraft({
      mode: "create",
      itemId: null,
      content: "",
      note: "",
      status: "pending",
      dueAt: range.dueAt,
      dueEndAt: range.dueEndAt,
      reminderEnabled: false,
      listId,
    });
  };

  const openEditDialog = (itemId: string) => {
    const item = useTodoStore.getState().items.find((it) => it.id === itemId);
    if (!item || item.dueAt == null) return;
    setSelectedItemId(item.id);
    setDraft(itemToDraft(item));
  };

  const closeCalendarDialog = () => setDraft(null);

  const submitDraft = () => {
    if (!draft) return;
    const content = draft.content.trim();
    if (!content) return;
    const targetListId = draft.listId || ensureDefaultList();
    const dueEndAt =
      draft.dueEndAt != null && draft.dueEndAt > draft.dueAt ? draft.dueEndAt : null;
    const note = plainTextToNoteHtml(draft.note);

    if (draft.mode === "edit" && draft.itemId) {
      const current = useTodoStore.getState().items.find((item) => item.id === draft.itemId);
      if (!current) return;
      if (current.listId !== targetListId) {
        moveItem(draft.itemId, targetListId);
      }
      updateItem(draft.itemId, { content, note });
      setDueRange(draft.itemId, draft.dueAt, dueEndAt, draft.reminderEnabled);
      if (current.status !== draft.status) {
        setStatus(draft.itemId, draft.status);
      }
      setSelectedItemId(draft.itemId);
    } else {
      const item = addItem(targetListId, content);
      if (item) {
        if (note) {
          updateItem(item.id, { note });
        }
        setDueRange(item.id, draft.dueAt, dueEndAt, draft.reminderEnabled);
        if (draft.status === "completed") {
          setStatus(item.id, "completed");
        }
        setSelectedItemId(item.id);
      }
    }
    closeCalendarDialog();
  };

  const onDraftKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitDraft();
    }
  };

  const onEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    if (!isTodoCalendarStatus(arg.event.extendedProps.status)) return;
    const target = arg.jsEvent.target as HTMLElement | null;
    if (target?.closest("[data-calendar-status]")) return;
    openEditDialog(arg.event.id);
  };

  const toggleEventStatus = (itemId: string, status: TodoStatus) => {
    const next = status === "completed" ? "pending" : "completed";
    setStatus(itemId, next);
    setSelectedItemId(itemId);
  };

  const renderCalendarEvent = (arg: EventContentArg) => {
    const status = arg.event.extendedProps.status;
    const isTodoEvent = isTodoCalendarStatus(status);
    if (!isTodoEvent) {
      const subscription = calendarSubscriptionById.get(arg.event.source?.id ?? "");
      const timeText = arg.event.allDay
        ? ""
        : formatEventTime(
            arg.event.start,
            arg.event.end,
            Boolean(
              arg.event.start &&
                arg.event.end &&
                arg.event.end.getTime() > arg.event.start.getTime(),
            ),
          );
      return (
        <Box className="todo-calendar-event-content">
          <Box
            component="span"
            sx={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              flexShrink: 0,
              bgcolor: subscription?.color ?? "primary.main",
            }}
          />
          <Typography className="todo-calendar-event-title">
            {arg.event.title || subscription?.name || "日程"}
          </Typography>
          {timeText && (
            <Typography component="span" className="todo-calendar-event-time">
              {timeText}
            </Typography>
          )}
        </Box>
      );
    }

    const completed = status === "completed";
    const eventItem = items.find((item) => item.id === arg.event.id) ?? null;
    const completionBlocker = eventItem ? todoCompletionBlocker(eventItem, items) : null;
    const completionLocked = !completed && completionBlocker != null;
    const completionLabel = completionLocked
      ? `前序任务未完成：${completionBlocker?.content.trim() || "未命名待办"}`
      : completed
        ? "设为未完成"
        : "设为已完成";
    const reminderEnabled = Boolean(arg.event.extendedProps.reminderEnabled);
    return (
      <Box className="todo-calendar-event-content todo-calendar-todo-event-content">
        <Tooltip title={completionLabel}>
          <span
            data-calendar-status
            style={{ display: "inline-flex", flexShrink: 0 }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <IconButton
              size="small"
              aria-label={completionLabel}
              disabled={completionLocked}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!completionLocked) toggleEventStatus(arg.event.id, status);
              }}
              sx={{
                width: 18,
                height: 18,
                p: 0,
                flexShrink: 0,
                color: completed ? "success.main" : "text.secondary",
              }}
            >
              {completionLocked ? (
                <LockRoundedIcon sx={{ fontSize: 14 }} />
              ) : completed ? (
                <CheckCircleRoundedIcon sx={{ fontSize: 14 }} />
              ) : (
                <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 14 }} />
              )}
            </IconButton>
          </span>
        </Tooltip>
        <Typography className="todo-calendar-event-title">{arg.event.title}</Typography>
        {reminderEnabled && (
          <AlarmRoundedIcon sx={{ fontSize: 13, color: "warning.main", flexShrink: 0 }} />
        )}
      </Box>
    );
  };

  const renderSlotLabel = (arg: SlotLabelContentArg) => {
    if (!isTodoTimeGridView(arg.view.type) || visibleTodoTimeZones.length === 0) {
      return arg.text;
    }

    return (
      <Box
        className="todo-calendar-slot-zone-labels"
        sx={{
          width: timeZoneSlotColumnWidth,
          minWidth: timeZoneSlotColumnWidth,
          gridTemplateColumns: timeZoneSlotGridTemplate,
        }}
      >
        {visibleTodoTimeZones.map((timeZone) => {
          const zonedTime = formatTodoZonedTime(arg.date, timeZone, arg.view.currentStart ?? calendarDate);
          const timeClassName = [
            "todo-calendar-slot-zone-time",
            zonedTime.dayOffset > 0 ? "is-next-day" : "",
            zonedTime.dayOffset < 0 ? "is-prev-day" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const timeNode = (
            <Box component="span" className={timeClassName}>
              {zonedTime.time}
            </Box>
          );
          return (
            <Box key={timeZone} component="span" className="todo-calendar-slot-zone">
              <Box component="span" className="todo-calendar-slot-zone-name">
                {todoTimeZoneShortLabel(timeZone)}
              </Box>
              <Box component="span" className="todo-calendar-slot-zone-time-row">
                {zonedTime.dateLabel ? (
                  <Tooltip
                    title={zonedTime.dateLabel ?? ""}
                    placement="right"
                    arrow
                    disableInteractive
                  >
                    {timeNode}
                  </Tooltip>
                ) : (
                  timeNode
                )}
              </Box>
            </Box>
          );
        })}
        <Box component="span" className="todo-calendar-slot-zone is-local">
          <Box component="span" className="todo-calendar-slot-zone-name">
            本地
          </Box>
          <Box component="span" className="todo-calendar-slot-zone-time-row">
            <Box component="span" className="todo-calendar-slot-zone-time">
              {arg.text}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  };

  const getDayBadgeSx = (kind: CalendarDayBadgeKind) => {
    const color =
      kind === "holiday"
        ? theme.palette.error.main
        : kind === "workday"
          ? theme.palette.warning.main
          : kind === "term"
            ? theme.palette.success.main
            : theme.palette.primary.main;
    return {
      display: "inline-flex",
      alignItems: "center",
      maxWidth: 56,
      height: 16,
      px: 0.45,
      borderRadius: 0.75,
      bgcolor: alpha(color, isDark ? 0.22 : 0.1),
      border: `1px solid ${alpha(color, isDark ? 0.34 : 0.18)}`,
      color,
      fontSize: 10,
      fontWeight: 700,
      lineHeight: "14px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    };
  };

  const renderCalendarDayCell = (arg: DayCellContentArg) => {
    if (!isMonthDayGridView(arg.view.type)) {
      return arg.dayNumberText;
    }

    const meta = todoShowChineseCalendar ? getChineseCalendarMeta(arg.date) : null;
    const lunarLabel = todoShowLunarCalendar ? formatLunarDateLabel(arg.date) : null;
    const badges: Array<{ kind: CalendarDayBadgeKind; label: string }> = [];
    if (meta?.holidayName) {
      badges.push({ kind: "holiday", label: meta.holidayName });
    } else if (meta?.isAdjustedWorkday) {
      badges.push({ kind: "workday", label: "班" });
    } else if (meta?.isRestDay) {
      badges.push({ kind: "rest", label: "休" });
    }
    if (meta?.solarTerm && meta.solarTerm !== meta.holidayName) {
      badges.push({ kind: "term", label: meta.solarTerm });
    }
    const hasChineseCalendarMark =
      meta?.holidayName || meta?.isAdjustedWorkday || meta?.isRestDay;

    return (
      <Box
        className="todo-calendar-day-cell-content"
        sx={{
          width: "100%",
          minWidth: 0,
          px: 0.35,
          py: 0.2,
          opacity: arg.isOther ? 0.5 : 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.35, minWidth: 0 }}>
          <Typography
            component="span"
            sx={{
              flexShrink: 0,
              fontSize: 12,
              fontWeight:
                hasChineseCalendarMark ? 700 : 600,
              lineHeight: 1.2,
              color: meta?.holidayName
                ? "error.main"
                : meta?.isAdjustedWorkday
                  ? "warning.main"
                  : "text.primary",
            }}
          >
            {arg.date.getDate()}
          </Typography>
          {badges.length > 0 && (
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                justifyContent: "flex-end",
                gap: 0.25,
                rowGap: 0.25,
                flexWrap: "wrap",
                overflow: "hidden",
              }}
            >
              {badges.map((badge) => (
                <Box
                  key={`${badge.kind}-${badge.label}`}
                  component="span"
                  sx={getDayBadgeSx(badge.kind)}
                >
                  {badge.label}
                </Box>
              ))}
            </Box>
          )}
        </Box>
        {lunarLabel && (
          <Typography component="div" className="todo-calendar-lunar-text">
            {lunarLabel}
          </Typography>
        )}
      </Box>
    );
  };

  const changeCalendarView = (viewType: string) => {
    const api = calendarRef.current?.getApi();
    const targetDate = viewType === "todoYear" ? (api?.getDate() ?? calendarDate) : calendarDate;
    if (viewType === "todoYear") {
      keepYearViewOnNextDatesSetRef.current = true;
    }
    if (api) {
      api.gotoDate(targetDate);
      api.changeView(viewType);
      window.requestAnimationFrame(() => api.updateSize());
    }
    setCalendarDate(targetDate);
    setCalendarViewType(viewType);
    setViewMenuAnchor(null);
  };

  const jumpFromYearView = (viewType: string, date: Date) => {
    const api = calendarRef.current?.getApi();
    setCalendarDate(date);
    if (api) {
      api.gotoDate(date);
      api.changeView(viewType);
      window.requestAnimationFrame(() => api.updateSize());
    }
    setCalendarViewType(viewType);
    setViewMenuAnchor(null);
  };

  const reopenCustomView = (viewType: string) => {
    window.setTimeout(() => {
      const api = calendarRef.current?.getApi();
      api?.gotoDate(calendarDate);
      api?.changeView(viewType);
      api?.updateSize();
      setCalendarViewType(viewType);
    }, 0);
  };

  const adjustCustomDuration = (kind: CustomDurationKind, delta: number) => {
    if (kind === "days") {
      setCustomDayCount((value) => clampNumber(value + delta, CUSTOM_DAY_MIN, CUSTOM_DAY_MAX));
      reopenCustomView("customDays");
      return;
    }
    if (kind === "weeks") {
      setCustomWeekCount((value) => clampNumber(value + delta, CUSTOM_WEEK_MIN, CUSTOM_WEEK_MAX));
      reopenCustomView("customWeeks");
      return;
    }
    if (kind === "agenda") {
      setAgendaDayCount((value) =>
        clampNumber(value + delta, CUSTOM_AGENDA_MIN, CUSTOM_AGENDA_MAX),
      );
      reopenCustomView("customAgenda");
      return;
    }
    setCustomMonthCount((value) =>
      clampNumber(value + delta, CUSTOM_MONTH_MIN, CUSTOM_MONTH_MAX),
    );
    reopenCustomView("customMonths");
    return;
  };

  const goYear = (delta: number) => {
    const next = addLocalYears(calendarDate, delta);
    keepYearViewOnNextDatesSetRef.current = true;
    calendarRef.current?.getApi().gotoDate(next);
    setCalendarDate(next);
  };

  const goTodayInYearView = () => {
    const today = new Date();
    keepYearViewOnNextDatesSetRef.current = true;
    calendarRef.current?.getApi().gotoDate(today);
    setCalendarDate(today);
  };

  const goCalendarToday = () => {
    if (isYearView) {
      goTodayInYearView();
      return;
    }
    calendarRef.current?.getApi().today();
  };

  const goCalendarByStep = (delta: number) => {
    if (isYearView) {
      goYear(delta);
      return;
    }
    const api = calendarRef.current?.getApi();
    if (delta < 0) {
      api?.prev();
    } else {
      api?.next();
    }
  };

  useEffect(() => {
    if (!isYearView) return;
    const monthIndex = calendarDate.getMonth();
    const frame = window.requestAnimationFrame(() => {
      const scroller = yearViewScrollRef.current;
      const monthNode = yearViewMonthRefs.current[monthIndex];
      if (!scroller || !monthNode) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const monthRect = monthNode.getBoundingClientRect();
      const top = scroller.scrollTop + monthRect.top - scrollerRect.top - 8;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calendarDate, isYearView]);

  const renderCustomDurationItem = ({
    label,
    valueLabel,
    selected,
    minDisabled,
    maxDisabled,
    kind,
    viewType,
  }: {
    label: string;
    valueLabel: string;
    selected: boolean;
    minDisabled: boolean;
    maxDisabled: boolean;
    kind: CustomDurationKind;
    viewType: string;
  }) => (
    <MenuItem selected={selected} onClick={() => changeCalendarView(viewType)}>
      <Box sx={{ width: 220, display: "flex", alignItems: "center", gap: 2 }}>
        <Typography sx={{ flex: 1, fontSize: 13 }}>{label}</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IconButton
            size="small"
            disabled={minDisabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              adjustCustomDuration(kind, -1);
            }}
            sx={{ width: 24, height: 24 }}
          >
            <RemoveRoundedIcon sx={{ fontSize: 15 }} />
          </IconButton>
          <Typography
            component="span"
            sx={{ width: 34, textAlign: "center", fontSize: 12, color: "text.secondary" }}
          >
            {valueLabel}
          </Typography>
          <IconButton
            size="small"
            disabled={maxDisabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              adjustCustomDuration(kind, 1);
            }}
            sx={{ width: 24, height: 24 }}
          >
            <AddRoundedIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>
      </Box>
    </MenuItem>
  );

  const renderYearView = () => {
    const year = calendarDate.getFullYear();
    const todayKey = localDayKey(new Date());
    return (
      <Box sx={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Box
          ref={yearViewScrollRef}
          sx={{
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "auto",
            pt: 0.9,
            px: { xs: 0.8, md: 1.2 },
            pb: 1.2,
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(220px, 1fr))",
                lg: "repeat(3, minmax(220px, 1fr))",
                xl: "repeat(4, minmax(220px, 1fr))",
              },
              columnGap: 2.6,
              rowGap: 3.2,
            }}
          >
            {MONTH_LABELS.map((monthLabel, monthIndex) => {
              const cells = buildMonthCells(year, monthIndex);
              return (
                <Box
                  key={monthLabel}
                  ref={(node: HTMLDivElement | null) => {
                    yearViewMonthRefs.current[monthIndex] = node;
                  }}
                  sx={{ minWidth: 0 }}
                >
                  <Typography
                    onClick={() => jumpFromYearView("dayGridMonth", new Date(year, monthIndex, 1))}
                    sx={{
                      fontSize: 16,
                      fontWeight: 800,
                      mb: 1.4,
                      px: 0.2,
                      cursor: "pointer",
                      width: "fit-content",
                      ":hover": { color: "primary.main" },
                    }}
                  >
                    {monthLabel}
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                      gap: 0.35,
                    }}
                  >
                    {WEEKDAY_LABELS.map((weekday) => (
                      <Typography
                        key={weekday}
                        sx={{
                          height: 22,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          color: "text.secondary",
                        }}
                      >
                        {weekday}
                      </Typography>
                    ))}
                    {cells.map((date) => {
                      const key = localDayKey(date);
                      const count = dayTaskCounts.get(key) ?? 0;
                      const bucket = densityBucket(count, maxDayTaskCount);
                      const inMonth = date.getMonth() === monthIndex;
                      const isToday = key === todayKey;
                      const bgAlpha =
                        bucket === 0
                          ? 0
                          : [0.08, 0.14, 0.21, 0.29, 0.38][bucket - 1] *
                            (isDark ? 1.18 : 1);
                      return (
                        <Tooltip
                          key={key}
                          title={count > 0 ? `${count} 个待办` : ""}
                          disableHoverListener={count === 0}
                        >
                          <Box
                            data-date={key}
                            onClick={() => jumpFromYearView("timeGridDay", date)}
                            sx={{
                              height: 30,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 0.7,
                              cursor: "pointer",
                              border: isToday ? 1 : 0,
                              borderColor: "primary.main",
                              bgcolor:
                                bucket > 0
                                  ? alpha(theme.palette.primary.main, bgAlpha)
                                  : "transparent",
                              color: inMonth ? "text.primary" : "text.disabled",
                              opacity: inMonth ? 1 : 0.62,
                              fontSize: 12,
                              fontWeight: isToday || bucket >= 4 ? 700 : 500,
                              ":hover": {
                                bgcolor: alpha(
                                  theme.palette.primary.main,
                                  bucket > 0 ? Math.min(bgAlpha + 0.08, 0.5) : 0.1,
                                ),
                              },
                            }}
                          >
                            {date.getDate()}
                          </Box>
                        </Tooltip>
                      );
                    })}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    );
  };

  const onEventDrop = (arg: EventDropArg) => {
    const start = arg.event.start;
    if (!isTodoCalendarStatus(arg.event.extendedProps.status) || !start) {
      arg.revert();
      return;
    }
    const hasRange = Boolean(arg.event.extendedProps.hasRange);
    const end = arg.event.end?.getTime() ?? null;
    setDueRange(
      arg.event.id,
      start.getTime(),
      hasRange && end != null && end > start.getTime() ? end : null,
    );
    setSelectedItemId(arg.event.id);
  };

  const onEventResize = (arg: EventResizeDoneArg) => {
    const start = arg.event.start;
    const end = arg.event.end;
    if (
      !isTodoCalendarStatus(arg.event.extendedProps.status) ||
      !start ||
      !end ||
      end.getTime() <= start.getTime()
    ) {
      arg.revert();
      return;
    }
    setDueRange(arg.event.id, start.getTime(), end.getTime());
    setSelectedItemId(arg.event.id);
  };

  const getTodoDropDate = useCallback((clientX: number, clientY: number): Date | null => {
    const root = calendarSurfaceRef.current ?? rootRef.current;
    if (!root) return null;
    const elements =
      typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(clientX, clientY)
        : [document.elementFromPoint(clientX, clientY)].filter(Boolean);

    for (const element of elements) {
      if (!(element instanceof HTMLElement) || !root.contains(element)) continue;
      const dateElement = element.closest<HTMLElement>("[data-date]");
      if (!dateElement || !root.contains(dateElement)) continue;
      const date = localDateKeyToDate(dateElement.getAttribute("data-date"));
      if (date) return date;
    }

    const apiDate = calendarRef.current?.getApi().getDate();
    return apiDate
      ? new Date(apiDate.getFullYear(), apiDate.getMonth(), apiDate.getDate())
      : null;
  }, []);

  const getTodoDropStartMs = useCallback(
    (clientX: number, clientY: number, durationMs: number): number | null => {
      const date = getTodoDropDate(clientX, clientY);
      if (!date) return null;

      const slotMinMinutes =
        fullCalendarTimeToMinutes(todoDayTimeRange.slotMinTime) ?? 9 * 60;
      const slotMaxMinutes =
        fullCalendarTimeToMinutes(todoDayTimeRange.slotMaxTime) ?? 18 * 60;
      const durationMinutes = Math.max(15, Math.round(durationMs / 60000));
      let startMinutes = 9 * 60;

      const slots = (calendarSurfaceRef.current ?? rootRef.current)?.querySelector<HTMLElement>(
        ".fc-timegrid-slots",
      );
      if (isTodoTimeGridView(calendarViewType) && slots) {
        const rect = slots.getBoundingClientRect();
        const totalMinutes = Math.max(15, slotMaxMinutes - slotMinMinutes);
        const y = clampNumber(clientY - rect.top, 0, rect.height);
        const rawOffset = rect.height > 0 ? (y / rect.height) * totalMinutes : 0;
        const snappedOffset = Math.round(rawOffset / 15) * 15;
        const maxOffset = Math.max(0, totalMinutes - Math.min(durationMinutes, totalMinutes));
        startMinutes = slotMinMinutes + clampNumber(snappedOffset, 0, maxOffset);
      }

      date.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
      return date.getTime();
    },
    [calendarViewType, getTodoDropDate, todoDayTimeRange.slotMaxTime, todoDayTimeRange.slotMinTime],
  );

  const applyTodoCalendarDrop = useCallback(
    (itemId: string, clientX: number, clientY: number) => {
      const item = useTodoStore
        .getState()
        .items.find((entry) => entry.id === itemId && entry.deletedAt == null);
      if (!item) return false;

      const durationMs = itemCalendarDurationMs(item);
      const startMs = getTodoDropStartMs(clientX, clientY, durationMs);
      if (startMs == null) return false;

      setDueRange(item.id, startMs, startMs + durationMs, item.reminderEnabled);
      if (item.status === "abandoned") {
        setStatus(item.id, "pending");
      }
      setSelectedItemId(item.id);
      return true;
    },
    [getTodoDropStartMs, setDueRange, setSelectedItemId, setStatus],
  );

  useEffect(() => {
    return registerTodoCalendarDropTarget({
      containsPoint: (clientX, clientY) => {
        const root = calendarSurfaceRef.current;
        if (!root) return false;
        const rect = root.getBoundingClientRect();
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      },
      drop: (itemId, clientX, clientY) => applyTodoCalendarDrop(itemId, clientX, clientY),
      onDragOverChange: setIsTodoDragOver,
    });
  }, [applyTodoCalendarDrop]);

  const borderColor = alpha(isDark ? "#f8fafc" : "#0f172a", 0.1);
  const subtleBg = alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.04 : 0.035);
  const hoverBg = alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.06);
  const rootClassName = [
    "todo-calendar-root",
    isYearView ? "is-year-view" : "",
    compact ? "is-compact" : "",
    inboxPaneCollapsed ? "is-inbox-collapsed" : "",
    inboxPaneAnimationReady ? "is-inbox-animation-ready" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Box
      className={rootClassName}
      ref={rootRef}
      sx={{
        height: "100%",
        minHeight: 0,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        p: compact ? 0 : 1,
        "--fc-border-color": borderColor,
        "--fc-page-bg-color": "transparent",
        "--fc-neutral-bg-color": subtleBg,
        "--fc-today-bg-color": alpha(theme.palette.primary.main, isDark ? 0.16 : 0.1),
        "--fc-now-indicator-color": theme.palette.error.main,
        "--fc-list-event-hover-bg-color": hoverBg,
        "--separator-border": inboxPaneCollapsed ? "transparent" : borderColor,
        "& .fc": {
          height: "100%",
          color: "text.primary",
          fontFamily: theme.typography.fontFamily,
          fontSize: 13,
        },
        "&.is-year-view .fc": {
          height: "auto !important",
          minHeight: "0 !important",
        },
        "& .fc .fc-toolbar.fc-header-toolbar": {
          minHeight: compact ? 38 : 44,
          mb: 0,
          px: compact ? 0.6 : 1,
          pb: compact ? 0.6 : 1,
          gap: 1,
          borderBottom: 1,
          borderColor,
        },
        "& .fc .fc-toolbar-title": {
          fontSize: compact ? 14 : 17,
          fontWeight: 700,
        },
        "& .fc .fc-button": {
          height: compact ? 26 : 30,
          px: compact ? 0.8 : 1.1,
          py: 0,
          borderRadius: "4px",
          borderColor,
          bgcolor: "transparent",
          color: "text.secondary",
          boxShadow: "none",
          textTransform: "none",
          fontSize: compact ? 12 : 13,
          fontWeight: 600,
        },
        "& .fc .fc-button:hover": {
          borderColor,
          bgcolor: hoverBg,
          color: "text.primary",
        },
        "& .fc .fc-button-primary:not(:disabled).fc-button-active, & .fc .fc-button-primary:not(:disabled):active": {
          borderColor: alpha(theme.palette.primary.main, 0.45),
          bgcolor: alpha(theme.palette.primary.main, isDark ? 0.22 : 0.12),
          color: "primary.main",
        },
        "&.is-year-view .fc .fc-yearView-button": {
          borderColor: alpha(theme.palette.primary.main, 0.45),
          bgcolor: alpha(theme.palette.primary.main, isDark ? 0.22 : 0.12),
          color: "primary.main",
        },
        "& .fc .fc-yearTitle-button, & .fc .fc-yearTitle-button:hover, & .fc .fc-yearTitle-button:active": {
          borderColor: "transparent",
          bgcolor: "transparent",
          color: "text.primary",
          boxShadow: "none",
          fontSize: 17,
          fontWeight: 700,
          pointerEvents: "none",
        },
        "& .fc .fc-button-primary:disabled": {
          borderColor,
          bgcolor: subtleBg,
          color: "text.disabled",
          opacity: 1,
        },
        "& .fc .fc-inboxToggle-button": {
          width: compact ? 26 : 30,
          minWidth: compact ? 26 : 30,
          px: "0 !important",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 0,
        },
        "& .fc .fc-inboxToggle-button::before": {
          content: '""',
          width: compact ? 16 : 18,
          height: compact ? 16 : 18,
          bgcolor: "currentColor",
          WebkitMask: `${CALENDAR_INBOX_COLLAPSE_ICON} center / contain no-repeat`,
          mask: `${CALENDAR_INBOX_COLLAPSE_ICON} center / contain no-repeat`,
        },
        "&.is-inbox-collapsed .fc .fc-inboxToggle-button::before": {
          WebkitMask: `${CALENDAR_INBOX_EXPAND_ICON} center / contain no-repeat`,
          mask: `${CALENDAR_INBOX_EXPAND_ICON} center / contain no-repeat`,
        },
        "&.is-inbox-animation-ready .split-view-view": {
          transition: `left ${CALENDAR_INBOX_ANIMATION_MS}ms ease, width ${CALENDAR_INBOX_ANIMATION_MS}ms ease`,
        },
        "&.is-inbox-collapsed .calendar-inbox-pane": {
          left: "0 !important",
          width: "0 !important",
          minWidth: "0 !important",
          pointerEvents: "none",
        },
        "&.is-inbox-collapsed:not(.is-inbox-animation-ready) .calendar-inbox-pane": {
          visibility: "hidden",
        },
        "&.is-inbox-collapsed .calendar-main-pane": {
          left: "0 !important",
          width: "100% !important",
        },
        "& .split-view-sash-dragging .split-view-view": {
          transition: "none",
        },
        "&.is-inbox-animation-ready .sash-container .sash": {
          transition: `left ${CALENDAR_INBOX_ANIMATION_MS}ms ease, opacity ${CALENDAR_INBOX_ANIMATION_MS}ms ease`,
        },
        "&.is-inbox-collapsed .sash-container": {
          opacity: 0,
          pointerEvents: "none",
        },
        "&.is-inbox-collapsed .sash-container .sash": {
          opacity: 0,
          pointerEvents: "none",
        },
        "& .split-view-sash-dragging .sash-container .sash": {
          transition: "none",
        },
        "& .fc .fc-scrollgrid": {
          borderLeftWidth: 0,
          borderTopWidth: 0,
        },
        "&.is-year-view .fc .fc-view-harness, &.is-year-view .fc .fc-view-harness-active, &.is-year-view .fc .fc-view, &.is-year-view .fc .fc-scrollgrid": {
          display: "none !important",
          height: "0 !important",
          minHeight: "0 !important",
          overflow: "hidden !important",
        },
        "& .fc .fc-col-header-cell": {
          bgcolor: subtleBg,
        },
        "& .fc .fc-col-header-cell-cushion, & .fc .fc-daygrid-day-number": {
          color: "text.secondary",
          textDecoration: "none",
        },
        "& .fc .fc-daygrid-day.fc-day-today .fc-daygrid-day-number": {
          color: "primary.main",
          fontWeight: 800,
        },
        "& .fc .fc-listFilter-button, & .fc .fc-importCalendar-button, & .fc .fc-viewPicker-button": {
          borderColor: alpha(theme.palette.primary.main, 0.35),
          color: "primary.main",
        },
        "& .fc .fc-timegrid-slot-label, & .fc .fc-list-day-text, & .fc .fc-list-day-side-text": {
          color: "text.secondary",
        },
        "& .fc .fc-timegrid-slot-label": {
          width: timeZoneSlotAxisWidth,
          minWidth: timeZoneSlotAxisWidth,
        },
        "& .fc .fc-timegrid-axis": {
          width: timeZoneSlotAxisWidth,
          minWidth: timeZoneSlotAxisWidth,
        },
        "& .fc .fc-timegrid-slot-label .fc-timegrid-axis-inner": {
          width: timeZoneSlotAxisWidth,
          minWidth: timeZoneSlotAxisWidth,
          maxWidth: timeZoneSlotAxisWidth,
          boxSizing: "border-box",
          overflow: visibleTodoTimeZones.length > 0 ? "visible" : undefined,
          alignItems: visibleTodoTimeZones.length > 0 ? "stretch" : undefined,
          px: visibleTodoTimeZones.length > 0 ? 0.6 : undefined,
        },
        "& .todo-calendar-slot-zone-labels": {
          display: "grid",
          alignItems: "center",
          justifyContent: "stretch",
          columnGap: `${timeZoneSlotGapWidth}px`,
          whiteSpace: "nowrap",
          boxSizing: "border-box",
        },
        "& .todo-calendar-slot-zone": {
          display: "inline-grid",
          gridTemplateRows: "auto auto",
          justifyItems: "end",
          alignItems: "center",
          minWidth: 0,
          maxWidth: "100%",
          overflow: "visible",
          lineHeight: 1,
        },
        "& .todo-calendar-slot-zone-name": {
          maxWidth: "100%",
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          color: "text.disabled",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        "& .todo-calendar-slot-zone-time-row": {
          mt: 0.1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 0.25,
          minWidth: 0,
        },
        "& .todo-calendar-slot-zone-time": {
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1,
          color: "text.secondary",
          maxWidth: "100%",
          overflow: "visible",
          textOverflow: "clip",
        },
        "& .todo-calendar-slot-zone-time.is-prev-day": {
          color: theme.palette.warning.main,
        },
        "& .todo-calendar-slot-zone-time.is-next-day": {
          color: isDark ? theme.palette.success.light : theme.palette.success.main,
        },
        "& .todo-calendar-slot-zone.is-local": {
          transform: "translateX(-5px)",
        },
        "& .todo-calendar-slot-zone.is-local .todo-calendar-slot-zone-time": {
          color: "text.primary",
          fontSize: 12,
          minWidth: `${timeZoneSlotLocalColumnWidth - 8}px`,
          textAlign: "right",
        },
        "& .fc .fc-list, & .fc .fc-list-table": {
          bgcolor: "transparent",
        },
        "& .fc .fc-list-day-cushion": {
          bgcolor: subtleBg,
        },
        "& .todo-calendar-event": {
          borderRadius: "4px",
          borderWidth: 1,
          cursor: "pointer",
          boxShadow: "none",
        },
        "& .todo-calendar-event .fc-event-main": {
          color: "inherit",
        },
        "& .todo-calendar-event-content": {
          minWidth: 0,
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 0.4,
          py: 0.15,
        },
        "& .todo-calendar-event-title": {
          minWidth: 0,
          flex: 1,
          fontSize: 12,
          lineHeight: 1.35,
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
        "& .todo-calendar-event-time": {
          flexShrink: 0,
          fontSize: 11,
          lineHeight: 1.35,
          fontWeight: 700,
          opacity: 0.82,
        },
        "& .todo-calendar-todo-event-content .todo-calendar-event-title": {
          flexBasis: 0,
        },
        "& .fc .fc-list-event.todo-calendar-event.is-todo .fc-list-event-time": {
          display: "none",
        },
        "& .todo-calendar-event.is-selected": {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 1,
        },
        "& .todo-calendar-event.is-completed": {
          opacity: 0.72,
        },
        "& .todo-calendar-event.is-completed .todo-calendar-event-title": {
          textDecoration: "line-through",
        },
        "& .todo-calendar-event.is-imported": {
          cursor: "default",
        },
        "& .fc .fc-daygrid-day-top": {
          minHeight: 28,
        },
        "& .fc .fc-daygrid-day-number": {
          width: "100%",
          maxWidth: "100%",
          p: "2px 4px 0",
        },
        "& .fc .fc-daygrid-day.todo-calendar-rest-day": {
          bgcolor: alpha(theme.palette.primary.main, isDark ? 0.045 : 0.028),
        },
        "& .fc .fc-daygrid-day.todo-calendar-holiday-day": {
          bgcolor: alpha(theme.palette.error.main, isDark ? 0.1 : 0.055),
        },
        "& .fc .fc-daygrid-day.todo-calendar-workday": {
          bgcolor: alpha(theme.palette.warning.main, isDark ? 0.1 : 0.055),
        },
        "& .fc .fc-daygrid-day.todo-calendar-solar-term-day .todo-calendar-day-cell-content": {
          borderLeft: `2px solid ${alpha(theme.palette.success.main, isDark ? 0.55 : 0.4)}`,
        },
        "& .fc .fc-daygrid-day.todo-calendar-week-number-cell .fc-daygrid-day-frame": {
          position: "relative",
        },
        "& .fc .fc-daygrid-row > .fc-daygrid-week-number": {
          position: "absolute",
          boxSizing: "border-box",
          display: "block",
          top: 3,
          left: 2,
          width: 38,
          minWidth: 38,
          maxWidth: 38,
          height: 20,
          p: 0,
          bgcolor: "transparent",
          color: "text.secondary",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: "20px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textAlign: "center",
          textDecoration: "none",
          zIndex: 6,
        },
        "& .fc .fc-daygrid-day.todo-calendar-week-number-cell .fc-daygrid-day-frame::before": {
          content: '""',
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: 42,
          bgcolor: alpha(theme.palette.text.primary, isDark ? 0.045 : 0.035),
          borderRight: `1px solid ${borderColor}`,
          pointerEvents: "none",
          zIndex: 1,
        },
        "& .fc .fc-daygrid-day.todo-calendar-week-number-cell .fc-daygrid-day-header, & .fc .fc-daygrid-day.todo-calendar-week-number-cell .fc-daygrid-day-top": {
          minWidth: 0,
        },
        "& .fc .fc-daygrid-day.todo-calendar-week-number-cell .fc-daygrid-day-top": {
          paddingLeft: 0,
        },
        "& .fc .fc-daygrid-day.todo-calendar-week-number-cell .fc-daygrid-day-number": {
          boxSizing: "border-box",
          flex: "1 1 auto",
          minWidth: 0,
          paddingLeft: "46px !important",
        },
        "& .fc .fc-daygrid-day.todo-calendar-week-number-cell .fc-daygrid-day-events": {
          marginLeft: "42px",
        },
        "& .fc .fc-daygrid-body-balanced .fc-daygrid-day.todo-calendar-week-number-cell .fc-daygrid-day-events": {
          left: "42px",
        },
        "& .fc .fc-daygrid-day.todo-calendar-week-number-cell .todo-calendar-day-cell-content": {
          paddingLeft: "2px",
          paddingRight: "2px",
        },
        "& .todo-calendar-lunar-text": {
          mt: 0.1,
          fontSize: 10,
          lineHeight: 1.1,
          color: "text.secondary",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        "& .fc .fc-daygrid-more-link": {
          color: "primary.main",
          fontWeight: 600,
        },
        "& .fc .fc-popover": {
          bgcolor: theme.palette.background.paper,
          borderColor,
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(72vh, 460px)",
          boxShadow: theme.shadows[8],
          color: "text.primary",
          overflow: "hidden",
        },
        "& .fc .fc-more-popover": {
          top: "50% !important",
          left: "50% !important",
          right: "auto !important",
          bottom: "auto !important",
          transform: "translate(-50%, -50%)",
          width: "min(360px, calc(100vw - 48px))",
          maxWidth: "calc(100% - 32px)",
          zIndex: 20,
        },
        "& .fc .fc-popover-header": {
          bgcolor: subtleBg,
          color: "text.primary",
          borderBottom: 1,
          borderColor,
          flexShrink: 0,
          position: "sticky",
          top: 0,
          zIndex: 1,
        },
        "& .fc .fc-popover-body": {
          bgcolor: theme.palette.background.paper,
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
        },
      }}
    >
      {isYearView && (
        <Fab
          color="primary"
          size="medium"
          aria-label="新建待办"
          onClick={() => openCreateForDate(calendarDate)}
          sx={{
            position: "absolute",
            right: 24,
            bottom: 24,
            zIndex: 5,
            boxShadow: theme.shadows[6],
          }}
        >
          <AddRoundedIcon />
        </Fab>
      )}
      <Box
        sx={{
          flex: "1 1 auto",
          height: "100%",
          minHeight: 0,
        }}
      >
        <Allotment
          key={showInboxPane ? "calendar-with-inbox" : "calendar-only"}
          defaultSizes={showInboxPane ? calendarInboxDefaultSizes : undefined}
          onChange={onCalendarSplitChange}
          onDragEnd={showInboxPane ? onCalendarSplitDragEnd : undefined}
          separator={inboxPaneVisible}
        >
          {showInboxPane && (
            <Allotment.Pane
              className="calendar-inbox-pane"
              minSize={260}
              preferredSize={calendarInboxPreferredSize}
              visible={inboxPaneVisible}
            >
              <Box
                sx={{
                  width: "100%",
                  height: "100%",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  borderRight: inboxPaneVisible ? 1 : 0,
                  borderColor,
                  bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.035 : 0.025),
                  opacity: inboxPaneVisible ? 1 : 0,
                  transform: inboxPaneVisible ? "translateX(0)" : "translateX(-10px)",
                  transition: inboxPaneAnimationReady
                    ? `opacity ${CALENDAR_INBOX_ANIMATION_MS}ms ease, transform ${CALENDAR_INBOX_ANIMATION_MS}ms ease`
                    : "none",
                  pointerEvents: inboxPaneVisible ? "auto" : "none",
                }}
              >
                <Box
                  sx={{
                    height: 44,
                    px: 1.2,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.8,
                    borderBottom: 1,
                    borderColor,
                    flexShrink: 0,
                  }}
                >
                  <TodoEmoji emoji={inboxList?.emoji} fallback="📥" size={17} />
                  <Typography sx={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>
                    收集箱
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                    {inboxItems.length}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", py: 0.5 }}>
                  {inboxItems.length === 0 ? (
                    <Box
                      sx={{
                        height: "100%",
                        minHeight: 140,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        px: 2,
                        color: "text.disabled",
                      }}
                    >
                      <Typography sx={{ fontSize: 13 }}>收集箱暂无待办</Typography>
                    </Box>
                  ) : (
                    inboxItems.map((item) => (
                      <TodoItem
                        key={item.id}
                        item={item}
                        isDark={isDark}
                        draggable={false}
                        compactMeta
                      />
                    ))
                  )}
                </Box>
              </Box>
            </Allotment.Pane>
          )}
          <Allotment.Pane className="calendar-main-pane" minSize={showInboxToggle ? 420 : 0}>
            <Box
              ref={calendarSurfaceRef}
              sx={{
                position: "relative",
                width: "100%",
                minWidth: 0,
                height: "100%",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                outline: isTodoDragOver
                  ? `2px solid ${alpha(theme.palette.primary.main, 0.55)}`
                  : "2px solid transparent",
                outlineOffset: -2,
                transition: "outline-color 120ms ease",
                "& > .fc": {
                  flex: isYearView ? "0 0 auto" : "1 1 auto",
                  minHeight: 0,
                  height: isYearView ? "auto !important" : "100%",
                },
                "& .fc-view-harness": {
                  display: isYearView ? "none !important" : undefined,
                  height: isYearView ? "0 !important" : undefined,
                  minHeight: isYearView ? "0 !important" : undefined,
                  overflow: isYearView ? "hidden !important" : undefined,
                },
              }}
            >
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, iCalendarPlugin]}
            locale={zhCnLocale}
            timeZone="local"
            initialView={initialView}
            firstDay={todoFirstDay}
            weekNumbers={todoShowWeekNumbers}
            weekText="周"
            height={isYearView ? "auto" : "100%"}
            expandRows
            nowIndicator
            navLinks
            selectable
            selectMirror
            editable
            eventDurationEditable
            dayMaxEvents
            slotEventOverlap={false}
            eventMaxStack={compact ? 2 : 4}
            allDaySlot={false}
            businessHours={todoDayTimeRange.businessHours}
            slotMinTime={todoDayTimeRange.slotMinTime}
            slotMaxTime={todoDayTimeRange.slotMaxTime}
            slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            slotLabelContent={renderSlotLabel}
            eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            customButtons={{
              inboxToggle: {
                text: "",
                hint: inboxPaneCollapsed ? "展开收集箱" : "隐藏收集箱",
                click: toggleInboxPaneCollapsed,
              },
              calendarToday: {
                text: "今天",
                click: goCalendarToday,
              },
              calendarPrev: {
                icon: "chevron-left",
                click: () => goCalendarByStep(-1),
              },
              calendarNext: {
                icon: "chevron-right",
                click: () => goCalendarByStep(1),
              },
              yearToday: {
                text: "今天",
                click: goTodayInYearView,
              },
              yearPrev: {
                icon: "chevron-left",
                click: () => goYear(-1),
              },
              yearNext: {
                icon: "chevron-right",
                click: () => goYear(1),
              },
              yearTitle: {
                text: `${calendarDate.getFullYear()}年`,
                click: () => {},
              },
              listFilter: {
                text: listFilterButtonText,
                click: (_event, element) => setListFilterMenuAnchor(element),
              },
              importCalendar: {
                text: "导入",
                click: (_event, element) => setSubscriptionMenuAnchor(element),
              },
              viewPicker: {
                text: viewPickerLabel,
                click: (_event, element) => setViewMenuAnchor(element),
              },
              yearView: {
                text: "年",
                click: () => changeCalendarView("todoYear"),
              },
            }}
            headerToolbar={{
              left: showInboxToggle
                ? "inboxToggle calendarToday calendarPrev,calendarNext"
                : "calendarToday calendarPrev,calendarNext",
              center: isYearView ? "yearTitle" : "title",
              right: compact
                ? ""
                : "listFilter importCalendar viewPicker timeGridDay,dayGridWeek,dayGridMonth,yearView,customAgenda",
            }}
            buttonText={{
              today: "今天",
              day: "日",
              week: "周",
              month: "月",
              list: "议程",
            }}
            views={{
              customDays: {
                type: "timeGrid",
                duration: { days: customDayCount },
                buttonText: `${customDayCount}日`,
              },
              customWeeks: {
                type: "dayGrid",
                duration: { weeks: customWeekCount },
                buttonText: `${customWeekCount}周`,
              },
              customMonths: {
                type: "dayGrid",
                duration: { months: customMonthCount },
                buttonText: `${customMonthCount}月`,
              },
              todoYear: {
                type: "dayGrid",
                duration: { days: 1 },
                buttonText: "年",
              },
              customAgenda: {
                type: "list",
                duration: { days: agendaDayCount },
                buttonText: "议程",
                noEventsContent: "没有带日期的待办",
              },
            }}
            datesSet={(arg) => {
              setCalendarDate(calendarRef.current?.getApi().getDate() ?? arg.start);
              setCalendarViewType((current) => {
                if (current === "todoYear" && keepYearViewOnNextDatesSetRef.current) {
                  keepYearViewOnNextDatesSetRef.current = false;
                  return current;
                }
                keepYearViewOnNextDatesSetRef.current = false;
                return arg.view.type;
              });
            }}
            eventSources={calendarEventSources}
            dateClick={openCreateDialog}
            select={openSelectDialog}
            eventClick={onEventClick}
            eventDrop={onEventDrop}
            eventResize={onEventResize}
            eventContent={renderCalendarEvent}
            eventDidMount={(arg) => {
              if (!isTodoCalendarStatus(arg.event.extendedProps.status)) return;
              arg.el.removeAttribute("title");
              arg.el.removeAttribute("aria-describedby");
              arg.el.querySelectorAll("[title], [aria-describedby]").forEach((node) => {
                node.removeAttribute("title");
                node.removeAttribute("aria-describedby");
              });
            }}
            dayCellContent={renderCalendarDayCell}
            dayCellClassNames={(arg) => {
              const classNames: string[] = [];
              const isDayGridView = isTodoDayGridView(arg.view.type);
              const isMonthView = isMonthDayGridView(arg.view.type);
              if (isDayGridView && todoShowWeekNumbers && arg.date.getDay() === todoFirstDay) {
                classNames.push("todo-calendar-week-number-cell");
              }
              if (!isMonthView || !todoShowChineseCalendar) return classNames;
              const meta = getChineseCalendarMeta(arg.date);
              if (meta.holidayName) {
                classNames.push("todo-calendar-holiday-day");
              } else if (meta.isAdjustedWorkday) {
                classNames.push("todo-calendar-workday");
              } else if (meta.isRestDay) {
                classNames.push("todo-calendar-rest-day");
              }
              if (meta.solarTerm) {
                classNames.push("todo-calendar-solar-term-day");
              }
              return classNames;
            }}
            eventClassNames={(arg) => {
              const classNames = ["todo-calendar-event"];
              const sourceId = arg.event.source?.id ?? "";
              if (
                calendarSubscriptionIds.has(sourceId) ||
                !isTodoCalendarStatus(arg.event.extendedProps.status)
              ) {
                classNames.push("is-imported");
                return classNames;
              }
              classNames.push("is-todo");
              if (arg.event.id === selectedItemId) {
                classNames.push("is-selected");
              }
              if (arg.event.extendedProps.status === "completed") {
                classNames.push("is-completed");
              }
              return classNames;
            }}
          />
              {isYearView && renderYearView()}
            </Box>
          </Allotment.Pane>
        </Allotment>
      </Box>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ics,text/calendar"
        hidden
        onChange={onLocalIcsFileChange}
      />
      <Menu
        open={Boolean(listFilterMenuAnchor)}
        anchorEl={listFilterMenuAnchor}
        onClose={closeListFilterMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              width: 300,
              maxWidth: "calc(100vw - 40px)",
            },
          },
        }}
      >
        <MenuItem disabled={activeLists.length === 0}>
          <ListItemText
            primary="清单筛选"
            secondary={
              activeLists.length === 0
                ? "暂无可显示清单"
                : `${selectedCalendarListCount}/${activeLists.length} 个清单 · ${
                    calendarShowCompleted ? "显示已完成" : "仅未完成"
                  }`
            }
          />
        </MenuItem>
        <Divider />
        <MenuItem disabled={activeLists.length === 0} onClick={toggleAllCalendarListsVisible}>
          <Checkbox
            size="small"
            checked={allCalendarListsVisible}
            indeterminate={partiallyFilteredCalendarLists}
            tabIndex={-1}
            disableRipple
            sx={{ p: 0.5, mr: 1 }}
          />
          <ListItemText primary="全部清单" />
        </MenuItem>
        <MenuItem onClick={() => setCalendarShowCompleted((value) => !value)}>
          <Checkbox
            size="small"
            checked={calendarShowCompleted}
            tabIndex={-1}
            disableRipple
            sx={{ p: 0.5, mr: 1 }}
          />
          <ListItemText primary="显示已完成" />
        </MenuItem>
        <Divider />
        {activeLists.length === 0 && <MenuItem disabled>暂无清单</MenuItem>}
        {calendarRootLists.map((list) => (
          <MenuItem key={list.id} onClick={() => toggleCalendarListVisible(list.id)}>
            <Checkbox
              size="small"
              checked={calendarVisibleListIds.has(list.id)}
              tabIndex={-1}
              disableRipple
              sx={{ p: 0.5, mr: 1 }}
            />
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.8, minWidth: 0 }}>
              <TodoEmoji emoji={list.emoji} fallback="📋" size={16} />
              <Typography noWrap sx={{ fontSize: 13 }}>
                {list.name}
              </Typography>
            </Box>
          </MenuItem>
        ))}
        {calendarFolderSections.map((section) => {
          const visibleCount = section.lists.reduce(
            (count, list) => count + (calendarVisibleListIds.has(list.id) ? 1 : 0),
            0,
          );
          const allFolderListsVisible =
            section.lists.length > 0 && visibleCount === section.lists.length;
          const partiallyVisible = visibleCount > 0 && visibleCount < section.lists.length;
          return (
            <MenuItem
              key={section.id}
              selected={listFilterFolderAnchor?.folderId === section.id}
              onMouseEnter={(event) => openListFilterFolder(event.currentTarget, section.id)}
              onMouseLeave={scheduleListFilterFolderClose}
              onClick={(event) => {
                openListFilterFolder(event.currentTarget, section.id);
                toggleCalendarListGroupVisible(section.lists.map((list) => list.id));
              }}
              sx={{ minHeight: 36 }}
            >
              <Checkbox
                size="small"
                checked={allFolderListsVisible}
                indeterminate={partiallyVisible}
                tabIndex={-1}
                disableRipple
                sx={{ p: 0.5, mr: 1 }}
              />
              <Box
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.8,
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <TodoEmoji emoji={section.emoji} fallback="📁" size={16} />
                <Typography noWrap sx={{ fontSize: 13 }}>
                  {section.label}
                </Typography>
              </Box>
              <ChevronRightRoundedIcon sx={{ ml: 1, fontSize: 18, opacity: 0.55 }} />
            </MenuItem>
          );
        })}
      </Menu>
      {listFilterMenuAnchor && listFilterFolderAnchor && activeCalendarFilterFolderSection && (
        <Menu
          open
          hideBackdrop
          disableAutoFocus
          disableAutoFocusItem
          disableEnforceFocus
          disableRestoreFocus
          anchorEl={listFilterFolderAnchor.el}
          onClose={() => {
            clearListFilterFolderCloseTimer();
            setListFilterFolderAnchor(null);
          }}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          slotProps={{
            root: {
              sx: { pointerEvents: "none" },
            },
            paper: {
              sx: {
                width: 220,
                maxHeight: 340,
                pointerEvents: "auto",
              },
              onMouseEnter: clearListFilterFolderCloseTimer,
              onMouseLeave: scheduleListFilterFolderClose,
            },
            list: {
              onMouseEnter: clearListFilterFolderCloseTimer,
              onMouseLeave: scheduleListFilterFolderClose,
            },
          }}
        >
          {activeCalendarFilterFolderSection.lists.map((list) => (
            <MenuItem
              key={list.id}
              selected={calendarVisibleListIds.has(list.id)}
              onClick={() => toggleCalendarListVisible(list.id)}
              sx={{ minHeight: 34 }}
            >
              <Checkbox
                size="small"
                checked={calendarVisibleListIds.has(list.id)}
                tabIndex={-1}
                disableRipple
                sx={{ p: 0.5, mr: 1 }}
              />
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.8, minWidth: 0 }}>
                <TodoEmoji emoji={list.emoji} fallback="📋" size={16} />
                <Typography noWrap sx={{ fontSize: 13 }}>
                  {list.name}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Menu>
      )}
      <Menu
        open={Boolean(subscriptionMenuAnchor)}
        anchorEl={subscriptionMenuAnchor}
        onClose={() => setSubscriptionMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              width: 300,
              maxWidth: "calc(100vw - 40px)",
            },
          },
        }}
      >
        <MenuItem onClick={openUrlImportDialog}>
          <ListItemText primary="导入 URL 订阅" secondary="支持 http(s) / webcal 地址" />
        </MenuItem>
        <MenuItem onClick={openLocalIcsPicker}>
          <ListItemText primary="导入本地 .ics" secondary="读取本地日历文件" />
        </MenuItem>
        {subscriptionError && (
          <MenuItem disabled>
            <Typography sx={{ fontSize: 12, color: "error.main", whiteSpace: "normal" }}>
              {subscriptionError}
            </Typography>
          </MenuItem>
        )}
        <Divider />
        {calendarSubscriptions.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary="暂无导入订阅" />
          </MenuItem>
        ) : (
          calendarSubscriptions.map((subscription) => (
            <MenuItem key={subscription.id} onClick={() => toggleCalendarSubscription(subscription.id)}>
              <Checkbox
                size="small"
                checked={subscription.enabled}
                tabIndex={-1}
                disableRipple
                sx={{ p: 0.5, mr: 1 }}
              />
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: subscription.color,
                  flexShrink: 0,
                  mr: 1,
                }}
              />
              <ListItemText
                primary={subscription.name}
                secondary={subscription.type === "url" ? subscription.url : subscription.fileName}
                slotProps={{
                  primary: {
                    noWrap: true,
                    sx: { fontSize: 13, fontWeight: 600 },
                  },
                  secondary: {
                    noWrap: true,
                    sx: { fontSize: 11 },
                  },
                }}
              />
              <IconButton
                size="small"
                aria-label="删除订阅"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  deleteCalendarSubscription(subscription.id);
                }}
                sx={{
                  ml: 1,
                  width: 28,
                  height: 28,
                  color: "text.secondary",
                  "&:hover": {
                    color: "error.main",
                  },
                }}
              >
                <DeleteOutlineRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </MenuItem>
          ))
        )}
      </Menu>
      <Dialog
        open={urlImportOpen}
        onClose={closeUrlImportDialog}
        fullWidth
        maxWidth="xs"
        slotProps={{
          paper: {
            sx: {
              borderRadius: 1,
            },
          },
        }}
      >
        <DialogTitle sx={{ px: 3, pt: 2.2, pb: 1.2 }}>导入 URL 订阅</DialogTitle>
        <DialogContent sx={{ px: 3, pt: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <TextField
            autoFocus
            label="订阅地址"
            value={urlImportValue}
            onChange={(event) => {
              setUrlImportValue(event.target.value);
              setSubscriptionError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitUrlSubscription();
              }
            }}
            error={Boolean(subscriptionError)}
            helperText={subscriptionError ?? "支持 .ics URL，也会将 webcal:// 转换为 https://"}
            size="small"
            fullWidth
          />
          <TextField
            label="名称"
            value={urlImportName}
            onChange={(event) => setUrlImportName(event.target.value)}
            size="small"
            fullWidth
            placeholder="留空时使用订阅地址生成"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeUrlImportDialog} disabled={urlImportLoading}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitUrlSubscription()}
            disabled={urlImportLoading}
          >
            {urlImportLoading ? "导入中..." : "导入"}
          </Button>
        </DialogActions>
      </Dialog>
      <Menu
        open={Boolean(viewMenuAnchor)}
        anchorEl={viewMenuAnchor}
        onClose={() => setViewMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          selected={calendarViewType === "timeGridDay"}
          onClick={() => changeCalendarView("timeGridDay")}
        >
          日
        </MenuItem>
        <MenuItem
          selected={calendarViewType === "dayGridWeek"}
          onClick={() => changeCalendarView("dayGridWeek")}
        >
          周
        </MenuItem>
        <MenuItem
          selected={calendarViewType === "dayGridMonth"}
          onClick={() => changeCalendarView("dayGridMonth")}
        >
          月
        </MenuItem>
        <MenuItem
          selected={calendarViewType === "todoYear"}
          onClick={() => changeCalendarView("todoYear")}
        >
          年
        </MenuItem>
        <MenuItem
          selected={calendarViewType === "customAgenda"}
          onClick={() => changeCalendarView("customAgenda")}
        >
          日程
        </MenuItem>
        <Divider />
        {renderCustomDurationItem({
          label: "多日",
          valueLabel: `${customDayCount}日`,
          selected: calendarViewType === "customDays",
          minDisabled: customDayCount <= CUSTOM_DAY_MIN,
          maxDisabled: customDayCount >= CUSTOM_DAY_MAX,
          kind: "days",
          viewType: "customDays",
        })}
        {renderCustomDurationItem({
          label: "多周",
          valueLabel: `${customWeekCount}周`,
          selected: calendarViewType === "customWeeks",
          minDisabled: customWeekCount <= CUSTOM_WEEK_MIN,
          maxDisabled: customWeekCount >= CUSTOM_WEEK_MAX,
          kind: "weeks",
          viewType: "customWeeks",
        })}
        {renderCustomDurationItem({
          label: "多月",
          valueLabel: `${customMonthCount}月`,
          selected: calendarViewType === "customMonths",
          minDisabled: customMonthCount <= CUSTOM_MONTH_MIN,
          maxDisabled: customMonthCount >= CUSTOM_MONTH_MAX,
          kind: "months",
          viewType: "customMonths",
        })}
        {renderCustomDurationItem({
          label: "日程",
          valueLabel: `${agendaDayCount}天`,
          selected: calendarViewType === "customAgenda",
          minDisabled: agendaDayCount <= CUSTOM_AGENDA_MIN,
          maxDisabled: agendaDayCount >= CUSTOM_AGENDA_MAX,
          kind: "agenda",
          viewType: "customAgenda",
        })}
      </Menu>
      <Dialog
        open={draft != null}
        onClose={closeCalendarDialog}
        fullWidth
        maxWidth="sm"
        slotProps={{
          paper: {
            sx: {
              width: 520,
              maxWidth: "calc(100vw - 40px)",
              borderRadius: 1,
            },
          },
        }}
      >
        <DialogTitle sx={{ px: 3, pt: 2.2, pb: 1.2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.2 }}>
            <CalendarTodayRoundedIcon sx={{ fontSize: 16, color: "primary.main" }} />
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13, color: "text.secondary" }}>
              {draft ? formatDateRange(draft.dueAt, draft.dueEndAt) : ""}
            </Typography>
            {draft && (
              <Tooltip title={draft.status === "completed" ? "设为未完成" : "设为已完成"}>
                <IconButton
                  size="small"
                  onClick={() =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            status:
                              current.status === "completed" ? "pending" : "completed",
                          }
                        : current,
                    )
                  }
                  sx={{ width: 30, height: 30 }}
                >
                  {draft.status === "completed" ? (
                    <CheckCircleRoundedIcon sx={{ fontSize: 18, color: "success.main" }} />
                  ) : (
                    <RadioButtonUncheckedRoundedIcon
                      sx={{ fontSize: 18, color: "text.secondary" }}
                    />
                  )}
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            autoFocus
            placeholder="准备做什么？"
            value={draft?.content ?? ""}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, content: event.target.value } : current,
              )
            }
            onKeyDown={onDraftKeyDown}
            fullWidth
            variant="standard"
            slotProps={{
              input: { disableUnderline: true, sx: { fontSize: 18, fontWeight: 700 } },
            }}
          />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.2 }}>
            <TextField
              size="small"
              label="开始"
              type="datetime-local"
              value={toDatetimeLocalValue(draft?.dueAt ?? null)}
              onChange={(event) => {
                const next = fromDatetimeLocalValue(event.target.value);
                if (next == null) return;
                setDraft((current) => (current ? { ...current, dueAt: next } : current));
              }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              label="结束"
              type="datetime-local"
              value={toDatetimeLocalValue(draft?.dueEndAt ?? null)}
              onChange={(event) => {
                const next = fromDatetimeLocalValue(event.target.value);
                setDraft((current) =>
                  current ? { ...current, dueEndAt: next } : current,
                );
              }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={draft?.reminderEnabled ?? false}
                onChange={(event) => {
                  const checked = event.target.checked;
                  if (!checked) {
                    setDraft((current) =>
                      current ? { ...current, reminderEnabled: false } : current,
                    );
                    return;
                  }
                  void ensureTodoReminderPermission().then((granted) => {
                    setDraft((current) =>
                      current ? { ...current, reminderEnabled: granted } : current,
                    );
                  });
                }}
              />
            }
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <AlarmRoundedIcon sx={{ fontSize: 16, color: "warning.main" }} />
                <Typography sx={{ fontSize: 13 }}>提醒</Typography>
              </Box>
            }
            sx={{ alignSelf: "flex-start", my: -0.4 }}
          />
          <FormControl size="small" fullWidth>
            <InputLabel id="todo-calendar-list-label">清单</InputLabel>
            <Select
              labelId="todo-calendar-list-label"
              value={draft?.listId ?? ""}
              label="清单"
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, listId: event.target.value } : current,
                )
              }
            >
              {activeLists.length === 0 && (
                <MenuItem value="">默认</MenuItem>
              )}
              {activeLists.map((list) => (
                <MenuItem key={list.id} value={list.id}>
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.8 }}>
                    <TodoEmoji emoji={list.emoji} fallback="📋" size={16} />
                    <span>{list.name}</span>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="描述"
            value={draft?.note ?? ""}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, note: event.target.value } : current,
              )
            }
            fullWidth
            multiline
            minRows={4}
            maxRows={8}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeCalendarDialog}>取消</Button>
          <Button
            variant="contained"
            onClick={submitDraft}
            disabled={!draft?.content.trim()}
          >
            {draft?.mode === "edit" ? "保存" : "创建"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
