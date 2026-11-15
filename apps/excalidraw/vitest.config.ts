import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const aliases = [
	{
		find: "@sketchi/editor/styles.css",
		replacement: new URL("../../packages/editor/src/styles.css", import.meta.url).pathname,
	},
	{
		find: "@sketchi/diagram-core",
		replacement: new URL("../../packages/diagram/core/src/index.ts", import.meta.url).pathname,
	},
	{
		find: "@sketchi/diagram-renderer",
		replacement: new URL("../../packages/diagram/renderer/src/index.ts", import.meta.url).pathname,
	},
	{
		find: "@sketchi/drawing/excalidraw",
		replacement: new URL("../../packages/drawing/src/excalidraw/index.ts", import.meta.url)
			.pathname,
	},
	{
		find: "@sketchi/editor",
		replacement: new URL("../../packages/editor/src/index.ts", import.meta.url).pathname,
	},
];

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		coverage: {
			reportsDirectory: "../../coverage/apps/excalidraw",
		},
		include: ["apps/excalidraw/src/**/*.test.{ts,tsx}"],
		exclude: ["apps/excalidraw/src/**/*.browser.test.tsx"],
	},
	resolve: {
		alias: aliases,
	},
});
