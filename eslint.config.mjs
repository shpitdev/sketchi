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
          // Playground lazy-loads its server composition root while its
          // client routes consume the same package's contracts.
          checkDynamicDependenciesExceptions: [
            "@sketchi/studio-projects",
            "@sketchi/studio-projects/server",
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
  {
    files: [
      "apps/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "packages/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "tools/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["effect/unstable/*"],
              message:
                "Unstable Effect modules require a reviewed adapter under src/internal/effect-unstable-*.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/excalidraw/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "apps/icons/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "apps/native-conversion-storybook/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "apps/web/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "packages/diagram/core/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "packages/diagram/excalidraw/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "packages/diagram/renderer/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "packages/diagram/ui/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "packages/svg-excalidraw/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
      "tools/sketchi-generators/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["effect", "effect/*", "@effect/*"],
              message:
                "This project is pure or framework-native; keep Effect at its owning orchestration boundary.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/**/src/internal/effect-unstable-*.ts",
      "packages/**/src/internal/effect-unstable-*.ts",
      "tools/**/src/internal/effect-unstable-*.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: [
      "packages/diagram/core/src/intermediate.ts",
      "packages/diagram/core/src/types/flowchart.ts",
      "packages/diagram/core/src/types/mindmap.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["effect/unstable/*"],
              message:
                "Unstable Effect modules require a reviewed adapter under src/internal/effect-unstable-*.ts.",
            },
          ],
        },
      ],
    },
  },
];
