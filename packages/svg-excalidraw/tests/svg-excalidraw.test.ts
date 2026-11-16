// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { inspectSvgCapabilities } from "../src/lib/capabilities";
import { convertSvgToExcalidraw } from "../src/lib/convert";
import * as flatten from "../src/lib/flatten";
import { serializeExcalidrawLibrary } from "../src/lib/library";
import { parseSvg } from "../src/lib/parse";
import type { CanonicalSvgDocument } from "../src/lib/types";
import { corpusFixtures } from "./corpus-fixtures";

type ParseOptions = NonNullable<Parameters<typeof parseSvg>[1]>;

function mustParse(source: string, options: ParseOptions = {}) {
	const result = parseSvg(source, { sourceName: "inline.svg", ...options });
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	return result.document;
}

const codes = (document: CanonicalSvgDocument) => document.diagnostics.map(({ code }) => code);

describe("SVG import fails closed", () => {
	it.each(["<svg><path></svg>", "<html></html>"])("returns a typed fatal result for %s", (svg) => {
		const result = parseSvg(svg);
		expect(result).toMatchObject({ ok: false, document: null });
		expect(result.diagnostics[0]?.code).toBe("invalid-svg");
	});

	it("blocks unsupported semantics with no elements", () => {
		const result = convertSvgToExcalidraw(
			mustParse(corpusFixtures.realClip.source, { sourceName: corpusFixtures.realClip.sourceName }),
		);
		expect(result).toMatchObject({ ok: false, reason: "native-unsupported", elements: [] });
		expect(result.diagnostics.map(({ code }) => code)).toContain("native-capability-blocked");
	});

	it.each([
		['<rect width="10" height="10" mask="url(https://example.com/m.svg#m)"/>', "mask"],
		['<rect width="10" height="10" filter="url(#missing)"/>', "filter"],
	])("blocks an external or missing reference: %s", (shape, feature) => {
		const document = mustParse(`<svg>${shape}</svg>`);
		expect(
			document.diagnostics
				.filter(({ code }) => code === "native-unsupported-feature")
				.map((entry) => entry.feature),
		).toEqual([feature]);
		expect(inspectSvgCapabilities(document).nativeTrace).toBe("unsupported");
	});

	it("diagnoses missing and cyclic use references without throwing", () => {
		const document = mustParse(
			'<svg viewBox="0 0 10 10"><defs><g id="cycle"><use href="#cycle"/></g></defs><use href="#missing"/><use href="#cycle"/></svg>',
		);
		expect(codes(document)).toEqual(["use-cycle", "use-reference-missing"]);
		expect(inspectSvgCapabilities(document).nativeTrace).toBe("unsupported");
	});

	it.each([
		[
			"a contour quantization collapses",
			"M0 0L999999999999 999999999999L0 999999999999L999999999999 0Z M10.1 10.1L10.4 10.4L10.1 10.4L10.4 10.1Z",
		],
		[
			"a thin contour Clipper would drop",
			"M0 0L1000000000 999999999L1000100000 1000099999Z M-20 0L-10 10L-20 10L-10 0Z",
		],
		[
			"a fill missing from one partial element",
			"M0 0L40000000 39999999L40100000 40099999L0 0L50000000 0L60000000 0L60000000 10000000L50000000 10000000L50000000 0L0 0Z",
		],
		[
			"nonzero topology past safe integers",
			"M0 0L2000000000000 2000000000000L0 2000000000000L2000000000000 0Z",
		],
	])("returns no partial output when %s", (_case, path) => {
		const result = convertSvgToExcalidraw(mustParse(`<svg><path fill="#000" d="${path}"/></svg>`), {
			roughness: 0,
		});
		expect(result.ok).toBe(false);
		expect(result.elements).toEqual([]);
		expect(result.diagnostics.map(({ code }) => code)).toContain("native-unsupported-topology");
	});
});

describe("SVG import spend bounds", () => {
	it.each([
		[
			"expansions",
			'<svg><defs><path id="leaf" d="M0 0h1v1H0z"/><g id="a"><use href="#leaf"/><use href="#leaf"/></g><g id="b"><use href="#a"/><use href="#a"/></g><g id="c"><use href="#b"/><use href="#b"/></g><g id="d"><use href="#c"/><use href="#c"/></g></defs><use href="#d"/></svg>',
			{ maxDepth: 16, maxExpansions: 10, maxShapes: 100 },
		],
		[
			"depth",
			'<svg><defs><path id="leaf" d="M0 0h1v1H0z"/><g id="a"><use href="#leaf"/></g><g id="b"><use href="#a"/></g><g id="c"><use href="#b"/></g></defs><use href="#c"/></svg>',
			{ maxDepth: 2, maxExpansions: 100, maxShapes: 100 },
		],
		[
			"shapes",
			'<svg><path d="M0 0h1v1H0z"/><path d="M2 0h1v1H2z"/><path d="M4 0h1v1H4z"/></svg>',
			{ maxDepth: 16, maxExpansions: 100, maxShapes: 2 },
		],
	])("stops use expansion at its %s budget", (_budget, svg, useExpansion) => {
		const document = mustParse(svg, { useExpansion });
		expect(document.metrics.usesResolved).toBeLessThanOrEqual(useExpansion.maxExpansions);
		expect(document.shapes.length).toBeLessThanOrEqual(useExpansion.maxShapes);
		expect(codes(document)[0]).toBe("use-expansion-limit-exceeded");
		expect(convertSvgToExcalidraw(document).ok).toBe(false);
	});

	it("rejects an over-budget pathological path before flattening it", () => {
		const flattened: string[] = [];
		const original = flatten.flattenPrimitive;
		const spy = vi.spyOn(flatten, "flattenPrimitive").mockImplementation((...args) => {
			flattened.push(args[1].id ?? args[0]);
			return original(...args);
		});
		try {
			const document = mustParse(
				`<svg><rect width="10" height="10"/><path id="pathological" d="M0 0${"C0 1e20 1e20 0 1e20 1e20A1e20 1e20 0 1 1 0 0".repeat(16)}"/></svg>`,
				{ flattening: { maxDepth: 26, tolerance: 0.01 }, useExpansion: { maxShapes: 1 } },
			);
			expect(codes(document)).toEqual(["use-expansion-limit-exceeded"]);
			expect(flattened).not.toContain("pathological");
		} finally {
			spy.mockRestore();
		}
	});
});

it("converts the same SVG to byte-identical library JSON", () => {
	const convert = () => {
		const result = convertSvgToExcalidraw(
			mustParse(corpusFixtures.counter.source, { sourceName: corpusFixtures.counter.sourceName }),
			{ fillStyle: "hachure", roughness: 2 },
		);
		if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
		return serializeExcalidrawLibrary([
			{ elements: result.elements, id: `svg:${result.sourceHash}`, name: "AI21" },
		]);
	};
	const first = convert();
	expect(convert()).toBe(first);
	expect(JSON.parse(first)).toMatchObject({ type: "excalidrawlib", version: 2 });
});
