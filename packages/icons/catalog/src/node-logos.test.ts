import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getIconBySlug, getIconSourceFile, iconManifest, nodeLogoIcons } from "./catalog";
import { isNodeLogoEligible, NODE_LOGO_MAX_BYTES, normalizeNodeLogoSvg } from "./node-logos";

const svgRoot = resolve(process.cwd(), "packages/icons/catalog/svg");

function readSource(slug: string): string {
	const file = getIconSourceFile(slug);
	if (!file) throw new Error(`No source file for ${slug}.`);
	return readFileSync(resolve(svgRoot, file), "utf8");
}

describe("node logo eligibility", () => {
	it("accepts compact marks and rejects wordmarks and oversized sources", () => {
		expect(isNodeLogoEligible({ bytes: 2_000 })).toBe(true);
		expect(isNodeLogoEligible({ bytes: NODE_LOGO_MAX_BYTES })).toBe(true);
		expect(isNodeLogoEligible({ bytes: NODE_LOGO_MAX_BYTES + 1 })).toBe(false);
		expect(isNodeLogoEligible({ bytes: 2_000, variant: "text" })).toBe(false);
	});

	it("selects every catalog mark except wordmarks and six oversized sources", () => {
		const wordmarks = iconManifest.icons.filter((icon) => icon.variant);
		const oversized = iconManifest.icons
			.filter((icon) => !icon.variant && icon.bytes > NODE_LOGO_MAX_BYTES)
			.map((icon) => icon.slug)
			.sort();

		expect(oversized).toEqual(["aionlabs", "dolphin", "linux", "nano", "tanstack", "zustand"]);
		expect(nodeLogoIcons).toHaveLength(
			iconManifest.icons.length - wordmarks.length - oversized.length,
		);
		for (const slug of ["github", "docker", "cloudflare", "kubernetes"]) {
			expect(nodeLogoIcons.some((icon) => icon.slug === slug)).toBe(true);
		}
	});
});

describe("node logo SVG normalization", () => {
	it("adds intrinsic width and height from the viewBox", () => {
		expect(
			normalizeNodeLogoSvg(
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path stroke-width="2"/></svg>',
			),
		).toBe(
			'<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path stroke-width="2"/></svg>',
		);
	});

	it("keeps the XML prolog and adds a missing namespace", () => {
		expect(normalizeNodeLogoSvg('<?xml version="1.0"?>\n<svg viewBox="0,0,24,16"><g/></svg>')).toBe(
			'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0,0,24,16"><g/></svg>',
		);
	});

	it("leaves already sized SVGs unchanged", () => {
		const sized =
			'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 512 512"/>';
		expect(normalizeNodeLogoSvg(sized)).toBe(sized);
	});

	it("rejects sources without a root element or a usable viewBox", () => {
		expect(() => normalizeNodeLogoSvg("<g/>")).toThrow("no <svg> root");
		expect(() => normalizeNodeLogoSvg("<svg><g/></svg>")).toThrow("no valid viewBox");
		expect(() => normalizeNodeLogoSvg('<svg viewBox="0 0 0 10"/>')).toThrow("no valid viewBox");
	});

	it("normalizes every eligible catalog mark to a 512px square idempotently", () => {
		for (const icon of nodeLogoIcons) {
			const normalized = normalizeNodeLogoSvg(readSource(icon.slug));
			const root = /<svg\b[^>]*>/u.exec(normalized)?.[0] ?? "";

			expect(root, icon.slug).toContain(' width="512"');
			expect(root, icon.slug).toContain(' height="512"');
			expect(root, icon.slug).toContain(' xmlns="http://www.w3.org/2000/svg"');
			expect(normalizeNodeLogoSvg(normalized), icon.slug).toBe(normalized);
		}
	});
});

describe("icon catalog", () => {
	it("resolves source files inside the package svg directory", () => {
		expect(getIconBySlug("docker")?.name).toBe("Docker");
		expect(getIconSourceFile("docker")).toBe("devtools-ci/docker.svg");
		expect(getIconSourceFile("missing-slug")).toBeUndefined();
		for (const slug of ["constructor", "__proto__", "toString"]) {
			expect(getIconBySlug(slug), slug).toBeUndefined();
			expect(getIconSourceFile(slug), slug).toBeUndefined();
		}
		expect(readSource("docker")).toContain("<svg");
	});
});
