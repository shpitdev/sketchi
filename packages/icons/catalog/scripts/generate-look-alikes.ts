import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { initWasm, Resvg } from "@resvg/resvg-wasm";

import { getIconSourceFile, nodeLogoIcons } from "../src/catalog.js";
import { lookAlikeSourceHash, LOOK_ALIKE_RENDER_SIZE } from "../src/look-alikes.js";
import { markFeatures } from "../src/mark-features.js";
import { sanitizeSvg } from "../src/svg-input.js";

// Features of every node-logo mark, rendered on white the way the draw service
// renders an uploaded logo, so a new mark can be judged against the marks it
// most resembles. Committed, and checked against the sources by a test.
const packageRoot = resolve(import.meta.dirname, "..");
const target = resolve(packageRoot, "src/generated/look-alikes.json");

const wasm = await readFile(
	createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm"),
);
await initWasm(wasm);

const marks: Record<string, unknown> = {};
for (const icon of [...nodeLogoIcons].sort((left, right) => left.slug.localeCompare(right.slug))) {
	const file = getIconSourceFile(icon.slug);
	if (!file) throw new Error(`Node logo ${icon.slug} has no source file.`);
	const source = await readFile(resolve(packageRoot, "svg", file), "utf8");
	const sanitized = sanitizeSvg(source);
	if (!sanitized.ok) throw new Error(`Node logo ${icon.slug}: ${sanitized.message}`);
	const { width, height } = sanitized.value.viewBox;
	const rendered = new Resvg(sanitized.value.svg, {
		background: "#ffffff",
		fitTo: { mode: width >= height ? "width" : "height", value: LOOK_ALIKE_RENDER_SIZE },
	}).render();
	const features = markFeatures({
		data: rendered.pixels,
		width: rendered.width,
		height: rendered.height,
	});
	rendered.free();
	if (!features) continue;
	marks[icon.slug] = { hash: lookAlikeSourceHash(source), ...features };
}

await writeFile(target, `${JSON.stringify({ version: 1, marks })}\n`, "utf8");
process.stdout.write(`Wrote look-alike features for ${Object.keys(marks).length} marks.\n`);
