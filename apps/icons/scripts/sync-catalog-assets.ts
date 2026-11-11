import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { ICON_SOURCE_URL_PREFIX, iconManifest } from "@sketchi/icon-catalog/catalog";

import { catalogDrawings, DRAWINGS_PATH } from "../src/lib/drawings.js";
import { excalidrawLibrary } from "../src/lib/excalidraw-export.js";
import {
	ICON_PACKS,
	PACK_INDEX_PATH,
	packIcons,
	packLibraryPath,
	packPreviewImagePath,
	packSummary,
	packVersion,
} from "../src/lib/packs.js";
import { packPreviewImage } from "./pack-preview-image.js";

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
// Each pack publishes as a library to download, versioned by its hash; a pack
// listed for Excalidraw's library collection also gets the preview a
// submission sends. The index carries what the pages show before they load more.
const SOURCE = "https://icons.sketchi.app";
await rm(resolve(publicRoot, "packs"), { force: true, recursive: true });
await mkdir(resolve(publicRoot, "packs"), { recursive: true });
const summaries = [];
for (const pack of ICON_PACKS) {
	const members = packIcons(pack, iconManifest.icons, drawings);
	const library = excalidrawLibrary(members, SOURCE, "catalog");
	await writeFile(resolve(publicRoot, `.${packLibraryPath(pack.id)}`), library, "utf8");
	if (pack.excalidrawListing) {
		await writeFile(
			resolve(publicRoot, `.${packPreviewImagePath(pack.id)}`),
			await packPreviewImage(members.map((icon) => icon.recipe)),
		);
	}
	summaries.push(packSummary(pack, members, await packVersion(library)));
}
await writeFile(
	resolve(publicRoot, `.${PACK_INDEX_PATH}`),
	`${JSON.stringify(summaries)}\n`,
	"utf8",
);

process.stdout.write(
	`Published ${iconManifest.summary.totalIcons} icons, ${Object.keys(drawings).length} drawings and ${summaries.length} packs into apps/icons/public.\n`,
);
