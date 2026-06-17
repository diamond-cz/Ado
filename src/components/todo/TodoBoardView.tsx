import { useState, type HTMLAttributes, type ReactNode } from "react";
import {
  Box,
  Button,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

import type { TodoGroup, TodoItem as TodoItemT } from "./types";
import { TodoItem } from "./TodoItem";

export interface TodoBoardSection {
  key: string;
  group: TodoGroup | null;
  title: string;
  items: TodoItemT[];
  itemCount: number;
}

interface TodoBoardViewProps {
  sections: TodoBoardSection[];
  isDark: boolean;
  showNotePreview: boolean;
  getDepth: (item: TodoItemT) => number;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
  renderAddInput: (groupId: string | null, onDone: () => void) => ReactNode;
  onMoveItem: (itemId: string, groupId: string | null) => void;
  onMakeChild: (itemId: string, parentId: string) => void;
  onCreateGroup: () => void;
  onRenameGroup: (group: TodoGroup) => void;
  onDeleteGroup: (group: TodoGroup) => void;
}

type TodoBoardDragData = {
  itemId?: string;
  groupId?: string | null;
  parentId?: string | null;
};

type TodoBoardDropData =
  | {
      kind: "group";
      groupId: string | null;
    }
  | {
      kind: "item";
      targetItemId: string;
      groupId: string | null;
    };

export function TodoBoardView({
  sections,
  isDark,
  showNotePreview,
  getDepth,
  visibleChildParentIds,
  collapsedTodoIds,
  onToggleCollapsed,
  onExpand,
  renderAddInput,
  onMoveItem,
  onMakeChild,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
}: TodoBoardViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const dragData = event.active.data.current as TodoBoardDragData | undefined;
    const dropData = event.over?.data.current as TodoBoardDropData | undefined;
    const itemId = dragData?.itemId;
    if (!itemId || !dropData) return;

    if (dropData.kind === "item") {
      if (dropData.targetItemId !== itemId) {
        onMakeChild(itemId, dropData.targetItemId);
      }
      return;
    }

    const fromGroupId = dragData.groupId ?? null;
    const toGroupId = dropData.groupId ?? null;
    const fromParentId = dragData.parentId ?? null;
    if (fromGroupId !== toGroupId || fromParentId != null) {
      onMoveItem(itemId, toGroupId);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <Box
        sx={{
          minHeight: 0,
          px: 2,
          pb: 2,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          alignItems: "flex-start",
          gap: 1.5,
          overflowX: "hidden",
          overflowY: "auto",
        }}
      >
        {sections.map((section) => (
          <TodoBoardColumn
            key={section.key}
            section={section}
            isDark={isDark}
            showNotePreview={showNotePreview}
            getDepth={getDepth}
            visibleChildParentIds={visibleChildParentIds}
            collapsedTodoIds={collapsedTodoIds}
            onToggleCollapsed={onToggleCollapsed}
            onExpand={onExpand}
            renderAddInput={renderAddInput}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
          />
        ))}
        <Box
          sx={{
            width: "100%",
            minWidth: 0,
            pt: 0.4,
          }}
        >
          <Button
            fullWidth
            variant="outlined"
            startIcon={<AddRoundedIcon />}
            onClick={onCreateGroup}
            sx={{
              height: 36,
              justifyContent: "flex-start",
              borderRadius: 1,
              borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.14),
              bgcolor: alpha(isDark ? "#f8fafc" : "#ffffff", isDark ? 0.04 : 0.7),
              color: "text.secondary",
            }}
          >
            新分组
          </Button>
        </Box>
      </Box>
    </DndContext>
  );
}

interface TodoBoardColumnProps {
  section: TodoBoardSection;
  isDark: boolean;
  showNotePreview: boolean;
  getDepth: (item: TodoItemT) => number;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
  renderAddInput: (groupId: string | null, onDone: () => void) => ReactNode;
  onRenameGroup: (group: TodoGroup) => void;
  onDeleteGroup: (group: TodoGroup) => void;
}

function TodoBoardColumn({
  section,
  isDark,
  showNotePreview,
  getDepth,
  visibleChildParentIds,
  collapsedTodoIds,
  onToggleCollapsed,
  onExpand,
  renderAddInput,
  onRenameGroup,
  onDeleteGroup,
}: TodoBoardColumnProps) {
  const droppable = useDroppable({
    id: `todo-board-group:${section.group?.id ?? "ungrouped"}`,
    data: { kind: "group", groupId: section.group?.id ?? null } satisfies TodoBoardDropData,
  });
  const [adding, setAdding] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const groupId = section.group?.id ?? null;

  return (
    <Box
      ref={droppable.setNodeRef}
      sx={{
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 1,
        border: 1,
        borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.12 : 0.08),
        bgcolor: droppable.isOver
          ? alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.12 : 0.08)
          : alpha(isDark ? "#f8fafc" : "#f8fafc", isDark ? 0.045 : 0.68),
        overflow: "hidden",
        transition: "background-color 120ms ease, border-color 120ms ease",
      }}
    >
      <Box
        sx={{
          height: 42,
          px: 1.2,
          display: "flex",
          alignItems: "center",
          gap: 0.7,
          borderBottom: 1,
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.06),
          flexShrink: 0,
        }}
      >
        <Typography
          title={section.title}
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 14,
            fontWeight: 700,
            color: "text.primary",
          }}
        >
          {section.title}
        </Typography>
        <Typography sx={{ fontSize: 12, color: "text.disabled", flexShrink: 0 }}>
          {section.itemCount}
        </Typography>
        <Tooltip title="新任务">
          <IconButton
            size="small"
            onClick={() => setAdding(true)}
            sx={{ width: 24, height: 24, color: "text.secondary", flexShrink: 0 }}
          >
            <AddRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        {section.group && (
          <>
            <Tooltip title="分组菜单">
              <IconButton
                size="small"
                onClick={(event) => setMenuAnchor(event.currentTarget)}
                sx={{ width: 24, height: 24, color: "text.secondary", flexShrink: 0 }}
              >
                <MoreHorizRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Menu
              open={Boolean(menuAnchor)}
              anchorEl={menuAnchor}
              onClose={() => setMenuAnchor(null)}
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
          </>
        )}
      </Box>
      {adding && (
        <Box sx={{ p: 1, flexShrink: 0 }}>
          {renderAddInput(groupId, () => setAdding(false))}
        </Box>
      )}
      <Box
        sx={{
          maxHeight: 360,
          minHeight: 0,
          overflowY: "auto",
          px: 0.4,
          pb: 0.7,
        }}
      >
        {section.items.length === 0 ? (
          <Typography sx={{ px: 1, py: 0.75, fontSize: 12, color: "text.disabled" }}>
            暂无待办
          </Typography>
        ) : (
          section.items.map((item) => (
            <TodoBoardItemCard
              key={item.id}
              item={item}
              groupId={groupId}
              isDark={isDark}
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
    </Box>
  );
}

interface TodoBoardItemCardProps {
  item: TodoItemT;
  groupId: string | null;
  isDark: boolean;
  depth: number;
  showNotePreview: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
}

function TodoBoardItemCard({
  item,
  groupId,
  isDark,
  depth,
  showNotePreview,
  hasChildren,
  collapsed,
  onToggleCollapsed,
  onExpand,
}: TodoBoardItemCardProps) {
  const draggable = useDraggable({
    id: `todo-board-item:${item.id}`,
    data: { itemId: item.id, groupId, parentId: item.parentId ?? null },
  });
  const droppable = useDroppable({
    id: `todo-board-item-target:${item.id}`,
    data: { kind: "item", targetItemId: item.id, groupId } satisfies TodoBoardDropData,
  });
  const setNodeRef = (node: HTMLDivElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  const transform = draggable.transform
    ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`
    : undefined;
  const isDropTarget = droppable.isOver && !draggable.isDragging;
  const clampedDepth = Math.min(depth, 5);
  const dragHandleProps = {
    ...draggable.attributes,
    ...draggable.listeners,
  } as HTMLAttributes<HTMLDivElement>;

  return (
    <Box
      ref={setNodeRef}
      style={{ transform }}
      sx={{
        ml: 0.6 + clampedDepth * 2.4,
        mr: 0.6,
        my: 0.7,
        borderRadius: 2,
        border: 1,
        borderColor: isDropTarget
          ? alpha(isDark ? "#93c5fd" : "#2563eb", isDark ? 0.72 : 0.62)
          : alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.18 : 0.12),
        bgcolor: isDropTarget
          ? alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.18 : 0.1)
          : isDark
            ? alpha("#020617", 0.34)
            : "#ffffff",
        boxShadow: isDark
          ? "0 10px 24px rgba(0, 0, 0, 0.22)"
          : "0 8px 18px rgba(15, 23, 42, 0.08)",
        cursor: "default",
        opacity: draggable.isDragging ? 0.78 : 1,
        overflow: "hidden",
        position: "relative",
        transition: draggable.isDragging
          ? undefined
          : "background-color 120ms ease, box-shadow 120ms ease, border-color 120ms ease, opacity 120ms ease",
        "&::before":
          clampedDepth > 0
            ? {
                content: '""',
                position: "absolute",
                left: 0,
                top: 8,
                bottom: 8,
                width: 3,
                borderRadius: 999,
                bgcolor: alpha(isDark ? "#93c5fd" : "#2563eb", isDark ? 0.5 : 0.38),
              }
            : undefined,
        "&:hover": {
          borderColor: isDropTarget
            ? alpha(isDark ? "#93c5fd" : "#2563eb", isDark ? 0.72 : 0.62)
            : alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.26 : 0.18),
          bgcolor: isDropTarget
            ? alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.18 : 0.1)
            : alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.13 : 0.07),
          boxShadow: isDark
            ? "0 12px 28px rgba(0, 0, 0, 0.28)"
            : "0 10px 22px rgba(15, 23, 42, 0.12)",
        },
      }}
    >
      <TodoItem
        item={item}
        isDark={isDark}
        draggable={false}
        depth={depth}
        showNotePreview={showNotePreview}
        hasChildren={hasChildren}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        onExpand={onExpand}
        disableOuterMargin
        flushOuterSpacing
        dragHandleProps={dragHandleProps}
      />
    </Box>
  );
}
