import { defineConfig } from "vitest/config";
export default defineConfig({
	resolve: {
		alias: {
			"@sketchi/diagrams": new URL("../diagrams/src/", import.meta.url).pathname.slice(0, -1),
			"@sketchi/drawing/excalidraw": new URL(
				"../../packages/drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/artifacts": new URL(
				"../../packages/drawing/src/artifacts.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing": new URL("../../packages/drawing/src/index.ts", import.meta.url).pathname,
		},
	},
	test: {
		name: "drawing",
		include: [
			"packages/drawing/src/**/*.test.ts",
			"packages/diagrams/src/graph/tests/text-fit-fuzz.test.ts",
		],
		exclude: ["**/node_modules/**"],
		testTimeout: 60_000,
	},
});
