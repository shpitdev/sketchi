import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		coverage: {
			reportsDirectory: new URL("../../../coverage/packages/diagram/ui", import.meta.url).pathname,
		},
		include: ["packages/diagram/ui/src/**/*.test.tsx"],
		server: { deps: { inline: [/@excalidraw\/excalidraw/] } },
		// Hang guard, not a speed budget: the full scenario suite renders every
		// scenario in jsdom and runs several times slower on loaded CI runners.
		testTimeout: 60_000,
	},
	resolve: {
		alias: {
			// Excalidraw's own drag, resize and binding code, for tests of how edits move arrows.
			"@sketchi/excalidraw-internals": new URL(
				"./node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js",
				import.meta.url,
			).pathname,
			"@sketchi/diagram-core": new URL("../core/src/index.ts", import.meta.url).pathname,
			"@sketchi/diagram-excalidraw": new URL("../excalidraw/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-generation": new URL("../generation/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-renderer": new URL("../renderer/src/index.ts", import.meta.url).pathname,
			"@sketchi/diagram-scenarios": new URL("../scenarios/src/index.ts", import.meta.url).pathname,
		},
	},
});
