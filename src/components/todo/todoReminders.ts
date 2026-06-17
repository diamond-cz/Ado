import { useEffect } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import type { TodoItem } from "./types";
import { useTodoStore } from "./useTodoStore";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

type ReminderKind = "start" | "end";

interface TodoNotificationOptions {
  id: string | number;
  title: string;
  body: string;
  group?: string;
}

export async function ensureTodoReminderPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;

  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch (error) {
    console.warn("Failed to request todo reminder notification permission", error);
    return false;
  }
}

function formatReminderTime(ts: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

function notificationBody(item: TodoItem, kind: ReminderKind, ts: number): string {
  const prefix =
    kind === "end"
      ? "时间段结束"
      : item.dueEndAt != null && item.dueEndAt > (item.dueAt ?? 0)
        ? "时间段开始"
        : "截止时间";
  return `${prefix}：${formatReminderTime(ts)}\n${item.content}`;
}

function shouldFireReminder(item: TodoItem, kind: ReminderKind, ts: number): boolean {
  if (!item.reminderEnabled || item.deletedAt != null || item.status !== "pending") {
    return false;
  }
  if (kind === "start") return item.dueAt === ts;
  return item.dueAt != null && item.dueEndAt === ts && item.dueEndAt > item.dueAt;
}

function notificationIdFromString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash & 0x7fffffff;
}

export async function showTodoNotification({
  id,
  title,
  body,
  group = "aebox-todo",
}: TodoNotificationOptions) {
  if (!(await ensureTodoReminderPermission())) return;

  try {
    sendNotification({
      id: typeof id === "number" ? id : notificationIdFromString(id),
      title,
      body,
      group,
      autoCancel: true,
    });
  } catch (error) {
    console.warn("Failed to send todo notification", error);
  }
}

async function showTodoReminder(item: TodoItem, kind: ReminderKind, ts: number) {
  await showTodoNotification({
    id: `todo:${item.id}:${kind}:${ts}`,
    title: kind === "end" ? "待办结束提醒" : "待办提醒",
    body: notificationBody(item, kind, ts),
  });
}

export function useTodoReminders() {
  const items = useTodoStore((state) => state.items);
  const hydrated = useTodoStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) return;

    const timers: number[] = [];
    const now = Date.now();

    const scheduleAt = (
      itemId: string,
      kind: ReminderKind,
      ts: number,
    ) => {
      const scheduleNext = () => {
        const delay = ts - Date.now();
        if (delay <= 0) {
          const latest = useTodoStore.getState().items.find((item) => item.id === itemId);
          if (latest && shouldFireReminder(latest, kind, ts)) {
            void showTodoReminder(latest, kind, ts);
          }
          return;
        }
        timers.push(window.setTimeout(scheduleNext, Math.min(delay, MAX_TIMER_DELAY_MS)));
      };
      scheduleNext();
    };

    for (const item of items) {
      if (
        !item.reminderEnabled ||
        item.deletedAt != null ||
        item.status !== "pending" ||
        item.dueAt == null
      ) {
        continue;
      }

      if (item.dueAt > now) {
        scheduleAt(item.id, "start", item.dueAt);
      }
      if (item.dueEndAt != null && item.dueEndAt > item.dueAt && item.dueEndAt > now) {
        scheduleAt(item.id, "end", item.dueEndAt);
      }
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [hydrated, items]);
}
