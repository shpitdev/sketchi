import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "tools",
    environment: "node",
    include: ["tools/**/*.test.ts"],
    exclude: ["tools/*/src/**", "tools/*/tests/**"],
  },
});
