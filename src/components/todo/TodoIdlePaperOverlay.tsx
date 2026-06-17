import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";

import type { TodoIdleLightEffectMode } from "../../state/store";

const DEFAULT_IDLE_DELAY_MS = 10_000;
const ACTIVITY_THROTTLE_MS = 250;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const DEFAULT_DARK_VIDEO_SRC = "/moon.mp4";
const DEFAULT_LIGHT_VIDEO_SOURCES = ["/leaves.mp4", "/rain.mp4"] as const;
const LIGHT_VIDEO_BY_EFFECT: Record<Exclude<TodoIdleLightEffectMode, "random">, string> = {
  leaves: "/leaves.mp4",
  rain: "/rain.mp4",
};

interface TodoIdlePaperOverlayProps {
  enabled?: boolean;
  isDark: boolean;
  lightEffectMode?: TodoIdleLightEffectMode;
  idleDelayMs?: number;
  darkVideoSrc?: string;
  lightVideoSources?: readonly string[];
}

interface IdleOverlayState {
  idle: boolean;
  videoSrc: string;
}

function randomSource(sources: readonly string[]): string {
  return sources[Math.floor(Math.random() * sources.length)] ?? DEFAULT_LIGHT_VIDEO_SOURCES[0];
}

export function TodoIdlePaperOverlay({
  enabled = true,
  isDark,
  lightEffectMode = "random",
  idleDelayMs = DEFAULT_IDLE_DELAY_MS,
  darkVideoSrc = DEFAULT_DARK_VIDEO_SRC,
  lightVideoSources = DEFAULT_LIGHT_VIDEO_SOURCES,
}: TodoIdlePaperOverlayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const idleRef = useRef(false);
  const lastActivityAtRef = useRef(0);
  const [overlayState, setOverlayState] = useState<IdleOverlayState>({
    idle: false,
    videoSrc: darkVideoSrc,
  });
  const { idle, videoSrc } = overlayState;

  useEffect(() => {
    idleRef.current = idle;
  }, [idle]);

  const resolveIdleVideoSrc = () => {
    if (isDark) return darkVideoSrc;
    if (lightEffectMode !== "random") return LIGHT_VIDEO_BY_EFFECT[lightEffectMode];

    const sources = lightVideoSources.length > 0
      ? lightVideoSources
      : DEFAULT_LIGHT_VIDEO_SOURCES;
    return randomSource(sources);
  };

  useEffect(() => {
    if (!enabled) {
      idleRef.current = false;
      setOverlayState((state) => (state.idle ? { ...state, idle: false } : state));
      return;
    }

    const clearIdleTimer = () => {
      if (idleTimerRef.current == null) return;
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    };

    const scheduleIdle = () => {
      clearIdleTimer();
      if (document.hidden) return;
      idleTimerRef.current = window.setTimeout(() => {
        idleRef.current = true;
        setOverlayState({
          idle: true,
          videoSrc: resolveIdleVideoSrc(),
        });
      }, idleDelayMs);
    };

    const markActivity = () => {
      const now = performance.now();
      if (!idleRef.current && now - lastActivityAtRef.current < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastActivityAtRef.current = now;
      if (idleRef.current) {
        idleRef.current = false;
        setOverlayState((state) => ({ ...state, idle: false }));
      }
      scheduleIdle();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearIdleTimer();
        idleRef.current = false;
        setOverlayState((state) => ({ ...state, idle: false }));
        return;
      }
      markActivity();
    };

    const activityEvents = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
      "touchmove",
      "mousedown",
      "scroll",
      "resize",
      "focus",
    ] as const;

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { capture: true, passive: true });
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleIdle();

    return () => {
      clearIdleTimer();
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity, { capture: true });
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [darkVideoSrc, enabled, idleDelayMs, isDark, lightEffectMode, lightVideoSources]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (enabled && idle) {
      let cancelled = false;
      let retryTimer: number | null = null;

      const play = () => {
        if (cancelled) return;
        video.play().catch(() => {
          /* Muted autoplay can still be blocked by some webview policies. */
        });
      };
      const playWhenReady = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          play();
          return;
        }
        video.load();
        video.addEventListener("canplay", play, { once: true });
        retryTimer = window.setTimeout(play, 200);
      };

      playWhenReady();

      return () => {
        cancelled = true;
        video.removeEventListener("canplay", play);
        if (retryTimer != null) window.clearTimeout(retryTimer);
      };
    }

    video.pause();
  }, [enabled, idle, videoSrc]);

  if (!enabled) return null;

  return (
    <Box
      aria-hidden
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        overflow: "hidden",
        pointerEvents: "none",
        opacity: idle ? 1 : 0,
        transition: `opacity 900ms ${EASE_OUT}`,
        willChange: "opacity",
      }}
    >
      <Box
        component="video"
        ref={videoRef}
        src={videoSrc}
        loop
        muted
        playsInline
        preload="none"
        sx={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "top",
          mixBlendMode: isDark ? "normal" : "multiply",
          opacity: isDark ? 0.52 : 0.42,
          filter: isDark
            ? "grayscale(1) contrast(0.92) brightness(1.04) blur(0.2px)"
            : "grayscale(1) contrast(0.86) brightness(1.08) blur(0.2px)",
        }}
      />
    </Box>
  );
}
