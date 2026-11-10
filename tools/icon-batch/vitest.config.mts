import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
	root: import.meta.dirname,
	cacheDir: "../../node_modules/.vite/tools/icon-batch",
	resolve: {
		alias: {
			// Excalidraw's production build imports JSON without import attributes, which Vitest's
			// Node loader refuses; its development build has the same exports.
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
