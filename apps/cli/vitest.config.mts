import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/apps/cli",
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(["*.md"])],
  resolve: {
    alias: {
      "@sketchi/diagram-agent": new URL(
        "../../packages/diagram/agent/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-core": new URL(
        "../../packages/diagram/core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-excalidraw": new URL(
        "../../packages/diagram/excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-generation": new URL(
        "../../packages/diagram/generation/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../../packages/diagram/renderer/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    name: "sketchi-cli",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/apps/cli",
      provider: "v8",
    },
  },
}));
