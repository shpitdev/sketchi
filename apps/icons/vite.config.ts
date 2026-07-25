import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  localInspectorPort,
  localViteCacheDir,
} from "../../tools/local-dev-ports";
import { workerProjectConfig } from "../../scripts/lib/worker-apps.mjs";

const workerProject = workerProjectConfig("icons");

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  build: {
    emptyOutDir: true,
    outDir: new URL(`../../${workerProject.buildOutputPath}`, import.meta.url)
      .pathname,
  },
  cacheDir: localViteCacheDir("icons"),
  publicDir: new URL("./public", import.meta.url).pathname,
  plugins: [
    cloudflare({
      configPath: new URL("./wrangler.jsonc", import.meta.url).pathname,
      inspectorPort: localInspectorPort(6203),
      viteEnvironment: {
        name: "ssr",
      },
    }),
    tanstackStart({
      srcDirectory: "src",
    }),
    react(),
  ],
});
