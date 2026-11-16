import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { getIconSourceFile, iconManifest, nodeLogoIcons } from "../src/catalog";
import { catalogCommonWords, loadCommonEnglishWords } from "../src/common-words-generation";
import { initIconColorRenderer, measureIconColor } from "../src/icon-color-render";
import { lookAlikeMarks, lookAlikeSourceHash } from "../src/look-alikes";
import { nodeLogoSvgForPaper } from "../src/node-logos";

const svgRoot = resolve(import.meta.dirname, "../svg");

function source(slug: string): string {
	const file = getIconSourceFile(slug);
	if (!file) throw new Error(`No source file for ${slug}.`);
	return readFileSync(resolve(svgRoot, file), "utf8");
}

describe("committed icon catalog", () => {
	beforeAll(() => initIconColorRenderer());

	// Regenerate with `pnpm nx generate-catalog icon-catalog` and
	// `pnpm nx generate-look-alikes icon-catalog`.
	it("matches its sources: colors, look-alike hashes and common words", { timeout: 60_000 }, () => {
		const staleColors = iconManifest.icons.flatMap((icon) => {
			const { colorMode, onDark, onLight } = icon;
			const committed = { colorMode, ...(onDark ? { onDark } : {}), ...(onLight ? { onLight } : {}) };
			return JSON.stringify(measureIconColor(source(icon.slug), icon.slug)) ===
				JSON.stringify(committed)
				? []
				: [icon.slug];
		});
		expect(staleColors).toEqual([]);

		const staleLookAlikes = nodeLogoIcons.flatMap((icon) =>
			lookAlikeMarks[icon.slug]?.hash === lookAlikeSourceHash(source(icon.slug)) ? [] : [icon.slug],
		);
		expect(staleLookAlikes).toEqual([]);
		expect(Object.keys(lookAlikeMarks)).toHaveLength(nodeLogoIcons.length);

		const commonWords: unknown = JSON.parse(
			readFileSync(resolve(import.meta.dirname, "../src/generated/common-words.json"), "utf8"),
		);
		expect(commonWords).toEqual(catalogCommonWords(iconManifest.icons, loadCommonEnglishWords()));
	});

	it("fits the Worker bundle and carries no review fields", () => {
		const shipped = JSON.stringify(iconManifest);
		expect(shipped).not.toContain('"flags"');
		expect(shipped).not.toContain('"similarityGroupSize"');
		expect(Buffer.byteLength(shipped)).toBeLessThan(900_000);
	});

	it("draws every node logo so it reads on diagram paper", { timeout: 60_000 }, () => {
		const unreadable = nodeLogoIcons.flatMap((icon) =>
			measureIconColor(nodeLogoSvgForPaper(source(icon.slug), icon), icon.slug).onLight
				? [icon.slug]
				: [],
		);
		expect(unreadable).toEqual([]);
	});
});
