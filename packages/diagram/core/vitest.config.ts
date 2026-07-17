import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reportsDirectory: new URL(
        "../../../coverage/packages/diagram/core",
        import.meta.url,
      ).pathname,
    },
    include: ["packages/diagram/core/src/**/*.test.ts"],
  },
});
