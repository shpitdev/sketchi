import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildIconCatalog } from "../src/lib/icon-manifest-generation.js";

const appRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(appRoot, "pipeline-output/review/review-data.json");
const publicManifestPath = resolve(appRoot, "public/icons-manifest.json");
const internalCatalogPath = resolve(appRoot, "src/generated/icon-catalog.json");

const source: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
const generated = buildIconCatalog(source);

await Promise.all([
  mkdir(dirname(publicManifestPath), { recursive: true }),
  mkdir(dirname(internalCatalogPath), { recursive: true }),
]);
await Promise.all([
  writeFile(
    publicManifestPath,
    `${JSON.stringify(generated.manifest)}\n`,
    "utf8",
  ),
  writeFile(internalCatalogPath, `${JSON.stringify(generated)}\n`, "utf8"),
]);

process.stdout.write(
  `Generated ${generated.manifest.summary.totalIcons} public icons.\n`,
);
