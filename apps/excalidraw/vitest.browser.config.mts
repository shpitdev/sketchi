import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const source = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
  cacheDir: "../../node_modules/.vite/apps/excalidraw-browser",
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@sketchi/diagram-studio-ui/styles.css",
        replacement: source("../../packages/diagram-studio-ui/src/styles.css"),
      },
      {
        find: "@sketchi/diagram-core",
        replacement: source("../../packages/diagram-core/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-renderer",
        replacement: source("../../packages/diagram-renderer/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-excalidraw",
        replacement: source("../../packages/diagram-excalidraw/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-studio-ui",
        replacement: source("../../packages/diagram-studio-ui/src/index.ts"),
      },
      {
        find: "@sketchi/svg-excalidraw",
        replacement: source("../../packages/svg-excalidraw/src/index.ts"),
      },
    ],
  },
  test: {
    name: "excalidraw-browser",
    watch: false,
    attachmentsDir: "../../.memory/vitest-attachments/excalidraw",
    include: ["apps/excalidraw/src/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
