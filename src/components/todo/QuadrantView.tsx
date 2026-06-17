import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";

import { getTodoDepth, useTodoStore } from "./useTodoStore";
import type {
  TodoFolder,
  TodoGroup,
  TodoItem as TodoItemT,
  TodoList,
  TodoPriority,
} from "./types";
import {
  TodoItem,
  type TodoItemContextPathPart,
  type TodoItemContextTarget,
} from "./TodoItem";
import { TODO_PRIORITY_OPTIONS } from "./priority";

interface QuadrantViewProps {
  isDark: boolean;
  onOpenContextTarget: (target: TodoItemContextTarget) => void;
}

export function QuadrantView({ isDark, onOpenContextTarget }: QuadrantViewProps) {
  const items = useTodoStore((s) => s.items);
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const groups = useTodoStore((s) => s.groups);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const listById = new Map(lists.map((list) => [list.id, list]));
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const archivedListIds = new Set(
    lists.filter((list) => list.archivedAt != null).map((list) => list.id),
  );
  const pending = items
    .filter(
      (item) =>
        item.deletedAt == null &&
        item.status === "pending" &&
        !archivedListIds.has(item.listId),
    )
    .sort((a, b) => {
      if (a.dueAt != null && b.dueAt != null) return a.dueAt - b.dueAt;
      if (a.dueAt != null) return -1;
      if (b.dueAt != null) return 1;
      return a.order - b.order;
    });

  const grouped = TODO_PRIORITY_OPTIONS.reduce(
    (acc, option) => {
      acc[option.value] = [];
      return acc;
    },
    {} as Record<TodoPriority, TodoItemT[]>,
  );

  for (const item of pending) {
    if (item.priority != null) {
      grouped[item.priority]?.push(item);
    }
  }
  const orderedGrouped = TODO_PRIORITY_OPTIONS.reduce(
    (acc, option) => {
      acc[option.value] = orderQuadrantItemsHierarchically(grouped[option.value], items);
      return acc;
    },
    {} as Record<TodoPriority, TodoItemT[]>,
  );

  return (
    <Box
      sx={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        gridAutoRows: { xs: "minmax(280px, 1fr)", md: "minmax(0, 1fr)" },
        gap: 1,
        p: 1,
        overflow: "auto",
      }}
    >
      {TODO_PRIORITY_OPTIONS.map((option) => (
        <Box
          key={option.value}
          sx={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderRadius: 1,
            border: 1,
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
            bgcolor: alpha(isDark ? "#f8fafc" : "#ffffff", isDark ? 0.03 : 0.78),
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              flexShrink: 0,
              px: 1.2,
              py: 0.9,
              display: "flex",
              alignItems: "center",
              gap: 0.8,
              borderBottom: 1,
              borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
            }}
          >
            <Box
              sx={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                bgcolor: option.color,
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {option.emoji}
            </Box>
            <Typography sx={{ fontSize: 15, fontWeight: 700, color: option.color, flex: 1 }}>
              {option.label}
            </Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              {orderedGrouped[option.value].length}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", py: 0.5 }}>
            {orderedGrouped[option.value].length === 0 ? (
              <Box
                sx={{
                  height: "100%",
                  minHeight: 120,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "text.disabled",
                }}
              >
                <Typography sx={{ fontSize: 13 }}>没有任务</Typography>
              </Box>
            ) : (
              orderedGrouped[option.value].map((item) => {
                const context = buildQuadrantItemContext(item, {
                  folderById,
                  groupById,
                  itemById,
                  listById,
                });
                return (
                  <TodoItem
                    key={item.id}
                    item={item}
                    isDark={isDark}
                    draggable={false}
                    compactMeta
                    depth={getTodoDepth(item, items)}
                    contextMeta={context.meta}
                    contextTooltip={context.tooltip}
                    contextPath={context.path}
                    onOpenContextPath={onOpenContextTarget}
                  />
                );
              })
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function compareQuadrantItems(a: TodoItemT, b: TodoItemT): number {
  if (a.dueAt != null && b.dueAt != null && a.dueAt !== b.dueAt) {
    return a.dueAt - b.dueAt;
  }
  if (a.dueAt != null && b.dueAt == null) return -1;
  if (a.dueAt == null && b.dueAt != null) return 1;
  return a.order - b.order;
}

function orderQuadrantItemsHierarchically(
  quadrantItems: TodoItemT[],
  allItems: TodoItemT[],
): TodoItemT[] {
  const visibleIds = new Set(quadrantItems.map((item) => item.id));
  const itemById = new Map(allItems.map((item) => [item.id, item]));
  const childrenByParent = new Map<string | null, TodoItemT[]>();

  for (const item of quadrantItems) {
    const parent =
      item.parentId != null && visibleIds.has(item.parentId)
        ? itemById.get(item.parentId)
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
    bucket.sort(compareQuadrantItems);
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
  for (const item of quadrantItems) {
    if (!visited.has(item.id)) ordered.push(item);
  }
  return ordered;
}

function buildQuadrantItemContext(
  item: TodoItemT,
  maps: {
    folderById: Map<string, TodoFolder>;
    groupById: Map<string, TodoGroup>;
    itemById: Map<string, TodoItemT>;
    listById: Map<string, TodoList>;
  },
): { meta: string; tooltip: string; path: TodoItemContextPathPart[] } {
  const list = maps.listById.get(item.listId);
  const folder = list?.folderId ? maps.folderById.get(list.folderId) : null;
  const groupId = effectiveQuadrantGroupId(item, maps.itemById, maps.groupById);
  const group = groupId ? maps.groupById.get(groupId) : null;

  const path: TodoItemContextPathPart[] = [];
  if (folder) {
    path.push({
      key: `folder:${folder.id}`,
      label: `${folder.emoji} ${folder.name}`,
      target: { kind: "folder", id: folder.id },
    });
  }
  if (list) {
    path.push({
      key: `list:${list.id}`,
      label: `${list.emoji} ${list.name}`,
      target: { kind: "list", id: list.id },
    });
  } else {
    path.push({ key: `list:${item.listId}`, label: "Unknown list" });
  }
  if (group && list) {
    path.push({
      key: `group:${group.id}`,
      label: group.name,
      target: { kind: "group", id: group.id, listId: list.id },
    });
  }
  const meta = path.map((part) => part.label).join(" / ");
  const tooltip = `归属：${meta}`;
  return { meta, tooltip, path };
}

function effectiveQuadrantGroupId(
  item: TodoItemT,
  itemById: Map<string, TodoItemT>,
  groupById: Map<string, TodoGroup>,
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
  const group = groupId ? groupById.get(groupId) : null;
  return group && group.listId === item.listId ? group.id : null;
}
