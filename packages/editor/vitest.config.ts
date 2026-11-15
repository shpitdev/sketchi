import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		coverage: {
			reportsDirectory: new URL("../../coverage/packages/editor", import.meta.url).pathname,
		},
		include: ["packages/editor/src/**/*.test.tsx"],
		server: { deps: { inline: [/@excalidraw\/excalidraw/] } },
		// Hang guard, not a speed budget: the full scenario suite renders every
		// scenario in jsdom and runs several times slower on loaded CI runners.
		testTimeout: 60_000,
	},
	resolve: {
		alias: {
			"@sketchi/diagrams": new URL("../diagrams/src/", import.meta.url).pathname.slice(0, -1),
			"@sketchi/excalidraw-internals": new URL(
				"./node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/excalidraw": new URL("../drawing/src/excalidraw/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-scenarios": new URL("../diagram/scenarios/src/index.ts", import.meta.url)
				.pathname,
		},
	},
});
