import { describe, expect, it } from "vitest";
import {
	type SequenceDiagram,
	SequenceValidationError,
	apiRequestSequence,
	getCanvasValidationIssues,
	parseSequenceDiagram,
	sequenceFixture,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram";
import type { NodeSceneElement, RenderedDiagramScene } from "../scene";
import {
	SEQUENCE_ACTIVATION_ROLE,
	isStructurallyValidSequenceActivation,
	renderSequenceDiagram,
} from "../sequence";

function activationBars(scene: RenderedDiagramScene): NodeSceneElement[] {
	return scene.elements.filter(
		(element): element is NodeSceneElement =>
			element.type === "node" && element.rendererRole === SEQUENCE_ACTIVATION_ROLE,
	);
}

function arrow(scene: RenderedDiagramScene, edgeId: string) {
	const found = scene.elements.find(
		(element) => element.type === "arrow" && element.edgeId === edgeId,
	);
	if (found?.type !== "arrow") throw new Error(`Missing arrow ${edgeId}.`);
	return found;
}

const sequence = parseSequenceDiagram({
	id: "checkout-sequence",
	title: "Checkout sequence",
	type: "sequence",
	participants: [
		{ id: "customer", label: "Customer" },
		{ id: "store", label: "Store" },
		{ id: "payments", label: "Payments" },
	],
	messages: [
		{ id: "start", source: "customer", target: "store", label: "Checkout" },
		{ id: "charge", source: "store", target: "payments", label: "Charge" },
		{ id: "receipt", source: "payments", target: "customer", label: "Receipt" },
	],
	style: { accentColor: "#000000", backgroundColor: "#ffffff" },
});

function unvalidated(overrides: Partial<SequenceDiagram>): SequenceDiagram {
	return { ...sequence, ...overrides };
}

describe("sequence diagram renderer", () => {
	it("renders the canonical fixture through the family dispatch", () => {
		const scene = renderDiagram(sequenceFixture);
		expect(scene).toEqual(renderSequenceDiagram(sequenceFixture));
		expect(scene.diagramId).toBe("checkout-sequence");
		expect(scene.elements.filter((element) => element.type === "arrow")).toHaveLength(
			sequenceFixture.messages.length,
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("fits three-line participant labels before positioning lifelines and messages", () => {
		const scene = renderSequenceDiagram({
			...sequence,
			participants: sequence.participants.map((participant, index) =>
				index === 0 ? { ...participant, label: "one\ntwo\nthree" } : participant,
			),
		});
		expect(scene.elements.find(({ id }) => id === "node:customer")).toMatchObject({
			y: 48,
			height: 75,
		});
		expect(scene.elements.find(({ id }) => id === "label:customer")).toMatchObject({ y: 85.5 });
		const lifelines = scene.elements.filter(
			(element): element is Extract<typeof element, { type: "node" }> =>
				element.type === "node" && element.rendererRole === "sequence-lifeline",
		);
		expect(lifelines.map(({ y }) => y)).toEqual([123, 123, 123]);
		const arrows = scene.elements.filter((element) => element.type === "arrow");
		expect(arrows.map(({ points }) => points[0].y)).toEqual([187, 275, 363]);
		expect(scene.height).toBe(467);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("preserves participant and chronological message order", () => {
		const scene = renderSequenceDiagram(sequence);
		const headers = scene.elements.filter(
			(element): element is Extract<typeof element, { type: "node" }> =>
				element.type === "node" && element.rendererRole !== "sequence-lifeline",
		);
		const messages = scene.elements.filter((element) => element.type === "arrow");

		expect(headers.map((header) => header.nodeId)).toEqual(["customer", "store", "payments"]);
		expect(headers.map((header) => header.x)).toEqual(
			headers.map((header) => header.x).sort((a, b) => a - b),
		);
		expect(messages.map((message) => message.edgeId)).toEqual(["start", "charge", "receipt"]);
		expect(messages.map((message) => message.points[0].y)).toEqual(
			messages.map((message) => message.points[0].y).sort((a, b) => a - b),
		);
		expect(
			scene.elements.filter(
				(element) => element.type === "node" && element.rendererRole === "sequence-lifeline",
			),
		).toHaveLength(3);
	});

	it("rejects self messages with the core validation error", () => {
		expect(() =>
			renderSequenceDiagram(
				unvalidated({
					messages: [{ id: "self", source: "store", target: "store", label: "Retry" }],
				}),
			),
		).toThrow(SequenceValidationError);
	});

	it("rejects participant ids that collide with generated lifelines", () => {
		expect(() =>
			renderSequenceDiagram(
				unvalidated({
					participants: [
						{ id: "api", label: "API" },
						{ id: "api:lifeline", label: "Worker" },
					],
					messages: [],
				}),
			),
		).toThrow(/collides with the generated lifeline/);
	});

	it("draws an activation bar from each answered call to its return", () => {
		const scene = renderSequenceDiagram(sequenceFixture);
		const bars = activationBars(scene);
		expect(bars.map((bar) => bar.nodeId)).toEqual([
			"store:lifeline:activation:checkout",
			"payments:lifeline:activation:charge",
		]);
		const [store, payments] = bars;
		if (!store || !payments) throw new Error("Missing activation bars.");

		// The call lands on the bar's near edge and the return leaves from it.
		const checkout = arrow(scene, "checkout");
		expect(checkout.targetNodeId).toBe(store.nodeId);
		expect(checkout.points.at(-1)?.x).toBe(store.x);
		const receipt = arrow(scene, "receipt");
		expect(receipt.sourceNodeId).toBe(store.nodeId);
		expect(receipt.points[0].x).toBe(store.x);
		const charge = arrow(scene, "charge");
		expect([charge.sourceNodeId, charge.targetNodeId]).toEqual([store.nodeId, payments.nodeId]);
		expect(charge.points[0].x).toBe(store.x + store.width);
		for (const [bar, call, ret] of [
			[store, checkout, receipt],
			[payments, charge, arrow(scene, "charged")],
		] as const) {
			expect(bar.y).toBeLessThan(call.points[0].y);
			expect(bar.y + bar.height).toBeGreaterThan(ret.points[0].y);
			expect(isStructurallyValidSequenceActivation(scene, bar)).toBe(true);
		}
		expect(scene.zOrder.indexOf(store.id)).toBeLessThan(scene.zOrder.indexOf(checkout.id));
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("keeps unanswered calls on the lifeline", () => {
		const scene = renderSequenceDiagram(apiRequestSequence);
		expect(arrow(scene, "track").targetNodeId).toBe("analytics:lifeline");
		expect(activationBars(scene)).toHaveLength(3);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("offsets a re-entrant activation and attaches messages to the innermost bar", () => {
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				id: "oauth",
				title: "OAuth callback",
				type: "sequence",
				participants: [
					{ id: "client", label: "Client" },
					{ id: "api", label: "API" },
					{ id: "auth", label: "Auth" },
				],
				messages: [
					{ id: "login", source: "client", target: "api", label: "Log in" },
					{ id: "authorize", source: "api", target: "auth", label: "Authorize" },
					{ id: "callback", source: "auth", target: "api", label: "Callback" },
					{ id: "ack", source: "api", target: "auth", label: "Ack", type: "return" },
					{ id: "token", source: "auth", target: "api", label: "Token", type: "return" },
					{ id: "session", source: "api", target: "client", label: "Session", type: "return" },
				],
			}),
		);
		const outer = activationBars(scene).find(
			(bar) => bar.nodeId === "api:lifeline:activation:login",
		);
		const inner = activationBars(scene).find(
			(bar) => bar.nodeId === "api:lifeline:activation:callback",
		);
		if (!outer || !inner) throw new Error("Missing api activation bars.");
		expect(inner.x - outer.x).toBe(outer.width / 2);
		expect(inner.y).toBeGreaterThan(outer.y);
		expect(inner.y + inner.height).toBeLessThan(outer.y + outer.height);
		expect(arrow(scene, "callback").targetNodeId).toBe(inner.nodeId);
		expect(arrow(scene, "ack").sourceNodeId).toBe(inner.nodeId);
		expect(arrow(scene, "token").targetNodeId).toBe(outer.nodeId);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("draws partially overlapping spans in separate lanes and attaches each message to its span", () => {
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				id: "lanes",
				title: "Lanes",
				type: "sequence",
				participants: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
					{ id: "c", label: "C" },
				],
				messages: [
					{ id: "q1", source: "a", target: "b", label: "Query 1" },
					{ id: "q2", source: "c", target: "b", label: "Query 2" },
					{ id: "p1", source: "b", target: "a", label: "Reply 1", type: "return" },
					{ id: "q3", source: "a", target: "b", label: "Query 3" },
					{ id: "p2", source: "b", target: "c", label: "Reply 2", type: "return" },
					{ id: "p3", source: "b", target: "a", label: "Reply 3", type: "return" },
				],
			}),
		);
		const bar = (call: string) => {
			const found = activationBars(scene).find(
				(candidate) => candidate.nodeId === `b:lifeline:activation:${call}`,
			);
			if (!found) throw new Error(`Missing bar for ${call}.`);
			return found;
		};
		expect(bar("q2").x).not.toBe(bar("q3").x);
		expect(bar("q3").x).toBe(bar("q1").x);
		expect(arrow(scene, "q3").targetNodeId).toBe(bar("q3").nodeId);
		expect(arrow(scene, "p2").sourceNodeId).toBe(bar("q2").nodeId);
		expect(arrow(scene, "p3").sourceNodeId).toBe(bar("q3").nodeId);
		for (const candidate of activationBars(scene)) {
			expect(isStructurallyValidSequenceActivation(scene, candidate)).toBe(true);
		}
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("does not keep the activation role for a bar moved off its lifeline", () => {
		const scene = renderSequenceDiagram(sequenceFixture);
		const [bar] = activationBars(scene);
		if (!bar) throw new Error("Missing activation bar.");
		expect(isStructurallyValidSequenceActivation(scene, { ...bar, x: bar.x + 200 })).toBe(false);
		expect(isStructurallyValidSequenceActivation(scene, { ...bar, width: bar.width + 1 })).toBe(
			false,
		);
	});

	it("keeps the activation role for bars nested two levels deep", () => {
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				id: "deep",
				title: "Deep nesting",
				type: "sequence",
				participants: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
					{ id: "c", label: "C" },
				],
				messages: [
					{ id: "q1", source: "a", target: "b", label: "First" },
					{ id: "q2", source: "c", target: "b", label: "Second" },
					{ id: "q3", source: "a", target: "b", label: "Third" },
					{ id: "r3", source: "b", target: "a", label: "Third done", type: "return" },
					{ id: "r2", source: "b", target: "c", label: "Second done", type: "return" },
					{ id: "r1", source: "b", target: "a", label: "First done", type: "return" },
				],
			}),
		);
		const bars = activationBars(scene);
		expect(bars.map((bar) => bar.nodeId)).toEqual([
			"b:lifeline:activation:q1",
			"b:lifeline:activation:q2",
			"b:lifeline:activation:q3",
		]);
		expect(bars.map((bar) => bar.x - (bars[0]?.x ?? 0))).toEqual([0, 6, 12]);
		for (const bar of bars) {
			expect(isStructurallyValidSequenceActivation(scene, bar), bar.nodeId).toBe(true);
		}
		const [, , deepest] = bars;
		if (!deepest) throw new Error("Missing the deepest bar.");
		// A whole nesting step past the bars this lifeline has is not a bar.
		expect(isStructurallyValidSequenceActivation(scene, { ...deepest, x: deepest.x + 6 })).toBe(
			false,
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});
});
