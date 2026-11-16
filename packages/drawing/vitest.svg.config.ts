import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
	root: import.meta.dirname,
	cacheDir: "../../node_modules/.vite/packages/drawing-svg",
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
		name: "drawing-svg",
		watch: false,
		globals: true,
		environment: "jsdom",
		server: {
			deps: {
				inline: true as const,
			},
		},
		setupFiles: ["./src/svg/tests/setup-excalidraw.ts"],
		include: ["src/svg/**/*.test.ts"],
		exclude: ["src/svg/tests/native-corpus-renderer.test.ts"],
		reporters: ["default"],
		coverage: {
			reportsDirectory: "../../coverage/packages/drawing/svg",
			provider: "v8" as const,
		},
	},
}));
