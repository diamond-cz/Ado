import { Box, Chip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import EventNoteRoundedIcon from "@mui/icons-material/EventNoteRounded";

import type { TodoItem as TodoItemT } from "./types";
import type {
  TodoItemContextPathPart,
  TodoItemContextTarget,
} from "./TodoItem";

export interface TodoTimelineEntry {
  item: TodoItemT;
  path: TodoItemContextPathPart[];
}

interface TodoTimelineViewProps {
  entries: TodoTimelineEntry[];
  isDark: boolean;
  onSelectItem: (id: string) => void;
  onOpenContextTarget: (target: TodoItemContextTarget) => void;
}

interface TodoTimelineSection {
  key: string;
  title: string;
  entries: TodoTimelineEntry[];
}

const DAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function startOfLocalDayMs(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatTime(ts: number | null): string {
  if (ts == null) return "";
  return TIME_FORMATTER.format(new Date(ts));
}

function formatDuration(start: number | null, end: number | null): string | null {
  if (start == null || end == null || end <= start) return null;
  const totalSeconds = Math.max(1, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function groupTimelineEntries(entries: TodoTimelineEntry[]): TodoTimelineSection[] {
  const timed = entries
    .filter((entry) => entry.item.dueAt != null)
    .sort((a, b) => {
      const dueDelta = (a.item.dueAt ?? 0) - (b.item.dueAt ?? 0);
      if (dueDelta !== 0) return dueDelta;
      return a.item.order - b.item.order;
    });
  const untimed = entries
    .filter((entry) => entry.item.dueAt == null)
    .sort((a, b) => a.item.order - b.item.order);

  const sections: TodoTimelineSection[] = [];
  for (const entry of timed) {
    const day = startOfLocalDayMs(entry.item.dueAt!);
    const key = `day:${day}`;
    const previous = sections[sections.length - 1];
    if (previous?.key === key) {
      previous.entries.push(entry);
    } else {
      sections.push({
        key,
        title: DAY_FORMATTER.format(new Date(day)),
        entries: [entry],
      });
    }
  }

  if (untimed.length > 0) {
    sections.push({
      key: "unscheduled",
      title: "未安排时间",
      entries: untimed,
    });
  }

  return sections;
}

function plainTitle(item: TodoItemT): string {
  return item.content.trim() || "未命名任务";
}

export function TodoTimelineView({
  entries,
  isDark,
  onSelectItem,
  onOpenContextTarget,
}: TodoTimelineViewProps) {
  const sections = groupTimelineEntries(entries);

  if (sections.length === 0) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.disabled",
        }}
      >
        <Typography sx={{ fontSize: 13 }}>暂无待办</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        px: { xs: 1.2, sm: 2.5 },
        py: 1.5,
        maxWidth: 920,
        mx: "auto",
      }}
    >
      {sections.map((section) => (
        <Box key={section.key} sx={{ mb: 2.2 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.8,
              ml: { xs: 0, sm: 10.5 },
              mb: 0.8,
              color: "text.secondary",
            }}
          >
            <EventNoteRoundedIcon sx={{ fontSize: 16, opacity: 0.72 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{section.title}</Typography>
          </Box>
          <Box>
            {section.entries.map((entry, index) => (
              <TimelineRow
                key={entry.item.id}
                entry={entry}
                isDark={isDark}
                first={index === 0}
                last={index === section.entries.length - 1}
                onSelectItem={onSelectItem}
                onOpenContextTarget={onOpenContextTarget}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

interface TimelineRowProps {
  entry: TodoTimelineEntry;
  isDark: boolean;
  first: boolean;
  last: boolean;
  onSelectItem: (id: string) => void;
  onOpenContextTarget: (target: TodoItemContextTarget) => void;
}

function TimelineRow({
  entry,
  isDark,
  first,
  last,
  onSelectItem,
  onOpenContextTarget,
}: TimelineRowProps) {
  const { item, path } = entry;
  const duration = formatDuration(item.dueAt, item.dueEndAt);
  const hasTime = item.dueAt != null;
  const statusColor =
    item.status === "completed"
      ? "#22c55e"
      : item.status === "abandoned"
        ? "#94a3b8"
        : "#2563eb";

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "58px 22px minmax(0, 1fr)", sm: "86px 26px minmax(0, 1fr)" },
        columnGap: { xs: 1, sm: 1.25 },
        minHeight: 82,
      }}
    >
      <Box
        sx={{
          pt: 0.9,
          textAlign: "right",
          color: "text.secondary",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {hasTime ? (
          <>
            <Typography sx={{ fontSize: 17, lineHeight: 1.25, fontWeight: 700 }}>
              {formatTime(item.dueAt)}
            </Typography>
            <Typography sx={{ fontSize: 14, lineHeight: 1.3, color: "text.disabled" }}>
              {item.dueEndAt != null ? formatTime(item.dueEndAt) : ""}
            </Typography>
          </>
        ) : (
          <Typography sx={{ fontSize: 13, lineHeight: 1.3, color: "text.disabled" }}>
            未安排
          </Typography>
        )}
      </Box>

      <Box sx={{ position: "relative", display: "flex", justifyContent: "center" }}>
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: first ? 15 : 0,
            bottom: last ? "calc(100% - 15px)" : 0,
            width: 2,
            bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.18 : 0.1),
          }}
        />
        <Box
          aria-hidden
          sx={{
            mt: 1.35,
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: statusColor,
            boxShadow: `0 0 0 4px ${alpha(statusColor, isDark ? 0.18 : 0.12)}`,
            zIndex: 1,
          }}
        />
      </Box>

      <Box
        onClick={() => onSelectItem(item.id)}
        sx={{
          minWidth: 0,
          mb: 1,
          px: 1.15,
          py: 0.85,
          borderRadius: 1.2,
          cursor: "pointer",
          bgcolor: "transparent",
          transition: "background-color 120ms ease",
          "&:hover": {
            bgcolor: alpha(isDark ? "#60a5fa" : "#2563eb", isDark ? 0.12 : 0.06),
          },
        }}
      >
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.45,
            color: item.status === "completed" ? "text.secondary" : "text.primary",
            textDecoration: item.status === "completed" ? "line-through" : "none",
            display: "block",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "clip",
            whiteSpace: "nowrap",
          }}
        >
          {plainTitle(item)}
        </Typography>
        {duration && (
          <Box
            sx={{
              mt: 0.45,
              display: "flex",
              alignItems: "center",
              gap: 0.55,
              color: "text.secondary",
            }}
          >
            <AccessTimeRoundedIcon sx={{ fontSize: 15, opacity: 0.72 }} />
            <Typography sx={{ fontSize: 13 }}>时长 {duration}</Typography>
          </Box>
        )}
        {path.length > 0 && (
          <Box
            sx={{
              mt: 0.75,
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 0.55,
            }}
          >
            {path.map((part) => (
              <Chip
                key={part.key}
                label={part.label}
                size="small"
                onClick={
                  part.target
                    ? (event) => {
                        event.stopPropagation();
                        onOpenContextTarget(part.target!);
                      }
                    : undefined
                }
                sx={{
                  height: 22,
                  maxWidth: 180,
                  borderRadius: 1,
                  fontSize: 12,
                  color: "text.secondary",
                  bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.05),
                  "& .MuiChip-label": {
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  },
                }}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
