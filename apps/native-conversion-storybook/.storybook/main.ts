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
			...viteConfig.resolve.alias,
			"@sketchi/playground/styles.css": new URL(
				"../../playground/src/styles/app.css",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/excalidraw": new URL(
				"../../../packages/drawing/src/excalidraw/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing/artifacts": new URL(
				"../../../packages/drawing/src/artifacts.ts",
				import.meta.url,
			).pathname,
			"@sketchi/drawing": new URL("../../../packages/drawing/src/index.ts", import.meta.url)
				.pathname,
			"@sketchi/diagrams/mindmap/fixtures": new URL(
				"../../../packages/diagrams/src/mindmap/fixtures.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagrams/mindmap/build": new URL(
				"../../../packages/diagrams/src/mindmap/build.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagrams/mindmap": new URL(
				"../../../packages/diagrams/src/mindmap/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagrams/build": new URL("../../../packages/diagrams/src/build.ts", import.meta.url)
				.pathname,
			"@sketchi/diagrams/generate/clean-text": new URL(
				"../../../packages/diagrams/src/generate/clean-text.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagram-scenarios": new URL(
				"../../../packages/diagram/scenarios/src/index.ts",
				import.meta.url,
			).pathname,
			"@sketchi/diagram-generation": new URL(
				"../../../packages/diagram/generation/src/index.ts",
				import.meta.url,
			).pathname,

			"@sketchi/diagram-core": new URL(
				"../../../packages/diagram/core/src/index.ts",
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
			"@sketchi/svg-excalidraw": new URL(
				"../../../packages/svg-excalidraw/src/index.ts",
				import.meta.url,
			).pathname,
		};
		return viteConfig;
	},
};

export default config;
