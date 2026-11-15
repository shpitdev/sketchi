import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
	root: import.meta.dirname,
	cacheDir: "../../node_modules/.vite/tools/icon-batch",
	resolve: {
		alias: {
			"@sketchi/cloudflare": new URL(
				"../../packages/cloudflare/src/",
				import.meta.url,
			).pathname.slice(0, -1),
			"@excalidraw/excalidraw": new URL(
				"./node_modules/@excalidraw/excalidraw/dist/dev/index.js",
				import.meta.url,
			).pathname,
		},
	},
	test: {
		name: "icon-batch",
		watch: false,
		globals: true,
		environment: "node",
		server: { deps: { inline: true as const } },
		include: ["src/**/*.test.ts"],
		testTimeout: 60_000,
		reporters: ["default"],
		coverage: {
			reportsDirectory: "../../coverage/tools/icon-batch",
			provider: "v8" as const,
		},
	},
}));
