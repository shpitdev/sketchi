import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
	root: import.meta.dirname,
	cacheDir: "../../../node_modules/.vite/packages/diagram/scenarios",
	resolve: {
		alias: {
			"@sketchi/diagrams": new URL("../../diagrams/src/", import.meta.url).pathname.slice(0, -1),
			"@sketchi/drawing/excalidraw": new URL(
				"../../drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
		},
	},
	test: {
		name: "diagram-scenarios",
		watch: false,
		globals: true,
		environment: "node",
		include: ["src/**/*.test.ts"],
		// Hang guard, not a speed budget: scenarios.test.ts runs every maintained scenario through
		// the deterministic pipeline, which took 5.3s on a loaded CI runner against 0.5s alone.
		testTimeout: 60_000,
		reporters: ["default"],
		coverage: {
			reportsDirectory: "../../../coverage/packages/diagram/scenarios",
			provider: "v8",
		},
	},
}));
