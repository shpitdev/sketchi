import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/packages/svg-excalidraw-browser",
  test: {
    name: "svg-excalidraw-browser",
    watch: false,
    attachmentsDir: "../../.memory/vitest-attachments/svg-excalidraw",
    include: ["tests/browser-determinism.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(
        executablePath === undefined
          ? {}
          : { launchOptions: { executablePath } },
      ),
      instances: [{ browser: "chromium" }],
    },
  },
});
