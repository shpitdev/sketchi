import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reportsDirectory: new URL(
        "../../../coverage/packages/diagram/renderer",
        import.meta.url,
      ).pathname,
    },
    include: ["packages/diagram/renderer/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@sketchi/diagram-core": new URL("../core/src/index.ts", import.meta.url)
        .pathname,
    },
  },
});
