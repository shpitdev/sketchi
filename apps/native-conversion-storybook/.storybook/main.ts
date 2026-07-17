import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: [
    "../../../packages/diagram-studio-ui/src/components/excalidraw-scene-canvas/*.stories.tsx",
    "../../icons/src/components/icon-conversion-preview/*.stories.tsx",
    "../../excalidraw/src/components/svg-icon-workspace/*.stories.tsx",
  ],
  staticDirs: ["../../icons/public"],
  addons: ["@storybook/addon-vitest", "@storybook/addon-mcp"],
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        viteConfigPath:
          "apps/native-conversion-storybook/.storybook/vite.config.ts",
      },
    },
  },
  viteFinal: async (viteConfig) => {
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias ?? {}),
      "@sketchi/diagram-core": new URL(
        "../../../packages/diagram/core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-excalidraw": new URL(
        "../../../packages/diagram/excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../../../packages/diagram/renderer/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-studio-ui/styles.css": new URL(
        "../../../packages/diagram-studio-ui/src/styles.css",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-studio-ui": new URL(
        "../../../packages/diagram-studio-ui/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/svg-excalidraw": new URL(
        "../../../packages/svg-excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
    };
    return viteConfig;
  },
};

export default config;
