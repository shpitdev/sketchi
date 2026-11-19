import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/icons/catalog/tests/**/*.test.ts"],
	},
});
