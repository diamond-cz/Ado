import type { MouseEvent, ReactNode } from "react";
import { Box, IconButton } from "@mui/material";
import { alpha } from "@mui/material/styles";

export const TODO_HOVER_COUNT_CLASS = "todo-hover-action-count";
export const TODO_HOVER_ACTION_CLASS = "todo-hover-action-button";

const HOVER_TRAILING_SLOT_WIDTH = 15;
const HOVER_TRAILING_ACTION_WIDTH = 18;

export function hoverCountActionParentSx() {
  return {
    [`&:hover .${TODO_HOVER_COUNT_CLASS}, &:focus-within .${TODO_HOVER_COUNT_CLASS}`]: {
      opacity: 0,
      transform: "scale(0.84)",
    },
    [`&:hover .${TODO_HOVER_ACTION_CLASS}, &:focus-within .${TODO_HOVER_ACTION_CLASS}`]: {
      opacity: 1,
      transform: "scale(1)",
      pointerEvents: "auto",
    },
  };
}

export function HoverCountActionSlot({
  count,
  isDark,
  icon,
  onClick,
  showZeroCount = false,
  actionLabel,
}: {
  count: number;
  isDark: boolean;
  icon: ReactNode;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  showZeroCount?: boolean;
  actionLabel?: string;
}) {
  const showCount = showZeroCount || count > 0;

  return (
    <Box
      sx={{
        width: HOVER_TRAILING_SLOT_WIDTH,
        height: 24,
        flexShrink: 0,
        position: "relative",
        display: "grid",
        placeItems: "center",
      }}
    >
      <Box
        className={TODO_HOVER_COUNT_CLASS}
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          opacity: showCount ? 1 : 0,
          transform: "scale(1)",
          transition: "opacity 120ms ease, transform 120ms ease",
          pointerEvents: "none",
        }}
      >
        {showCount && <CountBadge count={count} isDark={isDark} />}
      </Box>
      <IconButton
        className={TODO_HOVER_ACTION_CLASS}
        size="small"
        aria-label={actionLabel}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        sx={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: HOVER_TRAILING_ACTION_WIDTH,
          height: 24,
          p: 0,
          my: "auto",
          opacity: 0,
          transform: "scale(0.84)",
          pointerEvents: "none",
          transition: "opacity 120ms ease, transform 120ms ease",
          border: 0,
          bgcolor: "transparent",
          boxShadow: "none",
          "&:hover": { bgcolor: "transparent", boxShadow: "none" },
          "&:focus-visible": { outline: "none", boxShadow: "none" },
        }}
      >
        {icon}
      </IconButton>
    </Box>
  );
}

export function CountBadge({ count, isDark }: { count: number; isDark: boolean }) {
  return (
    <Box
      sx={{
        minWidth: 18,
        height: 20,
        px: 0.2,
        border: 0,
        borderRadius: 0,
        fontSize: 11,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
        color: alpha(isDark ? "#f8fafc" : "#0f172a", isDark ? 0.58 : 0.46),
        bgcolor: "transparent",
        boxShadow: "none",
      }}
    >
      {count}
    </Box>
  );
}
