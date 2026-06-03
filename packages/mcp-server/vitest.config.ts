import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sketchi/diagram-agent-tools": new URL(
        "../diagram-agent-tools/src/index.ts",
        import.meta.url
      ).pathname,
      "@sketchi/diagram-exporter": new URL(
        "../diagram-exporter/src/index.ts",
        import.meta.url
      ).pathname,
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "../../coverage/packages/mcp-server",
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
