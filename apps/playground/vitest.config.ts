import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		server: { deps: { inline: ["@cloudflare/codemode"] } },
		environment: "jsdom",
		globals: true,
		coverage: {
			reportsDirectory: "../../coverage/apps/playground",
		},
		include: ["apps/playground/src/**/*.test.ts", "apps/playground/src/**/*.test.tsx"],
		exclude: ["apps/playground/src/**/*.browser.test.tsx"],
		passWithNoTests: true,
	},
	resolve: {
		alias: [
			{
				find: "@sketchi/diagrams",
				replacement: new URL("../../packages/diagrams/src/", import.meta.url).pathname.slice(0, -1),
			},
			{
				find: "@sketchi/cloudflare",
				replacement: new URL("../../packages/cloudflare/src/", import.meta.url).pathname.slice(
					0,
					-1,
				),
			},
			{
				find: /^@\//,
				replacement: new URL("./src/", import.meta.url).pathname,
			},
			{
				find: "cloudflare:email",
				replacement: new URL("./src/test/cloudflare-email.stub.ts", import.meta.url).pathname,
			},
			{
				find: "cloudflare:workers",
				replacement: new URL("./src/test/cloudflare-workers.stub.ts", import.meta.url).pathname,
			},
			{
				find: /^@sketchi\/icon-catalog$/,
				replacement: new URL("../../packages/icons/catalog/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@sketchi\/icon-catalog\/catalog$/,
				replacement: new URL("../../packages/icons/catalog/src/catalog.ts", import.meta.url)
					.pathname,
			},
			{
				find: /^@sketchi\/icon-catalog\/look-alikes$/,
				replacement: new URL("../../packages/icons/catalog/src/look-alikes.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/icon-draw",
				replacement: new URL("../../packages/icons/draw/src/index.ts", import.meta.url).pathname,
			},
			{
				find: "@sketchi/studio-projects/client",
				replacement: new URL("../../packages/studio/projects/src/client.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/studio-projects/server",
				replacement: new URL("../../packages/studio/projects/src/server.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/drawing/excalidraw",
				replacement: new URL("../../packages/drawing/src/excalidraw/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/diagram-scenarios",
				replacement: new URL("../../packages/diagram/scenarios/src/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: "@sketchi/editor/styles.css",
				replacement: new URL("../../packages/editor/src/styles.css", import.meta.url).pathname,
			},
			{
				find: "@sketchi/editor",
				replacement: new URL("../../packages/editor/src/index.ts", import.meta.url).pathname,
			},
		],
	},
});
