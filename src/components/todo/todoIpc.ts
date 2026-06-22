// IPC wrappers — thin shims around the generic invoke helpers exported
// by `src/lib/ipc.ts`, typed against the local `TodoData` shape.

import * as chrono from "chrono-node";
import { ipc, type TodoBackupEntry, type TodoFontEntry } from "../../lib/ipc";
import type { TodoData } from "./types";

export interface TodoTimeParseSpan {
  start: number;
  end: number;
  kind: "date" | "time" | "duration" | "reminder";
  text: string;
}

export interface TodoTimeParseResult {
  dueAt: number | null;
  dueEndAt: number | null;
  reminderEnabled: boolean;
  label: string | null;
  cleanedText: string;
  spans: TodoTimeParseSpan[];
}

export function getTodoData(): Promise<TodoData> {
  return ipc.getTodoData<TodoData>();
}

export function saveTodoData(data: TodoData): Promise<void> {
  return ipc.saveTodoData<TodoData>(data);
}

export function importTodoDataFromJson(json: string): Promise<TodoData> {
  return ipc.importTodoDataFromJson<TodoData>(json);
}

export function exportTodoDataAsJson(): Promise<string> {
  return ipc.exportTodoDataAsJson();
}

export function createTodoDbBackup(): Promise<TodoBackupEntry> {
  return ipc.createTodoDbBackup();
}

export function listTodoDbBackups(): Promise<TodoBackupEntry[]> {
  return ipc.listTodoDbBackups();
}

export function restoreTodoDbBackup(fileName: string): Promise<void> {
  return ipc.restoreTodoDbBackup(fileName);
}

export function deleteTodoDbBackup(fileName: string): Promise<void> {
  return ipc.deleteTodoDbBackup(fileName);
}

export function backupTodoDbToWebDav(): Promise<TodoBackupEntry> {
  return ipc.backupTodoDbToWebDav();
}

export function listTodoWebDavBackups(): Promise<TodoBackupEntry[]> {
  return ipc.listTodoWebDavBackups();
}

export function syncTodoDbBackupsFromWebDav(): Promise<TodoBackupEntry[]> {
  return ipc.syncTodoDbBackupsFromWebDav();
}

export function restoreTodoDbBackupFromWebDav(fileName: string): Promise<void> {
  return ipc.restoreTodoDbBackupFromWebDav(fileName);
}

export function deleteTodoWebDavBackup(fileName: string): Promise<TodoBackupEntry[]> {
  return ipc.deleteTodoWebDavBackup(fileName);
}

export function listTodoFonts(): Promise<TodoFontEntry[]> {
  return ipc.listTodoFonts();
}

export function openTodoWidgetWindow(): Promise<void> {
  return ipc.openTodoWidgetWindow();
}

export function toggleTodoWidgetWindow(): Promise<void> {
  return ipc.toggleTodoWidgetWindow();
}

export function getTomatoData<T = unknown>(): Promise<T> {
  return ipc.getTomatoData<T>();
}

export function saveTomatoData<T = unknown>(data: T): Promise<void> {
  return ipc.saveTomatoData<T>(data);
}

export function saveTodoAsset(fileName: string, dataBase64: string): Promise<void> {
  return ipc.saveTodoAsset(fileName, dataBase64);
}

export function readTodoAsset(
  fileName: string,
): Promise<{ fileName: string; dataBase64: string; mimeType: string }> {
  return ipc.readTodoAsset(fileName);
}

type ChronoParsedResult = chrono.ParsedResult;

interface ChronoTimeCandidate {
  dueAt: number;
  dueEndAt: number | null;
  spans: TodoTimeParseSpan[];
}

const TIME_SPAN_KEYWORDS =
  /(?:凌晨|早上|上午|中午|下午|晚上|今晚|傍晚|夜里|夜间|点|時|时|:[0-5]\d|：[0-5]\d|半|刻)/;
const CLEAN_TRIM_RE = /^[\s,，.。;；:：、]+|[\s,，.。;；:：、]+$/g;

function codeUnitIndexToCharIndex(text: string, codeUnitIndex: number): number {
  return Array.from(text.slice(0, Math.max(0, codeUnitIndex))).length;
}

function chronoResultToSpan(
  text: string,
  result: ChronoParsedResult,
): TodoTimeParseSpan {
  const start = codeUnitIndexToCharIndex(text, result.index);
  const end = codeUnitIndexToCharIndex(text, result.index + result.text.length);
  const hasCertainTime =
    result.start.isCertain("hour") || result.start.isCertain("minute");
  return {
    start,
    end,
    kind: hasCertainTime || TIME_SPAN_KEYWORDS.test(result.text) ? "time" : "date",
    text: result.text,
  };
}

function shouldUseChronoResult(result: ChronoParsedResult): boolean {
  return (
    result.start.isCertain("year") ||
    result.start.isCertain("month") ||
    result.start.isCertain("day") ||
    result.start.isCertain("weekday") ||
    result.start.isCertain("hour") ||
    result.start.isCertain("minute") ||
    TIME_SPAN_KEYWORDS.test(result.text)
  );
}

function hasCertainDate(result: ChronoParsedResult): boolean {
  return (
    result.start.isCertain("year") ||
    result.start.isCertain("month") ||
    result.start.isCertain("day") ||
    result.start.isCertain("weekday")
  );
}

function hasCertainTime(result: ChronoParsedResult): boolean {
  return result.start.isCertain("hour") || result.start.isCertain("minute");
}

function compareChronoResults(a: ChronoParsedResult, b: ChronoParsedResult): number {
  const aHasDateTime = hasCertainDate(a) && hasCertainTime(a);
  const bHasDateTime = hasCertainDate(b) && hasCertainTime(b);
  if (aHasDateTime !== bHasDateTime) return aHasDateTime ? -1 : 1;
  const aHasTime = hasCertainTime(a);
  const bHasTime = hasCertainTime(b);
  if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
  return b.text.length - a.text.length || a.index - b.index;
}

function combineChronoDateAndTime(
  text: string,
  dateResult: ChronoParsedResult,
  timeResult: ChronoParsedResult,
): ChronoTimeCandidate {
  const date = dateResult.start.date();
  const time = timeResult.start.date();
  const due = new Date(date);
  due.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds());

  return {
    dueAt: due.getTime(),
    dueEndAt: null,
    spans: [
      { ...chronoResultToSpan(text, dateResult), kind: "date" },
      { ...chronoResultToSpan(text, timeResult), kind: "time" },
    ],
  };
}

function chronoResultToCandidate(
  text: string,
  result: ChronoParsedResult,
): ChronoTimeCandidate {
  return {
    dueAt: result.start.date().getTime(),
    dueEndAt: result.end?.date().getTime() ?? null,
    spans: [chronoResultToSpan(text, result)],
  };
}

function pickChronoCandidate(text: string, ref: Date): ChronoTimeCandidate | null {
  const results = chrono.zh.hans
    .parse(text, ref, { forwardDate: true })
    .filter(shouldUseChronoResult)
    .sort(compareChronoResults);
  const fullResult = results.find((result) => hasCertainDate(result) && hasCertainTime(result));
  if (fullResult) return chronoResultToCandidate(text, fullResult);

  const dateResult = results.find(hasCertainDate);
  const timeResult = results.find(hasCertainTime);
  if (dateResult && timeResult) return combineChronoDateAndTime(text, dateResult, timeResult);
  if (timeResult) return chronoResultToCandidate(text, timeResult);
  return null;
}

function normalizeTodoTimeSpans(
  text: string,
  spans: TodoTimeParseSpan[],
): TodoTimeParseSpan[] {
  const charLength = Array.from(text).length;
  const normalized = spans
    .filter((span) => span.end > span.start)
    .map((span) => {
      const start = Math.max(0, Math.min(charLength, span.start));
      const end = Math.max(0, Math.min(charLength, span.end));
      return {
        ...span,
        start,
        end,
        text: Array.from(text).slice(start, end).join(""),
      };
    })
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: TodoTimeParseSpan[] = [];
  for (const span of normalized) {
    const last = out[out.length - 1];
    if (last && last.end >= span.start && last.kind !== "reminder" && span.kind !== "reminder") {
      last.end = Math.max(last.end, span.end);
      last.kind = last.kind === "time" || span.kind === "time" ? "time" : span.kind;
      last.text = Array.from(text).slice(last.start, last.end).join("");
      continue;
    }
    out.push({ ...span });
  }
  return out;
}

function mergeChronoAndBackendSpans(
  text: string,
  chronoSpans: TodoTimeParseSpan[],
  backendSpans: TodoTimeParseSpan[],
): TodoTimeParseSpan[] {
  const spans = [
    ...chronoSpans,
    ...backendSpans.filter((span) => {
      if (span.kind === "reminder") return true;
      return chronoSpans.every(
        (chronoSpan) => span.end <= chronoSpan.start || span.start >= chronoSpan.end,
      );
    }),
  ];
  return normalizeTodoTimeSpans(text, spans);
}

function cleanedTodoText(text: string, spans: TodoTimeParseSpan[]): string {
  const chars = Array.from(text);
  const remove = new Array<boolean>(chars.length).fill(false);
  for (const span of spans) {
    if (span.kind === "reminder") continue;
    const start = Math.max(0, Math.min(chars.length, span.start));
    const end = Math.max(0, Math.min(chars.length, span.end));
    for (let idx = start; idx < end; idx += 1) {
      remove[idx] = true;
    }
  }

  return chars
    .filter((_, idx) => !remove[idx])
    .join("")
    .split(/\s+/)
    .join(" ")
    .replace(CLEAN_TRIM_RE, "");
}

function formatTodoTimeLabel(dueAt: number, now: Date): string {
  const due = new Date(dueAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  const time = `${String(due.getHours()).padStart(2, "0")}:${String(
    due.getMinutes(),
  ).padStart(2, "0")}`;

  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `明天 ${time}`;
  return `${due.getMonth() + 1}/${due.getDate()} ${time}`;
}

function applyChronoTimeResult(
  text: string,
  backendResult: TodoTimeParseResult,
  nowMs: number,
): TodoTimeParseResult {
  const ref = new Date(nowMs);
  const chronoCandidate = pickChronoCandidate(text, ref);
  if (!chronoCandidate) return backendResult;

  const { dueAt, dueEndAt } = chronoCandidate;
  const spans = mergeChronoAndBackendSpans(text, chronoCandidate.spans, backendResult.spans);
  const cleanedText = cleanedTodoText(text, spans) || backendResult.cleanedText || text.trim();

  return {
    ...backendResult,
    dueAt,
    dueEndAt,
    reminderEnabled: spans.some((span) => span.kind === "reminder"),
    label: formatTodoTimeLabel(dueAt, ref),
    cleanedText,
    spans,
  };
}

export async function parseTodoTimeText(text: string): Promise<TodoTimeParseResult> {
  const nowMs = Date.now();
  const backendResult = await ipc.parseTodoTimeText<TodoTimeParseResult>(text, nowMs);
  return applyChronoTimeResult(text, backendResult, nowMs);
}
