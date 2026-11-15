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

				"@sketchi/drawing/excalidraw",
				"@sketchi/diagrams",
			],
		},
	},
	resolve: {
		alias: {
			"@sketchi/diagrams": new URL("../diagrams/src/", import.meta.url).pathname.slice(0, -1),
			"@sketchi/drawing/excalidraw": new URL("../drawing/src/excalidraw/index.ts", import.meta.url)
				.pathname,
		},
	},
});
