import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@sketchi/drawing/excalidraw": new URL(
				"../packages/drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/artifacts": new URL("../packages/drawing/src/artifacts.ts", import.meta.url)
				.pathname,
			"@sketchi/drawing": new URL("../packages/drawing/src/index.ts", import.meta.url).pathname,
			"@sketchi/diagrams/mindmap/fixtures": new URL(
				"../packages/diagrams/src/mindmap/fixtures.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagrams/mindmap/build": new URL(
				"../packages/diagrams/src/mindmap/build.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagrams/mindmap": new URL(
				"../packages/diagrams/src/mindmap/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagrams/build": new URL("../packages/diagrams/src/build.ts", import.meta.url)
				.pathname,
			"@sketchi/diagrams/generate/clean-text": new URL(
				"../packages/diagrams/src/generate/clean-text.ts",
				import.meta.url,
			).pathname,

			"@sketchi/diagram-agent": new URL("../packages/diagram/agent/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-core": new URL("../packages/diagram/core/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-generation": new URL(
				"../packages/diagram/generation/src/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/icon-catalog": new URL("../packages/icons/catalog/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/observability": new URL("../packages/observability/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-renderer": new URL(
				"../packages/diagram/renderer/src/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagram-scenarios": new URL(
				"../packages/diagram/scenarios/src/index.ts",
				import.meta.url,
			).pathname,
		},
	},
	test: {
		name: "tools",
		environment: "node",
		include: ["tools/**/*.test.ts"],
		exclude: ["**/node_modules/**", "tools/*/src/**", "tools/*/tests/**", "tools/drawing-tests/**"],
		// Hang guard, not a speed budget: the heavy deterministic suites here run several
		// times slower on loaded CI runners, and only a real hang should fail them.
		testTimeout: 60_000,
	},
});
