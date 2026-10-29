import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { journeyFixture, journeyStressFixtures } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildJourneyMapResultSchema } from "./contract.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { applyDiagramPatch, buildJourneyMap, CodeModeRuntimeEnvironment } from "./runtime.js";

const storage = makeMemoryArtifactStorage();
function run<A>(
	effect: Effect.Effect<A, never, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}
function build(spec: unknown) {
	return run(
		buildJourneyMap({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}),
	);
}
const inline = (built: { artifact: { formats: { format: string; inline?: unknown }[] } }) =>
	new Map(built.artifact.formats.map((format) => [format.format, format.inline]));

/** The documented example: a persona, two stages, scores, touchpoints and a stage's notes. */
const purchaseSpec = {
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
};

describe("Code Mode native journey map", () => {
	it("builds the documented spec into stages, cards, faces on a curve and notes", async () => {
		const built = await build(purchaseSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(BuildJourneyMapResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec).toEqual({
			id: "online-purchase",
			title: "Online purchase",
			persona: "Maya, a first-time buyer",
			stages: purchaseSpec.stages,
			style: expect.any(Object),
		});
		expect(built.quality.summary).toEqual({ nodeCount: 3, edgeCount: 0 });
		const excalidraw = inline(built).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(
			excalidraw.elements.find((element) => element.id === "line:journey:curve:0"),
		).toMatchObject({ type: "line" });
		expect(
			excalidraw.elements.find((element) => element.id === "node:journey:face:1-0"),
		).toMatchObject({ type: "ellipse", customData: { sketchiRendererRole: "journey-mark" } });
	});

	it("reads Mermaid sections, tasks, sentiment, channels and flat staged steps", async () => {
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

	it("builds a one-step stage whose name or notes hold a long word", async () => {
		const built = await build({
			title: "Help",
			stages: [
				{ name: "Report", steps: [{ label: "Opens a ticket", score: 2 }] },
				{
					name: "Acknowledgement",
					steps: [{ label: "Reads reply", score: 3 }],
					painPoints: ["Internationalization"],
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.stages[1]?.name).toBe("Acknowledgement");
	});

	it("rejects a flat note naming an unknown stage with a repair issue naming the stages", async () => {
		const result = await build({
			title: "Help",
			stages: [
				{ name: "Report", steps: [{ label: "Opens a ticket", score: 2 }] },
				{ name: "Review", steps: [{ label: "Reads reply", score: 3 }] },
			],
			painPoints: [{ stage: "Revieew", text: "Slow reply" }],
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_journey");
		expect(result.issues.map((issue) => issue.code)).toEqual(["invalid_journey_stage"]);
		expect(result.issues[0]?.hint).toContain('"Report", "Review"');
	});

	it("rejects flat steps that name no stage instead of dropping the staged ones", async () => {
		const result = await build({
			title: "Buy",
			stages: [{ name: "Discover", steps: [{ label: "Sees an ad", score: 4 }] }],
			steps: [
				{ stage: "Buy", label: "Pays", score: 3 },
				{ label: "Receives the parcel", score: 5 },
			],
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_journey");
		expect(result.issues.map((issue) => issue.code)).toEqual(["invalid_journey_stage"]);
		expect(result.normalizedSpec?.stages.map((stage) => stage.name)).toEqual([
			"Discover",
			"Buy",
			"(no stage)",
		]);
	});

	it("keeps faces as faces through a patch", async () => {
		const built = await build(purchaseSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["journey:step:1-0"] },
						style: { strokeColor: "#1f44c9" },
					},
				],
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene", "excalidraw"],
				},
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const scene = inline(patched).get("scene") as RenderedDiagramScene;
		expect(scene.elements.find((element) => element.id === "node:journey:step:1-0")).toMatchObject({
			strokeColor: "#1f44c9",
		});
		expect(scene.elements.find((element) => element.id === "node:journey:face:1-0")).toMatchObject({
			rendererRole: "journey-mark",
		});
		const excalidraw = inline(patched).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		// A face never grows a label of its own.
		expect(
			excalidraw.elements.filter(
				(element) =>
					element.type === "text" &&
					typeof element["containerId"] === "string" &&
					element["containerId"].startsWith("node:journey:face:"),
			),
		).toEqual([]);
	});

	it("round-trips canonical diagrams through their Code Mode documents", async () => {
		for (const diagram of [journeyFixture, journeyStressFixtures.wordy]) {
			const document = canonicalDocumentFromDiagram(diagram);
			expect(document.type).toBe("journey");
			const built = await build(document.spec);
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.stages).toEqual(diagram.stages);
			expect(built.normalizedSpec.persona).toBe(diagram.persona);
			expect(built.normalizedSpec.actors).toEqual(diagram.actors);
		}
	});

	it.each([
		[
			{
				stages: [{ name: "A", steps: [{ label: "x", score: 7 }] }],
			},
			"invalid_journey_step",
		],
		[
			{
				stages: [{ name: "A", steps: [{ label: "x", score: 2.5 }] }],
			},
			"invalid_journey_step",
		],
		[
			{
				actors: ["Maya"],
				stages: [{ name: "A", steps: [{ label: "x", score: 3, actor: "Courier" }] }],
			},
			"invalid_journey_step",
		],
		[{ stages: [...purchaseSpec.stages, { name: "Empty", steps: [] }] }, "invalid_journey_stage"],
		[{ stages: [...purchaseSpec.stages, purchaseSpec.stages[0]] }, "invalid_journey_stage"],
		[
			{
				stages: [
					{
						name: "A",
						steps: Array.from({ length: 9 }, (_, index) => ({ label: `S${index}`, score: 3 })),
					},
				],
			},
			"journey_too_large",
		],
		[{ stages: [{ name: "A", steps: [{ label: "x".repeat(91), score: 3 }] }] }, "label_too_long"],
	])("rejects %j with a structured repair issue", async (change, code) => {
		const result = await build({ ...purchaseSpec, ...change });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_journey");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.ref?.path?.startsWith("spec."))).toBe(
			true,
		);
	});

	it("rejects a step without a score before building, naming the field", async () => {
		const result = await build({
			title: "Help",
			stages: [{ name: "Report", steps: [{ label: "Opens a ticket" }] }],
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(JSON.stringify(result.issues)).toContain("score");
	});
});
