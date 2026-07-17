import path from "node:path";
import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const storybookProject = (configDir: string) => {
  const resolvedConfigDir = path.join(dirname, configDir);

  return {
    extends: true,
    plugins: [storybookTest({ configDir: resolvedConfigDir })],
    root: path.dirname(resolvedConfigDir),
    test: {
      name: `storybook:${path.normalize(resolvedConfigDir)}`,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({}),
        instances: [{ browser: "chromium" }],
      },
    },
  };
};

export default defineConfig({
  test: {
    projects: [
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "packages/*/vitest.config.mts",
      "packages/*/*/vitest.config.ts",
      "packages/*/*/vitest.config.mts",
      "tools/vitest.config.mts",
      "tools/*/vitest.config.mts",
      storybookProject("apps/web/.storybook"),
      storybookProject("apps/excalidraw/.storybook"),
      storybookProject("apps/icons/.storybook"),
      storybookProject("packages/diagram/ui/.storybook"),
    ],
  },
});
