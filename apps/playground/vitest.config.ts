import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      reportsDirectory: "../../coverage/apps/playground",
    },
    include: [
      "apps/playground/src/**/*.test.ts",
      "apps/playground/src/**/*.test.tsx",
    ],
    passWithNoTests: true,
  },
  resolve: {
    alias: [
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
        find: "@sketchi/diagram-generation",
        replacement: new URL(
          "../../packages/diagram-generation/src/index.ts",
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
        find: "@sketchi/diagram-scenarios",
        replacement: new URL(
          "../../packages/diagram-scenarios/src/index.ts",
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
    ],
  },
});
