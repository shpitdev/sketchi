import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sketchi/diagram-core": fileURLToPath(
        new URL("../diagram-core/src/index.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["convex/**/*.test.ts", "lib/**/*.test.ts"],
    testTimeout: 30_000,
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
