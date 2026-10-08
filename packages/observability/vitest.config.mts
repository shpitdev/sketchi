import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/packages/observability",
  test: {
    name: "observability",
    watch: false,
    globals: true,
    environment: "node",
    include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/observability",
      provider: "v8",
    },
  },
}));
