import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/svg-excalidraw-browser",
  test: {
    name: "svg-excalidraw-browser",
    watch: false,
    attachmentsDir: "../../.memory/vitest-attachments/svg-excalidraw",
    include: ["tests/browser-determinism.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
