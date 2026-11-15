import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { excalidrawFonts } from "../../scripts/lib/excalidraw-fonts.mjs";
import { browserbase } from "../../tools/testing/browserbase";

const source = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
	cacheDir: source("../../node_modules/.vite/apps/playground-browser"),
	// Excalidraw fonts come from this server, as in the deployed apps.
	plugins: [excalidrawFonts(), react(), tailwindcss()],
	resolve: {
		alias: [
			{
				find: "@sketchi/diagrams",
				replacement: source("../../packages/diagrams/src/").slice(0, -1),
			},
			{
				find: "@sketchi/cloudflare",
				replacement: source("../../packages/cloudflare/src/").slice(0, -1),
			},
			{
				find: /^@\//,
				replacement: source("./src/"),
			},
			{
				find: /^@sketchi\/icon-catalog$/,
				replacement: source("../../packages/icons/catalog/src/index.ts"),
			},
			{
				find: /^@sketchi\/icon-catalog\/catalog$/,
				replacement: source("../../packages/icons/catalog/src/catalog.ts"),
			},
			{
				find: "@sketchi/drawing/excalidraw",
				replacement: source("../../packages/drawing/src/excalidraw/index.ts"),
			},
			{
				find: "@sketchi/diagram-scenarios",
				replacement: source("../../packages/diagram/scenarios/src/index.ts"),
			},
			{
				find: "@sketchi/editor/styles.css",
				replacement: source("../../packages/editor/src/styles.css"),
			},
			{
				find: "@sketchi/editor",
				replacement: source("../../packages/editor/src/index.ts"),
			},
		],
	},
	test: {
		name: "playground-browser",
		watch: false,
		attachmentsDir: source("../../.memory/vitest-attachments/playground"),
		include: ["apps/playground/src/**/*.browser.test.tsx"],
		browser: {
			enabled: true,
			headless: true,
			// Remote Browserbase Chromium; no local browser binary.
			provider: browserbase(),
			instances: [{ browser: "chromium" }],
			viewport: { height: 577, width: 1280 },
		},
	},
});
