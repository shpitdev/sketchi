import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { localInspectorPort, localViteCacheDir } from "../../tools/local-dev-ports";
import { excalidrawFonts } from "../../scripts/lib/excalidraw-fonts.mjs";
import { workerProjectConfig } from "../../scripts/lib/worker-apps.mjs";

const workerProject = workerProjectConfig("excalidraw");

export default defineConfig({
	root: new URL(".", import.meta.url).pathname,
	build: {
		emptyOutDir: true,
		outDir: new URL(`../../${workerProject.buildOutputPath}`, import.meta.url).pathname,
	},
	cacheDir: localViteCacheDir("excalidraw"),
	publicDir: new URL("./public", import.meta.url).pathname,
	plugins: [
		excalidrawFonts(),
		cloudflare({
			configPath: new URL("./wrangler.jsonc", import.meta.url).pathname,
			inspectorPort: localInspectorPort(6202),
			viteEnvironment: {
				name: "ssr",
			},
		}),
		tanstackStart({
			srcDirectory: "src",
		}),
		react(),
	],
	resolve: {
		alias: [
			{
				find: "@sketchi/editor/styles.css",
				replacement: new URL("../../packages/editor/src/styles.css", import.meta.url).pathname,
			},
			{
				find: "@sketchi/diagram-core",
				replacement: new URL("../../packages/diagram/core/src/index.ts", import.meta.url).pathname,
			},
			{
				find: "@sketchi/diagram-renderer",
				replacement: new URL("../../packages/diagram/renderer/src/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/drawing/excalidraw",
				replacement: new URL("../../packages/drawing/src/excalidraw/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/editor",
				replacement: new URL("../../packages/editor/src/index.ts", import.meta.url).pathname,
			},
		],
	},
});
