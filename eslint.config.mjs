import nx from "@nx/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "**/.output/**",
      "**/.wrangler/**",
      "**/cloudflare-workers.d.ts",
      "**/dist/**",
      "**/routeTree.gen.ts",
      ".memory/**",
      "coverage/**",
      "storybook-static/**",
    ],
  },
  {
    files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@nx": nx,
    },
  },
  {
    files: [
      "apps/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "packages/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "tools/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
    ],
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          // Vite configs consume these two non-project workspace inputs. Keep
          // the exceptions exact so every project-to-project import is still
          // checked, including imports from config and Storybook files.
          allow: [
            "^\\.\\./\\.\\./scripts/lib/worker-apps\\.mjs$",
            "^\\.\\./\\.\\./tools/local-dev-ports$",
          ],
          depConstraints: [
            {
              sourceTag: "scope:package",
              onlyDependOnLibsWithTags: ["scope:package"],
            },
            {
              sourceTag: "scope:tool",
              onlyDependOnLibsWithTags: ["scope:tool", "scope:package"],
            },
            {
              sourceTag: "scope:app",
              onlyDependOnLibsWithTags: ["scope:package"],
            },
            {
              sourceTag: "scope:composition",
              onlyDependOnLibsWithTags: ["scope:package", "scope:app"],
            },
            {
              sourceTag: "type:runtime",
              onlyDependOnLibsWithTags: [
                "type:contract",
                "type:persistence",
                "type:runtime",
                "type:ui",
              ],
            },
            {
              sourceTag: "type:persistence",
              onlyDependOnLibsWithTags: [
                "type:contract",
                "type:persistence",
                "type:runtime",
              ],
            },
          ],
          enforceBuildableLibDependency: true,
        },
      ],
    },
  },
];
