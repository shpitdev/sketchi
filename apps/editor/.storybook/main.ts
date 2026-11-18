import { type StorybookConfig } from "@storybook/react-vite";

import { excalidrawFonts } from "../../../tools/ops/src/vite/excalidraw-fonts";

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
			"@sketchi/diagrams": new URL(
				"../../../packages/diagrams/src/",
				import.meta.url,
			).pathname.slice(0, -1),
			...config.resolve.alias,
			"@sketchi/drawing/excalidraw": new URL(
				"../../../packages/drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/editor-surface/styles.css": new URL(
				"../../../packages/editor-surface/src/styles.css",
				import.meta.url,
			).pathname,
			"@sketchi/editor-surface": new URL(
				"../../../packages/editor-surface/src/index.ts",
				import.meta.url,
			).pathname,
		};

		return config;
	},
};

export default config;
