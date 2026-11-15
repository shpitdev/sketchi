import { type StorybookConfig } from "@storybook/react-vite";

import { excalidrawFonts } from "../../../scripts/lib/excalidraw-fonts.mjs";

const config: StorybookConfig = {
	stories: ["../src/**/*.stories.@(ts|tsx)"],
	addons: ["@storybook/addon-mcp"],
	// theme.css declares Excalifont at absolute /fonts/Excalifont/... — the face
	// the scene canvas draws text in and the wordmark is written in. Without this
	// the stories request it and get a 404, so every preview silently falls back.
	staticDirs: ["../public"],
	framework: {
		name: "@storybook/react-vite",
		options: {},
	},
	viteFinal: async (config) => {
		config.plugins = [...(config.plugins ?? []), excalidrawFonts()];
		config.resolve ??= {};
		config.resolve.alias = {
			"@sketchi/diagrams": new URL("../../diagrams/src/", import.meta.url).pathname.slice(0, -1),
			...config.resolve.alias,
			"@sketchi/drawing/excalidraw": new URL(
				"../../drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagram-scenarios": new URL("../../diagram/scenarios/src/index.ts", import.meta.url)
				.pathname,
		};

		return config;
	},
};

export default config;
