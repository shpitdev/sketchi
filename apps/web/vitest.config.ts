import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      reportsDirectory: "../../coverage/apps/web",
    },
    include: ["apps/web/src/**/*.test.ts", "apps/web/src/**/*.test.tsx"],
  },
});
