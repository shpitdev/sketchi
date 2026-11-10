import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { ICON_SOURCE_URL_PREFIX, iconManifest } from "@sketchi/icon-catalog/catalog";

import { catalogDrawings, DRAWINGS_LIBRARY_PATH, DRAWINGS_PATH } from "../src/lib/drawings.js";
import { excalidrawLibrary } from "../src/lib/excalidraw-export.js";

// The catalog package owns the manifest, SVG sources and hand-drawn recipes.
// The app publishes copies at stable public URLs; every output is generated
// and ignored.
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

const recipes = JSON.parse(
	await readFile(resolve(catalogRoot, "dist/native-icons.json"), "utf8"),
) as Record<string, unknown>;
const drawings = catalogDrawings(
	iconManifest.icons.map((icon) => icon.slug),
	recipes,
);
await writeFile(resolve(publicRoot, `.${DRAWINGS_PATH}`), `${JSON.stringify(drawings)}\n`, "utf8");
const names = new Map(iconManifest.icons.map((icon) => [icon.slug, icon.name]));
await writeFile(
	resolve(publicRoot, `.${DRAWINGS_LIBRARY_PATH}`),
	excalidrawLibrary(
		Object.entries(drawings).map(([slug, recipe]) => ({
			slug,
			name: names.get(slug) ?? slug,
			recipe,
		})),
		"https://icons.sketchi.app",
		"catalog",
	),
	"utf8",
);

process.stdout.write(
	`Published ${iconManifest.summary.totalIcons} icons and ${Object.keys(drawings).length} drawings into apps/icons/public.\n`,
);
