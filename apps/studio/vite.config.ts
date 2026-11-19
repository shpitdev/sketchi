import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { localInspectorPort, localViteCacheDir } from "../../tools/local-dev-ports";
import { excalidrawFonts } from "../../tools/ops/src/vite/excalidraw-fonts";
import { clientServerBoundary } from "../../tools/ops/src/vite/client-server-boundary";
import { workerProjectConfig } from "../../tools/ops/src/workers";

const workerProject = workerProjectConfig("studio");
const devPort = 6210;

export default defineConfig({
	root: new URL(".", import.meta.url).pathname,
	server: { host: "127.0.0.1", port: devPort, strictPort: true },
	preview: { strictPort: false },
	build: {
		emptyOutDir: true,
		outDir: new URL(`../../${workerProject.buildOutputPath}`, import.meta.url).pathname,
	},
	environments: {
		ssr: {
			build: {
				// Keep Worker stack mappings within Cloudflare's 60 MiB limit.
				// Original source text remains in the matching repository/dependency revision.
				rolldownOptions: { output: { sourcemapExcludeSources: true } },
			},
		},
	},
	cacheDir: localViteCacheDir("studio"),
	publicDir: new URL("./public", import.meta.url).pathname,
	plugins: [
		excalidrawFonts(),
		clientServerBoundary(workerProject.projectId),
		cloudflare({
			configPath: new URL("./wrangler.jsonc", import.meta.url).pathname,
			inspectorPort: localInspectorPort(devPort),
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
				find: "@sketchi/diagrams",
				replacement: new URL("../../packages/diagrams/src/", import.meta.url).pathname.slice(0, -1),
			},
			{
				find: "@sketchi/cloudflare",
				replacement: new URL("../../packages/cloudflare/src/", import.meta.url).pathname.slice(
					0,
					-1,
				),
			},
			{
				find: /^@\//,
				replacement: new URL("./src/", import.meta.url).pathname,
			},
			{
				find: /^@sketchi\/ui\/(.*)$/,
				replacement: `${new URL("../../packages/ui/src/", import.meta.url).pathname}$1`,
			},
			{
				find: "@sketchi/drawing/excalidraw",
				replacement: new URL("../../packages/drawing/src/excalidraw/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/diagram-scenarios",
				replacement: new URL("../../tools/scenarios/src/index.ts", import.meta.url).pathname,
			},
			{
				find: "@sketchi/icon-draw/http-api",
				replacement: new URL("../../packages/icons/draw/src/http-api.ts", import.meta.url).pathname,
			},
			{
				find: "@sketchi/icon-draw",
				replacement: new URL("../../packages/icons/draw/src/index.ts", import.meta.url).pathname,
			},
			{
				find: "@sketchi/editor-surface/styles.css",
				replacement: new URL("../../packages/editor-surface/src/styles.css", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/editor-surface",
				replacement: new URL("../../packages/editor-surface/src/index.ts", import.meta.url)
					.pathname,
			},
		],
	},
});
