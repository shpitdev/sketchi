import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			reportsDirectory: new URL("../../../coverage/packages/diagram/renderer", import.meta.url)
				.pathname,
		},
		include: ["packages/diagram/renderer/src/**/*.test.ts"],
		// Hang guard, not a speed budget: the heavy deterministic suites here run several
		// times slower on loaded CI runners, and only a real hang should fail them.
		testTimeout: 60_000,
	},
	resolve: {
		alias: {
			"@sketchi/diagram-core": new URL("../core/src/index.ts", import.meta.url).pathname,
		},
	},
});
