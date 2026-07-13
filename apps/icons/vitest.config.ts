import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      reportsDirectory: "../../coverage/apps/icons",
    },
    include: ["apps/icons/src/**/*.test.{ts,tsx}"],
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
        find: "@sketchi/diagram-studio-ui",
        replacement: new URL(
          "../../packages/diagram-studio-ui/src/index.ts",
          import.meta.url,
        ).pathname,
      },
    ],
  },
});
