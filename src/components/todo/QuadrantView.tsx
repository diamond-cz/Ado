import { useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Fab,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckBoxOutlinedIcon from "@mui/icons-material/CheckBoxOutlined";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
import { TODO_PRIORITY_OPTIONS, priorityMeta } from "./priority";

interface QuadrantViewProps {
  isDark: boolean;
  onOpenContextTarget: (target: TodoItemContextTarget) => void;
}

const MOBILE_QUADRANT_ORDER: TodoPriority[] = [
  "importantNotUrgent",
  "notImportantUrgent",
  "notImportantNotUrgent",
  "importantUrgent",
];
const MOBILE_QUADRANT_ORDER_KEY = "aebox.todo.mobileQuadrantOrder.v1";
const MOBILE_QUADRANT_ORDER_SET = new Set<TodoPriority>(MOBILE_QUADRANT_ORDER);

function isTodoPriority(value: unknown): value is TodoPriority {
  return typeof value === "string" && MOBILE_QUADRANT_ORDER_SET.has(value as TodoPriority);
}

function normalizeMobileQuadrantOrder(value: unknown): TodoPriority[] {
  const next: TodoPriority[] = [];
  const seen = new Set<TodoPriority>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isTodoPriority(entry) || seen.has(entry)) continue;
      next.push(entry);
      seen.add(entry);
    }
  }
  for (const priority of MOBILE_QUADRANT_ORDER) {
    if (!seen.has(priority)) next.push(priority);
  }
  return next;
}

function readMobileQuadrantOrder(): TodoPriority[] {
  try {
    const raw = localStorage.getItem(MOBILE_QUADRANT_ORDER_KEY);
    return normalizeMobileQuadrantOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return MOBILE_QUADRANT_ORDER;
  }
}

function saveMobileQuadrantOrder(order: TodoPriority[]) {
  try {
    localStorage.setItem(
      MOBILE_QUADRANT_ORDER_KEY,
      JSON.stringify(normalizeMobileQuadrantOrder(order)),
    );
  } catch {
    /* localStorage may be disabled */
  }
}

const QUADRANT_SUBTITLES: Record<TodoPriority, string> = {
  importantUrgent: "高优先级",
  importantNotUrgent: "中优先级",
  notImportantUrgent: "低优先级",
  notImportantNotUrgent: "无优先级",
};

const QUADRANT_EMPTY_HELP: Record<TodoPriority, string> = {
  importantUrgent: "记录必须马上处理的任务",
  importantNotUrgent: "记录值得持续投入的任务",
  notImportantUrgent: "记录低能量时做的任务",
  notImportantNotUrgent: "记录低能量时做的任务",
};

export function QuadrantView({ isDark, onOpenContextTarget }: QuadrantViewProps) {
  const theme = useTheme();
  const isMobileQuadrant = useMediaQuery(theme.breakpoints.down("sm"));
  const items = useTodoStore((s) => s.items);
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const groups = useTodoStore((s) => s.groups);
  const addItem = useTodoStore((s) => s.addItem);
  const updateItem = useTodoStore((s) => s.updateItem);
  const ensureDefaultList = useTodoStore((s) => s.ensureDefaultList);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const setStatus = useTodoStore((s) => s.setStatus);
  const [showCompleted, setShowCompleted] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<"grid" | "edit">("grid");
  const [activePriority, setActivePriority] = useState<TodoPriority | null>(null);
  const [addPriority, setAddPriority] = useState<TodoPriority | null>(null);
  const [mobileQuadrantOrder, setMobileQuadrantOrder] = useState<TodoPriority[]>(
    readMobileQuadrantOrder,
  );
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const draftTitleRef = useRef<HTMLInputElement | null>(null);
  const editDragSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 220, tolerance: 7 },
    }),
  );

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const listById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const archivedListIds = useMemo(
    () => new Set(lists.filter((list) => list.archivedAt != null).map((list) => list.id)),
    [lists],
  );

  const displayItems = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.deletedAt == null &&
            item.priority != null &&
            !archivedListIds.has(item.listId) &&
            (item.status === "pending" || (showCompleted && item.status === "completed")),
        )
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
          if (a.dueAt != null && b.dueAt != null) return a.dueAt - b.dueAt;
          if (a.dueAt != null) return -1;
          if (b.dueAt != null) return 1;
          return a.order - b.order;
        }),
    [archivedListIds, items, showCompleted],
  );

  const grouped = useMemo(() => {
    const base = TODO_PRIORITY_OPTIONS.reduce(
      (acc, option) => {
        acc[option.value] = [];
        return acc;
      },
      {} as Record<TodoPriority, TodoItemT[]>,
    );

    for (const item of displayItems) {
      if (item.priority != null) base[item.priority]?.push(item);
    }

    return TODO_PRIORITY_OPTIONS.reduce(
      (acc, option) => {
        acc[option.value] = orderQuadrantItemsHierarchically(base[option.value], items);
        return acc;
      },
      {} as Record<TodoPriority, TodoItemT[]>,
    );
  }, [displayItems, items]);

  const priorityByValue = useMemo(
    () => new Map(TODO_PRIORITY_OPTIONS.map((option) => [option.value, option])),
    [],
  );
  const mobileOptions = mobileQuadrantOrder.map((priority) => priorityByValue.get(priority)).filter(
    (option): option is (typeof TODO_PRIORITY_OPTIONS)[number] => Boolean(option),
  );
  const desktopOptions = TODO_PRIORITY_OPTIONS;
  const pageBg = isDark ? "#0f172a" : "#eef3f8";
  const cardBg = isDark ? alpha("#f8fafc", 0.06) : "#ffffff";
  const cardBorder = alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.035);

  const closeAddSheet = () => {
    setAddPriority(null);
    setDraftTitle("");
    setDraftNote("");
  };

  const openAddSheet = (priority: TodoPriority) => {
    setAddPriority(priority);
    setDraftTitle("");
    setDraftNote("");
    window.setTimeout(() => draftTitleRef.current?.focus(), 60);
  };

  const submitDraft = () => {
    if (!addPriority) return;
    const title = draftTitle.trim();
    if (!title) return;
    const item = addItem(ensureDefaultList(), title);
    if (item) {
      const patch: Partial<Omit<TodoItemT, "id" | "createdAt">> = {
        priority: addPriority,
      };
      const note = draftNote.trim();
      if (note) patch.note = note;
      updateItem(item.id, patch);
      setSelectedItemId(item.id);
      setActivePriority(addPriority);
    }
    closeAddSheet();
  };

  const renderMobileQuadrantTask = (item: TodoItemT) => {
    const completed = item.status === "completed";
    const list = listById.get(item.listId);
    const meta = priorityMeta(item.priority);
    return (
      <Box
        key={item.id}
        onClick={() => setSelectedItemId(item.id)}
        sx={{
          mx: 0.45,
          mb: 0.75,
          px: 0.8,
          py: 0.65,
          minWidth: 0,
          display: "flex",
          alignItems: "flex-start",
          gap: 0.65,
          borderRadius: 1.2,
          bgcolor: alpha(meta.color, isDark ? 0.18 : 0.13),
          borderLeft: `4px solid ${meta.color}`,
          overflow: "hidden",
        }}
      >
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            setStatus(item.id, completed ? "pending" : "completed");
          }}
          sx={{
            mt: 0.1,
            p: 0,
            width: 20,
            height: 20,
            color: completed ? "primary.main" : "text.secondary",
            flexShrink: 0,
          }}
        >
          <CheckBoxOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontSize: 13,
              lineHeight: 1.25,
              fontWeight: 650,
              color: completed ? "text.disabled" : "text.primary",
              textDecoration: completed ? "line-through" : "none",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
            }}
          >
            {item.content || "未命名待办"}
          </Typography>
          <Typography
            sx={{
              mt: 0.25,
              fontSize: 10.5,
              lineHeight: 1.2,
              color: "text.secondary",
              overflowWrap: "anywhere",
            }}
          >
            {list?.name || "默认"}
          </Typography>
        </Box>
      </Box>
    );
  };

  const renderTaskList = (priority: TodoPriority, compact = false) => {
    const quadrantItems = grouped[priority];
    if (quadrantItems.length === 0) {
      return (
        <Box
          sx={{
            height: "100%",
            minHeight: compact ? 92 : 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "text.secondary",
            textAlign: "center",
          }}
        >
          <Typography sx={{ fontSize: compact ? 14 : 15 }}>没有任务</Typography>
        </Box>
      );
    }

    return (
      <Box sx={{ py: compact ? 0.4 : 0.6 }} onClick={(event) => event.stopPropagation()}>
        {quadrantItems.map((item) => {
          if (compact && isMobileQuadrant) {
            return renderMobileQuadrantTask(item);
          }
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
        })}
      </Box>
    );
  };

  const menu = (
    <Menu
      open={Boolean(menuAnchor)}
      anchorEl={menuAnchor}
      onClose={() => setMenuAnchor(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        paper: {
          sx: {
            mt: 1,
            width: 304,
            maxWidth: "calc(100vw - 48px)",
            borderRadius: 3,
            boxShadow: isDark
              ? "0 22px 55px rgba(0,0,0,0.48)"
              : "0 22px 55px rgba(15,23,42,0.16)",
          },
        },
      }}
    >
      <MenuItem
        onClick={() => {
          setMode("edit");
          setActivePriority(null);
          setMenuAnchor(null);
        }}
        sx={{ minHeight: 58, gap: 2 }}
      >
        <EditOutlinedIcon sx={{ fontSize: 25 }} />
        <Typography sx={{ fontSize: 20 }}>编辑</Typography>
      </MenuItem>
      <MenuItem
        onClick={() => {
          setShowCompleted((show) => !show);
          setMenuAnchor(null);
        }}
        sx={{ minHeight: 58, gap: 2 }}
      >
        <CheckBoxOutlinedIcon sx={{ fontSize: 25 }} />
        <Typography sx={{ fontSize: 20 }}>
          {showCompleted ? "隐藏已完成" : "显示已完成"}
        </Typography>
      </MenuItem>
    </Menu>
  );

  const addSheet = addPriority ? (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        display: "flex",
        alignItems: "flex-end",
        bgcolor: alpha("#000000", 0.34),
      }}
      onClick={closeAddSheet}
    >
      <Box
        sx={{
          width: "100%",
          px: 2.4,
          pt: 2.1,
          pb: "max(18px, env(safe-area-inset-bottom))",
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
          bgcolor: isDark ? "#111827" : "#ffffff",
          boxShadow: "0 -18px 50px rgba(15,23,42,0.18)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <InputBase
          inputRef={draftTitleRef}
          fullWidth
          value={draftTitle}
          placeholder="准备做什么？"
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitDraft();
            } else if (event.key === "Escape") {
              closeAddSheet();
            }
          }}
          sx={{ fontSize: 19, fontWeight: 600 }}
        />
        <InputBase
          fullWidth
          multiline
          minRows={1}
          maxRows={4}
          value={draftNote}
          placeholder="描述"
          onChange={(event) => setDraftNote(event.target.value)}
          sx={{ mt: 1, fontSize: 16, color: "text.secondary" }}
        />
        <Box sx={{ mt: 2.2, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography sx={{ flex: 1, fontSize: 13, color: "text.secondary" }}>
            {priorityByValue.get(addPriority)?.label}
          </Typography>
          <Button
            variant="contained"
            onClick={submitDraft}
            disabled={!draftTitle.trim()}
            sx={{ borderRadius: 999, px: 2.2, textTransform: "none" }}
          >
            完成
          </Button>
        </Box>
      </Box>
    </Box>
  ) : null;

  const handleMobileQuadrantDragEnd = (event: DragEndEvent) => {
    const activeId = event.active.id;
    const overId = event.over?.id;
    if (!isTodoPriority(activeId) || !isTodoPriority(overId) || activeId === overId) return;
    const oldIndex = mobileQuadrantOrder.indexOf(activeId);
    const newIndex = mobileQuadrantOrder.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(mobileQuadrantOrder, oldIndex, newIndex);
    setMobileQuadrantOrder(next);
    saveMobileQuadrantOrder(next);
  };

  if (isMobileQuadrant && mode === "edit") {
    return (
      <Box sx={{ height: "100%", minHeight: 0, bgcolor: pageBg, color: "text.primary" }}>
        <Box
          sx={{
            height: 66,
            px: 1.2,
            display: "flex",
            alignItems: "center",
            gap: 0.8,
          }}
        >
          <IconButton onClick={() => setMode("grid")} sx={{ color: "text.primary" }}>
            <ArrowBackRoundedIcon sx={{ fontSize: 29 }} />
          </IconButton>
          <Typography sx={{ fontSize: 25, fontWeight: 800 }}>编辑四象限</Typography>
        </Box>
        <Box sx={{ px: 0.6, pt: 1.5 }}>
          <DndContext
            sensors={editDragSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleMobileQuadrantDragEnd}
          >
            <SortableContext items={mobileQuadrantOrder} strategy={verticalListSortingStrategy}>
              {mobileOptions.map((option) => (
                <SortableQuadrantEditRow
                  key={option.value}
                  option={option}
                  cardBg={cardBg}
                  subtitle={QUADRANT_SUBTITLES[option.value]}
                />
              ))}
            </SortableContext>
          </DndContext>
          <Typography
            sx={{
              mt: 1.2,
              px: 1.4,
              fontSize: 13,
              color: "text.secondary",
              textAlign: "center",
            }}
          >
            长按卡片并拖动可调整显示顺序
          </Typography>
        </Box>
      </Box>
    );
  }

  if (isMobileQuadrant && activePriority) {
    const option = priorityByValue.get(activePriority) ?? mobileOptions[0];
    return (
      <Box
        sx={{
          position: "relative",
          height: "100%",
          minHeight: 0,
          bgcolor: pageBg,
          color: "text.primary",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            height: 66,
            px: 1.2,
            display: "flex",
            alignItems: "center",
            gap: 0.8,
          }}
        >
          <IconButton onClick={() => setActivePriority(null)} sx={{ color: "text.primary" }}>
            <ArrowBackRoundedIcon sx={{ fontSize: 29 }} />
          </IconButton>
          <Typography sx={{ flex: 1, fontSize: 25, fontWeight: 800 }}>{option.label}</Typography>
          <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)}>
            <MoreVertRoundedIcon sx={{ fontSize: 27 }} />
          </IconButton>
        </Box>
        <Box sx={{ height: "calc(100% - 66px)", overflowY: "auto", px: 2.2, pb: 10 }}>
          {grouped[activePriority].length === 0 ? (
            <Box
              sx={{
                height: "100%",
                minHeight: 520,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
              }}
            >
              <EmptyQuadrantIllustration isDark={isDark} />
              <Typography sx={{ mt: 3, fontSize: 19, fontWeight: 800 }}>没有任务</Typography>
              <Typography sx={{ mt: 1.3, fontSize: 16, color: "text.secondary" }}>
                {QUADRANT_EMPTY_HELP[activePriority]}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ pt: 1 }}>{renderTaskList(activePriority)}</Box>
          )}
        </Box>
        <Fab
          color="primary"
          aria-label="添加任务"
          onClick={() => openAddSheet(activePriority)}
          sx={{ position: "absolute", right: 24, bottom: 24, width: 76, height: 76 }}
        >
          <AddRoundedIcon sx={{ fontSize: 42 }} />
        </Fab>
        {menu}
        {addSheet}
      </Box>
    );
  }

  if (isMobileQuadrant) {
    return (
      <Box
        sx={{
          position: "relative",
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          bgcolor: pageBg,
          color: "text.primary",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            flexShrink: 0,
            px: 2.4,
            pt: 1.5,
            pb: 2,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Typography sx={{ flex: 1, fontSize: 27, fontWeight: 800, lineHeight: 1.2 }}>
            四象限
          </Typography>
          <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)}>
            <MoreVertRoundedIcon sx={{ fontSize: 28, color: "text.primary" }} />
          </IconButton>
        </Box>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gridTemplateRows: "repeat(2, minmax(0, 1fr))",
            gap: 1.4,
            px: 1.6,
            pb: 1.7,
            overflow: "hidden",
          }}
        >
          {mobileOptions.map((option) => (
            <Box
              key={option.value}
              onClick={() => setActivePriority(option.value)}
              sx={{
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                borderRadius: 2.4,
                bgcolor: cardBg,
                border: `1px solid ${cardBorder}`,
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  flexShrink: 0,
                  px: 1.3,
                  pt: 1.15,
                  pb: 0.65,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.55,
                }}
              >
                <QuadrantBadge option={option} size={24} />
                <Typography
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    fontSize: 15,
                    fontWeight: 700,
                    color: option.color,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {option.label}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 0.5 }}>
                {renderTaskList(option.value, true)}
              </Box>
            </Box>
          ))}
        </Box>
        {menu}
        {addSheet}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "1fr 1fr" },
        gridTemplateRows: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(2, minmax(0, 1fr))" },
        gap: { xs: 0.7, md: 1 },
        p: { xs: 0.8, md: 1 },
        overflow: { xs: "hidden", md: "auto" },
      }}
    >
      {desktopOptions.map((option) => (
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
              px: { xs: 0.85, sm: 1.2 },
              py: { xs: 0.75, sm: 0.9 },
              display: "flex",
              alignItems: "center",
              gap: { xs: 0.55, sm: 0.8 },
              borderBottom: 1,
              borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
            }}
          >
            <QuadrantBadge option={option} size={24} />
            <Typography
              sx={{
                minWidth: 0,
                fontSize: { xs: 13, sm: 15 },
                fontWeight: 700,
                color: option.color,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {option.label}
            </Typography>
            <Typography sx={{ fontSize: { xs: 11, sm: 12 }, color: "text.secondary" }}>
              {grouped[option.value].length}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", py: { xs: 0.25, sm: 0.5 } }}>
            {renderTaskList(option.value, true)}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function SortableQuadrantEditRow({
  option,
  cardBg,
  subtitle,
}: {
  option: (typeof TODO_PRIORITY_OPTIONS)[number];
  cardBg: string;
  subtitle: string;
}) {
  const sortable = useSortable({ id: option.value });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.86 : 1,
    zIndex: sortable.isDragging ? 3 : undefined,
    position: "relative" as const,
  };

  return (
    <Box
      ref={sortable.setNodeRef}
      style={style}
      {...sortable.attributes}
      {...sortable.listeners}
      sx={{
        minHeight: 94,
        mb: 1.4,
        px: 1.8,
        display: "flex",
        alignItems: "center",
        gap: 1.4,
        borderRadius: 2.7,
        bgcolor: cardBg,
        boxShadow: sortable.isDragging ? "0 16px 34px rgba(15, 23, 42, 0.22)" : "none",
        touchAction: "none",
      }}
    >
      <QuadrantBadge option={option} size={26} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500 }}>{option.label}</Typography>
        <Typography sx={{ mt: 0.4, fontSize: 16, color: "text.secondary" }}>
          {subtitle}
        </Typography>
      </Box>
      <DragIndicatorRoundedIcon sx={{ fontSize: 25, color: "text.disabled" }} />
    </Box>
  );
}

function QuadrantBadge({
  option,
  size,
}: {
  option: (typeof TODO_PRIORITY_OPTIONS)[number];
  size: number;
}) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        bgcolor: option.color,
        fontSize: Math.max(9, size * 0.42),
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {option.emoji}
    </Box>
  );
}

function EmptyQuadrantIllustration({ isDark }: { isDark: boolean }) {
  return (
    <Box
      sx={{
        width: 210,
        height: 170,
        position: "relative",
        color: isDark ? "#93c5fd" : "#426bff",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: 20,
          right: 18,
          top: 22,
          bottom: 18,
          borderRadius: "42% 58% 48% 52%",
          bgcolor: alpha(isDark ? "#60a5fa" : "#c7d2fe", isDark ? 0.1 : 0.34),
          transform: "rotate(-10deg)",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          left: 66,
          top: 48,
          width: 68,
          height: 82,
          border: "2px solid currentColor",
          borderRadius: 1,
          transform: "rotate(-8deg)",
          bgcolor: alpha("#ffffff", isDark ? 0.02 : 0.42),
        }}
      >
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              position: "absolute",
              left: 13,
              top: 17 + index * 20,
              width: 12,
              height: 12,
              border: "2px solid currentColor",
              borderRadius: 0.4,
            }}
          />
        ))}
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              position: "absolute",
              left: 34,
              top: 21 + index * 20,
              width: 22,
              height: 4,
              borderRadius: 999,
              bgcolor: "currentColor",
              opacity: 0.85,
            }}
          />
        ))}
      </Box>
      <Box
        sx={{
          position: "absolute",
          right: 48,
          top: 55,
          width: 12,
          height: 84,
          borderRadius: 999,
          border: "2px solid currentColor",
          bgcolor: alpha("#ffffff", 0.28),
        }}
      />
    </Box>
  );
}

function compareQuadrantItems(a: TodoItemT, b: TodoItemT): number {
  if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
  if (a.dueAt != null && b.dueAt != null && a.dueAt !== b.dueAt) {
    return a.dueAt - b.dueAt;
  }
  if (a.dueAt != null) return -1;
  if (b.dueAt != null) return 1;
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
      key: `folder-${folder.id}`,
      label: folder.name,
      target: { kind: "folder", id: folder.id },
    });
  }
  if (list) {
    path.push({
      key: `list-${list.id}`,
      label: list.name,
      target: { kind: "list", id: list.id },
    });
  }
  if (group && list) {
    path.push({
      key: `group-${group.id}`,
      label: group.name,
      target: { kind: "group", id: group.id, listId: list.id },
    });
  }

  const meta = path.length > 0 ? path.map((part) => part.label).join(" / ") : "未归类";
  return { meta, tooltip: meta, path };
}

function effectiveQuadrantGroupId(
  item: TodoItemT,
  itemById: Map<string, TodoItemT>,
  groupById: Map<string, TodoGroup>,
): string | null {
  if (item.groupId != null && groupById.has(item.groupId)) return item.groupId;
  let cursor = item.parentId ? itemById.get(item.parentId) : null;
  while (cursor) {
    if (cursor.groupId != null && groupById.has(cursor.groupId)) return cursor.groupId;
    cursor = cursor.parentId ? itemById.get(cursor.parentId) : null;
  }
  return null;
}
