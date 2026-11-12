import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { ICON_SOURCE_URL_PREFIX, iconManifest } from "@sketchi/icon-catalog/catalog";

import { catalogDrawings, DRAWINGS_PATH } from "../src/lib/drawings.js";
import { excalidrawLibrary } from "../src/lib/excalidraw-export.js";
import {
	ALL_ICONS_PACK_ID,
	ICON_PACKS,
	PACK_INDEX_PATH,
	type PackIcon,
	SITE_CARD_PATH,
	packCardPath,
	packIcons,
	packIconsPath,
	packLibraryPath,
	packPreview,
	packPreviewImagePath,
	packSummary,
	packVersion,
} from "../src/lib/packs.js";
import { packPreviewImage } from "./pack-preview-image.js";
import { packCard, siteCard } from "./social-cards.js";

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
// Each pack publishes as a library to download, versioned by its hash, and as
// the same library with names; a pack
// listed for Excalidraw's library collection also gets the preview a
// submission sends. The index carries what the pages show before they load more.
const SOURCE = "https://icons.sketchi.app";
await rm(resolve(publicRoot, "packs"), { force: true, recursive: true });
await mkdir(resolve(publicRoot, "packs"), { recursive: true });
const summaries = [];
const featured = new Map<string, PackIcon[]>();
for (const pack of ICON_PACKS) {
	const members = packIcons(pack, iconManifest.icons, drawings);
	// A pack whose marks are not drawn yet is not published.
	if (members.length === 0) continue;
	const library = excalidrawLibrary(members, SOURCE, "catalog");
	// The same library with each name under its drawing, to download; only the
	// plain one is versioned and published to Excalidraw's collection.
	const named = excalidrawLibrary(members, SOURCE, "catalog", { named: true });
	for (const [path, content] of [
		[packLibraryPath(pack.id), library],
		[packLibraryPath(pack.id, { named: true }), named],
	] as const) {
		await writeFile(resolve(publicRoot, `.${path}`), content, "utf8");
	}
	await writeFile(
		resolve(publicRoot, `.${packIconsPath(pack.id)}`),
		`${JSON.stringify(members)}\n`,
		"utf8",
	);
	if (pack.excalidrawListing) {
		await writeFile(
			resolve(publicRoot, `.${packPreviewImagePath(pack.id)}`),
			await packPreviewImage(members.map((icon) => icon.recipe)),
		);
	}
	await writeFile(
		resolve(publicRoot, `.${packCardPath(pack.id)}`),
		await packCard({
			id: pack.id,
			name: pack.name,
			icons: members.length,
			marks: packPreview(pack, members),
		}),
	);
	featured.set(pack.id, packPreview(pack, members));
	summaries.push(packSummary(pack, members, await packVersion(library)));
}
// The site's card mixes the packs' featured marks, the named packs first.
const CARD_PACKS = ["palantir", "google-cloud", "aws", "ai-models", "cloud", "devtools", "data"];
const marks: PackIcon[] = [];
for (let round = 0; marks.length < 12 && round < 6; round++) {
	for (const id of CARD_PACKS) {
		const mark = featured.get(id)?.[round];
		if (mark && marks.length < 12 && !marks.some((shown) => shown.slug === mark.slug))
			marks.push(mark);
	}
}
await writeFile(
	resolve(publicRoot, `.${SITE_CARD_PATH}`),
	await siteCard({
		icons: summaries.find((summary) => summary.id === ALL_ICONS_PACK_ID)?.count ?? 0,
		packs: summaries.filter((summary) => summary.id !== ALL_ICONS_PACK_ID).length,
		marks,
	}),
);
await writeFile(
	resolve(publicRoot, `.${PACK_INDEX_PATH}`),
	`${JSON.stringify(summaries)}\n`,
	"utf8",
);

process.stdout.write(
	`Published ${iconManifest.summary.totalIcons} icons, ${Object.keys(drawings).length} drawings and ${summaries.length} packs into apps/icons/public.\n`,
);
