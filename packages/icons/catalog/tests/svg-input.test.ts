import { describe, expect, it } from "vitest";

import { sanitizeSvg } from "../src/svg-input";

describe("sanitizeSvg", () => {
	it("keeps the drawing and drops scripts, handlers, metadata and outside references", () => {
		const result = sanitizeSvg(`<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sodipodi="x" viewBox="0 0 24 24" onload="alert(1)">
  <metadata><rdf>tracking</rdf></metadata>
  <sodipodi:namedview id="base"/>
  <script>alert(1)</script>
  <foreignObject><div>html</div></foreignObject>
  <style>@import url(https://evil.example/x.css); .a { fill: #ff0000; background: url(https://evil.example/p.png) }</style>
  <a href="https://example.com"><circle class="a" cx="12" cy="12" r="10" onclick="steal()"/></a>
  <use href="https://evil.example/sprite.svg#icon"/>
  <use xlink:href="#dot"/>
  <image href="https://evil.example/tracker.png" width="1" height="1"/>
  <rect id="dot" width="4" height="4" fill="url(https://evil.example/paint)"/>
</svg>`);
		if (!result.ok) throw new Error(result.message);
		const { svg } = result.value;
		expect(svg).toContain("<circle");
		expect(svg).toContain('href="#dot"');
		for (const banned of [
			"script",
			"alert",
			"onload",
			"onclick",
			"metadata",
			"sodipodi",
			"foreignObject",
			"evil.example",
			"@import",
		]) {
			expect(svg, banned).not.toContain(banned);
		}
	});

	it("refuses what it cannot draw safely, without throwing", () => {
		const deep = `<svg viewBox="0 0 1 1">${"<g>".repeat(5000)}${"</g>".repeat(5000)}</svg>`;
		for (const [svg, issue] of [
			["<svg><rect", "malformed_svg"],
			[
				'<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
				"malformed_svg",
			],
			["<html><body/></html>", "not_svg"],
			['<svg viewBox="0 0 10 10"><metadata/></svg>', "empty_svg"],
			["<svg><rect width='1' height='1'/></svg>", "svg_without_size"],
			[
				`<svg viewBox="0 0 1 1">${"<g>".repeat(99)}<rect width="1" height="1"/>${"</g>".repeat(99)}</svg>`,
				"svg_too_complex",
			],
			[`<svg viewBox="0 0 1 1"><g>${"x".repeat(1024 * 1024)}</g></svg>`, "svg_too_large"],
		] as const) {
			expect(sanitizeSvg(svg), issue).toMatchObject({ ok: false, issue });
		}
		expect(() => sanitizeSvg(deep)).not.toThrow();
		expect(sanitizeSvg(deep).ok).toBe(false);
	});
});
