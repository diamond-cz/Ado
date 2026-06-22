import {
  useRef,
  useMemo,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  Box,
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
  DragOverlay,
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
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
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
  renderAddInput: (groupId: string | null, onDone: () => void) => ReactNode;
  onMoveItem: (itemId: string, groupId: string | null) => void;
  onMakeChild: (itemId: string, parentId: string) => void;
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

function isTodoBoardItemCollision(collision: Collision) {
  return String(collision.id).startsWith("todo-board-item-target:");
}

function isTodoBoardGroupCollision(collision: Collision) {
  return String(collision.id).startsWith("todo-board-group:");
}

function prioritizeTodoBoardCollision(collisions: Collision[]) {
  const itemCollision = collisions.find(isTodoBoardItemCollision);
  if (itemCollision) return [itemCollision];

  const groupCollision = collisions.find(isTodoBoardGroupCollision);
  if (groupCollision) return [groupCollision];

  return collisions;
}

const todoBoardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return prioritizeTodoBoardCollision(pointerCollisions);
  }

  return prioritizeTodoBoardCollision(rectIntersection(args));
};

type TodoBoardTreeNode = {
  item: TodoItemT;
  children: TodoBoardTreeNode[];
  depth: number;
};

function buildTodoBoardTree(items: TodoItemT[]): TodoBoardTreeNode[] {
  const itemIds = new Set(items.map((item) => item.id));
  const childrenByParent = new Map<string | null, TodoItemT[]>();

  for (const item of items) {
    const parentId = item.parentId != null && itemIds.has(item.parentId) ? item.parentId : null;
    const bucket = childrenByParent.get(parentId) ?? [];
    bucket.push(item);
    childrenByParent.set(parentId, bucket);
  }

  const visit = (parentId: string | null, depth: number, path: Set<string>): TodoBoardTreeNode[] =>
    (childrenByParent.get(parentId) ?? []).map((item) => {
      if (path.has(item.id)) {
        return { item, children: [], depth };
      }
      const nextPath = new Set(path);
      nextPath.add(item.id);
      return {
        item,
        children: visit(item.id, depth + 1, nextPath),
        depth,
      };
    });

  return visit(null, 0, new Set());
}

function collectTodoBoardNodes(nodes: TodoBoardTreeNode[], target: Map<string, TodoBoardTreeNode>) {
  for (const node of nodes) {
    target.set(node.item.id, node);
    collectTodoBoardNodes(node.children, target);
  }
}

export function TodoBoardView({
  sections,
  isDark,
  showNotePreview,
  visibleChildParentIds,
  collapsedTodoIds,
  onToggleCollapsed,
  onExpand,
  renderAddInput,
  onMoveItem,
  onMakeChild,
  onRenameGroup,
  onDeleteGroup,
}: TodoBoardViewProps) {
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const [showBoardScrollbar, setShowBoardScrollbar] = useState(false);
  const [activeDragItemId, setActiveDragItemId] = useState<string | null>(null);
  const boardNodeById = useMemo(() => {
    const nodes = new Map<string, TodoBoardTreeNode>();
    for (const section of sections) {
      collectTodoBoardNodes(buildTodoBoardTree(section.items), nodes);
    }
    return nodes;
  }, [sections]);
  const activeDragNode = activeDragItemId ? boardNodeById.get(activeDragItemId) ?? null : null;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const onDragStart = (event: DragStartEvent) => {
    const dragData = event.active.data.current as TodoBoardDragData | undefined;
    setActiveDragItemId(dragData?.itemId ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveDragItemId(null);
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

  const handleBoardWheel = (event: WheelEvent<HTMLDivElement>) => {
    const node = boardScrollRef.current;
    if (!node || node.scrollWidth <= node.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    const scrollableList = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-todo-board-list]",
    );
    if (scrollableList) {
      const canScrollDown =
        event.deltaY > 0 &&
        scrollableList.scrollTop + scrollableList.clientHeight < scrollableList.scrollHeight - 1;
      const canScrollUp = event.deltaY < 0 && scrollableList.scrollTop > 0;
      if (canScrollDown || canScrollUp) return;
    }

    const maxScrollLeft = node.scrollWidth - node.clientWidth;
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, node.scrollLeft + event.deltaY));
    if (nextScrollLeft === node.scrollLeft) return;

    event.preventDefault();
    node.scrollLeft = nextScrollLeft;
  };

  const handleBoardMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const shouldShow = rect.bottom - event.clientY <= 18;
    setShowBoardScrollbar((current) => (current === shouldShow ? current : shouldShow));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={todoBoardCollisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveDragItemId(null)}
    >
      <Box
        ref={boardScrollRef}
        onWheel={handleBoardWheel}
        onMouseMove={handleBoardMouseMove}
        onMouseLeave={() => setShowBoardScrollbar(false)}
        sx={{
          flex: 1,
          height: "100%",
          minHeight: 0,
          px: 2,
          pb: 1.5,
          display: "flex",
          alignItems: "stretch",
          gap: 1.5,
          overflowX: "auto",
          overflowY: "hidden",
          overscrollBehaviorX: "contain",
          scrollbarGutter: "stable",
          scrollbarWidth: "thin",
          scrollbarColor: showBoardScrollbar
            ? `${alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.34 : 0.28)} transparent`
            : "transparent transparent",
          "&::-webkit-scrollbar": {
            height: 12,
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
          },
          "&::-webkit-scrollbar-thumb": {
            borderRadius: 999,
            border: "3px solid transparent",
            backgroundClip: "content-box",
            backgroundColor: showBoardScrollbar
              ? alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.34 : 0.28)
              : "transparent",
          },
          "&::-webkit-scrollbar-thumb:hover": {
            backgroundColor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.52 : 0.42),
          },
        }}
      >
        {sections.map((section) => (
          <TodoBoardColumn
            key={section.key}
            section={section}
            isDark={isDark}
            showNotePreview={showNotePreview}
            visibleChildParentIds={visibleChildParentIds}
            collapsedTodoIds={collapsedTodoIds}
            activeDragItemId={activeDragItemId}
            onToggleCollapsed={onToggleCollapsed}
            onExpand={onExpand}
            renderAddInput={renderAddInput}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
          />
        ))}
      </Box>
      <DragOverlay dropAnimation={null} zIndex={3000}>
        {activeDragNode ? (
          <TodoBoardDragPreview
            node={activeDragNode}
            isDark={isDark}
            showNotePreview={showNotePreview}
            visibleChildParentIds={visibleChildParentIds}
            collapsedTodoIds={collapsedTodoIds}
            onToggleCollapsed={onToggleCollapsed}
            onExpand={onExpand}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

interface TodoBoardColumnProps {
  section: TodoBoardSection;
  isDark: boolean;
  showNotePreview: boolean;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  activeDragItemId: string | null;
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
  visibleChildParentIds,
  collapsedTodoIds,
  activeDragItemId,
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
  const rootNodes = useMemo(() => buildTodoBoardTree(section.items), [section.items]);

  return (
    <Box
      ref={droppable.setNodeRef}
      sx={{
        flex: "0 0 clamp(300px, 28vw, 380px)",
        width: "clamp(300px, 28vw, 380px)",
        minWidth: 0,
        maxWidth: "calc(100vw - 48px)",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
        border: 0,
        bgcolor: droppable.isOver
          ? alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.1 : 0.06)
          : "transparent",
        overflow: "hidden",
        transition: "background-color 120ms ease",
      }}
    >
      <Box
        sx={{
          height: 42,
          px: 1.2,
          display: "flex",
          alignItems: "center",
          gap: 0.7,
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
        data-todo-board-list
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          px: 0.4,
          pb: 0.7,
        }}
      >
        {rootNodes.map((node) => (
          <TodoBoardItemCard
            key={node.item.id}
            node={node}
            groupId={groupId}
            isDark={isDark}
            showNotePreview={showNotePreview}
            visibleChildParentIds={visibleChildParentIds}
            collapsedTodoIds={collapsedTodoIds}
            activeDragItemId={activeDragItemId}
            onToggleCollapsed={onToggleCollapsed}
            onExpand={onExpand}
          />
        ))}
      </Box>
    </Box>
  );
}

interface TodoBoardItemCardProps {
  node: TodoBoardTreeNode;
  groupId: string | null;
  isDark: boolean;
  showNotePreview: boolean;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  activeDragItemId: string | null;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
}

function TodoBoardItemCard({
  node,
  groupId,
  isDark,
  showNotePreview,
  visibleChildParentIds,
  collapsedTodoIds,
  activeDragItemId,
  onToggleCollapsed,
  onExpand,
}: TodoBoardItemCardProps) {
  return (
    <TodoBoardItemRow
      node={node}
      groupId={groupId}
      isDark={isDark}
      showNotePreview={showNotePreview}
      visibleChildParentIds={visibleChildParentIds}
      collapsedTodoIds={collapsedTodoIds}
      activeDragItemId={activeDragItemId}
      onToggleCollapsed={onToggleCollapsed}
      onExpand={onExpand}
    />
  );
}

interface TodoBoardItemRowProps extends TodoBoardItemCardProps {}

function TodoBoardItemRow({
  node,
  groupId,
  isDark,
  showNotePreview,
  visibleChildParentIds,
  collapsedTodoIds,
  activeDragItemId,
  onToggleCollapsed,
  onExpand,
}: TodoBoardItemRowProps) {
  const { item, children, depth } = node;
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
  const isActiveDragSource = activeDragItemId === item.id;
  const transform = draggable.transform && !isActiveDragSource
    ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`
    : undefined;
  const isDropTarget = droppable.isOver && !draggable.isDragging;
  const dragHandleProps = {
    ...draggable.attributes,
    ...draggable.listeners,
  } as HTMLAttributes<HTMLDivElement>;
  const clampedDepth = Math.min(depth, 5);
  const rowContent = (
    <TodoItem
      item={item}
      isDark={isDark}
      draggable={false}
      depth={depth}
      showNotePreview={showNotePreview}
      hasChildren={visibleChildParentIds.has(item.id)}
      collapsed={collapsedTodoIds.has(item.id)}
      onToggleCollapsed={onToggleCollapsed}
      onExpand={onExpand}
      disableOuterMargin
      flushOuterSpacing
      dragHandleProps={dragHandleProps}
    />
  );
  const childRows = children.map((child) => (
    <TodoBoardItemRow
      key={child.item.id}
      node={child}
      groupId={groupId}
      isDark={isDark}
      showNotePreview={showNotePreview}
      visibleChildParentIds={visibleChildParentIds}
      collapsedTodoIds={collapsedTodoIds}
      activeDragItemId={activeDragItemId}
      onToggleCollapsed={onToggleCollapsed}
      onExpand={onExpand}
    />
  ));

  if (depth === 0) {
    return (
      <Box
        ref={setNodeRef}
        style={{ transform }}
        sx={{
          mx: 0.6,
          my: 0.85,
          borderRadius: 2,
          border: 1,
          borderColor: isDropTarget
            ? alpha(isDark ? "#93c5fd" : "#2563eb", isDark ? 0.72 : 0.62)
            : alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.16 : 0.1),
          bgcolor: isDropTarget
            ? alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.18 : 0.09)
            : isDark
              ? alpha("#020617", 0.38)
              : alpha("#ffffff", 0.96),
          boxShadow: isDark
            ? "0 10px 24px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.04)"
            : "0 8px 18px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
          cursor: "default",
          opacity: isActiveDragSource ? 0 : 1,
          overflow: "hidden",
          position: "relative",
          transition: draggable.isDragging
            ? undefined
            : "background-color 120ms ease, box-shadow 120ms ease, border-color 120ms ease, opacity 120ms ease",
          "&:hover": {
            borderColor: isDropTarget
              ? alpha(isDark ? "#93c5fd" : "#2563eb", isDark ? 0.72 : 0.62)
              : alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.24 : 0.16),
            boxShadow: isDark
              ? "0 12px 28px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)"
              : "0 10px 22px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.95)",
          },
        }}
      >
        {rowContent}
        {childRows}
      </Box>
    );
  }

  return (
    <>
      <Box
        ref={setNodeRef}
        style={{ transform }}
        sx={{
          pl: clampedDepth === 0 ? 0 : 1.8 + clampedDepth * 1.6,
          position: "relative",
          opacity: isActiveDragSource ? 0 : 1,
          transition: draggable.isDragging
            ? undefined
            : "background-color 120ms ease, opacity 120ms ease",
          bgcolor: isDropTarget
            ? alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.18 : 0.09)
            : "transparent",
          "&::before":
            clampedDepth > 0
              ? {
                  content: '""',
                  position: "absolute",
                  left: 10 + clampedDepth * 8,
                  top: 9,
                  bottom: 9,
                  width: 2,
                  borderRadius: 999,
                  bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.14 : 0.08),
                  pointerEvents: "none",
                }
              : undefined,
        }}
      >
        {rowContent}
      </Box>
      {childRows}
    </>
  );
}

interface TodoBoardDragPreviewProps {
  node: TodoBoardTreeNode;
  isDark: boolean;
  showNotePreview: boolean;
  visibleChildParentIds: Set<string>;
  collapsedTodoIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onExpand: (id: string) => void;
}

function TodoBoardDragPreview({
  node,
  isDark,
  showNotePreview,
  visibleChildParentIds,
  collapsedTodoIds,
  onToggleCollapsed,
  onExpand,
}: TodoBoardDragPreviewProps) {
  return (
    <Box
      sx={{
        width: "clamp(300px, 28vw, 380px)",
        maxWidth: "calc(100vw - 48px)",
        borderRadius: 2,
        border: 1,
        borderColor: alpha(isDark ? "#93c5fd" : "#2563eb", isDark ? 0.46 : 0.32),
        bgcolor: isDark ? alpha("#020617", 0.92) : alpha("#ffffff", 0.98),
        boxShadow: isDark
          ? "0 18px 42px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.06)"
          : "0 18px 42px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.95)",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <TodoBoardDragPreviewRow
        node={node}
        isDark={isDark}
        showNotePreview={showNotePreview}
        visibleChildParentIds={visibleChildParentIds}
        collapsedTodoIds={collapsedTodoIds}
        onToggleCollapsed={onToggleCollapsed}
        onExpand={onExpand}
      />
    </Box>
  );
}

function TodoBoardDragPreviewRow({
  node,
  isDark,
  showNotePreview,
  visibleChildParentIds,
  collapsedTodoIds,
  onToggleCollapsed,
  onExpand,
}: TodoBoardDragPreviewProps) {
  const clampedDepth = Math.min(node.depth, 5);

  return (
    <>
      <Box
        sx={{
          pl: clampedDepth === 0 ? 0 : 1.8 + clampedDepth * 1.6,
          position: "relative",
          "&::before":
            clampedDepth > 0
              ? {
                  content: '""',
                  position: "absolute",
                  left: 10 + clampedDepth * 8,
                  top: 9,
                  bottom: 9,
                  width: 2,
                  borderRadius: 999,
                  bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.14 : 0.08),
                }
              : undefined,
        }}
      >
        <TodoItem
          item={node.item}
          isDark={isDark}
          draggable={false}
          depth={node.depth}
          showNotePreview={showNotePreview}
          hasChildren={visibleChildParentIds.has(node.item.id)}
          collapsed={collapsedTodoIds.has(node.item.id)}
          onToggleCollapsed={onToggleCollapsed}
          onExpand={onExpand}
          disableOuterMargin
          flushOuterSpacing
          forceDragHandleVisible
        />
      </Box>
      {node.children.map((child) => (
        <TodoBoardDragPreviewRow
          key={child.item.id}
          node={child}
          isDark={isDark}
          showNotePreview={showNotePreview}
          visibleChildParentIds={visibleChildParentIds}
          collapsedTodoIds={collapsedTodoIds}
          onToggleCollapsed={onToggleCollapsed}
          onExpand={onExpand}
        />
      ))}
    </>
  );
}
