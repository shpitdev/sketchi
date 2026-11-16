import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { localInspectorPort, localViteCacheDir } from "../../tools/local-dev-ports";
import { excalidrawFonts } from "../../scripts/lib/excalidraw-fonts.mjs";
import { workerProjectConfig } from "../../scripts/lib/worker-apps.mjs";

const workerProject = workerProjectConfig("playground");

const playgroundServerSourceSegment = "/apps/studio/src/server/";

function enforceClientServerBoundary(): Plugin {
	return {
		name: "playground-client-server-boundary",
		apply: "build",
		applyToEnvironment: (environment) => environment.name === "client",
		generateBundle(_options, bundle) {
			const serverModuleIds = Object.values(bundle)
				.flatMap((output) => (output.type === "chunk" ? Object.keys(output.modules) : []))
				.map((moduleId) => moduleId.replaceAll("\\", "/"))
				.filter(
					(moduleId) =>
						moduleId.includes(playgroundServerSourceSegment) ||
						/\/apps\/playground\/src\/features\/.*\.server\./.test(moduleId),
				);

			if (serverModuleIds.length > 0) {
				this.error(
					`Playground server modules entered the client bundle:\n${serverModuleIds.join("\n")}`,
				);
			}
		},
	};
}

export default defineConfig({
	root: new URL(".", import.meta.url).pathname,
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
	cacheDir: localViteCacheDir("playground"),
	publicDir: new URL("./public", import.meta.url).pathname,
	plugins: [
		excalidrawFonts(),
		enforceClientServerBoundary(),
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
				replacement: new URL("../../packages/diagram/scenarios/src/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/icon-draw",
				replacement: new URL("../../packages/icons/draw/src/index.ts", import.meta.url).pathname,
			},
			{
				find: "@sketchi/editor/styles.css",
				replacement: new URL("../../packages/editor/src/styles.css", import.meta.url).pathname,
			},
			{
				find: "@sketchi/editor",
				replacement: new URL("../../packages/editor/src/index.ts", import.meta.url).pathname,
			},
		],
	},
});
