import { type StorybookConfig } from "@storybook/react-vite";

import { excalidrawFonts } from "../../../scripts/lib/excalidraw-fonts.mjs";

const config: StorybookConfig = {
	stories: [
		"../../../tools/storybook/families/*.stories.tsx",
		"../../../packages/editor/src/components/excalidraw-scene-canvas/*.stories.tsx",
		"../../icons/src/components/icon-conversion-preview/*.stories.tsx",
		"../../excalidraw/src/components/svg-icon-workspace/*.stories.tsx",
	],
	staticDirs: ["../../icons/public"],
	addons: ["@storybook/addon-mcp"],
	framework: {
		name: "@storybook/react-vite",
		options: {
			builder: {
				viteConfigPath: new URL("vite.config.ts", import.meta.url).pathname,
			},
		},
	},
	viteFinal: async (viteConfig) => {
		viteConfig.plugins = [...(viteConfig.plugins ?? []), excalidrawFonts()];
		viteConfig.resolve ??= {};
		viteConfig.resolve.alias = {
			"@sketchi/diagrams": new URL(
				"../../../packages/diagrams/src/",
				import.meta.url,
			).pathname.slice(0, -1),
			...viteConfig.resolve.alias,
			"@sketchi/playground/styles.css": new URL(
				"../../playground/src/styles/app.css",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/excalidraw": new URL(
				"../../../packages/drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/svg": new URL("../../../packages/drawing/src/svg/index.ts", import.meta.url)
				.pathname,
			"@sketchi/drawing/artifacts": new URL(
				"../../../packages/drawing/src/artifacts.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing": new URL("../../../packages/drawing/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagram-scenarios": new URL(
				"../../../packages/diagram/scenarios/src/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/editor/styles.css": new URL(
				"../../../packages/editor/src/styles.css",
				import.meta.url,
			).pathname,
			"@sketchi/editor": new URL("../../../packages/editor/src/index.ts", import.meta.url).pathname,
		};
		return viteConfig;
	},
};

export default config;
