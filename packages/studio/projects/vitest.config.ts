import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      reportsDirectory: "../../../coverage/packages/studio/projects",
    },
    include: ["packages/studio/projects/src/**/*.test.ts"],
  },
});
