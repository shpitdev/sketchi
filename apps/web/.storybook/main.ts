import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  staticDirs: ["../public"],
  addons: ["@storybook/addon-vitest", "@storybook/addon-mcp"],
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        viteConfigPath: "apps/web/.storybook/vite.config.ts",
      },
    },
  },
};

export default config;
