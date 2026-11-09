import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
	root: import.meta.dirname,
	cacheDir: "../../../node_modules/.vite/packages/icons/draw",
	resolve: {
		alias: {
			"@sketchi/diagram-core": new URL("../../diagram/core/src/index.ts", import.meta.url).pathname,
			"@sketchi/diagram-excalidraw": new URL(
				"../../diagram/excalidraw/src/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagram-renderer": new URL("../../diagram/renderer/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/observability": new URL("../../observability/src/index.ts", import.meta.url)
				.pathname,
			"@excalidraw/excalidraw": new URL(
				"./node_modules/@excalidraw/excalidraw/dist/dev/index.js",
				import.meta.url,
			).pathname,
		},
		conditions: ["development"],
	},
	test: {
		name: "icon-draw",
		watch: false,
		globals: true,
		environment: "node",
		server: {
			deps: {
				inline: true as const,
			},
		},
		// Stubs the browser APIs Excalidraw needs; it only acts in jsdom tests.
		setupFiles: ["./tests/setup-excalidraw.ts"],
		include: ["src/**/*.test.ts"],
		reporters: ["default"],
		coverage: {
			reportsDirectory: "../../../coverage/packages/icons/draw",
			provider: "v8" as const,
		},
	},
}));
