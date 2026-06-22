import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Box,
  Checkbox,
  IconButton,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useStore } from "../../state/store";
import {
  applyFilter,
  collectAllTags,
  countForFilter,
  isInboxList,
  orderTodoItemsHierarchically,
  useTodoStore,
} from "./useTodoStore";
import { listTodoFonts } from "./todoIpc";
import { QuickAddTodoInput } from "./TodoDetail";
import { TodoEmoji } from "./TodoEmoji";
import { useTodoReminders } from "./todoReminders";
import { ItemContextMenu } from "./ItemContextMenu";
import { DueDatePopover } from "./DueDatePopover";
import { TagPickerPopover } from "./TagPickerPopover";
import {
  ensureTodoFontsRegistered,
  todoFontCssFamily,
  type TodoFontEntry,
} from "./todoFonts";
import { resolveTodoColorTheme } from "../../lib/todoColorThemes";
import type {
  SavedTodoFilter,
  TodoFilter,
  TodoFolder,
  TodoGroup,
  TodoItem,
  TodoList,
} from "./types";

const WIDGET_SOURCE_KEY = "aebox.todo.widgetSource";
const DAY_MS = 24 * 60 * 60 * 1000;

type WidgetFilter = Extract<
  TodoFilter,
  { kind: "today" } | { kind: "recent7" } | { kind: "inbox" } | { kind: "folder" } | { kind: "list" }
>;

interface WidgetSourceOption {
  key: string;
  label: string;
  emoji: string;
  filter: WidgetFilter;
  count: number;
}

interface WidgetSection {
  key: string;
  title: string;
  emoji?: string;
  items: TodoItem[];
}

function readInitialSourceKey(): string {
  try {
    return localStorage.getItem(WIDGET_SOURCE_KEY) || "today";
  } catch {
    return "today";
  }
}

function saveSourceKey(key: string) {
  try {
    localStorage.setItem(WIDGET_SOURCE_KEY, key);
  } catch {
    /* localStorage may be unavailable */
  }
}

function sourceKeyForFilter(filter: WidgetFilter): string {
  if (filter.kind === "folder" || filter.kind === "list") return `${filter.kind}:${filter.id}`;
  return filter.kind;
}

function compareByOrderThenName<T extends { order: number; createdAt: number; name: string }>(
  a: T,
  b: T,
) {
  return a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name);
}

function startOfTodayMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function formatDueLabel(item: TodoItem): string {
  if (item.dueAt == null) return "";
  const start = new Date(item.dueAt);
  const today = startOfTodayMs();
  const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const diff = Math.round((dayStart - today) / DAY_MS);
  const hhmm = (date: Date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const day =
    diff === 0
      ? "今天"
      : diff === 1
        ? "明天"
        : `${start.getMonth() + 1}/${start.getDate()}`;
  if (item.dueEndAt != null && item.dueEndAt > item.dueAt) {
    const end = new Date(item.dueEndAt);
    const sameDay =
      end.getFullYear() === start.getFullYear() &&
      end.getMonth() === start.getMonth() &&
      end.getDate() === start.getDate();
    return sameDay
      ? `${day} ${hhmm(start)}-${hhmm(end)}`
      : `${day} ${hhmm(start)} - ${end.getMonth() + 1}/${end.getDate()} ${hhmm(end)}`;
  }
  return `${day} ${hhmm(start)}`;
}

function isDuePast(startTs: number, endTs: number | null): boolean {
  const effectiveTs = endTs != null && endTs > startTs ? endTs : startTs;
  return effectiveTs < Date.now();
}

function sourceOptionsFor(
  folders: TodoFolder[],
  lists: TodoList[],
  items: TodoItem[],
  advancedFilter: ReturnType<typeof useTodoStore.getState>["advancedFilter"],
  customFilters: SavedTodoFilter[],
): WidgetSourceOption[] {
  const activeLists = lists
    .filter((list) => list.archivedAt == null && !isInboxList(list))
    .sort(compareByOrderThenName);
  const sortedFolders = folders.slice().sort(compareByOrderThenName);
  const makeCount = (filter: WidgetFilter) =>
    countForFilter(items, filter, lists, advancedFilter, customFilters);

  return [
    {
      key: "today",
      label: "今天",
      emoji: "📅",
      filter: { kind: "today" },
      count: makeCount({ kind: "today" }),
    },
    {
      key: "recent7",
      label: "最近7天",
      emoji: "🕘",
      filter: { kind: "recent7" },
      count: makeCount({ kind: "recent7" }),
    },
    {
      key: "inbox",
      label: "收集箱",
      emoji: "📥",
      filter: { kind: "inbox" },
      count: makeCount({ kind: "inbox" }),
    },
    ...sortedFolders.map((folder) => {
      const filter: WidgetFilter = { kind: "folder", id: folder.id };
      return {
        key: sourceKeyForFilter(filter),
        label: folder.name,
        emoji: folder.emoji,
        filter,
        count: makeCount(filter),
      };
    }),
    ...activeLists.map((list) => {
      const filter: WidgetFilter = { kind: "list", id: list.id };
      return {
        key: sourceKeyForFilter(filter),
        label: list.name,
        emoji: list.emoji,
        filter,
        count: makeCount(filter),
      };
    }),
  ];
}

function groupSectionsForList(
  list: TodoList,
  listItems: TodoItem[],
  groups: TodoGroup[],
  allItems: TodoItem[],
  includeListName = false,
  includeEmptyGroups = false,
): WidgetSection[] {
  const listGroups = groups
    .filter((group) => group.listId === list.id)
    .sort(compareByOrderThenName);
  const groupIds = new Set(listGroups.map((group) => group.id));
  const itemById = new Map(allItems.map((item) => [item.id, item]));
  const effectiveGroupId = (item: TodoItem) => {
    let cursor = item;
    const seen = new Set<string>([item.id]);
    while (cursor.parentId) {
      const parent = itemById.get(cursor.parentId);
      if (!parent || parent.listId !== item.listId || seen.has(parent.id)) break;
      seen.add(parent.id);
      cursor = parent;
    }
    const groupId = cursor.groupId ?? item.groupId ?? null;
    return groupId != null && groupIds.has(groupId) ? groupId : null;
  };
  if (listGroups.length === 0) {
    return [
      {
        key: `list:${list.id}`,
        title: list.name,
        emoji: list.emoji,
        items: orderTodoItemsHierarchically(listItems, allItems),
      },
    ];
  }

  const sections: WidgetSection[] = [];
  const used = new Set<string>();
  for (const group of listGroups) {
    const groupItems = listItems.filter((item) => effectiveGroupId(item) === group.id);
    if (groupItems.length === 0 && !includeEmptyGroups) continue;
    groupItems.forEach((item) => used.add(item.id));
    sections.push({
      key: `group:${group.id}`,
      title: includeListName ? `${list.name} / ${group.name}` : group.name,
      emoji: includeListName ? list.emoji : undefined,
      items: orderTodoItemsHierarchically(groupItems, allItems),
    });
  }
  const ungrouped = listItems.filter((item) => !used.has(item.id));
  if (ungrouped.length > 0) {
    sections.push({
      key: `list:${list.id}:ungrouped`,
      title: list.name,
      emoji: list.emoji,
      items: orderTodoItemsHierarchically(ungrouped, allItems),
    });
  }
  return sections;
}

function buildSections(
  filter: WidgetFilter,
  visibleItems: TodoItem[],
  lists: TodoList[],
  groups: TodoGroup[],
  allItems: TodoItem[],
  activeOption: WidgetSourceOption,
): WidgetSection[] {
  if (filter.kind === "list") {
    const list = lists.find((entry) => entry.id === filter.id);
    if (!list) return [];
    return groupSectionsForList(list, visibleItems, groups, allItems, false, true);
  }

  if (filter.kind === "folder") {
    const folderLists = lists
      .filter((list) => list.folderId === filter.id && list.archivedAt == null)
      .sort(compareByOrderThenName);
    return folderLists.flatMap((list) =>
      groupSectionsForList(
        list,
        visibleItems.filter((item) => item.listId === list.id),
        groups,
        allItems,
        true,
      ).filter((section) => section.items.length > 0),
    );
  }

  if (filter.kind === "today" || filter.kind === "recent7") {
    const visibleListIds = new Set(visibleItems.map((item) => item.listId));
    const activeLists = lists
      .filter((list) => visibleListIds.has(list.id) && list.archivedAt == null)
      .sort(compareByOrderThenName);
    const sections = activeLists.flatMap((list) =>
      groupSectionsForList(
        list,
        visibleItems.filter((item) => item.listId === list.id),
        groups,
        allItems,
        true,
      ).filter((section) => section.items.length > 0),
    );
    if (sections.length > 0) return sections;
  }

  return [
    {
      key: filter.kind,
      title: activeOption.label,
      emoji: activeOption.emoji,
      items: visibleItems,
    },
  ];
}

function todoDepth(item: TodoItem, visibleIds: Set<string>, byId: Map<string, TodoItem>): number {
  let depth = 0;
  let cursor = item;
  const seen = new Set<string>([item.id]);
  while (cursor.parentId && visibleIds.has(cursor.parentId) && depth < 8) {
    const parent = byId.get(cursor.parentId);
    if (!parent || parent.listId !== item.listId || seen.has(parent.id)) break;
    seen.add(parent.id);
    cursor = parent;
    depth += 1;
  }
  return depth;
}

function shouldShowSectionHeader(
  activeFilter: WidgetFilter,
  activeOption: WidgetSourceOption,
  section: WidgetSection,
  sectionCount: number,
): boolean {
  if (sectionCount === 1 && section.title === activeOption.label) return false;
  if (activeFilter.kind === "list" && section.key === `list:${activeFilter.id}`) return false;
  return true;
}

export default function TodoWidgetWindow() {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const hydrate = useTodoStore((s) => s.hydrate);
  const reload = useTodoStore((s) => s.reload);
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const groups = useTodoStore((s) => s.groups);
  const items = useTodoStore((s) => s.items);
  const advancedFilter = useTodoStore((s) => s.advancedFilter);
  const customFilters = useTodoStore((s) => s.customFilters);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const todoFontFamily = useStore((s) => s.appSettings.todoFontFamily);
  const todoCheckboxShape = useStore((s) => s.appSettings.todoCheckboxShape);
  const todoColorThemeId = useStore((s) => s.appSettings.todoColorTheme);
  const todoColorThemes = useStore((s) => s.appSettings.todoColorThemes);
  const todoWidgetBackgroundOpacity = useStore(
    (s) => s.appSettings.todoWidgetBackgroundOpacity,
  );
  const [sourceKey, setSourceKey] = useState(readInitialSourceKey);
  const [pinned, setPinned] = useState(true);
  const [todoFonts, setTodoFonts] = useState<TodoFontEntry[]>([]);
  useTodoReminders();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    let cancelled = false;
    listTodoFonts()
      .then((fonts) => {
        if (cancelled) return;
        setTodoFonts(fonts);
        ensureTodoFontsRegistered(fonts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [todoFontFamily]);

  useEffect(() => {
    const previousHtmlBg = document.documentElement.style.backgroundColor;
    const previousBodyBg = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    return () => {
      document.documentElement.style.backgroundColor = previousHtmlBg;
      document.body.style.backgroundColor = previousBodyBg;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listen("todo:data-changed", () => {
      void reload();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        console.error("[todo-widget] listen todo:data-changed failed:", err);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reload]);

  const sourceOptions = useMemo(
    () => sourceOptionsFor(folders, lists, items, advancedFilter, customFilters),
    [advancedFilter, customFilters, folders, items, lists],
  );
  const activeOption = sourceOptions.find((option) => option.key === sourceKey) ?? sourceOptions[0];
  const activeFilter = activeOption?.filter ?? { kind: "today" as const };

  useEffect(() => {
    if (!activeOption && sourceOptions[0]) {
      setSourceKey(sourceOptions[0].key);
    }
  }, [activeOption, sourceOptions]);

  const visibleItems = useMemo(() => {
    const filtered = applyFilter(
      items,
      activeFilter,
      false,
      lists,
      advancedFilter,
      customFilters,
    ).filter((item) => item.status === "pending");
    return activeFilter.kind === "list" || activeFilter.kind === "folder"
      ? filtered
      : orderTodoItemsHierarchically(filtered, items);
  }, [activeFilter, advancedFilter, customFilters, items, lists]);

  const sections = useMemo(
    () => buildSections(activeFilter, visibleItems, lists, groups, items, activeOption),
    [activeFilter, activeOption, groups, items, lists, visibleItems],
  );
  const visibleIds = useMemo(() => new Set(visibleItems.map((item) => item.id)), [visibleItems]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const allTags = useMemo(() => collectAllTags(items), [items]);
  const quickAddList = useMemo(() => {
    if (activeFilter.kind === "list") {
      return lists.find((list) => list.id === activeFilter.id && list.archivedAt == null) ?? null;
    }
    if (activeFilter.kind !== "folder") return null;
    return (
      lists
        .filter((list) => list.folderId === activeFilter.id && list.archivedAt == null)
        .sort(compareByOrderThenName)[0] ?? null
    );
  }, [activeFilter, lists]);
  const quickAddFilter: TodoFilter =
    quickAddList != null ? { kind: "list", id: quickAddList.id } : activeFilter;
  const quickAddGroups = useMemo(
    () =>
      quickAddList
        ? groups
            .filter((group) => group.listId === quickAddList.id)
            .sort(compareByOrderThenName)
        : [],
    [groups, quickAddList],
  );

  const handleSourceChange = (nextKey: string) => {
    setSourceKey(nextKey);
    saveSourceKey(nextKey);
  };

  const togglePin = () => {
    const next = !pinned;
    getCurrentWindow().setAlwaysOnTop(next).then(() => setPinned(next)).catch(() => {});
  };

  const closeWidget = () => {
    getCurrentWebviewWindow().hide().catch(() => {});
  };
  const startHeaderDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-todo-widget-interactive]")) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  const todoColorTheme = useMemo(
    () => resolveTodoColorTheme(todoColorThemeId, todoColorThemes),
    [todoColorThemeId, todoColorThemes],
  );
  const panelBaseColor = isDark ? "#20293a" : todoColorTheme.surface;
  const panelBg = alpha(panelBaseColor, todoWidgetBackgroundOpacity);
  const panelBlur = todoWidgetBackgroundOpacity <= 0.2
    ? "none"
    : `blur(${Math.round(22 * todoWidgetBackgroundOpacity)}px) saturate(1.08)`;
  const hoverBg = alpha(theme.palette.primary.main, isDark ? 0.2 : 0.11);
  const widgetFontFamily = todoFontCssFamily(todoFontFamily, todoFonts);

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        p: 0,
        boxSizing: "border-box",
        bgcolor: "transparent",
        color: "text.primary",
        fontFamily: widgetFontFamily,
      }}
    >
      <Box
        sx={{
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: 1.6,
          border: 0,
          bgcolor: panelBg,
          backdropFilter: panelBlur,
          WebkitBackdropFilter: panelBlur,
          boxShadow: isDark
            ? `0 22px 70px ${alpha("#000000", Math.max(0.18, todoWidgetBackgroundOpacity * 0.42))}`
            : "0 22px 70px rgba(15, 23, 42, 0.18)",
        }}
      >
        <Box
          onMouseDown={startHeaderDrag}
          sx={{
            px: 1.6,
            pt: 1.1,
            pb: 0.9,
            display: "flex",
            alignItems: "center",
            gap: 1,
            userSelect: "none",
            flexShrink: 0,
            cursor: "move",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, minWidth: 0, flex: 1 }}>
            <Select
              data-todo-widget-interactive
              size="small"
              value={activeOption?.key ?? "today"}
              variant="standard"
              disableUnderline
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => handleSourceChange(String(event.target.value))}
              renderValue={(value) => {
                const option = sourceOptions.find((entry) => entry.key === value) ?? activeOption;
                return (
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.8, minWidth: 0 }}>
                    <TodoEmoji emoji={option?.emoji} fallback="📋" size={19} />
                    <Box
                      component="span"
                      sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {option?.label ?? ""}
                    </Box>
                  </Box>
                );
              }}
              sx={{
                minWidth: 0,
                maxWidth: "100%",
                color: "text.primary",
                fontSize: 15,
                fontWeight: 800,
                cursor: "pointer",
                "& .MuiSelect-select": {
                  py: 0.2,
                  pr: "24px !important",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
              }}
              MenuProps={{
                disablePortal: true,
                slotProps: {
                  paper: {
                    sx: {
                      maxHeight: 360,
                      borderRadius: 1.5,
                      bgcolor: isDark ? "#172033" : "#ffffff",
                    },
                  },
                },
              }}
            >
              {sourceOptions.map((option) => (
                <MenuItem
                  key={option.key}
                  value={option.key}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                    <TodoEmoji emoji={option.emoji} fallback="📋" size={16} />
                    <Box
                      component="span"
                      sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {option.label}
                    </Box>
                    <Box component="span" sx={{ ml: "auto", color: "text.secondary", fontSize: 12 }}>
                      {option.count}
                    </Box>
                  </Box>
                </MenuItem>
              ))}
            </Select>
            <Typography sx={{ fontSize: 12, color: "text.secondary", flexShrink: 0 }}>
              {visibleItems.length}
            </Typography>
          </Box>
          <Tooltip title={pinned ? "取消置顶" : "置顶"}>
            <IconButton
              data-todo-widget-interactive
              size="small"
              onClick={togglePin}
              sx={{ color: "text.secondary" }}
            >
              {pinned ? <PushPinRoundedIcon sx={{ fontSize: 16 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="隐藏">
            <IconButton
              data-todo-widget-interactive
              size="small"
              onClick={closeWidget}
              sx={{ color: "text.secondary" }}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ px: 1.2, pb: 1, flexShrink: 0 }}>
          <QuickAddTodoInput
            isDark={isDark}
            selectedFilter={quickAddFilter}
            groups={quickAddGroups}
            allTags={allTags}
            placeholder="准备做什么？"
            onAfterSubmit={(item) => setSelectedItemId(item.id)}
          />
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            px: 0.8,
            pb: 1,
            scrollbarWidth: "thin",
            scrollbarColor: `${alpha(theme.palette.text.primary, 0.22)} transparent`,
            "&::-webkit-scrollbar": { width: 8 },
            "&::-webkit-scrollbar-thumb": {
              borderRadius: 8,
              backgroundColor: alpha(theme.palette.text.primary, 0.18),
            },
          }}
        >
          {sections.length === 0 ? (
            <Box
              sx={{
                height: "100%",
                minHeight: 220,
                display: "grid",
                placeItems: "center",
                color: "text.secondary",
                fontSize: 13,
              }}
            >
              暂无待办
            </Box>
          ) : (
            sections.map((section) => {
              const showHeader = shouldShowSectionHeader(
                activeFilter,
                activeOption,
                section,
                sections.length,
              );
              return (
                <Box key={section.key} sx={{ mb: 1.2 }}>
                  {showHeader && (
                    <Box
                      sx={{
                        px: 0.8,
                        py: 0.45,
                        display: "flex",
                        alignItems: "center",
                        gap: 0.6,
                        color: "text.secondary",
                      }}
                    >
                      <TodoEmoji emoji={section.emoji} fallback="" size={14} />
                      <Typography
                        sx={{
                          minWidth: 0,
                          flex: 1,
                          fontSize: 12,
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {section.title}
                      </Typography>
                      <Typography sx={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                        {section.items.length}
                      </Typography>
                    </Box>
                  )}
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.35,
                      pt: showHeader ? 0 : 0.2,
                    }}
                  >
                    {section.items.length === 0 ? (
                      <Typography
                        sx={{
                          px: 0.8,
                          py: 0.5,
                          fontSize: 12,
                          color: "text.disabled",
                        }}
                      >
                        暂无待办
                      </Typography>
                    ) : (
                      section.items.map((item) => (
                        <WidgetTodoRow
                          key={item.id}
                          item={item}
                          depth={todoDepth(item, visibleIds, itemById)}
                          checkboxShape={todoCheckboxShape}
                          hoverBg={hoverBg}
                        />
                      ))
                    )}
                  </Box>
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    </Box>
  );
}

function WidgetTodoRow({
  item,
  depth,
  checkboxShape,
  hoverBg,
}: {
  item: TodoItem;
  depth: number;
  checkboxShape: "square" | "circle";
  hoverBg: string;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const setStatus = useTodoStore((s) => s.setStatus);
  const updateItem = useTodoStore((s) => s.updateItem);
  const setDueRange = useTodoStore((s) => s.setDueRange);
  const addItem = useTodoStore((s) => s.addItem);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [duePos, setDuePos] = useState<{ top: number; left: number } | null>(null);
  const [tagPos, setTagPos] = useState<{ top: number; left: number } | null>(null);
  const dueLabel = formatDueLabel(item);
  const dueOverdue =
    item.dueAt != null &&
    item.status !== "completed" &&
    item.status !== "abandoned" &&
    isDuePast(item.dueAt, item.dueEndAt);
  const dueTextColor = dueOverdue ? "error.main" : "primary.main";

  useEffect(() => {
    if (!editing) setDraft(item.content);
  }, [editing, item.content]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== item.content) {
      updateItem(item.id, { content: next });
    } else {
      setDraft(item.content);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(item.content);
    setEditing(false);
  };

  const onEditKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };
  const onContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedItemId(item.id);
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
  const createChild = () => {
    const child = addItem(item.listId, "", {
      parentId: item.id,
      allowEmpty: true,
      dueAt: item.dueAt,
      dueEndAt: item.dueEndAt,
      reminderEnabled: item.reminderEnabled,
    });
    if (child) setSelectedItemId(child.id);
  };

  return (
    <>
      <Box
        onClick={() => setSelectedItemId(item.id)}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={onContextMenu}
        sx={{
          minHeight: 34,
          display: "flex",
          alignItems: "center",
          gap: 0.7,
          pl: 0.4 + Math.min(depth, 6) * 1.45,
          pr: 0.8,
          py: 0.35,
          borderRadius: 1.2,
          color: "text.primary",
          bgcolor: "transparent",
          transition: "background-color 120ms ease",
          cursor: "default",
          "&:hover": { bgcolor: hoverBg },
        }}
      >
        <Checkbox
          size="small"
          checked={item.status === "completed"}
          onChange={(event) => {
            event.stopPropagation();
            setStatus(item.id, event.target.checked ? "completed" : "pending");
          }}
          sx={{
            width: 24,
            height: 24,
            p: 0,
            color: alpha(theme.palette.text.primary, isDark ? 0.52 : 0.46),
            "&.Mui-checked": { color: "primary.main" },
            "& .MuiSvgIcon-root": {
              fontSize: 19,
              borderRadius: checkboxShape === "circle" ? "50%" : 0.5,
            },
          }}
        />
        {editing ? (
          <Box
            component="input"
            value={draft}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commit}
            onKeyDown={onEditKeyDown}
            sx={{
              minWidth: 0,
              flex: 1,
              border: 0,
              outline: 0,
              bgcolor: "transparent",
              color: "text.primary",
              font: "inherit",
              fontSize: 13,
            }}
          />
        ) : (
          <Typography
            sx={{
              minWidth: 0,
              flex: 1,
              fontSize: 13,
              lineHeight: 1.35,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.content || "未命名待办"}
          </Typography>
        )}
        {dueLabel && (
          <Typography
            sx={{
              maxWidth: "42%",
              flexShrink: 0,
              px: 0.65,
              py: 0.2,
              borderRadius: 1,
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.35,
              color: dueTextColor,
              bgcolor: "transparent",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {dueLabel}
          </Typography>
        )}
      </Box>
      {contextMenu && (
        <ItemContextMenu
          item={item}
          anchor={contextMenu}
          onClose={() => setContextMenu(null)}
          onPickDueDate={(pos) => {
            setContextMenu(null);
            setDuePos(pos);
          }}
          onPickTags={(pos) => {
            setContextMenu(null);
            setTagPos(pos);
          }}
          onCreateChild={() => {
            setContextMenu(null);
            createChild();
          }}
        />
      )}
      {duePos && (
        <DueDatePopover
          anchorPosition={duePos}
          value={item.dueAt}
          endValue={item.dueEndAt}
          reminderEnabled={item.reminderEnabled}
          onClose={() => setDuePos(null)}
          onChange={(ts, endTs, reminderEnabled) =>
            setDueRange(item.id, ts, endTs ?? null, reminderEnabled)
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
    </>
  );
}
