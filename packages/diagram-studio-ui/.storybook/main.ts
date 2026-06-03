import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  addons: ["@storybook/addon-vitest"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  viteFinal: async (config) =>
    mergeConfig(config, {
      resolve: {
        alias: {
          "@sketchi/diagram-core": new URL(
            "../../diagram-core/src/index.ts",
            import.meta.url
          ).pathname,
          "@sketchi/diagram-renderer": new URL(
            "../../diagram-renderer/src/index.ts",
            import.meta.url
          ).pathname,
        },
      },
    }),
};

export default config;
