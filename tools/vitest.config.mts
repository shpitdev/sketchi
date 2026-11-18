import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@sketchi/diagrams": new URL("../packages/diagrams/src/", import.meta.url).pathname.slice(
				0,
				-1,
			),
			"@sketchi/cloudflare": new URL("../packages/cloudflare/src/", import.meta.url).pathname.slice(
				0,
				-1,
			),
			"@sketchi/drawing/excalidraw": new URL(
				"../packages/drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/artifacts": new URL("../packages/drawing/src/artifacts.ts", import.meta.url)
				.pathname,
			"@sketchi/drawing": new URL("../packages/drawing/src/index.ts", import.meta.url).pathname,
			"@sketchi/icon-catalog": new URL("../packages/icons/catalog/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/observability": new URL("../packages/observability/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-scenarios": new URL("./scenarios/src/index.ts", import.meta.url).pathname,
		},
	},
	test: {
		name: "tools",
		environment: "node",
		include: ["tools/tests/**/*.test.ts", "tools/oxlint/tests/**/*.test.ts"],
		// Hang guard, not a speed budget: the heavy deterministic suites here run several
		// times slower on loaded CI runners, and only a real hang should fail them.
		testTimeout: 60_000,
	},
});
