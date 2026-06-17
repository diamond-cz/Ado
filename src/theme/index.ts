import { createTheme, ThemeOptions } from "@mui/material/styles";

const baseOptions: ThemeOptions = {
  typography: {
    fontFamily:
      'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    fontSize: 13,
  },
  shape: { borderRadius: 4 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Body kept transparent so the launcher window's transparent flag
        // shows the desktop wallpaper through. Each top-level layout sets
        // its own opaque bg where opacity is desired.
        body: { overflow: "hidden", userSelect: "none", background: "transparent" },
        "*::-webkit-scrollbar": { width: 8, height: 8 },
        "*::-webkit-scrollbar-thumb": {
          background: "rgba(127,127,127,0.4)",
          borderRadius: 4,
        },
      },
    },
    MuiTable: { defaultProps: { size: "small" } },
    MuiTableCell: {
      styleOverrides: { root: { padding: "4px 8px", fontSize: 12 } },
    },
    MuiTooltip: { defaultProps: { arrow: true, enterDelay: 400 } },
    MuiButton: { defaultProps: { disableElevation: true, size: "small" } },
    MuiListItemButton: { styleOverrides: { root: { padding: "2px 8px" } } },
  },
};

export function buildTheme(mode: "light" | "dark", accent: string) {
  if (mode === "dark") {
    return createTheme({
      ...baseOptions,
      palette: {
        mode: "dark",
        primary: { main: accent },
        // Match the measured Todo dark surface so launcher, aecx-lite,
        // converter, and Todo start from the same navy tone.
        background: { default: "#20293a", paper: "#20293a" },
      },
    });
  }
  return createTheme({
    ...baseOptions,
    palette: {
      mode: "light",
      primary: { main: accent },
      background: { default: "#ffffff", paper: "#ffffff" },
    },
  });
}
