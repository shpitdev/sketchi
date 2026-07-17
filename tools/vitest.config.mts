import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sketchi/diagram-core": new URL(
        "../packages/diagram-core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-excalidraw": new URL(
        "../packages/diagram-excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-generation": new URL(
        "../packages/diagram-generation/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../packages/diagram-renderer/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-scenarios": new URL(
        "../packages/diagram-scenarios/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    name: "tools",
    environment: "node",
    include: ["tools/**/*.test.ts"],
    exclude: ["tools/*/src/**", "tools/*/tests/**"],
  },
});
