import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../../node_modules/.vite/packages/diagram/excalidraw",
  resolve: {
    alias: {
      "@sketchi/diagram-core": new URL("../core/src/index.ts", import.meta.url)
        .pathname,
      "@sketchi/diagram-renderer": new URL(
        "../renderer/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    name: "diagram-excalidraw",
    watch: false,
    globals: true,
    environment: "node",
    include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../../coverage/packages/diagram/excalidraw",
      provider: "v8" as const,
    },
  },
}));
