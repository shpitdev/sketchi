import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/svg-excalidraw-corpus",
  plugins: [nxCopyAssetsPlugin(["*.md"])],
  resolve: {
    alias: {
      "@excalidraw/excalidraw": new URL(
        "./node_modules/@excalidraw/excalidraw/dist/dev/index.js",
        import.meta.url,
      ).pathname,
    },
    conditions: ["development"],
  },
  test: {
    name: "svg-excalidraw-corpus",
    watch: false,
    globals: true,
    environment: "jsdom",
    server: { deps: { inline: true as const } },
    setupFiles: ["./tests/setup-excalidraw.ts"],
    include: ["tests/native-corpus-renderer.test.ts"],
    reporters: ["default"],
  },
});
