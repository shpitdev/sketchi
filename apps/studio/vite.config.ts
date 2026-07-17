import codemode from "@cloudflare/codemode/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

import {
  localInspectorPort,
  localViteCacheDir,
} from "../../tools/local-dev-ports";
import { workerAppConfig } from "../../scripts/lib/worker-apps.mjs";

const workerApp = workerAppConfig("studio");

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  build: {
    emptyOutDir: true,
    outDir: new URL(`../../${workerApp.buildOutputPath}`, import.meta.url)
      .pathname,
  },
  cacheDir: localViteCacheDir("studio"),
  publicDir: new URL("./public", import.meta.url).pathname,
  plugins: [
    agents(),
    codemode(),
    cloudflare({
      configPath: new URL("./wrangler.jsonc", import.meta.url).pathname,
      inspectorPort: localInspectorPort(6210),
      viteEnvironment: {
        name: "ssr",
      },
    }),
    tanstackStart({
      router: {
        quoteStyle: "double",
        semicolons: true,
      },
      srcDirectory: "src",
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: new URL("./src/", import.meta.url).pathname,
      },
      {
        find: "@sketchi/diagram-agent",
        replacement: new URL(
          "../../packages/diagram-agent/src/index.ts",
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
        find: "@sketchi/diagram-studio-ui/styles.css",
        replacement: new URL(
          "../../packages/diagram-studio-ui/src/styles.css",
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
