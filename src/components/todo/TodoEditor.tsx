// Detail editor — third column. Renders the currently selected task's
// content + a TipTap rich-text note. TipTap's StarterKit ships
// markdown-style input rules out of the box, so typing "- ", "1. ",
// "# ", "**bold**", etc. converts in place. Toolbar still exposes the
// formatting commands for users who don't know the shortcuts.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, Divider, IconButton, Menu, MenuItem, Popover, TextField, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import FormatBoldRoundedIcon from "@mui/icons-material/FormatBoldRounded";
import FormatItalicRoundedIcon from "@mui/icons-material/FormatItalicRounded";
import StrikethroughSRoundedIcon from "@mui/icons-material/StrikethroughSRounded";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import FormatListNumberedRoundedIcon from "@mui/icons-material/FormatListNumberedRounded";
import TitleRoundedIcon from "@mui/icons-material/TitleRounded";
import FormatClearRoundedIcon from "@mui/icons-material/FormatClearRounded";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import LabelRoundedIcon from "@mui/icons-material/LabelRounded";
import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import AlarmRoundedIcon from "@mui/icons-material/AlarmRounded";
import TimerRoundedIcon from "@mui/icons-material/TimerRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import OutlinedFlagRoundedIcon from "@mui/icons-material/OutlinedFlagRounded";
import FormatQuoteRoundedIcon from "@mui/icons-material/FormatQuoteRounded";
import CodeRoundedIcon from "@mui/icons-material/CodeRounded";
import DataObjectRoundedIcon from "@mui/icons-material/DataObjectRounded";
import FormatSizeRoundedIcon from "@mui/icons-material/FormatSizeRounded";
import HorizontalRuleRoundedIcon from "@mui/icons-material/HorizontalRuleRounded";
import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";
import FormatColorFillRoundedIcon from "@mui/icons-material/FormatColorFillRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import LinkOffRoundedIcon from "@mui/icons-material/LinkOffRounded";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import SubjectRoundedIcon from "@mui/icons-material/SubjectRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import { Extension, getMarkRange } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { FileUpload, type FileKind, type UploadHandler } from "@tiptap-codeless/extension-file-upload";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Mathematics, { migrateMathStrings } from "@tiptap/extension-mathematics";
import { TaskItem } from "@tiptap/extension-list/task-item";
import { TaskList } from "@tiptap/extension-list/task-list";
import Mention, { type MentionNodeAttrs } from "@tiptap/extension-mention";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TextSelection } from "@tiptap/pm/state";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import StarterKit from "@tiptap/starter-kit";
import "katex/dist/katex.min.css";

import { useStore } from "../../state/store";
import { todoCompletionBlocker, useTodoStore } from "./useTodoStore";
import { saveTodoAsset } from "./todoIpc";
import { TagPickerPopover } from "./TagPickerPopover";
import { DueDatePopover } from "./DueDatePopover";
import { TodoCalendar } from "./TodoCalendar";
import { TodoEmoji } from "./TodoEmoji";
import { TODO_PRIORITY_OPTIONS, priorityMeta } from "./priority";
import type { TodoFolder, TodoItem, TodoList } from "./types";
import {
  createTodoAssetDirectoryHandle,
  ensureTodoAssetDirectoryPickerFallback,
} from "./todoAssetDirectory";
import {
  POMODORO_SESSION_CHANGED_EVENT,
  readPomodoroSessions,
  type PomodoroSession,
} from "./todoPomodoroTimer";

interface Props {
  isDark: boolean;
}

const NOTE_PLACEHOLDER = "更详细的任务内容规划...";
const TODO_ATTACHMENT_MAX_FILE_SIZE = 200 * 1024 * 1024;
const TODO_ATTACHMENT_ACCEPT = [
  "image/*",
  "video/*",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/zip",
  "application/x-zip-compressed",
  "*/*",
].join(",");
const HIGHLIGHT_COLOR_STORAGE_KEY = "aebox.todo.editor.highlightColor";
const TODO_MENTION_LIMIT = 8;
const TODO_IMAGE_PREVIEW_Z_INDEX = 3200;
const TODO_OVERDUE_COLOR = "#e13e39";
const HIGHLIGHT_COLORS = [
  { label: "黄色", color: "#fde68a" },
  { label: "绿色", color: "#bbf7d0" },
  { label: "蓝色", color: "#bfdbfe" },
  { label: "粉色", color: "#fecdd3" },
  { label: "紫色", color: "#ddd6fe" },
] as const;

interface TodoMentionItem {
  id: string;
  label: string;
  subtitle: string;
  status: TodoItem["status"];
  updatedAt: number;
}

interface ListMoveSection {
  id: string;
  label: string;
  emoji: string;
  lists: TodoList[];
}

type TodoMentionSuggestionProps = SuggestionProps<
  TodoMentionItem,
  MentionNodeAttrs
>;

function compactTodoTitle(content: string) {
  const compacted = content.trim().replace(/\s+/g, " ");
  if (!compacted) return "未命名待办";
  return compacted.length > 80 ? `${compacted.slice(0, 80)}...` : compacted;
}

function statusLabel(status: TodoItem["status"]) {
  switch (status) {
    case "completed":
      return "已完成";
    case "abandoned":
      return "已放弃";
    case "pending":
      return "待办";
  }
}

function buildTodoMentionItems(
  items: TodoItem[],
  lists: TodoList[],
  currentItemId: string | null,
  query: string,
): TodoMentionItem[] {
  const listById = new Map(lists.map((list) => [list.id, list]));
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return items
    .filter((todo) => todo.deletedAt == null && todo.id !== currentItemId)
    .map((todo) => {
      const list = listById.get(todo.listId);
      const label = compactTodoTitle(todo.content);
      const subtitle = list ? `${list.emoji} ${list.name}` : "";
      const labelText = label.toLocaleLowerCase();
      const subtitleText = subtitle.toLocaleLowerCase();
      const rank =
        normalizedQuery.length === 0
          ? 0
          : labelText.startsWith(normalizedQuery)
            ? 0
            : labelText.includes(normalizedQuery)
              ? 1
              : subtitleText.includes(normalizedQuery)
                ? 2
                : 3;

      return {
        id: todo.id,
        label,
        subtitle,
        status: todo.status,
        updatedAt: todo.updatedAt,
        rank,
      };
    })
    .filter((todo) => todo.rank < 3)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
      return a.label.localeCompare(b.label);
    })
    .slice(0, TODO_MENTION_LIMIT)
    .map(({ id, label, subtitle, status, updatedAt }) => ({
      id,
      label,
      subtitle,
      status,
      updatedAt,
    }));
}

function normalizeLinkUrl(value: string) {
  const url = value.trim();
  if (!url) return "";
  if (/^(https?:\/\/|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(url)) {
    return url;
  }
  return `https://${url}`;
}

function getInitialHighlightColor() {
  try {
    return window.localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEY) ?? "#fde68a";
  } catch {
    return "#fde68a";
  }
}

function persistHighlightColor(color: string) {
  try {
    window.localStorage.setItem(HIGHLIGHT_COLOR_STORAGE_KEY, color);
  } catch {
    // Local storage can be unavailable in restricted WebViews.
  }
}

function currentLinkRange(editor: Editor) {
  const type = editor.state.schema.marks.link;
  if (!type) return null;
  const { selection } = editor.state;
  if (!selection.empty) return { from: selection.from, to: selection.to };
  return getMarkRange(editor.state.doc.resolve(selection.from), type) ?? null;
}

function textInRange(editor: Editor, range: { from: number; to: number } | null) {
  if (!range) return "";
  return editor.state.doc.textBetween(range.from, range.to, "\n").trim();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read file failed"));
    reader.readAsDataURL(file);
  });
}

function todoAttachmentKind(file: File): FileKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

function createTodoAssetFileName(file: File) {
  const extension = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf("."))
    : "";
  return `todo-asset-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}${extension}`;
}

const uploadTodoAttachments: UploadHandler = async (files, ctx) => {
  const assets = [];

  for (const file of files) {
    const fileName = createTodoAssetFileName(file);
    ctx.onProgress?.({ file, fileName, percent: 5 });
    const dataUrl = await fileToDataUrl(file);
    ctx.onProgress?.({ file, fileName, percent: 70 });
    await saveTodoAsset(fileName, dataUrl);
    ctx.onProgress?.({ file, fileName, percent: 100 });
    assets.push({
      kind: todoAttachmentKind(file),
      url: URL.createObjectURL(file),
      name: file.name || fileName,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      fileName,
      storageMode: "local" as const,
      storageKey: fileName,
      revokeObjectURL: true,
    });
  }

  return { assets };
};

function clampEditorPosition(editor: Editor, position: number) {
  return Math.min(Math.max(position, 0), editor.state.doc.content.size);
}

function openTodoAttachmentFilePicker(
  editor: Editor,
  accept: string,
  position: number,
) {
  if (editor.isDestroyed || !editor.isEditable) return false;

  const input = document.createElement("input");
  let cleaned = false;
  let changeHandled = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.clearTimeout(timeoutId);
    input.onchange = null;
    input.oncancel = null;
    window.removeEventListener("focus", onFocus, true);
    input.remove();
  };
  const timeoutId = window.setTimeout(cleanup, 5 * 60 * 1000);
  const onFocus = () => {
    window.setTimeout(() => {
      if (!cleaned && !changeHandled && (input.files?.length ?? 0) === 0) cleanup();
    }, 1000);
  };

  input.type = "file";
  input.multiple = true;
  if (accept) input.accept = accept;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  input.oncancel = cleanup;
  input.onchange = async () => {
    changeHandled = true;
    try {
      const files = Array.from(input.files || []);
      if (files.length > 0) {
        const inserted = await editor.commands.insertFiles({
          files,
          position: clampEditorPosition(editor, position),
        });
        if (!inserted) {
          console.error("[todo] file upload command was not accepted");
        }
      }
    } catch (error) {
      console.error("[todo] file upload failed:", error);
    } finally {
      cleanup();
    }
  };

  document.body.appendChild(input);
  window.addEventListener("focus", onFocus, true);
  input.click();
  return true;
}

function createTodoMentionSuggestionRenderer(isDark: boolean) {
  let popup: HTMLDivElement | null = null;
  let activeProps: TodoMentionSuggestionProps | null = null;
  let selectedIndex = 0;
  let lastQuery = "";

  const colors = {
    bg: isDark ? "#111827" : "#ffffff",
    border: isDark ? "rgba(248, 250, 252, 0.14)" : "rgba(15, 23, 42, 0.12)",
    text: isDark ? "#f8fafc" : "#0f172a",
    muted: isDark ? "rgba(248, 250, 252, 0.58)" : "rgba(15, 23, 42, 0.58)",
    activeBg: isDark ? "rgba(96, 165, 250, 0.22)" : "rgba(37, 99, 235, 0.1)",
  };

  const removePopup = () => {
    popup?.remove();
    popup = null;
    activeProps = null;
  };

  const ensurePopup = () => {
    if (popup) return;
    popup = document.createElement("div");
    popup.className = "todo-mention-suggestion-menu";
    Object.assign(popup.style, {
      position: "fixed",
      zIndex: "2800",
      minWidth: "260px",
      maxWidth: "360px",
      maxHeight: "280px",
      overflowY: "auto",
      padding: "6px",
      borderRadius: "8px",
      border: `1px solid ${colors.border}`,
      background: colors.bg,
      color: colors.text,
      boxShadow: "0 18px 42px rgba(15, 23, 42, 0.22)",
    });
    document.body.appendChild(popup);
  };

  const updatePosition = () => {
    if (!popup || !activeProps?.clientRect) return;
    const rect = activeProps.clientRect();
    if (!rect) {
      popup.style.display = "none";
      return;
    }

    popup.style.display = "block";
    const popupWidth = popup.offsetWidth || 260;
    const popupHeight = Math.min(popup.offsetHeight || 120, 280);
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - popupWidth - 8),
    );
    const top =
      rect.bottom + 8 + popupHeight > window.innerHeight
        ? Math.max(8, rect.top - popupHeight - 8)
        : rect.bottom + 8;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  };

  const selectItem = (item: TodoMentionItem | undefined) => {
    if (!activeProps || !item) return;
    activeProps.command({
      id: item.id,
      label: item.label,
      mentionSuggestionChar: "@",
    });
  };

  const renderItems = () => {
    if (!popup || !activeProps) return;
    popup.replaceChildren();

    if (activeProps.items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "没有匹配的待办";
      Object.assign(empty.style, {
        padding: "8px 10px",
        fontSize: "12px",
        color: colors.muted,
      });
      popup.appendChild(empty);
      updatePosition();
      return;
    }

    activeProps.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      let picked = false;
      const pickItem = (event: MouseEvent | PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (picked) return;
        picked = true;
        selectItem(item);
      };
      button.onpointerdown = pickItem;
      button.onmousedown = pickItem;
      button.onmouseenter = () => {
        selectedIndex = index;
        renderItems();
      };
      Object.assign(button.style, {
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "2px",
        border: "0",
        borderRadius: "6px",
        padding: "7px 8px",
        background: index === selectedIndex ? colors.activeBg : "transparent",
        color: colors.text,
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
      });

      const title = document.createElement("span");
      title.textContent = item.label;
      Object.assign(title.style, {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "13px",
        fontWeight: "700",
      });

      const meta = document.createElement("span");
      meta.textContent = item.subtitle
        ? `${item.subtitle} · ${statusLabel(item.status)}`
        : statusLabel(item.status);
      Object.assign(meta.style, {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "11px",
        color: colors.muted,
      });

      button.append(title, meta);
      popup?.appendChild(button);
    });

    updatePosition();
  };

  const update = (props: TodoMentionSuggestionProps) => {
    ensurePopup();
    activeProps = props;
    if (props.query !== lastQuery) {
      selectedIndex = 0;
      lastQuery = props.query;
    }
    selectedIndex =
      props.items.length === 0 ? 0 : Math.min(selectedIndex, props.items.length - 1);
    renderItems();
  };

  return {
    onStart: update,
    onUpdate: update,
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (!activeProps || activeProps.items.length === 0) return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectedIndex = (selectedIndex + 1) % activeProps.items.length;
        renderItems();
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        selectedIndex =
          (selectedIndex + activeProps.items.length - 1) % activeProps.items.length;
        renderItems();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectItem(activeProps.items[selectedIndex]);
        return true;
      }

      return false;
    },
    onExit: removePopup,
  };
}

function isEmptyNoteHtml(html: string) {
  const trimmed = html.trim();
  return trimmed === "" || trimmed === "<p></p>";
}

function isPlainEmptyEditor(editor: Editor) {
  return isEmptyNoteHtml(editor.getHTML());
}

function clampTableSize(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(Math.max(parsed, 1), 20);
}

function focusNearestTaskItemContent(editor: Editor) {
  const selectionPos = editor.state.selection.from;
  let targetPos: number | null = null;
  let targetDistance = Number.POSITIVE_INFINITY;

  editor.state.doc.descendants((node, pos, parent) => {
    if (node.type.name !== "paragraph" || parent?.type.name !== "taskItem") {
      return true;
    }

    const contentPos = pos + 1;
    const distance = Math.abs(contentPos - selectionPos);
    if (distance < targetDistance) {
      targetDistance = distance;
      targetPos = contentPos;
    }
    return false;
  });

  if (targetPos != null) {
    editor.chain().focus().setTextSelection(targetPos).run();
  }
}

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isDuePast(startTs: number, endTs: number | null): boolean {
  const effectiveTs = endTs != null && endTs > startTs ? endTs : startTs;
  return effectiveTs < Date.now();
}

function formatEditorDueRange(startTs: number, endTs: number | null): string {
  const start = new Date(startTs);
  const end = endTs != null && endTs > startTs ? new Date(endTs) : null;
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dayLabel = (date: Date) =>
    `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
  const timeLabel = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startLabel = `${dayLabel(start)} ${timeLabel(start)}`;
  if (!end) return startLabel;
  if (sameLocalDay(start, end)) {
    return `${startLabel}-${timeLabel(end)}`;
  }
  return `${startLabel}-${dayLabel(end)} ${timeLabel(end)}`;
}

function formatFocusDuration(ms: number): string {
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

function compareOrderName<T extends { order: number; name: string; createdAt: number }>(
  a: T,
  b: T,
): number {
  return (
    a.order - b.order ||
    a.createdAt - b.createdAt ||
    a.name.localeCompare(b.name, "zh-Hans-CN")
  );
}

function buildListMoveSections(
  folders: TodoFolder[],
  lists: TodoList[],
): ListMoveSection[] {
  const activeLists = lists.filter((list) => list.archivedAt == null);
  const sections: ListMoveSection[] = [];
  const rootLists = activeLists
    .filter((list) => list.folderId == null)
    .sort(compareOrderName);

  if (rootLists.length > 0) {
    sections.push({
      id: "root",
      label: "清单",
      emoji: "📋",
      lists: rootLists,
    });
  }

  [...folders].sort(compareOrderName).forEach((folder) => {
    const folderLists = activeLists
      .filter((list) => list.folderId === folder.id)
      .sort(compareOrderName);
    if (folderLists.length === 0) return;
    sections.push({
      id: folder.id,
      label: folder.name,
      emoji: folder.emoji,
      lists: folderLists,
    });
  });

  return sections;
}

export function TodoEditor({ isDark }: Props) {
  const selectedItemId = useTodoStore((s) => s.selectedItemId);
  const allItems = useTodoStore((s) => s.items);
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const item = useMemo(
    () => (selectedItemId ? allItems.find((it) => it.id === selectedItemId) ?? null : null),
    [allItems, selectedItemId],
  );
  const completionBlocker = useMemo(
    () => (item ? todoCompletionBlocker(item, allItems) : null),
    [allItems, item],
  );
  const updateItem = useTodoStore((s) => s.updateItem);
  const setSelectedFilter = useTodoStore((s) => s.setSelectedFilter);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const setStatus = useTodoStore((s) => s.setStatus);
  const setDueRange = useTodoStore((s) => s.setDueRange);
  const toggleMarked = useTodoStore((s) => s.toggleMarked);
  const setNote = useTodoStore((s) => s.setNote);
  const removeTag = useTodoStore((s) => s.removeTag);
  const moveItem = useTodoStore((s) => s.moveItem);
  const pushSnack = useStore((s) => s.pushSnack);
  const [pomodoroSessions, setPomodoroSessions] = useState<PomodoroSession[]>(
    readPomodoroSessions,
  );

  const [titleDraft, setTitleDraft] = useState(item?.content ?? "");
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null);
  const [priorityAnchor, setPriorityAnchor] = useState<HTMLElement | null>(null);
  const [dueAnchor, setDueAnchor] = useState<HTMLElement | null>(null);
  const [listAnchor, setListAnchor] = useState<HTMLElement | null>(null);
  const [listSectionAnchor, setListSectionAnchor] = useState<{
    el: HTMLElement;
    sectionId: string;
  } | null>(null);
  const [calendarMode, setCalendarMode] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ src: string; alt: string } | null>(null);
  const [isNoteEmpty, setIsNoteEmpty] = useState(isEmptyNoteHtml(item?.note ?? ""));
  const [highlightColor, setHighlightColor] = useState(getInitialHighlightColor);
  const pendingNoteTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pendingNoteRef = useRef<{ itemId: string; html: string } | null>(null);
  const pendingMathMigrationTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const listSectionCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const highlightColorRef = useRef(highlightColor);
  const mentionSourceRef = useRef<{
    items: TodoItem[];
    lists: TodoList[];
    currentItemId: string | null;
  }>({ items: [], lists: [], currentItemId: null });
  mentionSourceRef.current = { items: allItems, lists, currentItemId: item?.id ?? null };
  highlightColorRef.current = highlightColor;
  const todoAssetDirectoryHandle = useMemo(() => {
    ensureTodoAssetDirectoryPickerFallback();
    return createTodoAssetDirectoryHandle();
  }, []);
  const highlightShortcutExtension = useMemo(
    () =>
      Extension.create({
        name: "todoHighlightShortcut",
        addKeyboardShortcuts() {
          const toggleCurrentHighlight = () =>
            this.editor
              .chain()
              .focus()
              .toggleHighlight({ color: highlightColorRef.current })
              .run();

          return {
            "Ctrl-Shift-h": toggleCurrentHighlight,
            "Ctrl-Shift-H": toggleCurrentHighlight,
            "Mod-Shift-h": toggleCurrentHighlight,
            "Mod-Shift-H": toggleCurrentHighlight,
          };
        },
      }),
    [],
  );

  const isTrashed = item?.deletedAt != null;

  useEffect(() => {
    const handleSessionChanged = () => {
      setPomodoroSessions(readPomodoroSessions());
    };
    window.addEventListener(POMODORO_SESSION_CHANGED_EVENT, handleSessionChanged);
    return () =>
      window.removeEventListener(POMODORO_SESSION_CHANGED_EVENT, handleSessionChanged);
  }, []);

  const flushPendingNote = useCallback(() => {
    const pending = pendingNoteRef.current;
    if (!pending) return;
    pendingNoteRef.current = null;
    if (pendingNoteTimerRef.current != null) {
      window.clearTimeout(pendingNoteTimerRef.current);
      pendingNoteTimerRef.current = null;
    }
    setNote(pending.itemId, pending.html);
  }, [setNote]);

  const queuePendingNote = useCallback(
    (html: string) => {
      if (!item) return;
      pendingNoteRef.current = { itemId: item.id, html };
      if (pendingNoteTimerRef.current != null) {
        window.clearTimeout(pendingNoteTimerRef.current);
      }
      pendingNoteTimerRef.current = window.setTimeout(() => {
        pendingNoteTimerRef.current = null;
        flushPendingNote();
      }, 180);
    },
    [flushPendingNote, item],
  );

  const queueMathMigration = useCallback((editor: Editor) => {
    if (!editor.getText().includes("$")) return;
    if (pendingMathMigrationTimerRef.current != null) {
      window.clearTimeout(pendingMathMigrationTimerRef.current);
    }
    pendingMathMigrationTimerRef.current = window.setTimeout(() => {
      pendingMathMigrationTimerRef.current = null;
      if (!editor.isDestroyed && editor.getText().includes("$")) {
        migrateMathStrings(editor);
      }
    }, 120);
  }, []);

  const handleEditorClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element)) return;
      const image = event.target.closest<HTMLImageElement>(".ProseMirror img");
      if (image?.src) {
        event.preventDefault();
        event.stopPropagation();
        setImagePreview({ src: image.src, alt: image.alt || "" });
        return;
      }

      const mention = event.target.closest<HTMLElement>(".todo-mention[data-id]");
      const targetId = mention?.dataset.id;
      if (!targetId) return;

      const targetItem = allItems.find((todo) => todo.id === targetId);
      if (!targetItem || targetItem.deletedAt != null) return;

      event.preventDefault();
      if (lists.some((list) => list.id === targetItem.listId)) {
        setSelectedFilter({ kind: "list", id: targetItem.listId });
      }
      setSelectedItemId(targetId);
    },
    [allItems, lists, setSelectedFilter, setSelectedItemId],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
      }),
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
        enableClickSelection: true,
        defaultProtocol: "https",
        HTMLAttributes: {
          class: "todo-editor-link",
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      Highlight.configure({
        multicolor: true,
        HTMLAttributes: { class: "todo-highlight" },
      }),
      highlightShortcutExtension,
      Mathematics.configure({
        katexOptions: {
          throwOnError: false,
          strict: false,
        },
      }),
      Mention.configure({
        deleteTriggerWithBackspace: true,
        HTMLAttributes: { class: "todo-mention" },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id ?? ""}`,
        renderHTML: ({ options, node }) => [
          "span",
          options.HTMLAttributes,
          `@${node.attrs.label ?? node.attrs.id ?? ""}`,
        ],
        suggestion: {
          char: "@",
          allowedPrefixes: null,
          decorationClass: "todo-mention-query",
          items: ({ query }) =>
            buildTodoMentionItems(
              mentionSourceRef.current.items,
              mentionSourceRef.current.lists,
              mentionSourceRef.current.currentItemId,
              query,
            ),
          render: () => createTodoMentionSuggestionRenderer(isDark),
        },
      }),
      TaskList.configure({
        HTMLAttributes: { class: "todo-task-list" },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: { class: "todo-task-item" },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      FileUpload.configure({
        locale: "zh-CN",
        storage: {
          mode: "custom",
          directoryHandle: todoAssetDirectoryHandle,
          upload: uploadTodoAttachments,
        },
        picker: {
          accept: TODO_ATTACHMENT_ACCEPT,
          multiple: true,
        },
        ingest: {
          paste: true,
          drop: true,
          maxFileSize: TODO_ATTACHMENT_MAX_FILE_SIZE,
        },
        ui: {
          bubbleMenu: { enabled: true, zIndex: 2600 },
          uploadPlaceholder: { enabled: true },
        },
        onError: (error: unknown) => {
          console.error("[todo] file upload failed:", error);
        },
      }),
    ],
    content: item?.note ?? "",
    editable: !isTrashed,
    // React 19 / SSR safety. Without this, useEditor renders synchronously
    // during the initial render which breaks under StrictMode's double
    // invocation — the second render references a destroyed editor and
    // throws "Cannot read properties of null (reading 'cached')" the next
    // time we touch its schema.
    immediatelyRender: false,
    onCreate: ({ editor }) => {
      if (!editor.isDestroyed) {
        migrateMathStrings(editor);
      }
    },
    // TipTap fires `onUpdate` on every keystroke. Persist HTML through
    // the store's debounce — the heavy lifting is done there.
    onUpdate: ({ editor }) => {
      if (!item || editor.isDestroyed) return;
      const html = editor.getHTML();
      // TipTap returns "<p></p>" for an empty doc — normalize to "" so
      // we don't dirty an item just by selecting it.
      const normalized = html === "<p></p>" ? "" : html;
      setIsNoteEmpty(isPlainEmptyEditor(editor));
      queuePendingNote(normalized);
      queueMathMigration(editor);
    },
    onTransaction: ({ editor }) => {
      if (editor.isDestroyed) return;
      setIsNoteEmpty(isPlainEmptyEditor(editor));
    },
  }, [highlightShortcutExtension, isDark, todoAssetDirectoryHandle]);

  useEffect(() => {
    return () => {
      if (pendingMathMigrationTimerRef.current != null) {
        window.clearTimeout(pendingMathMigrationTimerRef.current);
        pendingMathMigrationTimerRef.current = null;
      }
      flushPendingNote();
    };
  }, [flushPendingNote, item?.id]);

  useEffect(() => {
    persistHighlightColor(highlightColor);
  }, [highlightColor]);

  useEffect(() => {
    if (listSectionCloseTimerRef.current != null) {
      window.clearTimeout(listSectionCloseTimerRef.current);
      listSectionCloseTimerRef.current = null;
    }
    setListAnchor(null);
    setListSectionAnchor(null);
  }, [item?.id]);

  useEffect(
    () => () => {
      if (listSectionCloseTimerRef.current != null) {
        window.clearTimeout(listSectionCloseTimerRef.current);
        listSectionCloseTimerRef.current = null;
      }
    },
    [],
  );

  // Sync editor content when the selected item changes (without
  // emitting an update — `setContent(html, false)`).
  useEffect(() => {
    setTitleDraft(item?.content ?? "");
    const html = item?.note ?? "";
    setIsNoteEmpty(isEmptyNoteHtml(html));
    if (!editor || editor.isDestroyed) return;
    const current = editor.getHTML();
    if (current !== html && !(html === "" && current === "<p></p>")) {
      editor.commands.setContent(html, { emitUpdate: false });
      migrateMathStrings(editor);
    }
    editor.setEditable(!isTrashed);
  }, [item?.id, item?.content, isTrashed, editor]);

  const headerBg = useMemo(
    () => alpha(isDark ? "#f8fafc" : "#0f172a", 0.04),
    [isDark],
  );
  const handleAttachmentUploadClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!editor || editor.isDestroyed || !editor.isEditable) return;
      openTodoAttachmentFilePicker(
        editor,
        TODO_ATTACHMENT_ACCEPT,
        editor.state.selection.from,
      );
    },
    [editor],
  );

  if (!item) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.disabled",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <CheckBoxOutlineBlankRoundedIcon sx={{ fontSize: 36, opacity: 0.4 }} />
        <Typography sx={{ fontSize: 13 }}>选择一个待办查看详情</Typography>
      </Box>
    );
  }

  const focusedMs = pomodoroSessions.reduce(
    (total, session) =>
      session.itemId === item.id ? total + session.durationMs : total,
    0,
  );
  const focusLabel = focusedMs > 0 ? formatFocusDuration(focusedMs) : "";

  const submitTitle = () => {
    const v = titleDraft.trim();
    if (v && v !== item.content) {
      updateItem(item.id, { content: v });
    } else {
      setTitleDraft(item.content);
    }
  };
  const priority = priorityMeta(item.priority);
  const progress = Math.min(100, Math.max(0, Math.round(item.progress ?? 0)));
  const showProgress = item.status !== "completed";
  const completed = item.status === "completed";
  const completionLocked = !completed && completionBlocker != null;
  const completionLabel = completionLocked
    ? `前序任务未完成：${completionBlocker?.content.trim() || "未命名待办"}`
    : completed
      ? "标记为待办"
      : "标记为已完成";
  const dueOverdue =
    item.dueAt != null &&
    item.status !== "completed" &&
    item.status !== "abandoned" &&
    isDuePast(item.dueAt, item.dueEndAt);
  const currentList = lists.find((list) => list.id === item.listId) ?? null;
  const listMoveSections = buildListMoveSections(folders, lists);
  const listMoveOptionsCount = listMoveSections.reduce(
    (count, section) => count + section.lists.length,
    0,
  );
  const activeListMoveSection =
    listSectionAnchor != null
      ? listMoveSections.find((section) => section.id === listSectionAnchor.sectionId) ?? null
      : null;
  const clearListSectionCloseTimer = () => {
    if (listSectionCloseTimerRef.current == null) return;
    window.clearTimeout(listSectionCloseTimerRef.current);
    listSectionCloseTimerRef.current = null;
  };
  const scheduleListSectionClose = () => {
    clearListSectionCloseTimer();
    listSectionCloseTimerRef.current = window.setTimeout(() => {
      setListSectionAnchor(null);
      listSectionCloseTimerRef.current = null;
    }, 160);
  };
  const openListSection = (el: HTMLElement, sectionId: string) => {
    clearListSectionCloseTimer();
    setListSectionAnchor((current) =>
      current?.el === el && current.sectionId === sectionId ? current : { el, sectionId },
    );
  };
  const closeListMenu = () => {
    clearListSectionCloseTimer();
    setListSectionAnchor(null);
    setListAnchor(null);
  };
  const moveToList = (targetList: TodoList) => {
    if (targetList.id !== item.listId) {
      moveItem(item.id, targetList.id);
      pushSnack(`已移动到 ${targetList.emoji || "📋"}${targetList.name}`, "success");
    }
    closeListMenu();
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <Box
        sx={{
          px: 2,
          pt: 1,
          pb: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 0.8,
          borderBottom: 1,
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.8,
            minHeight: 32,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              columnGap: 0.85,
              rowGap: 0,
              flexWrap: "nowrap",
              minHeight: 32,
              minWidth: 0,
              flex: "1 1 auto",
              overflowX: "auto",
              overflowY: "hidden",
              scrollbarWidth: "none",
              "&::-webkit-scrollbar": { display: "none" },
              "& > *": { flexShrink: 0 },
            }}
          >
            <Tooltip title={completionLabel}>
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", height: 32 }}>
                <IconButton
                  size="small"
                  disabled={isTrashed || completionLocked}
                  onClick={() => {
                    if (!completionLocked) {
                      setStatus(item.id, completed ? "pending" : "completed");
                    }
                  }}
                  sx={{ width: 30, height: 30 }}
                >
                  {completionLocked ? (
                    <LockRoundedIcon sx={{ fontSize: 19, color: "text.disabled" }} />
                  ) : completed ? (
                    <CheckBoxRoundedIcon sx={{ fontSize: 19, color: "primary.main" }} />
                  ) : (
                    <CheckBoxOutlineBlankRoundedIcon sx={{ fontSize: 19, color: "text.secondary" }} />
                  )}
                </IconButton>
              </Box>
            </Tooltip>
            <Divider
              orientation="vertical"
              flexItem
              sx={{
                alignSelf: "center",
                height: 18,
                borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.18 : 0.14),
              }}
            />
            <Tooltip
              title={
                item.dueAt == null
                  ? "设置日期"
                  : item.reminderEnabled
                    ? "编辑日期，提醒已开启"
                    : "编辑日期"
              }
            >
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", height: 32 }}>
                <Button
                  size="small"
                  disabled={isTrashed}
                  startIcon={
                    item.reminderEnabled && item.dueAt != null ? (
                      <AlarmRoundedIcon
                        sx={{
                          fontSize: 17,
                          color: dueOverdue ? TODO_OVERDUE_COLOR : "warning.main",
                        }}
                      />
                    ) : (
                      <CalendarTodayRoundedIcon sx={{ fontSize: 17 }} />
                    )
                  }
                  onClick={(e) => setDueAnchor(e.currentTarget)}
                  sx={(theme) => ({
                    height: 30,
                    px: 1,
                    color: dueOverdue
                      ? TODO_OVERDUE_COLOR
                      : item.dueAt == null
                        ? "text.secondary"
                        : "primary.main",
                    display: "inline-flex",
                    alignItems: "center",
                    lineHeight: 1,
                    fontSize: 12,
                    minWidth: 0,
                    bgcolor: "transparent",
                    border: 0,
                    boxShadow: "none",
                    "& .MuiButton-startIcon": {
                      mr: item.dueAt == null ? 0 : 0.5,
                      display: "inline-flex",
                      alignItems: "center",
                    },
                    "&:hover": {
                      bgcolor: alpha(theme.palette.primary.main, isDark ? 0.2 : 0.1),
                      boxShadow: "none",
                    },
                  })}
                >
                  {item.dueAt == null ? "" : formatEditorDueRange(item.dueAt, item.dueEndAt)}
                </Button>
              </Box>
            </Tooltip>
            <Tooltip title={item.marked ? "取消标记" : "标记"}>
              <span>
                <IconButton
                  size="small"
                  disabled={isTrashed}
                  onClick={() => toggleMarked(item.id)}
                  sx={{ width: 30, height: 30 }}
                >
                  {item.marked ? (
                    <FlagRoundedIcon sx={{ fontSize: 18, color: "warning.main" }} />
                  ) : (
                    <OutlinedFlagRoundedIcon sx={{ fontSize: 18, color: "text.disabled" }} />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="设置优先级">
              <span>
                <Button
                  size="small"
                  disabled={isTrashed}
                  onClick={(e) => setPriorityAnchor(e.currentTarget)}
                  sx={{
                    minWidth: 0,
                    height: 35,
                    px: 1,
                    color: priority.color,
                    bgcolor: alpha(priority.color, isDark ? 0.16 : 0.1),
                    fontSize: 12,
                    fontWeight: 800,
                    "&:hover": { bgcolor: alpha(priority.color, isDark ? 0.22 : 0.16) },
                  }}
                >
                  {priority.emoji}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={isTrashed ? "已在垃圾桶" : "管理标签"}>
              <span>
                <IconButton
                  size="small"
                  disabled={isTrashed}
                  onClick={(e) => setTagAnchor(e.currentTarget)}
                  sx={{ width: 30, height: 30 }}
                >
                  <LabelRoundedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                </IconButton>
              </span>
            </Tooltip>
            {item.tags.map((t) => (
              <Chip
                key={t}
                size="small"
                label={`#${t}`}
                onDelete={isTrashed ? undefined : () => removeTag(item.id, t)}
                sx={{
                  height: 24,
                  fontSize: 12,
                  bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
                }}
              />
            ))}
            {showProgress && (
              <Tooltip title="进度 0-100%">
                <span>
                  <TextField
                    type="number"
                    value={progress}
                    disabled={isTrashed}
                    variant="standard"
                    onChange={(e) => {
                      const nextProgress = e.target.value === "" ? 0 : Number(e.target.value);
                      updateItem(
                        item.id,
                        nextProgress >= 100
                          ? { progress: nextProgress, status: "completed" }
                          : { progress: nextProgress },
                      );
                    }}
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        max: 100,
                        step: 1,
                        "aria-label": "进度百分比",
                      },
                      input: {
                        disableUnderline: true,
                        sx: {
                          height: 30,
                          fontSize: 12,
                          fontWeight: 700,
                          color: "text.secondary",
                          bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
                          borderRadius: 0.8,
                          px: 0.8,
                          "& input": {
                            p: 0,
                            textAlign: "center",
                          },
                        },
                      },
                    }}
                    sx={{ width: 58, flexShrink: 0 }}
                  />
                </span>
              </Tooltip>
            )}
            {focusedMs > 0 && (
              <Box
                aria-label={`已专注 ${focusLabel}`}
                sx={{
                  height: 30,
                  px: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.45,
                  flexShrink: 0,
                  borderRadius: 0.8,
                  color: "text.secondary",
                  bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                }}
              >
                <TimerRoundedIcon sx={{ fontSize: 16, color: "primary.main" }} />
                <Typography component="span" sx={{ fontSize: 12, fontWeight: 700 }}>
                  已专注 {focusLabel}
                </Typography>
              </Box>
            )}
            {tagAnchor && (
              <TagPickerPopover
                itemId={item.id}
                anchorEl={tagAnchor}
                onClose={() => setTagAnchor(null)}
              />
            )}
            {priorityAnchor && (
              <Menu
                open
                anchorEl={priorityAnchor}
                onClose={() => setPriorityAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                transformOrigin={{ vertical: "top", horizontal: "left" }}
              >
                {TODO_PRIORITY_OPTIONS.map((option) => (
                  <MenuItem
                    key={option.value}
                    selected={option.value === item.priority}
                    onClick={() => {
                      updateItem(item.id, {
                        priority: item.priority === option.value ? null : option.value,
                      });
                      setPriorityAnchor(null);
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
            {dueAnchor && (
              <DueDatePopover
                anchorEl={dueAnchor}
                value={item.dueAt}
                endValue={item.dueEndAt}
                reminderEnabled={item.reminderEnabled}
                onClose={() => setDueAnchor(null)}
                onChange={(start, end, reminderEnabled) =>
                  setDueRange(item.id, start, end ?? null, reminderEnabled)
                }
              />
            )}
          </Box>
          <Tooltip title={calendarMode ? "返回 MD 编辑" : "打开日视图"}>
            <IconButton
              size="small"
              aria-label={calendarMode ? "返回 MD 编辑" : "打开日视图"}
              onClick={() => setCalendarMode((current) => !current)}
              sx={(theme) => ({
                width: 32,
                height: 32,
                ml: "auto",
                flexShrink: 0,
                color: "primary.main",
                bgcolor: "transparent",
                border: 0,
                borderRadius: 0.8,
                boxShadow: "none",
                "&:hover": {
                  bgcolor: alpha(theme.palette.primary.main, isDark ? 0.2 : 0.1),
                  boxShadow: "none",
                },
              })}
            >
              {calendarMode ? (
                <SubjectRoundedIcon sx={{ fontSize: 20 }} />
              ) : (
                <CalendarTodayRoundedIcon sx={{ fontSize: 20 }} />
              )}
            </IconButton>
          </Tooltip>
        </Box>
        <Box
          aria-hidden
          sx={{
            flex: "0 0 auto",
            height: 0,
            width: "100%",
            borderTop: "1px solid",
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.06 : 0.05),
            bgcolor: "transparent",
            pointerEvents: "none",
          }}
        />
        <Box sx={{ display: "flex", alignItems: "flex-start", width: "100%" }}>
        <TextField
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={submitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitTitle();
              (e.currentTarget as HTMLElement).blur();
            }
          }}
          fullWidth
          variant="standard"
          multiline
          minRows={1}
          maxRows={4}
          disabled={isTrashed}
          slotProps={{
            input: {
              disableUnderline: true,
              sx: {
                fontSize: 18,
                fontWeight: 600,
                lineHeight: 1.35,
                alignItems: "flex-start",
                "& textarea": {
                  overflow: "hidden !important",
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                  resize: "none",
                },
              },
            },
          }}
        />
        </Box>
      </Box>
      {calendarMode ? (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <TodoCalendar
            key="todo-editor-day-calendar"
            isDark={isDark}
            initialView="timeGridDay"
            compact
          />
        </Box>
      ) : (
        <>
      {editor && (
        <EditorToolbar
          editor={editor}
          headerBg={headerBg}
          isDark={isDark}
          isTrashed={isTrashed}
          highlightColor={highlightColor}
          onHighlightColorChange={setHighlightColor}
          onContentInserted={() => setIsNoteEmpty(false)}
        />
      )}
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        <Box
          onClick={handleEditorClick}
          sx={{
            height: "100%",
            overflowY: "auto",
            position: "relative",
            px: 2.4,
            pt: 2,
            pb: 7,
          "& .ProseMirror": {
            outline: "none",
            minHeight: "100%",
            fontSize: 14,
            lineHeight: 1.7,
            color: "text.primary",
          },
          "& .ProseMirror h1": { fontSize: 22, fontWeight: 700, mt: 1.5, mb: 0.8 },
          "& .ProseMirror h2": { fontSize: 18, fontWeight: 700, mt: 1.5, mb: 0.6 },
          "& .ProseMirror h3": { fontSize: 16, fontWeight: 600, mt: 1.2, mb: 0.4 },
          "& .ProseMirror ul, & .ProseMirror ol": { pl: 3, my: 0.5 },
          "& .ProseMirror li": { my: 0.2 },
          "& .ProseMirror ul.todo-task-list, & .ProseMirror ul[data-type='taskList']": {
            listStyle: "none",
            paddingLeft: "0 !important",
            my: 0.6,
          },
          "& .ProseMirror li.todo-task-item, & .ProseMirror li[data-type='taskItem']": {
            display: "flex !important",
            flexDirection: "row !important",
            alignItems: "flex-start !important",
            gap: "8px !important",
            my: 0.35,
          },
          "& .ProseMirror li.todo-task-item > label, & .ProseMirror li[data-type='taskItem'] > label": {
            display: "inline-flex !important",
            alignItems: "center !important",
            flex: "0 0 auto !important",
            height: "1.7em",
            mt: "1px",
            userSelect: "none",
          },
          "& .ProseMirror li.todo-task-item > label input, & .ProseMirror li[data-type='taskItem'] > label input": {
            m: 0,
            cursor: "pointer",
          },
          "& .ProseMirror li.todo-task-item > div, & .ProseMirror li[data-type='taskItem'] > div": {
            display: "block !important",
            flex: "1 1 auto !important",
            minWidth: "0 !important",
          },
          "& .ProseMirror li.todo-task-item > div > p, & .ProseMirror li[data-type='taskItem'] > div > p": {
            margin: "0 !important",
            minHeight: "1.7em",
          },
          "& .ProseMirror li.todo-task-item[data-checked='true'] > div, & .ProseMirror li[data-type='taskItem'][data-checked='true'] > div": {
            color: "text.disabled",
            textDecoration: "line-through",
            textDecorationThickness: "1px",
            textDecorationColor: "currentColor",
          },
          "& .ProseMirror li.todo-task-item[data-checked='true'] > div *, & .ProseMirror li[data-type='taskItem'][data-checked='true'] > div *": {
            textDecoration: "line-through",
            textDecorationThickness: "1px",
            textDecorationColor: "currentColor",
          },
          "& .ProseMirror p": { my: 0.5 },
          "& .ProseMirror a.todo-editor-link": {
            color: "primary.main",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
            cursor: "pointer",
          },
          "& .ProseMirror .todo-mention": {
            display: "inline-flex",
            alignItems: "center",
            maxWidth: "100%",
            px: 0.45,
            py: 0.05,
            borderRadius: 0.8,
            bgcolor: alpha("#3b82f6", isDark ? 0.22 : 0.1),
            color: isDark ? "#93c5fd" : "#1d4ed8",
            fontWeight: 700,
            whiteSpace: "nowrap",
            verticalAlign: "baseline",
            cursor: "pointer",
          },
          "& .ProseMirror .todo-mention-query": {
            borderRadius: 0.6,
            bgcolor: alpha("#3b82f6", isDark ? 0.18 : 0.08),
          },
          "& .ProseMirror mark.todo-highlight, & .ProseMirror mark": {
            px: 0.25,
            borderRadius: 0.5,
            boxDecorationBreak: "clone",
          },
          "& .ProseMirror .tiptap-mathematics-render": {
            borderRadius: 0.8,
            bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
            color: "text.primary",
          },
          "& .ProseMirror .tiptap-mathematics-render[data-type='inline-math']": {
            display: "inline-flex",
            alignItems: "center",
            px: 0.45,
            py: 0.05,
            mx: 0.2,
            verticalAlign: "baseline",
          },
          "& .ProseMirror .tiptap-mathematics-render[data-type='block-math']": {
            display: "block",
            my: 1,
            p: 1.2,
            overflowX: "auto",
            textAlign: "center",
          },
          "& .ProseMirror .inline-math-error, & .ProseMirror .block-math-error": {
            color: "error.main",
            fontFamily: "ui-monospace, monospace",
          },
          "& .ProseMirror .tiptap-upload-image": { my: 1 },
          "& .ProseMirror .tiptap-upload-image__img, & .ProseMirror img": {
            maxWidth: "100%",
            borderRadius: 1,
            cursor: "zoom-in",
          },
          "& .ProseMirror .tiptap-upload-video, & .ProseMirror [data-type='upload-video']": {
            my: 1,
          },
          "& .ProseMirror video": {
            maxWidth: "100%",
            borderRadius: 1,
            bgcolor: "#000",
          },
          "& .ProseMirror .tiptap-upload-file, & .ProseMirror [data-upload-file-card='true']": {
            my: 1,
          },
          "& .ProseMirror .tiptap-upload-file__card": {
            display: "flex",
            alignItems: "center",
            gap: 1,
            p: 1,
            border: 1,
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.12),
            borderRadius: 1,
            bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.04),
          },
          "& .ProseMirror .tableWrapper": { overflowX: "auto", my: 1 },
          "& .ProseMirror table": {
            borderCollapse: "collapse",
            tableLayout: "fixed",
            width: "100%",
          },
          "& .ProseMirror th, & .ProseMirror td": {
            border: 1,
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.18),
            minWidth: 80,
            px: 1,
            py: 0.6,
            position: "relative",
            verticalAlign: "top",
          },
          "& .ProseMirror th": {
            bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
            fontWeight: 700,
          },
          "& .ProseMirror .selectedCell:after": {
            content: '""',
            position: "absolute",
            inset: 0,
            bgcolor: alpha("#60a5fa", 0.18),
            pointerEvents: "none",
          },
          "& .ProseMirror .column-resize-handle": {
            position: "absolute",
            right: -2,
            top: 0,
            bottom: 0,
            width: 4,
            bgcolor: "primary.main",
            pointerEvents: "none",
          },
          "& .ProseMirror blockquote": {
            borderLeft: 3,
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.2),
            pl: 1.5,
            color: "text.secondary",
            my: 0.8,
          },
          "& .ProseMirror code": {
            bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
            px: 0.6,
            py: 0.1,
            borderRadius: 0.6,
            fontSize: 13,
            fontFamily: "ui-monospace, monospace",
          },
          "& .ProseMirror pre": {
            bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
            p: 1.2,
            borderRadius: 1,
            overflowX: "auto",
            "& code": { bgcolor: "transparent", p: 0 },
          },
          }}
        >
          {editor && isNoteEmpty && (
            <Typography
              sx={{
                position: "absolute",
                top: 16,
                left: 19,
                color: "text.disabled",
                fontSize: 14,
                lineHeight: 1.7,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {NOTE_PLACEHOLDER}
            </Typography>
          )}
          <EditorContent editor={editor} />
        </Box>
        {currentList && (
          <>
            <Tooltip title="移动到清单">
              <Box
                component="span"
                sx={{
                  position: "absolute",
                  left: 16,
                  bottom: 16,
                  zIndex: 4,
                  display: "inline-flex",
                  minWidth: 0,
                }}
              >
                <Button
                  size="small"
                  aria-label={`当前清单：${currentList.name}`}
                  disabled={isTrashed || listMoveOptionsCount === 0}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => setListAnchor(event.currentTarget)}
                  sx={{
                    height: 30,
                    minWidth: 0,
                    maxWidth: 180,
                    px: 0.7,
                    gap: 0.6,
                    color: isDark ? "#e2e8f0" : "#334155",
                    bgcolor: "transparent",
                    border: 0,
                    boxShadow: "none",
                    textTransform: "none",
                    justifyContent: "flex-start",
                    borderRadius: 0.8,
                    "&:hover": {
                      bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.12 : 0.07),
                    },
                    "&.Mui-disabled": {
                      opacity: 0.5,
                      bgcolor: "transparent",
                    },
                  }}
                >
                  <TodoEmoji emoji={currentList.emoji} fallback="📋" size={16} />
                  <Typography
                    component="span"
                    sx={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {currentList.name}
                  </Typography>
                </Button>
              </Box>
            </Tooltip>
            <Menu
              open={Boolean(listAnchor)}
              anchorEl={listAnchor}
              onClose={closeListMenu}
              anchorOrigin={{ vertical: "top", horizontal: "left" }}
              transformOrigin={{ vertical: "bottom", horizontal: "left" }}
              slotProps={{
                paper: {
                  sx: {
                    width: 220,
                    maxHeight: 340,
                    mt: -0.6,
                  },
                },
              }}
            >
              {listMoveSections.length === 0 ? (
                <MenuItem disabled>暂无清单</MenuItem>
              ) : (
                listMoveSections.map((section, sectionIndex) => (
                  <Fragment key={section.id}>
                    {sectionIndex > 0 && <Divider sx={{ my: 0.35 }} />}
                    <MenuItem
                      selected={section.lists.some((list) => list.id === item.listId)}
                      onMouseEnter={(event) => openListSection(event.currentTarget, section.id)}
                      onMouseLeave={scheduleListSectionClose}
                      onClick={(event) => openListSection(event.currentTarget, section.id)}
                      sx={{ minHeight: 36 }}
                    >
                      <Box
                        sx={{
                          minWidth: 0,
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                        }}
                      >
                        <TodoEmoji
                          emoji={section.emoji}
                          fallback={section.id === "root" ? "📋" : ""}
                          size={16}
                        />
                        <Typography
                          component="span"
                          sx={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: 13,
                            fontWeight: section.lists.some((list) => list.id === item.listId)
                              ? 700
                              : 500,
                          }}
                        >
                          {section.label}
                        </Typography>
                      </Box>
                      <ChevronRightRoundedIcon sx={{ ml: 1, fontSize: 18, opacity: 0.55 }} />
                    </MenuItem>
                  </Fragment>
                ))
              )}
            </Menu>
            {listAnchor && listSectionAnchor && activeListMoveSection && (
              <Menu
                open
                hideBackdrop
                disableAutoFocus
                disableAutoFocusItem
                disableEnforceFocus
                disableRestoreFocus
                anchorEl={listSectionAnchor.el}
                onClose={() => {
                  clearListSectionCloseTimer();
                  setListSectionAnchor(null);
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
                    onMouseEnter: clearListSectionCloseTimer,
                    onMouseLeave: scheduleListSectionClose,
                  },
                  list: {
                    onMouseEnter: clearListSectionCloseTimer,
                    onMouseLeave: scheduleListSectionClose,
                  },
                }}
              >
                {activeListMoveSection.lists.map((list) => (
                  <MenuItem
                    key={list.id}
                    selected={list.id === item.listId}
                    disabled={list.id === item.listId}
                    onClick={() => moveToList(list)}
                    sx={{ minHeight: 34 }}
                  >
                    <Box
                      sx={{
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                      }}
                    >
                      <TodoEmoji emoji={list.emoji} fallback="📋" size={16} />
                      <Typography
                        component="span"
                        sx={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 13,
                          fontWeight: list.id === item.listId ? 700 : 500,
                        }}
                      >
                        {list.name}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Menu>
            )}
          </>
        )}
        {editor && (
          <Tooltip title="上传附件">
            <Box
              component="span"
              sx={{
                position: "absolute",
                right: 16,
                bottom: 16,
                zIndex: 4,
                display: "inline-flex",
              }}
            >
              <IconButton
                aria-label="上传附件"
                disabled={isTrashed}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={handleAttachmentUploadClick}
                sx={{
                  width: 38,
                  height: 38,
                  color: isDark ? "#dbeafe" : "#1d4ed8",
                  bgcolor: alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.24 : 0.12),
                  border: 1,
                  borderColor: alpha(isDark ? "#bfdbfe" : "#1d4ed8", isDark ? 0.22 : 0.16),
                  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
                  "&:hover": {
                    bgcolor: alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.32 : 0.18),
                  },
                  "&.Mui-disabled": {
                    opacity: 0.42,
                    bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
                  },
                }}
              >
                <AttachFileRoundedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Box>
          </Tooltip>
        )}
      </Box>
        </>
      )}
      <Dialog
        open={imagePreview != null}
        onClose={() => setImagePreview(null)}
        maxWidth="xl"
        fullWidth
        sx={{ zIndex: TODO_IMAGE_PREVIEW_Z_INDEX }}
        slotProps={{
          paper: {
            sx: {
              maxHeight: "92vh",
              overflow: "hidden",
              bgcolor: isDark ? "#020617" : "#f8fafc",
            },
          },
        }}
      >
        <DialogContent
          sx={{
            p: 0,
            minHeight: { xs: "60vh", md: "72vh" },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            bgcolor: isDark ? "#020617" : "#f8fafc",
          }}
        >
          <IconButton
            aria-label="Close preview"
            onClick={() => setImagePreview(null)}
            sx={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 1,
              color: isDark ? "#e2e8f0" : "#0f172a",
              bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.16 : 0.08),
              "&:hover": {
                bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.24 : 0.14),
              },
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 22 }} />
          </IconButton>
          {imagePreview && (
            <Box
              component="img"
              src={imagePreview.src}
              alt={imagePreview.alt}
              sx={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "88vh",
                objectFit: "contain",
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

interface ToolbarProps {
  editor: Editor;
  headerBg: string;
  isDark: boolean;
  isTrashed: boolean;
  highlightColor: string;
  onHighlightColorChange: (color: string) => void;
  onContentInserted: () => void;
}

function EditorToolbar({
  editor,
  headerBg,
  isDark,
  isTrashed,
  highlightColor,
  onHighlightColorChange,
  onContentInserted,
}: ToolbarProps) {
  const [tableAnchor, setTableAnchor] = useState<HTMLElement | null>(null);
  const [tableRows, setTableRows] = useState("3");
  const [tableCols, setTableCols] = useState("3");
  const [highlightAnchor, setHighlightAnchor] = useState<HTMLElement | null>(null);
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const isTablePopoverOpen = Boolean(tableAnchor);
  const isHighlightPopoverOpen = Boolean(highlightAnchor);
  const isLinkPopoverOpen = Boolean(linkAnchor);

  const openLinkPopover = (event: React.MouseEvent<HTMLButtonElement>) => {
    const attrs = editor.getAttributes("link") as { href?: string };
    const range = currentLinkRange(editor);
    setLinkText(textInRange(editor, range));
    setLinkUrl(attrs.href ?? "");
    setLinkAnchor(event.currentTarget);
  };

  const applyLink = () => {
    const href = normalizeLinkUrl(linkUrl);
    const range = currentLinkRange(editor) ?? {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const text = linkText.trim() || href;
      const linkMark = editor.state.schema.marks.link.create({ href });
      const linkNode = editor.state.schema.text(text, [linkMark]);
      const tr = editor.state.tr.replaceWith(range.from, range.to, linkNode);
      const linkEnd = range.from + text.length;
      tr.setSelection(TextSelection.create(tr.doc, linkEnd));
      tr.setStoredMarks([]);
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
    }
    setLinkAnchor(null);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkText("");
    setLinkUrl("");
    setLinkAnchor(null);
  };

  const applyHighlight = (color: string) => {
    onHighlightColorChange(color);
    const attrs = editor.getAttributes("highlight") as { color?: string };
    const chain = editor.chain().focus();
    if (editor.isActive("highlight") && attrs.color === color) {
      chain.unsetHighlight().run();
    } else {
      chain.setHighlight({ color }).run();
    }
    setHighlightAnchor(null);
  };

  const insertTable = () => {
    const inserted = editor
      .chain()
      .focus()
      .insertTable({
        rows: clampTableSize(tableRows),
        cols: clampTableSize(tableCols),
        withHeaderRow: true,
      })
      .run();
    if (inserted) {
      onContentInserted();
    }
    setTableAnchor(null);
  };

  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.5,
        display: "flex",
        alignItems: "center",
        gap: 0.3,
        bgcolor: headerBg,
        borderBottom: 1,
        borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
        flexWrap: "wrap",
      }}
    >
      <ToolbarButton
        title="H1 (#)"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>H1</Typography>
      </ToolbarButton>
      <ToolbarButton
        title="H2 (##)"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>H2</Typography>
      </ToolbarButton>
      <ToolbarButton
        title="标题"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <TitleRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="Paragraph"
        active={editor.isActive("paragraph")}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        <FormatSizeRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
      <ToolbarButton
        title="加粗 (Ctrl+B)"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <FormatBoldRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="斜体 (Ctrl+I)"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <FormatItalicRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="删除线"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <StrikethroughSRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="行内代码"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <CodeRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="Code block (` ``` `)"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <DataObjectRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="高亮"
        active={editor.isActive("highlight")}
        onClick={(e) => setHighlightAnchor(e.currentTarget)}
      >
        <FormatColorFillRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <Popover
        open={isHighlightPopoverOpen}
        anchorEl={highlightAnchor}
        onClose={() => setHighlightAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.8,
              p: 1,
              borderRadius: 1,
              boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
            },
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: 236 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
            <TextField
              type="color"
              size="small"
              label="颜色"
              value={highlightColor}
              onChange={(e) => onHighlightColorChange(e.target.value)}
              slotProps={{
                htmlInput: {
                  "aria-label": "高亮颜色",
                },
              }}
              sx={{
                width: 92,
                "& input": {
                  height: 28,
                  p: 0.4,
                  cursor: "pointer",
                },
              }}
            />
            <Button
              size="small"
              variant="contained"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyHighlight(highlightColor)}
              sx={{ minWidth: 64, height: 34 }}
            >
              应用
            </Button>
            <Tooltip title="清除高亮">
              <IconButton
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().unsetHighlight().run();
                  setHighlightAnchor(null);
                }}
                sx={{ width: 34, height: 34, color: "text.secondary" }}
              >
                <FormatClearRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
            {HIGHLIGHT_COLORS.map((option) => {
              const selected = highlightColor.toLowerCase() === option.color;
              const active =
                editor.isActive("highlight") &&
                (editor.getAttributes("highlight") as { color?: string }).color ===
                  option.color;
              return (
                <Tooltip key={option.color} title={option.label}>
                  <IconButton
                    size="small"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onHighlightColorChange(option.color);
                      applyHighlight(option.color);
                    }}
                    sx={{
                      width: 26,
                      height: 26,
                      border: active || selected ? 2 : 1,
                      borderColor: active
                        ? "primary.main"
                        : selected
                          ? "text.primary"
                          : "divider",
                      bgcolor: option.color,
                      "&:hover": { bgcolor: option.color },
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      </Popover>
      <ToolbarButton
        title="链接"
        active={editor.isActive("link")}
        onClick={openLinkPopover}
      >
        <LinkRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <Popover
        open={isLinkPopoverOpen}
        anchorEl={linkAnchor}
        onClose={() => setLinkAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.8,
              p: 2,
              width: 312,
              borderRadius: 1,
              boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
            },
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.2 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 800 }}>添加链接</Typography>
          <TextField
            autoFocus
            size="small"
            label="文本"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
            fullWidth
          />
          <TextField
            size="small"
            label="链接"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
            placeholder="https://example.com"
            fullWidth
          />
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.8, mt: 0.4 }}>
            <Tooltip title="移除链接">
              <span>
                <IconButton
                  size="small"
                  disabled={!editor.isActive("link")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={removeLink}
                  sx={{ width: 32, height: 32, color: "text.secondary", mr: "auto" }}
                >
                  <LinkOffRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Button size="small" onClick={() => setLinkAnchor(null)}>
              取消
            </Button>
            <Button
              size="small"
              variant="contained"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyLink}
              disabled={!linkUrl.trim()}
              sx={{ minWidth: 72 }}
            >
              确定
            </Button>
          </Box>
        </Box>
      </Popover>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
      <ToolbarButton
        title="无序列表 (- 空格)"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <FormatListBulletedRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="有序列表 (1. 空格)"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <FormatListNumberedRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="任务列表 (- [ ] 空格)"
        active={editor.isActive("taskList")}
        onClick={() => {
          const changed = editor.chain().focus().toggleTaskList().run();
          if (changed) {
            focusNearestTaskItemContent(editor);
          }
        }}
      >
        <ChecklistRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="引用 (> 空格)"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <FormatQuoteRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="Horizontal rule (---)"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <HorizontalRuleRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <ToolbarButton
        title="插入表格"
        active={editor.isActive("table")}
        onClick={(e) => setTableAnchor(e.currentTarget)}
      >
        <TableChartRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      <Popover
        open={isTablePopoverOpen}
        anchorEl={tableAnchor}
        onClose={() => setTableAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.8,
              p: 1.5,
              width: 220,
              borderRadius: 1,
              boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
            },
          },
        }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
          <TextField
            label="行"
            type="number"
            size="small"
            value={tableRows}
            onChange={(e) => setTableRows(e.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 20 } }}
          />
          <TextField
            label="列"
            type="number"
            size="small"
            value={tableCols}
            onChange={(e) => setTableCols(e.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 20 } }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={insertTable}
            sx={{ gridColumn: "1 / -1", mt: 0.2 }}
          >
            插入表格
          </Button>
        </Box>
      </Popover>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
      <ToolbarButton
        title="清除格式"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <FormatClearRoundedIcon sx={{ fontSize: 18 }} />
      </ToolbarButton>
      {isTrashed && (
        <Typography
          sx={{ ml: "auto", fontSize: 12, color: "warning.main", fontWeight: 600 }}
        >
          已在垃圾桶（只读）
        </Typography>
      )}
    </Box>
  );
}

interface ToolbarButtonProps {
  title: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  children: React.ReactNode;
}

function ToolbarButton({ title, onClick, active, children }: ToolbarButtonProps) {
  return (
    <Tooltip title={title}>
      <IconButton
        size="small"
        onMouseDown={(e) => {
          // Don't yank focus away from the editor before the command runs.
          e.preventDefault();
        }}
        onClick={onClick}
        sx={{
          width: 28,
          height: 28,
          color: active ? "primary.main" : "text.secondary",
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}
