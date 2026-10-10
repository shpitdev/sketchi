import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { catalogCommonWords, loadCommonEnglishWords } from "../src/common-words-generation.js";
import { buildIconCatalog } from "../src/manifest-generation.js";

const packageRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(packageRoot, "pipeline-output/review/review-data.json");
const catalogPath = resolve(packageRoot, "src/generated/icon-catalog.json");
const commonWordsPath = resolve(packageRoot, "src/generated/common-words.json");

const source: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
const generated = buildIconCatalog(source);

await mkdir(dirname(catalogPath), { recursive: true });
await writeFile(catalogPath, `${JSON.stringify(generated)}\n`, "utf8");
await writeFile(
	commonWordsPath,
	`${JSON.stringify(catalogCommonWords(generated.manifest.icons, loadCommonEnglishWords()))}\n`,
	"utf8",
);

process.stdout.write(`Generated ${generated.manifest.summary.totalIcons} catalog icons.\n`);
