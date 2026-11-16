import { defineConfig } from "vitest/config";
export default defineConfig({
	resolve: {
		alias: {
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
		include: ["packages/drawing/src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "packages/drawing/src/svg/**"],
		testTimeout: 60_000,
	},
});
