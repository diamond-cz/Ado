// Todo list types — mirror of the Rust shapes in
// `src-tauri/src/commands/todos.rs`. Kept in this folder so all todo
// code stays co-located.

export type TodoStatus = "pending" | "completed" | "abandoned";
export type TodoPriority =
  | "importantUrgent"
  | "importantNotUrgent"
  | "notImportantUrgent"
  | "notImportantNotUrgent";
export type TodoTimeFilter =
  | "all"
  | "overdue"
  | "today"
  | "thisWeek"
  | "customRange"
  | "noDue";
export type TodoMarkedFilter = "all" | "marked" | "unmarked";
export type TodoFilterLogic = "and" | "or";

export interface AdvancedTodoFilter {
  listId: string;
  keyword: string;
  time: TodoTimeFilter;
  timeRangeStart: number | null;
  timeRangeEnd: number | null;
  priority: TodoPriority | "all";
  tag: string;
  marked: TodoMarkedFilter;
  status: TodoStatus | "all";
  logic: TodoFilterLogic;
}

export interface TodoList {
  id: string;
  name: string;
  emoji: string;
  folderId: string | null;
  order: number;
  createdAt: number;
  archivedAt: number | null;
}

export interface TodoFolder {
  id: string;
  name: string;
  emoji: string;
  order: number;
  createdAt: number;
}

export interface TodoGroup {
  id: string;
  listId: string;
  name: string;
  order: number;
  createdAt: number;
}

export interface TodoItem {
  id: string;
  listId: string;
  content: string;
  status: TodoStatus;
  dueAt: number | null;
  dueEndAt: number | null;
  reminderEnabled: boolean;
  parentId: string | null;
  groupId: string | null;
  predecessorId: string | null;
  marked: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  note: string;
  deletedAt: number | null;
  // Free-form labels. Stored as plain strings; the same label name is
  // shared across items by string equality (no separate registry).
  tags: string[];
  priority: TodoPriority | null;
  progress: number;
}

export interface SavedTodoFilter {
  id: string;
  name: string;
  criteria: AdvancedTodoFilter;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface TodoData {
  version: number;
  folders: TodoFolder[];
  lists: TodoList[];
  groups: TodoGroup[];
  items: TodoItem[];
  customFilters: SavedTodoFilter[];
  defaultListId: string | null;
}

// `kind: "list"` points at a real user-defined list by id; the rest are
// virtual filters that read across every list.
export type TodoFilter =
  | { kind: "folder"; id: string }
  | { kind: "list"; id: string }
  | { kind: "recent7" }
  | { kind: "today" }
  | { kind: "inbox" }
  | { kind: "marked" }
  | { kind: "tag"; tag: string }
  | { kind: "advanced" }
  | { kind: "customFilter"; id: string }
  | { kind: "quadrant" }
  | { kind: "calendar" }
  | { kind: "completed" }
  | { kind: "abandoned" }
  | { kind: "trash" };

// Secondary filter applied within the detail pane (right of the sidebar
// filter). `all` is the no-op default; the rest narrow by due-date or
// tag. Stored on the store so it persists while the user clicks
// between sidebar entries and is reset when they jump to a new list.
export type DetailFilter =
  | { kind: "all" }
  | { kind: "overdue" }
  | { kind: "today" }
  | { kind: "thisWeek" }
  | { kind: "noDue" }
  | { kind: "tag"; tag: string };
