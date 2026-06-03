import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "../../coverage/packages/diagram-agent-tools",
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
