import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			"apps/*/vitest.config.ts",
			"packages/*/vitest.config.ts",
			"packages/*/vitest.config.mts",
			"packages/*/*/vitest.config.ts",
			"packages/*/*/vitest.config.mts",
			"tools/vitest.config.mts",
			"tools/*/vitest.config.mts",
		],
	},
});
