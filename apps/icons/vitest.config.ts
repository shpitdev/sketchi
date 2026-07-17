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
        find: "@sketchi/diagram-ui/styles.css",
        replacement: new URL(
          "../../packages/diagram/ui/src/styles.css",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@sketchi/diagram-ui",
        replacement: new URL(
          "../../packages/diagram/ui/src/index.ts",
          import.meta.url,
        ).pathname,
      },
    ],
  },
});
