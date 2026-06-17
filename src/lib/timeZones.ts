export interface TodoTimeZoneOption {
  timeZone: string;
  label: string;
  shortLabel: string;
}

interface TodoCalendarDateParts {
  year: number;
  month: number;
  day: number;
}

export interface TodoZonedTime {
  time: string;
  dayOffset: number;
  dateLabel: string | null;
}

export const MAX_TODO_TIME_ZONES = 5;

export const TODO_TIME_ZONE_OPTIONS: TodoTimeZoneOption[] = [
  { timeZone: "Asia/Shanghai", label: "中国 / 北京 (UTC+8)", shortLabel: "北京" },
  { timeZone: "Asia/Hong_Kong", label: "中国 / 香港 (UTC+8)", shortLabel: "香港" },
  { timeZone: "Asia/Taipei", label: "中国 / 台北 (UTC+8)", shortLabel: "台北" },
  { timeZone: "Asia/Tokyo", label: "日本 / 东京 (UTC+9)", shortLabel: "东京" },
  { timeZone: "Asia/Seoul", label: "韩国 / 首尔 (UTC+9)", shortLabel: "首尔" },
  { timeZone: "Asia/Singapore", label: "新加坡 (UTC+8)", shortLabel: "新加坡" },
  { timeZone: "Asia/Manila", label: "菲律宾 / 马尼拉 (UTC+8)", shortLabel: "马尼拉" },
  { timeZone: "Asia/Kuala_Lumpur", label: "马来西亚 / 吉隆坡 (UTC+8)", shortLabel: "吉隆坡" },
  { timeZone: "Asia/Bangkok", label: "泰国 / 曼谷 (UTC+7)", shortLabel: "曼谷" },
  { timeZone: "Asia/Ho_Chi_Minh", label: "越南 / 胡志明市 (UTC+7)", shortLabel: "胡志明" },
  { timeZone: "Asia/Jakarta", label: "印度尼西亚 / 雅加达 (UTC+7)", shortLabel: "雅加达" },
  { timeZone: "Asia/Yangon", label: "缅甸 / 仰光 (UTC+6:30)", shortLabel: "仰光" },
  { timeZone: "Asia/Dhaka", label: "孟加拉国 / 达卡 (UTC+6)", shortLabel: "达卡" },
  { timeZone: "Asia/Kolkata", label: "印度 / 新德里 (UTC+5:30)", shortLabel: "新德里" },
  { timeZone: "Asia/Kathmandu", label: "尼泊尔 / 加德满都 (UTC+5:45)", shortLabel: "加德满都" },
  { timeZone: "Asia/Karachi", label: "巴基斯坦 / 卡拉奇 (UTC+5)", shortLabel: "卡拉奇" },
  { timeZone: "Asia/Dubai", label: "阿联酋 / 迪拜 (UTC+4)", shortLabel: "迪拜" },
  { timeZone: "Asia/Riyadh", label: "沙特阿拉伯 / 利雅得 (UTC+3)", shortLabel: "利雅得" },
  { timeZone: "Asia/Jerusalem", label: "以色列 / 耶路撒冷", shortLabel: "耶路撒冷" },
  { timeZone: "Europe/Istanbul", label: "土耳其 / 伊斯坦布尔 (UTC+3)", shortLabel: "伊斯坦布尔" },
  { timeZone: "Europe/Moscow", label: "俄罗斯 / 莫斯科 (UTC+3)", shortLabel: "莫斯科" },
  { timeZone: "Europe/London", label: "英国 / 伦敦", shortLabel: "伦敦" },
  { timeZone: "Europe/Dublin", label: "爱尔兰 / 都柏林", shortLabel: "都柏林" },
  { timeZone: "Europe/Berlin", label: "德国 / 柏林", shortLabel: "柏林" },
  { timeZone: "Europe/Paris", label: "法国 / 巴黎", shortLabel: "巴黎" },
  { timeZone: "Europe/Rome", label: "意大利 / 罗马", shortLabel: "罗马" },
  { timeZone: "Europe/Madrid", label: "西班牙 / 马德里", shortLabel: "马德里" },
  { timeZone: "Europe/Amsterdam", label: "荷兰 / 阿姆斯特丹", shortLabel: "阿姆斯特丹" },
  { timeZone: "Europe/Zurich", label: "瑞士 / 苏黎世", shortLabel: "苏黎世" },
  { timeZone: "Europe/Stockholm", label: "瑞典 / 斯德哥尔摩", shortLabel: "斯德哥尔摩" },
  { timeZone: "Europe/Warsaw", label: "波兰 / 华沙", shortLabel: "华沙" },
  { timeZone: "Europe/Athens", label: "希腊 / 雅典", shortLabel: "雅典" },
  { timeZone: "Africa/Cairo", label: "埃及 / 开罗", shortLabel: "开罗" },
  { timeZone: "Africa/Johannesburg", label: "南非 / 约翰内斯堡 (UTC+2)", shortLabel: "约堡" },
  { timeZone: "Africa/Nairobi", label: "肯尼亚 / 内罗毕 (UTC+3)", shortLabel: "内罗毕" },
  { timeZone: "America/New_York", label: "美国 / 纽约", shortLabel: "纽约" },
  { timeZone: "America/Toronto", label: "加拿大 / 多伦多", shortLabel: "多伦多" },
  { timeZone: "America/Chicago", label: "美国 / 芝加哥", shortLabel: "芝加哥" },
  { timeZone: "America/Denver", label: "美国 / 丹佛", shortLabel: "丹佛" },
  { timeZone: "America/Phoenix", label: "美国 / 凤凰城", shortLabel: "凤凰城" },
  { timeZone: "America/Los_Angeles", label: "美国 / 洛杉矶", shortLabel: "洛杉矶" },
  { timeZone: "America/Vancouver", label: "加拿大 / 温哥华", shortLabel: "温哥华" },
  { timeZone: "America/Anchorage", label: "美国 / 安克雷奇", shortLabel: "安克雷奇" },
  { timeZone: "Pacific/Honolulu", label: "美国 / 夏威夷", shortLabel: "夏威夷" },
  { timeZone: "America/Mexico_City", label: "墨西哥 / 墨西哥城", shortLabel: "墨西哥城" },
  { timeZone: "America/Bogota", label: "哥伦比亚 / 波哥大 (UTC-5)", shortLabel: "波哥大" },
  { timeZone: "America/Lima", label: "秘鲁 / 利马 (UTC-5)", shortLabel: "利马" },
  { timeZone: "America/Santiago", label: "智利 / 圣地亚哥", shortLabel: "圣地亚哥" },
  { timeZone: "America/Sao_Paulo", label: "巴西 / 圣保罗", shortLabel: "圣保罗" },
  { timeZone: "America/Argentina/Buenos_Aires", label: "阿根廷 / 布宜诺斯艾利斯 (UTC-3)", shortLabel: "布宜诺斯" },
  { timeZone: "Australia/Perth", label: "澳大利亚 / 珀斯 (UTC+8)", shortLabel: "珀斯" },
  { timeZone: "Australia/Adelaide", label: "澳大利亚 / 阿德莱德", shortLabel: "阿德莱德" },
  { timeZone: "Australia/Brisbane", label: "澳大利亚 / 布里斯班 (UTC+10)", shortLabel: "布里斯班" },
  { timeZone: "Australia/Sydney", label: "澳大利亚 / 悉尼", shortLabel: "悉尼" },
  { timeZone: "Australia/Melbourne", label: "澳大利亚 / 墨尔本", shortLabel: "墨尔本" },
  { timeZone: "Pacific/Auckland", label: "新西兰 / 奥克兰", shortLabel: "奥克兰" },
  { timeZone: "Pacific/Fiji", label: "斐济 / 苏瓦", shortLabel: "斐济" },
  { timeZone: "UTC", label: "协调世界时 (UTC)", shortLabel: "UTC" },
];

const TODO_TIME_ZONE_OPTION_BY_ID = new Map(
  TODO_TIME_ZONE_OPTIONS.map((option) => [option.timeZone, option]),
);

const ZONED_TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function getLocalTodoTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
}

export function isSupportedTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function normalizeTodoTimeZones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const timeZone = entry.trim();
    if (!timeZone || out.includes(timeZone) || !isSupportedTimeZone(timeZone)) continue;
    out.push(timeZone);
    if (out.length >= MAX_TODO_TIME_ZONES) break;
  }
  return out;
}

export function todoTimeZoneLabel(timeZone: string): string {
  return TODO_TIME_ZONE_OPTION_BY_ID.get(timeZone)?.label ?? timeZone;
}

export function todoTimeZoneShortLabel(timeZone: string): string {
  return TODO_TIME_ZONE_OPTION_BY_ID.get(timeZone)?.shortLabel ?? timeZone.replace(/^.*\//, "");
}

function getZonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = ZONED_TIME_FORMATTERS.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  ZONED_TIME_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function readNumberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find((part) => part.type === type)?.value ?? 0);
}

function calendarDayNumber(parts: TodoCalendarDateParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function localCalendarDateParts(date: Date): TodoCalendarDateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function mergeLocalDateAndTime(referenceDate: Date, timeDate: Date): Date {
  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    timeDate.getHours(),
    timeDate.getMinutes(),
    timeDate.getSeconds(),
    timeDate.getMilliseconds(),
  );
}

export function formatTodoZonedTime(
  date: Date,
  timeZone: string,
  referenceDate?: Date,
): TodoZonedTime {
  try {
    const localDate = referenceDate ? mergeLocalDateAndTime(referenceDate, date) : date;
    const parts = getZonedFormatter(timeZone).formatToParts(localDate);
    const zonedDate = {
      year: readNumberPart(parts, "year"),
      month: readNumberPart(parts, "month"),
      day: readNumberPart(parts, "day"),
    };
    const dayOffset = calendarDayNumber(zonedDate) - calendarDayNumber(localCalendarDateParts(localDate));
    const hour = String(readNumberPart(parts, "hour")).padStart(2, "0");
    const minute = String(readNumberPart(parts, "minute")).padStart(2, "0");
    return {
      time: `${hour}:${minute}`,
      dayOffset,
      dateLabel: dayOffset === 0 ? null : `${zonedDate.month}/${zonedDate.day}`,
    };
  } catch {
    return {
      time: "--:--",
      dayOffset: 0,
      dateLabel: null,
    };
  }
}

export function formatTodoTimeInZone(date: Date, timeZone: string): string {
  return formatTodoZonedTime(date, timeZone).time;
}
