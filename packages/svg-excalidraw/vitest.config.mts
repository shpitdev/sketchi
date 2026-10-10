import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
	root: import.meta.dirname,
	cacheDir: "../../node_modules/.vite/packages/svg-excalidraw",
	resolve: {
		alias: {
			"@excalidraw/excalidraw": new URL(
				"./node_modules/@excalidraw/excalidraw/dist/dev/index.js",
				import.meta.url,
			).pathname,
		},
		conditions: ["development"],
	},
	test: {
		name: "svg-excalidraw",
		watch: false,
		globals: true,
		environment: "jsdom",
		server: {
			deps: {
				inline: true as const,
			},
		},
		setupFiles: ["./tests/setup-excalidraw.ts"],
		include: ["{src,tests}/**/*.{test,spec}.{ts,mts,tsx}"],
		exclude: ["tests/browser-determinism.test.ts", "tests/native-corpus-renderer.test.ts"],
		reporters: ["default"],
		coverage: {
			reportsDirectory: "../../coverage/packages/svg-excalidraw",
			provider: "v8" as const,
		},
	},
}));
