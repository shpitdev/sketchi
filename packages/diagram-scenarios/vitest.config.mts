import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/diagram-scenarios",
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
      "@sketchi/diagram-renderer": new URL(
        "../diagram-renderer/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    name: "diagram-scenarios",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/diagram-scenarios",
      provider: "v8",
    },
  },
}));
