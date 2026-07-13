import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const aliases = [
  {
    find: "@sketchi/diagram-studio-ui/styles.css",
    replacement: new URL(
      "../../packages/diagram-studio-ui/src/styles.css",
      import.meta.url,
    ).pathname,
  },
  {
    find: "@sketchi/diagram-core",
    replacement: new URL(
      "../../packages/diagram-core/src/index.ts",
      import.meta.url,
    ).pathname,
  },
  {
    find: "@sketchi/diagram-renderer",
    replacement: new URL(
      "../../packages/diagram-renderer/src/index.ts",
      import.meta.url,
    ).pathname,
  },
  {
    find: "@sketchi/diagram-excalidraw",
    replacement: new URL(
      "../../packages/diagram-excalidraw/src/index.ts",
      import.meta.url,
    ).pathname,
  },
  {
    find: "@sketchi/diagram-studio-ui",
    replacement: new URL(
      "../../packages/diagram-studio-ui/src/index.ts",
      import.meta.url,
    ).pathname,
  },
];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      reportsDirectory: "../../coverage/apps/excalidraw",
    },
    include: ["apps/excalidraw/src/**/*.test.{ts,tsx}"],
    exclude: ["apps/excalidraw/src/**/*.browser.test.tsx"],
  },
  resolve: {
    alias: aliases,
  },
});
