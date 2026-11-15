import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { excalidrawFonts } from "../../scripts/lib/excalidraw-fonts.mjs";
import { browserbase } from "../../tools/testing/browserbase";

const source = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
	cacheDir: source("../../node_modules/.vite/apps/excalidraw-browser"),
	// Excalidraw fonts come from this server, as in the deployed apps.
	plugins: [excalidrawFonts(), react()],
	resolve: {
		alias: [
			{
				find: "@sketchi/diagrams",
				replacement: source("../../packages/diagrams/src/").slice(0, -1),
			},
			{
				find: "@sketchi/editor/styles.css",
				replacement: source("../../packages/editor/src/styles.css"),
			},
			{
				find: "@sketchi/drawing/excalidraw",
				replacement: source("../../packages/drawing/src/excalidraw/index.ts"),
			},
			{
				find: "@sketchi/editor",
				replacement: source("../../packages/editor/src/index.ts"),
			},
			{
				find: "@sketchi/svg-excalidraw",
				replacement: source("../../packages/svg-excalidraw/src/index.ts"),
			},
		],
	},
	test: {
		name: "excalidraw-browser",
		watch: false,
		attachmentsDir: source("../../.memory/vitest-attachments/excalidraw"),
		include: ["apps/excalidraw/src/**/*.browser.test.tsx"],
		browser: {
			enabled: true,
			headless: true,
			// Remote Browserbase Chromium; no local browser binary.
			provider: browserbase(),
			instances: [{ browser: "chromium" }],
		},
	},
});
