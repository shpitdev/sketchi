import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const aliases = [
	{
		find: "@sketchi/editor-surface/styles.css",
		replacement: new URL("../../packages/editor/src/styles.css", import.meta.url).pathname,
	},

	{
		find: "@sketchi/drawing/excalidraw",
		replacement: new URL("../../packages/drawing/src/excalidraw/index.ts", import.meta.url)
			.pathname,
	},
	{
		find: "@sketchi/editor-surface",
		replacement: new URL("../../packages/editor/src/index.ts", import.meta.url).pathname,
	},
];

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		coverage: {
			reportsDirectory: "../../coverage/apps/editor",
		},
		include: ["apps/editor/src/tests/**/*.test.{ts,tsx}"],
	},
	resolve: {
		alias: aliases,
	},
});
