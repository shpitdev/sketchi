import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { localInspectorPort, localViteCacheDir } from "../../tools/build-config/local-dev-ports";
import { workerProjectConfig } from "../../tools/build-config/workers";

const workerProject = workerProjectConfig("icons");
const devPort = 6203;

export default defineConfig({
	root: new URL(".", import.meta.url).pathname,
	server: { host: "127.0.0.1", port: devPort, strictPort: true },
	preview: { strictPort: false },
	build: {
		emptyOutDir: true,
		outDir: new URL(`../../${workerProject.buildOutputPath}`, import.meta.url).pathname,
	},
	cacheDir: localViteCacheDir("icons"),
	publicDir: new URL("./public", import.meta.url).pathname,
	plugins: [
		cloudflare({
			configPath: new URL("./wrangler.jsonc", import.meta.url).pathname,
			inspectorPort: localInspectorPort(devPort),
			viteEnvironment: {
				name: "ssr",
			},
		}),
		tanstackStart({
			srcDirectory: "src",
		}),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: [
			{
				find: /^@sketchi\/ui\/(.*)$/,
				replacement: `${new URL("../../packages/ui/src/", import.meta.url).pathname}$1`,
			},
		],
	},
});
