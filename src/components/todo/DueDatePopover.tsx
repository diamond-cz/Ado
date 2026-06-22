// Calendar-only due-date picker. Supports both a single due time and a
// same-day time range. `value` is the point/start timestamp; `endValue`
// is optional and only committed when it is after the start.

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Popover,
  Select,
  Typography,
} from "@mui/material";
import AlarmRoundedIcon from "@mui/icons-material/AlarmRounded";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import dayjs, { type Dayjs } from "dayjs";

import { ensureTodoReminderPermission } from "./todoReminders";

interface Props {
  // Either anchor to a real DOM element or to a fixed (x, y) position.
  anchorEl?: HTMLElement | null;
  anchorPosition?: { top: number; left: number };
  value: number | null;
  endValue?: number | null;
  reminderEnabled?: boolean;
  onClose: () => void;
  onChange: (ts: number | null, endTs?: number | null, reminderEnabled?: boolean) => void;
}

const DEFAULT_RANGE_MINUTES = 60;

function normalizeEnd(start: Dayjs, end: Dayjs): Dayjs {
  return end.valueOf() > start.valueOf()
    ? end
    : start.add(DEFAULT_RANGE_MINUTES, "minute");
}

function TimeSelectRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Dayjs;
  onChange: (next: Dayjs) => void;
}) {
  return (
    <Box sx={{ px: 1, pb: 0.5, display: "flex", alignItems: "center", gap: 1 }}>
      <Typography sx={{ width: 36, fontSize: 12, color: "text.secondary" }}>
        {label}
      </Typography>
      <Select
        size="small"
        value={value.hour()}
        onChange={(e) => onChange(value.hour(Number(e.target.value)))}
        sx={{ minWidth: 70 }}
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 240 } } } }}
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <MenuItem key={i} value={i}>
            {i.toString().padStart(2, "0")}
          </MenuItem>
        ))}
      </Select>
      <Typography>:</Typography>
      <Select
        size="small"
        value={value.minute()}
        onChange={(e) => onChange(value.minute(Number(e.target.value)))}
        sx={{ minWidth: 70 }}
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 240 } } } }}
      >
        {Array.from({ length: 60 }).map((_, i) => (
          <MenuItem key={i} value={i}>
            {i.toString().padStart(2, "0")}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}

export function DueDatePopover({
  anchorEl,
  anchorPosition,
  value,
  endValue,
  reminderEnabled = false,
  onClose,
  onChange,
}: Props) {
  const initialStart = useMemo(
    () => (value != null ? dayjs(value) : dayjs()),
    [value],
  );
  const initialEnd = useMemo(
    () =>
      value != null && endValue != null && endValue > value
        ? dayjs(endValue)
        : initialStart.add(DEFAULT_RANGE_MINUTES, "minute"),
    [endValue, initialStart, value],
  );

  const [draftStart, setDraftStart] = useState<Dayjs>(initialStart);
  const [draftEnd, setDraftEnd] = useState<Dayjs>(initialEnd);
  const [rangeMode, setRangeMode] = useState(
    value != null && endValue != null && endValue > value,
  );
  const [draftReminderEnabled, setDraftReminderEnabled] = useState(
    value != null && reminderEnabled,
  );

  // Reset draft when the popover re-opens against a different item.
  useEffect(() => {
    setDraftStart(initialStart);
    setDraftEnd(initialEnd);
    setRangeMode(value != null && endValue != null && endValue > value);
    setDraftReminderEnabled(value != null && reminderEnabled);
  }, [endValue, initialEnd, initialStart, reminderEnabled, value]);

  const usePosition = !anchorEl && !!anchorPosition;
  const commit = () => {
    const start = draftStart.second(0).millisecond(0);
    const end = normalizeEnd(start, draftEnd.second(0).millisecond(0));
    onChange(start.valueOf(), rangeMode ? end.valueOf() : null, draftReminderEnabled);
    onClose();
  };

  return (
    <Popover
      open
      container={document.body}
      anchorEl={anchorEl ?? undefined}
      anchorReference={usePosition ? "anchorPosition" : "anchorEl"}
      anchorPosition={anchorPosition}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      marginThreshold={8}
      slotProps={{
        paper: {
          sx: {
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            overscrollBehavior: "contain",
          },
        },
      }}
    >
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box sx={{ p: 1, display: "flex", flexDirection: "column", gap: 0.5, minWidth: 300 }}>
          <DateCalendar
            value={draftStart}
            onChange={(d) => {
              if (!d) return;
              const duration = Math.max(draftEnd.valueOf() - draftStart.valueOf(), 0);
              const nextStart = d.hour(draftStart.hour()).minute(draftStart.minute());
              setDraftStart(nextStart);
              setDraftEnd(nextStart.add(duration || DEFAULT_RANGE_MINUTES * 60 * 1000, "millisecond"));
            }}
            sx={{
              width: "100%",
              maxHeight: 320,
              "& .MuiPickersDay-today": {
                borderColor: "primary.main",
                fontWeight: 700,
              },
            }}
          />
          <Box sx={{ px: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={rangeMode}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setRangeMode(checked);
                      if (checked) {
                        setDraftEnd((end) => normalizeEnd(draftStart, end));
                      }
                    }}
                  />
                }
                label={<Typography sx={{ fontSize: 12 }}>时间段</Typography>}
                sx={{ mr: 0 }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={draftReminderEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      if (!checked) {
                        setDraftReminderEnabled(false);
                        return;
                      }
                      void ensureTodoReminderPermission().then((granted) => {
                        setDraftReminderEnabled(granted);
                      });
                    }}
                  />
                }
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                    <AlarmRoundedIcon sx={{ fontSize: 15, color: "warning.main" }} />
                    <Typography sx={{ fontSize: 12 }}>提醒</Typography>
                  </Box>
                }
                sx={{ mr: 0 }}
              />
            </Box>
          </Box>
          <TimeSelectRow label={rangeMode ? "开始" : "时间"} value={draftStart} onChange={setDraftStart} />
          {rangeMode && (
            <TimeSelectRow
              label="结束"
              value={normalizeEnd(draftStart, draftEnd)}
              onChange={(next) => setDraftEnd(normalizeEnd(draftStart, next))}
            />
          )}
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", px: 1, pb: 0.5 }}>
            <Button
              size="small"
              onClick={() => {
                onChange(null, null, false);
                onClose();
              }}
            >
              清除
            </Button>
            <Button size="small" variant="contained" onClick={commit}>
              确定
            </Button>
          </Box>
        </Box>
      </LocalizationProvider>
    </Popover>
  );
}
