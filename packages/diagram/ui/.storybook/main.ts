import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-vitest", "@storybook/addon-mcp"],
  // theme.css declares Excalifont at absolute /fonts/Excalifont/... — the face
  // the scene canvas draws text in and the wordmark is written in. Without this
  // the stories request it and get a 404, so every preview silently falls back.
  staticDirs: ["../public"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (config) => {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@sketchi/diagram-core": new URL(
        "../../core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-excalidraw": new URL(
        "../../excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-generation": new URL(
        "../../generation/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../../renderer/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-scenarios": new URL(
        "../../scenarios/src/index.ts",
        import.meta.url,
      ).pathname,
    };

    return config;
  },
};

export default config;
