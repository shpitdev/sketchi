import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
	root: import.meta.dirname,
	cacheDir: "../../../node_modules/.vite/packages/diagram/agent",
	resolve: {
		alias: {
			"@sketchi/diagram-core": new URL("../core/src/index.ts", import.meta.url).pathname,
			"@sketchi/diagram-excalidraw": new URL("../excalidraw/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-renderer": new URL("../renderer/src/index.ts", import.meta.url).pathname,
			"@sketchi/observability": new URL("../../observability/src/index.ts", import.meta.url)
				.pathname,
		},
	},
	test: {
		name: "diagram-agent",
		watch: false,
		globals: true,
		environment: "node",
		include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		reporters: ["default"],
		coverage: {
			reportsDirectory: "../../../coverage/packages/diagram/agent",
			provider: "v8" as const,
		},
	},
}));
