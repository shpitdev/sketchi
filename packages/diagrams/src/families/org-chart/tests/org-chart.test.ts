// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Effect, Result } from "effect";
import * as drawing from "@sketchi/drawing";
import { CANVAS_SPEC_VERSION, type CanvasSpec } from "@sketchi/drawing";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { describe, expect, it, vi } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts";
import { buildOrgChart } from "../../../build/builds";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime";
import { buildResponse } from "../../../build/operation";
import {
	ORG_CHART_MAX_DEPTH,
	ORG_CHART_MAX_PEOPLE,
	orgChartDiagramType,
	orgChartFixture,
	OrgChartValidationIssueCodeSchema,
	parseOrgChartDiagram,
	resolveOrgChartShorthand,
} from "../document";
import { type OrgChartLayoutIssue, orgChartLayoutIssues } from "../readout";
import { layoutOrgChartDiagram, renderOrgChartDiagram } from "../render";

// Count the box comparisons the layout packs subtrees with and the label wraps it
// measures with. Both are deterministic, so they bound layout work without a
// wall-clock timer. The wrappers pass every call through unchanged.
const work = vi.hoisted(() => ({ comparisons: 0, wraps: 0 }));
vi.mock("@sketchi/drawing", async (importOriginal) => {
	const core = await importOriginal<typeof drawing>();
	const counted =
		<A extends readonly [readonly unknown[], readonly unknown[], ...unknown[]], R>(
			pack: (...args: A) => R,
		) =>
		(...args: A) => {
			work.comparisons += args[0].length * args[1].length;
			return pack(...args);
		};
	return {
		...core,
		clearanceRight: counted(core.clearanceRight),
		clearanceLeft: counted(core.clearanceLeft),
		wrapTextToWidth: (...args: Parameters<typeof core.wrapTextToWidth>) => {
			work.wraps += 1;
			return core.wrapTextToWidth(...args);
		},
	};
});

const storage = makeMemoryArtifactStorage();
function build(spec: unknown) {
	return Effect.runPromise(
		buildOrgChart({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(
			buildResponse,
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}

describe("org charts", () => {
	it("build the documented spec into a valid Excalidraw file of cards and bound lines", async () => {
		const built = await build({
			title: "Startup team",
			people: [
				{ id: "ceo", name: "Ada Lovelace", title: "CEO" },
				{ id: "ea", name: "Grace Hopper", title: "Assistant", manager: "ceo", assistant: true },
				{ id: "cto", name: "Alan Turing", title: "CTO", department: "Engineering", manager: "ceo" },
				{ id: "dev", name: "Ken Thompson", department: "Engineering", manager: "cto" },
				{ id: "cpo", name: "Radia Perlman", title: "CPO", department: "Product", manager: "ceo" },
			],
			dottedLines: [{ report: "dev", manager: "cpo" }],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(excalidraw.elements.find((element) => element.id === "edge:cto")).toMatchObject({
			startBinding: { elementId: "node:ceo" },
			endBinding: { elementId: "node:cto" },
		});
		expect(
			excalidraw.elements.find((element) => element.id === "edge:dotted:dev-dotted-cpo"),
		).toMatchObject({ strokeStyle: "dashed" });
	});

	it("read the manager, title, team and dotted-line fields models write", async () => {
		const built = await build({
			title: "Aliases",
			people: [
				{ id: "ceo", name: "Ada", role: "CEO", directReports: ["cto", "cpo"] },
				{ id: "cto", name: "Alan", position: "CTO", team: "Engineering" },
				{ id: "cpo", name: "Radia", position: "CPO", team: "Product" },
				{ id: "dev", name: "Ken", jobTitle: "Engineer", reportsTo: "cto", dottedLineTo: "cpo" },
				{ id: "ea", name: "Grace", kind: "assistant", managerId: "ceo" },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.people).toEqual([
			{ id: "ceo", name: "Ada", title: "CEO" },
			{ id: "cto", name: "Alan", title: "CTO", department: "Engineering", manager: "ceo" },
			{ id: "cpo", name: "Radia", title: "CPO", department: "Product", manager: "ceo" },
			{ id: "dev", name: "Ken", title: "Engineer", manager: "cto" },
			{ id: "ea", name: "Grace", manager: "ceo", assistant: true },
		]);
		expect(built.normalizedSpec.dottedLines).toEqual([
			{ id: "dev-dotted-cpo", report: "dev", manager: "cpo" },
		]);
	});

	// Measured: a hundred people with long titles and twelve dotted lines try 56
	// placements (2.37M comparisons, 1,885 wraps).
	it("bound layout work for the largest chart", () => {
		const largest = parseOrgChartDiagram(
			resolveOrgChartShorthand({
				id: "largest",
				title: "Largest",
				type: "org-chart",
				people: Array.from({ length: ORG_CHART_MAX_PEOPLE }, (_, index) => ({
					id: `p${index}`,
					name: `Person number ${index} with a longer name`,
					title: "Senior Principal Engineer of Platform Reliability",
					department: `Department ${index % 7}`,
					...(index === 0
						? {}
						: { manager: `p${index < 8 ? 0 : index < 30 ? (index % 7) + 1 : (index % 22) + 8}` }),
				})),
				dottedLines: Array.from({ length: 12 }, (_, index) => ({
					report: `p${40 + index}`,
					manager: `p${10 + index}`,
				})),
			}),
		).pipe(Result.getOrThrow);
		work.comparisons = 0;
		work.wraps = 0;
		const layout = layoutOrgChartDiagram(largest);
		expect(layout.attempts).toBeLessThanOrEqual(80);
		expect(work.comparisons).toBeLessThan(4_000_000);
		expect(work.wraps).toBeLessThan(4_000);
	});
});

const chart = (people: unknown[], extra: Record<string, unknown> = {}) => ({
	id: "team",
	title: "Team",
	type: orgChartDiagramType,
	people,
	...extra,
});
const ceo = { id: "ceo", name: "Ada", title: "CEO" };
const a = { id: "a", name: "A", manager: "ceo" };
const b = { id: "b", name: "B", manager: "ceo" };
const line = { id: "d", report: "a", manager: "b" };

/** One minimal bad chart per code the validator owns. */
const bad: Record<string, unknown> = {
	org_chart_too_large: chart(
		Array.from({ length: ORG_CHART_MAX_DEPTH + 1 }, (_, index) => ({
			id: `p${index}`,
			name: `P${index}`,
			...(index === 0 ? {} : { manager: `p${index - 1}` }),
		})),
	),
	invalid_person_id: chart([{ ...ceo, id: "team:ceo" }]),
	duplicate_person_id: chart([ceo, { ...a, id: "ceo" }]),
	org_text_too_long: chart([{ ...ceo, name: "N".repeat(61) }]),
	unknown_manager: chart([ceo, { ...a, manager: "ghost" }]),
	self_manager: chart([ceo, { ...a, manager: "a" }]),
	reporting_cycle: chart([ceo, { ...a, manager: "b" }, { ...b, manager: "a" }]),
	multiple_roots: chart([ceo, { id: "board", name: "Board" }]),
	invalid_assistant: chart([{ ...ceo, assistant: true }]),
	duplicate_dotted_line_id: chart([ceo, a, b], { dottedLines: [line, line] }),
	invalid_dotted_line: chart([ceo, a], { dottedLines: [{ ...line, manager: "ghost" }] }),
};

describe("org chart validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(OrgChartValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad chart", (code, input) => {
		const result = parseOrgChartDiagram(input);
		if (Result.isSuccess(result)) return expect.fail("Expected an invalid chart");
		const error = result.failure;
		if (error._tag !== "OrgChartValidationError") return expect.fail(error.message);
		expect(error.issues.map((issue) => issue.code)).toContain(code);
	});
});

const labeled = renderOrgChartDiagram({
	...orgChartFixture,
	dottedLines: orgChartFixture.dottedLines.map((dotted) => ({ ...dotted, label: "matrix" })),
});
const find = (id: string) => labeled.elements.find((element) => element.id === id)!;
const card = (id: string) =>
	find(`node:${id}`) as Extract<CanvasSpec["elements"][number], { type: "node" }>;
const edited = (id: string, change: (element: never) => object): CanvasSpec => ({
	...labeled,
	elements: labeled.elements.map((element) =>
		element.id === id ? { ...element, ...change(element as never) } : element,
	),
});
type Points = { x: number; y: number }[];

/** One deliberately broken scene per layout issue the fuzz relies on. */
const broken: Record<OrgChartLayoutIssue["code"], () => CanvasSpec> = {
	"cards-overlap": () =>
		edited("node:linus", () => ({ x: card("ada").x + 4, y: card("ada").y + 4 })),
	"line-not-orthogonal": () =>
		edited("edge:linus", ({ points }: { points: Points }) => ({
			points: [points[0], { x: points[0]!.x + 5, y: points[0]!.y + 5 }, ...points.slice(1)],
		})),
	"line-off-card": () =>
		edited("edge:linus", ({ points }: { points: Points }) => ({
			points: [{ x: points[0]!.x, y: points[0]!.y + 30 }, ...points.slice(1)],
		})),
	"line-through-card": () => {
		const radia = card("radia");
		const x = radia.x + radia.width / 2;
		return edited("edge:don", () => ({
			points: [
				{ x, y: radia.y - 10 },
				{ x, y: radia.y + radia.height + 10 },
			],
		}));
	},
	"lines-cross": () => {
		const radia = card("radia");
		const x = radia.x + radia.width / 2;
		return edited("edge:linus", () => ({
			points: [
				{ x: x - 20, y: radia.y - 10 },
				{ x: x + 20, y: radia.y - 10 },
			],
		}));
	},
	"label-over-card": () =>
		edited("text:dotted:ken-to-radia", () => ({
			x: card("ada").x + card("ada").width / 2,
			y: card("ada").y + card("ada").height / 2,
		})),
	"text-outside-card": () =>
		edited("text:ada:name", ({ x }: { x: number }) => ({ x: x + card("ada").width })),
};

describe("org chart layout readout", () => {
	it("passes the drawn scene", () => {
		expect(orgChartLayoutIssues(labeled)).toEqual([]);
	});

	it.each(Object.entries(broken))("reports %s", (code, breakScene) => {
		expect(orgChartLayoutIssues(breakScene()).map((issue) => issue.code)).toContain(code);
	});
});

/**
 * The Excalidraw validator lets lines leaving one card at one point share a trunk
 * until they part (an org chart's bus). It still reports lines from different
 * cards, or different points, running together; fuzz exercises only the bus.
 */
describe("shared trunks", () => {
	function overlaps(lines: { id: string; source: string; points: Points }[]) {
		const box = (id: string, x: number, y: number) => ({
			type: "node" as const,
			id: `node:${id}`,
			nodeId: id,
			shape: "rectangle" as const,
			x,
			y,
			width: 100,
			height: 40,
			label: id,
		});
		const elements = [
			box("boss", 250, 20),
			box("other", 450, 20),
			box("a", 50, 200),
			box("b", 150, 200),
			...lines.map((entry) => ({
				type: "arrow" as const,
				id: `edge:${entry.id}`,
				edgeId: entry.id,
				sourceNodeId: entry.source,
				targetNodeId: entry.id,
				points: entry.points as [Points[number], ...Points],
				endArrowhead: null,
			})),
		];
		const scene: CanvasSpec = {
			kind: "canvas",
			version: CANVAS_SPEC_VERSION,
			diagramId: "bus",
			title: "Bus",
			width: 600,
			height: 300,
			accentColor: "#000000",
			backgroundColor: "#ffffff",
			elements,
			layers: [],
			layouts: [],
			zOrder: elements.map((element) => element.id),
		};
		return validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.filter(
			(issue) => issue.code === "overlapping-arrow-segment",
		);
	}
	const toA = [
		{ x: 300, y: 60 },
		{ x: 300, y: 120 },
		{ x: 100, y: 120 },
		{ x: 100, y: 200 },
	];
	const toB = (start: { x: number; y: number }) => [
		start,
		{ x: start.x, y: 120 },
		{ x: 200, y: 120 },
		{ x: 200, y: 200 },
	];

	it("allows a bus but reports lines from another card or another point running together", () => {
		const first = { id: "a", source: "boss", points: toA };
		expect(overlaps([first, { id: "b", source: "boss", points: toB({ x: 300, y: 60 }) }])).toEqual(
			[],
		);
		expect(
			overlaps([first, { id: "b", source: "other", points: toB({ x: 500, y: 60 }) }]),
		).not.toEqual([]);
		expect(
			overlaps([first, { id: "b", source: "boss", points: toB({ x: 340, y: 60 }) }]),
		).not.toEqual([]);
	});
});
