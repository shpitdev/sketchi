import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-vitest", "@storybook/addon-mcp"],
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        viteConfigPath: "apps/excalidraw/.storybook/vite.config.ts",
      },
    },
  },
  viteFinal: async (config) => {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@sketchi/diagram-core": new URL(
        "../../../packages/diagram-core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-excalidraw": new URL(
        "../../../packages/diagram-excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../../../packages/diagram-renderer/src/index.ts",
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
    };

    return config;
  },
};

export default config;
