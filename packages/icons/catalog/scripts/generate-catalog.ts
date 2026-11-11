import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { catalogCommonWords, loadCommonEnglishWords } from "../src/common-words-generation.js";
import { buildIconCatalog, shippedSourceIcons } from "../src/manifest-generation.js";
import { initIconColorRenderer, measureIconColor } from "../src/icon-color-render.js";

const packageRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(packageRoot, "pipeline-output/review/review-data.json");
const catalogPath = resolve(packageRoot, "src/generated/icon-catalog.json");
const commonWordsPath = resolve(packageRoot, "src/generated/common-words.json");
const SVG_URL_PREFIX = "/output/upload-ready/svg/";

const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
	icons: { collection: string; slug: string; urlPath: string }[];
};

// Classify every mark from its SVG, so the manifest says how it meets light and dark surfaces.
await initIconColorRenderer();
// A folded mark ships under another product's slug, so only shipped marks are measured.
for (const icon of shippedSourceIcons(source.icons)) {
	if (!icon.urlPath.startsWith(SVG_URL_PREFIX)) {
		throw new Error(`Icon source ${icon.urlPath} is outside the SVG directory.`);
	}
	const file = resolve(packageRoot, "svg", icon.urlPath.slice(SVG_URL_PREFIX.length));
	Object.assign(icon, { color: measureIconColor(await readFile(file, "utf8"), icon.urlPath) });
}
const generated = buildIconCatalog(source);

await mkdir(dirname(catalogPath), { recursive: true });
await writeFile(catalogPath, `${JSON.stringify(generated)}\n`, "utf8");
await writeFile(
	commonWordsPath,
	`${JSON.stringify(catalogCommonWords(generated.manifest.icons, loadCommonEnglishWords()))}\n`,
	"utf8",
);

process.stdout.write(`Generated ${generated.manifest.summary.totalIcons} catalog icons.\n`);
