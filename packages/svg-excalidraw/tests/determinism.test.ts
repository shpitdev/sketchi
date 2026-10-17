import { describe, expect, it } from "vitest";

import {
	convertSvgToExcalidraw,
	deterministicLibraryChecksum,
	parseSvg,
	serializeExcalidrawLibrary,
} from "../src";
import {
	constructNativeTrace,
	deterministicTraceChecksum,
	deterministicTraceJson,
} from "../src/lib/native";

const corpusMulticolorFixture =
	'<svg style="flex:none;line-height:1" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><g transform="translate(36.685 30.72) scale(19.576)"><title>vLLM</title><path d="M0 4.973h9.324V23L0 4.973z" fill="#FDB515"></path><path d="M13.986 4.351L22.378 0l-6.216 23H9.324l4.662-18.649z" fill="#30A2FF"></path></g></svg>';

describe("construction determinism", () => {
	it("matches production conversion and library serialization checksums", () => {
		const parsed = parseSvg(corpusMulticolorFixture, {
			sourceName: "ai-infrastructure/vllm.svg",
		});
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) {
			return;
		}
		const converted = convertSvgToExcalidraw(parsed.document, {
			fillStyle: "hachure",
			roughness: 2,
		});
		expect(converted.ok).toBe(true);
		if (!converted.ok) {
			return;
		}
		const serialized = serializeExcalidrawLibrary([
			{
				elements: converted.elements,
				id: `svg:${converted.sourceHash}`,
				name: "vLLM",
			},
		]);

		expect(deterministicLibraryChecksum(serialized)).toBe("d224b974");
		expect(serialized).toBe(
			serializeExcalidrawLibrary([
				{
					elements: converted.elements,
					id: `svg:${converted.sourceHash}`,
					name: "vLLM",
				},
			]),
		);
	});

	it("pins the keyhole trace checksum", () => {
		const parsed = parseSvg(corpusMulticolorFixture, {
			sourceName: "ai-infrastructure/vllm.svg",
		});
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) {
			throw new Error(JSON.stringify(parsed.diagnostics));
		}
		const document = parsed.document;
		const first = constructNativeTrace(document, {
			strategy: "keyhole",
			roughness: 1,
			fillStyle: "solid",
		});
		const second = constructNativeTrace(document, {
			strategy: "keyhole",
			roughness: 1,
			fillStyle: "solid",
		});

		expect(deterministicTraceJson(first)).toBe(deterministicTraceJson(second));
		expect(deterministicTraceChecksum(first)).toBe("6977f090");
	});

	it("composes SVG transform lists left to right like the SVG spec", () => {
		const transform = "translate(10 20) scale(2 3) rotate(30) skewX(10) skewY(-5)";
		const source = `<svg viewBox="0 0 100 100"><g transform="${transform}"><line x1="2" y1="4" x2="8" y2="9" stroke="#000"/></g></svg>`;
		const parsed = parseSvg(source);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) {
			throw new Error(JSON.stringify(parsed.diagnostics));
		}

		// [a, b, c, d, e, f] as in SVGMatrix; each list entry right-multiplies.
		type Matrix = readonly [number, number, number, number, number, number];
		const multiply = (
			[a1, b1, c1, d1, e1, f1]: Matrix,
			[a2, b2, c2, d2, e2, f2]: Matrix,
		): Matrix => [
			a1 * a2 + c1 * b2,
			b1 * a2 + d1 * b2,
			a1 * c2 + c1 * d2,
			b1 * c2 + d1 * d2,
			a1 * e2 + c1 * f2 + e1,
			b1 * e2 + d1 * f2 + f1,
		];
		const radians = (degrees: number) => (degrees * Math.PI) / 180;
		const rotate = radians(30);
		const list: Matrix[] = [
			[1, 0, 0, 1, 10, 20],
			[2, 0, 0, 3, 0, 0],
			[Math.cos(rotate), Math.sin(rotate), -Math.sin(rotate), Math.cos(rotate), 0, 0],
			[1, 0, Math.tan(radians(10)), 1, 0, 0],
			[1, Math.tan(radians(-5)), 0, 1, 0, 0],
		];
		const [a, b, c, d, e, f] = list.reduce(multiply, [1, 0, 0, 1, 0, 0]);

		const points = parsed.document.shapes[0]?.subpaths[0]?.points;
		expect(points?.[0]?.x).toBeCloseTo(a * 2 + c * 4 + e);
		expect(points?.[0]?.y).toBeCloseTo(b * 2 + d * 4 + f);
		expect(points?.[1]?.x).toBeCloseTo(a * 8 + c * 9 + e);
		expect(points?.[1]?.y).toBeCloseTo(b * 8 + d * 9 + f);
	});
});
