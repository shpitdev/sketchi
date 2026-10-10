import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { ICON_SOURCE_URL_PREFIX, iconManifest } from "@sketchi/icon-catalog/catalog";

// The catalog package owns the manifest and SVG sources. The app publishes
// copies at the stable public URLs; both outputs are generated and ignored.
const appRoot = resolve(import.meta.dirname, "..");
const publicRoot = resolve(appRoot, "public");
const catalogRoot = dirname(
	createRequire(import.meta.url).resolve("@sketchi/icon-catalog/package.json"),
);
const svgTarget = resolve(publicRoot, `.${ICON_SOURCE_URL_PREFIX}`);

await rm(resolve(publicRoot, "output"), { force: true, recursive: true });
await mkdir(dirname(svgTarget), { recursive: true });
await cp(resolve(catalogRoot, "svg"), svgTarget, { recursive: true });
await writeFile(
	resolve(publicRoot, "icons-manifest.json"),
	`${JSON.stringify(iconManifest)}\n`,
	"utf8",
);

process.stdout.write(
	`Published ${iconManifest.summary.totalIcons} icons into apps/icons/public.\n`,
);
