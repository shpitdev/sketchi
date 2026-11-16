import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@sketchi/diagrams": new URL("./src/", import.meta.url).pathname.slice(0, -1),
			"@sketchi/drawing/excalidraw": new URL("../drawing/src/excalidraw/index.ts", import.meta.url)
				.pathname,
			"@sketchi/drawing/artifacts": new URL("../drawing/src/artifacts.ts", import.meta.url)
				.pathname,
			"@sketchi/drawing": new URL("../drawing/src/index.ts", import.meta.url).pathname,
		},
	},
	test: {
		name: "diagrams",
		include: ["packages/diagrams/src/**/*.test.ts"],
		exclude: [
			"**/node_modules/**",
			"packages/diagrams/src/families/**",
			"packages/diagrams/src/graph/**",
		],
		testTimeout: 60_000,
	},
});
