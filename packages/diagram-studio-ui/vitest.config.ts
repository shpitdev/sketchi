import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      reportsDirectory: "../../coverage/packages/diagram-studio-ui",
    },
    include: ["packages/diagram-studio-ui/src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@sketchi/diagram-core": new URL(
        "../diagram-core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-excalidraw": new URL(
        "../diagram-excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-generation": new URL(
        "../diagram-generation/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../diagram-renderer/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-scenarios": new URL(
        "../diagram-scenarios/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
