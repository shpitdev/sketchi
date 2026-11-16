// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Effect, Result } from "effect";
import { type CanvasElement as SceneElement, type CanvasSpec } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { describe, expect, it } from "vitest";

import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "../../../build/code-mode/artifacts.js";
import { buildJourneyMap, CodeModeRuntimeEnvironment } from "../../../build/code-mode/runtime.js";
import { buildResponse } from "../../../build/operation.js";
import {
	JOURNEY_MAX_STAGE_STEPS,
	journeyDiagramType,
	journeyFixture,
	JourneyValidationIssueCodeSchema,
	parseJourneyDiagram,
	resolveJourneyShorthand,
} from "../document.js";
import { type JourneyLayoutIssue, journeyLayoutIssues } from "../readout.js";
import { renderJourneyDiagram } from "../render.js";

const storage = makeMemoryArtifactStorage();
function build(spec: unknown) {
	return Effect.runPromise(
		buildJourneyMap({
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

describe("journey maps", () => {
	it("build the documented spec into a valid Excalidraw file", async () => {
		const built = await build({
			title: "Online purchase",
			persona: "Maya, a first-time buyer",
			stages: [
				{ name: "Discover", steps: [{ label: "Sees an ad", score: 4, touchpoint: "Instagram" }] },
				{
					name: "Buy",
					steps: [
						{ label: "Creates an account", score: 2, touchpoint: "Website" },
						{ label: "Pays by card", score: 3, touchpoint: "Website" },
					],
					painPoints: ["Forced account creation"],
					opportunities: ["Offer guest checkout"],
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	});

	it("read Mermaid sections, tasks, sentiment, channels and flat staged steps", async () => {
		const built = await build({
			title: "Help",
			sections: [
				{
					title: "Report",
					tasks: [{ task: "Opens a ticket", sentiment: "2", channel: "Help center" }],
					pains: "The form is hidden",
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.stages).toEqual([
			{
				name: "Report",
				steps: [{ label: "Opens a ticket", score: 2, touchpoint: "Help center" }],
				painPoints: ["The form is hidden"],
			},
		]);
		const flat = await build({
			title: "Help",
			steps: [
				{ stage: "Report", label: "Opens a ticket", score: 2 },
				{ stage: "Resolve", label: "Gets a refund", score: 5 },
			],
		});
		if (!flat.ok) throw new Error(JSON.stringify(flat.issues));
		expect(flat.normalizedSpec.stages.map((stage) => stage.name)).toEqual(["Report", "Resolve"]);
	});
});

const browse = { name: "Browse", steps: [{ label: "Search for shoes", score: 4 }] };
const journey = (stages: unknown[], extra: Record<string, unknown> = {}) => ({
	id: "checkout",
	title: "Checkout",
	type: journeyDiagramType,
	stages,
	...extra,
});
const actor = (name: string) => ({ name: "A", steps: [{ label: "x", score: 3, actor: name }] });

/** One minimal bad journey per code the validator owns. */
const bad: Record<string, unknown> = {
	journey_too_large: journey([
		{
			name: "A",
			steps: Array.from({ length: JOURNEY_MAX_STAGE_STEPS + 1 }, (_, index) => ({
				label: `Step ${index}`,
				score: 3,
			})),
		},
	]),
	empty_journey_stage: journey([browse, { name: "Empty", steps: [] }]),
	duplicate_journey_stage: journey([browse, { ...browse, name: " browse " }]),
	invalid_journey_score: journey([{ name: "A", steps: [{ label: "x", score: 6 }] }]),
	unknown_journey_actor: journey([actor("Courier")], { actors: ["Shopper"] }),
	duplicate_journey_actor: journey([actor("Courier")], { actors: ["Courier", "courier"] }),
	journey_text_too_long: journey([{ name: "A", steps: [{ label: "x".repeat(91), score: 3 }] }]),
	unplaced_journey_entry: journey([browse], {
		steps: [{ label: "Receives the parcel", score: 5 }],
	}),
};

describe("journey validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(JourneyValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad journey", (code, input) => {
		const result = parseJourneyDiagram(resolveJourneyShorthand(input));
		if (Result.isSuccess(result)) return expect.fail("Expected an invalid journey");
		const error = result.failure;
		if (error._tag !== "JourneyValidationError") return expect.fail(error.message);
		expect(error.issues.map((issue) => issue.code)).toContain(code);
	});
});

const scene = renderJourneyDiagram(journeyFixture);
const find = (id: string) => {
	const element = scene.elements.find((entry) => entry.id === id);
	if (!element) throw new Error(`No element ${id}`);
	return element;
};
const edit = (id: string, change: (element: SceneElement) => object): CanvasSpec => ({
	...scene,
	elements: scene.elements.map((element) =>
		element.id === id ? { ...element, ...change(element) } : element,
	),
});
const pointsOf = (id: string) => {
	const element = find(id);
	if (element.type !== "line") throw new Error(`${id} is not a line`);
	return element.points;
};
/** Moves a free text onto a point a line passes through. */
const textOnto = (point: { x: number; y: number }) =>
	edit("text:journey:level:0:3", () => ({ x: point.x, y: point.y }));

/** One deliberately broken scene per layout issue the fuzz relies on. */
const broken: Record<JourneyLayoutIssue["code"], () => CanvasSpec> = {
	"boxes-overlap": () =>
		edit("node:journey:pain:0-0", () => {
			const card = find("node:journey:step:0-0") as { x: number; y: number };
			return { x: card.x + 4, y: card.y + 4 };
		}),
	"text-outside-box": () =>
		edit("label:journey:step:0-0", () => ({ text: "Sees an ad ".repeat(20).trim() })),
	"card-off-stage": () =>
		edit("node:journey:step:0-0", (element) => ({ x: (element as { x: number }).x + 5_000 })),
	"note-off-stage": () =>
		edit("node:journey:pain:0-0", (element) => ({ x: (element as { x: number }).x + 5_000 })),
	"face-off-step": () =>
		edit("node:journey:face:0-0", (element) => ({ x: (element as { x: number }).x + 60 })),
	"face-off-score": () => edit("node:journey:face:1-0", () => ({ label: "Negative (2)" })),
	"face-wrong-expression": () =>
		edit("line:journey:face:2-1:mouth", () => ({
			points: pointsOf("line:journey:face:2-1:mouth").map((point, index) =>
				index === 1 ? { ...point, y: point.y - 12 } : point,
			),
		})),
	"curve-off-faces": () =>
		edit("line:journey:curve:0", () => {
			const points = pointsOf("line:journey:curve:0");
			return { points: [points[0], points.at(-1)!] };
		}),
	"curve-leaves-row": () =>
		edit("line:journey:curve:0", () => ({
			points: pointsOf("line:journey:curve:0").map((point) => ({ ...point, y: point.y - 500 })),
		})),
	"curve-through-text": () => textOnto(pointsOf("line:journey:curve:0")[1]),
	"rule-through-text": () => {
		const [from, to] = pointsOf("line:journey:baseline:0");
		return textOnto({ x: (from.x + to.x) / 2, y: from.y });
	},
	"score-misprinted": () => edit("text:journey:score:0-0", () => ({ text: "1" })),
	"stages-out-of-order": () => {
		const first = find("node:journey:stage:0") as { x: number };
		const second = find("node:journey:stage:1") as { x: number };
		return {
			...scene,
			elements: scene.elements.map((element) =>
				element.id === "node:journey:stage:0"
					? ({ ...element, x: second.x } as SceneElement)
					: element.id === "node:journey:stage:1"
						? ({ ...element, x: first.x } as SceneElement)
						: element,
			),
		};
	},
};

describe("journey layout readout", () => {
	it("passes the drawn scene", () => {
		expect(journeyLayoutIssues(scene)).toEqual([]);
	});

	it.each(Object.entries(broken))("reports %s", (code, breakScene) => {
		expect(journeyLayoutIssues(breakScene()).map((issue) => issue.code)).toContain(code);
	});
});
