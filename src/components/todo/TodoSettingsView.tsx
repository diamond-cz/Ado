import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CloudSyncRoundedIcon from "@mui/icons-material/CloudSyncRounded";
import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ColorLensRoundedIcon from "@mui/icons-material/ColorLensRounded";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import AddTaskRoundedIcon from "@mui/icons-material/AddTaskRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import FileUploadRoundedIcon from "@mui/icons-material/FileUploadRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import KeyboardRoundedIcon from "@mui/icons-material/KeyboardRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import ManageSearchRoundedIcon from "@mui/icons-material/ManageSearchRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import RedoRoundedIcon from "@mui/icons-material/RedoRounded";
import RestoreRoundedIcon from "@mui/icons-material/RestoreRounded";
import SettingsBrightnessRoundedIcon from "@mui/icons-material/SettingsBrightnessRounded";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import SubdirectoryArrowRightRoundedIcon from "@mui/icons-material/SubdirectoryArrowRightRounded";
import TextFieldsRoundedIcon from "@mui/icons-material/TextFieldsRounded";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import {
  getLocalTodoTimeZone,
  MAX_TODO_TIME_ZONES,
  TODO_TIME_ZONE_OPTIONS,
  todoTimeZoneLabel,
  todoTimeZoneShortLabel,
} from "../../lib/timeZones";
import type { TodoBackupEntry } from "../../lib/ipc";
import { normalizeAccelerator } from "../../lib/accelerator";
import {
  DEFAULT_TODO_SHORTCUTS,
  TODO_SHORTCUT_IDS,
  useStore,
  type TodoIdleLightEffectMode,
  type ThemeMode,
  type TodoShortcutId,
} from "../../state/store";
import { ShortcutInput } from "../ShortcutInput";
import {
  createTodoColorThemeId,
  isBuiltinTodoColorThemeId,
  isTodoHexColor,
  mergeTodoColorThemes,
  normalizeTodoColorTheme,
  removeTodoColorTheme,
  resolveTodoAccentColor,
  resolveTodoColorTheme,
  upsertTodoColorTheme,
  type TodoColorTheme,
  type TodoColorThemeId,
} from "../../lib/todoColorThemes";
import {
  backupTodoDbToWebDav,
  createTodoDbBackup,
  deleteTodoDbBackup,
  deleteTodoWebDavBackup,
  exportTodoDataAsJson,
  importTodoDataFromJson,
  listTodoDbBackups,
  listTodoFonts,
  listTodoWebDavBackups,
  restoreTodoDbBackup,
  restoreTodoDbBackupFromWebDav,
  syncTodoDbBackupsFromWebDav,
} from "./todoIpc";
import {
  TODO_DEFAULT_FONT_ID,
  ensureTodoFontsRegistered,
  todoFontCssFamily,
  type TodoFontEntry,
} from "./todoFonts";
import { useTodoStore } from "./useTodoStore";

type TodoSettingsCategory = "appearance" | "shortcuts" | "data" | "hours" | "display" | "timeZones";
type TodoColorThemeEditorMode =
  | { kind: "new" }
  | { kind: "edit"; id: TodoColorThemeId }
  | null;

const CATEGORY_ITEMS: {
  id: TodoSettingsCategory;
  label: string;
  description: string;
}[] = [
  { id: "appearance", label: "外观", description: "主题色、字体与动效" },
  { id: "shortcuts", label: "快捷键", description: "自定义 Todo 操作" },
  { id: "data", label: "数据", description: "导入导出与数据库备份" },
  { id: "hours", label: "日历营业时间", description: "日视图与周视图时间范围" },
  { id: "display", label: "日历显示", description: "周数、节假日与农历" },
  { id: "timeZones", label: "多时区", description: "额外时间刻度" },
];

const TODO_ACCENT_COLORS = [
  "#2563eb",
  "#0891b2",
  "#16a34a",
  "#f97316",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#475569",
];

const WEEK_START_OPTIONS = [
  { value: 0, label: "周日" },
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
];

const TODO_SETTINGS_DRAG_TITLEBAR_HEIGHT = 20;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatBackupTime(createdAt: number): string {
  if (!createdAt) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(createdAt));
}

function formatBackupSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function backupSourceLabel(source: string): string {
  return source === "webdav" ? "WebDAV" : "本地";
}

export function TodoSettingsView({ isDark }: { isDark: boolean }) {
  const theme = useTheme();
  const isMobileSettings = useMediaQuery(theme.breakpoints.down("sm"));
  const appSettings = useStore((s) => s.appSettings);
  const setTodoSettings = useStore((s) => s.setTodoSettings);
  const colorThemes = useMemo(
    () => mergeTodoColorThemes(appSettings.todoColorThemes),
    [appSettings.todoColorThemes],
  );
  const colorTheme = useMemo(
    () => resolveTodoColorTheme(appSettings.todoColorTheme, appSettings.todoColorThemes),
    [appSettings.todoColorTheme, appSettings.todoColorThemes],
  );
  const effectiveTodoAccentColor = resolveTodoAccentColor(
    colorTheme,
    appSettings.todoAccentColor,
    appSettings.todoAccentColorOverridden,
  );
  const settingsNavBg = isDark ? "#1b2432" : colorTheme.middle;
  const settingsContentBg = isDark ? "#20293a" : colorTheme.content;
  const [activeCategory, setActiveCategory] = useState<TodoSettingsCategory>("appearance");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const activeItem = CATEGORY_ITEMS.find((item) => item.id === activeCategory) ?? CATEGORY_ITEMS[0];
  const shouldRenderSettingsDetail = !isMobileSettings || mobileDetailOpen;
  const shouldLoadTodoFonts =
    !isMobileSettings || (mobileDetailOpen && activeCategory === "appearance");
  const [dataBusy, setDataBusy] = useState(false);
  const [dataStatus, setDataStatus] = useState<{
    severity: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [localBackups, setLocalBackups] = useState<TodoBackupEntry[]>([]);
  const [remoteBackups, setRemoteBackups] = useState<TodoBackupEntry[]>([]);
  const [todoFonts, setTodoFonts] = useState<TodoFontEntry[]>([]);
  const [fontBusy, setFontBusy] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontRefreshKey, setFontRefreshKey] = useState(0);

  const localTodoTimeZone = useMemo(() => getLocalTodoTimeZone(), []);
  const [pendingTodoTimeZone, setPendingTodoTimeZone] = useState(
    () =>
      TODO_TIME_ZONE_OPTIONS.find((option) => option.timeZone !== localTodoTimeZone)?.timeZone ?? "",
  );
  const availableTodoTimeZoneOptions = useMemo(
    () =>
      TODO_TIME_ZONE_OPTIONS.filter(
        (option) =>
          option.timeZone !== localTodoTimeZone &&
          !appSettings.todoTimeZones.includes(option.timeZone),
      ),
    [appSettings.todoTimeZones, localTodoTimeZone],
  );
  const todoShortcutConflicts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of TODO_SHORTCUT_IDS) {
      const key = normalizeAccelerator(appSettings.todoShortcuts[id]);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [appSettings.todoShortcuts]);
  const hasTodoShortcutConflict = (value: string) => {
    const key = normalizeAccelerator(value);
    return Boolean(key && todoShortcutConflicts.has(key));
  };
  const setTodoShortcut = (id: TodoShortcutId, value: string) => {
    setTodoSettings({
      todoShortcuts: {
        ...appSettings.todoShortcuts,
        [id]: value,
      },
    });
  };

  useEffect(() => {
    if (
      pendingTodoTimeZone &&
      availableTodoTimeZoneOptions.some((option) => option.timeZone === pendingTodoTimeZone)
    ) {
      return;
    }
    setPendingTodoTimeZone(availableTodoTimeZoneOptions[0]?.timeZone ?? "");
  }, [availableTodoTimeZoneOptions, pendingTodoTimeZone]);

  useEffect(() => {
    if (!shouldLoadTodoFonts) return;
    let cancelled = false;
    setFontBusy(true);
    setFontError(null);
    listTodoFonts()
      .then((fonts) => {
        if (cancelled) return;
        setTodoFonts(fonts);
        ensureTodoFontsRegistered(fonts);
      })
      .catch((err) => {
        if (!cancelled) setFontError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setFontBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fontRefreshKey, shouldLoadTodoFonts]);

  useEffect(() => {
    if (activeCategory !== "data") return;
    let cancelled = false;
    listTodoDbBackups()
      .then((backups) => {
        if (!cancelled) setLocalBackups(backups);
      })
      .catch((err) => {
        if (!cancelled) setDataStatus({ severity: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [activeCategory]);

  const commitTodoDayStartHour = (value: number) => {
    const start = Math.max(0, Math.min(22, value));
    const end = Math.max(start + 1, Math.min(23, appSettings.todoDayEndHour));
    setTodoSettings({ todoDayStartHour: start, todoDayEndHour: end });
  };

  const commitTodoDayEndHour = (value: number) => {
    const start = Math.max(0, Math.min(22, appSettings.todoDayStartHour));
    const end = Math.max(start + 1, Math.min(23, value));
    setTodoSettings({ todoDayStartHour: start, todoDayEndHour: end });
  };

  const addTodoTimeZone = () => {
    if (
      !pendingTodoTimeZone ||
      appSettings.todoTimeZones.includes(pendingTodoTimeZone) ||
      appSettings.todoTimeZones.length >= MAX_TODO_TIME_ZONES
    ) {
      return;
    }
    setTodoSettings({
      todoTimeZones: [...appSettings.todoTimeZones, pendingTodoTimeZone],
    });
  };

  const removeTodoTimeZone = (timeZone: string) => {
    setTodoSettings({
      todoTimeZones: appSettings.todoTimeZones.filter((entry) => entry !== timeZone),
    });
  };

  const setTodoAccentColor = (value: string) => {
    const normalized = /^#[0-9a-fA-F]{6}$/.test(value) ? value : effectiveTodoAccentColor;
    setTodoSettings({
      todoAccentColor: normalized,
      todoAccentColorOverridden: true,
    });
  };

  const saveTodoColorTheme = (theme: TodoColorTheme) => {
    const normalized = normalizeTodoColorTheme(theme);
    if (!normalized) return;
    setTodoSettings({
      todoColorTheme: normalized.id,
      todoColorThemes: upsertTodoColorTheme(appSettings.todoColorThemes, normalized),
    });
  };

  const deleteTodoColorTheme = (id: TodoColorThemeId) => {
    const nextThemes = removeTodoColorTheme(appSettings.todoColorThemes, id);
    const nextSelected = id === appSettings.todoColorTheme ? "default" : appSettings.todoColorTheme;
    setTodoSettings({
      todoColorTheme: nextSelected,
      todoColorThemes: nextThemes,
    });
  };

  const runDataAction = async (action: () => Promise<string | null>) => {
    if (dataBusy) return;
    setDataBusy(true);
    setDataStatus(null);
    try {
      const message = await action();
      if (message) setDataStatus({ severity: "success", message });
    } catch (err) {
      setDataStatus({ severity: "error", message: errorMessage(err) });
    } finally {
      setDataBusy(false);
    }
  };

  const refreshLocalBackups = async () => {
    const backups = await listTodoDbBackups();
    setLocalBackups(backups);
    return backups;
  };

  const refreshRemoteBackups = async () => {
    const backups = await listTodoWebDavBackups();
    setRemoteBackups(backups);
    return backups;
  };

  const importLocalTodoJson = () =>
    runDataAction(async () => {
      const picked = await openDialog({
        multiple: false,
        filters: [
          { name: "Todo JSON", extensions: ["json"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (!picked || Array.isArray(picked)) return null;
      await useTodoStore.getState().flush();
      const json = await readTextFile(picked);
      await importTodoDataFromJson(json);
      await useTodoStore.getState().reload();
      return "已从 todos.json 导入数据库";
    });

  const exportLocalTodoJson = () =>
    runDataAction(async () => {
      const target = await saveDialog({
        defaultPath: "todos.json",
        filters: [
          { name: "Todo JSON", extensions: ["json"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (!target) return null;
      const json = await exportTodoDataAsJson();
      await writeTextFile(target, json);
      return "已导出数据库到 todos.json";
    });

  const createLocalDbBackup = () =>
    runDataAction(async () => {
      await useTodoStore.getState().flush();
      const entry = await createTodoDbBackup();
      await refreshLocalBackups();
      return `已创建数据库备份：${formatBackupTime(entry.createdAt)}`;
    });

  const restoreLocalDbBackup = (entry: TodoBackupEntry) =>
    runDataAction(async () => {
      if (
        !window.confirm(
          `确定恢复到 ${formatBackupTime(entry.createdAt)} 的备份吗？当前 Todo 数据会被覆盖。`,
        )
      ) {
        return null;
      }
      await useTodoStore.getState().flush();
      await restoreTodoDbBackup(entry.fileName);
      await useTodoStore.getState().reload();
      await refreshLocalBackups();
      return `已恢复数据库备份：${formatBackupTime(entry.createdAt)}`;
    });

  const deleteLocalDbBackup = (entry: TodoBackupEntry) =>
    runDataAction(async () => {
      if (
        !window.confirm(
          `确定删除 ${formatBackupTime(entry.createdAt)} 的本地备份吗？此操作不可恢复。`,
        )
      ) {
        return null;
      }
      await deleteTodoDbBackup(entry.fileName);
      await refreshLocalBackups();
      return `已删除本地数据库备份：${formatBackupTime(entry.createdAt)}`;
    });

  const loadRemoteDbBackups = () =>
    runDataAction(async () => {
      const backups = await refreshRemoteBackups();
      return backups.length > 0 ? `已读取 ${backups.length} 个远端备份` : "远端暂无数据库备份";
    });

  const backupToWebDav = () =>
    runDataAction(async () => {
      await useTodoStore.getState().flush();
      const entry = await backupTodoDbToWebDav();
      await refreshLocalBackups();
      await refreshRemoteBackups();
      return `已上传数据库备份：${formatBackupTime(entry.createdAt)}`;
    });

  const syncFromWebDav = () =>
    runDataAction(async () => {
      const backups = await syncTodoDbBackupsFromWebDav();
      setLocalBackups(backups);
      await refreshRemoteBackups();
      return backups.length > 0 ? `已同步 ${backups.length} 个数据库备份` : "远端暂无数据库备份";
    });

  const restoreRemoteDbBackup = (entry: TodoBackupEntry) =>
    runDataAction(async () => {
      if (
        !window.confirm(
          `确定从 WebDAV 恢复 ${formatBackupTime(entry.createdAt)} 的备份吗？当前 Todo 数据会被覆盖。`,
        )
      ) {
        return null;
      }
      await useTodoStore.getState().flush();
      await restoreTodoDbBackupFromWebDav(entry.fileName);
      await useTodoStore.getState().reload();
      await refreshLocalBackups();
      await refreshRemoteBackups();
      return `已从 WebDAV 恢复数据库备份：${formatBackupTime(entry.createdAt)}`;
    });

  const deleteRemoteDbBackup = (entry: TodoBackupEntry) =>
    runDataAction(async () => {
      if (
        !window.confirm(
          `确定删除 WebDAV 备份 ${formatBackupTime(entry.createdAt)} 吗？远端 .sqlite 和 manifest.json 中的记录会被删除。`,
        )
      ) {
        return null;
      }
      const backups = await deleteTodoWebDavBackup(entry.fileName);
      setRemoteBackups(backups);
      return `已删除 WebDAV 备份记录：${formatBackupTime(entry.createdAt)}`;
    });

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        minWidth: 0,
        background: settingsContentBg,
      }}
    >
      <Box
        sx={{
          width: { xs: "100%", sm: 248 },
          flexShrink: 0,
          display: { xs: mobileDetailOpen ? "none" : "flex", sm: "flex" },
          flexDirection: "column",
          minHeight: 0,
          borderRight: { xs: 0, sm: 1 },
          borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
          background: settingsNavBg,
          px: { xs: 1.2, sm: 1.4 },
          pt: 0,
          pb: 2,
        }}
      >
        <SettingsDragStrip background={settingsNavBg} horizontalOffset={1.4} />
        <Box sx={{ px: 1.2, mb: 1.6 }}>
          <Typography sx={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>
            设置
          </Typography>
          {/* <Typography sx={{ mt: 0.5, fontSize: 12, color: "text.secondary" }}>
            Todo
          </Typography> */}
        </Box>
        <Box component="nav" sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
          {CATEGORY_ITEMS.map((item) => {
            const active = item.id === activeCategory;
            return (
              <Box
                key={item.id}
                component="button"
                type="button"
                onClick={() => {
                  setActiveCategory(item.id);
                  if (isMobileSettings) setMobileDetailOpen(true);
                }}
                sx={{
                  width: "100%",
                  minHeight: { xs: 64, sm: 58 },
                  px: { xs: 1.3, sm: 1.2 },
                  py: { xs: 1.1, sm: 0.9 },
                  display: "flex",
                  alignItems: "center",
                  gap: 1.1,
                  border: 0,
                  borderRadius: 1,
                  color: active ? "primary.main" : "text.primary",
                  bgcolor: active
                    ? alpha(theme.palette.primary.main, isDark ? 0.16 : 0.1)
                    : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  outline: "none",
                  "&:hover": {
                    bgcolor: active
                      ? alpha(theme.palette.primary.main, isDark ? 0.2 : 0.14)
                      : alpha(isDark ? "#f8fafc" : "#0f172a", 0.06),
                  },
                  "&:focus-visible": {
                    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
                  },
                }}
              >
                <CategoryIcon id={item.id} active={active} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, lineHeight: 1.25 }}>
                    {item.label}
                  </Typography>
                  <Typography sx={{ mt: 0.15, fontSize: 11, color: "text.secondary" }}>
                    {item.description}
                  </Typography>
                </Box>
                <ChevronRightRoundedIcon
                  sx={{
                    ml: "auto",
                    display: { xs: "block", sm: "none" },
                    fontSize: 19,
                    color: "text.secondary",
                    flexShrink: 0,
                  }}
                />
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: { xs: mobileDetailOpen ? "flex" : "none", sm: "flex" },
          flexDirection: "column",
          background: settingsContentBg,
        }}
      >
        {shouldRenderSettingsDetail && (
          <>
        <SettingsDragStrip background={settingsContentBg} />
        <Box
          sx={{
            display: { xs: "flex", sm: "none" },
            alignItems: "center",
            gap: 1,
            px: 1.2,
            py: 0.8,
            borderBottom: 1,
            borderColor: alpha(isDark ? "#f8fafc" : "#0f172a", 0.08),
            flexShrink: 0,
          }}
        >
          <IconButton
            size="small"
            aria-label="返回设置"
            onClick={() => setMobileDetailOpen(false)}
            sx={{ width: 36, height: 36 }}
          >
            <ArrowBackRoundedIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 850, lineHeight: 1.2 }}>
              {activeItem.label}
            </Typography>
            <Typography
              sx={{
                mt: 0.2,
                fontSize: 11,
                color: "text.secondary",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeItem.description}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Box
          sx={{
            width: "100%",
            maxWidth: 860,
            boxSizing: "border-box",
            px: { xs: 1.4, md: 4 },
            py: { xs: 2, md: 3.5 },
          }}
        >
          <Typography
            sx={{
              display: { xs: "none", sm: "block" },
              fontSize: 22,
              fontWeight: 850,
              lineHeight: 1.2,
            }}
          >
            {activeItem.label}
          </Typography>
          <Typography
            sx={{
              display: { xs: "none", sm: "block" },
              mt: 0.6,
              mb: 2.4,
              fontSize: 13,
              color: "text.secondary",
            }}
          >
            {activeItem.description}
          </Typography>

          {activeCategory === "appearance" && (
            <SettingGroup title="外观">
              <SettingRow
                icon={<SettingsBrightnessRoundedIcon sx={{ fontSize: 20, color: "#0ea5e9" }} />}
                title="主题色"
                description="仅影响 Todo 窗口，不跟随启动器主题。"
                control={
                  <ThemeModeSelector
                    value={appSettings.todoThemeMode}
                    onChange={(value) => setTodoSettings({ todoThemeMode: value })}
                  />
                }
              />
              <SettingRow
                icon={<ColorLensRoundedIcon sx={{ fontSize: 20, color: "#8b5cf6" }} />}
                title="颜色主题"
                description="控制 Todo 窗口各列背景色；默认保留当前配色。"
                control={
                  <TodoColorThemeEditor
                    value={appSettings.todoColorTheme}
                    themes={colorThemes}
                    customThemes={appSettings.todoColorThemes}
                    onChange={(value) => setTodoSettings({ todoColorTheme: value })}
                    onSave={saveTodoColorTheme}
                    onDelete={deleteTodoColorTheme}
                  />
                }
              />
              <SettingRow
                icon={<TextFieldsRoundedIcon sx={{ fontSize: 20, color: "#6366f1" }} />}
                title="字体"
                description="读取 resource/fonts 中的字体文件；添加新字体后可重新扫描。"
                control={
                  <TodoFontSelector
                    value={appSettings.todoFontFamily}
                    fonts={todoFonts}
                    busy={fontBusy}
                    error={fontError}
                    onChange={(value) => setTodoSettings({ todoFontFamily: value })}
                    onRefresh={() => setFontRefreshKey((value) => value + 1)}
                  />
                }
              />
              <SettingRow
                icon={<ColorLensRoundedIcon sx={{ fontSize: 20, color: effectiveTodoAccentColor }} />}
                title="重点色"
                description="用于 Todo 的按钮、选中态和强调元素。"
                control={
                  <AccentColorSelector
                    value={effectiveTodoAccentColor}
                    onChange={setTodoAccentColor}
                  />
                }
              />
              <SwitchSettingRow
                icon={<CheckBoxOutlineBlankRoundedIcon sx={{ fontSize: 20, color: "#10b981" }} />}
                title="圆形待办复选框"
                description="开启后待办完成按钮使用圆形样式，关闭则使用方形样式。"
                checked={appSettings.todoCheckboxShape === "circle"}
                onChange={(value) =>
                  setTodoSettings({ todoCheckboxShape: value ? "circle" : "square" })
                }
              />
              <SwitchSettingRow
                icon={<SettingsBrightnessRoundedIcon sx={{ fontSize: 20, color: "#38bdf8" }} />}
                title="闲置纸面动效"
                description="开启后窗口闲置时显示纸面视频动效；关闭后不播放 leaves、rain 或 moon。"
                checked={appSettings.todoIdlePaperEffectEnabled}
                onChange={(value) => setTodoSettings({ todoIdlePaperEffectEnabled: value })}
              />
              <SettingRow
                icon={<LightModeRoundedIcon sx={{ fontSize: 20, color: "#f59e0b" }} />}
                title="浅色动效来源"
                description="仅浅色模式生效；深色模式固定使用 moon.mp4。"
                control={
                  <TodoIdleEffectModeSelector
                    value={appSettings.todoIdlePaperLightEffect}
                    disabled={!appSettings.todoIdlePaperEffectEnabled}
                    onChange={(value) => setTodoSettings({ todoIdlePaperLightEffect: value })}
                  />
                }
              />
            </SettingGroup>
          )}

          {activeCategory === "shortcuts" && (
            <SettingGroup title="快捷键">
              <SettingRow
                icon={<KeyboardRoundedIcon sx={{ fontSize: 20, color: "#64748b" }} />}
                title="恢复默认快捷键"
                description="恢复 Todo 操作的默认快捷键配置。"
                control={
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() =>
                      setTodoSettings({ todoShortcuts: { ...DEFAULT_TODO_SHORTCUTS } })
                    }
                  >
                    恢复默认
                  </Button>
                }
              />
              <ShortcutSettingRow
                icon={<UndoRoundedIcon sx={{ fontSize: 20, color: "#0ea5e9" }} />}
                title="撤销"
                description="撤销最近一次 Todo 数据变更。"
                value={appSettings.todoShortcuts.undo}
                conflict={hasTodoShortcutConflict(appSettings.todoShortcuts.undo)}
                onChange={(value) => setTodoShortcut("undo", value)}
              />
              <ShortcutSettingRow
                icon={<RedoRoundedIcon sx={{ fontSize: 20, color: "#8b5cf6" }} />}
                title="重做"
                description="恢复刚撤销的 Todo 数据变更。"
                value={appSettings.todoShortcuts.redo}
                conflict={hasTodoShortcutConflict(appSettings.todoShortcuts.redo)}
                onChange={(value) => setTodoShortcut("redo", value)}
              />
              <ShortcutSettingRow
                icon={<DeleteOutlineRoundedIcon sx={{ fontSize: 20, color: "#ef4444" }} />}
                title="删除选中待办"
                description="删除当前选中或多选的待办。"
                value={appSettings.todoShortcuts.delete}
                conflict={hasTodoShortcutConflict(appSettings.todoShortcuts.delete)}
                onChange={(value) => setTodoShortcut("delete", value)}
                allowSingleKey
              />
              <ShortcutSettingRow
                icon={<AddTaskRoundedIcon sx={{ fontSize: 20, color: "#10b981" }} />}
                title="创建待办"
                description="在窗口中间打开快速创建待办输入框。"
                value={appSettings.todoShortcuts.createTask}
                conflict={hasTodoShortcutConflict(appSettings.todoShortcuts.createTask)}
                onChange={(value) => setTodoShortcut("createTask", value)}
              />
              <ShortcutSettingRow
                icon={<SubdirectoryArrowRightRoundedIcon sx={{ fontSize: 20, color: "#f59e0b" }} />}
                title="创建子待办"
                description="为当前选中待办创建子待办。"
                value={appSettings.todoShortcuts.createChild}
                conflict={hasTodoShortcutConflict(appSettings.todoShortcuts.createChild)}
                onChange={(value) => setTodoShortcut("createChild", value)}
              />
              <ShortcutSettingRow
                icon={<CheckRoundedIcon sx={{ fontSize: 20, color: "#22c55e" }} />}
                title="完成选中待办"
                description="将当前选中或多选的待办标记为已完成。"
                value={appSettings.todoShortcuts.complete}
                conflict={hasTodoShortcutConflict(appSettings.todoShortcuts.complete)}
                onChange={(value) => setTodoShortcut("complete", value)}
              />
              <ShortcutSettingRow
                icon={<ManageSearchRoundedIcon sx={{ fontSize: 20, color: "#6366f1" }} />}
                title="搜索待办"
                description="打开 Todo 内的快速搜索。"
                value={appSettings.todoShortcuts.search}
                conflict={hasTodoShortcutConflict(appSettings.todoShortcuts.search)}
                onChange={(value) => setTodoShortcut("search", value)}
              />
            </SettingGroup>
          )}

          {activeCategory === "data" && (
            <>
              <SettingGroup title="本地数据">
                <SettingRow
                  icon={<FileUploadRoundedIcon sx={{ fontSize: 20, color: "#0ea5e9" }} />}
                  title="导入 todos.json"
                  description="读取 JSON 文件并写入 Todo SQLite 数据库。"
                  control={
                    <Button
                      variant="contained"
                      size="small"
                      disabled={dataBusy}
                      startIcon={<FileUploadRoundedIcon sx={{ fontSize: 16 }} />}
                      onClick={importLocalTodoJson}
                    >
                      导入
                    </Button>
                  }
                />
                <SettingRow
                  icon={<FileDownloadRoundedIcon sx={{ fontSize: 20, color: "#10b981" }} />}
                  title="导出 todos.json"
                  description="从 Todo SQLite 数据库导出当前完整数据。"
                  control={
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={dataBusy}
                      startIcon={<FileDownloadRoundedIcon sx={{ fontSize: 16 }} />}
                      onClick={exportLocalTodoJson}
                    >
                      导出
                    </Button>
                  }
                />
              </SettingGroup>

              <SettingGroup title="数据库备份时间线">
                <SettingRow
                  icon={<StorageRoundedIcon sx={{ fontSize: 20, color: "#0ea5e9" }} />}
                  title="创建本地备份"
                  description="保存当前 Todo SQLite 数据库快照，可从下方时间线恢复。"
                  control={
                    <Button
                      variant="contained"
                      size="small"
                      disabled={dataBusy}
                      startIcon={<StorageRoundedIcon sx={{ fontSize: 16 }} />}
                      onClick={createLocalDbBackup}
                    >
                      立即备份
                    </Button>
                  }
                />
                <BackupTimeline
                  backups={localBackups}
                  emptyText="暂无本地数据库备份"
                  dataBusy={dataBusy}
                  onRestore={restoreLocalDbBackup}
                  onDelete={deleteLocalDbBackup}
                />
              </SettingGroup>

              <SettingGroup title="WebDAV 备份与同步">
                <TextSettingRow
                  icon={<CloudSyncRoundedIcon sx={{ fontSize: 20, color: "#0ea5e9" }} />}
                  title="WebDAV 目录地址"
                  description="例如 https://example.com/dav，远端备份目录由下方路径决定。"
                  value={appSettings.todoWebDavUrl}
                  placeholder="https://example.com/dav"
                  onChange={(value) => setTodoSettings({ todoWebDavUrl: value })}
                />
                <TextSettingRow
                  icon={<FileDownloadRoundedIcon sx={{ fontSize: 20, color: "#6366f1" }} />}
                  title="远端备份目录"
                  description="相对 WebDAV 目录，保存 .sqlite 快照、manifest.json 和图片 assets。"
                  value={appSettings.todoWebDavPath}
                  placeholder="todo-backups"
                  onChange={(value) => setTodoSettings({ todoWebDavPath: value })}
                />
                <TextSettingRow
                  icon={<PublicRoundedIcon sx={{ fontSize: 20, color: "#f97316" }} />}
                  title="用户名"
                  description="WebDAV Basic Auth 用户名。"
                  value={appSettings.todoWebDavUsername}
                  placeholder="username"
                  onChange={(value) => setTodoSettings({ todoWebDavUsername: value })}
                />
                <TextSettingRow
                  icon={<SettingsBrightnessRoundedIcon sx={{ fontSize: 20, color: "#64748b" }} />}
                  title="密码"
                  description="保存在本机 Todo 设置文件中。"
                  value={appSettings.todoWebDavPassword}
                  placeholder="password"
                  type="password"
                  onChange={(value) => setTodoSettings({ todoWebDavPassword: value })}
                />
                <SettingRow
                  icon={<CloudSyncRoundedIcon sx={{ fontSize: 20, color: "#10b981" }} />}
                  title="数据库备份和同步"
                  description="备份会上传当前 SQLite 快照和 MD 图片；同步只下载远端备份时间线与图片，不覆盖当前数据。"
                  control={
                    <Box
                      sx={{
                        width: { xs: "100%", sm: "auto" },
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 1,
                        justifyContent: { xs: "flex-start", sm: "flex-end" },
                        "& .MuiButton-root": {
                          flex: { xs: "1 1 120px", sm: "0 0 auto" },
                        },
                      }}
                    >
                      <Button
                        variant="contained"
                        size="small"
                        disabled={dataBusy || !appSettings.todoWebDavUrl.trim()}
                        onClick={backupToWebDav}
                      >
                        上传备份
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        disabled={dataBusy || !appSettings.todoWebDavUrl.trim()}
                        startIcon={<RefreshRoundedIcon sx={{ fontSize: 16 }} />}
                        onClick={loadRemoteDbBackups}
                      >
                        刷新远端
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        disabled={dataBusy || !appSettings.todoWebDavUrl.trim()}
                        onClick={syncFromWebDav}
                      >
                        同步到本地
                      </Button>
                    </Box>
                  }
                />
                <BackupTimeline
                  backups={remoteBackups}
                  emptyText="未读取远端备份"
                  dataBusy={dataBusy}
                  onRestore={restoreRemoteDbBackup}
                  onDelete={deleteRemoteDbBackup}
                />
              </SettingGroup>

              {dataStatus && (
                <Typography
                  sx={{
                    mt: -0.8,
                    fontSize: 12,
                    color:
                      dataStatus.severity === "error"
                        ? "error.main"
                        : dataStatus.severity === "info"
                          ? "text.secondary"
                          : "success.main",
                  }}
                >
                  {dataStatus.message}
                </Typography>
              )}
            </>
          )}

          {activeCategory === "hours" && (
            <SettingGroup title="日历营业时间">
              <NumberSettingRow
                icon={<AccessTimeRoundedIcon sx={{ fontSize: 20, color: "#0ea5e9" }} />}
                title="开始时间"
                description="日历从这个整点开始显示，可选 0-22。"
                value={appSettings.todoDayStartHour}
                min={0}
                max={22}
                onCommit={commitTodoDayStartHour}
              />
              <NumberSettingRow
                icon={<AccessTimeRoundedIcon sx={{ fontSize: 20, color: "#10b981" }} />}
                title="结束时间"
                description="日历显示到这个整点，需晚于开始时间，可选 1-23。"
                value={appSettings.todoDayEndHour}
                min={1}
                max={23}
                onCommit={commitTodoDayEndHour}
              />
            </SettingGroup>
          )}

          {activeCategory === "display" && (
            <SettingGroup title="日历显示">
              <SelectSettingRow
                icon={<CalendarTodayRoundedIcon sx={{ fontSize: 20, color: "#0ea5e9" }} />}
                title="一周开始于"
                description="影响月视图、周视图和周数计算的起始日。"
                value={appSettings.todoFirstDay}
                options={WEEK_START_OPTIONS}
                onChange={(value) => setTodoSettings({ todoFirstDay: value })}
              />
              <SwitchSettingRow
                icon={<CalendarTodayRoundedIcon sx={{ fontSize: 20, color: "#6366f1" }} />}
                title="显示周数"
                description="开启 FullCalendar 的周数列。"
                checked={appSettings.todoShowWeekNumbers}
                onChange={(value) => setTodoSettings({ todoShowWeekNumbers: value })}
              />
              <SwitchSettingRow
                icon={<CheckRoundedIcon sx={{ fontSize: 20, color: "#f97316" }} />}
                title="显示节假日/节气/工作休息日"
                description="在月视图日期格中显示法定节假日、节气、调休工作日和休息日标记。"
                checked={appSettings.todoShowChineseCalendar}
                onChange={(value) => setTodoSettings({ todoShowChineseCalendar: value })}
              />
              <SwitchSettingRow
                icon={<SettingsBrightnessRoundedIcon sx={{ fontSize: 20, color: "#10b981" }} />}
                title="显示中国农历"
                description="在月视图日期格中显示农历日期。"
                checked={appSettings.todoShowLunarCalendar}
                onChange={(value) => setTodoSettings({ todoShowLunarCalendar: value })}
              />
            </SettingGroup>
          )}

          {activeCategory === "timeZones" && (
            <SettingGroup title="多时区">
              <SettingRow
                icon={<PublicRoundedIcon sx={{ fontSize: 20, color: "#0ea5e9" }} />}
                title="添加显示时区"
                description={`日视图和周视图左侧时间刻度最多显示 ${MAX_TODO_TIME_ZONES} 个额外时区。`}
                control={
                  <Box
                    sx={{
                      width: { xs: "100%", sm: "auto" },
                      display: "flex",
                      flexDirection: { xs: "column", sm: "row" },
                      gap: 1,
                      flexShrink: 0,
                    }}
                  >
                    <TextField
                      select
                      size="small"
                      value={pendingTodoTimeZone}
                      disabled={
                        appSettings.todoTimeZones.length >= MAX_TODO_TIME_ZONES ||
                        availableTodoTimeZoneOptions.length === 0
                      }
                      onChange={(event) => setPendingTodoTimeZone(event.target.value)}
                      sx={{ width: { xs: "100%", sm: 240 } }}
                    >
                      {availableTodoTimeZoneOptions.map((option) => (
                        <MenuItem key={option.timeZone} value={option.timeZone}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<AddRoundedIcon sx={{ fontSize: 16 }} />}
                      disabled={
                        !pendingTodoTimeZone ||
                        appSettings.todoTimeZones.length >= MAX_TODO_TIME_ZONES
                      }
                      onClick={addTodoTimeZone}
                    >
                      添加
                    </Button>
                  </Box>
                }
              />
              <Box
                sx={{
                  px: 2,
                  py: 1.6,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 1,
                  borderTop: 1,
                  borderColor: "divider",
                }}
              >
                {appSettings.todoTimeZones.length === 0 ? (
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                    未添加额外时区
                  </Typography>
                ) : (
                  appSettings.todoTimeZones.map((timeZone) => (
                    <Box
                      key={timeZone}
                      sx={{
                        minHeight: 36,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 0.8,
                        pl: 1.2,
                        pr: 0.3,
                        borderRadius: 1,
                        border: 1,
                        borderColor: "divider",
                        bgcolor: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.04 : 0.035),
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, lineHeight: 1.1 }}>
                          {todoTimeZoneShortLabel(timeZone)}
                        </Typography>
                        <Typography sx={{ fontSize: 10, color: "text.secondary", lineHeight: 1.1 }}>
                          {todoTimeZoneLabel(timeZone)}
                        </Typography>
                      </Box>
                      <Tooltip title="移除时区">
                        <IconButton
                          size="small"
                          onClick={() => removeTodoTimeZone(timeZone)}
                          sx={{ width: 26, height: 26 }}
                        >
                          <CloseRoundedIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))
                )}
              </Box>
            </SettingGroup>
          )}
          </Box>
          </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

function SettingsDragStrip({
  background,
  horizontalOffset = 0,
}: {
  background: string;
  horizontalOffset?: number;
}) {
  return (
    <Box
      data-tauri-drag-region
      sx={{
        display: { xs: "none", sm: "block" },
        height: TODO_SETTINGS_DRAG_TITLEBAR_HEIGHT,
        flexShrink: 0,
        mx: horizontalOffset > 0 ? -horizontalOffset : 0,
        mb: horizontalOffset > 0 ? 2 : 0,
        background,
        userSelect: "none",
      }}
    />
  );
}

function BackupTimeline({
  backups,
  emptyText,
  dataBusy,
  onRestore,
  onDelete,
}: {
  backups: TodoBackupEntry[];
  emptyText: string;
  dataBusy: boolean;
  onRestore: (entry: TodoBackupEntry) => void;
  onDelete?: (entry: TodoBackupEntry) => void;
}) {
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider" }}>
      {backups.length === 0 ? (
        <Box sx={{ px: 2, py: 1.6 }}>
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{emptyText}</Typography>
        </Box>
      ) : (
        backups.map((entry) => (
          <Box
            key={`${entry.source}-${entry.fileName}`}
            sx={{
              minHeight: 62,
              px: { xs: 1.4, sm: 2 },
              py: 1.1,
              display: "flex",
              alignItems: { xs: "flex-start", sm: "center" },
              flexWrap: { xs: "wrap", sm: "nowrap" },
              gap: { xs: 1, sm: 1.3 },
              borderBottom: 1,
              borderColor: "divider",
              "&:last-of-type": { borderBottom: 0 },
            }}
          >
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                bgcolor: (theme) =>
                  theme.palette.mode === "dark"
                    ? alpha("#f8fafc", 0.06)
                    : alpha("#0f172a", 0.05),
                flexShrink: 0,
              }}
            >
              <HistoryRoundedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, lineHeight: 1.25 }}>
                {formatBackupTime(entry.createdAt)}
              </Typography>
              <Typography
                sx={{
                  mt: 0.2,
                  fontSize: 11,
                  color: "text.secondary",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {backupSourceLabel(entry.source)} · {formatBackupSize(entry.size)} ·{" "}
                {entry.fileName}
              </Typography>
            </Box>
            <Box
              sx={{
                width: { xs: "100%", sm: "auto" },
                display: "flex",
                flexShrink: 0,
                gap: 0.8,
                justifyContent: { xs: "flex-end", sm: "flex-start" },
                flexWrap: "wrap",
              }}
            >
              <Button
                variant="outlined"
                size="small"
                disabled={dataBusy}
                startIcon={<RestoreRoundedIcon sx={{ fontSize: 16 }} />}
                onClick={() => onRestore(entry)}
              >
              恢复
              </Button>
              {onDelete && (
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  disabled={dataBusy}
                  startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />}
                  onClick={() => onDelete(entry)}
                >
                  删除
                </Button>
              )}
            </Box>
          </Box>
        ))
      )}
    </Box>
  );
}

function CategoryIcon({ id, active }: { id: TodoSettingsCategory; active: boolean }) {
  const color = active ? "primary.main" : "text.secondary";
  if (id === "appearance") return <SettingsBrightnessRoundedIcon sx={{ fontSize: 20, color }} />;
  if (id === "shortcuts") return <KeyboardRoundedIcon sx={{ fontSize: 20, color }} />;
  if (id === "data") return <CloudSyncRoundedIcon sx={{ fontSize: 20, color }} />;
  if (id === "hours") return <AccessTimeRoundedIcon sx={{ fontSize: 20, color }} />;
  if (id === "display") return <CalendarTodayRoundedIcon sx={{ fontSize: 20, color }} />;
  return <PublicRoundedIcon sx={{ fontSize: 20, color }} />;
}

function ThemeModeSelector({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
}) {
  const options: { value: ThemeMode; label: string; icon: ReactNode }[] = [
    { value: "light", label: "浅色", icon: <LightModeRoundedIcon sx={{ fontSize: 16 }} /> },
    { value: "dark", label: "深色", icon: <DarkModeRoundedIcon sx={{ fontSize: 16 }} /> },
    {
      value: "system",
      label: "跟随系统",
      icon: <SettingsBrightnessRoundedIcon sx={{ fontSize: 16 }} />,
    },
  ];
  return (
    <Box
      sx={{
        width: { xs: "100%", sm: "auto" },
        display: "flex",
        flexWrap: "wrap",
        gap: 0.8,
        justifyContent: { xs: "flex-start", sm: "flex-end" },
      }}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Box
            key={option.value}
            component="button"
            type="button"
            onClick={() => onChange(option.value)}
            sx={{
              minHeight: 34,
              px: 1.2,
              display: "inline-flex",
              alignItems: "center",
              gap: 0.6,
              borderRadius: 1,
              border: 1,
              borderColor: active ? "primary.main" : "divider",
              bgcolor: active ? "primary.main" : "transparent",
              color: active ? "#fff" : "text.primary",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
              outline: "none",
              "&:hover": {
                bgcolor: active ? "primary.dark" : "action.hover",
              },
              "&:focus-visible": {
                boxShadow: (theme) => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
              },
            }}
          >
            {option.icon}
            {option.label}
          </Box>
        );
      })}
    </Box>
  );
}

function TodoIdleEffectModeSelector({
  value,
  disabled = false,
  onChange,
}: {
  value: TodoIdleLightEffectMode;
  disabled?: boolean;
  onChange: (value: TodoIdleLightEffectMode) => void;
}) {
  const options: { value: TodoIdleLightEffectMode; label: string }[] = [
    { value: "random", label: "随机" },
    { value: "leaves", label: "Leaves" },
    { value: "rain", label: "Rain" },
  ];
  return (
    <Box
      sx={{
        width: { xs: "100%", sm: "auto" },
        display: "flex",
        flexWrap: "wrap",
        gap: 0.8,
        justifyContent: { xs: "flex-start", sm: "flex-end" },
      }}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Box
            key={option.value}
            component="button"
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            sx={{
              minHeight: 34,
              px: 1.2,
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 1,
              border: 1,
              borderColor: active ? "primary.main" : "divider",
              bgcolor: active ? "primary.main" : "transparent",
              color: active ? "#fff" : "text.primary",
              fontSize: 12,
              fontWeight: 800,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.45 : 1,
              outline: "none",
              "&:hover": {
                bgcolor: disabled ? (active ? "primary.main" : "transparent") : active ? "primary.dark" : "action.hover",
              },
              "&:focus-visible": {
                boxShadow: (theme) => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
              },
            }}
          >
            {option.label}
          </Box>
        );
      })}
    </Box>
  );
}

function TodoColorThemeEditor({
  value,
  themes,
  customThemes,
  onChange,
  onSave,
  onDelete,
}: {
  value: TodoColorThemeId;
  themes: TodoColorTheme[];
  customThemes: TodoColorTheme[];
  onChange: (value: TodoColorThemeId) => void;
  onSave: (theme: TodoColorTheme) => void;
  onDelete: (id: TodoColorThemeId) => void;
}) {
  const selectedTheme = useMemo(
    () => themes.find((theme) => theme.id === value) ?? resolveTodoColorTheme(value, customThemes),
    [customThemes, themes, value],
  );
  const customThemeIds = useMemo(
    () => new Set(customThemes.map((theme) => theme.id)),
    [customThemes],
  );
  const [draft, setDraft] = useState<TodoColorTheme>(() =>
    createCustomTodoColorThemeDraft(selectedTheme, themes),
  );
  const [editorMode, setEditorMode] = useState<TodoColorThemeEditorMode>(null);
  const editorOpen = editorMode != null;
  const editingExisting = editorMode?.kind === "edit";

  useEffect(() => {
    if (editorOpen) return;
    setDraft(createCustomTodoColorThemeDraft(selectedTheme, themes));
  }, [editorOpen, selectedTheme, themes]);

  const updateDraft = (patch: Partial<TodoColorTheme>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const selectTheme = (nextValue: TodoColorThemeId) => {
    const nextTheme = themes.find((theme) => theme.id === nextValue);
    if (nextTheme && customThemeIds.has(nextTheme.id) && !isBuiltinTodoColorThemeId(nextTheme.id)) {
      setDraft(nextTheme);
      setEditorMode({ kind: "edit", id: nextTheme.id });
    } else {
      setEditorMode(null);
    }
    onChange(nextValue);
  };

  const saveCurrentTheme = () => {
    const normalized = normalizeTodoColorTheme(draft);
    if (!normalized || isBuiltinTodoColorThemeId(normalized.id)) return;
    onSave(normalized);
    setEditorMode(null);
  };

  const openNewThemeEditor = () => {
    setDraft(createCustomTodoColorThemeDraft(selectedTheme, themes));
    setEditorMode({ kind: "new" });
  };

  const deleteEditingTheme = () => {
    if (editorMode?.kind !== "edit") return;
    onDelete(editorMode.id);
    setEditorMode(null);
  };

  return (
    <Box
      sx={{
        width: { xs: "100%", sm: "min(430px, 48vw)" },
        minWidth: 0,
        display: "grid",
        gap: 1,
        justifyItems: "stretch",
      }}
    >
      <TodoColorThemeSelector
        value={value}
        themes={themes}
        onChange={selectTheme}
        onAdd={openNewThemeEditor}
      />
      {editorOpen && (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 0.8,
            }}
          >
            <TextField
              size="small"
              label="名称"
              value={draft.label}
              onChange={(event) => updateDraft({ label: event.target.value })}
              sx={{ gridColumn: "1 / -1" }}
            />
            <ColorValueField
              label="左栏"
              value={draft.panel}
              onChange={(panel) => updateDraft({ panel })}
            />
            <ColorValueField
              label="中栏"
              value={draft.middle}
              onChange={(middle) => updateDraft({ middle })}
            />
            <ColorValueField
              label="内容"
              value={draft.content}
              onChange={(content) => updateDraft({ content })}
            />
            <ColorValueField
              label="底色"
              value={draft.surface}
              onChange={(surface) => updateDraft({ surface })}
            />
            <ColorValueField
              label="强调"
              value={draft.accent}
              onChange={(accent) => updateDraft({ accent })}
              sx={{ gridColumn: "1 / -1" }}
            />
          </Box>
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.8, flexWrap: "wrap" }}>
            {editingExisting && (
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />}
                onClick={deleteEditingTheme}
              >
                删除
              </Button>
            )}
            {editorOpen && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<CloseRoundedIcon sx={{ fontSize: 16 }} />}
                onClick={() => setEditorMode(null)}
              >
                取消
              </Button>
            )}
            <Button
              variant="contained"
              size="small"
              startIcon={<CheckRoundedIcon sx={{ fontSize: 16 }} />}
              onClick={saveCurrentTheme}
            >
              保存
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}

function createCustomTodoColorThemeDraft(
  source: TodoColorTheme,
  themes: TodoColorTheme[],
): TodoColorTheme {
  return {
    ...source,
    id: createTodoColorThemeId(themes),
    label: `${source.label.trim() || "自定义主题"}副本`,
  };
}

function ColorValueField({
  label,
  value,
  onChange,
  sx,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  sx?: object;
}) {
  const pickerValue = firstHexColor(value) ?? "#2563eb";

  return (
    <Box sx={{ minWidth: 0, display: "flex", alignItems: "center", gap: 0.6, ...(sx ?? {}) }}>
      <TextField
        size="small"
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { spellCheck: false } }}
        sx={{ minWidth: 0, flex: 1 }}
      />
      <Box
        component="label"
        sx={{
          width: 34,
          height: 34,
          borderRadius: 1,
          border: 1,
          borderColor: "divider",
          background: isTodoHexColor(value) ? value : pickerValue,
          cursor: "pointer",
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <Box
          component="input"
          type="color"
          value={pickerValue}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          sx={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
          }}
        />
      </Box>
    </Box>
  );
}

function firstHexColor(value: string): string | null {
  return value.match(/#[0-9a-fA-F]{6}/)?.[0] ?? null;
}

function TodoColorThemeSelector({
  value,
  themes,
  onChange,
  onAdd,
}: {
  value: TodoColorThemeId;
  themes: TodoColorTheme[];
  onChange: (value: TodoColorThemeId) => void;
  onAdd: () => void;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "repeat(auto-fit, minmax(82px, 1fr))", sm: "repeat(3, 76px)" },
        gap: 0.8,
        justifyContent: { xs: "stretch", sm: "flex-end" },
      }}
    >
      {themes.map((option) => {
        const active = value === option.id;
        return (
          <Tooltip key={option.id} title={option.label} arrow>
            <Box
              component="button"
              type="button"
              onClick={() => onChange(option.id)}
              sx={{
                width: { xs: "100%", sm: 76 },
                minHeight: 58,
                px: 0.7,
                py: 0.65,
                borderRadius: 1,
                border: 1,
                borderColor: active ? "primary.main" : "divider",
                bgcolor: "transparent",
                color: active ? "primary.main" : "text.secondary",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.45,
                cursor: "pointer",
                position: "relative",
                outline: "none",
                "&:hover": {
                  bgcolor: "action.hover",
                },
                "&:focus-visible": {
                  boxShadow: (theme) => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
                },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: "100%",
                  height: 24,
                  display: "grid",
                  gridTemplateColumns: "18px 1fr 1fr",
                  borderRadius: 0.7,
                  overflow: "hidden",
                  border: 1,
                  borderColor: alpha("#0f172a", 0.1),
                }}
              >
                <Box sx={{ background: option.panel }} />
                <Box sx={{ bgcolor: option.middle }} />
                <Box sx={{ bgcolor: option.content }} />
              </Box>
              <Typography
                component="span"
                sx={{
                  maxWidth: "100%",
                  fontSize: 11,
                  fontWeight: 800,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {option.label}
              </Typography>
              {active && (
                <Box
                  aria-hidden
                  sx={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: "primary.main",
                    color: "#fff",
                  }}
                >
                  <CheckRoundedIcon sx={{ fontSize: 12 }} />
                </Box>
              )}
            </Box>
          </Tooltip>
        );
      })}
      <Tooltip title="新增自定义颜色" arrow>
        <Box
          component="button"
          type="button"
          onClick={onAdd}
          aria-label="新增自定义颜色"
          sx={{
            width: { xs: "100%", sm: 76 },
            minHeight: 58,
            borderRadius: 1,
            border: 1,
            borderStyle: "dashed",
            borderColor: "divider",
            bgcolor: "transparent",
            color: "text.secondary",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            outline: "none",
            "&:hover": {
              bgcolor: "action.hover",
              color: "primary.main",
              borderColor: "primary.main",
            },
            "&:focus-visible": {
              boxShadow: (theme) => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
            },
          }}
        >
          <AddRoundedIcon sx={{ fontSize: 22 }} />
        </Box>
      </Tooltip>
    </Box>
  );
}

function TodoFontSelector({
  value,
  fonts,
  busy,
  error,
  onChange,
  onRefresh,
}: {
  value: string;
  fonts: TodoFontEntry[];
  busy: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const selectedMissing =
    value !== TODO_DEFAULT_FONT_ID && !fonts.some((font) => font.id === value);
  const selectedFontFamily = todoFontCssFamily(value, fonts);

  return (
    <Box
      sx={{
        width: { xs: "100%", sm: "auto" },
        display: "flex",
        alignItems: "center",
        justifyContent: { xs: "flex-start", sm: "flex-end" },
        gap: 0.8,
        flexWrap: "wrap",
      }}
    >
      <TextField
        select
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        sx={{
          width: { xs: "calc(100% - 42px)", sm: 250 },
          minWidth: { xs: 0, sm: 250 },
          flexShrink: 0,
          "& .MuiSelect-select": {
            fontFamily: selectedFontFamily ?? "inherit",
          },
        }}
      >
        <MenuItem value={TODO_DEFAULT_FONT_ID}>默认字体</MenuItem>
        {selectedMissing && (
          <MenuItem value={value} disabled>
            当前字体文件未找到
          </MenuItem>
        )}
        {fonts.map((font) => (
          <MenuItem
            key={font.id}
            value={font.id}
            sx={{ fontFamily: todoFontCssFamily(font.id, fonts) ?? "inherit" }}
          >
            {font.label}
          </MenuItem>
        ))}
      </TextField>
      <Tooltip title="重新扫描 resource/fonts">
        <span>
          <IconButton
            size="small"
            disabled={busy}
            onClick={onRefresh}
            sx={{ width: 34, height: 34 }}
          >
            <RefreshRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
      {error && (
        <Tooltip title={error}>
          <Typography sx={{ fontSize: 11, color: "error.main" }}>读取失败</Typography>
        </Tooltip>
      )}
    </Box>
  );
}

function AccentColorSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selectedPreset = TODO_ACCENT_COLORS.some(
    (color) => value.toLowerCase() === color.toLowerCase(),
  );
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const showCustomPicker = customPickerOpen || !selectedPreset;

  return (
    <Box
      sx={{
        width: { xs: "100%", sm: "auto" },
        display: "flex",
        alignItems: "center",
        gap: 0.8,
        flexWrap: "wrap",
        justifyContent: { xs: "flex-start", sm: "flex-end" },
      }}
    >
      {TODO_ACCENT_COLORS.map((color) => {
        const active = value.toLowerCase() === color.toLowerCase();
        return (
          <Tooltip key={color} title={color} arrow>
            <Box
              component="button"
              type="button"
              onClick={() => {
                setCustomPickerOpen(false);
                onChange(color);
              }}
              aria-label={color}
              sx={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "2px solid",
                borderColor: active ? "text.primary" : "transparent",
                bgcolor: color,
                boxShadow: active ? `0 0 0 2px ${alpha(color, 0.25)}` : "none",
                cursor: "pointer",
                outline: "none",
                "&:focus-visible": {
                  boxShadow: `0 0 0 3px ${alpha(color, 0.35)}`,
                },
              }}
            >
              {active && <CheckRoundedIcon sx={{ fontSize: 16, color: "#fff" }} />}
            </Box>
          </Tooltip>
        );
      })}
      <Tooltip title="新增自定义颜色" arrow>
        <Box
          component="button"
          type="button"
          onClick={() => setCustomPickerOpen(true)}
          aria-label="新增自定义颜色"
          sx={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: 1,
            borderStyle: "dashed",
            borderColor: "divider",
            bgcolor: "transparent",
            color: "text.secondary",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            outline: "none",
            flexShrink: 0,
            "&:hover": {
              bgcolor: "action.hover",
              color: "primary.main",
              borderColor: "primary.main",
            },
            "&:focus-visible": {
              boxShadow: (theme) => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
            },
          }}
        >
          <AddRoundedIcon sx={{ fontSize: 18 }} />
        </Box>
      </Tooltip>
      {showCustomPicker && (
        <Tooltip title="自定义颜色" arrow>
          <Box
            component="label"
            sx={{
              width: 30,
              height: 30,
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
              bgcolor: value,
              cursor: "pointer",
              position: "relative",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <Box
              component="input"
              type="color"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              sx={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                cursor: "pointer",
              }}
            />
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: { xs: 1.8, sm: 2.4 } }}>
      <Typography sx={{ mb: 1, fontSize: 13, fontWeight: 850, color: "text.secondary" }}>
        {title}
      </Typography>
      <Box
        sx={{
          overflow: "hidden",
          borderRadius: 1,
          border: 1,
          borderColor: "divider",
          bgcolor: (theme) =>
            theme.palette.mode === "dark"
              ? alpha("#f8fafc", 0.03)
              : alpha("#0f172a", 0.018),
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function SettingRow({
  icon,
  title,
  description,
  control,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <Box
      sx={{
        minHeight: { xs: 0, sm: 74 },
        px: { xs: 1.4, sm: 2 },
        py: { xs: 1.35, sm: 1.4 },
        display: "flex",
        alignItems: { xs: "stretch", sm: "center" },
        flexDirection: { xs: "column", sm: "row" },
        gap: { xs: 1.1, sm: 1.5 },
        borderBottom: 1,
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0 },
      }}
    >
      <Box
        sx={{
          width: { xs: "100%", sm: "auto" },
          minWidth: 0,
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          gap: 1.2,
        }}
      >
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            bgcolor: (theme) =>
              theme.palette.mode === "dark"
                ? alpha("#f8fafc", 0.06)
                : alpha("#0f172a", 0.05),
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 800, mb: 0.2 }}>{title}</Typography>
          <Typography sx={{ fontSize: 12, color: "text.secondary", lineHeight: 1.45 }}>
            {description}
          </Typography>
        </Box>
      </Box>
      <Box
        sx={{
          width: { xs: "100%", sm: "auto" },
          minWidth: 0,
          display: "flex",
          justifyContent: { xs: "flex-start", sm: "flex-end" },
        }}
      >
        {control}
      </Box>
    </Box>
  );
}

function ShortcutSettingRow({
  icon,
  title,
  description,
  value,
  conflict,
  allowSingleKey = false,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value: string;
  conflict: boolean;
  allowSingleKey?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <SettingRow
      icon={icon}
      title={title}
      description={description}
      control={
        <Box sx={{ width: { xs: "100%", sm: "min(430px, 48vw)" }, minWidth: 0, flexShrink: 0 }}>
          <ShortcutInput
            value={value}
            placeholder="未设置"
            conflict={conflict}
            conflictMessage="与其他 Todo 快捷键冲突，请更换"
            allowSingleKey={allowSingleKey}
            onChange={onChange}
          />
        </Box>
      }
    />
  );
}

function TextSettingRow({
  icon,
  title,
  description,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value: string;
  placeholder?: string;
  type?: "text" | "password";
  onChange: (value: string) => void;
}) {
  return (
    <SettingRow
      icon={icon}
      title={title}
      description={description}
      control={
        <TextField
          size="small"
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          sx={{ width: { xs: "100%", sm: 280 }, flexShrink: 0 }}
        />
      }
    />
  );
}

function NumberSettingRow({
  icon,
  title,
  description,
  value,
  min,
  max,
  onCommit,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isNaN(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    if (clamped !== value) onCommit(clamped);
    setDraft(String(clamped));
  };

  return (
    <SettingRow
      icon={icon}
      title={title}
      description={description}
      control={
        <TextField
          size="small"
          type="number"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          slotProps={{ htmlInput: { min, max, style: { textAlign: "center", width: 72 } } }}
          sx={{ width: { xs: 112, sm: "auto" }, flexShrink: 0 }}
        />
      }
    />
  );
}

function SelectSettingRow({
  icon,
  title,
  description,
  value,
  options,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value: number;
  options: { value: number; label: string }[];
  onChange: (value: number) => void;
}) {
  return (
    <SettingRow
      icon={icon}
      title={title}
      description={description}
      control={
        <TextField
          select
          size="small"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          sx={{ width: { xs: "100%", sm: 132 }, flexShrink: 0 }}
        >
          {options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      }
    />
  );
}

function SwitchSettingRow({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <SettingRow
      icon={icon}
      title={title}
      description={description}
      control={<Switch checked={checked} onChange={(_, value) => onChange(value)} />}
    />
  );
}
