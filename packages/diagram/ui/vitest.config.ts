import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      reportsDirectory: new URL(
        "../../../coverage/packages/diagram/ui",
        import.meta.url,
      ).pathname,
    },
    include: ["packages/diagram/ui/src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@sketchi/diagram-core": new URL("../core/src/index.ts", import.meta.url)
        .pathname,
      "@sketchi/diagram-excalidraw": new URL(
        "../excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-generation": new URL(
        "../generation/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../renderer/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-scenarios": new URL(
        "../scenarios/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
