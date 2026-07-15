import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reportsDirectory: "../../coverage/packages/diagram-renderer"
    },
    include: ["packages/diagram-renderer/src/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@sketchi/diagram-core": new URL(
        "../diagram-core/src/index.ts",
        import.meta.url
      ).pathname
    }
  }
});
