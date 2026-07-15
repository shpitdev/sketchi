import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/diagram-excalidraw",
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(["*.md"])],
  resolve: {
    alias: {
      "@sketchi/diagram-core": new URL(
        "../diagram-core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../diagram-renderer/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    name: "diagram-excalidraw",
    watch: false,
    globals: true,
    environment: "node",
    include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/diagram-excalidraw",
      provider: "v8" as const,
    },
  },
}));
