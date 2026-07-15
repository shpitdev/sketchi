import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  localInspectorPort,
  localViteCacheDir,
} from "../../tools/local-dev-ports";

export default defineConfig({
  cacheDir: localViteCacheDir("web"),
  publicDir: new URL("./public", import.meta.url).pathname,
  plugins: [
    cloudflare({
      configPath: new URL("./wrangler.jsonc", import.meta.url).pathname,
      inspectorPort: localInspectorPort(6201),
      viteEnvironment: {
        name: "ssr",
      },
    }),
    tanstackStart({
      srcDirectory: "apps/web/src",
    }),
    react(),
  ],
});
