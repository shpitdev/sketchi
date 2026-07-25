import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Excalifont is the typeface Sketchi diagrams render in and, since the wordmark
 * moved off Dancing Script, the brand mark too. Each Worker serves assets from
 * its own `public/`, so the vendored subsets exist once per surface. Copies of a
 * binary drift silently: one surface gets re-vendored, the others keep an older
 * face, and the wordmark stops matching the diagrams it is supposed to be an
 * instance of. These tests pin the copies together.
 *
 * The @font-face declarations live in the shared theme, so the obligation is
 * every theme consumer, not just the ones that draw a wordmark today. A surface
 * that imports the theme without shipping the files requests them and gets a
 * 404, which leaves an errored face in a family the diagram canvas also uses.
 * `themeConsumers()` therefore derives the list from the imports rather than
 * hardcoding it, so a new surface fails here instead of in production.
 *
 * diagram-ui declares the face, so it holds the reference copy and serves it to
 * Storybook through `staticDirs`; every surface must match that copy byte for
 * byte.
 *
 * The files are also redistributed under the SIL Open Font License 1.1, whose
 * clause 2 requires the copyright notice and licence to travel with every copy.
 * That obligation is a per-copy fact, not a repo-root one, so it is asserted
 * per copy here.
 */
const THEME_PACKAGE = "packages/diagram/ui";

const THEME_CSS = `${THEME_PACKAGE}/src/theme.css`;

const FONT_DIRECTORY = "public/fonts/Excalifont";

/** cn-font-split emits one file per unicode subset, not one file per face. */
const EXPECTED_SUBSET_COUNT = 7;

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const themeCss = readFileSync(join(repoRoot, THEME_CSS), "utf8");

/** Every app whose stylesheet pulls in the theme that declares the font. */
function themeConsumers(): string[] {
  return readdirSync(join(repoRoot, "apps"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((app) => {
      let appCss: string;

      try {
        appCss = readFileSync(
          join(repoRoot, "apps", app, "src/styles/app.css"),
          "utf8",
        );
      } catch {
        return false;
      }

      return appCss.includes("diagram/ui/src/theme.css");
    })
    .map((app) => `apps/${app}`)
    .sort();
}

const SURFACES = themeConsumers();

/** The reference copy plus every copy that must match it. */
const COPIES = [THEME_PACKAGE, ...SURFACES];

function fontDirectory(surface: string): string {
  return join(repoRoot, surface, FONT_DIRECTORY);
}

function subsetDigests(surface: string): Record<string, string> {
  const directory = fontDirectory(surface);
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".woff2"))
    .sort();

  return Object.fromEntries(
    files.map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(join(directory, name)))
        .digest("hex"),
    ]),
  );
}

describe("vendored Excalifont", () => {
  const referenceDigests = subsetDigests(THEME_PACKAGE);

  it("vendors every subset, because one alone silently falls back", () => {
    expect(Object.keys(referenceDigests)).toHaveLength(EXPECTED_SUBSET_COUNT);
  });

  it("knows every surface that inherits the font declarations", () => {
    // Listed as well as derived: a new theme consumer should fail here with
    // "vendor the font too", not ship a surface that 404s its own brand face.
    expect(SURFACES).toEqual([
      "apps/eval-harness",
      "apps/excalidraw",
      "apps/icons",
      "apps/playground",
      "apps/web",
    ]);
  });

  it.each(SURFACES)("serves byte-identical subsets from %s", (surface) => {
    expect(subsetDigests(surface)).toEqual(referenceDigests);
  });

  it.each(COPIES)("ships the OFL notice beside the fonts in %s", (surface) => {
    const licence = readFileSync(
      join(fontDirectory(surface), "LICENSE"),
      "utf8",
    );

    expect(licence).toContain("Copyright (c) 2024 by Excalidraw");
    expect(licence).toContain("SIL Open Font License, Version 1.1");
    expect(licence).toContain("Excalifont is a trademark of Excalidraw");
  });

  it("serves the reference copy to Storybook", () => {
    const storybookConfig = readFileSync(
      join(repoRoot, THEME_PACKAGE, ".storybook/main.ts"),
      "utf8",
    );

    expect(storybookConfig).toMatch(/staticDirs:\s*\["\.\.\/public"\]/u);
  });

  it("keeps the social card wordmark off the retired face", () => {
    // The card is a static PNG, so a token swap cannot reach it. Its wordmark
    // is Excalifont outlines; the one thing that must never come back is a
    // <text> element naming a font the renderer may not have.
    const card = readFileSync(
      join(repoRoot, "apps/web/public/media/sketchi-og-card.svg"),
      "utf8",
    );

    expect(card).not.toContain("Dancing Script");
    expect(card).not.toContain("NaN");
  });

  it("declares an @font-face for every vendored subset", () => {
    for (const name of Object.keys(referenceDigests)) {
      expect(themeCss).toContain(`/fonts/Excalifont/${name}`);
    }
  });

  it("never asks the browser to synthesise a weight the face lacks", () => {
    // Excalifont ships Regular only. A bolder wordmark is a faux-bold smear,
    // so no @font-face may claim a weight the file cannot deliver.
    const declaredWeights = [...themeCss.matchAll(/font-weight:\s*(\d+)/gu)]
      .map((match) => match[1])
      .filter((weight, index, all) => all.indexOf(weight) === index);

    expect(declaredWeights).toContain("400");

    const scriptRule = /\.sk-wordmark\s*\{[^}]*\}/u.exec(themeCss)?.[0] ?? "";
    expect(scriptRule).toContain("var(--font-script)");
    expect(scriptRule).toMatch(/font-weight:\s*400/u);
  });

  it("keeps the script token on Excalifont rather than a Google default", () => {
    expect(themeCss).toMatch(/--font-script:\s*"Excalifont"/u);
    expect(themeCss).not.toContain("Dancing Script");
  });
});
