// Single task row. Renders status chip, inline-editable
// content, compact due-date affordance, and a right-click menu
// (`ItemContextMenu`). Wrapped in `useSortable` when `draggable` so
// @dnd-kit can drive its position.

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Box,
  Chip,
  IconButton,
  InputBase,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import DisabledByDefaultRoundedIcon from "@mui/icons-material/DisabledByDefaultRounded";
import HighlightOffRoundedIcon from "@mui/icons-material/HighlightOffRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import RestoreFromTrashRoundedIcon from "@mui/icons-material/RestoreFromTrashRounded";
import DeleteForeverRoundedIcon from "@mui/icons-material/DeleteForeverRounded";
import { useSortable } from "@dnd-kit/sortable";

import { useStore } from "../../state/store";
import { midpointOrder, todoCompletionBlocker, useTodoStore } from "./useTodoStore";
import type { TodoItem as TodoItemT } from "./types";
import { ItemContextMenu } from "./ItemContextMenu";
import { DueDatePopover } from "./DueDatePopover";
import { TagPickerPopover } from "./TagPickerPopover";
import { priorityMeta } from "./priority";
import {
  beginTodoCalendarDrag,
  clearTodoCalendarDrag,
  finishTodoCalendarDrag,
  updateTodoCalendarDrag,
} from "./todoCalendarDrag";

export type TodoItemContextTarget =
  | { kind: "folder"; id: string }
  | { kind: "list"; id: string }
  | { kind: "group"; id: string; listId: string };

export interface TodoItemContextPathPart {
  key: string;
  label: string;
  target?: TodoItemContextTarget;
}

interface Props {
  item: TodoItemT;
  isDark: boolean;
  draggable: boolean;
  trashMode?: boolean;
  compactMeta?: boolean;
  depth?: number;
  showNotePreview?: boolean;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: (id: string) => void;
  onExpand?: (id: string) => void;
  disableOuterMargin?: boolean;
  flushOuterSpacing?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
  deferOffscreenRendering?: boolean;
  sortableDroppable?: boolean;
  virtualIndex?: number;
  measureRef?: (node: HTMLDivElement | null) => void;
  contextMeta?: string;
  contextTooltip?: string;
  contextTooltipMode?: "mui" | "native" | "none";
  contextPath?: TodoItemContextPathPart[];
  onOpenContextPath?: (target: TodoItemContextTarget) => void;
}

interface TodoItemBaseProps extends Props {
  sortable?: ReturnType<typeof useSortable>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfTodayMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function TodoItemBase({
  item,
  isDark,
  draggable,
  trashMode = false,
  compactMeta = false,
  depth = 0,
  showNotePreview = false,
  hasChildren = false,
  collapsed = false,
  onToggleCollapsed,
  onExpand,
  disableOuterMargin = false,
  flushOuterSpacing = false,
  dragHandleProps,
  deferOffscreenRendering = false,
  virtualIndex,
  measureRef,
  contextMeta,
  contextTooltip,
  contextTooltipMode = "mui",
  contextPath,
  onOpenContextPath,
  sortable,
}: TodoItemBaseProps) {
  const theme = useTheme();
  const setStatus = useTodoStore((s) => s.setStatus);
  const updateItem = useTodoStore((s) => s.updateItem);
  const setDueRange = useTodoStore((s) => s.setDueRange);
  const addItem = useTodoStore((s) => s.addItem);
  const restoreItem = useTodoStore((s) => s.restoreItem);
  const purgeItem = useTodoStore((s) => s.purgeItem);
  const selected = useTodoStore((s) => s.selectedItemId === item.id);
  const multiSelected = useTodoStore((s) => s.multiSelectedItemIds.includes(item.id));
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const setMultiSelectedItemIds = useTodoStore((s) => s.setMultiSelectedItemIds);
  const toggleMultiSelectedItemId = useTodoStore((s) => s.toggleMultiSelectedItemId);
  const clearMultiSelectedItemIds = useTodoStore((s) => s.clearMultiSelectedItemIds);
  const selectedFilter = useTodoStore((s) => s.selectedFilter);
  const completionBlocker = useTodoStore((s) => todoCompletionBlocker(item, s.items));
  const checkboxShape = useStore((s) => s.appSettings.todoCheckboxShape);
  const rowAccentColor = theme.palette.primary.main;
  const rowSelectedBg = alpha(rowAccentColor, isDark ? 0.18 : 0.11);
  const rowSelectedHoverBg = alpha(rowAccentColor, isDark ? 0.24 : 0.15);
  const rowHoverBg = alpha(rowAccentColor, isDark ? 0.13 : 0.07);
  const rowActiveBg = alpha(rowAccentColor, isDark ? 0.28 : 0.18);

  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      sortable?.setNodeRef(node);
      measureRef?.(node);
    },
    [measureRef, sortable],
  );
  const dragTransform = sortable?.transform
    ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
    : undefined;
  const style: CSSProperties = {
    transform: dragTransform,
    transition: sortable?.isDragging ? undefined : sortable?.transition,
    opacity: sortable?.isDragging ? 0.78 : 1,
    zIndex: sortable?.isDragging ? 2 : undefined,
    willChange: sortable?.isDragging ? "transform" : undefined,
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dueAnchor, setDueAnchor] = useState<HTMLElement | null>(null);
  const [duePos, setDuePos] = useState<{ top: number; left: number } | null>(null);
  const [tagPos, setTagPos] = useState<{ top: number; left: number } | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const calendarDragStateRef = useRef({
    active: false,
    endedAt: 0,
    pointerId: -1,
    startX: 0,
    startY: 0,
  });
  const [calendarDragOverlay, setCalendarDragOverlay] = useState<{
    x: number;
    y: number;
    overDropTarget: boolean;
  } | null>(null);

  const focusEditInput = () => {
    const input = editInputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  };

  useEffect(() => {
    if (selected && item.content === "" && !trashMode) {
      setDraft("");
      setEditing(true);
    }
  }, [item.content, selected, trashMode]);

  useLayoutEffect(() => {
    if (!editing || trashMode) return;
    focusEditInput();
    const frame = requestAnimationFrame(focusEditInput);
    const soon = window.setTimeout(focusEditInput, 0);
    const late = window.setTimeout(focusEditInput, 60);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(soon);
      window.clearTimeout(late);
    };
  }, [editing, trashMode]);

  const selectItemAfterEditPaint = () => {
    if (selected) return;
    const id = item.id;
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (useTodoStore.getState().selectedItemId !== id) {
          setSelectedItemId(id);
        }
      }, 0);
    });
  };

  const calendarDragEnabled = !trashMode && item.deletedAt == null;
  const showDragHandle =
    !trashMode && (draggable || calendarDragEnabled || dragHandleProps != null);
  const onCalendarPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (
        !calendarDragEnabled ||
        target.closest("input, textarea, select, .MuiChip-root")
      ) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const sourceElement = event.currentTarget;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      try {
        sourceElement.setPointerCapture(pointerId);
      } catch {
        // Window listeners below still handle mouse pointers in WebView.
      }

      calendarDragStateRef.current = {
        active: false,
        endedAt: calendarDragStateRef.current.endedAt,
        pointerId,
        startX,
        startY,
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        try {
          if (sourceElement.hasPointerCapture(pointerId)) {
            sourceElement.releasePointerCapture(pointerId);
          }
        } catch {
          // The element can be unmounted before a cancelled pointer is released.
        }
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
      };

      const activateDrag = (clientX: number, clientY: number) => {
        calendarDragStateRef.current.active = true;
        beginTodoCalendarDrag(item.id, clientX, clientY);
        setSelectedItemId(item.id);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      };

      const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const state = calendarDragStateRef.current;
        const movedPx = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (!state.active && movedPx < 6) return;

        if (!state.active) {
          activateDrag(moveEvent.clientX, moveEvent.clientY);
        }

        const overDropTarget = updateTodoCalendarDrag(moveEvent.clientX, moveEvent.clientY);
        setCalendarDragOverlay({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          overDropTarget,
        });
        moveEvent.preventDefault();
      };

      const onPointerUp = (upEvent: globalThis.PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        const wasActive = calendarDragStateRef.current.active;
        cleanup();
        if (wasActive) {
          finishTodoCalendarDrag(upEvent.clientX, upEvent.clientY);
          calendarDragStateRef.current.active = false;
          calendarDragStateRef.current.endedAt = Date.now();
          setCalendarDragOverlay(null);
          upEvent.preventDefault();
          upEvent.stopPropagation();
        }
      };

      const onPointerCancel = (cancelEvent: globalThis.PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return;
        cleanup();
        clearTodoCalendarDrag();
        calendarDragStateRef.current.active = false;
        calendarDragStateRef.current.endedAt = Date.now();
        setCalendarDragOverlay(null);
      };

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    },
    [calendarDragEnabled, item.id, setSelectedItemId],
  );
  const shouldIgnoreCalendarDragClick = () => {
    const state = calendarDragStateRef.current;
    return state.active || Date.now() - state.endedAt < 250;
  };

  const beginEdit = () => {
    if (trashMode) return;
    setDraft(item.content);
    setEditing(true);
    selectItemAfterEditPaint();
  };

  const onContextMenu = (e: MouseEvent) => {
    if (trashMode) return;
    e.preventDefault();
    setSelectedItemId(item.id);
    if (!multiSelected) {
      setMultiSelectedItemIds([item.id]);
    }
    setMenuAnchor({ x: e.clientX, y: e.clientY });
  };

  const isMultiSelectClick = (event: MouseEvent<HTMLElement>) =>
    !trashMode && (event.ctrlKey || event.metaKey);

  const toggleMultiSelectionFromClick = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMultiSelectedItemId(item.id);
  };

  const commitEdit = (options?: { createSibling?: boolean }) => {
    const v = draft.trim();
    if (v && v !== item.content) {
      updateItem(item.id, { content: v });
    } else if (!v && item.content === "") {
      purgeItem(item.id);
      setEditing(false);
      return;
    } else {
      setDraft(item.content);
    }
    setEditing(false);
    if (options?.createSibling && v) {
      createInlineSibling();
    }
  };

  const completed = item.status === "completed";
  const abandoned = item.status === "abandoned";
  const priority = priorityMeta(item.priority);
  const roundCheckbox = checkboxShape === "circle";
  const dueOverdue =
    item.dueAt != null && !completed && !abandoned && isDuePast(item.dueAt, item.dueEndAt);
  const dueTextColor = dueOverdue
    ? "error.main"
    : "primary.main";
  const progress = Math.min(100, Math.max(0, Math.round(item.progress ?? 0)));
  const showProgressBar = !trashMode && !completed && !compactMeta;
  const nextButtonStatus = completed || abandoned ? "pending" : "completed";
  const completionLocked = nextButtonStatus === "completed" && completionBlocker != null;
  const statusButtonLabel = completionLocked
    ? `前序任务未完成：${completionBlocker?.content.trim() || "未命名待办"}`
    : completed || abandoned
      ? "设为未完成"
      : "设为已完成";
  const dueTooltipTitle =
    item.dueAt == null
      ? ""
      : `${formatDueTooltip(item.dueAt, item.dueEndAt, item.reminderEnabled)}`;
  const clampedDepth = Math.min(depth, 6);
  const notePreview = useMemo(
    () => (showNotePreview ? notePreviewText(item.note) : ""),
    [item.note, showNotePreview],
  );

  const createInlineChild = () => {
    const child = addItem(item.listId, "", { parentId: item.id, allowEmpty: true });
    if (child) {
      const todayPatch = todayInlineDuePatch();
      if (todayPatch) {
        updateItem(child.id, todayPatch);
      }
      onExpand?.(item.id);
      setSelectedItemId(child.id);
    }
  };

  const createInlineSibling = () => {
    const sibling = addItem(item.listId, "", {
      parentId: item.parentId,
      groupId: item.groupId,
      allowEmpty: true,
    });
    if (!sibling) return;

    const currentItems = useTodoStore.getState().items;
    const siblings = currentItems
      .filter(
        (entry) =>
          entry.id !== sibling.id &&
          entry.listId === item.listId &&
          entry.deletedAt == null &&
          (entry.parentId ?? null) === (item.parentId ?? null) &&
          (entry.groupId ?? null) === (item.groupId ?? null),
      )
      .sort((a, b) => a.order - b.order);
    const current = siblings.find((entry) => entry.id === item.id) ?? item;
    const next = siblings.find((entry) => entry.order > current.order) ?? null;
    updateItem(sibling.id, {
      order: midpointOrder(current, next),
      ...(todayInlineDuePatch() ?? {}),
    });
    setSelectedItemId(sibling.id);
  };

  const contextPathTitle =
    contextPath && contextPath.length > 0
      ? contextTooltip ?? contextPath.map((part) => part.label).join(" / ")
      : "";
  const renderContextPathLine = () => (
    <Box
      title={contextTooltipMode === "native" ? contextPathTitle : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      sx={{
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 0.35,
        overflow: "hidden",
        whiteSpace: "nowrap",
        color: "text.disabled",
        fontSize: 11,
        lineHeight: 1.25,
      }}
    >
      {contextPath?.map((part, index) => {
        const clickable = part.target != null && onOpenContextPath != null;
        return (
          <Fragment key={part.key}>
            {index > 0 && (
              <Box
                component="span"
                sx={{ color: "text.disabled", flexShrink: 0, opacity: 0.65 }}
              >
                /
              </Box>
            )}
            <Box
              component={clickable ? "button" : "span"}
              type={clickable ? "button" : undefined}
              onPointerDown={(event: PointerEvent<HTMLElement>) =>
                event.stopPropagation()
              }
              onClick={
                clickable
                  ? (event: MouseEvent<HTMLElement>) => {
                      event.stopPropagation();
                      onOpenContextPath(part.target!);
                    }
                  : undefined
              }
              sx={{
                minWidth: 0,
                maxWidth: "100%",
                p: 0,
                border: 0,
                bgcolor: "transparent",
                color: "inherit",
                font: "inherit",
                cursor: clickable ? "pointer" : "default",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                "&:hover": clickable
                  ? {
                      color: "primary.main",
                      textDecoration: "underline",
                      textUnderlineOffset: "2px",
                    }
                  : undefined,
              }}
            >
              {part.label}
            </Box>
          </Fragment>
        );
      })}
    </Box>
  );

  const todayInlineDuePatch = (): Partial<Omit<TodoItemT, "id" | "createdAt">> | null => {
    if (selectedFilter.kind !== "today") return null;
    const start = startOfTodayMs();
    const end = start + DAY_MS;
    const sourceDue =
      item.dueAt != null && item.dueAt >= start && item.dueAt < end
        ? item.dueAt
        : start;
    return { dueAt: sourceDue, dueEndAt: null, reminderEnabled: false };
  };

  return (
    <Box
      ref={setNodeRef}
      style={style}
      data-index={virtualIndex}
      onContextMenu={onContextMenu}
      onClick={(e) => {
        // Don't fight inline-edit / chip clicks — only the row body
        // selects. The buttons inside stop propagation themselves.
        if (editing) return;
        const target = e.target as HTMLElement;
        if (target.closest("button, [role='button'], input, .MuiChip-root")) return;
        if (isMultiSelectClick(e)) {
          toggleMultiSelectionFromClick(e);
          return;
        }
        clearMultiSelectedItemIds();
        setSelectedItemId(item.id);
      }}
      sx={{
        ml: flushOuterSpacing ? 0 : 1 + clampedDepth * 2.2,
        mr: flushOuterSpacing ? 0 : 1,
        my: disableOuterMargin ? 0 : 0.4,
        pl: trashMode ? 0.75 : 1.25,
        pr: 0.75,
        py: 0.8,
        borderRadius: flushOuterSpacing ? 0 : 1,
        position: "relative",
        overflow: "hidden",
        contentVisibility: deferOffscreenRendering ? "auto" : undefined,
        containIntrinsicSize: deferOffscreenRendering
          ? `auto ${showNotePreview ? 64 : 46}px`
          : undefined,
        display: "flex",
        alignItems: "center",
        gap: 0.15,
        cursor: trashMode ? "default" : "pointer",
        bgcolor: selected || multiSelected ? rowSelectedBg : "transparent",
        transition: "background-color 120ms ease",
        "&::after": {
          content: '""',
          position: "absolute",
          left: "10px",
          right: "10px",
          bottom: 0,
          height: "1px",
          bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.1 : 0.08),
          pointerEvents: "none",
        },
        ":hover": {
          bgcolor: selected || multiSelected ? rowSelectedHoverBg : rowHoverBg,
        },
        ":active": {
          bgcolor: rowActiveBg,
        },
        "&:hover .todo-item-drag-handle, &:focus-within .todo-item-drag-handle": {
          opacity: 1,
          transform: "scale(1)",
          pointerEvents: "auto",
        },
      }}
    >
      {!trashMode && item.priority != null && clampedDepth === 0 && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            left: 0,
            top: 6,
            bottom: 6,
            width: 4,
            borderRadius: "0 4px 4px 0",
            bgcolor: priority.color,
            opacity: 0.95,
            pointerEvents: "none",
          }}
        />
      )}
      {showDragHandle && (
        <Box
          className="todo-item-drag-handle"
          data-todo-sort-handle="true"
          title="拖拽调整层级/排序，或拖到日历/清单"
          onPointerDownCapture={onCalendarPointerDown}
          {...(sortable?.attributes ?? {})}
          {...(sortable?.listeners ?? {})}
          {...(dragHandleProps ?? {})}
          sx={{
            display: "flex",
            width: 14,
            height: 22,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "text.disabled",
            cursor: "grab",
            touchAction: "none",
            opacity: 0,
            transform: "scale(0.86)",
            pointerEvents: "none",
            transition: "opacity 120ms ease, transform 120ms ease",
            ":active": { cursor: "grabbing" },
          }}
        >
          <DragIndicatorRoundedIcon sx={{ fontSize: 15 }} />
        </Box>
      )}
      {!compactMeta && (
        <Tooltip
          title={
            hasChildren ? (collapsed ? "展开子待办" : "折叠子待办") : "无子待办"
          }
        >
          <IconButton
            size="small"
            aria-label={
              hasChildren ? (collapsed ? "展开子待办" : "折叠子待办") : "无子待办"
            }
            aria-expanded={hasChildren ? !collapsed : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) onToggleCollapsed?.(item.id);
            }}
            sx={{
              width: 18,
              height: 20,
              p: 0,
              color: "text.secondary",
              opacity: hasChildren ? 1 : 0.45,
              flexShrink: 0,
            }}
          >
            {hasChildren && !collapsed ? (
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 17 }} />
            ) : (
              <KeyboardArrowRightRoundedIcon sx={{ fontSize: 17 }} />
            )}
          </IconButton>
        </Tooltip>
      )}
      {!trashMode && (
        <Tooltip title={statusButtonLabel}>
          <span style={{ display: "inline-flex" }}>
            <IconButton
              size="small"
              aria-label={statusButtonLabel}
              disabled={completionLocked}
              onClick={(e) => {
                e.stopPropagation();
                if (!completionLocked) setStatus(item.id, nextButtonStatus);
              }}
              sx={{ width: 20, height: 20, p: 0 }}
            >
              {completionLocked ? (
                <LockRoundedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
              ) : completed ? (
                roundCheckbox ? (
                  <CheckCircleRoundedIcon sx={{ fontSize: 17, color: "primary.main" }} />
                ) : (
                  <CheckBoxRoundedIcon sx={{ fontSize: 17, color: "primary.main" }} />
                )
              ) : abandoned ? (
                roundCheckbox ? (
                  <HighlightOffRoundedIcon sx={{ fontSize: 17, color: "text.disabled" }} />
                ) : (
                  <DisabledByDefaultRoundedIcon
                    sx={{ fontSize: 17, color: "text.disabled" }}
                  />
                )
              ) : roundCheckbox ? (
                <RadioButtonUncheckedRoundedIcon
                  sx={{ fontSize: 17, color: item.marked ? "warning.main" : "text.secondary" }}
                />
              ) : (
                <CheckBoxOutlineBlankRoundedIcon
                  sx={{ fontSize: 17, color: item.marked ? "warning.main" : "text.secondary" }}
                />
              )}
            </IconButton>
          </span>
        </Tooltip>
      )}
      {editing && !trashMode ? (
        <InputBase
          inputRef={editInputRef}
          autoFocus
          fullWidth
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitEdit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit({ createSibling: true });
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (item.content === "") {
                purgeItem(item.id);
                return;
              }
              setDraft(item.content);
              setEditing(false);
            }
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            lineHeight: 1.45,
            color: completed || abandoned ? "text.disabled" : "text.primary",
            "& input": {
              p: 0,
              height: "auto",
            },
          }}
        />
      ) : (
        <Box
          onClick={(e) => {
            if (isMultiSelectClick(e)) {
              toggleMultiSelectionFromClick(e);
              return;
            }
            e.stopPropagation();
            if (shouldIgnoreCalendarDragClick()) return;
            clearMultiSelectedItemIds();
            beginEdit();
          }}
          sx={{
            flex: "1 1 0",
            minWidth: 0,
            width: 0,
            maxWidth: "100%",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 0.2,
            cursor: trashMode ? "default" : "pointer",
          }}
        >
          <Typography
            title={item.content}
            sx={{
              display: "block",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              fontSize: 14,
              lineHeight: 1.45,
              cursor: "inherit",
              color: completed || abandoned || trashMode ? "text.disabled" : "text.primary",
              textDecoration:
                completed || abandoned || trashMode ? "line-through" : "none",
              overflow: "hidden",
              textOverflow: "clip",
              whiteSpace: "nowrap",
            }}
          >
            {item.content}
          </Typography>
          {!trashMode && contextPath && contextPath.length > 0 ? (
            contextTooltipMode === "mui" ? (
              <Tooltip title={contextPathTitle}>{renderContextPathLine()}</Tooltip>
            ) : (
              renderContextPathLine()
            )
          ) : !trashMode && contextMeta ? (
            <Tooltip title={contextTooltip ?? contextMeta}>
              <Typography
                sx={{
                  minWidth: 0,
                  fontSize: 11,
                  lineHeight: 1.25,
                  color: "text.disabled",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {contextMeta}
              </Typography>
            </Tooltip>
          ) : null}
          {!trashMode && !compactMeta && notePreview && (
            <Typography
              sx={{
                fontSize: 12,
                lineHeight: 1.35,
                color: "text.secondary",
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "normal",
                wordBreak: "break-word",
              }}
            >
              {notePreview}
            </Typography>
          )}
        </Box>
      )}
      {!trashMode && !compactMeta && item.tags.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.4, flexWrap: "nowrap", maxWidth: 160, overflow: "hidden" }}>
          {item.tags.slice(0, 3).map((t) => (
            <Tooltip key={t} title={`#${t}`}>
              <Chip
                size="small"
                label={`#${t}`}
                onClick={(e) => {
                  e.stopPropagation();
                  useTodoStore.getState().setDetailFilter({ kind: "tag", tag: t });
                }}
                sx={{
                  height: 20,
                  fontSize: 10,
                  bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
                  "& .MuiChip-label": { px: 0.6 },
                }}
              />
            </Tooltip>
          ))}
          {item.tags.length > 3 && (
            <Tooltip title={item.tags.slice(3).map((tag) => `#${tag}`).join("、")}>
              <Typography sx={{ fontSize: 11, color: "text.disabled", alignSelf: "center" }}>
                +{item.tags.length - 3}
              </Typography>
            </Tooltip>
          )}
        </Box>
      )}
      {!trashMode && item.dueAt != null && (
        <Tooltip title={dueTooltipTitle}>
          <Box
            onClick={(e) => {
              e.stopPropagation();
              if (shouldIgnoreCalendarDragClick()) return;
              setDueAnchor(e.currentTarget as HTMLElement);
            }}
            sx={{
              height: compactMeta ? 20 : 22,
              ml: compactMeta ? 0.5 : 0.75,
              color: dueTextColor,
              whiteSpace: "nowrap",
              maxWidth: compactMeta ? 56 : 88,
              cursor: "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Typography
              component="span"
              sx={{
                display: "inline-block",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "clip",
                whiteSpace: "nowrap",
                fontSize: 12,
                fontWeight: 700,
                color: dueTextColor,
                lineHeight: 1,
              }}
            >
              {formatDueLabel(item.dueAt, item.dueEndAt)}
            </Typography>
          </Box>
        </Tooltip>
      )}
      {showProgressBar && progress > 0 && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: `${progress}%`,
            height: 2,
            bgcolor: "primary.main",
            borderRadius: "0 999px 999px 0",
            pointerEvents: "none",
            transition: "width 120ms ease",
          }}
        />
      )}
      {trashMode && (
        <>
          <Tooltip title="恢复">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                restoreItem(item.id);
              }}
              sx={{ width: 24, height: 24 }}
            >
              <RestoreFromTrashRoundedIcon
                sx={{ fontSize: 16, color: "primary.main" }}
              />
            </IconButton>
          </Tooltip>
          <Tooltip title="永久删除">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`永久删除「${item.content}」？此操作不可撤销。`)) {
                  purgeItem(item.id);
                }
              }}
              sx={{ width: 24, height: 24 }}
            >
              <DeleteForeverRoundedIcon
                sx={{ fontSize: 16, color: "error.main" }}
              />
            </IconButton>
          </Tooltip>
        </>
      )}
      {menuAnchor && (
        <ItemContextMenu
          item={item}
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          onPickDueDate={(pos) => {
            setMenuAnchor(null);
            setDuePos(pos);
          }}
          onPickTags={(pos) => {
            setMenuAnchor(null);
            setTagPos(pos);
          }}
          onCreateChild={createInlineChild}
        />
      )}
      {(dueAnchor || duePos) && (
        <DueDatePopover
          anchorEl={dueAnchor}
          anchorPosition={duePos ?? undefined}
          value={item.dueAt}
          endValue={item.dueEndAt}
          reminderEnabled={item.reminderEnabled}
          onClose={() => {
            setDueAnchor(null);
            setDuePos(null);
          }}
          onChange={(start, end, reminderEnabled) =>
            setDueRange(item.id, start, end ?? null, reminderEnabled)
          }
        />
      )}
      {tagPos && (
        <TagPickerPopover
          itemId={item.id}
          anchorPosition={tagPos}
          onClose={() => setTagPos(null)}
        />
      )}
      {calendarDragOverlay &&
        typeof document !== "undefined" &&
        createPortal(
          <Box
            sx={{
              position: "fixed",
              left: calendarDragOverlay.x + 14,
              top: calendarDragOverlay.y + 14,
              zIndex: 9999,
              maxWidth: 260,
              px: 1,
              py: 0.65,
              borderRadius: 1,
              border: 1,
              borderColor: calendarDragOverlay.overDropTarget
                ? "primary.main"
                : alpha(isDark ? "#f8fafc" : "#0f172a", 0.18),
              bgcolor: isDark ? alpha("#020617", 0.92) : alpha("#ffffff", 0.96),
              color: "text.primary",
              boxShadow: 6,
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1.3,
              pointerEvents: "none",
              userSelect: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "clip",
            }}
          >
            {item.content.trim() || "未命名待办"}
          </Box>,
          document.body,
        )}
    </Box>
  );
}

function SortableTodoItem(props: Props) {
  const sortable = useSortable({
    id: props.item.id,
    disabled: { droppable: props.sortableDroppable === false },
  });
  return <TodoItemBase {...props} sortable={sortable} />;
}

function TodoItemRoot(props: Props) {
  return props.draggable ? (
    <SortableTodoItem {...props} />
  ) : (
    <TodoItemBase {...props} />
  );
}

export const TodoItem = memo(TodoItemRoot);

function notePreviewText(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) return "";
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = trimmed;
    return normalizePreviewText(container.textContent ?? "");
  }
  return normalizePreviewText(trimmed.replace(/<[^>]*>/g, " "));
}

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfLocalWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function isInCurrentWeek(date: Date, now: Date): boolean {
  const start = startOfLocalWeek(now);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function formatShortDate(date: Date, now: Date): string {
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? monthDay
    : `${date.getFullYear()}/${monthDay}`;
}

function formatDueDateLabel(date: Date, now: Date): string {
  if (sameLocalDay(date, now)) return "今天";
  return isInCurrentWeek(date, now) && date.getTime() >= now.getTime()
    ? WEEKDAY_LABELS[date.getDay()]
    : formatShortDate(date, now);
}

function isDuePast(startTs: number, endTs: number | null): boolean {
  const effectiveTs = endTs != null && endTs > startTs ? endTs : startTs;
  return effectiveTs < Date.now();
}

function formatDueLabel(startTs: number, endTs: number | null): string {
  const now = new Date();
  const start = new Date(startTs);
  const end = endTs != null && endTs > startTs ? new Date(endTs) : null;
  const startIsToday = sameLocalDay(start, now);
  if (!end) return startIsToday ? formatTime(start) : formatDueDateLabel(start, now);
  if (sameLocalDay(start, end)) {
    return startIsToday
      ? `${formatTime(start)}-${formatTime(end)}`
      : formatDueDateLabel(start, now);
  }

  const startLabel = startIsToday ? formatTime(start) : formatDueDateLabel(start, now);
  const endLabel = sameLocalDay(end, now) ? formatTime(end) : formatDueDateLabel(end, now);
  return `${startLabel}-${endLabel}`;
}

function formatFullDate(date: Date): string {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${WEEKDAY_LABELS[date.getDay()]}`;
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDueTooltip(
  startTs: number,
  endTs: number | null,
  reminderEnabled: boolean,
): string {
  const start = new Date(startTs);
  const end = endTs != null && endTs > startTs ? new Date(endTs) : null;
  const detail = end
    ? sameLocalDay(start, end)
      ? `${formatFullDate(start)} ${formatTime(start)}-${formatTime(end)}`
      : `${formatFullDate(start)} ${formatTime(start)} - ${formatFullDate(end)} ${formatTime(end)}`
    : `${formatFullDate(start)} ${formatTime(start)}`;
  return reminderEnabled ? `${detail}（提醒已开启）` : detail;
}
