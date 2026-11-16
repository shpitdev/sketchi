import { defineConfig } from "vitest/config";

export default defineConfig({
	root: import.meta.dirname,
	cacheDir: "../../node_modules/.vite/tools/ops",
	test: {
		name: "ops",
		watch: false,
		environment: "node",
		include: ["tests/**/*.test.ts"],
		// Command tests spawn real processes (jiti, git, stubs); this is a hang guard.
		testTimeout: 60_000,
	},
});
