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
		include: ["packages/drawing/src/**/*.test.ts", "tools/drawing-tests/**/*.test.ts"],
		exclude: ["**/node_modules/**", "tools/drawing-tests/routing*-fuzz.test.ts"],
		testTimeout: 60_000,
	},
});
