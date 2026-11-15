import { type StorybookConfig } from "@storybook/react-vite";

import { excalidrawFonts } from "../../../scripts/lib/excalidraw-fonts.mjs";

const config: StorybookConfig = {
	stories: ["../src/**/*.stories.tsx"],
	addons: ["@storybook/addon-mcp"],
	framework: {
		name: "@storybook/react-vite",
		options: {
			builder: {
				viteConfigPath: new URL("vite.config.ts", import.meta.url).pathname,
			},
		},
	},
	viteFinal: async (config) => {
		config.plugins = [...(config.plugins ?? []), excalidrawFonts()];
		config.resolve ??= {};
		config.resolve.alias = {
			...config.resolve.alias,
			"@sketchi/diagram-core": new URL(
				"../../../packages/diagram/core/src/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/excalidraw": new URL(
				"../../../packages/drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagram-renderer": new URL(
				"../../../packages/diagram/renderer/src/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/editor/styles.css": new URL(
				"../../../packages/editor/src/styles.css",
				import.meta.url,
			).pathname,
			"@sketchi/editor": new URL("../../../packages/editor/src/index.ts", import.meta.url).pathname,
		};

		return config;
	},
};

export default config;
