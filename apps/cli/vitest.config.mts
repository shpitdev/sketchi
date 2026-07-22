import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const excalifontDirectory = new URL(
  "./node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont/",
  import.meta.url,
);
const excalifontFiles = [
  "Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2",
  "Excalifont-Regular-be310b9bcd4f1a43f571c46df7809174.woff2",
  "Excalifont-Regular-b9dcf9d2e50a1eaf42fc664b50a3fd0d.woff2",
  "Excalifont-Regular-41b173a47b57366892116a575a43e2b6.woff2",
  "Excalifont-Regular-3f2c5db56cc93c5a6873b1361d730c16.woff2",
  "Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2",
  "Excalifont-Regular-623ccf21b21ef6b3a0d87738f77eb071.woff2",
];

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/apps/cli",
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(["*.md"])],
  resolve: {
    alias: {
      "@excalidraw/excalidraw": new URL(
        "./node_modules/@excalidraw/excalidraw/dist/dev/index.js",
        import.meta.url,
      ).pathname,
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
    conditions: ["development"],
  },
  define: {
    __SKETCHI_EXCALIFONT_BASE64__: JSON.stringify(
      excalifontFiles.map((file) =>
        readFileSync(new URL(file, excalifontDirectory)).toString("base64"),
      ),
    ),
    __SKETCHI_RESVG_WASM_BASE64__: JSON.stringify(
      readFileSync(
        new URL(
          "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
          import.meta.url,
        ),
      ).toString("base64"),
    ),
  },
  test: {
    name: "sketchi-cli",
    watch: false,
    globals: true,
    environment: "node",
    server: { deps: { inline: true as const } },
    include: ["src/**/*.{test,spec}.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/apps/cli",
      provider: "v8",
    },
  },
}));
