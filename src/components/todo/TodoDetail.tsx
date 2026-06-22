// Right-side detail pane — header (emoji + name + filter) + add-task
// input + sortable task list. Tasks support drag-reorder via @dnd-kit
// when viewing a real list; virtual filters (today/recent7/inbox/marked) sort
// by dueAt/updatedAt and disable dnd.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Box,
  Button,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  HoverCountActionSlot,
  hoverCountActionParentSx,
} from "./TodoHoverActionSlot";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import AlarmRoundedIcon from "@mui/icons-material/AlarmRounded";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import OutlinedFlagRoundedIcon from "@mui/icons-material/OutlinedFlagRounded";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import DeleteSweepRoundedIcon from "@mui/icons-material/DeleteSweepRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import EventBusyRoundedIcon from "@mui/icons-material/EventBusyRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import DateRangeRoundedIcon from "@mui/icons-material/DateRangeRounded";
import EventAvailableRoundedIcon from "@mui/icons-material/EventAvailableRounded";
import LabelRoundedIcon from "@mui/icons-material/LabelRounded";
import DoneRoundedIcon from "@mui/icons-material/DoneRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import SubjectRoundedIcon from "@mui/icons-material/SubjectRounded";
import SortRoundedIcon from "@mui/icons-material/SortRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import ViewKanbanRoundedIcon from "@mui/icons-material/ViewKanbanRounded";
import ViewTimelineRoundedIcon from "@mui/icons-material/ViewTimelineRounded";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import { PickerDay, type PickerDayProps } from "@mui/x-date-pickers/PickerDay";
import dayjs, { type Dayjs } from "dayjs";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  DEFAULT_ADVANCED_FILTER,
  useTodoStore,
  isInboxList,
  midpointOrder,
  applyFilter,
  applyDetailFilter,
  collectAllTags,
  orderTodoItemsHierarchically,
} from "./useTodoStore";
import type {
  AdvancedTodoFilter,
  DetailFilter,
  SavedTodoFilter,
  TodoFilter,
  TodoFolder,
  TodoGroup,
  TodoList,
  TodoItem as TodoItemT,
  TodoPriority,
} from "./types";
import {
  TodoItem,
  type TodoItemContextPathPart,
  type TodoItemContextTarget,
} from "./TodoItem";
import { DueDatePopover } from "./DueDatePopover";
import { QuadrantView } from "./QuadrantView";
import { TodoBoardView, type TodoBoardSection } from "./TodoBoardView";
import { TodoTimelineView, type TodoTimelineEntry } from "./TodoTimelineView";
import { TodoEmoji } from "./TodoEmoji";
import { TODO_PRIORITY_OPTIONS, priorityMeta } from "./priority";
import {
  parseTodoTimeText,
  type TodoTimeParseResult,
  type TodoTimeParseSpan,
} from "./todoIpc";
import { consumeLastTodoExternalDrop } from "./todoCalendarDrag";
import { useStore } from "../../state/store";

interface DetailProps {
  isDark: boolean;
}

const DEFAULT_DRAFT_PRIORITY: TodoPriority | null = null;
const TODO_DRAG_INDENT_PX = 20;
type ActiveDragKind = "group" | "todo";
type TodoDetailViewMode = "list" | "board" | "timeline";
const MAX_TODO_DRAG_DEPTH = 8;

type CompletedArchiveSortField = "priority" | "dueAt" | "marked" | "completedAt";
type CompletedArchiveSortDirection = "asc" | "desc";

interface CompletedArchiveSort {
  field: CompletedArchiveSortField;
  direction: CompletedArchiveSortDirection;
}

const DEFAULT_COMPLETED_ARCHIVE_SORT: CompletedArchiveSort = {
  field: "completedAt",
  direction: "desc",
};

const COMPLETED_ARCHIVE_SORT_FIELDS: Array<{
  field: CompletedArchiveSortField;
  label: string;
}> = [
  { field: "priority", label: "任务优先级" },
  { field: "dueAt", label: "截止时间" },
  { field: "marked", label: "是否标记" },
  { field: "completedAt", label: "完成时间" },
];

const PRIORITY_SORT_RANK = new Map<TodoPriority, number>(
  TODO_PRIORITY_OPTIONS.map((option, index) => [option.value, index]),
);

function collectLocalDescendantIds(items: TodoItemT[], rootId: string): Set<string> {
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

function completedTimestamp(item: TodoItemT): number | null {
  return item.completedAt ?? (item.status === "completed" ? item.updatedAt : null);
}

function compareNullableNumber(
  a: number | null,
  b: number | null,
  direction: CompletedArchiveSortDirection,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function compareCompletedArchiveItems(
  a: TodoItemT,
  b: TodoItemT,
  sort: CompletedArchiveSort,
): number {
  const direction = sort.direction;
  let result = 0;
  switch (sort.field) {
    case "priority":
      result =
        (a.priority == null
          ? Number.MAX_SAFE_INTEGER
          : (PRIORITY_SORT_RANK.get(a.priority) ?? Number.MAX_SAFE_INTEGER)) -
        (b.priority == null
          ? Number.MAX_SAFE_INTEGER
          : (PRIORITY_SORT_RANK.get(b.priority) ?? Number.MAX_SAFE_INTEGER));
      result = direction === "asc" ? result : -result;
      break;
    case "dueAt":
      result = compareNullableNumber(a.dueAt, b.dueAt, direction);
      break;
    case "marked":
      result = (a.marked ? 1 : 0) - (b.marked ? 1 : 0);
      result = direction === "asc" ? result : -result;
      break;
    case "completedAt":
      result = compareNullableNumber(completedTimestamp(a), completedTimestamp(b), direction);
      break;
  }
  if (result !== 0) return result;

  const completedResult = compareNullableNumber(completedTimestamp(a), completedTimestamp(b), "desc");
  if (completedResult !== 0) return completedResult;
  if (a.order !== b.order) return a.order - b.order;
  return a.createdAt - b.createdAt;
}

function orderCompletedArchiveItems(
  sourceItems: TodoItemT[],
  allItems: TodoItemT[],
  sort: CompletedArchiveSort,
): TodoItemT[] {
  const visibleIds = new Set(sourceItems.map((item) => item.id));
  const byId = new Map(allItems.map((item) => [item.id, item]));
  const childrenByParent = new Map<string | null, TodoItemT[]>();

  for (const item of sourceItems) {
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
    bucket.sort((a, b) => compareCompletedArchiveItems(a, b, sort));
  }

  const ordered: TodoItemT[] = [];
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
  for (const item of sourceItems) {
    if (!visited.has(item.id)) ordered.push(item);
  }
  return ordered;
}

function startOfLocalDayMs(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatExportDate(ts: number): string {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatExportMonthDay(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatExportTime(ts: number): string {
  const date = new Date(ts);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function hasExplicitTime(ts: number): boolean {
  const date = new Date(ts);
  return date.getHours() !== 0 || date.getMinutes() !== 0;
}

function exportDateForItem(item: TodoItemT): number {
  return startOfLocalDayMs(item.dueAt ?? item.updatedAt ?? item.createdAt);
}

function plainTaskTitle(item: TodoItemT): string {
  return item.content.trim().replace(/\s+/g, " ") || "未命名任务";
}

function plainTaskSummary(item: TodoItemT): string {
  return plainTaskTitle(item);
}

function formatNumberedTasks(items: TodoItemT[]): string {
  return items
    .map((item, index) => `${index + 1}.${plainTaskSummary(item)}`)
    .join("  ");
}

function formatTaskChecklistLine(
  item: TodoItemT,
  todoDepthById: Map<string, number>,
  dueMode: "time" | "dateTime",
): string {
  const statusMark = item.status === "completed" ? "[x]" : "[ ]";
  const depth = Math.min(Math.max(todoDepthById.get(item.id) ?? 0, 0), 6);
  const indent = "  ".repeat(depth);
  const dueSuffix =
    item.dueAt == null
      ? ""
      : dueMode === "time"
        ? hasExplicitTime(item.dueAt)
          ? ` ${formatExportTime(item.dueAt)}`
          : ""
        : ` ${formatExportDate(item.dueAt)}${
            hasExplicitTime(item.dueAt) ? ` ${formatExportTime(item.dueAt)}` : ""
          }`;
  return `${indent}- ${statusMark} ${plainTaskTitle(item)}${dueSuffix}`;
}

function buildRecent7WorkChecklist(
  sourceItems: TodoItemT[],
  lists: TodoList[],
  todoDepthById: Map<string, number>,
): string {
  const exportItems = sourceItems.filter((item) => item.deletedAt == null);
  if (exportItems.length === 0) return "";

  const indexById = new Map(sourceItems.map((item, index) => [item.id, index]));
  const listById = new Map(lists.map((list) => [list.id, list]));
  const listOrderById = new Map(lists.map((list) => [list.id, list.order]));
  const sortedItems = [...exportItems].sort((a, b) => {
    const dayDelta = exportDateForItem(a) - exportDateForItem(b);
    if (dayDelta !== 0) return dayDelta;
    const listDelta =
      (listOrderById.get(a.listId) ?? Number.MAX_SAFE_INTEGER) -
      (listOrderById.get(b.listId) ?? Number.MAX_SAFE_INTEGER);
    if (listDelta !== 0) return listDelta;
    return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
  });

  const lines = ["最近7天工作清单"];
  let currentDate = "";
  let currentListId = "";
  for (const item of sortedItems) {
    const dateKey = formatExportDate(exportDateForItem(item));
    if (dateKey !== currentDate) {
      if (lines.length > 1) lines.push("");
      lines.push(`${dateKey}`);
      currentDate = dateKey;
      currentListId = "";
    }

    if (item.listId !== currentListId) {
      const listName = listById.get(item.listId)?.name ?? "未知清单";
      lines.push(`${listName}`);
      currentListId = item.listId;
    }

    lines.push(formatTaskChecklistLine(item, todoDepthById, "time"));
  }

  return lines.join("\n");
}

function midpointGroupOrder(
  before: TodoGroup | null,
  after: TodoGroup | null,
): number {
  if (before && after) return (before.order + after.order) / 2;
  if (before) return before.order + 1024;
  if (after) return after.order - 1024;
  return 1024;
}

function effectiveGroupIdForItem(
  item: TodoItemT,
  itemById: Map<string, TodoItemT>,
  validGroupIds: Set<string>,
): string | null {
  let root = item;
  let parentId = item.parentId;
  const seen = new Set<string>([item.id]);
  while (parentId != null) {
    const parent = itemById.get(parentId);
    if (!parent || parent.listId !== item.listId || seen.has(parent.id)) break;
    seen.add(parent.id);
    root = parent;
    parentId = parent.parentId;
  }
  const groupId = root.groupId ?? item.groupId ?? null;
  return groupId != null && validGroupIds.has(groupId) ? groupId : null;
}

function buildDateTaskSummary(
  sourceItems: TodoItemT[],
): string {
  const exportItems = sourceItems.filter((item) => item.deletedAt == null);
  if (exportItems.length === 0) return "";

  const indexById = new Map(sourceItems.map((item, index) => [item.id, index]));
  const sortedItems = [...exportItems].sort((a, b) => {
    const aDay = a.dueAt == null ? Number.MAX_SAFE_INTEGER : startOfLocalDayMs(a.dueAt);
    const bDay = b.dueAt == null ? Number.MAX_SAFE_INTEGER : startOfLocalDayMs(b.dueAt);
    if (aDay !== bDay) return aDay - bDay;
    if (a.dueAt != null && b.dueAt != null && a.dueAt !== b.dueAt) {
      return a.dueAt - b.dueAt;
    }
    return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
  });

  const dateBuckets = new Map<number, TodoItemT[]>();
  const undatedItems: TodoItemT[] = [];
  for (const item of sortedItems) {
    if (item.dueAt == null) {
      undatedItems.push(item);
      continue;
    }
    const day = startOfLocalDayMs(item.dueAt);
    const bucket = dateBuckets.get(day) ?? [];
    bucket.push(item);
    dateBuckets.set(day, bucket);
  }

  const parts: string[] = [];
  for (const [day, bucket] of dateBuckets) {
    parts.push(`${formatExportMonthDay(day)}工作任务：${formatNumberedTasks(bucket)}`);
  }
  if (undatedItems.length > 0) {
    parts.push(`后续工作任务：${formatNumberedTasks(undatedItems)}`);
  }

  return parts.join("  ");
}

function buildListDetailChecklist(
  list: TodoList,
  sourceItems: TodoItemT[],
): string {
  return buildDateTaskSummary(
    sourceItems.filter((item) => item.listId === list.id),
  );
}

interface TodoGroupSectionData {
  key: string;
  group: TodoGroup | null;
  title: string;
  items: TodoItemT[];
  itemCount: number;
}

interface TodoFolderListSectionData {
  list: TodoList;
  groups: TodoGroupSectionData[];
  itemCount: number;
}

interface CompletedTodoContext {
  path: TodoItemContextPathPart[];
  tooltip: string;
}

function labelWithEmoji(emoji: string | null | undefined, name: string): string {
  return `${emoji ?? ""} ${name}`.trim() || name || "未命名";
}

function parentTodoPath(
  item: TodoItemT,
  itemById: Map<string, TodoItemT>,
): TodoItemT[] {
  const parents: TodoItemT[] = [];
  const seen = new Set<string>([item.id]);
  let parentId = item.parentId;

  while (parentId != null && parents.length < MAX_TODO_DRAG_DEPTH) {
    const parent = itemById.get(parentId);
    if (!parent || parent.listId !== item.listId || seen.has(parent.id)) break;
    seen.add(parent.id);
    parents.unshift(parent);
    parentId = parent.parentId;
  }

  return parents;
}

function effectiveContextGroup(
  item: TodoItemT,
  itemById: Map<string, TodoItemT>,
  groupById: Map<string, TodoGroup>,
): TodoGroup | null {
  let root = item;
  const seen = new Set<string>([item.id]);
  let parentId = item.parentId;

  while (parentId != null) {
    const parent = itemById.get(parentId);
    if (!parent || parent.listId !== item.listId || seen.has(parent.id)) break;
    seen.add(parent.id);
    root = parent;
    parentId = parent.parentId;
  }

  const groupId = root.groupId ?? item.groupId ?? null;
  const group = groupId ? groupById.get(groupId) : null;
  return group && group.listId === item.listId ? group : null;
}

function buildCompletedTodoContext(
  item: TodoItemT,
  maps: {
    folderById: Map<string, TodoFolder>;
    groupById: Map<string, TodoGroup>;
    itemById: Map<string, TodoItemT>;
    listById: Map<string, TodoList>;
  },
): CompletedTodoContext {
  const list = maps.listById.get(item.listId) ?? null;
  const folder = list?.folderId ? maps.folderById.get(list.folderId) ?? null : null;
  const group = effectiveContextGroup(item, maps.itemById, maps.groupById);
  const path: TodoItemContextPathPart[] = [];

  if (folder) {
    path.push({
      key: `folder:${folder.id}`,
      label: labelWithEmoji(folder.emoji, folder.name),
      target: { kind: "folder", id: folder.id },
    });
  }

  if (list) {
    path.push({
      key: `list:${list.id}`,
      label: labelWithEmoji(list.emoji, list.name),
      target: { kind: "list", id: list.id },
    });
  } else {
    path.push({ key: `list:${item.listId}`, label: "未知清单" });
  }

  if (group && list) {
    path.push({
      key: `group:${group.id}`,
      label: group.name,
      target: { kind: "group", id: group.id, listId: list.id },
    });
  }

  for (const parent of parentTodoPath(item, maps.itemById)) {
    path.push({
      key: `todo:${parent.id}`,
      label: plainTaskTitle(parent),
    });
  }

  const meta = path.map((part) => part.label).join(" / ");
  return { path, tooltip: `归属：${meta}` };
}

export function TodoDetail({ isDark }: DetailProps) {
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const groups = useTodoStore((s) => s.groups);
  const items = useTodoStore((s) => s.items);
  const selectedFilter = useTodoStore((s) => s.selectedFilter);
  const advancedFilter = useTodoStore((s) => s.advancedFilter);
  const setAdvancedFilter = useTodoStore((s) => s.setAdvancedFilter);
  const resetAdvancedFilter = useTodoStore((s) => s.resetAdvancedFilter);
  const customFilters = useTodoStore((s) => s.customFilters);
  const addCustomFilter = useTodoStore((s) => s.addCustomFilter);
  const updateCustomFilter = useTodoStore((s) => s.updateCustomFilter);
  const detailFilter = useTodoStore((s) => s.detailFilter);
  const setDetailFilter = useTodoStore((s) => s.setDetailFilter);
  const showCompleted = useTodoStore((s) => s.showCompleted);
  const toggleShowCompleted = useTodoStore((s) => s.toggleShowCompleted);
  const addGroup = useTodoStore((s) => s.addGroup);
  const renameGroup = useTodoStore((s) => s.renameGroup);
  const renameList = useTodoStore((s) => s.renameList);
  const deleteGroup = useTodoStore((s) => s.deleteGroup);
  const reorderGroup = useTodoStore((s) => s.reorderGroup);
  const addItem = useTodoStore((s) => s.addItem);
  const setItemGroup = useTodoStore((s) => s.setItemGroup);
  const updateItem = useTodoStore((s) => s.updateItem);
  const purgeAllTrash = useTodoStore((s) => s.purgeAllTrash);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const setSelectedFilter = useTodoStore((s) => s.setSelectedFilter);
  const pushSnack = useStore((s) => s.pushSnack);

  const allTags = useMemo(() => collectAllTags(items), [items]);

  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [tagSubAnchor, setTagSubAnchor] = useState<HTMLElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, {
    // Dragging is handle-only, so a short activation distance feels more direct.
    activationConstraint: { distance: 3 },
  }));

  // Selected list reference (only when filter.kind === "list").
  const selectedList = useMemo<TodoList | null>(() => {
    if (selectedFilter.kind !== "list") return null;
    return lists.find((l) => l.id === selectedFilter.id) ?? null;
  }, [selectedFilter, lists]);
  const inboxList = useMemo<TodoList | null>(
    () => lists.find((list) => list.archivedAt == null && isInboxList(list)) ?? null,
    [lists],
  );
  const selectedFolder = useMemo<TodoFolder | null>(() => {
    if (selectedFilter.kind !== "folder") return null;
    return folders.find((folder) => folder.id === selectedFilter.id) ?? null;
  }, [folders, selectedFilter]);
  const selectedListGroups = useMemo(
    () =>
      selectedList
        ? groups
            .filter((group) => group.listId === selectedList.id)
            .sort((a, b) => a.order - b.order)
        : [],
    [groups, selectedList],
  );
  const selectedFolderLists = useMemo(
    () =>
      selectedFolder
        ? lists
            .filter(
              (list) =>
                list.folderId === selectedFolder.id && list.archivedAt == null,
            )
            .sort((a, b) => a.order - b.order)
        : [],
    [lists, selectedFolder],
  );
  const selectedCustomFilter = useMemo(() => {
    if (selectedFilter.kind !== "customFilter") return null;
    return customFilters.find((filter) => filter.id === selectedFilter.id) ?? null;
  }, [selectedFilter, customFilters]);

  const [showNotePreview, setShowNotePreview] = useState(false);
  const [detailViewMode, setDetailViewMode] =
    useState<TodoDetailViewMode>("list");
  const [completedArchiveSort, setCompletedArchiveSort] =
    useState<CompletedArchiveSort>(DEFAULT_COMPLETED_ARCHIVE_SORT);
  const [customFilterEditorOpen, setCustomFilterEditorOpen] = useState(false);
  const [customFilterDraft, setCustomFilterDraft] = useState<AdvancedTodoFilter>(
    DEFAULT_ADVANCED_FILTER,
  );
  const [saveFilterDialogOpen, setSaveFilterDialogOpen] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [groupDialog, setGroupDialog] = useState<
    | { mode: "create"; listId: string; order?: number }
    | { mode: "rename"; group: TodoGroup }
    | null
  >(null);
  const [editingListTitle, setEditingListTitle] = useState(false);
  const [listTitleDraft, setListTitleDraft] = useState("");
  const listTitleInputRef = useRef<HTMLInputElement | null>(null);
  const [groupDraftName, setGroupDraftName] = useState("");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedFolderListIds, setCollapsedFolderListIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedTodoIds, setCollapsedTodoIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingGroupJumpId, setPendingGroupJumpId] = useState<string | null>(null);
  const [activeDragKind, setActiveDragKind] =
    useState<ActiveDragKind | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragOverlayWidth, setActiveDragOverlayWidth] = useState<number | null>(null);

  useEffect(() => {
    setCustomFilterEditorOpen(false);
    setCustomFilterDraft(selectedCustomFilter?.criteria ?? DEFAULT_ADVANCED_FILTER);
  }, [selectedCustomFilter]);

  useEffect(() => {
    setEditingListTitle(false);
    setListTitleDraft("");
  }, [selectedList?.id]);

  useEffect(() => {
    if (!editingListTitle) return;
    const frame = requestAnimationFrame(() => {
      const input = listTitleInputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
    return () => cancelAnimationFrame(frame);
  }, [editingListTitle]);

  useEffect(() => {
    if (selectedFilter.kind !== "list" || !pendingGroupJumpId) return;
    const frame = requestAnimationFrame(() => {
      const target = listScrollRef.current?.querySelector<HTMLElement>(
        `[data-todo-group-id="${pendingGroupJumpId}"]`,
      );
      target?.scrollIntoView({ block: "start" });
      setPendingGroupJumpId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingGroupJumpId, selectedFilter]);

  const effectiveCustomFilters = useMemo(() => {
    if (!selectedCustomFilter || !customFilterEditorOpen) return customFilters;
    return customFilters.map((filter) =>
      filter.id === selectedCustomFilter.id
        ? { ...filter, criteria: customFilterDraft }
        : filter,
    );
  }, [customFilters, customFilterDraft, customFilterEditorOpen, selectedCustomFilter]);

  const filteredItems = useMemo(
    () =>
      applyDetailFilter(
        applyFilter(
          items,
          selectedFilter,
          showCompleted,
          lists,
          advancedFilter,
          effectiveCustomFilters,
        ),
        detailFilter,
      ),
    [
      items,
      selectedFilter,
      showCompleted,
      lists,
      advancedFilter,
      effectiveCustomFilters,
      detailFilter,
    ],
  );
  const orderedFilteredItems = useMemo(
    () => orderTodoItemsHierarchically(filteredItems, items),
    [filteredItems, items],
  );
  const draggable =
    selectedFilter.kind === "list" ||
    (selectedFilter.kind === "inbox" && inboxList != null);
  const isTrash = selectedFilter.kind === "trash";
  const isQuadrant = selectedFilter.kind === "quadrant";
  const isAdvanced = selectedFilter.kind === "advanced";
  const isCustomFilter = selectedFilter.kind === "customFilter";
  const isTagFilter = selectedFilter.kind === "tag";
  const isArchive =
    selectedFilter.kind === "completed" || selectedFilter.kind === "abandoned";
  const useBoardView = selectedFilter.kind === "list" && detailViewMode === "board";
  const canUseTimelineView =
    selectedFilter.kind !== "quadrant" &&
    selectedFilter.kind !== "calendar" &&
    selectedFilter.kind !== "trash";
  const useTimelineView = canUseTimelineView && detailViewMode === "timeline";
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const listById = useMemo(
    () => new Map(lists.map((list) => [list.id, list])),
    [lists],
  );
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  const displayItems = useMemo(() => {
    if (selectedFilter.kind === "completed") {
      return orderCompletedArchiveItems(filteredItems, items, completedArchiveSort);
    }
    if (
      selectedFilter.kind === "list" ||
      selectedFilter.kind === "folder" ||
      selectedFilter.kind === "inbox"
    ) {
      const visibleItems = filteredItems.filter((item) =>
        item.deletedAt == null &&
        item.status !== "abandoned" &&
        (showCompleted || item.status !== "completed"),
      );
      return orderTodoItemsHierarchically(visibleItems, items);
    }
    return orderedFilteredItems;
  }, [
    completedArchiveSort,
    filteredItems,
    items,
    orderedFilteredItems,
    selectedFilter,
    showCompleted,
  ]);
  const completedTodoContextById = useMemo(() => {
    if (selectedFilter.kind !== "completed") {
      return new Map<string, CompletedTodoContext>();
    }
    const maps = { folderById, groupById, itemById, listById };
    return new Map(
      displayItems.map((item) => [item.id, buildCompletedTodoContext(item, maps)]),
    );
  }, [
    displayItems,
    folderById,
    groupById,
    itemById,
    listById,
    selectedFilter,
  ]);
  const todoDepthById = useMemo(() => {
    const depthById = new Map<string, number>();
    for (const item of items) {
      let depth = 0;
      let parentId = item.parentId;
      const seen = new Set<string>([item.id]);
      while (parentId != null && depth < 8) {
        const parent = itemById.get(parentId);
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        depth += 1;
        parentId = parent.parentId;
      }
      depthById.set(item.id, depth);
    }
    return depthById;
  }, [itemById, items]);
  const visibleChildParentIds = useMemo(() => {
    const visibleIds = new Set(displayItems.map((item) => item.id));
    const parentIds = new Set<string>();
    for (const item of displayItems) {
      if (item.parentId == null || !visibleIds.has(item.parentId)) continue;
      const parent = itemById.get(item.parentId);
      if (parent && parent.listId === item.listId && parent.deletedAt == null) {
        parentIds.add(parent.id);
      }
    }
    return parentIds;
  }, [displayItems, itemById]);
  const childrenByParent = useMemo(() => {
    const visibleIds = new Set(displayItems.map((item) => item.id));
    const map = new Map<string, TodoItemT[]>();
    for (const item of displayItems) {
      if (item.parentId == null || !visibleIds.has(item.parentId)) continue;
      const parent = itemById.get(item.parentId);
      if (!parent || parent.listId !== item.listId || parent.deletedAt != null) {
        continue;
      }
      const children = map.get(parent.id) ?? [];
      children.push(item);
      map.set(parent.id, children);
    }
    return map;
  }, [displayItems, itemById]);
  const renderedItems = useMemo(() => {
    if (collapsedTodoIds.size === 0) return displayItems;
    const hiddenIds = new Set<string>();
    const markHiddenDescendants = (parentId: string) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (hiddenIds.has(child.id)) continue;
        hiddenIds.add(child.id);
        markHiddenDescendants(child.id);
      }
    };
    const visibleIds = new Set(displayItems.map((item) => item.id));
    for (const parentId of collapsedTodoIds) {
      if (visibleIds.has(parentId)) markHiddenDescendants(parentId);
    }
    return displayItems.filter((item) => !hiddenIds.has(item.id));
  }, [collapsedTodoIds, childrenByParent, displayItems]);
  const renderedItemIds = useMemo(
    () => renderedItems.map((item) => item.id),
    [renderedItems],
  );
  const groupSections = useMemo<TodoGroupSectionData[]>(() => {
    if (selectedFilter.kind !== "list" || selectedListGroups.length === 0) {
      return [];
    }
    const validGroupIds = new Set(selectedListGroups.map((group) => group.id));
    const buckets = new Map<string | null, TodoItemT[]>();
    for (const group of selectedListGroups) {
      buckets.set(group.id, []);
    }
    buckets.set(null, []);
    for (const item of renderedItems) {
      const groupId = effectiveGroupIdForItem(item, itemById, validGroupIds);
      const bucket = buckets.get(groupId) ?? [];
      bucket.push(item);
      buckets.set(groupId, bucket);
    }
    const sections: TodoGroupSectionData[] = selectedListGroups.map((group) => {
      const sectionItems = buckets.get(group.id) ?? [];
      return {
        key: group.id,
        group,
        title: group.name,
        items: sectionItems,
        itemCount: sectionItems.length,
      };
    });
    const ungrouped = buckets.get(null) ?? [];
    if (ungrouped.length > 0) {
      sections.push({
        key: "ungrouped",
        group: null,
        title: "未分组",
        items: ungrouped,
        itemCount: ungrouped.length,
      });
    }
    return sections;
  }, [itemById, renderedItems, selectedFilter, selectedListGroups]);
  const boardSections = useMemo<TodoBoardSection[]>(() => {
    if (selectedFilter.kind !== "list") return [];
    const validGroupIds = new Set(selectedListGroups.map((group) => group.id));
    const buckets = new Map<string | null, TodoItemT[]>();
    for (const group of selectedListGroups) {
      buckets.set(group.id, []);
    }
    buckets.set(null, []);
    for (const item of renderedItems) {
      const groupId = effectiveGroupIdForItem(item, itemById, validGroupIds);
      const bucket = buckets.get(groupId) ?? [];
      bucket.push(item);
      buckets.set(groupId, bucket);
    }

    const sections: TodoBoardSection[] = selectedListGroups.map((group) => {
      const sectionItems = buckets.get(group.id) ?? [];
      return {
        key: group.id,
        group,
        title: group.name,
        items: sectionItems,
        itemCount: sectionItems.length,
      };
    });
    const ungrouped = buckets.get(null) ?? [];
    sections.push({
      key: "ungrouped",
      group: null,
      title: "未分组",
      items: ungrouped,
      itemCount: ungrouped.length,
    });
    return sections;
  }, [itemById, renderedItems, selectedFilter, selectedListGroups]);
  const timelineEntries = useMemo<TodoTimelineEntry[]>(() => {
    if (!useTimelineView) return [];
    const maps = { folderById, groupById, itemById, listById };
    return renderedItems.map((item) => ({
      item,
      path: buildCompletedTodoContext(item, maps).path,
    }));
  }, [folderById, groupById, itemById, listById, renderedItems, useTimelineView]);
  const visibleGroupSections = useMemo(
    () =>
      groupSections.map((section) =>
        section.group && collapsedGroupIds.has(section.group.id)
          ? { ...section, items: [] }
          : section,
      ),
    [collapsedGroupIds, groupSections],
  );
  const folderListSections = useMemo<TodoFolderListSectionData[]>(() => {
    if (selectedFilter.kind !== "folder") return [];

    return selectedFolderLists.map((list) => {
      const listGroups = groups
        .filter((group) => group.listId === list.id)
        .sort((a, b) => a.order - b.order);
      const validGroupIds = new Set(listGroups.map((group) => group.id));
      const buckets = new Map<string | null, TodoItemT[]>();

      for (const group of listGroups) {
        buckets.set(group.id, []);
      }
      buckets.set(null, []);

      for (const item of renderedItems) {
        if (item.listId !== list.id) continue;
        const groupId = effectiveGroupIdForItem(item, itemById, validGroupIds);
        const bucket = buckets.get(groupId) ?? [];
        bucket.push(item);
        buckets.set(groupId, bucket);
      }

      const sections: TodoGroupSectionData[] = listGroups.map((group) => {
        const sectionItems = buckets.get(group.id) ?? [];
        return {
          key: `${list.id}:${group.id}`,
          group,
          title: group.name,
          items: sectionItems,
          itemCount: sectionItems.length,
        };
      });
      const ungrouped = buckets.get(null) ?? [];
      if (ungrouped.length > 0 || listGroups.length === 0) {
        sections.push({
          key: `${list.id}:ungrouped`,
          group: null,
          title: "未分组",
          items: ungrouped,
          itemCount: ungrouped.length,
        });
      }

      return {
        list,
        groups: sections,
        itemCount: sections.reduce((total, section) => total + section.itemCount, 0),
      };
    });
  }, [
    groups,
    itemById,
    renderedItems,
    selectedFilter,
    selectedFolderLists,
  ]);
  const groupedRenderedItems = useMemo(
    () => visibleGroupSections.flatMap((section) => section.items),
    [visibleGroupSections],
  );
  const useGroupedListLayout =
    selectedFilter.kind === "list" && selectedListGroups.length > 0;
  const useFolderHierarchyLayout = selectedFilter.kind === "folder";
  const virtualizerEnabled =
    selectedFilter.kind !== "list" &&
    !useGroupedListLayout &&
    !useFolderHierarchyLayout;
  const sortableContextIds = useMemo(() => {
    if (!useGroupedListLayout) return renderedItemIds;
    if (activeDragKind === "group") {
      return visibleGroupSections
        .filter((section) => section.group)
        .map((section) => `group:${section.group!.id}`);
    }
    const ids: string[] = [];
    for (const section of visibleGroupSections) {
      if (section.group) {
        ids.push(`group:${section.group.id}`);
      } else {
        ids.push(section.key);
      }
      ids.push(...section.items.map((item) => item.id));
    }
    return ids;
  }, [
    activeDragKind,
    renderedItemIds,
    useGroupedListLayout,
    visibleGroupSections,
  ]);
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      if (activeDragKind !== "group") return closestCenter(args);
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) =>
          String(container.id).startsWith("group:"),
        ),
      });
    },
    [activeDragKind],
  );
  const estimatedTodoRowSize =
    selectedFilter.kind === "completed"
      ? (showNotePreview ? 72 : 56)
      : (showNotePreview ? 56 : 44);
  const rowVirtualizer = useVirtualizer({
    count: renderedItems.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => estimatedTodoRowSize,
    overscan: selectedFilter.kind === "completed" ? 6 : 8,
    getItemKey: (index) => renderedItems[index]?.id ?? index,
    enabled: virtualizerEnabled,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const useVirtualLayout = virtualizerEnabled && virtualRows.length > 0;
  const virtualPaddingTop = virtualRows[0]?.start ?? 0;
  const totalVirtualHeight = useVirtualLayout
    ? rowVirtualizer.getTotalSize()
    : renderedItems.length * estimatedTodoRowSize;

  const getCachedTodoDepth = (item: TodoItemT) => todoDepthById.get(item.id) ?? 0;

  const toggleCollapsedTodo = useCallback((id: string) => {
    setCollapsedTodoIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandCollapsedTodo = useCallback((id: string) => {
    setCollapsedTodoIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const onDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    setActiveDragId(activeId);
    setActiveDragKind(activeId.startsWith("group:") ? "group" : "todo");
    setActiveDragOverlayWidth(event.active.rect.current.initial?.width ?? null);
  };

  const clearActiveDragKind = () => {
    setActiveDragKind(null);
    setActiveDragId(null);
    setActiveDragOverlayWidth(null);
  };

  const activeDragTodo =
    activeDragKind === "todo" && activeDragId != null
      ? itemById.get(activeDragId) ?? null
      : null;
  const activeDragGroupSection =
    activeDragKind === "group" && activeDragId?.startsWith("group:")
      ? visibleGroupSections.find(
          (section) =>
            section.group?.id === activeDragId.slice("group:".length),
        ) ?? null
      : null;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    clearActiveDragKind();
    if (consumeLastTodoExternalDrop(String(active.id))) return;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const validGroupIds = new Set(selectedListGroups.map((group) => group.id));
    const overHeaderGroupId = overId.startsWith("group:")
      ? overId.slice("group:".length)
      : null;
    const overSectionIndex = visibleGroupSections.findIndex((section) =>
      section.group ? `group:${section.group.id}` === overId : section.key === overId,
    );
    const overItem = itemById.get(overId);
    const overGroupId =
      overHeaderGroupId ??
      (overItem ? effectiveGroupIdForItem(overItem, itemById, validGroupIds) : null);

    if (activeId.startsWith("group:")) {
      const groupId = activeId.slice("group:".length);
      if (!overGroupId || groupId === overGroupId) return;
      const fromIdx = selectedListGroups.findIndex((group) => group.id === groupId);
      const toIdx = selectedListGroups.findIndex((group) => group.id === overGroupId);
      if (fromIdx < 0 || toIdx < 0) return;
      const reordered = arrayMove(selectedListGroups, fromIdx, toIdx);
      const movedIdx = reordered.findIndex((group) => group.id === groupId);
      const before = movedIdx > 0 ? reordered[movedIdx - 1] : null;
      const after = movedIdx < reordered.length - 1 ? reordered[movedIdx + 1] : null;
      reorderGroup(groupId, midpointGroupOrder(before, after));
      return;
    }

    if (active.id === over.id && Math.abs(delta.x) < TODO_DRAG_INDENT_PX / 2) {
      return;
    }
    const movedItem = itemById.get(activeId);
    if (!movedItem) return;

    const descendantIds = collectLocalDescendantIds(items, activeId);
    if (descendantIds.has(overId) && overId !== activeId) return;
    const dragOrderedItems = useGroupedListLayout
      ? groupedRenderedItems
      : renderedItems;

    if (selectedFilter.kind === "list" && overSectionIndex >= 0) {
      const activeRect = active.rect.current.translated ?? active.rect.current.initial;
      const activeCenterY = activeRect
        ? activeRect.top + activeRect.height / 2
        : over.rect.top + over.rect.height / 2;
      const dropsBeforeHeader = activeCenterY < over.rect.top + over.rect.height / 2;
      const targetSectionIndex =
        dropsBeforeHeader && overSectionIndex > 0
          ? overSectionIndex - 1
          : overSectionIndex;
      const targetSection = visibleGroupSections[targetSectionIndex];
      const targetGroupId = targetSection?.group?.id ?? null;
      const insertAtEnd = dropsBeforeHeader && targetSectionIndex !== overSectionIndex;
      const sameTargetGroupRoot = (item: TodoItemT) =>
        item.id !== activeId &&
        item.listId === movedItem.listId &&
        item.deletedAt == null &&
        (item.parentId ?? null) === null &&
        effectiveGroupIdForItem(item, itemById, validGroupIds) === targetGroupId;
      const targetRootItems = dragOrderedItems.filter(sameTargetGroupRoot);
      const before = insertAtEnd
        ? targetRootItems[targetRootItems.length - 1] ?? null
        : null;
      const after = insertAtEnd ? null : targetRootItems[0] ?? null;
      updateItem(movedItem.id, {
        parentId: null,
        groupId: targetGroupId,
        order: midpointOrder(before, after),
      });
      return;
    }

    const sortableItems = dragOrderedItems.filter(
      (item) => item.id === activeId || !descendantIds.has(item.id),
    );
    const ids = sortableItems.map((it) => it.id);
    const fromIdx = ids.indexOf(active.id as string);
    const toIdx = ids.indexOf(over.id as string);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = arrayMove(sortableItems, fromIdx, toIdx);
    const movedIdx = reordered.findIndex((item) => item.id === activeId);
    if (movedIdx < 0) return;

    const currentDepth = getCachedTodoDepth(movedItem);
    const depthDelta = Math.round(delta.x / TODO_DRAG_INDENT_PX);
    const previousItem = movedIdx > 0 ? reordered[movedIdx - 1] : null;
    const maxDepthFromPrevious =
      previousItem == null ? 0 : getCachedTodoDepth(previousItem) + 1;
    let targetDepth = Math.min(
      MAX_TODO_DRAG_DEPTH,
      Math.max(0, currentDepth + depthDelta),
      maxDepthFromPrevious,
    );

    let nextParentId: string | null = null;
    while (targetDepth > 0) {
      const parent = [...reordered]
        .slice(0, movedIdx)
        .reverse()
        .find(
          (item) =>
            item.listId === movedItem.listId &&
            item.deletedAt == null &&
            !descendantIds.has(item.id) &&
            getCachedTodoDepth(item) === targetDepth - 1,
        );
      if (parent) {
        nextParentId = parent.id;
        break;
      }
      targetDepth -= 1;
    }

    let nextGroupId = movedItem.groupId ?? null;
    if (selectedFilter.kind === "list") {
      if (nextParentId != null) {
        const nextParent = itemById.get(nextParentId);
        nextGroupId = nextParent
          ? effectiveGroupIdForItem(nextParent, itemById, validGroupIds)
          : null;
      } else if (overItem) {
        nextGroupId = effectiveGroupIdForItem(overItem, itemById, validGroupIds);
      }
    }

    if (selectedFilter.kind === "list" && targetDepth > 0) {
      const expectedGroupId = overItem
        ? effectiveGroupIdForItem(overItem, itemById, validGroupIds)
        : nextGroupId;
      while (
        nextParentId != null &&
        nextGroupId !== expectedGroupId &&
        targetDepth > 0
      ) {
        targetDepth -= 1;
        nextParentId = null;
        if (targetDepth <= 0) break;
        const parent = [...reordered]
          .slice(0, movedIdx)
          .reverse()
          .find(
            (item) =>
              item.listId === movedItem.listId &&
              item.deletedAt == null &&
              !descendantIds.has(item.id) &&
              getCachedTodoDepth(item) === targetDepth - 1 &&
              effectiveGroupIdForItem(item, itemById, validGroupIds) ===
                expectedGroupId,
          );
        if (parent) {
          nextParentId = parent.id;
          nextGroupId = expectedGroupId;
          break;
        }
      }
      if (nextParentId == null) {
        nextGroupId = expectedGroupId;
      }
    }

    const sameNextParent = (item: TodoItemT) =>
      item.id !== activeId &&
      item.listId === movedItem.listId &&
      (item.parentId ?? null) === nextParentId &&
      (nextParentId != null ||
        effectiveGroupIdForItem(item, itemById, validGroupIds) === nextGroupId);
    const before =
      [...reordered].slice(0, movedIdx).reverse().find(sameNextParent) ?? null;
    const after = reordered.slice(movedIdx + 1).find(sameNextParent) ?? null;
    updateItem(movedItem.id, {
      parentId: nextParentId,
      groupId: nextGroupId,
      order: midpointOrder(before, after),
    });
  };

  const headerLabel = useMemo(
    () =>
      labelForFilter(
        selectedFilter,
        selectedList,
        selectedFolder,
        selectedCustomFilter,
      ),
    [selectedFilter, selectedList, selectedFolder, selectedCustomFilter],
  );
  const headerEmoji = selectedList?.emoji ?? selectedFolder?.emoji ?? "";
  const startListTitleEdit = () => {
    if (!selectedList) return;
    setListTitleDraft(selectedList.name);
    setEditingListTitle(true);
  };
  const commitListTitleEdit = () => {
    if (!selectedList) {
      setEditingListTitle(false);
      return;
    }
    const name = listTitleDraft.trim();
    if (name && name !== selectedList.name) {
      renameList(selectedList.id, { name });
    }
    setEditingListTitle(false);
  };
  const cancelListTitleEdit = () => {
    setListTitleDraft(selectedList?.name ?? "");
    setEditingListTitle(false);
  };
  const showAdvancedFilterBar =
    isAdvanced ||
    (isCustomFilter && selectedCustomFilter != null && customFilterEditorOpen);
  const activeAdvancedFilter =
    isCustomFilter && selectedCustomFilter != null
      ? customFilterDraft
      : advancedFilter;
  const showDetailFilterActions =
    !isArchive && !isTagFilter && !isAdvanced && !isCustomFilter;
  const canQuickAdd =
    selectedFilter.kind === "list" ||
    selectedFilter.kind === "today" ||
    selectedFilter.kind === "recent7" ||
    selectedFilter.kind === "inbox";
  const canExportRecent7WorkChecklist = selectedFilter.kind === "recent7";
  const canExportListChecklist = selectedFilter.kind === "list" && selectedList != null;
  const canExportCustomFilterChecklist = selectedCustomFilter != null;
  const canExportChecklist =
    canExportRecent7WorkChecklist ||
    canExportListChecklist ||
    canExportCustomFilterChecklist;
  const showMoreMenuActions = showDetailFilterActions || canExportChecklist;

  const exportRecent7WorkChecklist = async () => {
    const text = buildRecent7WorkChecklist(displayItems, lists, todoDepthById);
    if (!text) {
      pushSnack("最近7天没有可导出的任务", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      pushSnack(`已复制 ${displayItems.length} 项任务到剪贴板`, "success");
    } catch (error) {
      console.warn("[todo] export recent7 checklist failed:", error);
      pushSnack("复制工作清单失败", "error");
    }
  };

  const exportListChecklist = async () => {
    if (!selectedList) return;
    const text = buildListDetailChecklist(
      selectedList,
      displayItems,
    );
    if (!text) {
      pushSnack("当前清单没有可导出的任务", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      pushSnack(`已复制 ${displayItems.length} 项任务到剪贴板`, "success");
    } catch (error) {
      console.warn("[todo] export list checklist failed:", error);
      pushSnack("复制清单内容失败", "error");
    }
  };

  const exportCustomFilterChecklist = async () => {
    if (!selectedCustomFilter) return;
    const text = buildDateTaskSummary(displayItems);
    if (!text) {
      pushSnack("当前过滤器没有可导出的任务", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      pushSnack(`已复制 ${displayItems.length} 项任务到剪贴板`, "success");
    } catch (error) {
      console.warn("[todo] export custom filter checklist failed:", error);
      pushSnack("复制过滤器内容失败", "error");
    }
  };

  const exportChecklist = () => {
    if (canExportRecent7WorkChecklist) {
      void exportRecent7WorkChecklist();
      return;
    }
    if (canExportListChecklist) {
      void exportListChecklist();
      return;
    }
    if (canExportCustomFilterChecklist) {
      void exportCustomFilterChecklist();
    }
  };

  const openCreateGroupDialog = (order?: number) => {
    if (!selectedList) return;
    setGroupDraftName("");
    setGroupDialog({ mode: "create", listId: selectedList.id, order });
  };

  const openRenameGroupDialog = (group: TodoGroup) => {
    setGroupDraftName(group.name);
    setGroupDialog({ mode: "rename", group });
  };

  const submitGroupDialog = () => {
    const name = groupDraftName.trim();
    if (!name || !groupDialog) return;
    if (groupDialog.mode === "create") {
      addGroup(groupDialog.listId, name, { order: groupDialog.order });
    } else {
      renameGroup(groupDialog.group.id, name);
    }
    setGroupDialog(null);
    setGroupDraftName("");
  };

  const createItemInGroup = (groupId: string | null) => {
    if (!selectedList) return;
    const item = addItem(selectedList.id, "", {
      allowEmpty: true,
      groupId,
    });
    if (item) {
      setSelectedItemId(item.id);
    }
  };

  const makeBoardItemChild = useCallback(
    (itemId: string, parentId: string) => {
      if (itemId === parentId) return;
      const item = itemById.get(itemId);
      const parent = itemById.get(parentId);
      if (
        !item ||
        !parent ||
        item.deletedAt != null ||
        parent.deletedAt != null ||
        item.listId !== parent.listId
      ) {
        return;
      }

      const descendantIds = collectLocalDescendantIds(items, itemId);
      if (descendantIds.has(parentId)) return;

      const parentDepth = todoDepthById.get(parent.id) ?? 0;
      if (parentDepth >= MAX_TODO_DRAG_DEPTH) return;

      const validGroupIds = new Set(selectedListGroups.map((group) => group.id));
      const parentGroupId = effectiveGroupIdForItem(parent, itemById, validGroupIds);
      const siblings = items
        .filter(
          (entry) =>
            entry.id !== itemId &&
            entry.listId === item.listId &&
            entry.deletedAt == null &&
            (entry.parentId ?? null) === parent.id,
        )
        .sort((a, b) => a.order - b.order);
      const before = siblings[siblings.length - 1] ?? null;

      updateItem(item.id, {
        parentId: parent.id,
        groupId: parentGroupId,
        order: midpointOrder(before, null),
      });
    },
    [itemById, items, selectedListGroups, todoDepthById, updateItem],
  );

  const renderBoardAddInput = useCallback(
    (groupId: string | null, onDone: () => void) => (
      <QuickAddTodoInput
        isDark={isDark}
        selectedFilter={selectedFilter}
        groups={selectedListGroups}
        allTags={allTags}
        autoFocus
        forceExpanded
        fixedGroupId={groupId}
        placeholder="准备做什么？"
        onAfterSubmit={(item) => {
          setSelectedItemId(item.id);
          onDone();
        }}
        onCancel={onDone}
        onInactive={onDone}
      />
    ),
    [allTags, isDark, selectedFilter, selectedListGroups, setSelectedItemId],
  );

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };
  const toggleFolderListCollapsed = (listId: string) => {
    setCollapsedFolderListIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  };
  const openListTarget = useCallback((listId: string) => {
    setSelectedFilter({ kind: "list", id: listId });
  }, [setSelectedFilter]);
  const openGroupTarget = useCallback((listId: string, groupId: string) => {
    setPendingGroupJumpId(groupId);
    setSelectedFilter({ kind: "list", id: listId });
  }, [setSelectedFilter]);
  const openTodoContextTarget = useCallback((target: TodoItemContextTarget) => {
    if (target.kind === "folder") {
      setSelectedFilter({ kind: "folder", id: target.id });
      return;
    }
    if (target.kind === "list") {
      openListTarget(target.id);
      return;
    }
    openGroupTarget(target.listId, target.id);
  }, [openGroupTarget, openListTarget, setSelectedFilter]);

  const addGroupNear = (group: TodoGroup, placement: "above" | "below") => {
    const index = selectedListGroups.findIndex((entry) => entry.id === group.id);
    if (index < 0) return;
    const before =
      placement === "above"
        ? index > 0
          ? selectedListGroups[index - 1]
          : null
        : group;
    const after =
      placement === "above"
        ? group
        : index < selectedListGroups.length - 1
          ? selectedListGroups[index + 1]
          : null;
    openCreateGroupDialog(midpointGroupOrder(before, after));
  };

  const pinGroupToTop = (group: TodoGroup) => {
    const first = selectedListGroups.find((entry) => entry.id !== group.id) ?? null;
    reorderGroup(group.id, midpointGroupOrder(null, first));
  };

  const saveAdvancedFilter = () => {
    setSaveFilterName("");
    setSaveFilterDialogOpen(true);
  };

  const submitSaveAdvancedFilter = () => {
    const trimmed = saveFilterName.trim();
    if (!trimmed) return;
    const saved = addCustomFilter(trimmed, advancedFilter);
    if (saved) {
      useTodoStore
        .getState()
        .setSelectedFilter({ kind: "customFilter", id: saved.id });
    }
    setSaveFilterDialogOpen(false);
  };

  const changeActiveAdvancedFilter = (patch: Partial<AdvancedTodoFilter>) => {
    if (selectedCustomFilter) {
      setCustomFilterDraft((cur) => ({ ...cur, ...patch }));
      return;
    }
    setAdvancedFilter(patch);
  };

  const resetActiveAdvancedFilter = () => {
    if (selectedCustomFilter) {
      setCustomFilterDraft(DEFAULT_ADVANCED_FILTER);
      return;
    }
    resetAdvancedFilter();
  };

  const saveCustomFilterDraft = () => {
    if (!selectedCustomFilter) return;
    updateCustomFilter(selectedCustomFilter.id, { criteria: customFilterDraft });
    setCustomFilterEditorOpen(false);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        sx={{
          height: 48,
          px: 2,
          display: "flex",
          alignItems: "center",
          gap: 1.2,
          borderBottom: 1,
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
        }}
      >
        {headerEmoji && (
          <Box sx={{ fontSize: 20, lineHeight: 1 }}>
            <TodoEmoji emoji={headerEmoji} size={20} />
          </Box>
        )}
        {selectedList && editingListTitle ? (
          <Box
            component="input"
            ref={listTitleInputRef}
            value={listTitleDraft}
            onChange={(event) => setListTitleDraft(event.currentTarget.value)}
            onBlur={commitListTitleEdit}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitListTitleEdit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelListTitleEdit();
              }
            }}
            sx={{
              minWidth: 120,
              maxWidth: "min(420px, 50vw)",
              height: 30,
              px: 0.75,
              border: 1,
              borderColor: "primary.main",
              borderRadius: 1,
              bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.04),
              color: "text.primary",
              font: "inherit",
              fontSize: 18,
              fontWeight: 600,
              outline: "none",
              flexShrink: 1,
            }}
          />
        ) : (
          <Tooltip title={selectedList ? "点击重命名清单" : headerLabel}>
            <Box
              component={selectedList ? "button" : "div"}
              type={selectedList ? "button" : undefined}
              onClick={selectedList ? startListTitleEdit : undefined}
              sx={{
                minWidth: 0,
                maxWidth: "min(420px, 50vw)",
                p: selectedList ? "2px 6px" : 0,
                ml: selectedList ? -0.75 : 0,
                border: 0,
                borderRadius: 1,
                bgcolor: "transparent",
                color: "text.primary",
                font: "inherit",
                fontSize: 18,
                fontWeight: 600,
                lineHeight: 1.4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: selectedList ? "text" : "default",
                textAlign: "left",
                flexShrink: 1,
                "&:hover": selectedList
                  ? {
                      bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.04),
                      color: "primary.main",
                    }
                  : undefined,
              }}
            >
              {headerLabel}
            </Box>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        {selectedCustomFilter && (
          <Tooltip title={customFilterEditorOpen ? "收起条件" : "编辑过滤条件"}>
            <IconButton
              size="small"
              onClick={() => {
                if (!customFilterEditorOpen) {
                  setCustomFilterDraft(selectedCustomFilter.criteria);
                }
                setCustomFilterEditorOpen((open) => !open);
              }}
              sx={{
                color: customFilterEditorOpen ? "primary.main" : "text.secondary",
              }}
            >
              <FilterListRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        {selectedList && (
          <Tooltip title="新建分组">
            <IconButton
              size="small"
              onClick={() => openCreateGroupDialog()}
              sx={{ color: "text.secondary" }}
            >
              <AddRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        {isTrash ? (
          <Tooltip title="清空垃圾桶">
            <Button
              size="small"
              color="error"
              startIcon={<DeleteSweepRoundedIcon />}
              onClick={() => {
                if (
                  filteredItems.length > 0 &&
                  window.confirm(
                    `永久删除垃圾桶中的 ${filteredItems.length} 项任务？此操作不可撤销。`,
                  )
                ) {
                  purgeAllTrash();
                }
              }}
            >
              清空
            </Button>
          </Tooltip>
        ) : isQuadrant || isAdvanced ? null : (
          showMoreMenuActions && (
            <>
              {showDetailFilterActions && detailFilter.kind !== "all" && (
                <Chip
                  size="small"
                  label={labelForDetail(detailFilter)}
                  onDelete={() => setDetailFilter({ kind: "all" })}
                  sx={{ height: 22, fontSize: 11 }}
                />
              )}
              <Tooltip title="筛选">
                <IconButton
                  size="small"
                  onClick={(e) => setFilterAnchor(e.currentTarget)}
                  sx={{
                    color:
                      showDetailFilterActions &&
                      (detailFilter.kind !== "all" ||
                        !showCompleted ||
                        useBoardView ||
                        useTimelineView)
                        ? "primary.main"
                        : "text.secondary",
                  }}
                >
                  <MoreHorizRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </>
          )
        )}
      </Box>
      {showAdvancedFilterBar && (
        <AdvancedFilterBar
          lists={lists}
          tags={allTags}
          value={activeAdvancedFilter}
          onChange={changeActiveAdvancedFilter}
          onReset={resetActiveAdvancedFilter}
          onSave={isAdvanced ? saveAdvancedFilter : saveCustomFilterDraft}
          isDark={isDark}
        />
      )}
      {canQuickAdd && !useBoardView && !useTimelineView && (
        <QuickAddTodoInput
          isDark={isDark}
          selectedFilter={selectedFilter}
          groups={selectedListGroups}
          allTags={allTags}
        />
      )}
      <Box
        ref={listScrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          py: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {isQuadrant ? (
          <QuadrantView
            isDark={isDark}
            onOpenContextTarget={openTodoContextTarget}
          />
        ) : (
        <Box sx={{ flex: "1 1 auto", minHeight: 0 }}>
          {useTimelineView ? (
            <TodoTimelineView
              entries={timelineEntries}
              isDark={isDark}
              onSelectItem={setSelectedItemId}
              onOpenContextTarget={openTodoContextTarget}
            />
          ) : useFolderHierarchyLayout ? (
            <TodoFolderHierarchyView
              sections={folderListSections}
              isDark={isDark}
              showNotePreview={showNotePreview}
              getDepth={getCachedTodoDepth}
              visibleChildParentIds={visibleChildParentIds}
              collapsedTodoIds={collapsedTodoIds}
              collapsedGroupIds={collapsedGroupIds}
              collapsedListIds={collapsedFolderListIds}
              onToggleListCollapsed={toggleFolderListCollapsed}
              onToggleGroupCollapsed={toggleGroupCollapsed}
              onToggleCollapsed={toggleCollapsedTodo}
              onExpand={expandCollapsedTodo}
              onOpenList={openListTarget}
              onOpenGroup={openGroupTarget}
            />
          ) : useBoardView && selectedList ? (
            <TodoBoardView
              sections={boardSections}
              isDark={isDark}
              showNotePreview={showNotePreview}
              visibleChildParentIds={visibleChildParentIds}
              collapsedTodoIds={collapsedTodoIds}
              onToggleCollapsed={toggleCollapsedTodo}
              onExpand={expandCollapsedTodo}
              renderAddInput={renderBoardAddInput}
              onMoveItem={setItemGroup}
              onMakeChild={makeBoardItemChild}
              onRenameGroup={openRenameGroupDialog}
              onDeleteGroup={(group) => {
                if (
                  window.confirm(
                    `删除分组「${group.name}」？分组内待办会移到未分组。`,
                  )
                ) {
                  deleteGroup(group.id);
                }
              }}
            />
          ) : displayItems.length === 0 && !useGroupedListLayout ? (
            <Box
              sx={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "text.disabled",
              }}
            >
              <Typography sx={{ fontSize: 13 }}>
                {isTrash ? "垃圾桶为空" : "暂无待办任务"}
              </Typography>
            </Box>
          ) : draggable ? (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={onDragStart}
              onDragCancel={clearActiveDragKind}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={sortableContextIds}
                strategy={verticalListSortingStrategy}
              >
                {useGroupedListLayout ? (
                  visibleGroupSections.map((section) => (
                    <TodoGroupSection
                      key={section.key}
                      section={section}
                      isDark={isDark}
                      showNotePreview={showNotePreview}
                      getDepth={getCachedTodoDepth}
                      visibleChildParentIds={visibleChildParentIds}
                      collapsedTodoIds={collapsedTodoIds}
                      collapsed={
                        section.group != null &&
                        collapsedGroupIds.has(section.group.id)
                      }
                      isGroupDragActive={activeDragKind === "group"}
                      isTodoDragActive={activeDragKind === "todo"}
                      hideTodoDragSource
                      canShiftDuringTodoDrag={
                        section.group == null ||
                        section.group.id !== selectedListGroups[0]?.id
                      }
                      onToggleGroupCollapsed={toggleGroupCollapsed}
                      onToggleCollapsed={toggleCollapsedTodo}
                      onExpand={expandCollapsedTodo}
                      onAddItem={createItemInGroup}
                      onRenameGroup={openRenameGroupDialog}
                      onAddGroupAbove={(group) => addGroupNear(group, "above")}
                      onAddGroupBelow={(group) => addGroupNear(group, "below")}
                      onPinGroupToTop={pinGroupToTop}
                      onDeleteGroup={(group) => {
                        if (
                          window.confirm(
                            `删除分组「${group.name}」？分组内待办会移到未分组。`,
                          )
                        ) {
                          deleteGroup(group.id);
                        }
                      }}
                    />
                  ))
                ) : useVirtualLayout ? (
                  <Box
                    sx={{
                      position: "relative",
                      minHeight: 0,
                      height: `${totalVirtualHeight}px`,
                    }}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualPaddingTop}px)`,
                      }}
                    >
                      {virtualRows.map((virtualRow) => {
                        const it = renderedItems[virtualRow.index];
                        if (!it) return null;
                        const completedContext = completedTodoContextById.get(it.id);
                        return (
                          <Box
                            key={it.id}
                            ref={rowVirtualizer.measureElement}
                            data-index={virtualRow.index}
                            sx={{ py: 0.4 }}
                          >
                            <TodoItem
                              item={it}
                              isDark={isDark}
                              draggable
                              trashMode={isTrash}
                              sortableDroppable={activeDragKind === "todo"}
                              deferOffscreenRendering={activeDragKind == null}
                              hideSortableDragSource
                              depth={getCachedTodoDepth(it)}
                              showNotePreview={showNotePreview}
                              contextPath={completedContext?.path}
                              contextTooltip={completedContext?.tooltip}
                              contextTooltipMode={completedContext ? "none" : undefined}
                              onOpenContextPath={
                                completedContext ? openTodoContextTarget : undefined
                              }
                              hasChildren={visibleChildParentIds.has(it.id)}
                              collapsed={collapsedTodoIds.has(it.id)}
                              onToggleCollapsed={toggleCollapsedTodo}
                              onExpand={expandCollapsedTodo}
                              disableOuterMargin
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                ) : (
                  renderedItems.map((it) => {
                    const completedContext = completedTodoContextById.get(it.id);
                    return (
                      <TodoItem
                        key={it.id}
                        item={it}
                        isDark={isDark}
                        draggable
                        trashMode={isTrash}
                        sortableDroppable={activeDragKind === "todo"}
                        deferOffscreenRendering={activeDragKind == null}
                        hideSortableDragSource
                        depth={getCachedTodoDepth(it)}
                        showNotePreview={showNotePreview}
                        contextPath={completedContext?.path}
                        contextTooltip={completedContext?.tooltip}
                        contextTooltipMode={completedContext ? "none" : undefined}
                        onOpenContextPath={
                          completedContext ? openTodoContextTarget : undefined
                        }
                        hasChildren={visibleChildParentIds.has(it.id)}
                        collapsed={collapsedTodoIds.has(it.id)}
                        onToggleCollapsed={toggleCollapsedTodo}
                        onExpand={expandCollapsedTodo}
                      />
                    );
                  })
                )}
              </SortableContext>
              {typeof document !== "undefined" &&
                createPortal(
                  <DragOverlay dropAnimation={null}>
                    <TodoDetailDragOverlay
                      todo={activeDragTodo}
                      groupSection={activeDragGroupSection}
                      activeKind={activeDragKind}
                      isDark={isDark}
                      width={activeDragOverlayWidth}
                      showNotePreview={showNotePreview}
                      getDepth={getCachedTodoDepth}
                      visibleChildParentIds={visibleChildParentIds}
                      collapsedTodoIds={collapsedTodoIds}
                      collapsedGroupIds={collapsedGroupIds}
                      onToggleCollapsed={toggleCollapsedTodo}
                      onExpand={expandCollapsedTodo}
                    />
                  </DragOverlay>,
                  document.body,
                )}
            </DndContext>
          ) : (
            useVirtualLayout ? (
              <Box
                sx={{
                  position: "relative",
                  minHeight: 0,
                  height: `${totalVirtualHeight}px`,
                }}
              >
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualPaddingTop}px)`,
                  }}
                >
                  {virtualRows.map((virtualRow) => {
                    const it = renderedItems[virtualRow.index];
                    if (!it) return null;
                    const completedContext = completedTodoContextById.get(it.id);
                    return (
                      <Box
                        key={it.id}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        sx={{ py: 0.4 }}
                      >
                        <TodoItem
                          item={it}
                          isDark={isDark}
                          draggable={false}
                          trashMode={isTrash}
                          depth={getCachedTodoDepth(it)}
                          showNotePreview={showNotePreview}
                          contextPath={completedContext?.path}
                          contextTooltip={completedContext?.tooltip}
                          contextTooltipMode={completedContext ? "none" : undefined}
                          onOpenContextPath={
                            completedContext ? openTodoContextTarget : undefined
                          }
                          hasChildren={visibleChildParentIds.has(it.id)}
                          collapsed={collapsedTodoIds.has(it.id)}
                          onToggleCollapsed={toggleCollapsedTodo}
                          onExpand={expandCollapsedTodo}
                          disableOuterMargin
                        />
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            ) : (
              renderedItems.map((it) => {
                const completedContext = completedTodoContextById.get(it.id);
                return (
                  <TodoItem
                    key={it.id}
                    item={it}
                    isDark={isDark}
                    draggable={false}
                    trashMode={isTrash}
                    depth={getCachedTodoDepth(it)}
                    showNotePreview={showNotePreview}
                    contextPath={completedContext?.path}
                    contextTooltip={completedContext?.tooltip}
                    contextTooltipMode={completedContext ? "none" : undefined}
                    onOpenContextPath={
                      completedContext ? openTodoContextTarget : undefined
                    }
                    hasChildren={visibleChildParentIds.has(it.id)}
                    collapsed={collapsedTodoIds.has(it.id)}
                    onToggleCollapsed={toggleCollapsedTodo}
                    onExpand={expandCollapsedTodo}
                  />
                );
              })
            )
          )}
        </Box>
        )}
      </Box>
      <Dialog
        open={groupDialog != null}
        onClose={() => setGroupDialog(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {groupDialog?.mode === "rename" ? "重命名分组" : "新建分组"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            margin="dense"
            label="名称"
            value={groupDraftName}
            onChange={(e) => setGroupDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && groupDraftName.trim()) {
                e.preventDefault();
                submitGroupDialog();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialog(null)}>取消</Button>
          <Button
            variant="contained"
            disabled={!groupDraftName.trim()}
            onClick={submitGroupDialog}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
      <FilterDropdown
        anchorEl={filterAnchor}
        onClose={() => {
          setFilterAnchor(null);
          setTagSubAnchor(null);
        }}
        current={detailFilter}
        onPick={(f) => {
          setDetailFilter(f);
          setFilterAnchor(null);
          setTagSubAnchor(null);
        }}
        showCompleted={showCompleted}
        onToggleShowCompleted={toggleShowCompleted}
        showFilterOptions={showDetailFilterActions}
        detailViewMode={detailViewMode}
        onDetailViewModeChange={setDetailViewMode}
        showBoardOption={selectedFilter.kind === "list"}
        showTimelineOption={canUseTimelineView}
        showDisplayOptions={showDetailFilterActions && !isQuadrant}
        showNotePreview={showNotePreview}
        onToggleNotePreview={() => setShowNotePreview((show) => !show)}
        canExportChecklist={canExportChecklist}
        onExportChecklist={exportChecklist}
        completedArchiveSort={
          !isQuadrant && selectedFilter.kind === "completed"
            ? completedArchiveSort
            : null
        }
        onCompletedArchiveSortChange={setCompletedArchiveSort}
        tags={allTags}
        tagSubAnchor={tagSubAnchor}
        onOpenTagSub={(el) => setTagSubAnchor(el)}
        onCloseTagSub={() => setTagSubAnchor(null)}
      />
      <Dialog
        open={saveFilterDialogOpen}
        onClose={() => setSaveFilterDialogOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>保存过滤器</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            margin="dense"
            label="名称"
            value={saveFilterName}
            onChange={(e) => setSaveFilterName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && saveFilterName.trim()) {
                e.preventDefault();
                submitSaveAdvancedFilter();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveFilterDialogOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!saveFilterName.trim()}
            onClick={submitSaveAdvancedFilter}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface TodoFolderHierarchyViewProps {
  sections: TodoFolderListSectionData[];
  isDark: boolean;
  showNotePreview: boolean;
  getDepth: (item: TodoItemT) => number;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  collapsedGroupIds: Set<string>;
  collapsedListIds: Set<string>;
  onToggleListCollapsed: (id: string) => void;
  onToggleGroupCollapsed: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
  onOpenList: (id: string) => void;
  onOpenGroup: (listId: string, groupId: string) => void;
}

function TodoFolderHierarchyView({
  sections,
  isDark,
  showNotePreview,
  getDepth,
  visibleChildParentIds,
  collapsedTodoIds,
  collapsedGroupIds,
  collapsedListIds,
  onToggleListCollapsed,
  onToggleGroupCollapsed,
  onToggleCollapsed,
  onExpand,
  onOpenList,
  onOpenGroup,
}: TodoFolderHierarchyViewProps) {
  if (sections.length === 0) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.disabled",
        }}
      >
        <Typography sx={{ fontSize: 13 }}>此文件夹暂无清单</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ px: 0.75, pb: 1 }}>
      {sections.map((section) => (
        <TodoFolderListSection
          key={section.list.id}
          section={section}
          isDark={isDark}
          showNotePreview={showNotePreview}
          getDepth={getDepth}
          visibleChildParentIds={visibleChildParentIds}
          collapsedTodoIds={collapsedTodoIds}
          collapsedGroupIds={collapsedGroupIds}
          collapsedListIds={collapsedListIds}
          onToggleListCollapsed={onToggleListCollapsed}
          onToggleGroupCollapsed={onToggleGroupCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          onExpand={onExpand}
          onOpenList={onOpenList}
          onOpenGroup={onOpenGroup}
        />
      ))}
    </Box>
  );
}

interface TodoFolderListSectionProps extends Omit<TodoFolderHierarchyViewProps, "sections"> {
  section: TodoFolderListSectionData;
}

function TodoFolderListSection({
  section,
  isDark,
  showNotePreview,
  getDepth,
  visibleChildParentIds,
  collapsedTodoIds,
  collapsedGroupIds,
  collapsedListIds,
  onToggleListCollapsed,
  onToggleGroupCollapsed,
  onToggleCollapsed,
  onExpand,
  onOpenList,
  onOpenGroup,
}: TodoFolderListSectionProps) {
  const listCollapsed = collapsedListIds.has(section.list.id);

  return (
    <Box sx={{ mb: 1.1 }}>
      <Box
        sx={{
          mx: 0.25,
          mt: 0.6,
          mb: 0.45,
          px: 1,
          height: 34,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          borderRadius: 1,
          bgcolor: "transparent",
          border: 0,
        }}
      >
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onToggleListCollapsed(section.list.id);
          }}
          sx={{
            width: 22,
            height: 22,
            flexShrink: 0,
            "&:hover": { bgcolor: "transparent" },
          }}
        >
          {listCollapsed ? (
            <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16 }} />
          ) : (
            <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
        <Box
          role="button"
          tabIndex={0}
          onClick={() => onOpenList(section.list.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenList(section.list.id);
            }
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            cursor: "pointer",
          }}
        >
          <TodoEmoji emoji={section.list.emoji} fallback="📋" size={16} />
          <Typography
            sx={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 13,
              fontWeight: 800,
              color: "text.primary",
            }}
          >
            {section.list.name}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
          {section.itemCount}
        </Typography>
      </Box>
      {!listCollapsed && (
        <Box
          sx={{
            ml: 1.25,
            pl: 0.5,
          }}
        >
          {section.groups.length === 0 ? (
            <Typography
              sx={{ px: 1.2, py: 0.6, fontSize: 12, color: "text.disabled" }}
            >
              暂无待办
            </Typography>
          ) : (
            section.groups.map((groupSection) => (
              <TodoFolderGroupSection
                key={groupSection.key}
                list={section.list}
                section={groupSection}
                isDark={isDark}
                showNotePreview={showNotePreview}
                getDepth={getDepth}
                visibleChildParentIds={visibleChildParentIds}
                collapsedTodoIds={collapsedTodoIds}
                collapsed={
                  groupSection.group != null &&
                  collapsedGroupIds.has(groupSection.group.id)
                }
                onToggleGroupCollapsed={onToggleGroupCollapsed}
                onToggleCollapsed={onToggleCollapsed}
                onExpand={onExpand}
                onOpenList={onOpenList}
                onOpenGroup={onOpenGroup}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  );
}

interface TodoFolderGroupSectionProps {
  list: TodoList;
  section: TodoGroupSectionData;
  isDark: boolean;
  showNotePreview: boolean;
  getDepth: (item: TodoItemT) => number;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  collapsed: boolean;
  onToggleGroupCollapsed: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
  onOpenList: (id: string) => void;
  onOpenGroup: (listId: string, groupId: string) => void;
}

function TodoFolderGroupSection({
  list,
  section,
  isDark,
  showNotePreview,
  getDepth,
  visibleChildParentIds,
  collapsedTodoIds,
  collapsed,
  onToggleGroupCollapsed,
  onToggleCollapsed,
  onExpand,
  onOpenList,
  onOpenGroup,
}: TodoFolderGroupSectionProps) {
  const canCollapse = section.group != null;
  const openTarget = () => {
    if (section.group) {
      onOpenGroup(list.id, section.group.id);
      return;
    }
    onOpenList(list.id);
  };
  const inlineContextPath: TodoItemContextPathPart[] = section.group
    ? [
        {
          key: `group:${section.group.id}`,
          label: section.title,
          target: { kind: "group", id: section.group.id, listId: list.id },
        },
      ]
    : [
        {
          key: `list:${list.id}`,
          label: labelWithEmoji(list.emoji, list.name),
          target: { kind: "list", id: list.id },
        },
      ];
  const openInlineContextTarget = (target: TodoItemContextTarget) => {
    if (target.kind === "group") {
      onOpenGroup(target.listId, target.id);
      return;
    }
    if (target.kind === "list") {
      onOpenList(target.id);
    }
  };

  return (
    <Box sx={{ mb: 0.75 }}>
      <Box
        sx={{
          mr: 0.25,
          mb: 0.2,
          px: 1,
          height: 30,
          display: "flex",
          alignItems: "center",
          gap: 0.7,
          borderRadius: 1,
          bgcolor: "transparent",
        }}
      >
        {canCollapse ? (
          <IconButton
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onToggleGroupCollapsed(section.group!.id);
            }}
            sx={{
              width: 22,
              height: 22,
              flexShrink: 0,
              "&:hover": { bgcolor: "transparent" },
            }}
          >
            {collapsed ? (
              <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16 }} />
            ) : (
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        ) : (
          <Box sx={{ width: 22, flexShrink: 0 }} />
        )}
        <Box
          role="button"
          tabIndex={0}
          onClick={openTarget}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openTarget();
            }
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.7,
            cursor: "pointer",
          }}
        >
          <Typography
            sx={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 12,
              fontWeight: 700,
              color: "text.secondary",
            }}
          >
            {section.title}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 11, color: "text.disabled" }}>
          {section.itemCount}
        </Typography>
      </Box>
      {!collapsed && (
        <Box
          sx={{
            ml: 1.4,
            pl: 0.4,
          }}
        >
          {section.items.length === 0 ? (
            <Typography
              sx={{ px: 1.2, py: 0.5, fontSize: 12, color: "text.disabled" }}
            >
              暂无待办
            </Typography>
          ) : (
            section.items.map((item) => (
              <TodoItem
                key={item.id}
                item={item}
                isDark={isDark}
                draggable={false}
                depth={getDepth(item)}
                showNotePreview={showNotePreview}
                hasChildren={visibleChildParentIds.has(item.id)}
                collapsed={collapsedTodoIds.has(item.id)}
                onToggleCollapsed={onToggleCollapsed}
                onExpand={onExpand}
                contextPath={inlineContextPath}
                contextTooltip={
                  section.group
                    ? `打开分组：${section.title}`
                    : `打开清单：${labelWithEmoji(list.emoji, list.name)}`
                }
                contextDisplay="inline"
                onOpenContextPath={openInlineContextTarget}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  );
}

interface TodoDetailDragOverlayProps {
  todo: TodoItemT | null;
  groupSection: TodoGroupSectionData | null;
  activeKind: ActiveDragKind | null;
  isDark: boolean;
  width: number | null;
  showNotePreview: boolean;
  getDepth: (item: TodoItemT) => number;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  collapsedGroupIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
}

function TodoDetailDragOverlay({
  todo,
  groupSection,
  activeKind,
  isDark,
  width,
  showNotePreview,
  getDepth,
  visibleChildParentIds,
  collapsedTodoIds,
  collapsedGroupIds,
  onToggleCollapsed,
  onExpand,
}: TodoDetailDragOverlayProps) {
  const overlayWidth = width ?? 360;

  if (activeKind === "todo" && todo) {
    return (
      <Box
        sx={{
          width: overlayWidth,
          maxWidth: "calc(100vw - 24px)",
          pointerEvents: "none",
          filter: isDark
            ? "drop-shadow(0 16px 32px rgba(0, 0, 0, 0.42))"
            : "drop-shadow(0 14px 28px rgba(15, 23, 42, 0.18))",
          cursor: "grabbing",
        }}
      >
        <TodoItem
          item={todo}
          isDark={isDark}
          draggable={false}
          forceDragHandleVisible
          disableOuterMargin
          depth={getDepth(todo)}
          showNotePreview={showNotePreview}
          hasChildren={visibleChildParentIds.has(todo.id)}
          collapsed={collapsedTodoIds.has(todo.id)}
          onToggleCollapsed={onToggleCollapsed}
          onExpand={onExpand}
        />
      </Box>
    );
  }

  if (activeKind === "group" && groupSection?.group) {
    const collapsed = collapsedGroupIds.has(groupSection.group.id);
    return (
      <Box
        sx={{
          width: overlayWidth,
          maxWidth: "calc(100vw - 24px)",
          pointerEvents: "none",
          cursor: "grabbing",
        }}
      >
        <Box
          sx={{
            mx: 1,
            px: 0.5,
            height: 32,
            display: "flex",
            alignItems: "center",
            gap: 0.25,
            borderRadius: 1,
            bgcolor: alpha(isDark ? "#1f2937" : "#ffffff", isDark ? 0.96 : 0.98),
            color: "text.secondary",
            boxShadow: isDark
              ? "0 16px 32px rgba(0, 0, 0, 0.42)"
              : "0 14px 28px rgba(15, 23, 42, 0.18)",
          }}
        >
          <Box
            sx={{
              display: "flex",
              width: 14,
              height: 20,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              color: "text.disabled",
            }}
          >
            <DragIndicatorRoundedIcon sx={{ fontSize: 14 }} />
          </Box>
          {collapsed ? (
            <KeyboardArrowRightRoundedIcon sx={{ fontSize: 15, flexShrink: 0 }} />
          ) : (
            <KeyboardArrowDownRoundedIcon sx={{ fontSize: 15, flexShrink: 0 }} />
          )}
          <Typography
            sx={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {groupSection.title}
          </Typography>
          <Typography sx={{ fontSize: 11, color: "text.disabled" }}>
            {groupSection.itemCount}
          </Typography>
        </Box>
      </Box>
    );
  }

  return null;
}

interface TodoGroupSectionProps {
  section: TodoGroupSectionData;
  isDark: boolean;
  showNotePreview: boolean;
  getDepth: (item: TodoItemT) => number;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  collapsed: boolean;
  isGroupDragActive: boolean;
  isTodoDragActive: boolean;
  hideTodoDragSource?: boolean;
  canShiftDuringTodoDrag: boolean;
  onToggleGroupCollapsed: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
  onAddItem: (groupId: string | null) => void;
  onRenameGroup: (group: TodoGroup) => void;
  onAddGroupAbove: (group: TodoGroup) => void;
  onAddGroupBelow: (group: TodoGroup) => void;
  onPinGroupToTop: (group: TodoGroup) => void;
  onDeleteGroup: (group: TodoGroup) => void;
}

function TodoGroupSection({
  section,
  isDark,
  showNotePreview,
  getDepth,
  visibleChildParentIds,
  collapsedTodoIds,
  collapsed,
  isGroupDragActive,
  isTodoDragActive,
  hideTodoDragSource = false,
  canShiftDuringTodoDrag,
  onToggleGroupCollapsed,
  onToggleCollapsed,
  onExpand,
  onAddItem,
  onRenameGroup,
  onAddGroupAbove,
  onAddGroupBelow,
  onPinGroupToTop,
  onDeleteGroup,
}: TodoGroupSectionProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const groupId = section.group?.id ?? null;
  const sortableId = section.group ? `group:${section.group.id}` : section.key;
  const headerDroppableDisabled = section.group
    ? !isGroupDragActive && !isTodoDragActive
    : !isTodoDragActive;
  const sortable = useSortable({
    id: sortableId,
    disabled: {
      draggable: !section.group,
      droppable: headerDroppableDisabled,
    },
  });
  const deferOffscreenRows = !isGroupDragActive && !isTodoDragActive;
  const allowHeaderTransform =
    isGroupDragActive || (isTodoDragActive && canShiftDuringTodoDrag);
  const headerStyle = {
    transform: allowHeaderTransform && sortable.transform
      ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
      : undefined,
    transition:
      allowHeaderTransform && sortable.isDragging ? undefined : sortable.transition,
    opacity: sortable.isDragging ? 0 : 1,
    zIndex: sortable.isDragging ? 2 : undefined,
  };

  return (
    <Box sx={{ mb: 0.8 }}>
      <Box
        ref={section.group || isTodoDragActive ? sortable.setNodeRef : undefined}
        style={section.group || isTodoDragActive ? headerStyle : undefined}
        data-todo-group-id={section.group?.id}
        sx={{
          mx: 1,
          mt: 0.6,
          mb: 0.2,
          px: 0.5,
          height: 32,
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          borderRadius: 1,
          bgcolor: "transparent",
          "&:hover": { bgcolor: "transparent" },
          "&:hover .todo-group-drag-handle, &:focus-within .todo-group-drag-handle": {
            opacity: 1,
            transform: "scale(1)",
          },
          ...hoverCountActionParentSx(),
        }}
      >
        {section.group ? (
          <Box
            className="todo-group-drag-handle"
            {...sortable.attributes}
            {...sortable.listeners}
            sx={{
              display: "flex",
              width: 14,
              height: 20,
              alignItems: "center",
              justifyContent: "center",
              color: "text.disabled",
              cursor: "grab",
              touchAction: "none",
              flexShrink: 0,
              opacity: sortable.isDragging ? 1 : 0,
              transform: sortable.isDragging ? "scale(1)" : "scale(0.86)",
              transition: "opacity 120ms ease, transform 120ms ease",
              ":active": { cursor: "grabbing" },
            }}
          >
            <DragIndicatorRoundedIcon sx={{ fontSize: 14 }} />
          </Box>
        ) : (
          <Box sx={{ width: 14, flexShrink: 0 }} />
        )}
        {section.group && (
          <IconButton
            size="small"
            onClick={() => onToggleGroupCollapsed(section.group!.id)}
            sx={{ width: 18, height: 20, p: 0, flexShrink: 0 }}
          >
            {collapsed ? (
              <KeyboardArrowRightRoundedIcon sx={{ fontSize: 15 }} />
            ) : (
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 15 }} />
            )}
          </IconButton>
        )}
        <Typography
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 700,
            color: "text.secondary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {section.title}
        </Typography>
        <HoverCountActionSlot
          count={section.itemCount}
          isDark={isDark}
          icon={<AddRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={() => onAddItem(groupId)}
          showZeroCount
          actionLabel="在此分组新建待办"
        />
        {section.group && (
          <IconButton
            size="small"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            sx={{ width: 24, height: 24 }}
          >
            <MoreHorizRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>
      {!collapsed && !isGroupDragActive && (
        <Box
          sx={{
            ml: section.group ? 1.5 : 0,
            pl: section.group ? 0.5 : 0,
            borderLeft: 0,
          }}
        >
          {section.items.length === 0 ? (
            <Typography
              sx={{ px: 1.2, py: 0.5, fontSize: 12, color: "text.disabled" }}
            >
              暂无待办
            </Typography>
          ) : (
            section.items.map((item) => (
              <TodoItem
                key={item.id}
                item={item}
                isDark={isDark}
                draggable
                sortableDroppable={isTodoDragActive}
                deferOffscreenRendering={deferOffscreenRows}
                hideSortableDragSource={hideTodoDragSource}
                depth={getDepth(item)}
                showNotePreview={showNotePreview}
                hasChildren={visibleChildParentIds.has(item.id)}
                collapsed={collapsedTodoIds.has(item.id)}
                onToggleCollapsed={onToggleCollapsed}
                onExpand={onExpand}
              />
            ))
          )}
        </Box>
      )}
      {section.group && (
        <Menu
          open={Boolean(menuAnchor)}
          anchorEl={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <MenuItem
            onClick={() => {
              onRenameGroup(section.group!);
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <EditRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>重命名分组</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              onAddGroupAbove(section.group!);
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <ArrowUpwardRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>向上增加分组</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              onAddGroupBelow(section.group!);
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <ArrowDownwardRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>向下增加分组</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              onPinGroupToTop(section.group!);
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <ArrowUpwardRoundedIcon fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText>置顶分组</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              onDeleteGroup(section.group!);
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <DeleteOutlineRoundedIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText sx={{ color: "error.main" }}>删除分组</ListItemText>
          </MenuItem>
        </Menu>
      )}
    </Box>
  );
}

interface QuickAddTodoInputProps {
  isDark: boolean;
  selectedFilter: TodoFilter;
  groups: TodoGroup[];
  allTags: string[];
  autoFocus?: boolean;
  forceExpanded?: boolean;
  surface?: "inline" | "floating";
  parentItem?: TodoItemT | null;
  fixedGroupId?: string | null;
  placeholder?: string;
  onAfterSubmit?: (item: TodoItemT) => void;
  onCancel?: () => void;
  onInactive?: () => void;
}

interface TodoTimeHighlightSegment {
  text: string;
  kind: TodoTimeParseSpan["kind"] | null;
}

function buildTodoTimeHighlightSegments(
  text: string,
  spans: TodoTimeParseSpan[],
): TodoTimeHighlightSegment[] {
  if (!text || spans.length === 0) return [{ text, kind: null }];
  const chars = Array.from(text);
  const ranges = spans
    .filter((span) => span.start >= 0 && span.end > span.start && span.start < chars.length)
    .map((span) => ({
      ...span,
      start: Math.max(0, Math.min(chars.length, span.start)),
      end: Math.max(0, Math.min(chars.length, span.end)),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: TodoTimeHighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) {
      out.push({ text: chars.slice(cursor, range.start).join(""), kind: null });
    }
    out.push({ text: chars.slice(range.start, range.end).join(""), kind: range.kind });
    cursor = range.end;
  }
  if (cursor < chars.length) {
    out.push({ text: chars.slice(cursor).join(""), kind: null });
  }
  return out.length > 0 ? out : [{ text, kind: null }];
}

export const QuickAddTodoInput = memo(function QuickAddTodoInput({
  isDark,
  selectedFilter,
  groups,
  allTags,
  autoFocus = false,
  forceExpanded = false,
  surface = "inline",
  parentItem = null,
  fixedGroupId,
  placeholder,
  onAfterSubmit,
  onCancel,
  onInactive,
}: QuickAddTodoInputProps) {
  const [draftText, setDraftText] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [draftNoteOpen, setDraftNoteOpen] = useState(false);
  const [draftDue, setDraftDue] = useState<number | null>(null);
  const [draftDueEnd, setDraftDueEnd] = useState<number | null>(null);
  const [draftReminderEnabled, setDraftReminderEnabled] = useState(false);
  const [draftMarked, setDraftMarked] = useState(false);
  const [draftPriority, setDraftPriority] = useState<TodoPriority | null>(
    DEFAULT_DRAFT_PRIORITY,
  );
  const [draftGroupId, setDraftGroupId] = useState<string>("none");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftTagText, setDraftTagText] = useState("");
  const [quickAddExpanded, setQuickAddExpanded] = useState(false);
  const [parsedTodoTime, setParsedTodoTime] = useState<TodoTimeParseResult | null>(null);
  const [dueAnchor, setDueAnchor] = useState<HTMLElement | null>(null);
  const [draftPriorityAnchor, setDraftPriorityAnchor] =
    useState<HTMLElement | null>(null);
  const [draftTagAnchor, setDraftTagAnchor] = useState<HTMLElement | null>(null);
  const quickAddRootRef = useRef<HTMLDivElement | null>(null);
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  const draftNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const parseRequestRef = useRef(0);
  const draftPriorityOption = useMemo(() => priorityMeta(draftPriority), [draftPriority]);
  const hasFixedGroup = fixedGroupId !== undefined;
  const canPickGroup =
    !hasFixedGroup && parentItem == null && selectedFilter.kind === "list" && groups.length > 0;
  const selectedDraftGroup = groups.find((group) => group.id === draftGroupId) ?? null;
  const [draftGroupAnchor, setDraftGroupAnchor] =
    useState<HTMLElement | null>(null);
  const initialDraftGroupId =
    fixedGroupId === null ? "none" : fixedGroupId ?? groups[0]?.id ?? "none";

  useEffect(() => {
    setDraftGroupId(initialDraftGroupId);
  }, [initialDraftGroupId, selectedFilter]);

  useEffect(() => {
    if (!autoFocus) return;
    const focusInput = () => draftInputRef.current?.focus();
    const frame = window.requestAnimationFrame(focusInput);
    const timer = window.setTimeout(focusInput, 40);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [autoFocus]);

  useEffect(() => {
    parseRequestRef.current += 1;
    const requestId = parseRequestRef.current;
    if (!draftText.trim() || draftDue != null) {
      setParsedTodoTime(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void parseTodoTimeText(draftText)
        .then((result) => {
          if (parseRequestRef.current !== requestId) return;
          setParsedTodoTime(result.dueAt != null ? result : null);
        })
        .catch(() => {
          if (parseRequestRef.current === requestId) {
            setParsedTodoTime(null);
          }
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [draftDue, draftText]);

  const parsedAutoTime = parsedTodoTime?.dueAt != null ? parsedTodoTime : null;
  const effectiveDraftDue = draftDue ?? parsedAutoTime?.dueAt ?? null;
  const effectiveDraftDueEnd =
    draftDue != null ? draftDueEnd : parsedAutoTime?.dueEndAt ?? null;
  const effectiveDraftReminderEnabled =
    draftDue != null ? draftReminderEnabled : parsedAutoTime?.reminderEnabled === true;
  const quickAddOverlayOpen =
    dueAnchor != null ||
    draftPriorityAnchor != null ||
    draftTagAnchor != null ||
    draftGroupAnchor != null;
  const showQuickAddControls = forceExpanded || quickAddExpanded || quickAddOverlayOpen;
  const floatingSurface = surface === "floating";
  const hasAutoTimeHighlight =
    parsedAutoTime != null && parsedAutoTime.spans.some((span) => span.kind !== "reminder");
  const timeHighlightSegments = useMemo(
    () =>
      hasAutoTimeHighlight
        ? buildTodoTimeHighlightSegments(draftText, parsedAutoTime?.spans ?? [])
        : [{ text: draftText, kind: null }],
    [draftText, hasAutoTimeHighlight, parsedAutoTime],
  );

  const openDraftNote = () => {
    setQuickAddExpanded(true);
    setDraftNoteOpen(true);
    requestAnimationFrame(() => draftNoteRef.current?.focus());
  };

  const collapseQuickAddIfInactive = () => {
    window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof Node &&
        quickAddRootRef.current?.contains(activeElement)
      ) {
        return;
      }
      if (dueAnchor || draftPriorityAnchor || draftTagAnchor || draftGroupAnchor) return;
      setQuickAddExpanded(false);
      onInactive?.();
    }, 120);
  };

  const toggleDraftTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    setDraftTags((cur) =>
      cur.includes(trimmed)
        ? cur.filter((existing) => existing !== trimmed)
        : [...cur, trimmed],
    );
  };

  const submitDraftTag = () => {
    const trimmed = draftTagText.trim();
    if (!trimmed) return;
    setDraftTags((cur) => (cur.includes(trimmed) ? cur : [...cur, trimmed]));
    setDraftTagText("");
  };

  const resetDraft = () => {
    setDraftText("");
    setDraftNote("");
    setDraftNoteOpen(false);
    setDraftDue(null);
    setDraftDueEnd(null);
    setDraftReminderEnabled(false);
    setDraftMarked(false);
    setDraftPriority(DEFAULT_DRAFT_PRIORITY);
    setDraftGroupId(initialDraftGroupId);
    setDraftTags([]);
    setDraftTagText("");
    setQuickAddExpanded(false);
    setParsedTodoTime(null);
    setDueAnchor(null);
    setDraftPriorityAnchor(null);
    setDraftTagAnchor(null);
    setDraftGroupAnchor(null);
  };

  const submitDraft = () => {
    const autoTime = draftDue == null ? parsedAutoTime : null;
    const autoCleanedText = autoTime?.cleanedText.trim() ?? "";
    const text = autoCleanedText || draftText.trim();
    if (!text) return;

    const store = useTodoStore.getState();
    const targetListId =
      parentItem != null
        ? parentItem.listId
      : selectedFilter.kind === "list"
        ? selectedFilter.id
        : selectedFilter.kind === "inbox"
          ? store.ensureInboxList()
        : store.ensureDefaultList();
    const targetGroupId =
      parentItem != null
        ? parentItem.groupId ?? null
      : hasFixedGroup
        ? fixedGroupId
      : selectedFilter.kind === "list"
        ? (draftGroupId !== "none" ? draftGroupId : groups[0]?.id)
        : null;
    const item = store.addItem(targetListId, text, {
      groupId: targetGroupId ?? null,
      parentId: parentItem?.id ?? null,
    });

    if (item) {
      const patch: Partial<Omit<TodoItemT, "id" | "createdAt">> = {};
      const note = draftNote.trim();
      if (note) {
        patch.note = plainTextToNoteHtml(note);
      }
      if (draftTags.length > 0) {
        patch.tags = draftTags;
      }
      if (draftMarked) {
        patch.marked = true;
      }
      if (draftPriority !== DEFAULT_DRAFT_PRIORITY) {
        patch.priority = draftPriority;
      }
      if (Object.keys(patch).length > 0) {
        useTodoStore.getState().updateItem(item.id, patch);
      }
      if (draftDue != null) {
        useTodoStore
          .getState()
          .setDueRange(item.id, draftDue, draftDueEnd, draftReminderEnabled);
      } else if (autoTime?.dueAt != null) {
        useTodoStore
          .getState()
          .setDueRange(
            item.id,
            autoTime.dueAt,
            autoTime.dueEndAt,
            autoTime.reminderEnabled,
          );
      } else if (selectedFilter.kind === "today") {
        // Keep tasks added from the "today" filter visible in that filter.
        const d = new Date();
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        useTodoStore.getState().setDueAt(item.id, start);
      }
      onAfterSubmit?.(item);
    }

    resetDraft();
  };

  const onAddKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      openDraftNote();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submitDraft();
    } else if (e.key === "Escape" && !draftText.trim()) {
      e.preventDefault();
      resetDraft();
      onCancel?.();
    }
  };

  const onDraftNoteKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitDraft();
    }
  };

  const onDraftTagKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      submitDraftTag();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraftTagAnchor(null);
    }
  };

  return (
    <Box
      sx={{
        px: floatingSurface ? 0 : 2,
        py: floatingSurface ? 0 : showQuickAddControls ? 1 : 0.75,
        borderBottom: floatingSurface ? 0 : 1,
        borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.04),
      }}
    >
      <Box
        ref={quickAddRootRef}
        onFocus={() => setQuickAddExpanded(true)}
        onBlur={collapseQuickAddIfInactive}
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: showQuickAddControls ? (floatingSurface ? 1.15 : 0.55) : 0,
          px: floatingSurface ? 2.2 : showQuickAddControls ? 1 : 0,
          py: floatingSurface ? 1.5 : showQuickAddControls ? 0.7 : 0,
          border: floatingSurface ? 0 : showQuickAddControls ? 1 : 0,
          borderRadius: floatingSurface ? 0 : showQuickAddControls ? "10px" : 0,
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.22 : 0.24),
          bgcolor: floatingSurface
            ? "transparent"
          : showQuickAddControls
            ? alpha(isDark ? "#f8fafc" : "#ffffff", isDark ? 0.03 : 0.38)
            : "transparent",
        }}
      >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box
          sx={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            height: showQuickAddControls ? 26 : 28,
            display: "flex",
            alignItems: "center",
          }}
        >
          {draftText && hasAutoTimeHighlight && (
            <Box
              aria-hidden
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                overflow: "hidden",
                whiteSpace: "pre",
                pointerEvents: "none",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 400,
                letterSpacing: 0,
                lineHeight: "28px",
                color: "text.primary",
              }}
            >
              {timeHighlightSegments.map((segment, index) => (
                <Box
                  key={`${index}-${segment.text}`}
                  component="span"
                  sx={
                    segment.kind == null
                      ? undefined
                      : {
                          borderRadius: 0.45,
                          bgcolor:
                            segment.kind === "reminder"
                              ? alpha("#f59e0b", isDark ? 0.28 : 0.18)
                              : alpha("#2563eb", isDark ? 0.32 : 0.16),
                          boxDecorationBreak: "clone",
                          WebkitBoxDecorationBreak: "clone",
                          color:
                            segment.kind === "reminder"
                              ? isDark
                                ? "#fde68a"
                                : "#92400e"
                              : isDark
                                ? "#bfdbfe"
                                : "#1d4ed8",
                          fontWeight: 700,
                        }
                  }
                >
                  {segment.text}
                </Box>
              ))}
            </Box>
          )}
          <TextField
            inputRef={draftInputRef}
            value={draftText}
            onChange={(e) => {
              setQuickAddExpanded(true);
              setDraftText(e.target.value);
            }}
            onKeyDown={onAddKeyDown}
            placeholder={placeholder ?? (showQuickAddControls ? "准备做什么？" : "+ 添加任务")}
            fullWidth
            variant="standard"
            slotProps={{
              input: {
                disableUnderline: true,
                sx: {
                  height: showQuickAddControls ? 26 : 28,
                  display: "flex",
                  alignItems: "center",
                  fontSize: 14,
                  lineHeight: showQuickAddControls ? "26px" : "28px",
                  "& input": {
                    p: 0,
                    height: showQuickAddControls ? 26 : 28,
                    lineHeight: showQuickAddControls ? "26px" : "28px",
                    letterSpacing: 0,
                    color: hasAutoTimeHighlight ? "transparent" : "inherit",
                    caretColor: isDark ? "#f8fafc" : "#0f172a",
                  },
                  "& input::placeholder": {
                    color: "text.secondary",
                    opacity: 0.72,
                  },
                },
              },
            }}
          />
        </Box>
      </Box>
      {showQuickAddControls && draftNoteOpen && (
        <TextField
          inputRef={draftNoteRef}
          value={draftNote}
          onChange={(e) => setDraftNote(e.target.value)}
          onKeyDown={onDraftNoteKeyDown}
          placeholder="描述"
          fullWidth
          multiline
          minRows={2}
          maxRows={5}
          variant="standard"
          slotProps={{
            input: {
              disableUnderline: true,
              sx: {
                fontSize: 13,
                lineHeight: 1.5,
                px: 1,
                py: 0.8,
                borderRadius: 1,
                bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.04),
              },
            },
          }}
        />
      )}
      {showQuickAddControls && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.6, minWidth: 0 }}>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 0.35,
              overflow: "hidden",
            }}
          >
          <Tooltip title="设置截止时间">
            <IconButton
              size="small"
              onClick={(e) => setDueAnchor(e.currentTarget)}
              sx={{ width: 24, height: 24, flexShrink: 0 }}
            >
              <CalendarTodayRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          {effectiveDraftDue != null && (
            <Chip
              size="small"
              icon={
                effectiveDraftReminderEnabled ? (
                  <AlarmRoundedIcon sx={{ fontSize: 14, color: "warning.main" }} />
                ) : undefined
              }
              label={
                draftDue != null
                  ? formatDueShort(draftDue, draftDueEnd)
                  : parsedAutoTime?.label ??
                    formatDueShort(effectiveDraftDue, effectiveDraftDueEnd)
              }
              onDelete={() => {
                if (draftDue != null) {
                  setDraftDue(null);
                  setDraftDueEnd(null);
                  setDraftReminderEnabled(false);
                  return;
                }
                if (parsedAutoTime != null) {
                  setDraftText(parsedAutoTime.cleanedText);
                  setParsedTodoTime(null);
                }
              }}
              sx={{ height: 24, fontSize: 11 }}
            />
          )}
          <Tooltip title={draftMarked ? "取消标记" : "标记"}>
            <IconButton
              size="small"
              onClick={() => setDraftMarked((marked) => !marked)}
              sx={{ width: 24, height: 24, flexShrink: 0 }}
            >
              {draftMarked ? (
                <FlagRoundedIcon sx={{ fontSize: 16, color: "warning.main" }} />
              ) : (
                <OutlinedFlagRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title={`设置优先级：${draftPriorityOption.label}`}>
            <Button
              size="small"
              onClick={(e) => setDraftPriorityAnchor(e.currentTarget)}
              sx={{
                height: 24,
                minWidth: 0,
                px: 0.7,
                color: draftPriorityOption.color,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {draftPriorityOption.emoji}
            </Button>
          </Tooltip>
          <Tooltip title="设置标签">
            <Button
              size="small"
              onClick={(e) => setDraftTagAnchor(e.currentTarget)}
              startIcon={<LabelRoundedIcon sx={{ fontSize: 15 }} />}
              sx={{
                height: 24,
                minWidth: 0,
                px: 0.7,
                color: "text.secondary",
                flexShrink: 0,
                "& .MuiButton-startIcon": { mr: 0.35 },
              }}
            >
              {draftTags.length > 0 ? `标签 ${draftTags.length}` : "标签"}
            </Button>
          </Tooltip>
          {draftTags.map((tag) => (
            <Chip
              key={tag}
              size="small"
              label={`#${tag}`}
              onDelete={() =>
                setDraftTags((cur) => cur.filter((existing) => existing !== tag))
              }
              sx={{ height: 22, fontSize: 11, flexShrink: 0 }}
            />
          ))}
          {canPickGroup && (
            <Tooltip title="选择分组">
              <Button
                size="small"
                onClick={(e) => setDraftGroupAnchor(e.currentTarget)}
                sx={{
                  height: 24,
                  minWidth: 0,
                  maxWidth: 88,
                  px: 0.7,
                  color: "text.secondary",
                  flexShrink: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selectedDraftGroup?.name ?? "未分组"}
              </Button>
            </Tooltip>
          )}
          </Box>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />}
            disabled={!draftText.trim()}
            onClick={submitDraft}
            sx={{
              minWidth: 54,
              height: 24,
              px: 0.8,
              borderRadius: "8px",
              fontSize: 12,
              flexShrink: 0,
              "& .MuiButton-startIcon": { mr: 0.25 },
            }}
          >
            添加
          </Button>
        </Box>
      )}
      </Box>
      {dueAnchor && (
        <DueDatePopover
          anchorEl={dueAnchor}
          value={draftDue}
          endValue={draftDueEnd}
          reminderEnabled={draftReminderEnabled}
          onClose={() => setDueAnchor(null)}
          onChange={(start, end, reminderEnabled) => {
            setDraftDue(start);
            setDraftDueEnd(end ?? null);
            setDraftReminderEnabled(start != null && reminderEnabled === true);
            setParsedTodoTime(null);
          }}
        />
      )}
      {draftPriorityAnchor && (
        <Menu
          open
          anchorEl={draftPriorityAnchor}
          onClose={() => setDraftPriorityAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
        >
          {TODO_PRIORITY_OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              selected={option.value === draftPriority}
              onClick={() => {
                setDraftPriority((current) =>
                  current === option.value ? DEFAULT_DRAFT_PRIORITY : option.value,
                );
                setDraftPriorityAnchor(null);
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 24,
                  mr: 1,
                  color: option.color,
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {option.emoji}
              </Box>
              {option.label}
            </MenuItem>
          ))}
        </Menu>
      )}
      {draftGroupAnchor && (
        <Menu
          open
          anchorEl={draftGroupAnchor}
          onClose={() => setDraftGroupAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
        >
          {groups.map((group) => (
            <MenuItem
              key={group.id}
              selected={draftGroupId === group.id}
              onClick={() => {
                setDraftGroupId(group.id);
                setDraftGroupAnchor(null);
              }}
            >
              <ListItemText>{group.name}</ListItemText>
              {draftGroupId === group.id && (
                <DoneRoundedIcon sx={{ fontSize: 16, ml: 1, opacity: 0.6 }} />
              )}
            </MenuItem>
          ))}
        </Menu>
      )}
      {draftTagAnchor && (
        <Menu
          open
          anchorEl={draftTagAnchor}
          onClose={() => setDraftTagAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          slotProps={{ paper: { sx: { width: 280, p: 1 } } }}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            sx={{ display: "flex", flexDirection: "column", gap: 1 }}
          >
            <TextField
              autoFocus
              size="small"
              fullWidth
              value={draftTagText}
              onChange={(e) => setDraftTagText(e.target.value)}
              onKeyDown={onDraftTagKeyDown}
              onBlur={submitDraftTag}
              placeholder="输入标签名后回车"
            />
            {draftTags.length > 0 && (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {draftTags.map((tag) => (
                  <Chip
                    key={tag}
                    size="small"
                    label={`#${tag}`}
                    onDelete={() =>
                      setDraftTags((cur) =>
                        cur.filter((existing) => existing !== tag),
                      )
                    }
                    sx={{ height: 22, fontSize: 11 }}
                  />
                ))}
              </Box>
            )}
            <Divider />
            {allTags.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: "text.disabled", px: 0.4 }}>
                暂无标签
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {allTags.map((tag) => {
                  const active = draftTags.includes(tag);
                  return (
                    <Chip
                      key={tag}
                      size="small"
                      label={`#${tag}`}
                      variant={active ? "filled" : "outlined"}
                      color={active ? "primary" : "default"}
                      onClick={() => toggleDraftTag(tag)}
                      sx={{
                        height: 22,
                        fontSize: 11,
                        bgcolor: active
                          ? undefined
                          : alpha(isDark ? "#f8fafc" : "#0f172a", 0.04),
                      }}
                    />
                  );
                })}
              </Box>
            )}
          </Box>
        </Menu>
      )}
    </Box>
  );
});

function labelForFilter(
  f: TodoFilter,
  list: TodoList | null,
  folder: TodoFolder | null,
  customFilter: SavedTodoFilter | null,
): string {
  switch (f.kind) {
    case "folder":
      return folder?.name ?? "未知文件夹";
    case "list":
      return list?.name ?? "未知清单";
    case "recent7":
      return "最近7天";
    case "today":
      return "今天";
    case "inbox":
      return "收集箱";
    case "marked":
      return "标记";
    case "tag":
      return `#${f.tag}`;
    case "advanced":
      return "自定义过滤";
    case "customFilter":
      return customFilter?.name ?? "未知过滤器";
    case "quadrant":
      return "四象任务";
    case "calendar":
      return "日历";
    case "completed":
      return "已完成";
    case "abandoned":
      return "已放弃";
    case "trash":
      return "垃圾桶";
  }
}

function formatDueShort(ts: number, endTs: number | null = null): string {
  const d = new Date(ts);
  const end = endTs != null && endTs > ts ? new Date(endTs) : null;
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const startTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (end) {
    const sameEndDay =
      d.getFullYear() === end.getFullYear() &&
      d.getMonth() === end.getMonth() &&
      d.getDate() === end.getDate();
    const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    if (sameEndDay) {
      return sameDay
        ? `今天 ${startTime}-${endTime}`
        : `${d.getMonth() + 1}/${d.getDate()} ${startTime}-${endTime}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${startTime}-${end.getMonth() + 1}/${end.getDate()} ${endTime}`;
  }
  if (sameDay) return `今天 ${startTime}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${startTime}`;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface AdvancedFilterBarProps {
  lists: TodoList[];
  tags: string[];
  value: AdvancedTodoFilter;
  onChange: (patch: Partial<AdvancedTodoFilter>) => void;
  onReset: () => void;
  onSave?: () => void;
  saveLabel?: string;
  isDark: boolean;
}

interface DateRangeFilterFieldProps {
  start: number | null;
  end: number | null;
  isDark: boolean;
  onChange: (start: number | null, end: number | null) => void;
}

interface RangePickersDayProps extends PickerDayProps {
  rangeStart?: number | null;
  rangeEnd?: number | null;
  isDark?: boolean;
}

function formatFilterRangeDate(value: number | null): string {
  if (value == null) return "";
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function RangePickersDay(props: RangePickersDayProps) {
  const { day, rangeStart = null, rangeEnd = null, isDark = false, sx, ...other } = props;
  const dayMs = startOfLocalDayMs(day.valueOf());
  const start = rangeStart ?? rangeEnd;
  const end = rangeEnd ?? rangeStart;
  const normalizedStart = start != null && end != null ? Math.min(start, end) : start;
  const normalizedEnd = start != null && end != null ? Math.max(start, end) : end;
  const isStart = rangeStart != null && dayMs === rangeStart;
  const isEnd = rangeEnd != null && dayMs === rangeEnd;
  const isInRange =
    normalizedStart != null &&
    normalizedEnd != null &&
    dayMs > normalizedStart &&
    dayMs < normalizedEnd;

  return (
    <PickerDay
      {...other}
      day={day}
      selected={isStart || isEnd}
      sx={{
        ...(isInRange
          ? {
              borderRadius: 0,
              bgcolor: alpha(isDark ? "#93c5fd" : "#2563eb", isDark ? 0.22 : 0.12),
            }
          : null),
        ...(isStart || isEnd
          ? {
              bgcolor: "primary.main",
              color: "primary.contrastText",
              "&:hover, &:focus": {
                bgcolor: "primary.dark",
              },
            }
          : null),
        ...sx,
      }}
    />
  );
}

function DateRangeFilterField({
  start,
  end,
  isDark,
  onChange,
}: DateRangeFilterFieldProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [draftStart, setDraftStart] = useState<number | null>(start);
  const [draftEnd, setDraftEnd] = useState<number | null>(end);
  const [selectingEnd, setSelectingEnd] = useState(false);

  const open = Boolean(anchorEl);
  const label =
    start != null || end != null
      ? `${formatFilterRangeDate(start) || "开始"} - ${formatFilterRangeDate(end) || "结束"}`
      : "选择日期范围";

  const openPicker = (event: MouseEvent<HTMLButtonElement>) => {
    setDraftStart(start);
    setDraftEnd(end);
    setSelectingEnd(start != null && end == null);
    setAnchorEl(event.currentTarget);
  };

  const pickDay = (date: Dayjs | null) => {
    if (!date) return;
    const dayMs = startOfLocalDayMs(date.valueOf());
    if (draftStart == null || !selectingEnd) {
      setDraftStart(dayMs);
      setDraftEnd(null);
      setSelectingEnd(true);
      return;
    }
    if (dayMs < draftStart) {
      setDraftEnd(draftStart);
      setDraftStart(dayMs);
    } else {
      setDraftEnd(dayMs);
    }
    setSelectingEnd(false);
  };

  const commit = () => {
    onChange(draftStart, draftEnd ?? draftStart);
    setAnchorEl(null);
  };
  const RangeDay = useCallback(
    (dayProps: PickerDayProps) => (
      <RangePickersDay
        {...dayProps}
        rangeStart={draftStart}
        rangeEnd={draftEnd}
        isDark={isDark}
      />
    ),
    [draftEnd, draftStart, isDark],
  );

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={openPicker}
        sx={{
          height: 40,
          justifyContent: "flex-start",
          px: 1.5,
          color: start != null || end != null ? "text.primary" : "text.secondary",
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.22 : 0.18),
          textTransform: "none",
        }}
      >
        {label}
      </Button>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Box sx={{ p: 1, width: 324 }}>
          <Typography sx={{ px: 1, pt: 0.5, pb: 0.25, fontSize: 13, fontWeight: 600 }}>
            {draftStart == null
              ? "选择开始日期"
              : selectingEnd
                ? "选择结束日期"
                : "已选择日期范围"}
          </Typography>
          <DateCalendar
            value={dayjs(draftEnd ?? draftStart ?? Date.now())}
            onChange={pickDay}
            slots={{ day: RangeDay }}
            sx={{
              width: "100%",
              maxHeight: 320,
              "& .MuiPickersDay-today": {
                borderColor: "primary.main",
                fontWeight: 700,
              },
            }}
          />
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", px: 1, pb: 0.5 }}>
            <Button
              size="small"
              onClick={() => {
                setDraftStart(null);
                setDraftEnd(null);
                onChange(null, null);
                setAnchorEl(null);
              }}
            >
              清除
            </Button>
            <Button size="small" onClick={() => setAnchorEl(null)}>
              取消
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={draftStart == null}
              onClick={commit}
            >
              确定
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}

function AdvancedFilterBar({
  lists,
  tags,
  value,
  onChange,
  onReset,
  onSave,
  saveLabel = "保存",
  isDark,
}: AdvancedFilterBarProps) {
  const activeLists = lists
    .filter((list) => list.archivedAt == null)
    .sort((a, b) => a.order - b.order);
  const todayStart = startOfLocalDayMs(Date.now());

  const setTimeFilter = (time: AdvancedTodoFilter["time"]) => {
    if (time === "customRange") {
      onChange({
        time,
        timeRangeStart: value.timeRangeStart ?? todayStart,
        timeRangeEnd: value.timeRangeEnd ?? value.timeRangeStart ?? todayStart,
      });
      return;
    }
    onChange({ time, timeRangeStart: null, timeRangeEnd: null });
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box
        sx={{
          px: 2,
          py: 1.2,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 1,
          borderBottom: 1,
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.04),
        }}
      >
        <FormControl size="small">
          <InputLabel id="advanced-logic-label">关系</InputLabel>
          <Select
            labelId="advanced-logic-label"
            label="关系"
            value={value.logic}
            onChange={(e) =>
              onChange({ logic: e.target.value as AdvancedTodoFilter["logic"] })
            }
          >
            <MenuItem value="and">且（全部满足）</MenuItem>
            <MenuItem value="or">或（任一满足）</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="关键字"
          value={value.keyword}
          onChange={(e) => onChange({ keyword: e.target.value })}
          placeholder="包含文本"
        />
        <FormControl size="small">
          <InputLabel id="advanced-list-label">清单</InputLabel>
          <Select
            labelId="advanced-list-label"
            label="清单"
            value={value.listId}
            onChange={(e) => onChange({ listId: e.target.value })}
          >
            <MenuItem value="all">全部清单</MenuItem>
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
        <FormControl size="small">
          <InputLabel id="advanced-time-label">时间</InputLabel>
          <Select
            labelId="advanced-time-label"
            label="时间"
            value={value.time}
            onChange={(e) => setTimeFilter(e.target.value as AdvancedTodoFilter["time"])}
          >
            <MenuItem value="all">全部时间</MenuItem>
            <MenuItem value="overdue">已逾期</MenuItem>
            <MenuItem value="today">今天</MenuItem>
            <MenuItem value="thisWeek">本周</MenuItem>
            <MenuItem value="customRange">自定义范围</MenuItem>
            <MenuItem value="noDue">无时间</MenuItem>
          </Select>
        </FormControl>
        {value.time === "customRange" && (
          <DateRangeFilterField
            start={value.timeRangeStart}
            end={value.timeRangeEnd}
            isDark={isDark}
            onChange={(start, end) => {
              onChange({
                time: "customRange",
                timeRangeStart: start,
                timeRangeEnd: end,
              });
            }}
          />
        )}
        <FormControl size="small">
          <InputLabel id="advanced-priority-label">优先级</InputLabel>
          <Select
            labelId="advanced-priority-label"
            label="优先级"
            value={value.priority}
            onChange={(e) =>
              onChange({ priority: e.target.value as AdvancedTodoFilter["priority"] })
            }
          >
            <MenuItem value="all">全部优先级</MenuItem>
            {TODO_PRIORITY_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.emoji} {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="advanced-tag-label">标签</InputLabel>
          <Select
            labelId="advanced-tag-label"
            label="标签"
            value={value.tag}
            onChange={(e) => onChange({ tag: e.target.value })}
          >
            <MenuItem value="all">全部标签</MenuItem>
            {tags.map((tag) => (
              <MenuItem key={tag} value={tag}>
                #{tag}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="advanced-marked-label">标记</InputLabel>
          <Select
            labelId="advanced-marked-label"
            label="标记"
            value={value.marked}
            onChange={(e) =>
              onChange({ marked: e.target.value as AdvancedTodoFilter["marked"] })
            }
          >
            <MenuItem value="all">全部标记</MenuItem>
            <MenuItem value="marked">已标记</MenuItem>
            <MenuItem value="unmarked">未标记</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="advanced-status-label">状态</InputLabel>
          <Select
            labelId="advanced-status-label"
            label="状态"
            value={value.status}
            onChange={(e) => onChange({ status: e.target.value as AdvancedTodoFilter["status"] })}
          >
            <MenuItem value="all">全部状态</MenuItem>
            <MenuItem value="pending">未完成</MenuItem>
            <MenuItem value="completed">已完成</MenuItem>
            <MenuItem value="abandoned">已放弃</MenuItem>
          </Select>
        </FormControl>
        <Box sx={{ display: "flex", gap: 0.75, minHeight: 40 }}>
          <Button
            size="small"
            onClick={onReset}
            sx={{ flex: 1, minWidth: 0, px: 1 }}
          >
            重置
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={onSave}
            disabled={!onSave}
            sx={{ flex: 1, minWidth: 0, px: 1 }}
          >
            {saveLabel}
          </Button>
        </Box>
      </Box>
    </LocalizationProvider>
  );
}

function labelForDetail(f: DetailFilter): string {
  switch (f.kind) {
    case "all":
      return "";
    case "overdue":
      return "已逾期";
    case "today":
      return "今天截止";
    case "thisWeek":
      return "本周截止";
    case "noDue":
      return "无截止时间";
    case "tag":
      return `#${f.tag}`;
  }
}

interface FilterDropdownProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  current: DetailFilter;
  onPick: (f: DetailFilter) => void;
  showCompleted: boolean;
  onToggleShowCompleted: () => void;
  showFilterOptions: boolean;
  detailViewMode: TodoDetailViewMode;
  onDetailViewModeChange: (mode: TodoDetailViewMode) => void;
  showBoardOption: boolean;
  showTimelineOption: boolean;
  showDisplayOptions: boolean;
  showNotePreview: boolean;
  onToggleNotePreview: () => void;
  canExportChecklist: boolean;
  onExportChecklist: () => void;
  completedArchiveSort: CompletedArchiveSort | null;
  onCompletedArchiveSortChange: (
    updater: (current: CompletedArchiveSort) => CompletedArchiveSort,
  ) => void;
  tags: string[];
  tagSubAnchor: HTMLElement | null;
  onOpenTagSub: (el: HTMLElement) => void;
  onCloseTagSub: () => void;
}

function FilterDropdown({
  anchorEl,
  onClose,
  current,
  onPick,
  showCompleted,
  onToggleShowCompleted,
  showFilterOptions,
  detailViewMode,
  onDetailViewModeChange,
  showBoardOption,
  showTimelineOption,
  showDisplayOptions,
  showNotePreview,
  onToggleNotePreview,
  canExportChecklist,
  onExportChecklist,
  completedArchiveSort,
  onCompletedArchiveSortChange,
  tags,
  tagSubAnchor,
  onOpenTagSub,
  onCloseTagSub,
}: FilterDropdownProps) {
  const options: Array<{
    f: DetailFilter;
    label: string;
    icon: ReactNode;
  }> = [
    { f: { kind: "all" }, label: "不限条件", icon: <FilterListRoundedIcon fontSize="small" /> },
    { f: { kind: "overdue" }, label: "已逾期", icon: <EventBusyRoundedIcon fontSize="small" /> },
    { f: { kind: "today" }, label: "今天截止", icon: <EventRoundedIcon fontSize="small" /> },
    { f: { kind: "thisWeek" }, label: "本周截止", icon: <DateRangeRoundedIcon fontSize="small" /> },
    { f: { kind: "noDue" }, label: "无截止时间", icon: <EventAvailableRoundedIcon fontSize="small" /> },
  ];
  return (
    <>
      <Menu
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={onClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {showFilterOptions && (
          <MenuItem
            onClick={() => {
              onToggleShowCompleted();
              onClose();
            }}
          >
            <ListItemIcon>
              {showCompleted ? (
                <CheckBoxRoundedIcon fontSize="small" />
              ) : (
                <CheckBoxOutlineBlankRoundedIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText>显示全部任务</ListItemText>
          </MenuItem>
        )}
        {canExportChecklist && (
          <MenuItem
            onClick={() => {
              onExportChecklist();
              onClose();
            }}
          >
            <ListItemIcon>
              <ContentCopyRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>复制到剪贴板</ListItemText>
          </MenuItem>
        )}
        {showFilterOptions && (
          <>
            <Divider />
            {options.map((o) => (
              <MenuItem
                key={o.f.kind}
                selected={
                  o.f.kind === current.kind &&
                  current.kind !== "tag"
                }
                onClick={() => onPick(o.f)}
              >
                <ListItemIcon>{o.icon}</ListItemIcon>
                <ListItemText>{o.label}</ListItemText>
                {o.f.kind === current.kind &&
                  current.kind !== "tag" && (
                  <DoneRoundedIcon sx={{ fontSize: 16, ml: 1, opacity: 0.6 }} />
                )}
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              onClick={(e: MouseEvent<HTMLLIElement>) => onOpenTagSub(e.currentTarget)}
              selected={current.kind === "tag"}
            >
              <ListItemIcon>
                <LabelRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                {current.kind === "tag" ? `按标签：#${current.tag}` : "按标签"}
              </ListItemText>
              <ChevronRightRoundedIcon fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
            </MenuItem>
          </>
        )}
        {showDisplayOptions && [
          <Divider key="display-options-divider" />,
          showBoardOption ? (
            <MenuItem
              key="board-view"
              selected={detailViewMode === "board"}
              onClick={() => {
                onDetailViewModeChange(detailViewMode === "board" ? "list" : "board");
                onClose();
              }}
            >
              <ListItemIcon>
                <ViewKanbanRoundedIcon sx={{ fontSize: 16 }} />
              </ListItemIcon>
              <ListItemText>看板视图</ListItemText>
              {detailViewMode === "board" && (
                <DoneRoundedIcon sx={{ fontSize: 16, ml: 1, opacity: 0.6 }} />
              )}
            </MenuItem>
          ) : null,
          showTimelineOption ? (
            <MenuItem
              key="timeline-view"
              selected={detailViewMode === "timeline"}
              onClick={() => {
                onDetailViewModeChange(
                  detailViewMode === "timeline" ? "list" : "timeline",
                );
                onClose();
              }}
            >
              <ListItemIcon>
                <ViewTimelineRoundedIcon sx={{ fontSize: 16 }} />
              </ListItemIcon>
              <ListItemText>时间线视图</ListItemText>
              {detailViewMode === "timeline" && (
                <DoneRoundedIcon sx={{ fontSize: 16, ml: 1, opacity: 0.6 }} />
              )}
            </MenuItem>
          ) : null,
          <MenuItem
            key="note-preview"
            onClick={() => {
              onToggleNotePreview();
              onClose();
            }}
          >
            <ListItemIcon>
              {showNotePreview ? (
                <DoneRoundedIcon sx={{ fontSize: 16 }} />
              ) : (
                <SubjectRoundedIcon sx={{ fontSize: 16 }} />
              )}
            </ListItemIcon>
            <ListItemText>{showNotePreview ? "隐藏描述" : "显示描述"}</ListItemText>
          </MenuItem>,
        ]}
        {completedArchiveSort && [
          <Divider key="completed-sort-divider" />,
          <MenuItem key="completed-sort-title" disabled>
            <ListItemIcon>
              <SortRoundedIcon sx={{ fontSize: 16 }} />
            </ListItemIcon>
            <ListItemText>已完成排序</ListItemText>
          </MenuItem>,
          ...COMPLETED_ARCHIVE_SORT_FIELDS.map((option) => (
            <MenuItem
              key={`completed-sort-${option.field}`}
              selected={completedArchiveSort.field === option.field}
              onClick={() =>
                onCompletedArchiveSortChange((currentSort) => ({
                  ...currentSort,
                  field: option.field,
                }))
              }
            >
              <ListItemIcon>
                {completedArchiveSort.field === option.field && (
                  <DoneRoundedIcon sx={{ fontSize: 16 }} />
                )}
              </ListItemIcon>
              <ListItemText>{option.label}</ListItemText>
            </MenuItem>
          )),
          <Divider key="completed-sort-direction-divider" />,
          <MenuItem
            key="completed-sort-asc"
            selected={completedArchiveSort.direction === "asc"}
            onClick={() =>
              onCompletedArchiveSortChange((currentSort) => ({
                ...currentSort,
                direction: "asc",
              }))
            }
          >
            <ListItemIcon>
              {completedArchiveSort.direction === "asc" ? (
                <DoneRoundedIcon sx={{ fontSize: 16 }} />
              ) : (
                <ArrowUpwardRoundedIcon sx={{ fontSize: 16 }} />
              )}
            </ListItemIcon>
            <ListItemText>正序</ListItemText>
          </MenuItem>,
          <MenuItem
            key="completed-sort-desc"
            selected={completedArchiveSort.direction === "desc"}
            onClick={() =>
              onCompletedArchiveSortChange((currentSort) => ({
                ...currentSort,
                direction: "desc",
              }))
            }
          >
            <ListItemIcon>
              {completedArchiveSort.direction === "desc" ? (
                <DoneRoundedIcon sx={{ fontSize: 16 }} />
              ) : (
                <ArrowDownwardRoundedIcon sx={{ fontSize: 16 }} />
              )}
            </ListItemIcon>
            <ListItemText>倒序</ListItemText>
          </MenuItem>,
        ]}
      </Menu>
      <Menu
        open={Boolean(tagSubAnchor)}
        anchorEl={tagSubAnchor}
        onClose={onCloseTagSub}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        {tags.length === 0 && (
          <MenuItem disabled>
            <ListItemText>暂无标签</ListItemText>
          </MenuItem>
        )}
        {tags.map((t) => (
          <MenuItem
            key={t}
            selected={current.kind === "tag" && current.tag === t}
            onClick={() => onPick({ kind: "tag", tag: t })}
          >
            <ListItemText>#{t}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

// Re-export for files that don't otherwise import from types.
export type { TodoItemT };
