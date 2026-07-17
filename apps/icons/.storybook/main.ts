import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  staticDirs: ["../public"],
  addons: ["@storybook/addon-vitest", "@storybook/addon-mcp"],
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        viteConfigPath: "apps/icons/.storybook/vite.config.ts",
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
      "@sketchi/diagram-ui/styles.css": new URL(
        "../../../packages/diagram/ui/src/styles.css",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-ui": new URL(
        "../../../packages/diagram/ui/src/index.ts",
        import.meta.url,
      ).pathname,
    };
    return viteConfig;
  },
};

export default config;
