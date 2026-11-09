import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			reportsDirectory: "../../../coverage/packages/icons/community",
		},
		include: ["packages/icons/community/src/**/*.test.ts"],
	},
});
