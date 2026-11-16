import { type CanvasLineElement, type CanvasSpec } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts.js";
import { buildQuadrantChart } from "../../../build/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime.js";
import { applyDiagramPatch } from "../../../canvas/patch.js";
import { buildResponse, type BuildRejection } from "../../../build/operation.js";
import {
	getQuadrantValidationIssues,
	QUADRANT_MAX_POINTS,
	type QuadrantDiagram,
	quadrantFixture,
	QuadrantValidationIssueCodeSchema,
} from "../document.js";
import { type QuadrantLayoutIssue, quadrantLayoutIssues, readQuadrantScene } from "../readout.js";
import { renderQuadrantDiagram } from "../render.js";

const storage = makeMemoryArtifactStorage();
const environment = {
	createId: (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2)}`,
};
function run<A, E extends BuildRejection<unknown>>(
	effect: Effect.Effect<A, E, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	return Effect.runPromise(
		buildResponse(effect).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, environment),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}
const options = {
	inlineArtifacts: ["scene", "excalidraw"],
	artifactFormats: ["scene", "excalidraw"],
} as const;
type Excalidraw = Parameters<typeof validateExcalidrawScene>[0];

/** The documented example. */
const positioning = {
	title: "Project tools by price and ease",
	xAxis: { title: "Price", low: "Low price", high: "High price" },
	yAxis: { title: "Ease of use", low: "Hard to use", high: "Easy to use" },
	quadrants: {
		topLeft: "Best value",
		topRight: "Premium and simple",
		bottomLeft: "Budget and complex",
		bottomRight: "Overpriced",
	},
	points: [
		{ label: "Trello", x: 0.25, y: 0.85 },
		{ label: "Jira", x: 0.55, y: 0.3 },
		{ label: " Our product ", x: 0.4, y: 0.82, group: "Our product" },
	],
};

describe("quadrant charts", () => {
	it("build the documented example into a valid Excalidraw file whose dots keep their role through a patch", async () => {
		const built = await run(buildQuadrantChart({ spec: positioning, options }));
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Excalidraw;
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });

		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["quadrant:point:1"] },
						style: { fillColor: "#e34948" },
					},
				],
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const scene = patched.artifact.formats.find((format) => format.format === "scene")?.inline as {
			elements: { id: string; rendererRole?: string; fillColor?: string }[];
		};
		expect(scene.elements.find((element) => element.id === "node:quadrant:point:1")).toMatchObject({
			rendererRole: "quadrant-mark",
			fillColor: "#e34948",
		});
	});

	it("refuse a chart whose labels cannot all sit clear rather than drawing it", async () => {
		const spec = {
			...positioning,
			points: Array.from({ length: 30 }, (_, index) => ({
				label: `Telecommunications backlog ${index + 1}`,
				x: 0,
				y: 0,
			})),
		};
		const typed = await Effect.runPromise(
			buildQuadrantChart({ spec, options }).pipe(
				Effect.result,
				Effect.provideService(CodeModeRuntimeEnvironment, environment),
				Effect.provideService(CodeModeArtifactStorage, storage),
			),
		);
		if (Result.isSuccess(typed)) return expect.fail("Expected a layout refusal");
		expect(typed.failure.toResult()).toMatchObject({
			ok: false,
			status: "invalid_quadrant_chart",
			issues: [expect.objectContaining({ code: "quadrant_too_large" })],
		});
	});
});

/** One minimal bad chart per code the validator owns. */
const bad: Record<string, Partial<QuadrantDiagram>> = {
	quadrant_too_large: {
		points: Array.from({ length: QUADRANT_MAX_POINTS + 1 }, (_, index) => ({
			label: `Item ${index}`,
			x: 0.5,
			y: 0.5,
		})),
	},
	invalid_quadrant_point: { points: [{ label: "Acme", x: 8, y: 0.5 }] },
	invalid_quadrant_text: { points: [{ label: " ", x: 0.5, y: 0.5 }] },
};

describe("quadrant validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(QuadrantValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad chart", (code, change) => {
		const issues = getQuadrantValidationIssues({ ...quadrantFixture, ...change });
		expect(issues.map((issue) => issue.code)).toContain(code);
	});
});

type Loose = Record<string, unknown> & { x: number; y: number; width: number; height: number };
const at = (scene: CanvasSpec, id: string) => {
	const element = scene.elements.find((candidate) => candidate.id === id);
	if (!element) throw new Error(`No element ${id}.`);
	return element as unknown as Loose;
};
const without = (scene: CanvasSpec, drop: (id: string) => boolean) => {
	(scene as { elements: CanvasSpec["elements"] }).elements = scene.elements.filter(
		(element) => !drop(element.id),
	);
};
const dot = (scene: CanvasSpec, index: number) => {
	const node = at(scene, `node:quadrant:point:${index}`);
	return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
};
const leader = (
	id: string,
	from: { x: number; y: number },
	to: { x: number; y: number },
): CanvasLineElement => ({ type: "line", id, points: [from, to] });

/** One deliberately broken drawing per issue the fuzz oracle reads. */
const broken: Record<QuadrantLayoutIssue["code"], (scene: CanvasSpec) => void> = {
	"missing-plot": (scene) => without(scene, (id) => id.startsWith("node:quadrant:region:")),
	"missing-point": (scene) => without(scene, (id) => id === "quadrant:label:0"),
	"dot-position": (scene) => {
		at(scene, "node:quadrant:point:0").x += 10;
	},
	"label-outside-plot": (scene) => {
		at(scene, "quadrant:label:0").x = -1000;
	},
	"text-overlap": (scene) => {
		const other = at(scene, "quadrant:label:1");
		Object.assign(at(scene, "quadrant:label:0"), { x: other.x, y: other.y });
	},
	"label-over-dot": (scene) => {
		Object.assign(at(scene, "quadrant:label:0"), dot(scene, 1));
	},
	"detached-label": (scene) => {
		without(scene, (id) => id === "quadrant:leader:0");
		const { x, y } = dot(scene, 1);
		Object.assign(at(scene, "quadrant:label:0"), { x, y: y + 16 });
	},
	"misread-label": (scene) => {
		without(scene, (id) => id === "quadrant:leader:0");
		const { x, y } = dot(scene, 1);
		Object.assign(at(scene, "quadrant:label:0"), { x: x + 60, y });
	},
	"name-over-dot": (scene) => {
		Object.assign(at(scene, "quadrant:name:topLeft"), dot(scene, 0));
	},
	"name-outside-quadrant": (scene) => {
		at(scene, "quadrant:name:topLeft").x = -1000;
	},
	"leader-crossing": (scene) => {
		const { y } = at(scene, "quadrant:label:1");
		scene.elements.push(leader("quadrant:leader:0", { x: 0, y }, { x: scene.width, y }));
	},
	"leader-over-dot": (scene) => {
		scene.elements.push(leader("quadrant:leader:0", dot(scene, 0), dot(scene, 1)));
	},
	"rule-crosses-text": (scene) => {
		const { plot } = readQuadrantScene(scene);
		Object.assign(at(scene, "quadrant:label:0"), {
			x: (plot!.left + plot!.right) / 2,
			y: (plot!.top + plot!.bottom) / 2,
		});
	},
	"broken-divider": (scene) => without(scene, (id) => id === "quadrant:midline:vertical"),
	"broken-word": (scene) => {
		at(scene, "quadrant:label:0").text = "Da rk";
	},
	"wide-aspect": (scene) => {
		scene.width = scene.height * 3;
	},
};

describe("quadrant layout readout", () => {
	const clean = renderQuadrantDiagram(quadrantFixture).pipe(Result.getOrThrow);

	it("reads the fixture as clean", () => {
		expect(quadrantLayoutIssues(clean, quadrantFixture)).toEqual([]);
	});

	it.each(Object.entries(broken))("reports %s on a drawing broken that way", (code, breakIt) => {
		const scene = structuredClone(clean);
		breakIt(scene);
		expect(quadrantLayoutIssues(scene, quadrantFixture).map((issue) => issue.code)).toContain(code);
	});
});
