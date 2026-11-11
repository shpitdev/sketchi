import { describe, expect, it } from "vitest";

import { normalizeCssColor, sanitizeSvg } from "./svg-input.js";

function sanitized(svg: string) {
	const result = sanitizeSvg(svg);
	if (!result.ok) throw new Error(result.message);
	return result.value;
}

describe("sanitizeSvg", () => {
	it("keeps the drawing and drops scripts, handlers, metadata and outside references", () => {
		const { svg } = sanitized(`<?xml version="1.0"?>
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
			expect(svg).not.toContain(banned);
		}
		expect(svg).toMatch(/<svg[^>]*viewBox="0 0 24 24"[^>]*width="24"[^>]*height="24"/u);
	});

	it("keeps a mask's type, which decides whether its alpha or its luminance masks", () => {
		const { svg } = sanitized(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><mask id="m" mask-type="alpha"><rect width="24" height="24"/></mask><circle cx="12" cy="12" r="10" mask="url(#m)"/></svg>`,
		);
		expect(svg).toContain('mask-type="alpha"');
	});

	it("reads exact paint colors, inherited fills, classes and gradient stops", () => {
		const { colors } = sanitized(`<svg viewBox="0 0 10 10">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#4285F4"/><stop offset="1" style="stop-color: rgb(52, 168, 83)"/></linearGradient></defs>
  <style>.brand { fill: #E01E5A }</style>
  <g fill="#36c5f0"><path d="M0 0h1v1z"/><path d="M1 1h1v1z"/><path d="M2 2h1v1z"/></g>
  <path class="brand" d="M3 3h1v1z"/>
  <path d="M4 4h1v1z"/>
  <rect width="2" height="2" fill="url(#g)"/>
  <circle cx="5" cy="5" r="1" fill="none" stroke="#fff"/>
</svg>`);
		expect(colors[0]).toBe("#36c5f0");
		expect(colors).toEqual(
			expect.arrayContaining(["#e01e5a", "#000000", "#4285f4", "#34a853", "#ffffff"]),
		);
	});

	it("reads a translucent paint as the color it shows over paper", () => {
		const { colors } = sanitized(`<svg viewBox="0 0 10 10">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#000000" stop-opacity="0.5"/></linearGradient></defs>
  <path d="M0 0h1v1z" fill="#10161A" fill-opacity="0.5"/>
  <g opacity="0.5"><path d="M1 1h1v1z" fill="none" stroke="#000" stroke-opacity="0.6"/></g>
  <rect width="2" height="2" fill="url(#g)"/>
  <path d="M3 3h1v1z" fill="#e01e5a" fill-opacity="0"/>
</svg>`);
		expect(colors).toEqual(["#808080", "#888b8d", "#b3b3b3"]);
	});

	it("reads id-selector rules over element rules", () => {
		const { colors } = sanitized(`<svg viewBox="0 0 10 10">
  <style>path { fill: #ff0000 } #mark { fill: #ff7700 }</style>
  <path id="mark" d="M0 0h1v1z"/>
</svg>`);
		expect(colors).toEqual(["#ff7700"]);
	});

	it("resolves currentColor from the nearest color, black when none is set", () => {
		const { colors } = sanitized(`<svg viewBox="0 0 10 10">
  <g color="#2496ed"><path fill="currentColor" d="M1 1h1v1z"/><g style="color: #e01e5a"><path stroke="currentColor" fill="none" d="M2 2h1v1z"/></g></g>
  <path fill="currentColor" d="M3 3h1v1z"/>
</svg>`);
		expect([...colors].sort()).toEqual(["#000000", "#2496ed", "#e01e5a"]);
	});

	it("answers a deeply nested file as too complex instead of failing", () => {
		const nested = `<svg viewBox="0 0 1 1">${"<g>".repeat(99)}<rect width="1" height="1"/>${"</g>".repeat(99)}</svg>`;
		expect(nested.length).toBeLessThan(1024);
		expect(sanitizeSvg(nested)).toMatchObject({ ok: false, issue: "svg_too_complex" });
		const deeper = `<svg viewBox="0 0 1 1">${"<g>".repeat(5000)}${"</g>".repeat(5000)}</svg>`;
		expect(() => sanitizeSvg(deeper)).not.toThrow();
		expect(sanitizeSvg(deeper).ok).toBe(false);
	});

	it("rejects what it cannot draw safely", () => {
		expect(sanitizeSvg("<svg><rect")).toMatchObject({ ok: false, issue: "malformed_svg" });
		expect(sanitizeSvg("<html><body/></html>")).toMatchObject({ ok: false, issue: "not_svg" });
		expect(sanitizeSvg('<svg viewBox="0 0 10 10"><metadata/></svg>')).toMatchObject({
			ok: false,
			issue: "empty_svg",
		});
		expect(sanitizeSvg("<svg><rect width='1' height='1'/></svg>")).toMatchObject({
			ok: false,
			issue: "svg_without_size",
		});
		expect(
			sanitizeSvg(
				'<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
			),
		).toMatchObject({ ok: false, issue: "malformed_svg" });
		expect(
			sanitizeSvg(`<svg viewBox="0 0 1 1">${"<g>".repeat(1)}${"x".repeat(1024 * 1024)}</g></svg>`),
		).toMatchObject({
			ok: false,
			issue: "svg_too_large",
		});
	});

	it("takes a size from width and height when there is no viewBox", () => {
		expect(
			sanitized('<svg width="32px" height="16"><rect width="32" height="16"/></svg>').viewBox,
		).toEqual({
			minX: 0,
			minY: 0,
			width: 32,
			height: 16,
		});
	});
});

describe("normalizeCssColor", () => {
	it("normalizes the color forms logos use", () => {
		expect(normalizeCssColor("#ABC")).toBe("#aabbcc");
		expect(normalizeCssColor("#11223344")).toBe("#112233");
		expect(normalizeCssColor("rgb(255, 0, 128)")).toBe("#ff0080");
		expect(normalizeCssColor("rgba(100%, 0%, 0%, 0.5)")).toBe("#ff0000");
		expect(normalizeCssColor("Black")).toBe("#000000");
		expect(normalizeCssColor("currentColor")).toBe("#000000");
		expect(normalizeCssColor("none")).toBeUndefined();
		expect(normalizeCssColor("url(#g)")).toBeUndefined();
	});
});
