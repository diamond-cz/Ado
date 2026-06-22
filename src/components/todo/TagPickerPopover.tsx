// Tag editor popover. Shows a free-form text input for creating a new
// tag and a list of existing tags (cross-item) the user can toggle on
// the active task. Existing tags pulled from the store via
// `collectAllTags` so newly-created ones immediately become reusable.

import { useMemo, useState, type KeyboardEvent } from "react";
import {
  Box,
  Chip,
  Divider,
  Popover,
  TextField,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";

import { useTodoStore, collectAllTags } from "./useTodoStore";

interface Props {
  itemId: string;
  anchorEl?: HTMLElement | null;
  anchorPosition?: { top: number; left: number };
  onClose: () => void;
}

export function TagPickerPopover({ itemId, anchorEl, anchorPosition, onClose }: Props) {
  const items = useTodoStore((s) => s.items);
  const addTag = useTodoStore((s) => s.addTag);
  const removeTag = useTodoStore((s) => s.removeTag);

  const item = items.find((it) => it.id === itemId) ?? null;
  const allTags = useMemo(() => collectAllTags(items), [items]);
  const itemTagSet = useMemo(() => new Set(item?.tags ?? []), [item]);
  const [draft, setDraft] = useState("");

  if (!item) return null;

  const submitNew = () => {
    const v = draft.trim();
    if (!v) return;
    addTag(itemId, v);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitNew();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const useAnchorEl = anchorEl != null;
  return (
    <Popover
      open
      container={document.body}
      onClose={onClose}
      marginThreshold={8}
      {...(useAnchorEl
        ? { anchorEl, anchorOrigin: { vertical: "bottom", horizontal: "left" } as const }
        : {
            anchorReference: "anchorPosition" as const,
            anchorPosition: anchorPosition ?? { top: 0, left: 0 },
          })}
      slotProps={{
        paper: {
          sx: {
            width: 260,
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            overscrollBehavior: "contain",
            p: 1.2,
          },
        },
      }}
    >
      <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 0.6, px: 0.4 }}>
        标签
      </Typography>
      <TextField
        size="small"
        autoFocus
        fullWidth
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={submitNew}
        placeholder="输入标签名后回车"
      />
      {item.tags.length > 0 && (
        <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {item.tags.map((t) => (
            <Chip
              key={t}
              size="small"
              label={`#${t}`}
              onDelete={() => removeTag(itemId, t)}
              sx={{ height: 22, fontSize: 11 }}
            />
          ))}
        </Box>
      )}
      {allTags.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography sx={{ fontSize: 11, color: "text.disabled", mb: 0.5, px: 0.4 }}>
            已有标签（点击切换）
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {allTags.map((t) => {
              const active = itemTagSet.has(t);
              return (
                <Chip
                  key={t}
                  size="small"
                  variant={active ? "filled" : "outlined"}
                  color={active ? "primary" : "default"}
                  label={`#${t}`}
                  onClick={() => {
                    if (active) removeTag(itemId, t);
                    else addTag(itemId, t);
                  }}
                  sx={{
                    height: 22,
                    fontSize: 11,
                    bgcolor: active ? undefined : alpha("#0f172a", 0.04),
                  }}
                />
              );
            })}
          </Box>
        </>
      )}
    </Popover>
  );
}
