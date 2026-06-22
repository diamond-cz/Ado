// Zustand store for the todo window.
//
// State shape mirrors `TodoData` plus a `selectedFilter` (sidebar) and
// `selectedItemId` (detail-pane editor) cursor. Every mutating action
// updates state immediately and schedules a 300ms debounced persist via
// `saveTodoData`, so the user never sees a "saving" state but a tight
// burst of edits collapses into one disk write.

import { create } from "zustand";

import type {
  AdvancedTodoFilter,
  DetailFilter,
  SavedTodoFilter,
  TodoData,
  TodoFilter,
  TodoFolder,
  TodoGroup,
  TodoItem,
  TodoList,
  TodoStatus,
} from "./types";
import { getTodoData, saveTodoData } from "./todoIpc";

const ORDER_STEP = 1024;
const SAVE_DEBOUNCE_MS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const TODO_HISTORY_LIMIT = 100;
const TODO_LIST_EMOJI_OPTIONS = [
  "📝",
  "✅",
  "📌",
  "📅",
  "🎯",
  "🚀",
  "💡",
  "⭐",
  "📚",
  "🛠️",
  "💼",
  "🏷️",
  "🧩",
  "🔖",
  "🧠",
  "⚡",
  "🌱",
  "🎨",
  "📦",
  "🗂️",
];
const TODO_FOLDER_EMOJI_OPTIONS = [
  "📁",
  "🗂️",
  "📦",
  "🧰",
  "🏷️",
  "📚",
  "💼",
  "🧭",
  "🗃️",
  "🧩",
  "🚀",
  "⭐",
  "🌱",
  "🎯",
  "🛠️",
];
// Trashed items older than this are purged on next hydrate. Matches the
// "30 天后永久删除" line shown in the trash header.
const TRASH_TTL_MS = 30 * DAY_MS;
export const INBOX_LIST_NAME = "收集箱";
export const INBOX_LIST_EMOJI = "📥";
export const DEFAULT_ADVANCED_FILTER: AdvancedTodoFilter = {
  listId: "all",
  keyword: "",
  time: "all",
  timeRangeStart: null,
  timeRangeEnd: null,
  priority: "all",
  tag: "all",
  marked: "all",
  status: "all",
  logic: "and",
};

function newId(prefix: string): string {
  // crypto.randomUUID would be cleaner but isn't available in older WebView2.
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function randomTodoEmoji(options: string[]): string {
  return options[Math.floor(Math.random() * options.length)] ?? options[0] ?? "";
}

export function randomTodoListEmoji(): string {
  return randomTodoEmoji(TODO_LIST_EMOJI_OPTIONS);
}

export function randomTodoFolderEmoji(): string {
  return randomTodoEmoji(TODO_FOLDER_EMOJI_OPTIONS);
}

function nextListOrder(lists: TodoList[]): number {
  if (lists.length === 0) return ORDER_STEP;
  return Math.max(...lists.map((l) => l.order)) + ORDER_STEP;
}

function nextRootOrder(folders: TodoFolder[], lists: TodoList[]): number {
  const orders = [
    ...folders.map((folder) => folder.order),
    ...lists
      .filter((list) => list.folderId == null && list.archivedAt == null)
      .map((list) => list.order),
  ];
  if (orders.length === 0) return ORDER_STEP;
  return Math.max(...orders) + ORDER_STEP;
}

function nextGroupOrder(groups: TodoGroup[], listId: string): number {
  const scoped = groups.filter((group) => group.listId === listId);
  if (scoped.length === 0) return ORDER_STEP;
  return Math.max(...scoped.map((group) => group.order)) + ORDER_STEP;
}

export function isInboxList(list: TodoList): boolean {
  return list.name === INBOX_LIST_NAME;
}

function findInboxList(lists: TodoList[]): TodoList | null {
  return lists.find((list) => isInboxList(list) && list.archivedAt == null) ?? null;
}

function nextItemOrder(
  items: TodoItem[],
  listId: string,
  parentId: string | null = null,
  groupId: string | null = null,
): number {
  const scoped = items.filter(
    (it) =>
      it.listId === listId &&
      (it.parentId ?? null) === parentId &&
      (it.groupId ?? null) === groupId,
  );
  if (scoped.length === 0) return ORDER_STEP;
  return Math.max(...scoped.map((it) => it.order)) + ORDER_STEP;
}

// New tasks land at the TOP of their list (smaller `order` = higher in
// asc-sorted list). Use min-step so subsequent additions keep stacking
// upward without colliding.
function topItemOrder(
  items: TodoItem[],
  listId: string,
  parentId: string | null = null,
  groupId: string | null = null,
): number {
  const scoped = items.filter(
    (it) =>
      it.listId === listId &&
      (it.parentId ?? null) === parentId &&
      (it.groupId ?? null) === groupId,
  );
  if (scoped.length === 0) return ORDER_STEP;
  return Math.min(...scoped.map((it) => it.order)) - ORDER_STEP;
}

function clampProgress(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function collectDescendantIds(items: TodoItem[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (item.parentId != null && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
  }
  return ids;
}

function dueRangeOverlaps(item: TodoItem, startMs: number, endMs: number): boolean {
  if (item.dueAt == null) return false;
  const start = item.dueAt;
  const end =
    item.dueEndAt != null && item.dueEndAt > item.dueAt
      ? item.dueEndAt
      : item.dueAt;
  return end > start ? start < endMs && end > startMs : start >= startMs && start < endMs;
}

function dueRangeEndsBefore(item: TodoItem, ts: number): boolean {
  if (item.dueAt == null) return false;
  const end =
    item.dueEndAt != null && item.dueEndAt > item.dueAt
      ? item.dueEndAt
      : item.dueAt;
  return end < ts;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localWeekRange(date: Date): [number, number] {
  const startOfToday = startOfLocalDay(date);
  const day = date.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const startOfWeek = startOfToday - daysSinceMonday * DAY_MS;
  return [startOfWeek, startOfWeek + 7 * DAY_MS];
}

function rootItemFor(item: TodoItem, items: TodoItem[]): TodoItem {
  const byId = new Map(items.map((it) => [it.id, it]));
  let current = item;
  const seen = new Set<string>([item.id]);
  while (current.parentId != null) {
    const parent = byId.get(current.parentId);
    if (!parent || parent.listId !== item.listId || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

function subtreeItems(rootId: string, items: TodoItem[]): TodoItem[] {
  const ids = collectDescendantIds(items, rootId);
  return items.filter((item) => ids.has(item.id));
}

function withStatus(item: TodoItem, status: TodoStatus, now: number): TodoItem {
  const progress =
    status === "completed" ? 100 : status === "pending" ? 0 : item.progress;
  const completedAt = status === "completed" ? item.completedAt ?? now : null;
  if (
    item.status === status &&
    item.progress === progress &&
    item.completedAt === completedAt
  ) {
    return item;
  }
  return { ...item, status, progress, completedAt, updatedAt: now };
}

export function todoCompletionBlocker(
  item: TodoItem,
  items: TodoItem[],
): TodoItem | null {
  if (item.predecessorId == null || item.status === "completed") return null;
  const predecessor = items.find(
    (entry) => entry.id === item.predecessorId && entry.deletedAt == null,
  );
  if (!predecessor || predecessor.status === "completed") return null;
  return predecessor;
}

export function isTodoCompletionBlocked(item: TodoItem, items: TodoItem[]): boolean {
  return todoCompletionBlocker(item, items) != null;
}

function wouldCreatePredecessorCycle(
  items: TodoItem[],
  itemId: string,
  predecessorId: string,
): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let currentId: string | null = predecessorId;
  while (currentId != null) {
    if (currentId === itemId) return true;
    if (seen.has(currentId)) return true;
    seen.add(currentId);
    currentId = byId.get(currentId)?.predecessorId ?? null;
  }
  return false;
}

export function isFullyCompletedSubtreeItem(item: TodoItem, items: TodoItem[]): boolean {
  const root = rootItemFor(item, items);
  const subtree = subtreeItems(root.id, items).filter((it) => it.deletedAt == null);
  return subtree.length > 0 && subtree.every((it) => it.status === "completed");
}

export function shouldShowInActiveList(item: TodoItem, items: TodoItem[]): boolean {
  return item.deletedAt == null && item.status !== "abandoned" && !isFullyCompletedSubtreeItem(item, items);
}

function normalizeAdvancedFilter(
  raw: Partial<AdvancedTodoFilter> | null | undefined,
): AdvancedTodoFilter {
  const time =
    raw?.time === "overdue" ||
    raw?.time === "today" ||
    raw?.time === "thisWeek" ||
    raw?.time === "customRange" ||
    raw?.time === "noDue"
      ? raw.time
      : "all";
  let timeRangeStart =
    typeof raw?.timeRangeStart === "number" && Number.isFinite(raw.timeRangeStart)
      ? raw.timeRangeStart
      : null;
  let timeRangeEnd =
    typeof raw?.timeRangeEnd === "number" && Number.isFinite(raw.timeRangeEnd)
      ? raw.timeRangeEnd
      : null;
  if (timeRangeStart != null && timeRangeEnd != null && timeRangeStart > timeRangeEnd) {
    [timeRangeStart, timeRangeEnd] = [timeRangeEnd, timeRangeStart];
  }
  const priority: AdvancedTodoFilter["priority"] =
    raw?.priority === "importantUrgent" ||
    raw?.priority === "importantNotUrgent" ||
    raw?.priority === "notImportantUrgent" ||
    raw?.priority === "notImportantNotUrgent"
      ? raw.priority
      : "all";
  const marked =
    raw?.marked === "marked" || raw?.marked === "unmarked"
      ? raw.marked
      : "all";
  const status =
    raw?.status === "pending" ||
    raw?.status === "completed" ||
    raw?.status === "abandoned"
      ? raw.status
      : "all";
  return {
    listId: typeof raw?.listId === "string" && raw.listId ? raw.listId : "all",
    keyword: typeof raw?.keyword === "string" ? raw.keyword : "",
    time,
    timeRangeStart,
    timeRangeEnd,
    priority,
    tag: typeof raw?.tag === "string" && raw.tag ? raw.tag : "all",
    marked,
    status,
    logic: raw?.logic === "or" ? "or" : "and",
  };
}

function applyAdvancedCriteria(
  items: TodoItem[],
  advanced: AdvancedTodoFilter,
): TodoItem[] {
  const normalized = normalizeAdvancedFilter(advanced);
  const now = new Date();
  const startOfToday = startOfLocalDay(now);
  const endOfToday = startOfToday + DAY_MS;
  const [startOfWeek, endOfWeek] = localWeekRange(now);
  const predicates: Array<(item: TodoItem) => boolean> = [];

  if (normalized.listId !== "all") {
    predicates.push((item) => item.listId === normalized.listId);
  }
  const keyword = normalized.keyword.trim().toLowerCase();
  if (keyword) {
    predicates.push((item) => item.content.toLowerCase().includes(keyword));
  }
  if (normalized.status !== "all") {
    predicates.push((item) => item.status === normalized.status);
  }
  if (normalized.priority !== "all") {
    predicates.push((item) => item.priority === normalized.priority);
  }
  if (normalized.tag !== "all") {
    predicates.push((item) => item.tags.includes(normalized.tag));
  }
  if (normalized.marked !== "all") {
    predicates.push((item) =>
      normalized.marked === "marked" ? item.marked : !item.marked,
    );
  }
  switch (normalized.time) {
    case "overdue":
      predicates.push((item) => dueRangeEndsBefore(item, startOfToday));
      break;
    case "today":
      predicates.push((item) => dueRangeOverlaps(item, startOfToday, endOfToday));
      break;
    case "thisWeek":
      predicates.push((item) => dueRangeOverlaps(item, startOfWeek, endOfWeek));
      break;
    case "customRange": {
      const startMs = normalized.timeRangeStart ?? Number.NEGATIVE_INFINITY;
      const endMs =
        normalized.timeRangeEnd != null
          ? normalized.timeRangeEnd + DAY_MS
          : Number.POSITIVE_INFINITY;
      if (Number.isFinite(startMs) || Number.isFinite(endMs)) {
        predicates.push((item) => dueRangeOverlaps(item, startMs, endMs));
      }
      break;
    }
    case "noDue":
      predicates.push((item) => item.dueAt == null);
      break;
    case "all":
      break;
  }
  if (predicates.length === 0) return items;
  return items.filter((item) => predicates.every((predicate) => predicate(item)));
}

// Backfill missing fields from older on-disk shapes so older saves don't
// crash the new UI.
function normalizeList(raw: Partial<TodoList>): TodoList {
  return {
    id: raw.id ?? newId("list"),
    name: raw.name ?? "",
    emoji: raw.emoji ?? "📋",
    folderId:
      typeof raw.folderId === "string" && raw.folderId.length > 0
        ? raw.folderId
        : null,
    order: raw.order ?? 0,
    createdAt: raw.createdAt ?? Date.now(),
    archivedAt: typeof raw.archivedAt === "number" ? raw.archivedAt : null,
  };
}

function normalizeFolder(raw: Partial<TodoFolder>, index: number): TodoFolder {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("folder"),
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : `文件夹 ${index + 1}`,
    emoji: typeof raw.emoji === "string" && raw.emoji ? raw.emoji : "📁",
    order: typeof raw.order === "number" ? raw.order : (index + 1) * ORDER_STEP,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

function normalizeGroup(raw: Partial<TodoGroup>, index: number): TodoGroup {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("group"),
    listId: typeof raw.listId === "string" ? raw.listId : "",
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : `分组 ${index + 1}`,
    order: typeof raw.order === "number" ? raw.order : (index + 1) * ORDER_STEP,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

function normalizeItem(raw: Partial<TodoItem>): TodoItem {
  const now = Date.now();
  const priority: TodoItem["priority"] =
    raw.priority === "importantUrgent" ||
    raw.priority === "importantNotUrgent" ||
    raw.priority === "notImportantUrgent" ||
    raw.priority === "notImportantNotUrgent"
      ? raw.priority
      : null;
  const status: TodoStatus =
    raw.status === "completed" || raw.status === "abandoned" || raw.status === "pending"
      ? raw.status
      : "pending";
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : now;
  return {
    id: raw.id ?? newId("item"),
    listId: raw.listId ?? "",
    content: raw.content ?? "",
    status,
    dueAt: raw.dueAt ?? null,
    dueEndAt:
      raw.dueAt != null && typeof raw.dueEndAt === "number" && raw.dueEndAt > raw.dueAt
        ? raw.dueEndAt
        : null,
    reminderEnabled: raw.dueAt != null && raw.reminderEnabled === true,
    parentId:
      typeof raw.parentId === "string" && raw.parentId.length > 0 && raw.parentId !== raw.id
        ? raw.parentId
        : null,
    groupId:
      typeof raw.groupId === "string" && raw.groupId.length > 0
        ? raw.groupId
        : null,
    predecessorId:
      typeof raw.predecessorId === "string" &&
      raw.predecessorId.length > 0 &&
      raw.predecessorId !== raw.id
        ? raw.predecessorId
        : null,
    marked: raw.marked ?? false,
    order: raw.order ?? 0,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt,
    completedAt:
      typeof raw.completedAt === "number"
        ? raw.completedAt
        : status === "completed"
          ? updatedAt
          : null,
    note: raw.note ?? "",
    deletedAt: raw.deletedAt ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [],
    priority,
    progress: clampProgress(raw.progress),
  };
}

function nextCustomFilterOrder(filters: SavedTodoFilter[]): number {
  if (filters.length === 0) return ORDER_STEP;
  return Math.max(...filters.map((filter) => filter.order)) + ORDER_STEP;
}

function normalizeSavedFilter(
  raw: Partial<SavedTodoFilter>,
  index: number,
): SavedTodoFilter {
  const now = Date.now();
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : `过滤器 ${index + 1}`;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("filter"),
    name,
    criteria: normalizeAdvancedFilter(raw.criteria),
    order: typeof raw.order === "number" ? raw.order : (index + 1) * ORDER_STEP,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

interface TodoStore {
  hydrated: boolean;
  folders: TodoFolder[];
  lists: TodoList[];
  groups: TodoGroup[];
  items: TodoItem[];
  customFilters: SavedTodoFilter[];
  defaultListId: string | null;
  selectedFilter: TodoFilter;
  advancedFilter: AdvancedTodoFilter;
  detailFilter: DetailFilter;
  selectedItemId: string | null;
  multiSelectedItemIds: string[];
  showCompleted: boolean;

  hydrate: () => Promise<void>;
  reload: () => Promise<void>;
  setSelectedFilter: (f: TodoFilter) => void;
  setAdvancedFilter: (patch: Partial<AdvancedTodoFilter>) => void;
  resetAdvancedFilter: () => void;
  addCustomFilter: (
    name: string,
    criteria?: AdvancedTodoFilter,
  ) => SavedTodoFilter | null;
  updateCustomFilter: (
    id: string,
    patch: { name?: string; criteria?: AdvancedTodoFilter },
  ) => void;
  deleteCustomFilter: (id: string) => void;
  setDetailFilter: (f: DetailFilter) => void;
  setSelectedItemId: (id: string | null) => void;
  setMultiSelectedItemIds: (ids: string[]) => void;
  toggleMultiSelectedItemId: (id: string) => void;
  clearMultiSelectedItemIds: () => void;
  toggleShowCompleted: () => void;
  undo: () => void;
  redo: () => void;
  setDefaultList: (id: string) => void;
  ensureDefaultList: () => string;
  ensureInboxList: () => string;

  addFolder: (input: { name: string; emoji?: string; order?: number }) => TodoFolder;
  renameFolder: (id: string, patch: { name?: string; emoji?: string }) => void;
  reorderFolder: (id: string, newOrder: number) => void;
  deleteFolder: (id: string) => void;

  addList: (input: { name: string; emoji?: string; folderId?: string | null; order?: number }) => TodoList;
  renameList: (
    id: string,
    patch: { name?: string; emoji?: string; folderId?: string | null },
  ) => void;
  moveList: (id: string, folderId: string | null, newOrder: number) => void;
  archiveList: (id: string) => void;
  unarchiveList: (id: string) => void;
  deleteList: (id: string) => void;

  addGroup: (
    listId: string,
    name: string,
    options?: { order?: number },
  ) => TodoGroup | null;
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string) => void;
  reorderGroup: (id: string, newOrder: number) => void;

  addItem: (
    listId: string,
    content: string,
    options?: {
      parentId?: string | null;
      groupId?: string | null;
      allowEmpty?: boolean;
      dueAt?: number | null;
      dueEndAt?: number | null;
      reminderEnabled?: boolean;
    },
  ) => TodoItem | null;
  updateItem: (id: string, patch: Partial<Omit<TodoItem, "id" | "createdAt">>) => void;
  setStatus: (id: string, status: TodoStatus) => void;
  setItemsStatus: (ids: string[], status: TodoStatus) => void;
  cycleStatus: (id: string) => void;
  toggleMarked: (id: string) => void;
  setDueAt: (id: string, dueAt: number | null) => void;
  setDueRange: (
    id: string,
    dueAt: number | null,
    dueEndAt: number | null,
    reminderEnabled?: boolean,
  ) => void;
  setNote: (id: string, note: string) => void;
  addTag: (id: string, tag: string) => void;
  removeTag: (id: string, tag: string) => void;
  setTags: (id: string, tags: string[]) => void;
  renameTag: (oldTag: string, newTag: string) => void;
  deleteTag: (tag: string) => void;
  deleteItem: (id: string) => void;          // soft delete (move to trash)
  deleteItems: (ids: string[]) => void;       // soft delete several roots as one operation
  restoreItem: (id: string) => void;          // restore from trash
  purgeItem: (id: string) => void;            // permanent delete
  purgeAllTrash: () => void;
  copyItem: (id: string, toListId: string) => void;
  moveItem: (id: string, toListId: string) => void;
  setItemGroup: (id: string, groupId: string | null) => void;
  setItemPredecessor: (id: string, predecessorId: string | null) => void;
  reorderItem: (id: string, newOrder: number) => void;

  flush: () => Promise<void>;
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPromise: Promise<void> | null = null;

interface TodoHistorySnapshot {
  folders: TodoFolder[];
  lists: TodoList[];
  groups: TodoGroup[];
  items: TodoItem[];
  customFilters: SavedTodoFilter[];
  defaultListId: string | null;
  selectedFilter: TodoFilter;
  advancedFilter: AdvancedTodoFilter;
  detailFilter: DetailFilter;
  selectedItemId: string | null;
  multiSelectedItemIds: string[];
  showCompleted: boolean;
}

const undoStack: TodoHistorySnapshot[] = [];
const redoStack: TodoHistorySnapshot[] = [];

function cloneRecords<T extends object>(records: T[]): T[] {
  return records.map((record) => ({ ...record }));
}

function cloneAdvancedFilter(filter: AdvancedTodoFilter): AdvancedTodoFilter {
  return { ...filter };
}

function cloneDetailFilter(filter: DetailFilter): DetailFilter {
  return { ...filter } as DetailFilter;
}

function cloneTodoFilter(filter: TodoFilter): TodoFilter {
  return { ...filter } as TodoFilter;
}

function createTodoHistorySnapshot(state: TodoStore): TodoHistorySnapshot {
  return {
    folders: cloneRecords(state.folders),
    lists: cloneRecords(state.lists),
    groups: cloneRecords(state.groups),
    items: cloneRecords(state.items),
    customFilters: state.customFilters.map((filter) => ({
      ...filter,
      criteria: cloneAdvancedFilter(filter.criteria),
    })),
    defaultListId: state.defaultListId,
    selectedFilter: cloneTodoFilter(state.selectedFilter),
    advancedFilter: cloneAdvancedFilter(state.advancedFilter),
    detailFilter: cloneDetailFilter(state.detailFilter),
    selectedItemId: state.selectedItemId,
    multiSelectedItemIds: [...state.multiSelectedItemIds],
    showCompleted: state.showCompleted,
  };
}

function snapshotToState(snapshot: TodoHistorySnapshot): Partial<TodoStore> {
  return {
    folders: cloneRecords(snapshot.folders),
    lists: cloneRecords(snapshot.lists),
    groups: cloneRecords(snapshot.groups),
    items: cloneRecords(snapshot.items),
    customFilters: snapshot.customFilters.map((filter) => ({
      ...filter,
      criteria: cloneAdvancedFilter(filter.criteria),
    })),
    defaultListId: snapshot.defaultListId,
    selectedFilter: cloneTodoFilter(snapshot.selectedFilter),
    advancedFilter: cloneAdvancedFilter(snapshot.advancedFilter),
    detailFilter: cloneDetailFilter(snapshot.detailFilter),
    selectedItemId: snapshot.selectedItemId,
    multiSelectedItemIds: [...snapshot.multiSelectedItemIds],
    showCompleted: snapshot.showCompleted,
  };
}

function todoHistorySnapshotsEqual(a: TodoHistorySnapshot, b: TodoHistorySnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clearTodoHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

function pushUndoSnapshot(before: TodoHistorySnapshot, after: TodoHistorySnapshot) {
  if (todoHistorySnapshotsEqual(before, after)) return;
  undoStack.push(before);
  if (undoStack.length > TODO_HISTORY_LIMIT) {
    undoStack.splice(0, undoStack.length - TODO_HISTORY_LIMIT);
  }
  redoStack.length = 0;
}

function commitTodoMutation(
  getState: () => TodoStore,
  before: TodoHistorySnapshot,
) {
  pushUndoSnapshot(before, createTodoHistorySnapshot(getState()));
  scheduleSave(getState);
}

function scheduleSave(getState: () => TodoStore) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const { folders, lists, groups, items, customFilters, defaultListId } = getState();
    const data: TodoData = {
      version: 2,
      folders,
      lists,
      groups,
      items,
      customFilters,
      defaultListId: defaultListId ?? null,
    };
    pendingPromise = saveTodoData(data).catch((err) => {
      console.error("[todo] saveTodoData failed:", err);
    });
  }, SAVE_DEBOUNCE_MS);
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  hydrated: false,
  folders: [],
  lists: [],
  groups: [],
  items: [],
  customFilters: [],
  defaultListId: null,
  selectedFilter: { kind: "today" },
  advancedFilter: DEFAULT_ADVANCED_FILTER,
  detailFilter: { kind: "all" },
  selectedItemId: null,
  multiSelectedItemIds: [],
  showCompleted: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const data = await getTodoData();
      const folders = (Array.isArray(data?.folders) ? data.folders : []).map(normalizeFolder);
      const lists = (Array.isArray(data?.lists) ? data.lists : []).map(normalizeList);
      const folderIds = new Set(folders.map((folder) => folder.id));
      const validLists = lists.map((list) => ({
        ...list,
        folderId: list.folderId != null && folderIds.has(list.folderId) ? list.folderId : null,
      }));
      const groups = (Array.isArray(data?.groups) ? data.groups : [])
        .map(normalizeGroup)
        .filter((group) => validLists.some((list) => list.id === group.listId));
      const groupIds = new Set(groups.map((group) => group.id));
      const items = (Array.isArray(data?.items) ? data.items : [])
        .map(normalizeItem)
        .map((item) => ({
          ...item,
          groupId: item.groupId != null && groupIds.has(item.groupId) ? item.groupId : null,
        }));
      const customFilters = (
        Array.isArray(data?.customFilters) ? data.customFilters : []
      ).map(normalizeSavedFilter);
      // Auto-purge trash items past their TTL — keeps the on-disk file
      // bounded over time.
      const now = Date.now();
      const kept = items.filter(
        (it) => it.deletedAt == null || now - it.deletedAt < TRASH_TTL_MS,
      );
      const keptIds = new Set(kept.map((item) => item.id));
      const normalizedKept = kept.map((item) => ({
        ...item,
        predecessorId:
          item.predecessorId != null &&
          item.predecessorId !== item.id &&
          keptIds.has(item.predecessorId) &&
          !wouldCreatePredecessorCycle(kept, item.id, item.predecessorId)
            ? item.predecessorId
            : null,
      }));
      const defaultListId =
        data?.defaultListId != null &&
        validLists.some((l) => l.id === data.defaultListId && l.archivedAt == null)
          ? data.defaultListId
          : null;
      set({
        hydrated: true,
        folders,
        lists: validLists,
        groups,
        items: normalizedKept,
        customFilters,
        defaultListId,
      });
      clearTodoHistory();
      if (
        kept.length !== items.length ||
        normalizedKept.some((item, index) => item.predecessorId !== kept[index]?.predecessorId) ||
        defaultListId !== (data?.defaultListId ?? null)
      ) {
        scheduleSave(get);
      }
    } catch (err) {
      console.error("[todo] hydrate failed:", err);
      set({ hydrated: true });
    }
  },

  reload: async () => {
    try {
      const data = await getTodoData();
      const folders = (Array.isArray(data?.folders) ? data.folders : []).map(normalizeFolder);
      const lists = (Array.isArray(data?.lists) ? data.lists : []).map(normalizeList);
      const folderIds = new Set(folders.map((folder) => folder.id));
      const validLists = lists.map((list) => ({
        ...list,
        folderId: list.folderId != null && folderIds.has(list.folderId) ? list.folderId : null,
      }));
      const groups = (Array.isArray(data?.groups) ? data.groups : [])
        .map(normalizeGroup)
        .filter((group) => validLists.some((list) => list.id === group.listId));
      const groupIds = new Set(groups.map((group) => group.id));
      const items = (Array.isArray(data?.items) ? data.items : [])
        .map(normalizeItem)
        .map((item) => ({
          ...item,
          groupId: item.groupId != null && groupIds.has(item.groupId) ? item.groupId : null,
        }));
      const customFilters = (
        Array.isArray(data?.customFilters) ? data.customFilters : []
      ).map(normalizeSavedFilter);
      const now = Date.now();
      const kept = items.filter(
        (it) => it.deletedAt == null || now - it.deletedAt < TRASH_TTL_MS,
      );
      const keptIds = new Set(kept.map((item) => item.id));
      const normalizedKept = kept.map((item) => ({
        ...item,
        predecessorId:
          item.predecessorId != null &&
          item.predecessorId !== item.id &&
          keptIds.has(item.predecessorId) &&
          !wouldCreatePredecessorCycle(kept, item.id, item.predecessorId)
            ? item.predecessorId
            : null,
      }));
      const defaultListId =
        data?.defaultListId != null &&
        validLists.some((l) => l.id === data.defaultListId && l.archivedAt == null)
          ? data.defaultListId
          : null;
      const selectedItemId = get().selectedItemId;
      const multiSelectedItemIds = get().multiSelectedItemIds;
      set({
        hydrated: true,
        folders,
        lists: validLists,
        groups,
        items: normalizedKept,
        customFilters,
        defaultListId,
        selectedItemId:
          selectedItemId != null && kept.some((item) => item.id === selectedItemId)
            ? selectedItemId
            : null,
        multiSelectedItemIds: multiSelectedItemIds.filter((id) => keptIds.has(id)),
      });
      clearTodoHistory();
      if (kept.length !== items.length || defaultListId !== (data?.defaultListId ?? null)) {
        scheduleSave(get);
      }
    } catch (err) {
      console.error("[todo] reload failed:", err);
    }
  },

  setSelectedFilter: (f) =>
    set({
      selectedFilter: f,
      selectedItemId: null,
      multiSelectedItemIds: [],
      detailFilter: { kind: "all" },
    }),
  setAdvancedFilter: (patch) =>
    set((s) => ({ advancedFilter: { ...s.advancedFilter, ...patch } })),
  resetAdvancedFilter: () => set({ advancedFilter: DEFAULT_ADVANCED_FILTER }),
  addCustomFilter: (name, criteria) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const now = Date.now();
    const filter: SavedTodoFilter = {
      id: newId("filter"),
      name: trimmed,
      criteria: normalizeAdvancedFilter(criteria ?? get().advancedFilter),
      order: nextCustomFilterOrder(get().customFilters),
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ customFilters: [...s.customFilters, filter] }));
    scheduleSave(get);
    return filter;
  },
  updateCustomFilter: (id, patch) => {
    const name =
      patch.name !== undefined && patch.name.trim() ? patch.name.trim() : undefined;
    set((s) => ({
      customFilters: s.customFilters.map((filter) =>
        filter.id === id
          ? {
              ...filter,
              name: name ?? filter.name,
              criteria:
                patch.criteria !== undefined
                  ? normalizeAdvancedFilter(patch.criteria)
                  : filter.criteria,
              updatedAt: Date.now(),
            }
          : filter,
      ),
    }));
    scheduleSave(get);
  },
  deleteCustomFilter: (id) => {
    set((s) => ({
      customFilters: s.customFilters.filter((filter) => filter.id !== id),
      selectedFilter:
        s.selectedFilter.kind === "customFilter" && s.selectedFilter.id === id
          ? { kind: "advanced" }
          : s.selectedFilter,
    }));
    scheduleSave(get);
  },
  setDetailFilter: (f) => set({ detailFilter: f }),
  setSelectedItemId: (id) => set({ selectedItemId: id }),
  setMultiSelectedItemIds: (ids) =>
    set((s) => {
      const activeIds = new Set(
        s.items.filter((item) => item.deletedAt == null).map((item) => item.id),
      );
      const next = Array.from(new Set(ids)).filter((id) => activeIds.has(id));
      return { multiSelectedItemIds: next };
    }),
  toggleMultiSelectedItemId: (id) =>
    set((s) => {
      const target = s.items.find((item) => item.id === id);
      if (!target || target.deletedAt != null) return {};
      const next = new Set(
        s.multiSelectedItemIds.filter((entry) =>
          s.items.some((item) => item.id === entry && item.deletedAt == null),
        ),
      );
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { multiSelectedItemIds: Array.from(next), selectedItemId: id };
    }),
  clearMultiSelectedItemIds: () =>
    set((s) => (s.multiSelectedItemIds.length > 0 ? { multiSelectedItemIds: [] } : {})),
  toggleShowCompleted: () => set((s) => ({ showCompleted: !s.showCompleted })),
  undo: () => {
    const previous = undoStack.pop();
    if (!previous) return;
    const current = createTodoHistorySnapshot(get());
    redoStack.push(current);
    if (redoStack.length > TODO_HISTORY_LIMIT) {
      redoStack.splice(0, redoStack.length - TODO_HISTORY_LIMIT);
    }
    set(snapshotToState(previous));
    scheduleSave(get);
  },
  redo: () => {
    const next = redoStack.pop();
    if (!next) return;
    const current = createTodoHistorySnapshot(get());
    undoStack.push(current);
    if (undoStack.length > TODO_HISTORY_LIMIT) {
      undoStack.splice(0, undoStack.length - TODO_HISTORY_LIMIT);
    }
    set(snapshotToState(next));
    scheduleSave(get);
  },

  setDefaultList: (id) => {
    const target = get().lists.find((l) => l.id === id);
    if (!target || target.archivedAt != null) return;
    set({ defaultListId: id });
    scheduleSave(get);
  },

  ensureDefaultList: () => {
    const cur = get();
    if (cur.defaultListId) {
      const exists = cur.lists.some(
        (l) => l.id === cur.defaultListId && l.archivedAt == null,
      );
      if (exists) return cur.defaultListId;
    }
    // Reuse a list named "默认" if any, otherwise create it.
    const existing = cur.lists.find((l) => l.name === "默认" && l.archivedAt == null);
    let id: string;
    if (existing) {
      id = existing.id;
    } else {
      const list = get().addList({ name: "默认", emoji: "📋" });
      id = list.id;
    }
    set({ defaultListId: id });
    scheduleSave(get);
    return id;
  },

  ensureInboxList: () => {
    const cur = get();
    const existing = cur.lists.find(isInboxList);
    if (existing) {
      if (existing.archivedAt != null || existing.emoji !== INBOX_LIST_EMOJI) {
        set((s) => ({
          lists: s.lists.map((list) =>
            list.id === existing.id
              ? { ...list, emoji: INBOX_LIST_EMOJI, archivedAt: null }
              : list,
          ),
        }));
        scheduleSave(get);
      }
      return existing.id;
    }

    const list: TodoList = {
      id: newId("list"),
      name: INBOX_LIST_NAME,
      emoji: INBOX_LIST_EMOJI,
      folderId: null,
      order: nextListOrder(cur.lists),
      createdAt: Date.now(),
      archivedAt: null,
    };
    set((s) => ({ lists: [...s.lists, list] }));
    scheduleSave(get);
    return list.id;
  },

  addFolder: ({ name, emoji, order }) => {
    const folder: TodoFolder = {
      id: newId("folder"),
      name: name.trim() || "未命名文件夹",
      emoji: emoji?.trim() || randomTodoFolderEmoji(),
      order: order ?? nextRootOrder(get().folders, get().lists),
      createdAt: Date.now(),
    };
    set((s) => ({ folders: [...s.folders, folder] }));
    scheduleSave(get);
    return folder;
  },

  renameFolder: (id, patch) => {
    set((s) => ({
      folders: s.folders.map((folder) =>
        folder.id === id
          ? {
              ...folder,
              name: patch.name !== undefined ? patch.name : folder.name,
              emoji: patch.emoji !== undefined ? patch.emoji : folder.emoji,
            }
          : folder,
      ),
    }));
    scheduleSave(get);
  },

  reorderFolder: (id, newOrder) => {
    set((s) => ({
      folders: s.folders.map((folder) =>
        folder.id === id ? { ...folder, order: newOrder } : folder,
      ),
    }));
    scheduleSave(get);
  },

  deleteFolder: (id) => {
    set((s) => ({
      folders: s.folders.filter((folder) => folder.id !== id),
      lists: s.lists.map((list) =>
        list.folderId === id ? { ...list, folderId: null } : list,
      ),
      selectedFilter:
        s.selectedFilter.kind === "folder" && s.selectedFilter.id === id
          ? { kind: "today" }
          : s.selectedFilter,
    }));
    scheduleSave(get);
  },

  addList: ({ name, emoji, folderId = null, order }) => {
    const normalizedFolderId =
      folderId != null && get().folders.some((folder) => folder.id === folderId)
        ? folderId
        : null;
    const list: TodoList = {
      id: newId("list"),
      name: name.trim() || "未命名清单",
      emoji: emoji?.trim() || randomTodoListEmoji(),
      folderId: normalizedFolderId,
      order:
        order ??
        (normalizedFolderId == null
          ? nextRootOrder(get().folders, get().lists)
          : nextListOrder(
              get().lists.filter((list) => list.folderId === normalizedFolderId),
            )),
      createdAt: Date.now(),
      archivedAt: null,
    };
    set((s) => ({ lists: [...s.lists, list] }));
    scheduleSave(get);
    return list;
  },

  renameList: (id, patch) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id
          ? {
              ...l,
              name: patch.name !== undefined ? patch.name : l.name,
              emoji: patch.emoji !== undefined ? patch.emoji : l.emoji,
              folderId:
                patch.folderId !== undefined
                  ? patch.folderId != null &&
                    s.folders.some((folder) => folder.id === patch.folderId)
                    ? patch.folderId
                    : null
                  : l.folderId,
            }
          : l,
      ),
    }));
    scheduleSave(get);
  },

  moveList: (id, folderId, newOrder) => {
    set((s) => {
      const normalizedFolderId =
        folderId != null && s.folders.some((folder) => folder.id === folderId)
          ? folderId
          : null;
      return {
        lists: s.lists.map((list) =>
          list.id === id && list.archivedAt == null
            ? { ...list, folderId: normalizedFolderId, order: newOrder }
            : list,
        ),
      };
    });
    scheduleSave(get);
  },

  archiveList: (id) => {
    const now = Date.now();
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id ? { ...l, archivedAt: l.archivedAt ?? now } : l,
      ),
      defaultListId: s.defaultListId === id ? null : s.defaultListId,
    }));
    scheduleSave(get);
  },

  unarchiveList: (id) => {
    set((s) => ({
      lists: s.lists.map((l) => (l.id === id ? { ...l, archivedAt: null } : l)),
    }));
    scheduleSave(get);
  },

  deleteList: (id) => {
    // Soft-delete every item in the list so the user can recover from a
    // mistaken list deletion via the trash. The list itself is removed.
    const now = Date.now();
    set((s) => ({
      lists: s.lists.filter((l) => l.id !== id),
      groups: s.groups.filter((group) => group.listId !== id),
      items: s.items.map((it) =>
        it.listId === id && it.deletedAt == null
          ? { ...it, deletedAt: now, updatedAt: now }
          : it,
      ),
      selectedFilter:
        s.selectedFilter.kind === "list" && s.selectedFilter.id === id
          ? { kind: "today" }
          : s.selectedFilter,
      defaultListId: s.defaultListId === id ? null : s.defaultListId,
    }));
    scheduleSave(get);
  },

  addGroup: (listId, name, options) => {
    const list = get().lists.find((entry) => entry.id === listId);
    const trimmed = name.trim();
    if (!list || !trimmed) return null;
    const group: TodoGroup = {
      id: newId("group"),
      listId,
      name: trimmed,
      order: options?.order ?? nextGroupOrder(get().groups, listId),
      createdAt: Date.now(),
    };
    set((s) => ({ groups: [...s.groups, group] }));
    scheduleSave(get);
    return group;
  },

  renameGroup: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((s) => ({
      groups: s.groups.map((group) =>
        group.id === id ? { ...group, name: trimmed } : group,
      ),
    }));
    scheduleSave(get);
  },

  deleteGroup: (id) => {
    set((s) => ({
      groups: s.groups.filter((group) => group.id !== id),
      items: s.items.map((item) =>
        item.groupId === id ? { ...item, groupId: null, updatedAt: Date.now() } : item,
      ),
    }));
    scheduleSave(get);
  },

  reorderGroup: (id, newOrder) => {
    set((s) => ({
      groups: s.groups.map((group) =>
        group.id === id ? { ...group, order: newOrder } : group,
      ),
    }));
    scheduleSave(get);
  },

  addItem: (listId, content, options) => {
    const text = content.trim();
    if (!text && !options?.allowEmpty) return null;
    const parent =
      options?.parentId != null
        ? get().items.find((it) => it.id === options.parentId && it.listId === listId)
        : null;
    const parentId = parent?.id ?? null;
    const requestedGroupId =
      options?.groupId != null &&
      get().groups.some((group) => group.id === options.groupId && group.listId === listId)
        ? options.groupId
        : null;
    const groupId = parent ? parent.groupId ?? null : requestedGroupId;
    const now = Date.now();
    const dueAt = typeof options?.dueAt === "number" ? options.dueAt : null;
    const dueEndAt =
      dueAt != null &&
      typeof options?.dueEndAt === "number" &&
      options.dueEndAt > dueAt
        ? options.dueEndAt
        : null;
    const item: TodoItem = {
      id: newId("item"),
      listId,
      content: text,
      status: "pending",
      dueAt,
      dueEndAt,
      reminderEnabled: dueAt != null && options?.reminderEnabled === true,
      parentId,
      groupId,
      predecessorId: null,
      marked: false,
      order: topItemOrder(get().items, listId, parentId, groupId),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      note: "",
      deletedAt: null,
      tags: [],
      priority: null,
      progress: 0,
    };
    const before = createTodoHistorySnapshot(get());
    set((s) => ({ items: [...s.items, item] }));
    commitTodoMutation(get, before);
    return item;
  },

  updateItem: (id, patch) => {
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items.map((it) => {
        if (it.id !== id) return it;
        const next: TodoItem = {
          ...it,
          ...patch,
          progress:
            patch.progress !== undefined
              ? clampProgress(patch.progress)
              : it.progress,
          updatedAt: Date.now(),
        };
        if (next.status === "completed" && isTodoCompletionBlocked(next, s.items)) {
          return {
            ...next,
            status: "pending",
            progress: Math.min(next.progress, 99),
            completedAt: null,
          };
        }
        return next;
      }),
    }));
    commitTodoMutation(get, before);
  },

  setStatus: (id, status) => {
    const current = get().items.find((x) => x.id === id);
    if (!current) return;
    const now = Date.now();
    const before = createTodoHistorySnapshot(get());
    set((s) => {
      const ids =
        status === "completed" || status === "pending"
          ? collectDescendantIds(s.items, id)
          : new Set<string>([id]);
      const items = s.items.map((item) =>
        ids.has(item.id) && item.deletedAt == null
          ? status === "completed" && isTodoCompletionBlocked(item, s.items)
            ? item
            : withStatus(item, status, now)
          : item,
      );
      return { items };
    });
    commitTodoMutation(get, before);
  },

  setItemsStatus: (ids, status) => {
    const roots = Array.from(new Set(ids)).filter((id) =>
      get().items.some((item) => item.id === id && item.deletedAt == null),
    );
    if (roots.length === 0) return;
    const now = Date.now();
    const before = createTodoHistorySnapshot(get());
    set((s) => {
      const targetIds = new Set<string>();
      for (const id of roots) {
        if (status === "completed" || status === "pending") {
          for (const descendantId of collectDescendantIds(s.items, id)) {
            targetIds.add(descendantId);
          }
        } else {
          targetIds.add(id);
        }
      }
      return {
        items: s.items.map((item) =>
          targetIds.has(item.id) && item.deletedAt == null
            ? status === "completed" && isTodoCompletionBlocked(item, s.items)
              ? item
              : withStatus(item, status, now)
            : item,
        ),
      };
    });
    commitTodoMutation(get, before);
  },

  cycleStatus: (id) => {
    const it = get().items.find((x) => x.id === id);
    if (!it) return;
    const next: TodoStatus = it.status === "pending" ? "completed" : "pending";
    get().setStatus(id, next);
  },

  toggleMarked: (id) => {
    const it = get().items.find((x) => x.id === id);
    if (!it) return;
    get().updateItem(id, { marked: !it.marked });
  },

  setDueAt: (id, dueAt) => {
    get().updateItem(id, { dueAt, dueEndAt: null, reminderEnabled: false });
  },

  setDueRange: (id, dueAt, dueEndAt, reminderEnabled) => {
    const patch: Partial<Omit<TodoItem, "id" | "createdAt">> = {
      dueAt,
      dueEndAt: dueAt != null && dueEndAt != null && dueEndAt > dueAt ? dueEndAt : null,
    };
    if (dueAt == null) {
      patch.reminderEnabled = false;
    } else if (reminderEnabled !== undefined) {
      patch.reminderEnabled = reminderEnabled;
    }
    get().updateItem(id, patch);
  },

  setNote: (id, note) => {
    get().updateItem(id, { note });
  },

  addTag: (id, tag) => {
    const t = tag.trim();
    if (!t) return;
    const it = get().items.find((x) => x.id === id);
    if (!it) return;
    if (it.tags.includes(t)) return;
    get().updateItem(id, { tags: [...it.tags, t] });
  },

  removeTag: (id, tag) => {
    const it = get().items.find((x) => x.id === id);
    if (!it) return;
    get().updateItem(id, { tags: it.tags.filter((x) => x !== tag) });
  },

  setTags: (id, tags) => {
    const cleaned = Array.from(
      new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0)),
    );
    get().updateItem(id, { tags: cleaned });
  },

  renameTag: (oldTag, newTag) => {
    const from = oldTag.trim();
    const to = newTag.trim();
    if (!from || !to || from === to) return;
    const now = Date.now();
    set((s) => ({
      items: s.items.map((item) => {
        if (!item.tags.includes(from)) return item;
        const tags = Array.from(
          new Set(item.tags.map((tag) => (tag === from ? to : tag))),
        );
        return { ...item, tags, updatedAt: now };
      }),
      selectedFilter:
        s.selectedFilter.kind === "tag" && s.selectedFilter.tag === from
          ? { kind: "tag", tag: to }
          : s.selectedFilter,
      detailFilter:
        s.detailFilter.kind === "tag" && s.detailFilter.tag === from
          ? { kind: "tag", tag: to }
          : s.detailFilter,
      advancedFilter:
        s.advancedFilter.tag === from ? { ...s.advancedFilter, tag: to } : s.advancedFilter,
      customFilters: s.customFilters.map((filter) =>
        filter.criteria.tag === from
          ? {
              ...filter,
              criteria: { ...filter.criteria, tag: to },
              updatedAt: now,
            }
          : filter,
      ),
    }));
    scheduleSave(get);
  },

  deleteTag: (tag) => {
    const target = tag.trim();
    if (!target) return;
    const now = Date.now();
    set((s) => ({
      items: s.items.map((item) =>
        item.tags.includes(target)
          ? {
              ...item,
              tags: item.tags.filter((entry) => entry !== target),
              updatedAt: now,
            }
          : item,
      ),
      selectedFilter:
        s.selectedFilter.kind === "tag" && s.selectedFilter.tag === target
          ? { kind: "today" }
          : s.selectedFilter,
      detailFilter:
        s.detailFilter.kind === "tag" && s.detailFilter.tag === target
          ? { kind: "all" }
          : s.detailFilter,
      advancedFilter:
        s.advancedFilter.tag === target
          ? { ...s.advancedFilter, tag: "all" }
          : s.advancedFilter,
      customFilters: s.customFilters.map((filter) =>
        filter.criteria.tag === target
          ? {
              ...filter,
              criteria: { ...filter.criteria, tag: "all" },
              updatedAt: now,
            }
          : filter,
      ),
    }));
    scheduleSave(get);
  },

  deleteItem: (id) => {
    const now = Date.now();
    const ids = collectDescendantIds(get().items, id);
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items.map((it) =>
        ids.has(it.id)
          ? { ...it, deletedAt: now, updatedAt: now }
          : ids.has(it.predecessorId ?? "")
            ? { ...it, predecessorId: null, updatedAt: now }
            : it,
      ),
      selectedItemId:
        s.selectedItemId != null && ids.has(s.selectedItemId) ? null : s.selectedItemId,
      multiSelectedItemIds: s.multiSelectedItemIds.filter((selectedId) => !ids.has(selectedId)),
    }));
    commitTodoMutation(get, before);
  },

  deleteItems: (ids) => {
    const roots = Array.from(new Set(ids)).filter((id) =>
      get().items.some((item) => item.id === id && item.deletedAt == null),
    );
    if (roots.length === 0) return;
    const now = Date.now();
    const targetIds = new Set<string>();
    for (const id of roots) {
      for (const descendantId of collectDescendantIds(get().items, id)) {
        targetIds.add(descendantId);
      }
    }
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items.map((item) =>
        targetIds.has(item.id)
          ? { ...item, deletedAt: now, updatedAt: now }
          : targetIds.has(item.predecessorId ?? "")
            ? { ...item, predecessorId: null, updatedAt: now }
            : item,
      ),
      selectedItemId:
        s.selectedItemId != null && targetIds.has(s.selectedItemId) ? null : s.selectedItemId,
      multiSelectedItemIds: s.multiSelectedItemIds.filter((id) => !targetIds.has(id)),
    }));
    commitTodoMutation(get, before);
  },

  restoreItem: (id) => {
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items.map((it) =>
        it.id === id ? { ...it, deletedAt: null, updatedAt: Date.now() } : it,
      ),
    }));
    commitTodoMutation(get, before);
  },

  purgeItem: (id) => {
    const ids = collectDescendantIds(get().items, id);
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items
        .filter((it) => !ids.has(it.id))
        .map((it) =>
          ids.has(it.predecessorId ?? "")
            ? { ...it, predecessorId: null, updatedAt: Date.now() }
            : it,
        ),
      selectedItemId:
        s.selectedItemId != null && ids.has(s.selectedItemId) ? null : s.selectedItemId,
      multiSelectedItemIds: s.multiSelectedItemIds.filter((selectedId) => !ids.has(selectedId)),
    }));
    commitTodoMutation(get, before);
  },

  purgeAllTrash: () => {
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items
        .filter((it) => it.deletedAt == null)
        .map((it) => {
          const predecessor = it.predecessorId
            ? s.items.find((entry) => entry.id === it.predecessorId)
            : null;
          return predecessor?.deletedAt != null
            ? { ...it, predecessorId: null, updatedAt: Date.now() }
            : it;
        }),
      selectedItemId: null,
      multiSelectedItemIds: [],
    }));
    commitTodoMutation(get, before);
  },

  copyItem: (id, toListId) => {
    const src = get().items.find((x) => x.id === id);
    if (!src) return;
    const groupId =
      toListId === src.listId &&
      src.groupId != null &&
      get().groups.some((group) => group.id === src.groupId && group.listId === toListId)
        ? src.groupId
        : null;
    const now = Date.now();
    const dup: TodoItem = {
      ...src,
      id: newId("item"),
      listId: toListId,
      parentId: toListId === src.listId ? src.parentId : null,
      groupId,
      order: nextItemOrder(
        get().items,
        toListId,
        toListId === src.listId ? src.parentId : null,
        groupId,
      ),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      progress: clampProgress(src.progress),
    };
    const before = createTodoHistorySnapshot(get());
    set((s) => ({ items: [...s.items, dup] }));
    commitTodoMutation(get, before);
  },

  moveItem: (id, toListId) => {
    const ids = collectDescendantIds(get().items, id);
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items.map((it) =>
        ids.has(it.id)
          ? {
              ...it,
              listId: toListId,
              parentId:
                it.id === id && toListId !== it.listId ? null : it.parentId,
              groupId: toListId === it.listId ? it.groupId : null,
              order:
                it.id === id
                  ? nextItemOrder(
                      s.items,
                      toListId,
                      toListId === it.listId ? it.parentId : null,
                      toListId === it.listId ? it.groupId : null,
                    )
                  : it.order,
              updatedAt: Date.now(),
            }
          : it,
      ),
    }));
    commitTodoMutation(get, before);
  },

  setItemGroup: (id, groupId) => {
    const root = get().items.find((item) => item.id === id);
    if (!root) return;
    const normalizedGroupId =
      groupId != null &&
      get().groups.some((group) => group.id === groupId && group.listId === root.listId)
        ? groupId
        : null;
    const ids = collectDescendantIds(get().items, id);
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items.map((item) =>
        ids.has(item.id)
          ? {
              ...item,
              parentId: item.id === id ? null : item.parentId,
              groupId: normalizedGroupId,
              updatedAt: Date.now(),
            }
          : item,
      ),
    }));
    commitTodoMutation(get, before);
  },

  setItemPredecessor: (id, predecessorId) => {
    const items = get().items;
    const target = items.find((item) => item.id === id && item.deletedAt == null);
    if (!target) return;
    const normalizedPredecessorId =
      predecessorId != null &&
      predecessorId !== id &&
      items.some(
        (item) =>
          item.id === predecessorId &&
          item.deletedAt == null &&
          item.status === "pending",
      ) &&
      !wouldCreatePredecessorCycle(items, id, predecessorId)
        ? predecessorId
        : null;
    const before = createTodoHistorySnapshot(get());
    set((s) => {
      const predecessor =
        normalizedPredecessorId != null
          ? s.items.find((item) => item.id === normalizedPredecessorId)
          : null;
      const shouldReopenCompleted =
        predecessor != null &&
        predecessor.status !== "completed" &&
        target.status === "completed";
      const now = Date.now();
      return {
        items: s.items.map((item) =>
          item.id === id
            ? {
                ...item,
                predecessorId: normalizedPredecessorId,
                status: shouldReopenCompleted ? "pending" : item.status,
                progress: shouldReopenCompleted ? Math.min(item.progress, 99) : item.progress,
                completedAt: shouldReopenCompleted ? null : item.completedAt,
                updatedAt: now,
              }
            : item,
        ),
      };
    });
    commitTodoMutation(get, before);
  },

  reorderItem: (id, newOrder) => {
    const before = createTodoHistorySnapshot(get());
    set((s) => ({
      items: s.items.map((it) =>
        it.id === id ? { ...it, order: newOrder, updatedAt: Date.now() } : it,
      ),
    }));
    commitTodoMutation(get, before);
  },

  flush: async () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
      const { folders, lists, groups, items, customFilters, defaultListId } = get();
      const data: TodoData = {
        version: 2,
        folders,
        lists,
        groups,
        items,
        customFilters,
        defaultListId: defaultListId ?? null,
      };
      pendingPromise = saveTodoData(data).catch((err) => {
        console.error("[todo] flush save failed:", err);
      });
    }
    if (pendingPromise) {
      await pendingPromise;
      pendingPromise = null;
    }
  },
}));

// Helper: reorder via midpoint between neighbors. Returns the new order
// value to feed into `reorderItem`. Pass null for either neighbor if the
// drop is at the top/bottom of the list.
export function midpointOrder(
  before: { order: number } | null,
  after: { order: number } | null,
): number {
  if (before && after) return (before.order + after.order) / 2;
  if (before) return before.order + ORDER_STEP;
  if (after) return after.order - ORDER_STEP;
  return ORDER_STEP;
}

// Filtering — returns items grouped & sorted for the selected filter.
// Trashed items are hidden from every filter EXCEPT `kind: "trash"`.
export function applyFilter(
  items: TodoItem[],
  filter: TodoFilter,
  showCompleted: boolean,
  lists: TodoList[] = [],
  advancedFilter: AdvancedTodoFilter = DEFAULT_ADVANCED_FILTER,
  customFilters: SavedTodoFilter[] = [],
): TodoItem[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const endOfToday = startOfToday + 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  // Trash filter is special — show ONLY soft-deleted items, ordered by
  // deletion time (most recent first).
  if (filter.kind === "trash") {
    return items
      .filter((it) => it.deletedAt != null)
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  }

  // Every other filter excludes the trash.
  const archivedListIds = new Set(
    lists.filter((l) => l.archivedAt != null).map((l) => l.id),
  );
  let scoped = items.filter((it) => it.deletedAt == null);
  if (filter.kind !== "list") {
    scoped = scoped.filter((it) => !archivedListIds.has(it.listId));
  }
  // Virtual cross-list views can include both pending and completed tasks.
  // Abandoned tasks stay in their dedicated archive view.
  const activeOnlyForVirtual =
    filter.kind === "today" ||
    filter.kind === "recent7" ||
    filter.kind === "inbox" ||
    filter.kind === "marked";
  if (activeOnlyForVirtual) {
    scoped = scoped.filter((it) => it.status !== "abandoned");
  }
  switch (filter.kind) {
    case "folder": {
      const folderListIds = new Set(
        lists
          .filter((list) => list.folderId === filter.id && list.archivedAt == null)
          .map((list) => list.id),
      );
      scoped = scoped.filter((it) => folderListIds.has(it.listId));
      break;
    }
    case "list":
      scoped = scoped.filter((it) => it.listId === filter.id);
      break;
    case "today":
      scoped = scoped.filter((it) => dueRangeOverlaps(it, startOfToday, endOfToday));
      break;
    case "recent7":
      scoped = scoped.filter((it) => it.updatedAt >= sevenDaysAgo);
      break;
    case "inbox": {
      const inbox = findInboxList(lists);
      scoped = inbox ? scoped.filter((it) => it.listId === inbox.id) : [];
      break;
    }
    case "marked":
      scoped = scoped.filter((it) => it.marked);
      break;
    case "tag":
      scoped = scoped.filter((it) => it.tags.includes(filter.tag));
      break;
    case "advanced":
      scoped = applyAdvancedCriteria(scoped, advancedFilter);
      break;
    case "customFilter": {
      const customFilter = customFilters.find((entry) => entry.id === filter.id);
      scoped = customFilter ? applyAdvancedCriteria(scoped, customFilter.criteria) : [];
      break;
    }
    case "quadrant":
      scoped = scoped.filter((it) => it.status === "pending");
      break;
    case "calendar":
      scoped = scoped.filter((it) => it.dueAt != null && it.status !== "abandoned");
      break;
    case "completed":
      scoped = scoped.filter(
        (it) => it.status === "completed" && isFullyCompletedSubtreeItem(it, scoped),
      );
      break;
    case "abandoned":
      scoped = scoped.filter((it) => it.status === "abandoned");
      break;
  }
  if (
    !showCompleted &&
    filter.kind !== "completed" &&
    filter.kind !== "abandoned" &&
    filter.kind !== "folder" &&
    filter.kind !== "list" &&
    filter.kind !== "calendar" &&
    filter.kind !== "tag" &&
    filter.kind !== "advanced" &&
    filter.kind !== "customFilter"
  ) {
    // For real lists, completed/abandoned tasks are folded into accordion
    // groups in TodoDetail and never disappear via this toggle. The toggle
    // only affects virtual filters (today / recent7 / inbox / marked).
    scoped = scoped.filter((it) => it.status !== "completed");
  }
  if (filter.kind === "list") {
    // Within a real list: pending first (manual order), then completed,
    // then abandoned. New items always land at the top of the pending
    // section instead of dropping below stale completed/abandoned tasks.
    const rank = (s: TodoItem["status"]) =>
      s === "pending" ? 0 : s === "completed" ? 1 : 2;
    return [...scoped].sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return a.order - b.order;
    });
  }
  if (filter.kind === "folder") {
    const listOrder = new Map(lists.map((list) => [list.id, list.order]));
    return [...scoped].sort((a, b) => {
      const listDelta =
        (listOrder.get(a.listId) ?? Number.MAX_SAFE_INTEGER) -
        (listOrder.get(b.listId) ?? Number.MAX_SAFE_INTEGER);
      if (listDelta !== 0) return listDelta;
      if (a.status !== b.status) {
        const rank = (s: TodoItem["status"]) =>
          s === "pending" ? 0 : s === "completed" ? 1 : 2;
        return rank(a.status) - rank(b.status);
      }
      return a.order - b.order;
    });
  }
  // Virtual filters: order by dueAt asc (nulls last), then by updatedAt desc.
  return [...scoped].sort((a, b) => {
    if (a.dueAt != null && b.dueAt != null) return a.dueAt - b.dueAt;
    if (a.dueAt != null) return -1;
    if (b.dueAt != null) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

// Item count for a sidebar entry — used by the badge chips. Pending only
// (so completed-list count = total completed, abandoned-list count =
// total abandoned, trash count = total trashed).
export function countForFilter(
  items: TodoItem[],
  filter: TodoFilter,
  lists: TodoList[] = [],
  advancedFilter: AdvancedTodoFilter = DEFAULT_ADVANCED_FILTER,
  customFilters: SavedTodoFilter[] = [],
): number {
  const list = applyFilter(items, filter, true, lists, advancedFilter, customFilters);
  switch (filter.kind) {
    case "calendar":
    case "tag":
    case "advanced":
    case "customFilter":
    case "completed":
    case "abandoned":
    case "trash":
      return list.length;
    default:
      return list.filter((it) => it.status === "pending").length;
  }
}

// Apply the secondary detail-pane filter on top of an already-filtered
// item list. `kind: "all"` is a no-op. Date buckets ignore items with a
// null dueAt (except `noDue`, which is the exact opposite).
export function applyDetailFilter(items: TodoItem[], detail: DetailFilter): TodoItem[] {
  if (detail.kind === "all") return items;
  const now = new Date();
  const startOfToday = startOfLocalDay(now);
  const endOfToday = startOfToday + DAY_MS;
  const [startOfWeek, endOfWeek] = localWeekRange(now);
  switch (detail.kind) {
    case "overdue":
      return items.filter((it) => dueRangeEndsBefore(it, startOfToday));
    case "today":
      return items.filter((it) => dueRangeOverlaps(it, startOfToday, endOfToday));
    case "thisWeek":
      return items.filter((it) => dueRangeOverlaps(it, startOfWeek, endOfWeek));
    case "noDue":
      return items.filter((it) => it.dueAt == null);
    case "tag":
      return items.filter((it) => it.tags.includes(detail.tag));
  }
}

// Collect every unique tag across non-trashed items, sorted alphabetically.
export function collectAllTags(items: TodoItem[]): string[] {
  const seen = new Set<string>();
  for (const it of items) {
    if (it.deletedAt != null) continue;
    for (const t of it.tags) seen.add(t);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function getTodoDepth(item: TodoItem, allItems: TodoItem[]): number {
  const byId = new Map(allItems.map((it) => [it.id, it]));
  let depth = 0;
  let parentId = item.parentId;
  const seen = new Set<string>([item.id]);
  while (parentId != null && depth < 8) {
    const parent = byId.get(parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

export function orderTodoItemsHierarchically(
  items: TodoItem[],
  allItems: TodoItem[] = items,
): TodoItem[] {
  const visibleIds = new Set(items.map((item) => item.id));
  const childrenByParent = new Map<string | null, TodoItem[]>();
  const byId = new Map(allItems.map((item) => [item.id, item]));

  for (const item of items) {
    const parent =
      item.parentId != null && visibleIds.has(item.parentId)
        ? byId.get(item.parentId)
        : null;
    const parentKey =
      parent && parent.listId === item.listId && parent.deletedAt == null
        ? parent.id
        : null;
    const bucket = childrenByParent.get(parentKey) ?? [];
    bucket.push(item);
    childrenByParent.set(parentKey, bucket);
  }

  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => a.order - b.order);
  }

  const ordered: TodoItem[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null) => {
    for (const item of childrenByParent.get(parentId) ?? []) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      ordered.push(item);
      visit(item.id);
    }
  };

  visit(null);
  for (const item of items) {
    if (!visited.has(item.id)) ordered.push(item);
  }
  return ordered;
}
