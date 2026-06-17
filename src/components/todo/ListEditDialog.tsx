// Modal dialog for editing a list's name + emoji. Used by
// `ListContextMenu` after the user picks "编辑". emoji-picker-react is
// lazy-loaded so the launcher window doesn't pull its 200KB chunk just
// because the todo window exists.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Popover,
  TextField,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { EmojiStyle, Theme as EmojiTheme } from "emoji-picker-react";

import { TodoEmoji } from "./TodoEmoji";

const EmojiPicker = lazy(() => import("emoji-picker-react"));
const EMOJI_THEME_DARK = "dark" as EmojiTheme;
const EMOJI_THEME_LIGHT = "light" as EmojiTheme;
const EMOJI_STYLE_APPLE = "apple" as EmojiStyle;

interface EditableNameEmoji {
  name: string;
  emoji: string;
}

interface Props {
  list: EditableNameEmoji;
  title?: string;
  defaultEmoji?: string;
  onClose: () => void;
  onSubmit: (patch: { name?: string; emoji?: string }) => void;
}

export function ListEditDialog({
  list,
  title = "编辑清单",
  defaultEmoji = "📋",
  onClose,
  onSubmit,
}: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const [name, setName] = useState(list.name);
  const [emoji, setEmoji] = useState(list.emoji || defaultEmoji);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const submit = () => {
    onSubmit({ name: name.trim() || list.name, emoji });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1 }}>
          <Box
            onClick={(e) => setPickerAnchor(e.currentTarget)}
            sx={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: 1,
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              cursor: "pointer",
              userSelect: "none",
              flexShrink: 0,
            }}
          >
            <TodoEmoji emoji={emoji} fallback={defaultEmoji} size={24} />
          </Box>
          <TextField
            inputRef={nameRef}
            label="名称"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </Box>
        {pickerAnchor && (
          <Popover
            open
            anchorEl={pickerAnchor}
            onClose={() => setPickerAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          >
            <Suspense
              fallback={<Box sx={{ width: 350, height: 400, p: 2 }}>加载中…</Box>}
            >
              <EmojiPicker
                onEmojiClick={(d: { emoji: string }) => {
                  setEmoji(d.emoji);
                  setPickerAnchor(null);
                }}
                theme={isDark ? EMOJI_THEME_DARK : EMOJI_THEME_LIGHT}
                emojiStyle={EMOJI_STYLE_APPLE}
                lazyLoadEmojis
                searchPlaceholder="搜索 emoji"
                width={350}
                height={400}
              />
            </Suspense>
          </Popover>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={submit}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
