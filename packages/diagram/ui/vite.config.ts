import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: {
		outDir: "packages/diagram/ui/dist",
		lib: {
			entry: "packages/diagram/ui/src/index.ts",
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
				"@sketchi/diagram-excalidraw",
				"@sketchi/diagram-renderer",
			],
		},
	},
	resolve: {
		alias: {
			"@sketchi/diagram-core": new URL("../core/src/index.ts", import.meta.url).pathname,
			"@sketchi/diagram-excalidraw": new URL("../excalidraw/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-renderer": new URL("../renderer/src/index.ts", import.meta.url).pathname,
		},
	},
});
