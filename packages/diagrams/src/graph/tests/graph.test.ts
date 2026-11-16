import { CANVAS_SPEC_VERSION, type CanvasSpec } from "@sketchi/drawing";
import { describe, expect, it } from "vitest";

import {
	aroundTheBands,
	curvedStrays,
	detachedLabels,
	diagonalRuns,
	labelDefects,
	ownEndStrays,
	routingCounts,
	worseThanPinned,
} from "./routing-fuzz-helpers";
import { type ExportedElement, midWordBreaks } from "./text-fit-helpers";

type Arrow = Extract<CanvasSpec["elements"][number], { type: "arrow" }>;
type Node = Extract<CanvasSpec["elements"][number], { type: "node" }>;

const node = (id: string, x: number, y: number): Node => ({
	type: "node",
	id: `node:${id}`,
	nodeId: id,
	shape: "rectangle",
	x,
	y,
	width: 100,
	height: 50,
	label: id,
});

const arrow = (id: string, source: string, target: string, points: Arrow["points"]): Arrow => ({
	type: "arrow",
	id: `edge:${id}`,
	edgeId: id,
	sourceNodeId: source,
	targetNodeId: target,
	points,
});

const scene = (elements: CanvasSpec["elements"]): CanvasSpec => ({
	kind: "canvas",
	version: CANVAS_SPEC_VERSION,
	diagramId: "oracle",
	title: "Oracle",
	width: 600,
	height: 400,
	accentColor: "#111827",
	backgroundColor: "#ffffff",
	elements,
	layers: [],
	layouts: [],
	zOrder: elements.map((element) => element.id),
});

/** a above b, c beside them; a→b runs straight down, a→c leaves a's right side. */
const clean = scene([
	node("a", 0, 0),
	node("b", 0, 200),
	node("c", 300, 200),
	arrow("ab", "a", "b", [
		{ x: 50, y: 50 },
		{ x: 50, y: 200 },
	]),
	arrow("ac", "a", "c", [
		{ x: 100, y: 25 },
		{ x: 350, y: 25 },
		{ x: 350, y: 200 },
	]),
]);

const curved = (spec: CanvasSpec): CanvasSpec => ({
	...spec,
	elements: spec.elements.map((element) =>
		element.type === "arrow" ? { ...element, curved: true } : element,
	),
});

const withArrow = (spec: CanvasSpec, id: string, change: (line: Arrow) => Arrow): CanvasSpec => ({
	...spec,
	elements: spec.elements.map((element) =>
		element.type === "arrow" && element.edgeId === id ? change(element) : element,
	),
});

/** Rule 8: each oracle the routing and text-fit fuzz pass or fail on detects its issue. */
describe("graph fuzz oracles", () => {
	it("read the clean scene as clean", () => {
		expect(diagonalRuns(clean)).toEqual([]);
		expect(routingCounts(clean).crossings).toBe(0);
		expect(ownEndStrays(clean)).toEqual([]);
		expect(curvedStrays(curved(clean), clean)).toEqual([]);
	});

	it("aroundTheBands finds a continuation that runs around the band ends", () => {
		// A left to right flow wrapped into two bands: a→b, then b→c back to the next band's start.
		const spine = [
			{ id: "ab", source: "a", target: "b" },
			{ id: "bc", source: "b", target: "c" },
			{ id: "cd", source: "c", target: "d" },
		];
		const bands = (bc: Arrow["points"]) =>
			scene([
				node("a", 0, 0),
				node("b", 200, 0),
				node("c", 0, 150),
				node("d", 200, 150),
				arrow("ab", "a", "b", [
					{ x: 100, y: 25 },
					{ x: 200, y: 25 },
				]),
				arrow("bc", "b", "c", bc),
				arrow("cd", "c", "d", [
					{ x: 100, y: 175 },
					{ x: 200, y: 175 },
				]),
			]);
		const read = (bc: Arrow["points"]) => aroundTheBands(bands(bc), "LR", spine, new Set(["bc"]));
		expect(
			read([
				{ x: 250, y: 50 },
				{ x: 250, y: 100 },
				{ x: 50, y: 100 },
				{ x: 50, y: 150 },
			]),
		).toEqual([]);
		expect(
			read([
				{ x: 300, y: 25 },
				{ x: 350, y: 25 },
				{ x: 350, y: 100 },
				{ x: 50, y: 100 },
				{ x: 50, y: 150 },
			]),
		).toEqual(["bc runs around the bands past its source"]);
	});

	it("diagonalRuns finds a line that runs diagonally", () => {
		const broken = withArrow(clean, "ab", (line) => ({
			...line,
			points: [
				{ x: 50, y: 50 },
				{ x: 80, y: 200 },
			],
		}));
		expect(diagonalRuns(broken)).toEqual(["edge:ab runs diagonally"]);
	});

	it("routingCounts counts two lines that cross", () => {
		const broken = scene([
			...clean.elements,
			node("d", 150, 100),
			arrow("db", "d", "b", [
				{ x: 150, y: 125 },
				{ x: 25, y: 125 },
				{ x: 25, y: 200 },
			]),
		]);
		expect(routingCounts(broken).crossings).toBe(1);
	});

	it("worseThanPinned fails a graph with more crossings or findings than pinned", () => {
		expect(worseThanPinned("set", [{ crossings: 1, findings: 0 }], "2/0")).toEqual([]);
		expect(worseThanPinned("set", [{ crossings: 1, findings: 1 }], "2/0")).toEqual([
			"set 0: 2/0 -> 1/1",
		]);
		expect(worseThanPinned("set", [{ crossings: 3, findings: 0 }], "2/0")).toHaveLength(2);
	});

	it("ownEndStrays finds a line that runs back into its own end node", () => {
		const broken = withArrow(clean, "ac", (line) => ({
			...line,
			points: [
				{ x: 100, y: 25 },
				{ x: 150, y: 25 },
				{ x: 150, y: 40 },
				{ x: 60, y: 40 },
				{ x: 60, y: 100 },
				{ x: 350, y: 100 },
				{ x: 350, y: 200 },
			],
		}));
		expect(ownEndStrays(broken)).toEqual(["ac through own a"]);
	});

	it("curvedStrays finds a curved scene's line drawn square or through a node", () => {
		const square = withArrow(curved(clean), "ab", ({ curved: _curved, ...line }) => line);
		expect(curvedStrays(square, clean)).toEqual(["ab drawn square"]);
		const through = withArrow(curved(clean), "ac", (line) => ({
			...line,
			points: [
				{ x: 100, y: 25 },
				{ x: 350, y: 25 },
				{ x: 350, y: 225 },
				{ x: 50, y: 225 },
			],
		}));
		expect(curvedStrays(through, clean)).toContain("ac through b");
	});
});

describe("label oracles", () => {
	const rectangle = (id: string, x: number, y: number): ExportedElement => ({
		id,
		type: "rectangle",
		x,
		y,
		width: 100,
		height: 50,
	});
	const line = (id: string, points: [number, number][]): ExportedElement => ({
		id,
		type: "arrow",
		x: 0,
		y: 0,
		points,
	});
	const label = (id: string, x: number, y: number, text = "Yes"): ExportedElement => ({
		id,
		type: "text",
		x,
		y,
		width: 30,
		height: 20,
		text,
		originalText: text,
	});
	const lines = [
		line("edge:a", [
			[0, 0],
			[0, 300],
		]),
		line("edge:b", [
			[200, 0],
			[200, 300],
		]),
	];
	const authored = new Map<string, string>();

	it("midWordBreaks finds a word broken across lines, not one broken between words", () => {
		expect(midWordBreaks("Approve request", "Appr\nove request")).toEqual(["Appr|ove request"]);
		expect(midWordBreaks("Approve request", "Approve\nrequest")).toEqual([]);
	});

	it("labelDefects finds a broken word, a crossed label and a label on a node or label", () => {
		const own = label("edge:a:label", 10, 100);
		expect(labelDefects([...lines, rectangle("node:n", 300, 0), own], authored)).toEqual([]);
		expect(
			labelDefects([...lines, { ...own, text: "Y\nes", originalText: "Yes" }], authored),
		).toEqual(["edge:a:label breaks Y|es"]);
		expect(labelDefects([...lines, { ...own, x: 185 }], authored)).toEqual([
			"edge:a:label crossed by edge:b",
		]);
		expect(labelDefects([...lines, rectangle("node:n", 0, 90), own], authored)).toContain(
			"edge:a:label on node:n",
		);
		expect(labelDefects([...lines, own, label("edge:b:label", 20, 105)], authored)).toContain(
			"edge:a:label on edge:b:label",
		);
	});

	it("detachedLabels finds a label nearer another line than its own", () => {
		expect(detachedLabels([...lines, label("edge:a:label", 10, 100)])).toEqual([]);
		expect(detachedLabels([...lines, label("edge:a:label", 160, 100)])).toEqual(["a>b"]);
	});
});
