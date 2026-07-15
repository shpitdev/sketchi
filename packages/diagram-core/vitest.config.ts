import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reportsDirectory: "../../coverage/packages/diagram-core"
    },
    include: ["packages/diagram-core/src/**/*.test.ts"]
  }
});
