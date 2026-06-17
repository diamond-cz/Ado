import type { TodoPriority } from "./types";

export const TODO_PRIORITY_OPTIONS: {
  value: TodoPriority;
  label: string;
  shortLabel: string;
  color: string;
  emoji: string;
}[] = [
  {
    value: "importantUrgent",
    label: "重要且紧急",
    shortLabel: "重要紧急",
    color: "#ef6f8f",
    emoji: "I",
  },
  {
    value: "importantNotUrgent",
    label: "重要不紧急",
    shortLabel: "重要不急",
    color: "#f2b84b",
    emoji: "II",
  },
  {
    value: "notImportantUrgent",
    label: "不重要但紧急",
    shortLabel: "不重要紧急",
    color: "#5b7ee5",
    emoji: "III",
  },
  {
    value: "notImportantNotUrgent",
    label: "不重要不紧急",
    shortLabel: "不重要不急",
    color: "#5dd6a0",
    emoji: "IV",
  },
];

export const NO_PRIORITY_META = {
  label: "无优先级",
  shortLabel: "无",
  color: "#64748b",
  emoji: "无",
};

export function priorityMeta(priority: TodoPriority | null | undefined) {
  if (priority == null) return NO_PRIORITY_META;
  return (
    TODO_PRIORITY_OPTIONS.find((option) => option.value === priority) ??
    NO_PRIORITY_META
  );
}
