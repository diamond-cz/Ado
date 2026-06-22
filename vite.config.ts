import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-oxc";
import { createRequire } from "node:module";

const host = process.env.TAURI_DEV_HOST;
const require = createRequire(import.meta.url);
const rotaryKnobSource = require.resolve("react-rotary-knob/src/index.tsx");
const reactSvgmtCompat = new URL(
  "./src/components/todo/reactSvgmtCompat.ts",
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react-rotary-knob$/, replacement: rotaryKnobSource },
      { find: /^react-svgmt$/, replacement: reactSvgmtCompat },
    ],
  },
  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
