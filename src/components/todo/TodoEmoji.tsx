import { useState } from "react";
import { Box } from "@mui/material";

import { appleFlagEmojiUrlFromEmoji } from "./flagEmoji";

interface TodoEmojiProps {
  emoji: string | null | undefined;
  fallback?: string;
  size?: number;
}

function NativeEmojiText({ value, size }: { value: string; size: number }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size,
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
        lineHeight: 1,
      }}
    >
      {value}
    </Box>
  );
}

function AppleFlagEmoji({ value, src, size }: { value: string; src: string; size: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <NativeEmojiText value={value} size={size} />;
  }

  return (
    <Box
      component="img"
      src={src}
      alt={value}
      title={value}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      sx={{
        width: size,
        height: size,
        display: "inline-block",
        objectFit: "contain",
        lineHeight: 1,
        verticalAlign: "-0.15em",
        flexShrink: 0,
      }}
    />
  );
}

export function TodoEmoji({ emoji, fallback = "", size = 18 }: TodoEmojiProps) {
  const value = emoji || fallback;
  if (!value) return null;

  const flagUrl = appleFlagEmojiUrlFromEmoji(value);
  return flagUrl ? (
    <AppleFlagEmoji value={value} src={flagUrl} size={size} />
  ) : (
    <NativeEmojiText value={value} size={size} />
  );
}
