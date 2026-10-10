import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  excalidrawFontFiles,
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

test("every surface that renders Excalidraw serves its fonts", () => {
  const surfaces = workerProjectIds.filter((id) => {
    const { dependencies = {} } = JSON.parse(
      read(`${workerProjectConfig(id).projectRoot}/package.json`),
    );
    return (
      "@excalidraw/excalidraw" in dependencies ||
      "@sketchi/diagram-ui" in dependencies
    );
  });
  assert.deepEqual(surfaces.sort(), [
    "eval-harness",
    "excalidraw",
    "playground",
  ]);
  for (const id of surfaces) {
    assert.match(
      read(`${workerProjectConfig(id).projectRoot}/vite.config.ts`),
      /excalidrawFonts\(\)/,
      `${id} must register the excalidrawFonts Vite plugin`,
    );
  }
  for (const storybook of [
    "packages/diagram/ui/.storybook/main.ts",
    "apps/excalidraw/.storybook/main.ts",
  ]) {
    assert.match(read(storybook), /excalidrawFonts\(\)/, storybook);
  }
});
