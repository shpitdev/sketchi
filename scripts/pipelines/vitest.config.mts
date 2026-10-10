import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@sketchi/diagram-scenarios/internal/tool-process": new URL(
				"../../packages/diagram/scenarios/src/internal/tool-process.ts",
				import.meta.url,
			).pathname,
		},
	},
	test: {
		name: "pipelines",
		environment: "node",
		include: ["scripts/pipelines/*.test.ts"],
	},
});
