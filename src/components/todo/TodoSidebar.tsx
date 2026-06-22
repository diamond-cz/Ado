// Sidebar — fixed filter entries (今天 / 最近7天 / 收集箱) and the
// user-defined 清单 list. Lists carry an emoji + name and a count chip
// showing the number of pending items. Right-click opens
// `ListContextMenu` for rename/delete.

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Box,
  Button,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
  TextField,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import TodayRoundedIcon from "@mui/icons-material/TodayRounded";
import InboxRoundedIcon from "@mui/icons-material/InboxRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArchiveRoundedIcon from "@mui/icons-material/ArchiveRounded";
import LabelRoundedIcon from "@mui/icons-material/LabelRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import CreateNewFolderRoundedIcon from "@mui/icons-material/CreateNewFolderRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import {
  useTodoStore,
  countForFilter,
  collectAllTags,
  isInboxList,
  midpointOrder,
  randomTodoFolderEmoji,
} from "./useTodoStore";
import type { SavedTodoFilter, TodoFolder, TodoList } from "./types";
import { ListContextMenu } from "./ListContextMenu";
import { ListEditDialog } from "./ListEditDialog";
import { TodoEmoji } from "./TodoEmoji";
import { registerTodoCalendarDropTarget } from "./todoCalendarDrag";
import {
  CountBadge,
  HoverCountActionSlot,
  hoverCountActionParentSx,
} from "./TodoHoverActionSlot";

const ROW_HEIGHT = 36;
const SIDEBAR_TRAILING_SLOT_WIDTH = 15;
const DEFAULT_DROP_ZONE_HEIGHT = 18;
const ROOT_EDGE_DROP_ZONE_HEIGHT = 22;
const FIRST_ROOT_ITEM_ROOT_START_RATIO = 0.8;
const NEW_FOLDER_NAME = "新文件夹";
const NEW_FOLDER_EMOJI = "📁";

type SidebarEntryKind = "folder" | "list";
type DropEdge = "before" | "after";
type DropRowState = DropEdge | "inside";

interface SidebarRootEntry {
  kind: SidebarEntryKind;
  id: string;
  order: number;
  createdAt: number;
  folder?: TodoFolder;
  list?: TodoList;
}

type SidebarDragItem = { kind: SidebarEntryKind; id: string };

type SidebarDropTarget =
  | { type: "root-order"; targetKind: SidebarEntryKind; targetId: string; edge: DropEdge }
  | { type: "root-start" }
  | { type: "root-end" }
  | { type: "folder-start"; folderId: string }
  | { type: "folder-order"; folderId: string; targetListId: string; edge: DropEdge }
  | { type: "folder-end"; folderId: string }
  | { type: "merge-lists"; targetListId: string };

type SidebarDropData =
  | { type: "root-row"; targetKind: SidebarEntryKind; targetId: string }
  | { type: "root-start" }
  | { type: "root-end" }
  | { type: "folder-start"; folderId: string }
  | { type: "folder-list-row"; folderId: string; targetListId: string }
  | { type: "folder-end"; folderId: string };

interface SidebarCollisionData {
  droppableContainer: unknown;
  value: number;
  pointerRatio?: number;
  sidebarDropPriority?: number;
}

interface SidebarRootCollisionRow {
  container: Parameters<CollisionDetection>[0]["droppableContainers"][number];
  rect: { top: number; right: number; bottom: number; left: number; height: number };
  data: Extract<SidebarDropData, { type: "root-row" }>;
}

function compareSidebarEntries(a: SidebarRootEntry, b: SidebarRootEntry): number {
  const orderDelta = a.order - b.order;
  if (orderDelta !== 0) return orderDelta;
  const timeDelta = a.createdAt - b.createdAt;
  if (timeDelta !== 0) return timeDelta;
  return `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`);
}

function sidebarEntryKey(entry: SidebarRootEntry): string {
  return `${entry.kind}:${entry.id}`;
}

function dragItemKey(item: SidebarDragItem): string {
  return `${item.kind}:${item.id}`;
}

function sameDropTarget(a: SidebarDropTarget | null, b: SidebarDropTarget): boolean {
  if (!a || a.type !== b.type) return false;
  switch (a.type) {
    case "root-order":
      return (
        b.type === "root-order" &&
        a.targetKind === b.targetKind &&
        a.targetId === b.targetId &&
        a.edge === b.edge
      );
    case "folder-order":
      return (
        b.type === "folder-order" &&
        a.folderId === b.folderId &&
        a.targetListId === b.targetListId &&
        a.edge === b.edge
      );
    case "folder-start":
      return b.type === "folder-start" && a.folderId === b.folderId;
    case "folder-end":
      return b.type === "folder-end" && a.folderId === b.folderId;
    case "merge-lists":
      return b.type === "merge-lists" && a.targetListId === b.targetListId;
    case "root-start":
      return true;
    case "root-end":
      return true;
  }
}

function isSidebarEdgeDropData(data: SidebarDropData | undefined): boolean {
  return (
    data?.type === "root-start" ||
    data?.type === "root-end" ||
    data?.type === "folder-start" ||
    data?.type === "folder-end"
  );
}

function pointWithinRect(
  point: { x: number; y: number },
  rect: { top: number; right: number; bottom: number; left: number },
): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function pointerDistanceToRectCorners(
  point: { x: number; y: number },
  rect: { top: number; right: number; bottom: number; left: number },
): number {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.left, y: rect.bottom },
    { x: rect.right, y: rect.bottom },
  ];
  return corners.reduce(
    (sum, corner) => sum + Math.hypot(point.x - corner.x, point.y - corner.y),
    0,
  );
}

function sidebarPointerCollisionDetection(
  args: Parameters<CollisionDetection>[0],
): Collision[] {
  const pointer = args.pointerCoordinates;
  if (!pointer) return [];

  let rootStartContainer: Parameters<CollisionDetection>[0]["droppableContainers"][number] | null =
    null;
  let rootEndContainer: Parameters<CollisionDetection>[0]["droppableContainers"][number] | null =
    null;
  let rootContentTop = Number.POSITIVE_INFINITY;
  let rootContentBottom = Number.NEGATIVE_INFINITY;
  let rootContentLeft = Number.POSITIVE_INFINITY;
  let rootContentRight = Number.NEGATIVE_INFINITY;
  let firstRootRow: SidebarRootCollisionRow | null = null;

  for (const container of args.droppableContainers) {
    const rect = args.droppableRects.get(container.id);
    const dropData = container.data.current as SidebarDropData | undefined;
    if (dropData?.type === "root-start") rootStartContainer = container;
    if (dropData?.type === "root-end") rootEndContainer = container;
    if (
      rect &&
      (dropData?.type === "root-row" || dropData?.type === "folder-list-row")
    ) {
      rootContentTop = Math.min(rootContentTop, rect.top);
      rootContentBottom = Math.max(rootContentBottom, rect.bottom);
      rootContentLeft = Math.min(rootContentLeft, rect.left);
      rootContentRight = Math.max(rootContentRight, rect.right);
    }
    if (rect && dropData?.type === "root-row") {
      const row = { container, rect, data: dropData };
      if (!firstRootRow || rect.top < firstRootRow.rect.top) {
        firstRootRow = row;
      }
    }
  }

  const hasRootContent = Number.isFinite(rootContentTop);
  const withinRootContentX =
    hasRootContent &&
    pointer.x >= rootContentLeft - 24 &&
    pointer.x <= rootContentRight + 24;
  const activeDragItem = args.active.data.current as SidebarDragItem | undefined;
  if (withinRootContentX && rootStartContainer && pointer.y < rootContentTop) {
    return [
      {
        id: rootStartContainer.id,
        data: {
          droppableContainer: rootStartContainer,
          value: 0,
          sidebarDropPriority: -1,
        } satisfies SidebarCollisionData,
      },
    ];
  }
  if (withinRootContentX && rootEndContainer && pointer.y > rootContentBottom) {
    return [
      {
        id: rootEndContainer.id,
        data: {
          droppableContainer: rootEndContainer,
          value: 0,
          sidebarDropPriority: -1,
        } satisfies SidebarCollisionData,
      },
    ];
  }
  if (
    withinRootContentX &&
    rootStartContainer &&
    firstRootRow != null &&
    (firstRootRow.data.targetKind === "folder" ||
      (firstRootRow.data.targetKind === "list" && activeDragItem?.kind === "folder")) &&
    pointWithinRect(pointer, firstRootRow.rect) &&
    pointer.y <=
      firstRootRow.rect.top + firstRootRow.rect.height * FIRST_ROOT_ITEM_ROOT_START_RATIO
  ) {
    return [
      {
        id: rootStartContainer.id,
        data: {
          droppableContainer: rootStartContainer,
          value: 0,
          pointerRatio: 0,
          sidebarDropPriority: -1,
        } satisfies SidebarCollisionData,
      },
    ];
  }

  const collisions: Collision[] = [];
  for (const container of args.droppableContainers) {
    const rect = args.droppableRects.get(container.id);
    if (!rect || !pointWithinRect(pointer, rect)) continue;

    const dropData = container.data.current as SidebarDropData | undefined;
    const priority = isSidebarEdgeDropData(dropData) ? 0 : 1;
    const pointerRatio =
      rect.height > 0 ? (pointer.y - rect.top) / rect.height : undefined;
    collisions.push({
      id: container.id,
      data: {
        droppableContainer: container,
        value: pointerDistanceToRectCorners(pointer, rect),
        pointerRatio,
        sidebarDropPriority: priority,
      } satisfies SidebarCollisionData,
    });
  }

  return collisions.sort((a, b) => {
    const dataA = a.data as SidebarCollisionData | undefined;
    const dataB = b.data as SidebarCollisionData | undefined;
    const priorityDelta =
      (dataA?.sidebarDropPriority ?? 1) - (dataB?.sidebarDropPriority ?? 1);
    if (priorityDelta !== 0) return priorityDelta;
    return (dataA?.value ?? 0) - (dataB?.value ?? 0);
  });
}

function collisionPointerRatioFromDndEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
): number | null {
  const overId = event.over?.id;
  if (overId == null) return null;
  const collision = event.collisions?.find((entry) => entry.id === overId);
  const data = collision?.data as SidebarCollisionData | undefined;
  return typeof data?.pointerRatio === "number" ? data.pointerRatio : null;
}

function dropIntentFromDndEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  allowInside: boolean,
): DropRowState {
  const over = event.over;
  if (!over) return "after";
  const ratio =
    collisionPointerRatioFromDndEvent(event) ??
    (() => {
      const activeRect =
        event.active.rect.current.translated ?? event.active.rect.current.initial;
      const activeCenterY = activeRect
        ? activeRect.top + activeRect.height / 2
        : over.rect.top + over.rect.height / 2;
      return over.rect.height > 0
        ? (activeCenterY - over.rect.top) / over.rect.height
        : 0.5;
    })();
  if (allowInside && ratio >= 0.35 && ratio <= 0.65) return "inside";
  return ratio < 0.5 ? "before" : "after";
}

function dropEdgeFromDndEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
): DropEdge {
  return dropIntentFromDndEvent(event, false) === "before" ? "before" : "after";
}

function sidebarDragId(item: SidebarDragItem): string {
  return `todo-sidebar-drag:${item.kind}:${item.id}`;
}

function rootDropId(kind: SidebarEntryKind, id: string): string {
  return `todo-sidebar-root:${kind}:${id}`;
}

function folderListDropId(folderId: string, listId: string): string {
  return `todo-sidebar-folder-list:${folderId}:${listId}`;
}

interface SidebarProps {
  isDark: boolean;
}

export function TodoSidebar({ isDark }: SidebarProps) {
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const items = useTodoStore((s) => s.items);
  const customFilters = useTodoStore((s) => s.customFilters);
  const defaultListId = useTodoStore((s) => s.defaultListId);
  const setDefaultList = useTodoStore((s) => s.setDefaultList);
  const selectedFilter = useTodoStore((s) => s.selectedFilter);
  const advancedFilter = useTodoStore((s) => s.advancedFilter);
  const setSelectedFilter = useTodoStore((s) => s.setSelectedFilter);
  const addFolder = useTodoStore((s) => s.addFolder);
  const renameFolder = useTodoStore((s) => s.renameFolder);
  const reorderFolder = useTodoStore((s) => s.reorderFolder);
  const deleteFolder = useTodoStore((s) => s.deleteFolder);
  const addList = useTodoStore((s) => s.addList);
  const renameList = useTodoStore((s) => s.renameList);
  const moveList = useTodoStore((s) => s.moveList);
  const archiveList = useTodoStore((s) => s.archiveList);
  const unarchiveList = useTodoStore((s) => s.unarchiveList);
  const deleteList = useTodoStore((s) => s.deleteList);
  const updateCustomFilter = useTodoStore((s) => s.updateCustomFilter);
  const deleteCustomFilter = useTodoStore((s) => s.deleteCustomFilter);
  const renameTag = useTodoStore((s) => s.renameTag);
  const deleteTag = useTodoStore((s) => s.deleteTag);

  // Inline "create list" input — appears below the section header when
  // the user clicks the + button. Submits on Enter (or blur if non-empty).
  const [creating, setCreating] = useState(false);
  const [creatingFolderId, setCreatingFolderId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderDraftName, setFolderDraftName] = useState("");
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const folderAutoOpenTimerRef = useRef<{
    folderId: string;
    timerId: number;
  } | null>(null);
  // Right-click menu state.
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [menuList, setMenuList] = useState<TodoList | null>(null);
  const [editTarget, setEditTarget] = useState<TodoList | null>(null);
  const [folderMenuAnchor, setFolderMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [menuFolder, setMenuFolder] = useState<TodoFolder | null>(null);
  const [editFolderTarget, setEditFolderTarget] = useState<TodoFolder | null>(
    null,
  );
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [menuFilter, setMenuFilter] = useState<SavedTodoFilter | null>(null);
  const [renameFilter, setRenameFilter] = useState<SavedTodoFilter | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteFilterTarget, setDeleteFilterTarget] =
    useState<SavedTodoFilter | null>(null);
  const [tagMenuAnchor, setTagMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuTag, setMenuTag] = useState<string | null>(null);
  const [renameTagTarget, setRenameTagTarget] = useState<string | null>(null);
  const [renameTagDraft, setRenameTagDraft] = useState("");
  const [dragItem, setDragItem] = useState<SidebarDragItem | null>(null);
  const [dragOverlayWidth, setDragOverlayWidth] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);
  const [mergeListsTarget, setMergeListsTarget] = useState<{
    sourceListId: string;
    targetListId: string;
  } | null>(null);
  const [mergeFolderEmoji, setMergeFolderEmoji] = useState(NEW_FOLDER_EMOJI);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );
  const sidebarCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = sidebarPointerCollisionDetection(args);
    return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
  }, []);

  const { activeLists, archivedLists } = useMemo(() => {
    const sorted = [...lists].sort((a, b) => a.order - b.order);
    return {
      activeLists: sorted.filter((list) => list.archivedAt == null && !isInboxList(list)),
      archivedLists: sorted.filter((list) => list.archivedAt != null && !isInboxList(list)),
    };
  }, [lists]);
  const inboxList = useMemo(
    () => lists.find((list) => list.archivedAt == null && isInboxList(list)) ?? null,
    [lists],
  );
  const activeFolders = useMemo(
    () => [...folders].sort((a, b) => a.order - b.order),
    [folders],
  );
  const activeFolderIds = useMemo(
    () => new Set(activeFolders.map((folder) => folder.id)),
    [activeFolders],
  );
  const rootActiveLists = useMemo(
    () =>
      activeLists.filter(
        (list) => list.folderId == null || !activeFolderIds.has(list.folderId),
      ),
    [activeFolderIds, activeLists],
  );
  const listsByFolderId = useMemo(() => {
    const map = new Map<string, TodoList[]>();
    for (const folder of activeFolders) {
      map.set(folder.id, []);
    }
    for (const list of activeLists) {
      if (list.folderId == null || !activeFolderIds.has(list.folderId)) continue;
      const bucket = map.get(list.folderId) ?? [];
      bucket.push(list);
      map.set(list.folderId, bucket);
    }
    return map;
  }, [activeFolderIds, activeFolders, activeLists]);
  const activeListById = useMemo(
    () => new Map(activeLists.map((list) => [list.id, list])),
    [activeLists],
  );
  const isRootLevelList = (list: TodoList | undefined): list is TodoList =>
    list != null && (list.folderId == null || !activeFolderIds.has(list.folderId));
  const canMergeRootLists = (sourceListId: string, targetListId: string): boolean => {
    if (sourceListId === targetListId) return false;
    const source = activeListById.get(sourceListId);
    const target = activeListById.get(targetListId);
    return isRootLevelList(source) && isRootLevelList(target);
  };
  const rootEntries = useMemo<SidebarRootEntry[]>(
    () =>
      [
        ...rootActiveLists.map((list) => ({
          kind: "list" as const,
          id: list.id,
          order: list.order,
          createdAt: list.createdAt,
          list,
        })),
        ...activeFolders.map((folder) => ({
          kind: "folder" as const,
          id: folder.id,
          order: folder.order,
          createdAt: folder.createdAt,
          folder,
        })),
      ].sort(compareSidebarEntries),
    [activeFolders, rootActiveLists],
  );
  const archivedListIds = useMemo(
    () =>
      new Set(
        lists.filter((list) => list.archivedAt != null).map((list) => list.id),
      ),
    [lists],
  );
  const visibleItems = useMemo(
    () => items.filter((it) => !archivedListIds.has(it.listId)),
    [items, archivedListIds],
  );
  const sortedCustomFilters = useMemo(
    () => [...customFilters].sort((a, b) => a.order - b.order),
    [customFilters],
  );
  const tags = useMemo(() => collectAllTags(visibleItems), [visibleItems]);

  const recent7Count = countForFilter(items, { kind: "recent7" }, lists);
  const todayCount = countForFilter(items, { kind: "today" }, lists);
  const inboxCount = countForFilter(items, { kind: "inbox" }, lists);
  const advancedCount = countForFilter(
    items,
    { kind: "advanced" },
    lists,
    advancedFilter,
    customFilters,
  );
  const listPendingCount = (listId: string) =>
    items.filter(
      (it) =>
        it.listId === listId &&
        it.status === "pending" &&
        it.deletedAt == null,
    ).length;
  const folderPendingCount = (folderId: string) => {
    const listIds = new Set((listsByFolderId.get(folderId) ?? []).map((list) => list.id));
    if (listIds.size === 0) return 0;
    return items.filter(
      (item) =>
        listIds.has(item.listId) &&
        item.status === "pending" &&
        item.deletedAt == null,
    ).length;
  };
  const dropTodoOnList = useCallback((itemId: string, listId: string): boolean => {
    const store = useTodoStore.getState();
    const targetList = store.lists.find((list) => list.id === listId);
    const item = store.items.find((entry) => entry.id === itemId);
    if (!targetList || targetList.archivedAt != null || !item || item.deletedAt != null) {
      return false;
    }

    const movedToDifferentList = item.listId !== listId;
    if (movedToDifferentList) {
      store.moveItem(itemId, listId);
    }
    store.setSelectedItemId(movedToDifferentList ? null : itemId);
    return true;
  }, []);

  const openListMenu = (list: TodoList, anchor: { x: number; y: number }) => {
    setMenuAnchor(anchor);
    setMenuList(list);
  };

  const onListContextMenu = (e: MouseEvent, list: TodoList) => {
    e.preventDefault();
    openListMenu(list, { x: e.clientX, y: e.clientY });
  };

  const onListActionMenu = (e: MouseEvent<HTMLButtonElement>, list: TodoList) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    openListMenu(list, { x: rect.left, y: rect.bottom + 2 });
  };

  const onFolderContextMenu = (e: MouseEvent, folder: TodoFolder) => {
    e.preventDefault();
    setFolderMenuAnchor({ x: e.clientX, y: e.clientY });
    setMenuFolder(folder);
  };

  const onFilterContextMenu = (e: MouseEvent, filter: SavedTodoFilter) => {
    e.preventDefault();
    setFilterMenuAnchor({ x: e.clientX, y: e.clientY });
    setMenuFilter(filter);
  };

  const submitDraft = () => {
    if (draftName.trim()) {
      const list = addList({
        name: draftName.trim(),
        folderId: creatingFolderId,
      });
      setSelectedFilter({ kind: "list", id: list.id });
    }
    setCreating(false);
    setCreatingFolderId(null);
    setDraftName("");
  };

  const submitFolderDraft = () => {
    if (folderDraftName.trim()) {
      const folder = addFolder({ name: folderDraftName.trim() });
      setSelectedFilter({ kind: "folder", id: folder.id });
    }
    setCreatingFolder(false);
    setFolderDraftName("");
  };

  const startCreateList = (folderId: string | null = null) => {
    setCreating(true);
    setCreatingFolderId(folderId);
    setDraftName("");
    if (folderId != null) {
      setCollapsedFolderIds((current) => {
        if (!current.has(folderId)) return current;
        const next = new Set(current);
        next.delete(folderId);
        return next;
      });
    }
  };

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const updateDropTarget = (target: SidebarDropTarget) => {
    setDropTarget((current) => (sameDropTarget(current, target) ? current : target));
  };

  const clearDropTarget = () => {
    setDropTarget(null);
  };

  const clearDragState = () => {
    setDragItem(null);
    setDragOverlayWidth(null);
    setDropTarget(null);
  };

  const rootOrderFor = (
    targetKind: SidebarEntryKind,
    targetId: string,
    edge: DropEdge,
    dragged: SidebarDragItem,
  ): number | null => {
    const draggedKey = dragItemKey(dragged);
    const entries = rootEntries.filter((entry) => sidebarEntryKey(entry) !== draggedKey);
    const targetIndex = entries.findIndex(
      (entry) => entry.kind === targetKind && entry.id === targetId,
    );
    if (targetIndex < 0) return null;
    const insertIndex = edge === "before" ? targetIndex : targetIndex + 1;
    return midpointOrder(
      insertIndex > 0 ? entries[insertIndex - 1] : null,
      insertIndex < entries.length ? entries[insertIndex] : null,
    );
  };

  const rootStartOrderFor = (dragged: SidebarDragItem): number => {
    const draggedKey = dragItemKey(dragged);
    const entries = rootEntries.filter((entry) => sidebarEntryKey(entry) !== draggedKey);
    return midpointOrder(null, entries.length > 0 ? entries[0] : null);
  };

  const rootEndOrderFor = (dragged: SidebarDragItem): number => {
    const draggedKey = dragItemKey(dragged);
    const entries = rootEntries.filter((entry) => sidebarEntryKey(entry) !== draggedKey);
    return midpointOrder(entries.length > 0 ? entries[entries.length - 1] : null, null);
  };

  const folderStartOrderFor = (folderId: string, draggedListId: string): number => {
    const folderLists = (listsByFolderId.get(folderId) ?? []).filter(
      (list) => list.id !== draggedListId,
    );
    return midpointOrder(null, folderLists.length > 0 ? folderLists[0] : null);
  };

  const folderOrderFor = (
    folderId: string,
    targetListId: string,
    edge: DropEdge,
    draggedListId: string,
  ): number | null => {
    const folderLists = (listsByFolderId.get(folderId) ?? []).filter(
      (list) => list.id !== draggedListId,
    );
    const targetIndex = folderLists.findIndex((list) => list.id === targetListId);
    if (targetIndex < 0) return null;
    const insertIndex = edge === "before" ? targetIndex : targetIndex + 1;
    return midpointOrder(
      insertIndex > 0 ? folderLists[insertIndex - 1] : null,
      insertIndex < folderLists.length ? folderLists[insertIndex] : null,
    );
  };

  const folderEndOrderFor = (folderId: string, draggedListId: string): number => {
    const folderLists = (listsByFolderId.get(folderId) ?? []).filter(
      (list) => list.id !== draggedListId,
    );
    return midpointOrder(
      folderLists.length > 0 ? folderLists[folderLists.length - 1] : null,
      null,
    );
  };

  const setFolderOpen = useCallback((folderId: string) => {
    setCollapsedFolderIds((current) => {
      if (!current.has(folderId)) return current;
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
  }, []);

  const clearFolderAutoOpenTimer = useCallback(() => {
    const current = folderAutoOpenTimerRef.current;
    if (!current) return;
    window.clearTimeout(current.timerId);
    folderAutoOpenTimerRef.current = null;
  }, []);

  const scheduleFolderAutoOpen = useCallback(
    (folderId: string) => {
      if (!collapsedFolderIds.has(folderId)) {
        clearFolderAutoOpenTimer();
        return;
      }
      if (folderAutoOpenTimerRef.current?.folderId === folderId) return;

      clearFolderAutoOpenTimer();
      const timerId = window.setTimeout(() => {
        setFolderOpen(folderId);
        if (folderAutoOpenTimerRef.current?.folderId === folderId) {
          folderAutoOpenTimerRef.current = null;
        }
      }, 450);
      folderAutoOpenTimerRef.current = { folderId, timerId };
    },
    [clearFolderAutoOpenTimer, collapsedFolderIds, setFolderOpen],
  );

  const handleFolderTodoDragOverChange = useCallback(
    (folderId: string, isOver: boolean) => {
      if (isOver) scheduleFolderAutoOpen(folderId);
      else clearFolderAutoOpenTimer();
    },
    [clearFolderAutoOpenTimer, scheduleFolderAutoOpen],
  );

  useEffect(() => clearFolderAutoOpenTimer, [clearFolderAutoOpenTimer]);

  const applyDrop = (dragged: SidebarDragItem, target: SidebarDropTarget) => {
    if (target.type === "merge-lists") {
      if (dragged.kind !== "list" || dragged.id === target.targetListId) return;
      if (!canMergeRootLists(dragged.id, target.targetListId)) return;
      setMergeFolderEmoji(randomTodoFolderEmoji());
      setMergeListsTarget({
        sourceListId: dragged.id,
        targetListId: target.targetListId,
      });
      return;
    }

    if (target.type === "root-order") {
      const newOrder = rootOrderFor(
        target.targetKind,
        target.targetId,
        target.edge,
        dragged,
      );
      if (newOrder == null) return;
      if (dragged.kind === "folder") reorderFolder(dragged.id, newOrder);
      else moveList(dragged.id, null, newOrder);
      return;
    }

    if (target.type === "root-start") {
      const newOrder = rootStartOrderFor(dragged);
      if (dragged.kind === "folder") reorderFolder(dragged.id, newOrder);
      else moveList(dragged.id, null, newOrder);
      return;
    }

    if (target.type === "root-end") {
      const newOrder = rootEndOrderFor(dragged);
      if (dragged.kind === "folder") reorderFolder(dragged.id, newOrder);
      else moveList(dragged.id, null, newOrder);
      return;
    }

    if (dragged.kind !== "list") return;

    if (target.type === "folder-start") {
      const folderId = target.folderId;
      moveList(dragged.id, folderId, folderStartOrderFor(folderId, dragged.id));
      setFolderOpen(folderId);
      return;
    }

    if (target.type === "folder-end") {
      const folderId = target.folderId;
      moveList(dragged.id, folderId, folderEndOrderFor(folderId, dragged.id));
      setFolderOpen(folderId);
      return;
    }

    if (target.type === "folder-order") {
      const newOrder = folderOrderFor(
        target.folderId,
        target.targetListId,
        target.edge,
        dragged.id,
      );
      if (newOrder == null) return;
      moveList(dragged.id, target.folderId, newOrder);
      setFolderOpen(target.folderId);
    }
  };

  const dropTargetFromDndEvent = (
    dragged: SidebarDragItem,
    event: DragMoveEvent | DragOverEvent | DragEndEvent,
  ): SidebarDropTarget | null => {
    const over = event.over;
    const data = over?.data.current as SidebarDropData | undefined;
    if (!over || !data) return null;

    switch (data.type) {
      case "root-start":
        return { type: "root-start" };
      case "root-row": {
        if (dragged.kind === data.targetKind && dragged.id === data.targetId) {
          return null;
        }
        const pointerRatio = collisionPointerRatioFromDndEvent(event);
        if (
          dragged.kind === "list" &&
          data.targetKind === "folder" &&
          rootEntries[0]?.kind === "folder" &&
          rootEntries[0].id === data.targetId &&
          pointerRatio != null
        ) {
          return pointerRatio <= FIRST_ROOT_ITEM_ROOT_START_RATIO
            ? { type: "root-start" }
            : { type: "folder-start", folderId: data.targetId };
        }
        if (
          dragged.kind === "folder" &&
          data.targetKind === "list" &&
          rootEntries[0]?.kind === "list" &&
          rootEntries[0].id === data.targetId &&
          pointerRatio != null
        ) {
          return pointerRatio <= FIRST_ROOT_ITEM_ROOT_START_RATIO
            ? { type: "root-start" }
            : {
                type: "root-order",
                targetKind: "list",
                targetId: data.targetId,
                edge: "after",
              };
        }
        const intent = dropIntentFromDndEvent(event, dragged.kind === "list");
        if (dragged.kind === "list" && intent === "inside") {
          if (data.targetKind === "folder") {
            return { type: "folder-start", folderId: data.targetId };
          }
          if (canMergeRootLists(dragged.id, data.targetId)) {
            return { type: "merge-lists", targetListId: data.targetId };
          }
        }
        const edge = intent === "inside" ? dropEdgeFromDndEvent(event) : intent;
        return {
          type: "root-order",
          targetKind: data.targetKind,
          targetId: data.targetId,
          edge,
        };
      }
      case "folder-list-row": {
        if (dragged.kind === "folder") {
          return dragged.id === data.folderId
            ? null
            : {
                type: "root-order",
                targetKind: "folder",
                targetId: data.folderId,
                edge: "after",
              };
        }
        if (dragged.kind !== "list" || dragged.id === data.targetListId) {
          return null;
        }
        const intent = dropIntentFromDndEvent(event, true);
        if (intent === "inside" && canMergeRootLists(dragged.id, data.targetListId)) {
          return { type: "merge-lists", targetListId: data.targetListId };
        }
        return {
          type: "folder-order",
          folderId: data.folderId,
          targetListId: data.targetListId,
          edge: intent === "inside" ? dropEdgeFromDndEvent(event) : intent,
        };
      }
      case "folder-start":
        return dragged.kind === "list" ? { type: "folder-start", folderId: data.folderId } : null;
      case "folder-end":
        return dragged.kind === "list" ? { type: "folder-end", folderId: data.folderId } : null;
      case "root-end":
        return { type: "root-end" };
    }
  };

  const handleDndStart = (event: DragStartEvent) => {
    const item = event.active.data.current as SidebarDragItem | undefined;
    if (!item) return;
    setDragItem(item);
    setDragOverlayWidth(event.active.rect.current.initial?.width ?? null);
    setDropTarget(null);
  };

  const handleDndOver = (event: DragOverEvent) => {
    const item = (event.active.data.current as SidebarDragItem | undefined) ?? dragItem;
    if (!item) return;
    const target = dropTargetFromDndEvent(item, event);
    if (target) updateDropTarget(target);
    else clearDropTarget();
  };

  const handleDndMove = (event: DragMoveEvent) => {
    const item = (event.active.data.current as SidebarDragItem | undefined) ?? dragItem;
    if (!item) return;
    const target = dropTargetFromDndEvent(item, event);
    if (target) updateDropTarget(target);
    else clearDropTarget();
  };

  const handleDndEnd = (event: DragEndEvent) => {
    const item = (event.active.data.current as SidebarDragItem | undefined) ?? dragItem;
    const target = item ? dropTargetFromDndEvent(item, event) ?? dropTarget : null;
    if (item && target) applyDrop(item, target);
    clearDragState();
  };

  const rootEntryDropState = (entry: SidebarRootEntry): DropRowState | undefined => {
    if (
      dropTarget?.type === "root-order" &&
      dropTarget.targetKind === entry.kind &&
      dropTarget.targetId === entry.id
    ) {
      return dropTarget.edge;
    }
    if (
      entry.kind === "folder" &&
      dropTarget?.type === "folder-start" &&
      dropTarget.folderId === entry.id
    ) {
      return "inside";
    }
    if (
      entry.kind === "list" &&
      dropTarget?.type === "merge-lists" &&
      dropTarget.targetListId === entry.id
    ) {
      return "inside";
    }
    return undefined;
  };

  const rootEntryOrderPlaceholder = (
    entry: SidebarRootEntry,
    edge: DropEdge,
  ): boolean =>
    dropTarget?.type === "root-order" &&
    dropTarget.targetKind === entry.kind &&
    dropTarget.targetId === entry.id &&
    dropTarget.edge === edge;

  const rootEntryInsideDropState = (
    entry: SidebarRootEntry,
  ): DropRowState | undefined =>
    rootEntryDropState(entry) === "inside" ? "inside" : undefined;

  const folderListDropState = (list: TodoList): DropRowState | undefined => {
    if (
      dropTarget?.type === "folder-order" &&
      dropTarget.targetListId === list.id
    ) {
      return dropTarget.edge;
    }
    if (dropTarget?.type === "merge-lists" && dropTarget.targetListId === list.id) {
      return "inside";
    }
    return undefined;
  };

  const folderListOrderPlaceholder = (list: TodoList, edge: DropEdge): boolean =>
    dropTarget?.type === "folder-order" &&
    dropTarget.targetListId === list.id &&
    dropTarget.edge === edge;

  const folderListInsideDropState = (list: TodoList): DropRowState | undefined =>
    folderListDropState(list) === "inside" ? "inside" : undefined;

  const submitMergeFolder = (patch: { name?: string; emoji?: string }) => {
    if (!mergeListsTarget) return;
    const source = activeListById.get(mergeListsTarget.sourceListId);
    const target = activeListById.get(mergeListsTarget.targetListId);
    if (
      !source ||
      !target ||
      source.id === target.id ||
      !canMergeRootLists(source.id, target.id)
    ) {
      setMergeListsTarget(null);
      return;
    }

    const folder = addFolder({
      name: patch.name?.trim() || NEW_FOLDER_NAME,
      emoji: patch.emoji || mergeFolderEmoji,
      order: target.order,
    });
    const orderedLists = [source, target].sort((a, b) => a.order - b.order);
    const firstOrder = midpointOrder(null, null);
    const secondOrder = midpointOrder({ order: firstOrder }, null);
    moveList(orderedLists[0].id, folder.id, firstOrder);
    moveList(orderedLists[1].id, folder.id, secondOrder);
    setFolderOpen(folder.id);
    setSelectedFilter({ kind: "folder", id: folder.id });
    setMergeListsTarget(null);
  };

  return (
    <>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", py: 1 }}>
        <SidebarFixedRow
          icon={<TodayRoundedIcon sx={{ fontSize: 18 }} />}
          label="今天"
          count={todayCount}
          active={selectedFilter.kind === "today"}
          onClick={() => setSelectedFilter({ kind: "today" })}
          isDark={isDark}
        />
        <SidebarFixedRow
          icon={<CalendarTodayRoundedIcon sx={{ fontSize: 18 }} />}
          label="最近7天"
          count={recent7Count}
          active={selectedFilter.kind === "recent7"}
          onClick={() => setSelectedFilter({ kind: "recent7" })}
          isDark={isDark}
        />
        <SidebarFixedRow
          icon={<InboxRoundedIcon sx={{ fontSize: 18 }} />}
          label="收集箱"
          count={inboxCount}
          active={selectedFilter.kind === "inbox"}
          onClick={() => setSelectedFilter({ kind: "inbox" })}
          onTodoDrop={dropTodoOnList}
          todoDropListId={inboxList?.id ?? null}
          isDark={isDark}
        />
        <Box
          sx={{
            mt: 1,
            px: 1.5,
            pt: 1,
            pb: 0.5,
            borderTop: 1,
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.055),
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            "& .todo-sidebar-section-actions": {
              opacity: 0,
              transform: "translateX(4px)",
              pointerEvents: "none",
              transition: "opacity 120ms ease, transform 120ms ease",
            },
            "&:hover .todo-sidebar-section-actions, &:focus-within .todo-sidebar-section-actions": {
              opacity: 1,
              transform: "translateX(0)",
              pointerEvents: "auto",
            },
          }}
        >
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 600,
              color: "text.secondary",
              flex: 1,
              letterSpacing: 0.4,
            }}
          >
            清单
          </Typography>
          <Box className="todo-sidebar-section-actions" sx={{ display: "flex", gap: 0.2 }}>
            <IconButton
              size="small"
              onClick={() => {
                setCreatingFolder(true);
                setFolderDraftName("");
              }}
              sx={{
                width: 24,
                height: 24,
                border: 0,
                bgcolor: "transparent",
                boxShadow: "none",
                "&:hover": { bgcolor: "transparent", boxShadow: "none" },
                "&:focus-visible": { outline: "none", boxShadow: "none" },
              }}
            >
              <CreateNewFolderRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => startCreateList(null)}
              sx={{
                width: 24,
                height: 24,
                border: 0,
                bgcolor: "transparent",
                boxShadow: "none",
                "&:hover": { bgcolor: "transparent", boxShadow: "none" },
                "&:focus-visible": { outline: "none", boxShadow: "none" },
              }}
            >
              <AddRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Box>
        {creatingFolder && (
          <Box sx={{ px: 1.5, py: 0.5 }}>
            <TextField
              size="small"
              autoFocus
              fullWidth
              value={folderDraftName}
              onChange={(e) => setFolderDraftName(e.target.value)}
              onBlur={submitFolderDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitFolderDraft();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setCreatingFolder(false);
                  setFolderDraftName("");
                }
              }}
              placeholder="文件夹名"
              variant="outlined"
            />
          </Box>
        )}
        {creating && creatingFolderId == null && (
          <Box sx={{ px: 1.5, py: 0.5 }}>
            <TextField
              size="small"
              autoFocus
              fullWidth
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={submitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitDraft();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setCreating(false);
                  setCreatingFolderId(null);
                  setDraftName("");
                }
              }}
              placeholder="清单名"
              variant="outlined"
            />
          </Box>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={sidebarCollisionDetection}
          onDragStart={handleDndStart}
          onDragMove={handleDndMove}
          onDragOver={handleDndOver}
          onDragCancel={clearDragState}
          onDragEnd={handleDndEnd}
        >
          <Box
            sx={{
              position: "relative",
              borderRadius: 1,
              bgcolor:
                dropTarget?.type === "root-start" || dropTarget?.type === "root-end"
                  ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.05)
                  : "transparent",
            }}
          >
          <SidebarDropHotspot
            id="todo-sidebar-root-start"
            data={{ type: "root-start" }}
            visible={dragItem != null}
            placement="top"
            height={ROOT_EDGE_DROP_ZONE_HEIGHT}
          />
          {dropTarget?.type === "root-start" && (
            <SidebarDropPlaceholder isDark={isDark} />
          )}
          {rootEntries.map((entry) => {
            if (entry.kind === "list" && entry.list) {
              const list = entry.list;
              return (
                <Fragment key={sidebarEntryKey(entry)}>
                  {rootEntryOrderPlaceholder(entry, "before") && (
                    <SidebarDropPlaceholder isDark={isDark} />
                  )}
                  <SidebarListRow
                    list={list}
                    isDefault={list.id === defaultListId}
                    count={listPendingCount(list.id)}
                    active={
                      selectedFilter.kind === "list" && selectedFilter.id === list.id
                    }
                    onClick={() => setSelectedFilter({ kind: "list", id: list.id })}
                    onContextMenu={(e) => onListContextMenu(e, list)}
                    onActionMenu={(e) => onListActionMenu(e, list)}
                    onTodoDrop={dropTodoOnList}
                    isDark={isDark}
                    disableHover={dragItem != null}
                    dragData={{ kind: "list", id: list.id }}
                    dropData={{
                      type: "root-row",
                      targetKind: "list",
                      targetId: list.id,
                    }}
                    dropState={rootEntryInsideDropState(entry)}
                  />
                  {rootEntryOrderPlaceholder(entry, "after") && (
                    <SidebarDropPlaceholder isDark={isDark} />
                  )}
                </Fragment>
              );
            }

            const folder = entry.folder;
            if (!folder) return null;
            const folderLists = listsByFolderId.get(folder.id) ?? [];
            const collapsed = collapsedFolderIds.has(folder.id);
            const folderStartDropActive =
              dropTarget?.type === "folder-start" && dropTarget.folderId === folder.id;
            const folderEndDropActive =
              dropTarget?.type === "folder-end" && dropTarget.folderId === folder.id;
            const folderBodyDropActive = folderStartDropActive || folderEndDropActive;
            const showFolderBody = !collapsed || folderBodyDropActive;
            const folderDragging =
              dragItem?.kind === "folder" && dragItem.id === folder.id;
            return (
              <Fragment key={sidebarEntryKey(entry)}>
                {rootEntryOrderPlaceholder(entry, "before") && (
                  <SidebarDropPlaceholder isDark={isDark} />
                )}
                <Box
                  sx={
                    folderDragging
                      ? {
                          height: 0,
                          overflow: "hidden",
                          pointerEvents: "none",
                        }
                      : undefined
                  }
                >
                  <SidebarFolderRow
                    folder={folder}
                    count={folderPendingCount(folder.id)}
                    active={
                      selectedFilter.kind === "folder" &&
                      selectedFilter.id === folder.id
                    }
                    collapsed={collapsed}
                    onToggle={() => toggleFolderCollapsed(folder.id)}
                    onClick={() => setSelectedFilter({ kind: "folder", id: folder.id })}
                    onCreateList={() => startCreateList(folder.id)}
                    onContextMenu={(e) => onFolderContextMenu(e, folder)}
                    onTodoDragOverChange={handleFolderTodoDragOverChange}
                    isDark={isDark}
                    disableHover={dragItem != null}
                    dragData={{ kind: "folder", id: folder.id }}
                    dropData={{
                      type: "root-row",
                      targetKind: "folder",
                      targetId: folder.id,
                    }}
                    dropState={rootEntryInsideDropState(entry)}
                  />
                  {creating && creatingFolderId === folder.id && (
                    <Box sx={{ px: 2.2, py: 0.5 }}>
                      <TextField
                        size="small"
                        autoFocus
                        fullWidth
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={submitDraft}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            submitDraft();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setCreating(false);
                            setCreatingFolderId(null);
                            setDraftName("");
                          }
                        }}
                        placeholder="清单名"
                        variant="outlined"
                      />
                    </Box>
                  )}
                  {showFolderBody && (
                    <Box
                      sx={{
                        minHeight: dragItem?.kind === "list" && folderLists.length === 0 ? 8 : 0,
                        position: "relative",
                        borderRadius: 1,
                        bgcolor: folderBodyDropActive
                          ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.05)
                          : "transparent",
                      }}
                    >
                      <SidebarDropHotspot
                        id={`todo-sidebar-folder-start:${folder.id}`}
                        data={{ type: "folder-start", folderId: folder.id }}
                        visible={dragItem?.kind === "list"}
                        indent
                        placement="top"
                      />
                      {folderStartDropActive && (
                        <SidebarDropPlaceholder isDark={isDark} indent />
                      )}
                      {!collapsed && folderLists.map((list) => (
                        <Fragment key={list.id}>
                          {folderListOrderPlaceholder(list, "before") && (
                            <SidebarDropPlaceholder isDark={isDark} indent />
                          )}
                          <SidebarListRow
                            list={list}
                            isDefault={list.id === defaultListId}
                            count={listPendingCount(list.id)}
                            active={
                              selectedFilter.kind === "list" &&
                              selectedFilter.id === list.id
                            }
                            onClick={() => setSelectedFilter({ kind: "list", id: list.id })}
                            onContextMenu={(e) => onListContextMenu(e, list)}
                            onActionMenu={(e) => onListActionMenu(e, list)}
                            onTodoDrop={dropTodoOnList}
                            isDark={isDark}
                            disableHover={dragItem != null}
                            indent
                            dragData={{ kind: "list", id: list.id }}
                            dropData={{
                              type: "folder-list-row",
                              folderId: list.folderId!,
                              targetListId: list.id,
                            }}
                            dropState={folderListInsideDropState(list)}
                          />
                          {folderListOrderPlaceholder(list, "after") && (
                            <SidebarDropPlaceholder isDark={isDark} indent />
                          )}
                        </Fragment>
                      ))}
                      {folderEndDropActive && (
                        <SidebarDropPlaceholder isDark={isDark} indent />
                      )}
                      <SidebarDropHotspot
                        id={`todo-sidebar-folder-end:${folder.id}`}
                        data={{ type: "folder-end", folderId: folder.id }}
                        visible={dragItem?.kind === "list"}
                        indent
                        placement="bottom"
                      />
                    </Box>
                  )}
                </Box>
                {rootEntryOrderPlaceholder(entry, "after") && (
                  <SidebarDropPlaceholder isDark={isDark} />
                )}
              </Fragment>
            );
          })}
          {dropTarget?.type === "root-end" && (
            <SidebarDropPlaceholder isDark={isDark} />
          )}
          <SidebarDropHotspot
            id="todo-sidebar-root-end"
            data={{ type: "root-end" }}
            visible={dragItem != null}
            placement="bottom"
            height={ROOT_EDGE_DROP_ZONE_HEIGHT}
          />
          </Box>
          {typeof document !== "undefined" &&
            createPortal(
              <DragOverlay dropAnimation={null}>
                <SidebarDragPreview
                  item={dragItem}
                  folders={activeFolders}
                  lists={activeLists}
                  defaultListId={defaultListId}
                  listCount={listPendingCount}
                  folderCount={folderPendingCount}
                  isDark={isDark}
                  width={dragOverlayWidth}
                />
              </DragOverlay>,
              document.body,
            )}
        </DndContext>
        <Box sx={{ mt: 2, mb: 0.5, px: 1.5 }}>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 600,
              color: "text.secondary",
              letterSpacing: 0.4,
            }}
          >
            标签
          </Typography>
        </Box>
        {tags.length === 0 ? (
          <Typography sx={{ px: 1.8, py: 0.5, fontSize: 12, color: "text.disabled" }}>
            暂无标签
          </Typography>
        ) : (
          tags.map((tag) => {
            const tagCount = visibleItems.filter(
              (it) => it.deletedAt == null && it.tags.includes(tag),
            ).length;
            return (
              <SidebarFixedRow
                key={tag}
                icon={<LabelRoundedIcon sx={{ fontSize: 18 }} />}
                label={`#${tag}`}
                count={0}
                active={selectedFilter.kind === "tag" && selectedFilter.tag === tag}
                onClick={() => setSelectedFilter({ kind: "tag", tag })}
                trailing={
                  <HoverRowActionSlot
                    count={tagCount}
                    isDark={isDark}
                    icon={<MoreHorizRoundedIcon sx={{ fontSize: 16 }} />}
                    onClick={(e) => {
                      setTagMenuAnchor(e.currentTarget);
                      setMenuTag(tag);
                    }}
                  />
                }
                isDark={isDark}
              />
            );
          })
        )}
        <Box sx={{ mt: 2, mb: 0.5, px: 1.5 }}>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 600,
              color: "text.secondary",
              letterSpacing: 0.4,
            }}
          >
            过滤器
          </Typography>
        </Box>
        <SidebarFixedRow
          icon={<TuneRoundedIcon sx={{ fontSize: 18 }} />}
          label="自定义过滤"
          count={advancedCount}
          active={selectedFilter.kind === "advanced"}
          onClick={() => setSelectedFilter({ kind: "advanced" })}
          isDark={isDark}
        />
        {sortedCustomFilters.map((filter) => (
          <SidebarFixedRow
            key={filter.id}
            icon={<FilterAltRoundedIcon sx={{ fontSize: 18 }} />}
            label={filter.name}
            count={countForFilter(
              items,
              { kind: "customFilter", id: filter.id },
              lists,
              advancedFilter,
              customFilters,
            )}
            active={
              selectedFilter.kind === "customFilter" &&
              selectedFilter.id === filter.id
            }
            onClick={() => setSelectedFilter({ kind: "customFilter", id: filter.id })}
            onContextMenu={(e) => onFilterContextMenu(e, filter)}
            isDark={isDark}
          />
        ))}
        <Box
          sx={{
            mt: 2,
            mb: 0.5,
            px: 1.5,
            pt: 1,
            borderTop: 1,
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.055),
          }}
        >
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 600,
              color: "text.secondary",
              letterSpacing: 0.4,
            }}
          >
            归档
          </Typography>
        </Box>
        {archivedLists.map((list) => (
          <SidebarListRow
            key={list.id}
            list={list}
            isDefault={false}
            archived
            count={listPendingCount(list.id)}
            active={
              selectedFilter.kind === "list" && selectedFilter.id === list.id
            }
            onClick={() => setSelectedFilter({ kind: "list", id: list.id })}
            onContextMenu={(e) => onListContextMenu(e, list)}
            onActionMenu={(e) => onListActionMenu(e, list)}
            isDark={isDark}
          />
        ))}
        <SidebarFixedRow
          icon={<CheckCircleOutlineRoundedIcon sx={{ fontSize: 18 }} />}
          label="已完成"
          count={0}
          active={selectedFilter.kind === "completed"}
          onClick={() => setSelectedFilter({ kind: "completed" })}
          isDark={isDark}
        />
        <SidebarFixedRow
          icon={<BlockRoundedIcon sx={{ fontSize: 18 }} />}
          label="已放弃"
          count={0}
          active={selectedFilter.kind === "abandoned"}
          onClick={() => setSelectedFilter({ kind: "abandoned" })}
          isDark={isDark}
        />
        <SidebarFixedRow
          icon={<DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />}
          label="垃圾桶"
          count={0}
          active={selectedFilter.kind === "trash"}
          onClick={() => setSelectedFilter({ kind: "trash" })}
          isDark={isDark}
        />
      </Box>
      {menuAnchor && menuList && (
        <ListContextMenu
          anchor={menuAnchor}
          isDefault={menuList.id === defaultListId}
          isArchived={menuList.archivedAt != null}
          currentFolderId={menuList.folderId}
          folderOptions={[
            { id: null, label: "未分文件夹" },
            ...activeFolders.map((folder) => ({
              id: folder.id,
              label: folder.name,
              emoji: folder.emoji,
            })),
          ]}
          onClose={() => {
            setMenuAnchor(null);
            setMenuList(null);
          }}
          onEdit={() => {
            setEditTarget(menuList);
            setMenuAnchor(null);
            setMenuList(null);
          }}
          onSetDefault={() => {
            setDefaultList(menuList.id);
            setMenuAnchor(null);
            setMenuList(null);
          }}
          onMoveToFolder={(folderId) => {
            renameList(menuList.id, { folderId });
            setMenuAnchor(null);
            setMenuList(null);
          }}
          onArchive={() => {
            archiveList(menuList.id);
            setMenuAnchor(null);
            setMenuList(null);
          }}
          onUnarchive={() => {
            unarchiveList(menuList.id);
            setMenuAnchor(null);
            setMenuList(null);
          }}
          onDelete={() => {
            if (
              window.confirm(
                `删除清单「${menuList.emoji} ${menuList.name}」？\n该清单下的所有任务会移到垃圾桶。`,
              )
            ) {
              deleteList(menuList.id);
            }
            setMenuAnchor(null);
            setMenuList(null);
          }}
        />
      )}
      {folderMenuAnchor && menuFolder && (
        <FolderContextMenu
          anchor={folderMenuAnchor}
          onClose={() => {
            setFolderMenuAnchor(null);
            setMenuFolder(null);
          }}
          onEdit={() => {
            setEditFolderTarget(menuFolder);
            setFolderMenuAnchor(null);
            setMenuFolder(null);
          }}
          onCreateList={() => {
            startCreateList(menuFolder.id);
            setFolderMenuAnchor(null);
            setMenuFolder(null);
          }}
          onDelete={() => {
            const listCount = listsByFolderId.get(menuFolder.id)?.length ?? 0;
            if (
              window.confirm(
                `删除文件夹「${menuFolder.emoji} ${menuFolder.name}」？\n${listCount} 个清单会移动到未分文件夹。`,
              )
            ) {
              deleteFolder(menuFolder.id);
            }
            setFolderMenuAnchor(null);
            setMenuFolder(null);
          }}
        />
      )}
      {filterMenuAnchor && menuFilter && (
        <CustomFilterContextMenu
          anchor={filterMenuAnchor}
          onClose={() => {
            setFilterMenuAnchor(null);
            setMenuFilter(null);
          }}
          onRename={() => {
            setRenameFilter(menuFilter);
            setRenameDraft(menuFilter.name);
            setFilterMenuAnchor(null);
            setMenuFilter(null);
          }}
          onDelete={() => {
            setDeleteFilterTarget(menuFilter);
            setFilterMenuAnchor(null);
            setMenuFilter(null);
          }}
        />
      )}
      <Menu
        open={Boolean(tagMenuAnchor && menuTag)}
        anchorEl={tagMenuAnchor}
        onClose={() => {
          setTagMenuAnchor(null);
          setMenuTag(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            if (!menuTag) return;
            setRenameTagTarget(menuTag);
            setRenameTagDraft(menuTag);
            setTagMenuAnchor(null);
            setMenuTag(null);
          }}
        >
          <ListItemIcon>
            <EditRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>重命名标签</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            if (!menuTag) return;
            if (window.confirm(`删除标签「#${menuTag}」？\n所有待办中的该标签都会被移除。`)) {
              deleteTag(menuTag);
            }
            setTagMenuAnchor(null);
            setMenuTag(null);
          }}
        >
          <ListItemIcon>
            <DeleteOutlineRoundedIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>删除标签</ListItemText>
        </MenuItem>
      </Menu>
      <Dialog
        open={renameTagTarget != null}
        onClose={() => setRenameTagTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>重命名标签</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            margin="dense"
            label="标签名"
            value={renameTagDraft}
            onChange={(e) => setRenameTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTagTarget && renameTagDraft.trim()) {
                e.preventDefault();
                renameTag(renameTagTarget, renameTagDraft.trim());
                setRenameTagTarget(null);
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTagTarget(null)}>取消</Button>
          <Button
            variant="contained"
            disabled={!renameTagDraft.trim()}
            onClick={() => {
              if (!renameTagTarget) return;
              renameTag(renameTagTarget, renameTagDraft.trim());
              setRenameTagTarget(null);
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={renameFilter != null}
        onClose={() => setRenameFilter(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>修改过滤器名称</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            margin="dense"
            label="名称"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameFilter && renameDraft.trim()) {
                e.preventDefault();
                updateCustomFilter(renameFilter.id, { name: renameDraft.trim() });
                setRenameFilter(null);
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameFilter(null)}>取消</Button>
          <Button
            variant="contained"
            disabled={!renameDraft.trim()}
            onClick={() => {
              if (!renameFilter) return;
              updateCustomFilter(renameFilter.id, { name: renameDraft.trim() });
              setRenameFilter(null);
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={deleteFilterTarget != null}
        onClose={() => setDeleteFilterTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>删除过滤器</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            确定删除「{deleteFilterTarget?.name}」？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteFilterTarget(null)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (!deleteFilterTarget) return;
              deleteCustomFilter(deleteFilterTarget.id);
              setDeleteFilterTarget(null);
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
      {editTarget && (
        <ListEditDialog
          list={editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={(patch) => {
            renameList(editTarget.id, patch);
            setEditTarget(null);
          }}
        />
      )}
      {editFolderTarget && (
        <ListEditDialog
          list={editFolderTarget}
          title="编辑文件夹"
          defaultEmoji="📁"
          onClose={() => setEditFolderTarget(null)}
          onSubmit={(patch) => {
            renameFolder(editFolderTarget.id, patch);
            setEditFolderTarget(null);
          }}
        />
      )}
      {mergeListsTarget && (
        <ListEditDialog
          list={{ name: NEW_FOLDER_NAME, emoji: mergeFolderEmoji }}
          title="新建文件夹"
          defaultEmoji={mergeFolderEmoji}
          onClose={() => setMergeListsTarget(null)}
          onSubmit={submitMergeFolder}
        />
      )}
    </>
  );
}

interface FixedRowProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  onTodoDrop?: (itemId: string, listId: string) => boolean;
  todoDropListId?: string | null;
  trailing?: React.ReactNode;
  isDark: boolean;
}

function SidebarFixedRow({
  icon,
  label,
  count,
  active,
  onClick,
  onContextMenu,
  onTodoDrop,
  todoDropListId = null,
  trailing,
  isDark,
}: FixedRowProps) {
  const rowRef = useRef<HTMLElement | null>(null);
  const [todoDropOver, setTodoDropOver] = useState(false);

  useEffect(() => {
    if (!onTodoDrop || !todoDropListId) return undefined;
    return registerTodoCalendarDropTarget({
      containsPoint: (clientX, clientY) => {
        const rect = rowRef.current?.getBoundingClientRect();
        return (
          rect != null &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      },
      drop: (itemId) => onTodoDrop(itemId, todoDropListId),
      onDragOverChange: setTodoDropOver,
    });
  }, [onTodoDrop, todoDropListId]);

  return (
    <Box
      ref={rowRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      sx={{
        height: ROW_HEIGHT,
        mx: 0.5,
        my: 0.25,
        pl: 1.0,
        pr: 0.1,
        display: "flex",
        alignItems: "center",
        gap: 1,
        borderRadius: 1,
        cursor: "pointer",
        outline: todoDropOver ? 1 : 0,
        outlineColor: "primary.main",
        bgcolor: active
          ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.08)
          : todoDropOver
            ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.06)
          : "transparent",
        ":hover": {
          bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
        },
        ...hoverCountActionParentSx(),
      }}
    >
      <Box sx={{ display: "flex", color: "text.secondary" }}>{icon}</Box>
      <Typography
        sx={{
          fontSize: 14,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Typography>
      {count > 0 && <SidebarCountSlot count={count} isDark={isDark} />}
      {trailing}
    </Box>
  );
}

function HoverRowActionSlot({
  count,
  isDark,
  icon,
  onClick,
}: {
  count: number;
  isDark: boolean;
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <HoverCountActionSlot count={count} isDark={isDark} icon={icon} onClick={onClick} />
  );
}

function CustomFilterContextMenu({
  anchor,
  onClose,
  onRename,
  onDelete,
}: {
  anchor: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: anchor.y, left: anchor.x }}
    >
      <MenuItem onClick={onRename}>
        <ListItemIcon>
          <EditRoundedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>修改名称</ListItemText>
      </MenuItem>
      <Divider />
      <MenuItem onClick={onDelete}>
        <ListItemIcon>
          <DeleteOutlineRoundedIcon fontSize="small" color="error" />
        </ListItemIcon>
        <ListItemText sx={{ color: "error.main" }}>删除过滤器</ListItemText>
      </MenuItem>
    </Menu>
  );
}

function FolderContextMenu({
  anchor,
  onClose,
  onEdit,
  onCreateList,
  onDelete,
}: {
  anchor: { x: number; y: number };
  onClose: () => void;
  onEdit: () => void;
  onCreateList: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: anchor.y, left: anchor.x }}
    >
      <MenuItem onClick={onEdit}>
        <ListItemIcon>
          <EditRoundedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>编辑（名称 / Emoji）</ListItemText>
      </MenuItem>
      <MenuItem onClick={onCreateList}>
        <ListItemIcon>
          <AddRoundedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>在文件夹中新建清单</ListItemText>
      </MenuItem>
      <Divider />
      <MenuItem onClick={onDelete}>
        <ListItemIcon>
          <DeleteOutlineRoundedIcon fontSize="small" color="error" />
        </ListItemIcon>
        <ListItemText sx={{ color: "error.main" }}>删除文件夹</ListItemText>
      </MenuItem>
    </Menu>
  );
}

interface FolderRowProps {
  folder: TodoFolder;
  count: number;
  active: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onClick: () => void;
  onCreateList: () => void;
  onContextMenu: (e: MouseEvent) => void;
  onTodoDragOverChange?: (folderId: string, isOver: boolean) => void;
  isDark: boolean;
  disableHover?: boolean;
  dragData?: SidebarDragItem;
  dropData?: SidebarDropData;
  dropState?: DropRowState;
}

function SidebarFolderRow({
  folder,
  count,
  active,
  collapsed,
  onToggle,
  onClick,
  onCreateList,
  onContextMenu,
  onTodoDragOverChange,
  isDark,
  disableHover = false,
  dragData,
  dropData,
  dropState,
}: FolderRowProps) {
  const draggable = useDraggable({
    id: dragData ? sidebarDragId(dragData) : `todo-sidebar-folder-disabled:${folder.id}`,
    data: dragData,
    disabled: !dragData,
  });
  const droppable = useDroppable({
    id: rootDropId("folder", folder.id),
    data: dropData,
    disabled: !dropData,
  });
  const rowRef = useRef<HTMLElement | null>(null);
  const [todoDropOver, setTodoDropOver] = useState(false);
  const setRowRef = (node: HTMLElement | null) => {
    rowRef.current = node;
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  useEffect(() => {
    if (!onTodoDragOverChange) return undefined;
    return registerTodoCalendarDropTarget({
      containsPoint: (clientX, clientY) => {
        const rect = rowRef.current?.getBoundingClientRect();
        return (
          rect != null &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      },
      drop: () => false,
      onDragOverChange: (isOver) => {
        setTodoDropOver(isOver);
        onTodoDragOverChange(folder.id, isOver);
      },
    });
  }, [folder.id, onTodoDragOverChange]);
  const rowDragging = draggable.isDragging;
  const transform = !rowDragging && draggable.transform
    ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`
    : undefined;
  return (
    <Box
      data-todo-sidebar-row="true"
      ref={setRowRef}
      style={{ transform }}
      {...draggable.attributes}
      {...draggable.listeners}
      onClick={onClick}
      onContextMenu={onContextMenu}
      sx={{
        height: rowDragging ? 0 : ROW_HEIGHT,
        mx: 0.5,
        my: rowDragging ? 0 : 0.25,
        pl: 0.5,
        pr: 0.1,
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 0.6,
        borderRadius: 1,
        cursor: dragData ? "grab" : "pointer",
        opacity: rowDragging ? 0 : 1,
        overflow: "hidden",
        pointerEvents: rowDragging ? "none" : undefined,
        touchAction: "none",
        outline: !rowDragging && (dropState === "inside" || todoDropOver) ? 1 : 0,
        outlineColor: "primary.main",
        bgcolor: rowDragging
          ? "transparent"
          : active
            ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.08)
            : dropState === "inside" || todoDropOver
              ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.06)
            : "transparent",
        transition:
          "height 120ms ease, margin 120ms ease, opacity 120ms ease, background-color 120ms ease",
        ":hover": {
          bgcolor: disableHover
            ? active
              ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.08)
              : dropState === "inside" || todoDropOver
                ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.06)
                : "transparent"
            : alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
        },
        ...hoverCountActionParentSx(),
      }}
    >
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        sx={{ width: 22, height: 22 }}
      >
        {collapsed ? (
          <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16 }} />
        ) : (
          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
        )}
      </IconButton>
      <Box sx={{ fontSize: 16, lineHeight: 1, width: 18, textAlign: "center" }}>
        <TodoEmoji emoji={folder.emoji} fallback="📁" size={16} />
      </Box>
      <Typography
        sx={{
          fontSize: 14,
          flex: 1,
          minWidth: 0,
          fontWeight: 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {folder.name}
      </Typography>
      <FolderRowActionSlot count={count} isDark={isDark} onCreateList={onCreateList} />
    </Box>
  );
}

function FolderRowActionSlot({
  count,
  isDark,
  onCreateList,
}: {
  count: number;
  isDark: boolean;
  onCreateList: () => void;
}) {
  return (
    <HoverCountActionSlot
      count={count}
      isDark={isDark}
      icon={<AddRoundedIcon sx={{ fontSize: 15 }} />}
      onClick={() => onCreateList()}
      actionLabel="新建清单"
    />
  );
}

interface ListRowProps {
  list: TodoList;
  isDefault: boolean;
  count: number;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: MouseEvent) => void;
  onActionMenu: (e: MouseEvent<HTMLButtonElement>) => void;
  onTodoDrop?: (itemId: string, listId: string) => boolean;
  isDark: boolean;
  disableHover?: boolean;
  archived?: boolean;
  indent?: boolean;
  dragData?: SidebarDragItem;
  dropData?: SidebarDropData;
  dropState?: DropRowState;
}

function SidebarListRow({
  list,
  isDefault,
  count,
  active,
  onClick,
  onContextMenu,
  onActionMenu,
  onTodoDrop,
  isDark,
  disableHover = false,
  archived = false,
  indent = false,
  dragData,
  dropData,
  dropState,
}: ListRowProps) {
  const draggable = useDraggable({
    id: dragData ? sidebarDragId(dragData) : `todo-sidebar-list-disabled:${list.id}`,
    data: dragData,
    disabled: !dragData || archived,
  });
  const droppable = useDroppable({
    id:
      dropData?.type === "folder-list-row"
        ? folderListDropId(dropData.folderId, dropData.targetListId)
        : rootDropId("list", list.id),
    data: dropData,
    disabled: !dropData,
  });
  const rowRef = useRef<HTMLElement | null>(null);
  const [todoDropOver, setTodoDropOver] = useState(false);
  const setRowRef = (node: HTMLElement | null) => {
    rowRef.current = node;
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  useEffect(() => {
    if (archived || !onTodoDrop) return undefined;
    return registerTodoCalendarDropTarget({
      containsPoint: (clientX, clientY) => {
        const rect = rowRef.current?.getBoundingClientRect();
        return (
          rect != null &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      },
      drop: (itemId) => onTodoDrop(itemId, list.id),
      onDragOverChange: setTodoDropOver,
    });
  }, [archived, list.id, onTodoDrop]);
  const rowDragging = draggable.isDragging;
  const transform = !rowDragging && draggable.transform
    ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`
    : undefined;
  return (
    <Box
      data-todo-sidebar-row="true"
      ref={setRowRef}
      style={{ transform }}
      {...draggable.attributes}
      {...draggable.listeners}
      onClick={onClick}
      onContextMenu={onContextMenu}
      sx={{
        height: rowDragging ? 0 : ROW_HEIGHT,
        ml: indent ? 2.7 : 0.5,
        mr: 0.5,
        my: rowDragging ? 0 : 0.25,
        pl: 1.0,
        pr: 0.1,
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 1,
        borderRadius: 1,
        cursor: dragData && !archived ? "grab" : "pointer",
        opacity: rowDragging ? 0 : 1,
        overflow: "hidden",
        pointerEvents: rowDragging ? "none" : undefined,
        touchAction: "none",
        outline: !rowDragging && (dropState === "inside" || todoDropOver) ? 1 : 0,
        outlineColor: "primary.main",
        bgcolor: rowDragging
          ? "transparent"
          : active
            ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.08)
            : dropState === "inside" || todoDropOver
              ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.06)
            : "transparent",
        transition:
          "height 120ms ease, margin 120ms ease, opacity 120ms ease, background-color 120ms ease",
        ":hover": {
          bgcolor: disableHover
            ? active
              ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.08)
              : dropState === "inside" || todoDropOver
                ? alpha(isDark ? "#f8fafc" : "#0f172a", 0.06)
                : "transparent"
            : alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
        },
        ...hoverCountActionParentSx(),
      }}
    >
      <Box sx={{ fontSize: 16, lineHeight: 1, width: 18, textAlign: "center" }}>
        <TodoEmoji emoji={list.emoji} fallback="📋" size={16} />
      </Box>
      <Typography
        sx={{
          fontSize: 14,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: archived ? "text.secondary" : "text.primary",
        }}
      >
        {list.name}
      </Typography>
      {archived && (
        <ArchiveRoundedIcon sx={{ fontSize: 14, color: "text.disabled" }} />
      )}
      {isDefault && <DefaultListStar />}
      <HoverRowActionSlot
        count={count}
        isDark={isDark}
        icon={<MoreHorizRoundedIcon sx={{ fontSize: 16 }} />}
        onClick={onActionMenu}
      />
    </Box>
  );
}

function sidebarDropPlaceholderSx(isDark: boolean, indent = false) {
  return {
    height: ROW_HEIGHT,
    ml: indent ? 2.7 : 0.5,
    mr: 0.5,
    my: 0.25,
    borderRadius: 1,
    bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.05),
    outline: "1px dashed",
    outlineColor: "primary.main",
    outlineOffset: "-1px",
    opacity: 0.82,
  };
}

function SidebarDropPlaceholder({
  isDark,
  indent = false,
}: {
  isDark: boolean;
  indent?: boolean;
}) {
  return (
    <Box
      aria-hidden
      sx={{
        ...sidebarDropPlaceholderSx(isDark, indent),
        pointerEvents: "none",
      }}
    />
  );
}

function SidebarDragPreview({
  item,
  folders,
  lists,
  defaultListId,
  listCount,
  folderCount,
  isDark,
  width,
}: {
  item: SidebarDragItem | null;
  folders: TodoFolder[];
  lists: TodoList[];
  defaultListId: string | null;
  listCount: (listId: string) => number;
  folderCount: (folderId: string) => number;
  isDark: boolean;
  width: number | null;
}) {
  if (!item) return null;

  if (item.kind === "folder") {
    const folder = folders.find((entry) => entry.id === item.id);
    if (!folder) return null;
    return (
      <Box sx={sidebarDragPreviewSx(isDark, width, 0.7)}>
        <Box sx={{ width: 22, display: "flex", justifyContent: "center" }}>
          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
        </Box>
        <Box sx={{ fontSize: 16, lineHeight: 1, width: 18, textAlign: "center" }}>
          <TodoEmoji emoji={folder.emoji} fallback="📁" size={16} />
        </Box>
        <Typography
          sx={{
            fontSize: 14,
            flex: 1,
            minWidth: 0,
            fontWeight: 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {folder.name}
        </Typography>
        {folderCount(folder.id) > 0 && <CountBadge count={folderCount(folder.id)} isDark={isDark} />}
      </Box>
    );
  }

  const list = lists.find((entry) => entry.id === item.id);
  if (!list) return null;
  return (
    <Box sx={sidebarDragPreviewSx(isDark, width, 1.2)}>
      <Box sx={{ fontSize: 16, lineHeight: 1, width: 18, textAlign: "center" }}>
        <TodoEmoji emoji={list.emoji} fallback="📋" size={16} />
      </Box>
      <Typography
        sx={{
          fontSize: 14,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {list.name}
      </Typography>
      {list.id === defaultListId && <DefaultListStar />}
      {listCount(list.id) > 0 && <CountBadge count={listCount(list.id)} isDark={isDark} />}
    </Box>
  );
}

function sidebarDragPreviewSx(isDark: boolean, width: number | null, px: number) {
  return {
    width: width ?? 220,
    height: ROW_HEIGHT,
    px,
    display: "flex",
    alignItems: "center",
    gap: 1,
    borderRadius: 1,
    color: "text.primary",
    bgcolor: isDark ? "#20293a" : "#ffffff",
    border: 1,
    borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.16),
    boxShadow: isDark
      ? "0 10px 28px rgba(0, 0, 0, 0.36)"
      : "0 10px 28px rgba(15, 23, 42, 0.16)",
    cursor: "grabbing",
    pointerEvents: "none",
  };
}

function DefaultListStar() {
  return (
    <Box
      component="span"
      title="默认清单"
      aria-label="默认清单"
      sx={{
        width: 16,
        height: 16,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "warning.main",
      }}
    >
      <StarRoundedIcon sx={{ fontSize: 14 }} />
    </Box>
  );
}

function SidebarDropHotspot({
  id,
  data,
  visible,
  indent = false,
  placement,
  height = DEFAULT_DROP_ZONE_HEIGHT,
}: {
  id: string;
  data: SidebarDropData;
  visible: boolean;
  indent?: boolean;
  placement: "top" | "bottom";
  height?: number;
}) {
  const droppable = useDroppable({ id, data, disabled: !visible });
  return (
    <Box
      ref={droppable.setNodeRef}
      aria-hidden
      sx={{
        position: "absolute",
        left: indent ? 2.7 * 8 : 4,
        right: 4,
        top: placement === "top" ? 0 : undefined,
        bottom: placement === "bottom" ? 0 : undefined,
        height: visible ? height : 0,
        zIndex: 3,
        pointerEvents: visible ? "auto" : "none",
      }}
    />
  );
}

function SidebarCountSlot({ count, isDark }: { count: number; isDark: boolean }) {
  return (
    <Box
      sx={{
        width: SIDEBAR_TRAILING_SLOT_WIDTH,
        height: 24,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
      }}
    >
      <CountBadge count={count} isDark={isDark} />
    </Box>
  );
}
