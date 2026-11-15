import { defineConfig } from "vitest/config";

export default defineConfig({
	root: import.meta.dirname,
	cacheDir: "../../node_modules/.vite/packages/svg-excalidraw-corpus",
	resolve: {
		alias: {
			"@sketchi/diagrams": new URL("../diagrams/src/", import.meta.url).pathname.slice(0, -1),
			"@excalidraw/excalidraw": new URL(
				"./node_modules/@excalidraw/excalidraw/dist/dev/index.js",
				import.meta.url,
			).pathname,
		},
		conditions: ["development"],
	},
	test: {
		name: "svg-excalidraw-corpus",
		watch: false,
		globals: true,
		environment: "jsdom",
		server: { deps: { inline: true as const } },
		setupFiles: ["./tests/setup-excalidraw.ts"],
		include: ["tests/native-corpus-renderer.test.ts"],
		reporters: ["default"],
	},
});
