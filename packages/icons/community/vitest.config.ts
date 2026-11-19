import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["packages/icons/community/tests/**/*.test.ts"],
	},
});
