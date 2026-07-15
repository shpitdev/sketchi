import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  localInspectorPort,
  localViteCacheDir,
} from "../../tools/local-dev-ports";

export default defineConfig({
  cacheDir: localViteCacheDir("playground"),
  publicDir: new URL("./public", import.meta.url).pathname,
  plugins: [
    cloudflare({
      configPath: new URL("./wrangler.jsonc", import.meta.url).pathname,
      inspectorPort: localInspectorPort(6200),
      viteEnvironment: {
        name: "ssr",
      },
    }),
    tanstackStart({
      srcDirectory: "apps/playground/src",
    }),
    react(),
  ],
  resolve: {
    alias: [
      {
        find: "@sketchi/diagram-studio-ui/styles.css",
        replacement: new URL(
          "../../packages/diagram-studio-ui/src/styles.css",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@sketchi/diagram-core",
        replacement: new URL(
          "../../packages/diagram-core/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@sketchi/diagram-renderer",
        replacement: new URL(
          "../../packages/diagram-renderer/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@sketchi/diagram-generation",
        replacement: new URL(
          "../../packages/diagram-generation/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@sketchi/diagram-excalidraw",
        replacement: new URL(
          "../../packages/diagram-excalidraw/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@sketchi/diagram-scenarios",
        replacement: new URL(
          "../../packages/diagram-scenarios/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@sketchi/diagram-studio-ui",
        replacement: new URL(
          "../../packages/diagram-studio-ui/src/index.ts",
          import.meta.url,
        ).pathname,
      },
    ],
  },
});
