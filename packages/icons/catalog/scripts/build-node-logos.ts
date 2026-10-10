import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getIconSourceFile, nodeLogoIcons } from "../src/catalog.js";
import { normalizeNodeLogoSvg } from "../src/node-logos.js";

// Normalized node-logo SVGs in two shapes: one file per slug for hosts that
// serve them as static assets, and one JSON map for hosts that bundle them.
const packageRoot = resolve(import.meta.dirname, "..");
const distRoot = resolve(packageRoot, "dist");
const filesRoot = resolve(distRoot, "node-logos");

const svgs: Record<string, string> = {};
for (const icon of nodeLogoIcons) {
  const file = getIconSourceFile(icon.slug);
  if (!file) {
    throw new Error(`Node logo ${icon.slug} has no source file.`);
  }
  svgs[icon.slug] = normalizeNodeLogoSvg(
    await readFile(resolve(packageRoot, "svg", file), "utf8"),
  );
}

await rm(filesRoot, { force: true, recursive: true });
await mkdir(filesRoot, { recursive: true });
await Promise.all(
  Object.entries(svgs).map(([slug, svg]) =>
    writeFile(resolve(filesRoot, `${slug}.svg`), svg, "utf8"),
  ),
);
await writeFile(
  resolve(distRoot, "node-logo-svgs.json"),
  `${JSON.stringify(svgs)}\n`,
  "utf8",
);
await writeFile(
  resolve(distRoot, "node-logo-svgs.d.ts"),
  [
    "/** Normalized SVG markup for every node-logo slug. */",
    "declare const nodeLogoSvgs: Readonly<Record<string, string>>;",
    "export default nodeLogoSvgs;",
    "",
  ].join("\n"),
  "utf8",
);

process.stdout.write(
  `Built ${Object.keys(svgs).length} node logos into packages/icons/catalog/dist.\n`,
);
