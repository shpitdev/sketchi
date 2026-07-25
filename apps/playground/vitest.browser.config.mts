import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const source = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
  cacheDir: source("../../node_modules/.vite/apps/playground-browser"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: source("./src/"),
      },
      {
        find: "@sketchi/diagram-agent",
        replacement: source("../../packages/diagram/agent/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-core",
        replacement: source("../../packages/diagram/core/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-renderer",
        replacement: source("../../packages/diagram/renderer/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-generation",
        replacement: source("../../packages/diagram/generation/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-excalidraw",
        replacement: source("../../packages/diagram/excalidraw/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-scenarios",
        replacement: source("../../packages/diagram/scenarios/src/index.ts"),
      },
      {
        find: "@sketchi/diagram-ui",
        replacement: source("../../packages/diagram/ui/src/index.ts"),
      },
    ],
  },
  test: {
    name: "playground-browser",
    watch: false,
    attachmentsDir: "../../.memory/vitest-attachments/playground",
    include: ["apps/playground/src/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      viewport: { height: 577, width: 1280 },
    },
  },
});
