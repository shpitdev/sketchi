import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { execFileSync } from "node:child_process";

import {
  excalidrawFontFiles,
  excalidrawFontHeaders,
  excalidrawFonts,
  excalidrawFontsDirectory,
} from "./excalidraw-fonts.mjs";
import { workerProjectConfig, workerProjectIds } from "./worker-apps.mjs";

const repoRoot = new URL("../../", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

test("lists every Excalidraw font family the editor can request", () => {
  const families = new Set(
    excalidrawFontFiles().map((file) => file.split("/")[0]),
  );
  for (const family of ["Cascadia", "Excalifont", "Nunito", "Xiaolai"]) {
    assert.ok(families.has(family), `missing ${family}`);
  }
});

test("vendored Excalifont subsets are the package's own files", () => {
  const vendored = "packages/diagram/ui/public/fonts/Excalifont";
  for (const file of excalidrawFontFiles().filter((name) =>
    name.startsWith("Excalifont/"),
  )) {
    assert.deepEqual(
      readFileSync(new URL(`${vendored}/${file.slice(11)}`, repoRoot)),
      readFileSync(join(excalidrawFontsDirectory(), file)),
      file,
    );
  }
});

test("emits fonts into the client build except files public already ships", () => {
  const publicDir = mkdtempSync(join(tmpdir(), "excalidraw-fonts-"));
  const [shipped, ...emitted] = excalidrawFontFiles();
  mkdirSync(join(publicDir, "fonts", shipped.split("/")[0]), {
    recursive: true,
  });
  writeFileSync(join(publicDir, "fonts", shipped), "");

  const plugin = excalidrawFonts();
  plugin.configResolved({ publicDir });
  const files = [];
  plugin.generateBundle.call({ emitFile: (file) => files.push(file.fileName) });

  assert.deepEqual(
    files,
    emitted.map((file) => `fonts/${file}`),
  );
  assert.equal(plugin.applyToEnvironment({ name: "client" }), true);
  assert.equal(plugin.applyToEnvironment({ name: "ssr" }), false);
});

const EXCALIDRAW = "@excalidraw/excalidraw";
const RENDERERS = new Set([EXCALIDRAW, "@sketchi/diagram-ui"]);

/**
 * Runtime Excalidraw imports allowed outside diagram-ui's loader. The CLI's
 * headless PNG renderer runs in Node and embeds its own bundled Excalifont, so
 * it never resolves fonts against an asset path.
 */
const RUNTIME_IMPORT_EXCEPTIONS = new Set([
  "packages/diagram/ui/src/lib/load-excalidraw.ts",
  "apps/cli/src/png-renderer-runtime.ts",
]);

function trackedFiles(...patterns) {
  return execFileSync("git", ["ls-files", "--", ...patterns], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/** Drops comments so a commented-out registration or import does not count. */
function code(source) {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function registersFonts(path) {
  return /\bexcalidrawFonts\(\)/.test(code(read(path)));
}

const packages = new Map(
  trackedFiles("package.json", "**/package.json").map((path) => {
    const manifest = JSON.parse(read(path));
    return [
      path.slice(0, -"/package.json".length),
      {
        name: manifest.name,
        dependencies: Object.keys({
          ...manifest.dependencies,
          ...manifest.devDependencies,
        }),
      },
    ];
  }),
);
const dependenciesByName = new Map(
  [...packages.values()].map((entry) => [entry.name, entry.dependencies]),
);

/** Depends on Excalidraw directly or through one workspace package. */
function reachesExcalidraw(directory) {
  const dependencies = packages.get(directory)?.dependencies ?? [];
  return dependencies.some(
    (name) =>
      RENDERERS.has(name) ||
      (dependenciesByName.get(name) ?? []).some((nested) =>
        RENDERERS.has(nested),
      ),
  );
}

test("every Worker app that renders Excalidraw serves and caches its fonts", () => {
  const surfaces = workerProjectIds.filter((id) =>
    reachesExcalidraw(workerProjectConfig(id).projectRoot),
  );
  assert.deepEqual([...surfaces].sort(), [
    "eval-harness",
    "excalidraw",
    "playground",
  ]);
  for (const id of surfaces) {
    const root = workerProjectConfig(id).projectRoot;
    assert.ok(
      registersFonts(`${root}/vite.config.ts`),
      `${id} must register the excalidrawFonts Vite plugin`,
    );
    assert.ok(
      read(`${root}/public/_headers`).includes(excalidrawFontHeaders()),
      `${id} public/_headers must contain excalidrawFontHeaders()`,
    );
  }
});

test("every Storybook that renders Excalidraw serves its fonts", () => {
  const storybooks = trackedFiles("**/.storybook/main.ts");
  const surfaces = storybooks.filter((path) => {
    const project = path.slice(0, -"/.storybook/main.ts".length);
    return (
      reachesExcalidraw(project) ||
      /diagram-ui|excalidraw/i.test(
        code(read(path)).replaceAll(
          /excalidrawFonts|excalidraw-fonts\.mjs/g,
          "",
        ),
      )
    );
  });
  assert.deepEqual(surfaces.sort(), [
    "apps/excalidraw/.storybook/main.ts",
    "apps/native-conversion-storybook/.storybook/main.ts",
    "packages/diagram/ui/.storybook/main.ts",
  ]);
  for (const path of surfaces) {
    assert.ok(registersFonts(path), `${path} must register excalidrawFonts`);
  }
});

test("Excalidraw loads at runtime only through diagram-ui's loader", () => {
  const runtimeImport = new RegExp(
    [
      `(?<!typeof\\s*)\\bimport\\s*\\(\\s*["']${EXCALIDRAW}["']`,
      `\\b(?:import|export)\\s+(?!type\\b)[^;]*?\\bfrom\\s*["']${EXCALIDRAW}["']`,
    ].join("|"),
  );
  const offenders = trackedFiles(
    "apps/**/*.ts",
    "apps/**/*.tsx",
    "packages/**/*.ts",
    "packages/**/*.tsx",
  ).filter(
    (path) =>
      !/\.(test|browser\.test|stories)\.tsx?$|\.d\.ts$/.test(path) &&
      !RUNTIME_IMPORT_EXCEPTIONS.has(path) &&
      runtimeImport.test(code(read(path))),
  );
  assert.deepEqual(offenders, []);
});
