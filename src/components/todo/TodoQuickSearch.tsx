import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  IconButton,
  InputBase,
  ListItemButton,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
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
const SEARCH_HISTORY_STORAGE_KEY = "aebox.todo.searchHistory.v1";
const MAX_SEARCH_HISTORY_ITEMS = 8;

interface TodoQuickSearchProps {
  isDark: boolean;
  open: boolean;
  focusRequest: number;
  onClose: () => void;
  onNavigate: () => void;
  onStartPomodoro: (itemId: string) => void;
}

function readSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .slice(0, MAX_SEARCH_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function writeSearchHistory(history: string[]) {
  try {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* localStorage may be disabled */
  }
}

export function TodoQuickSearch({
  isDark,
  open,
  focusRequest,
  onClose,
  onNavigate,
  onStartPomodoro,
}: TodoQuickSearchProps) {
  const theme = useTheme();
  const isMobileSearch = useMediaQuery(theme.breakpoints.down("sm"));
  const items = useTodoStore((s) => s.items);
  const folders = useTodoStore((s) => s.folders);
  const lists = useTodoStore((s) => s.lists);
  const groups = useTodoStore((s) => s.groups);
  const setSelectedFilter = useTodoStore((s) => s.setSelectedFilter);
  const setSelectedItemId = useTodoStore((s) => s.setSelectedItemId);
  const setDetailFilter = useTodoStore((s) => s.setDetailFilter);
  const [query, setQuery] = useState("");
  const [mobileInputFocused, setMobileInputFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(readSearchHistory);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handledFocusRequestRef = useRef(focusRequest);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSearchHistory(readSearchHistory());
    if (isMobileSearch) {
      setMobileInputFocused(false);
      inputRef.current?.blur();
      return;
    }
    setMobileInputFocused(false);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [isMobileSearch, open]);

  useEffect(() => {
    if (!open) {
      handledFocusRequestRef.current = focusRequest;
      return;
    }
    if (handledFocusRequestRef.current === focusRequest) return;
    handledFocusRequestRef.current = focusRequest;
    if (isMobileSearch) {
      setMobileInputFocused(true);
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [focusRequest, isMobileSearch, open]);

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
            meta: list.folderId
              ? `清单 / ${folderById.get(list.folderId)?.name ?? "文件夹"}`
              : "清单",
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

  const rememberSearch = (value = query) => {
    const term = value.trim();
    if (!term) return;
    setSearchHistory((current) => {
      const next = [term, ...current.filter((entry) => entry !== term)].slice(
        0,
        MAX_SEARCH_HISTORY_ITEMS,
      );
      writeSearchHistory(next);
      return next;
    });
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    writeSearchHistory([]);
  };

  const pickResult = (result: SearchResult) => {
    rememberSearch();
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
    rememberSearch();
    onStartPomodoro(itemId);
    onClose();
  };

  const submitSearch = () => {
    if (results[0]) {
      pickResult(results[0]);
      return;
    }
    rememberSearch();
  };

  const cancelMobileSearchInput = () => {
    setQuery("");
    setMobileInputFocused(false);
    inputRef.current?.blur();
  };

  const searchResults = (
    <Box sx={{ maxHeight: { xs: "none", sm: 520 }, overflowY: "auto", py: { xs: 0, sm: 0.8 } }}>
      {query.trim() === "" && !isMobileSearch && (
        <EmptyState text="输入关键词开始搜索" isDark={isDark} />
      )}
      {query.trim() === "" && isMobileSearch && (
        <MobileSearchEmptyState isDark={isDark} compact={mobileInputFocused} />
      )}
      {false && query.trim() === "" && isMobileSearch && (
        <Box sx={{ mt: 3.2 }}>
          <Typography
            sx={{
              ml: 0.4,
              mb: 1.4,
              fontSize: 17,
              lineHeight: 1.35,
              fontWeight: 650,
              color: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.72 : 0.62),
            }}
          >
            搜索历史
          </Typography>
          {searchHistory.length > 0 ? (
            <>
              <Box
                sx={{
                  borderRadius: 2.5,
                  overflow: "hidden",
                  bgcolor: isDark ? alpha("#f8fafc", 0.08) : "#ffffff",
                  boxShadow: isDark ? "none" : "0 8px 24px rgba(15, 23, 42, 0.045)",
                }}
              >
                {searchHistory.map((entry, index) => (
                  <ListItemButton
                    key={`${entry}-${index}`}
                    onClick={() => {
                      setQuery(entry);
                      window.setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    sx={{
                      minHeight: 62,
                      px: 2,
                      py: 1,
                      borderBottom:
                        index === searchHistory.length - 1
                          ? 0
                          : `1px solid ${alpha(isDark ? "#f8fafc" : "#0f172a", 0.06)}`,
                    }}
                  >
                    <Typography sx={{ fontSize: 16, color: "text.primary" }}>{entry}</Typography>
                  </ListItemButton>
                ))}
              </Box>
              <Button
                onClick={clearSearchHistory}
                disableRipple
                sx={{
                  mt: 1.8,
                  mx: "auto",
                  display: "flex",
                  color: "text.secondary",
                  fontSize: 14,
                  fontWeight: 500,
                  textTransform: "none",
                  bgcolor: "transparent",
                  "&:hover": { bgcolor: "transparent" },
                }}
              >
                清空历史记录
              </Button>
            </>
          ) : (
            <EmptyState text="输入关键词开始搜索" isDark={isDark} />
          )}
        </Box>
      )}
      {query.trim() !== "" && results.length === 0 && (
        <EmptyState text="没有匹配结果" isDark={isDark} />
      )}
      {grouped.map((section) => (
        <Box key={section.kind} sx={{ px: { xs: 0, sm: 0.8 }, py: { xs: 0.6, sm: 0.4 } }}>
          <Typography
            sx={{
              px: { xs: 0.2, sm: 1 },
              pb: 0.4,
              fontSize: { xs: 14, sm: 12 },
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
              mobile={isMobileSearch}
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
  );

  if (!open) return null;

  if (isMobileSearch) {
    return (
      <Box
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: mobileInputFocused ? 0 : "calc(58px + env(safe-area-inset-bottom))",
          zIndex: 36,
          display: "flex",
          flexDirection: "column",
          px: mobileInputFocused ? 2.1 : 2.5,
          pt: mobileInputFocused
            ? "max(calc(env(safe-area-inset-top) + 8px), 24px)"
            : "max(calc(env(safe-area-inset-top) + 12px), 40px)",
          pb: 2,
          bgcolor: isDark ? "#0f172a" : "#edf4f8",
          color: "text.primary",
          overflow: "hidden",
        }}
      >
        <Typography sx={{ display: "none", fontSize: 28, lineHeight: 1.16, fontWeight: 850 }}>
          搜索
        </Typography>
        <Box
          sx={{
            mt: mobileInputFocused ? 0 : 2.7,
            width: mobileInputFocused ? "calc(100% - 58px)" : "100%",
            height: mobileInputFocused ? 46 : 56,
            px: mobileInputFocused ? 1.2 : 1.55,
            display: "flex",
            alignItems: "center",
            gap: 1.05,
            borderRadius: mobileInputFocused ? 2.6 : 3.2,
            bgcolor: isDark ? alpha("#f8fafc", 0.08) : alpha("#dbe3ea", 0.58),
            border: `1px solid ${alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.08 : 0.035)}`,
            boxShadow: "none",
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: mobileInputFocused ? 23 : 25, color: alpha(isDark ? "#f8fafc" : "#64748b", 0.48) }} />
          <InputBase
            inputRef={inputRef}
            fullWidth
            value={query}
            placeholder="搜索"
            onFocus={() => setMobileInputFocused(true)}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                if (isMobileSearch) {
                  cancelMobileSearchInput();
                } else {
                  onClose();
                }
              }
              if (event.key === "Enter") submitSearch();
            }}
            sx={{
              fontSize: mobileInputFocused ? 16 : 17,
              fontWeight: 500,
              color: "text.primary",
              "& input::placeholder": {
                color: alpha(isDark ? "#f8fafc" : "#64748b", 0.46),
                opacity: 1,
              },
            }}
          />
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pt: mobileInputFocused ? 1.2 : 0.2 }}>
          {searchResults}
        </Box>
        {mobileInputFocused && (
          <Button
            onClick={() => {
              cancelMobileSearchInput();
            }}
            disableRipple
            sx={{
              position: "absolute",
              top: "max(calc(env(safe-area-inset-top) + 19px), 35px)",
              right: 20,
              minWidth: 0,
              px: 0,
              color: theme.palette.primary.main,
              fontSize: 15,
              fontWeight: 750,
              textTransform: "none",
              bgcolor: "transparent",
              "&:hover": { bgcolor: "transparent" },
            }}
          >
            取消
          </Button>
        )}
      </Box>
    );
  }

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
            if (event.key === "Enter") submitSearch();
          }}
          sx={{ fontSize: 15 }}
        />
      </Box>
      {searchResults}
    </Dialog>
  );
}

function MobileSearchEmptyState({ isDark, compact }: { isDark: boolean; compact: boolean }) {
  return (
    <Box
      sx={{
        minHeight: compact ? "min(54vh, 420px)" : "min(66vh, 560px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: compact ? "center" : "center",
        pt: compact ? 0 : 4,
        color: "text.primary",
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 220 180"
        role="img"
        aria-hidden="true"
        sx={{
          width: compact ? 190 : 220,
          maxWidth: "62vw",
          height: "auto",
          mb: compact ? 2.2 : 3,
          opacity: isDark ? 0.88 : 1,
        }}
      >
        <path
          d="M49 72c22-32 61-34 101-45 23-6 35 8 22 29 30 5 43 30 18 48-13 10-31 11-48 10-2 27-26 39-53 28-19-8-17-28-13-45-18-1-42-3-27-25Z"
          fill={isDark ? "#1e293b" : "#e5e9f1"}
        />
        <path
          d="M73 75c7-16 17-24 32-25m11 0c16 1 27 9 34 25"
          fill="none"
          stroke="#1f2f57"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx="83" cy="83" r="24" fill="#101f3f" stroke="#1f2f57" strokeWidth="4" />
        <circle cx="137" cy="83" r="24" fill="#eef4ff" stroke="#1f2f57" strokeWidth="4" />
        <path d="M124 96 150 70" stroke="#4778ff" strokeWidth="8" strokeLinecap="round" />
        <path d="M109 80h4" stroke="#1f2f57" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M58 99c-14-8-20-21-14-32l17 8c-5 9 0 17 9 22l-12 2Z"
          fill="#4778ff"
        />
        <path
          d="M162 99c14-8 20-21 14-32l-17 8c5 9 0 17-9 22l12 2Z"
          fill="#4778ff"
        />
        <path
          d="M92 110c11 18 31 30 47 15 12-11 4-29-11-36"
          fill="none"
          stroke="#1f2f57"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="3 5"
        />
        <path d="M49 124h10m-5-5v10M179 72h8m-4-4v8" stroke="#1f2f57" strokeWidth="3" strokeLinecap="round" />
        <circle cx="124" cy="31" r="3" fill="#4778ff" stroke="#1f2f57" strokeWidth="2" />
      </Box>
      <Typography sx={{ fontSize: compact ? 21 : 22, lineHeight: 1.25, fontWeight: 850 }}>
        你想搜索什么
      </Typography>
      <Typography
        sx={{
          mt: 1.2,
          fontSize: compact ? 15 : 16,
          color: alpha(isDark ? "#f8fafc" : "#64748b", 0.5),
        }}
      >
        点击输入框即可搜索
      </Typography>
    </Box>
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
  mobile = false,
  onPick,
  onStartPomodoro,
}: {
  result: SearchResult;
  isDark: boolean;
  mobile?: boolean;
  onPick: () => void;
  onStartPomodoro?: () => void;
}) {
  return (
    <ListItemButton
      onClick={onPick}
      sx={{
        minHeight: mobile ? 58 : 46,
        px: mobile ? 1.2 : 1,
        py: mobile ? 0.9 : 0.6,
        borderRadius: mobile ? 2 : 1,
        gap: 1,
        alignItems: "center",
        bgcolor: mobile ? alpha(isDark ? "#f8fafc" : "#ffffff", isDark ? 0.05 : 0.72) : undefined,
        mb: mobile ? 0.8 : 0,
      }}
    >
      <ResultIcon result={result} isDark={isDark} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: mobile ? 16 : 14,
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
            fontSize: mobile ? 13 : 12,
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
