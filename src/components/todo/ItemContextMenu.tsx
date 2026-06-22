// Right-click menu for a task row. Status changes, due-date editing,
// marked toggle, copy/move to another list (submenu), delete.

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  Box,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import OutlinedFlagRoundedIcon from "@mui/icons-material/OutlinedFlagRounded";
import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import WbSunnyRoundedIcon from "@mui/icons-material/WbSunnyRounded";
import WbTwilightRoundedIcon from "@mui/icons-material/WbTwilightRounded";
import EventBusyRoundedIcon from "@mui/icons-material/EventBusyRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import LabelRoundedIcon from "@mui/icons-material/LabelRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DriveFileMoveRoundedIcon from "@mui/icons-material/DriveFileMoveRounded";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import SubdirectoryArrowRightRoundedIcon from "@mui/icons-material/SubdirectoryArrowRightRounded";
import TimerRoundedIcon from "@mui/icons-material/TimerRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";

import { isTodoCompletionBlocked, useTodoStore } from "./useTodoStore";
import type { TodoItem, TodoList } from "./types";
import { TodoEmoji } from "./TodoEmoji";
import { TODO_PRIORITY_OPTIONS } from "./priority";
import { requestTodoPomodoroStart } from "./todoPomodoroEvents";

type SubmenuKind = "copy" | "move" | "group" | "predecessor";
type ListTargetKind = Extract<SubmenuKind, "copy" | "move">;

function compareByOrderName<T extends { order: number; name: string; createdAt?: number }>(a: T, b: T) {
  return a.order - b.order || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.name.localeCompare(b.name);
}

function activeTargetLists(lists: TodoList[], items: TodoItem[], kind: ListTargetKind) {
  return lists
    .filter((list) => list.archivedAt == null)
    .filter((list) => kind === "copy" || items.some((item) => item.listId !== list.id))
    .sort(compareByOrderName);
}

function firstFolderTargetList(
  lists: TodoList[],
  folderId: string,
  items: TodoItem[],
  kind: ListTargetKind,
) {
  return activeTargetLists(lists, items, kind).find((list) => list.folderId === folderId) ?? null;
}

function hasSelectedAncestor(
  item: TodoItem,
  selectedIds: Set<string>,
  itemById: Map<string, TodoItem>,
) {
  const visited = new Set<string>();
  let parentId = item.parentId;
  while (parentId) {
    if (selectedIds.has(parentId)) return true;
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    parentId = itemById.get(parentId)?.parentId ?? null;
  }
  return false;
}

function rootOperationItems(items: TodoItem[], allItems: TodoItem[]) {
  const selectedIds = new Set(items.map((item) => item.id));
  const itemById = new Map(allItems.map((item) => [item.id, item]));
  return items.filter((item) => !hasSelectedAncestor(item, selectedIds, itemById));
}

async function copyTextToClipboard(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the legacy path for WebView clipboard edge cases.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function startOfLocalDayMs(input: number | Date = new Date()): number {
  const date = input instanceof Date ? input : new Date(input);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function addLocalDays(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function CalendarBadgeIcon({ label }: { label: string }) {
  return (
    <Box sx={{ position: "relative", width: 20, height: 20, display: "grid", placeItems: "center" }}>
      <CalendarTodayRoundedIcon sx={{ fontSize: 20 }} />
      <Box
        component="span"
        sx={{
          position: "absolute",
          top: 7,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 8,
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        {label}
      </Box>
    </Box>
  );
}

function compactTaskTitle(content: string) {
  const title = content.trim().replace(/\s+/g, " ");
  if (!title) return "未命名待办";
  return title.length > 42 ? `${title.slice(0, 42)}...` : title;
}

function wouldCreatePredecessorCycle(
  items: TodoItem[],
  targetId: string,
  predecessorId: string,
) {
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  let currentId: string | null = predecessorId;
  while (currentId != null) {
    if (currentId === targetId) return true;
    if (seen.has(currentId)) return true;
    seen.add(currentId);
    currentId = byId.get(currentId)?.predecessorId ?? null;
  }
  return false;
}

interface Props {
  item: TodoItem;
  anchor: { x: number; y: number };
  onClose: () => void;
  // Caller opens its own DueDatePopover with these screen coordinates as
  // an anchorPosition reference so the popover survives this menu unmounting.
  onPickDueDate: (anchorPosition: { top: number; left: number }) => void;
  // Same idea for the tag editor — caller renders the popover so the
  // context menu unmount doesn't tear down the focus target.
  onPickTags: (anchorPosition: { top: number; left: number }) => void;
  onCreateChild: () => void;
}

export function ItemContextMenu({
  item,
  anchor,
  onClose,
  onPickDueDate,
  onPickTags,
  onCreateChild,
}: Props) {
  const theme = useTheme();
  const setStatus = useTodoStore((s) => s.setStatus);
  const deleteItem = useTodoStore((s) => s.deleteItem);
  const copyItem = useTodoStore((s) => s.copyItem);
  const moveItem = useTodoStore((s) => s.moveItem);
  const updateItem = useTodoStore((s) => s.updateItem);
  const setDueRange = useTodoStore((s) => s.setDueRange);
  const setItemGroup = useTodoStore((s) => s.setItemGroup);
  const setItemPredecessor = useTodoStore((s) => s.setItemPredecessor);
  const allItems = useTodoStore((s) => s.items);
  const multiSelectedItemIds = useTodoStore((s) => s.multiSelectedItemIds);
  const lists = useTodoStore((s) => s.lists);
  const folders = useTodoStore((s) => s.folders);
  const groups = useTodoStore((s) => s.groups);
  const targetItems = useMemo(() => {
    if (!multiSelectedItemIds.includes(item.id)) return [item];
    const itemById = new Map(allItems.map((entry) => [entry.id, entry]));
    const selected = multiSelectedItemIds
      .map((id) => itemById.get(id))
      .filter((entry): entry is TodoItem => entry != null && entry.deletedAt == null);
    return selected.length > 0 ? selected : [item];
  }, [allItems, item, multiSelectedItemIds]);
  const operationItems = useMemo(
    () => rootOperationItems(targetItems, allItems),
    [allItems, targetItems],
  );
  const canCompleteOperationItems = operationItems.some(
    (target) =>
      target.status !== "completed" && !isTodoCompletionBlocked(target, allItems),
  );
  const targetCount = targetItems.length;
  const isBatch = targetCount > 1;
  const allMarked = targetItems.every((target) => target.marked);
  const nextMarked = !allMarked;
  const todayStart = startOfLocalDayMs();
  const todayDefaultDueAt = todayStart + 9 * 60 * 60 * 1000;
  const tomorrowStart = addLocalDays(todayStart, 1);
  const nextWeekStart = addLocalDays(todayStart, 7);
  const allDueOnDay = (dayStart: number) =>
    targetItems.every(
      (target) => target.dueAt != null && startOfLocalDayMs(target.dueAt) === dayStart,
    );
  const allNoDue = targetItems.every((target) => target.dueAt == null);
  const canGroupTargets = operationItems.every((target) => target.listId === item.listId);
  const predecessorTargets = useMemo(
    () =>
      allItems
        .filter(
          (target) =>
            target.id !== item.id &&
            target.deletedAt == null &&
            target.status === "pending" &&
            !wouldCreatePredecessorCycle(allItems, target.id, item.id),
        )
        .sort((a, b) => a.order - b.order || b.updatedAt - a.updatedAt),
    [allItems, item.id],
  );
  const listGroups = groups
    .filter((group) => group.listId === item.listId)
    .sort((a, b) => a.order - b.order);
  const sortedFolders = useMemo(
    () => folders.slice().sort(compareByOrderName),
    [folders],
  );
  const rootListsByKind = useMemo(
    () => ({
      copy: activeTargetLists(lists, targetItems, "copy").filter((list) => list.folderId == null),
      move: activeTargetLists(lists, operationItems, "move").filter((list) => list.folderId == null),
    }),
    [lists, operationItems, targetItems],
  );
  const folderListsByKind = useMemo(() => {
    const next = {
      copy: new Map<string, TodoList[]>(),
      move: new Map<string, TodoList[]>(),
    };
    for (const kind of ["copy", "move"] as const) {
      const listTargetItems = kind === "copy" ? targetItems : operationItems;
      for (const list of activeTargetLists(lists, listTargetItems, kind)) {
        if (list.folderId == null) continue;
        const group = next[kind].get(list.folderId) ?? [];
        group.push(list);
        next[kind].set(list.folderId, group);
      }
    }
    return next;
  }, [lists, operationItems, targetItems]);
  // Sub-menu state — when set, render a secondary `Menu` anchored to the
  // submenu trigger row.
  const submenuCloseTimerRef = useRef<number | null>(null);
  const [subAnchor, setSubAnchor] = useState<{
    el: HTMLElement;
    kind: SubmenuKind;
  } | null>(null);
  const folderSubmenuCloseTimerRef = useRef<number | null>(null);
  const [folderSubAnchor, setFolderSubAnchor] = useState<{
    el: HTMLElement;
    kind: ListTargetKind;
    folderId: string;
  } | null>(null);

  const clearSubmenuCloseTimer = () => {
    if (submenuCloseTimerRef.current == null) return;
    window.clearTimeout(submenuCloseTimerRef.current);
    submenuCloseTimerRef.current = null;
  };

  const clearFolderSubmenuCloseTimer = () => {
    if (folderSubmenuCloseTimerRef.current == null) return;
    window.clearTimeout(folderSubmenuCloseTimerRef.current);
    folderSubmenuCloseTimerRef.current = null;
  };

  const scheduleSubmenuClose = () => {
    clearSubmenuCloseTimer();
    clearFolderSubmenuCloseTimer();
    submenuCloseTimerRef.current = window.setTimeout(() => {
      setSubAnchor(null);
      setFolderSubAnchor(null);
      submenuCloseTimerRef.current = null;
    }, 120);
  };

  const scheduleFolderSubmenuClose = () => {
    clearFolderSubmenuCloseTimer();
    folderSubmenuCloseTimerRef.current = window.setTimeout(() => {
      setFolderSubAnchor(null);
      folderSubmenuCloseTimerRef.current = null;
    }, 160);
  };

  const openSubmenu = (el: HTMLElement, kind: SubmenuKind) => {
    clearSubmenuCloseTimer();
    clearFolderSubmenuCloseTimer();
    if (kind !== "copy" && kind !== "move") setFolderSubAnchor(null);
    setSubAnchor((current) =>
      current?.el === el && current.kind === kind ? current : { el, kind },
    );
  };

  const openFolderSubmenu = (el: HTMLElement, kind: ListTargetKind, folderId: string) => {
    clearSubmenuCloseTimer();
    clearFolderSubmenuCloseTimer();
    setFolderSubAnchor((current) =>
      current?.el === el && current.kind === kind && current.folderId === folderId
        ? current
        : { el, kind, folderId },
    );
  };

  const applyListTarget = (kind: ListTargetKind, listId: string) => {
    const items = kind === "copy" ? targetItems : operationItems;
    for (const target of items) {
      if (kind === "copy") {
        copyItem(target.id, listId);
      } else if (target.listId !== listId) {
        moveItem(target.id, listId);
      }
    }
    close();
  };

  const applyFolderTarget = (kind: ListTargetKind, folderId: string) => {
    const items = kind === "copy" ? targetItems : operationItems;
    const target = firstFolderTargetList(lists, folderId, items, kind);
    if (!target) return;
    applyListTarget(kind, target.id);
  };

  const applyStatus = (status: TodoItem["status"]) => {
    for (const target of operationItems) setStatus(target.id, status);
    close();
  };

  const applyPriority = (value: TodoItem["priority"]) => {
    const nextPriority = targetItems.every((target) => target.priority === value)
      ? null
      : value;
    for (const target of targetItems) updateItem(target.id, { priority: nextPriority });
    close();
  };

  const applyDueShortcut = (dueAt: number | null) => {
    for (const target of targetItems) setDueRange(target.id, dueAt, null, false);
    close();
  };

  const applyMarked = () => {
    for (const target of targetItems) updateItem(target.id, { marked: nextMarked });
    close();
  };

  const applyGroup = (groupId: string | null) => {
    if (!canGroupTargets) return;
    for (const target of operationItems) setItemGroup(target.id, groupId);
    close();
  };

  const applyPredecessorTarget = (targetId: string) => {
    const target = allItems.find((entry) => entry.id === targetId);
    if (!target) return;
    if (item.status !== "pending") return;
    setItemPredecessor(targetId, target.predecessorId === item.id ? null : item.id);
    close();
  };

  const deleteTargets = () => {
    for (const target of operationItems) deleteItem(target.id);
    close();
  };

  const copyTargetContents = () => {
    const text = targetItems
      .map((target) => target.content.trim())
      .filter(Boolean)
      .join("\n");
    void copyTextToClipboard(text);
    close();
  };

  const renderListTargetMenu = (kind: ListTargetKind) => {
    const rootLists = rootListsByKind[kind];
    const folderMap = folderListsByKind[kind];
    const foldersWithTargets = sortedFolders
      .map((folder) => ({ folder, lists: folderMap.get(folder.id) ?? [] }))
      .filter((entry) => entry.lists.length > 0);
    const hasTargets = rootLists.length > 0 || foldersWithTargets.length > 0;

    return (
      <>
        {!hasTargets && (
          <MenuItem disabled>
            <ListItemText>鏆傛棤鍏朵粬娓呭崟</ListItemText>
          </MenuItem>
        )}
        {rootLists.map((list) => (
          <MenuItem key={list.id} onClick={() => applyListTarget(kind, list.id)}>
            <ListItemText>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <TodoEmoji emoji={list.emoji} fallback="馃搵" size={16} />
                <span>{list.name}</span>
              </span>
            </ListItemText>
          </MenuItem>
        ))}
        {foldersWithTargets.map(({ folder }) => (
          <MenuItem
            key={folder.id}
            onMouseEnter={(event) => openFolderSubmenu(event.currentTarget, kind, folder.id)}
            onMouseLeave={scheduleFolderSubmenuClose}
            onClick={() => applyFolderTarget(kind, folder.id)}
          >
            <ListItemText>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <TodoEmoji emoji={folder.emoji} fallback="馃搷" size={16} />
                <span>{folder.name}</span>
              </span>
            </ListItemText>
            <ChevronRightRoundedIcon fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
          </MenuItem>
        ))}
      </>
    );
  };

  const submenuTriggerProps = (kind: SubmenuKind) => ({
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) =>
      openSubmenu(e.currentTarget, kind),
    onMouseLeave: scheduleSubmenuClose,
    onClick: (e: ReactMouseEvent<HTMLElement>) => openSubmenu(e.currentTarget, kind),
  });

  useEffect(
    () => () => {
      clearSubmenuCloseTimer();
      clearFolderSubmenuCloseTimer();
    },
    [],
  );

  const close = () => {
    clearSubmenuCloseTimer();
    clearFolderSubmenuCloseTimer();
    setSubAnchor(null);
    setFolderSubAnchor(null);
    onClose();
  };

  const actionButtonSx = (active: boolean, color = theme.palette.primary.main) => ({
    width: 30,
    height: 30,
    border: 0,
    borderRadius: 1,
    p: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: active ? color : "text.secondary",
    bgcolor: active ? alpha(color, 0.14) : "transparent",
    cursor: "pointer",
    outline: "none",
    transition: "background-color 120ms ease, color 120ms ease",
    "&:hover": {
      color,
      bgcolor: alpha(color, active ? 0.2 : 0.1),
    },
    "&:focus-visible": {
      boxShadow: `0 0 0 2px ${alpha(color, 0.28)}`,
    },
    "&:disabled": {
      color: "text.disabled",
      bgcolor: "transparent",
      cursor: "default",
      opacity: 0.55,
    },
  });

  return (
    <>
      <Menu
        open
        onClose={close}
        container={document.body}
        anchorReference="anchorPosition"
        anchorPosition={{ top: anchor.y, left: anchor.x }}
        marginThreshold={8}
        slotProps={{
          root: {
            sx: { zIndex: (theme) => theme.zIndex.modal + 20 },
          },
          paper: {
            sx: {
              maxHeight: "calc(100vh - 16px)",
              overflowY: "auto",
              overscrollBehavior: "contain",
            },
          },
        }}
      >
        <Box sx={{ px: 1.25, pt: 0.85, pb: 0.45 }}>
          <Box sx={{ mb: 0.45, fontSize: 11, fontWeight: 700, color: "text.disabled" }}>
            日期
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box
              component="button"
              type="button"
              title="今天"
              aria-label="今天"
              onClick={() => applyDueShortcut(todayDefaultDueAt)}
              sx={actionButtonSx(allDueOnDay(todayStart))}
            >
              <WbSunnyRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Box
              component="button"
              type="button"
              title="明天"
              aria-label="明天"
              onClick={() => applyDueShortcut(tomorrowStart)}
              sx={actionButtonSx(allDueOnDay(tomorrowStart))}
            >
              <WbTwilightRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Box
              component="button"
              type="button"
              title="下周"
              aria-label="下周"
              onClick={() => applyDueShortcut(nextWeekStart)}
              sx={actionButtonSx(allDueOnDay(nextWeekStart))}
            >
              <CalendarBadgeIcon label="7" />
            </Box>
            <Box
              component="button"
              type="button"
              title="选择时间"
              aria-label="选择时间"
              disabled={isBatch}
              onClick={() => {
                onPickDueDate({ top: anchor.y, left: anchor.x });
                close();
              }}
              sx={actionButtonSx(false)}
            >
              <CalendarMonthRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Box
              component="button"
              type="button"
              title="清除时间"
              aria-label="清除时间"
              onClick={() => applyDueShortcut(null)}
              sx={actionButtonSx(allNoDue)}
            >
              <EventBusyRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
          </Box>
        </Box>
        <Box sx={{ px: 1.25, pt: 0.4, pb: 0.75 }}>
          <Box sx={{ mb: 0.45, fontSize: 11, fontWeight: 700, color: "text.disabled" }}>
            优先级
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            {TODO_PRIORITY_OPTIONS.map((option) => {
              const active = targetItems.every((target) => target.priority === option.value);
              return (
                <Box
                  key={option.value}
                  component="button"
                  type="button"
                  title={option.label}
                  aria-label={option.label}
                  onClick={() => applyPriority(option.value)}
                  sx={{
                    ...actionButtonSx(active, option.color),
                    width: 36,
                    border: "1px solid",
                    borderColor: active ? option.color : "transparent",
                    fontSize: 11,
                    fontWeight: 900,
                    fontFamily: "inherit",
                    color: option.color,
                    bgcolor: active ? alpha(option.color, 0.12) : "transparent",
                    boxShadow: active ? `0 0 0 2px ${alpha(option.color, 0.18)}` : "none",
                    "&:hover": {
                      color: option.color,
                      bgcolor: alpha(option.color, active ? 0.18 : 0.08),
                    },
                  }}
                >
                  {option.emoji}
                </Box>
              );
            })}
          </Box>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => applyStatus("pending")}
          disabled={operationItems.every((target) => target.status === "pending")}
        >
          <ListItemIcon>
            <RadioButtonUncheckedRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>设为未完成</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => applyStatus("completed")}
          disabled={!canCompleteOperationItems}
        >
          <ListItemIcon>
            <CheckRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>设为已完成</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => applyStatus("abandoned")}
          disabled={operationItems.every((target) => target.status === "abandoned")}
        >
          <ListItemIcon>
            <BlockRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>设为废弃</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            close();
            window.setTimeout(onCreateChild, 0);
          }}
          disabled={isBatch}
        >
          <ListItemIcon>
            <SubdirectoryArrowRightRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>新建子待办</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            requestTodoPomodoroStart(item.id);
            close();
          }}
          disabled={isBatch}
        >
          <ListItemIcon>
            <TimerRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>番茄专注</ListItemText>
        </MenuItem>
        <MenuItem
          {...(!isBatch && item.status === "pending" ? submenuTriggerProps("predecessor") : {})}
          disabled={isBatch || item.status !== "pending"}
        >
          <ListItemIcon>
            <LinkRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>设为前序任务</ListItemText>
          <ChevronRightRoundedIcon fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
        </MenuItem>
        <Divider />
        <MenuItem onClick={copyTargetContents}>
          <ListItemIcon>
            <ContentCopyRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{isBatch ? `复制 ${targetCount} 项内容` : "复制"}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={applyMarked}>
          <ListItemIcon>
            {allMarked ? (
              <FlagRoundedIcon fontSize="small" color="warning" />
            ) : (
              <OutlinedFlagRoundedIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>{allMarked ? "取消标记" : "标记"}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            onPickTags({ top: anchor.y, left: anchor.x });
            close();
          }}
          disabled={isBatch}
        >
          <ListItemIcon>
            <LabelRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {item.tags.length > 0
              ? `标签 (${item.tags.length})`
              : "标签"}
          </ListItemText>
        </MenuItem>
        <MenuItem
          {...(canGroupTargets ? submenuTriggerProps("group") : {})}
          disabled={!canGroupTargets}
        >
          <ListItemIcon>
            <FormatListBulletedRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>移动到分组</ListItemText>
          <ChevronRightRoundedIcon fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
        </MenuItem>
        <Divider />
        <MenuItem {...submenuTriggerProps("copy")}>
          <ListItemIcon>
            <ContentCopyRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>复制到清单</ListItemText>
          <ChevronRightRoundedIcon fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
        </MenuItem>
        <MenuItem {...submenuTriggerProps("move")}>
          <ListItemIcon>
            <DriveFileMoveRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>移动到清单</ListItemText>
          <ChevronRightRoundedIcon fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={deleteTargets}
        >
          <ListItemIcon>
            <DeleteOutlineRoundedIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>删除</ListItemText>
        </MenuItem>
      </Menu>
      {subAnchor && (
        <Menu
          open
          hideBackdrop
          container={document.body}
          marginThreshold={8}
          disableAutoFocus
          disableAutoFocusItem
          disableEnforceFocus
          disableRestoreFocus
          onClose={() => {
            clearSubmenuCloseTimer();
            setSubAnchor(null);
          }}
          anchorEl={subAnchor.el}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          slotProps={{
            root: {
              sx: { pointerEvents: "none" },
            },
            paper: {
              sx: {
                pointerEvents: "auto",
                maxHeight: "calc(100vh - 16px)",
                overflowY: "auto",
                overscrollBehavior: "contain",
              },
              onMouseEnter: clearSubmenuCloseTimer,
              onMouseLeave: scheduleSubmenuClose,
            },
            list: {
              onMouseEnter: clearSubmenuCloseTimer,
              onMouseLeave: scheduleSubmenuClose,
            },
          }}
        >
          {subAnchor.kind === "group" ? (
            <>
              <MenuItem
                selected={operationItems.every((target) => target.groupId == null)}
                onClick={() => applyGroup(null)}
              >
                <ListItemText>未分组</ListItemText>
              </MenuItem>
              {listGroups.length === 0 && (
                <MenuItem disabled>
                  <ListItemText>暂无分组</ListItemText>
                </MenuItem>
              )}
              {listGroups.map((group) => (
                <MenuItem
                  key={group.id}
                  selected={operationItems.every((target) => target.groupId === group.id)}
                  onClick={() => applyGroup(group.id)}
                >
                  <ListItemText>{group.name}</ListItemText>
                </MenuItem>
              ))}
            </>
          ) : subAnchor.kind === "copy" || subAnchor.kind === "move" ? (
            renderListTargetMenu(subAnchor.kind)
          ) : subAnchor.kind === "predecessor" ? (
            <>
              {predecessorTargets.length === 0 && (
                <MenuItem disabled>
                  <ListItemText>暂无可关联待办</ListItemText>
                </MenuItem>
              )}
              {predecessorTargets.map((target) => (
                <MenuItem
                  key={target.id}
                  selected={target.predecessorId === item.id}
                  onClick={() => applyPredecessorTarget(target.id)}
                >
                  <ListItemText>
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {compactTaskTitle(target.content)}
                      </Box>
                      {target.predecessorId === item.id && (
                        <Box
                          sx={{
                            mt: 0.2,
                            color: "text.secondary",
                            fontSize: 12,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          已关联，点击取消
                        </Box>
                      )}
                    </Box>
                  </ListItemText>
                </MenuItem>
              ))}
            </>
          ) : null}
        </Menu>
      )}
      {folderSubAnchor && (
        <Menu
          open
          hideBackdrop
          container={document.body}
          marginThreshold={8}
          disableAutoFocus
          disableAutoFocusItem
          disableEnforceFocus
          disableRestoreFocus
          onClose={() => {
            clearFolderSubmenuCloseTimer();
            setFolderSubAnchor(null);
          }}
          anchorEl={folderSubAnchor.el}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          slotProps={{
            root: {
              sx: { pointerEvents: "none" },
            },
            paper: {
              sx: {
                pointerEvents: "auto",
                maxHeight: "calc(100vh - 16px)",
                overflowY: "auto",
                overscrollBehavior: "contain",
              },
              onMouseEnter: () => {
                clearSubmenuCloseTimer();
                clearFolderSubmenuCloseTimer();
              },
              onMouseLeave: scheduleFolderSubmenuClose,
            },
            list: {
              onMouseEnter: () => {
                clearSubmenuCloseTimer();
                clearFolderSubmenuCloseTimer();
              },
              onMouseLeave: scheduleFolderSubmenuClose,
            },
          }}
        >
          {(folderListsByKind[folderSubAnchor.kind].get(folderSubAnchor.folderId) ?? []).map((list) => (
            <MenuItem key={list.id} onClick={() => applyListTarget(folderSubAnchor.kind, list.id)}>
              <ListItemText>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <TodoEmoji emoji={list.emoji} fallback="馃搵" size={16} />
                  <span>{list.name}</span>
                </span>
              </ListItemText>
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}
