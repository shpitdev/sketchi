import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
	root: import.meta.dirname,
	cacheDir: "../../node_modules/.vite/packages/social-card",
	test: {
		name: "social-card",
		watch: false,
		globals: true,
		environment: "node",
		include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
		reporters: ["default"],
		coverage: {
			reportsDirectory: "../../coverage/packages/social-card",
			provider: "v8",
		},
	},
}));
