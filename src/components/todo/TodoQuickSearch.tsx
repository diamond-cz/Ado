import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Dialog,
  IconButton,
  InputBase,
  ListItemButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import LabelRoundedIcon from "@mui/icons-material/LabelRounded";
import ViewAgendaRoundedIcon from "@mui/icons-material/ViewAgendaRounded";
import TimerRoundedIcon from "@mui/icons-material/TimerRounded";

import { useTodoStore } from "./useTodoStore";
import { TodoEmoji } from "./TodoEmoji";
import type { TodoFolder, TodoGroup, TodoItem, TodoList } from "./types";

type SearchKind = "task" | "tag" | "folder" | "list" | "group";

type SearchResult =
  | {
      kind: "task";
      key: string;
      title: string;
      meta: string;
      item: TodoItem;
      searchText: string;
    }
  | {
      kind: "tag";
      key: string;
      title: string;
      meta: string;
      tag: string;
      searchText: string;
    }
  | {
      kind: "folder";
      key: string;
      title: string;
      meta: string;
      folder: TodoFolder;
      searchText: string;
    }
  | {
      kind: "list";
      key: string;
      title: string;
      meta: string;
      list: TodoList;
      searchText: string;
    }
  | {
      kind: "group";
      key: string;
      title: string;
      meta: string;
      group: TodoGroup;
      searchText: string;
    };

const SECTION_LABELS: Record<SearchKind, string> = {
  task: "待办",
  tag: "标签",
  folder: "文件夹",
  list: "清单",
  group: "分组",
};

const SECTION_ORDER: SearchKind[] = ["task", "tag", "folder", "list", "group"];

interface TodoQuickSearchProps {
  isDark: boolean;
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
  onStartPomodoro: (itemId: string) => void;
}

export function TodoQuickSearch({
  isDark,
  open,
  onClose,
  onNavigate,
  onStartPomodoro,
}: TodoQuickSearchProps) {
  const items = useTodoStore((s) => s.items);
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const groups = useTodoStore((s) => s.groups);
  const setSelectedFilter = useTodoStore((s) => s.setSelectedFilter);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const setDetailFilter = useTodoStore((s) => s.setDetailFilter);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  const listById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  const allResults = useMemo<SearchResult[]>(() => {
    const activeItems = items.filter((item) => item.deletedAt == null);
    const tags = Array.from(new Set(activeItems.flatMap((item) => item.tags))).sort(
      (a, b) => a.localeCompare(b, "zh-Hans-CN"),
    );

    return [
      ...activeItems.map((item): SearchResult => {
        const list = listById.get(item.listId);
        const group = item.groupId ? groupById.get(item.groupId) : null;
        const meta = [list?.name, group?.name].filter(Boolean).join(" / ") || "未归类";
        return {
          kind: "task",
          key: `task-${item.id}`,
          title: item.content || "未命名待办",
          meta,
          item,
          searchText: [item.content, item.note, item.tags.join(" "), list?.name, group?.name]
            .filter(Boolean)
            .join(" "),
        };
      }),
      ...tags.map(
        (tag): SearchResult => ({
          kind: "tag",
          key: `tag-${tag}`,
          title: `#${tag}`,
          meta: "标签",
          tag,
          searchText: tag,
        }),
      ),
      ...folders.map(
        (folder): SearchResult => ({
          kind: "folder",
          key: `folder-${folder.id}`,
          title: folder.name,
          meta: "文件夹",
          folder,
          searchText: folder.name,
        }),
      ),
      ...lists
        .filter((list) => list.archivedAt == null)
        .map(
          (list): SearchResult => ({
            kind: "list",
            key: `list-${list.id}`,
            title: list.name,
            meta: list.folderId ? `清单 / ${folderById.get(list.folderId)?.name ?? "文件夹"}` : "清单",
            list,
            searchText: [list.name, list.folderId ? folderById.get(list.folderId)?.name : ""]
              .filter(Boolean)
              .join(" "),
          }),
        ),
      ...groups.map((group): SearchResult => {
        const list = listById.get(group.listId);
        return {
          kind: "group",
          key: `group-${group.id}`,
          title: group.name,
          meta: list ? `分组 / ${list.name}` : "分组",
          group,
          searchText: [group.name, list?.name].filter(Boolean).join(" "),
        };
      }),
    ];
  }, [folderById, folders, groupById, groups, items, listById, lists]);

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    return allResults
      .filter((result) => result.searchText.toLocaleLowerCase().includes(q))
      .slice(0, 80);
  }, [allResults, query]);

  const grouped = useMemo(
    () =>
      SECTION_ORDER.map((kind) => ({
        kind,
        label: SECTION_LABELS[kind],
        items: results.filter((result) => result.kind === kind),
      })).filter((section) => section.items.length > 0),
    [results],
  );

  const pickResult = (result: SearchResult) => {
    setDetailFilter({ kind: "all" });
    if (result.kind === "task") {
      setSelectedFilter({ kind: "list", id: result.item.listId });
      setSelectedItemId(result.item.id);
    } else if (result.kind === "tag") {
      setSelectedFilter({ kind: "tag", tag: result.tag });
      setSelectedItemId(null);
    } else if (result.kind === "folder") {
      setSelectedFilter({ kind: "folder", id: result.folder.id });
      setSelectedItemId(null);
    } else if (result.kind === "list") {
      setSelectedFilter({ kind: "list", id: result.list.id });
      setSelectedItemId(null);
    } else {
      setSelectedFilter({ kind: "list", id: result.group.listId });
      setSelectedItemId(null);
    }
    onNavigate();
    onClose();
  };

  const startPomodoro = (itemId: string) => {
    onStartPomodoro(itemId);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          sx: {
            borderRadius: 1,
            bgcolor: isDark ? "#20293a" : "#ffffff",
            overflow: "hidden",
          },
        },
      }}
    >
      <Box
        sx={{
          p: 1.2,
          display: "flex",
          alignItems: "center",
          gap: 1,
          borderBottom: 1,
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
        }}
      >
        <SearchRoundedIcon sx={{ fontSize: 21, color: "text.secondary" }} />
        <InputBase
          inputRef={inputRef}
          fullWidth
          value={query}
          placeholder="搜索标签、待办、文件夹、清单、分组"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && results[0]) pickResult(results[0]);
          }}
          sx={{ fontSize: 15 }}
        />
      </Box>
      <Box sx={{ maxHeight: 520, overflowY: "auto", py: 0.8 }}>
        {query.trim() === "" && (
          <EmptyState text="输入关键词开始搜索" isDark={isDark} />
        )}
        {query.trim() !== "" && results.length === 0 && (
          <EmptyState text="没有匹配结果" isDark={isDark} />
        )}
        {grouped.map((section) => (
          <Box key={section.kind} sx={{ px: 0.8, py: 0.4 }}>
            <Typography
              sx={{
                px: 1,
                pb: 0.4,
                fontSize: 12,
                fontWeight: 700,
                color: "text.secondary",
              }}
            >
              {section.label}
            </Typography>
            {section.items.map((result) => (
              <SearchResultRow
                key={result.key}
                result={result}
                isDark={isDark}
                onPick={() => pickResult(result)}
                onStartPomodoro={
                  result.kind === "task"
                    ? () => startPomodoro(result.item.id)
                    : undefined
                }
              />
            ))}
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}

function EmptyState({ text, isDark }: { text: string; isDark: boolean }) {
  return (
    <Box
      sx={{
        height: 180,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: alpha(isDark ? "#f8fafc" : "#0f172a", 0.48),
        fontSize: 13,
      }}
    >
      {text}
    </Box>
  );
}

function SearchResultRow({
  result,
  isDark,
  onPick,
  onStartPomodoro,
}: {
  result: SearchResult;
  isDark: boolean;
  onPick: () => void;
  onStartPomodoro?: () => void;
}) {
  return (
    <ListItemButton
      onClick={onPick}
      sx={{
        minHeight: 46,
        px: 1,
        py: 0.6,
        borderRadius: 1,
        gap: 1,
        alignItems: "center",
      }}
    >
      <ResultIcon result={result} isDark={isDark} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: 14,
            lineHeight: 1.35,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={result.title}
        >
          {result.title}
        </Typography>
        <Typography
          sx={{
            mt: 0.15,
            fontSize: 12,
            color: "text.secondary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={result.meta}
        >
          {result.meta}
        </Typography>
      </Box>
      {onStartPomodoro && (
        <Tooltip title="番茄专注">
          <IconButton
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onStartPomodoro();
            }}
            sx={{ width: 30, height: 30 }}
          >
            <TimerRoundedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
    </ListItemButton>
  );
}

function ResultIcon({ result, isDark }: { result: SearchResult; isDark: boolean }) {
  const commonSx = {
    width: 30,
    height: 30,
    borderRadius: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
    color: "text.secondary",
    flexShrink: 0,
  };

  if (result.kind === "list") {
    return (
      <Box sx={commonSx}>
        <TodoEmoji emoji={result.list.emoji} fallback="📋" size={17} />
      </Box>
    );
  }
  if (result.kind === "folder") {
    return (
      <Box sx={commonSx}>
        <TodoEmoji emoji={result.folder.emoji} fallback="📁" size={17} />
      </Box>
    );
  }
  return (
    <Box sx={commonSx}>
      {result.kind === "task" && <CheckCircleOutlineRoundedIcon sx={{ fontSize: 18 }} />}
      {result.kind === "tag" && <LabelRoundedIcon sx={{ fontSize: 18 }} />}
      {result.kind === "group" && <ViewAgendaRoundedIcon sx={{ fontSize: 18 }} />}
    </Box>
  );
}
