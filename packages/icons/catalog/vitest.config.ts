import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reportsDirectory: new URL(
        "../../../coverage/packages/icons/catalog",
        import.meta.url,
      ).pathname,
    },
    include: ["packages/icons/catalog/src/**/*.test.ts"],
  },
});
