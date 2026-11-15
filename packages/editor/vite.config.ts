import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: {
		outDir: "packages/editor/dist",
		lib: {
			entry: "packages/editor/src/index.ts",
			formats: ["es"],
			fileName: "index",
		},
		rolldownOptions: {
			external: [
				"react",
				"react-dom",
				"@excalidraw/excalidraw",
				"@excalidraw/excalidraw/types",
				"@sketchi/diagram-core",
				"@sketchi/drawing/excalidraw",
				"@sketchi/diagram-renderer",
			],
		},
	},
	resolve: {
		alias: {
			"@sketchi/diagram-core": new URL("../diagram/core/src/index.ts", import.meta.url).pathname,
			"@sketchi/drawing/excalidraw": new URL("../drawing/src/excalidraw/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-renderer": new URL("../diagram/renderer/src/index.ts", import.meta.url)
				.pathname,
		},
	},
});
