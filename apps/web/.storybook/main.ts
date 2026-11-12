import type { StorybookConfig } from "@storybook/react-vite";

import { excalidrawFonts } from "../../../scripts/lib/excalidraw-fonts.mjs";

const config: StorybookConfig = {
	stories: ["../src/**/*.stories.tsx"],
	staticDirs: ["../public"],
	addons: ["@storybook/addon-mcp"],
	framework: {
		name: "@storybook/react-vite",
		options: {
			builder: {
				viteConfigPath: new URL("vite.config.ts", import.meta.url).pathname,
			},
		},
	},
	// The home diagram's editor draws with Excalidraw's fonts from /fonts/.
	viteFinal: async (config) => {
		config.plugins = [...(config.plugins ?? []), excalidrawFonts()];
		return config;
	},
};

export default config;
