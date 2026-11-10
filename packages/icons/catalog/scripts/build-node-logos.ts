import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getIconSourceFile, nodeLogoIcons, standaloneWordmarkIcons } from "../src/catalog.js";
import { nodeLogoSvgForPaper } from "../src/node-logos.js";

// Node-logo SVGs ready for diagram paper, in two shapes: one file per slug for hosts that
// serve them as static assets, and one JSON map for hosts that bundle them.
// Static hosts also serve wordmarks, which standalone icons may draw; the
// bundled map leaves them out to stay small.
const packageRoot = resolve(import.meta.dirname, "..");
const distRoot = resolve(packageRoot, "dist");
const filesRoot = resolve(distRoot, "node-logos");

const svgs: Record<string, string> = {};
const wordmarks: Record<string, string> = {};
for (const [icons, into] of [
	[nodeLogoIcons, svgs],
	[standaloneWordmarkIcons, wordmarks],
] as const) {
	for (const icon of icons) {
		const file = getIconSourceFile(icon.slug);
		if (!file) {
			throw new Error(`Node logo ${icon.slug} has no source file.`);
		}
		into[icon.slug] = nodeLogoSvgForPaper(
			await readFile(resolve(packageRoot, "svg", file), "utf8"),
			icon,
		);
	}
}

await rm(filesRoot, { force: true, recursive: true });
await mkdir(filesRoot, { recursive: true });
await Promise.all(
	Object.entries({ ...svgs, ...wordmarks }).map(([slug, svg]) =>
		writeFile(resolve(filesRoot, `${slug}.svg`), svg, "utf8"),
	),
);
await writeFile(resolve(distRoot, "node-logo-svgs.json"), `${JSON.stringify(svgs)}\n`, "utf8");
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
	`Built ${Object.keys(svgs).length} node logos and ${Object.keys(wordmarks).length} wordmarks into packages/icons/catalog/dist.\n`,
);
