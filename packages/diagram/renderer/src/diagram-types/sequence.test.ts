import { describe, expect, it } from "vitest";
import {
	type SequenceDiagram,
	apiRequestSequence,
	deployWebhookLogoSequence,
	embedCanvasIcons,
	estimateTextWidth,
	getCanvasValidationIssues,
	parseSequenceDiagram,
	sequenceFixture,
	wrapTextToWidth,
	wrappedLabelWidth,
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

/**
 * Haiku's ride-booking-sequence-large in the November 2026 round of large
 * scenarios: ten participants and forty messages, by participant index.
 */
const RIDE_PARTICIPANTS = [
	"Rider App",
	"API Gateway",
	"Auth Service",
	"Trip Service",
	"Pricing Service",
	"Database",
	"Payment Service",
	"Dispatch Service",
	"Driver App",
	"Notification Service",
];
const RIDE_MESSAGES: readonly (readonly [number, number, string, "return"?])[] = [
	[0, 1, "Request ride"],
	[1, 2, "Validate token"],
	[2, 1, "Token valid", "return"],
	[1, 3, "Create trip"],
	[3, 4, "Get fare estimate"],
	[4, 5, "Load surge zones"],
	[5, 4, "Surge zones", "return"],
	[4, 3, "Fare estimate", "return"],
	[3, 5, "Save trip request"],
	[5, 3, "Trip saved", "return"],
	[3, 1, "Trip created", "return"],
	[1, 0, "Fare and trip id", "return"],
	[0, 1, "Confirm booking"],
	[1, 3, "Confirm trip"],
	[3, 6, "Authorize card"],
	[6, 3, "Authorization hold", "return"],
	[3, 7, "Find driver"],
	[7, 5, "Query nearby drivers"],
	[5, 7, "Driver list", "return"],
	[7, 8, "Offer trip"],
	[8, 7, "Trip accepted", "return"],
	[7, 3, "Driver assigned", "return"],
	[3, 9, "Send driver details (no reply)"],
	[9, 0, "Push driver arriving (no reply)"],
	[3, 1, "Booking confirmed", "return"],
	[1, 0, "Driver on the way", "return"],
	[8, 3, "Arrived at pickup"],
	[3, 9, "Notify rider of arrival (no reply)"],
	[8, 3, "Start trip"],
	[3, 5, "Record trip start"],
	[5, 3, "Start recorded", "return"],
	[8, 3, "End trip"],
	[3, 4, "Calculate final fare"],
	[4, 3, "Final fare", "return"],
	[3, 6, "Capture payment"],
	[6, 3, "Payment captured", "return"],
	[3, 5, "Close trip"],
	[5, 3, "Trip closed", "return"],
	[3, 9, "Send receipt (no reply)"],
	[9, 0, "Email receipt (no reply)"],
];
const rideBooking = parseSequenceDiagram({
	id: "ride-booking",
	title: "Booking a ride",
	type: "sequence",
	participants: RIDE_PARTICIPANTS.map((label) => ({
		id: label.toLowerCase().replaceAll(" ", "-"),
		label,
	})),
	messages: RIDE_MESSAGES.map(([source, target, label, type], index) => ({
		id: `m${index + 1}`,
		source: RIDE_PARTICIPANTS[source]!.toLowerCase().replaceAll(" ", "-"),
		target: RIDE_PARTICIPANTS[target]!.toLowerCase().replaceAll(" ", "-"),
		label,
		type: type ?? "message",
	})),
	style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
});

describe("sequence diagram renderer", () => {
	it("widens every header to its longest whole word and re-spaces the lifelines", () => {
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				...sequence,
				participants: [
					{ id: "customer", label: "Customer" },
					{ id: "store", label: "AuthenticationController" },
					{ id: "payments", label: "Payments" },
				],
			}),
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		const headers = scene.elements.filter(
			(e): e is NodeSceneElement =>
				e.type === "node" &&
				!e.rendererRole &&
				sequence.participants.some((p) => p.id === e.nodeId),
		);
		const label = scene.elements.find((e) => e.id === "label:store");
		expect(label?.type === "text" && label.text).toBe("AuthenticationController");
		const width = Math.ceil(estimateTextWidth("AuthenticationController", 14)) + 24;
		expect(headers.map((header) => header.width)).toEqual([width, width, width]);
		// Columns keep their gap, and each lifeline stays centered under its header.
		expect(headers[1]!.x - headers[0]!.x).toBe(width + 140);
		for (const header of headers) {
			const lifeline = scene.elements.find((e) => e.id === `node:${header.nodeId}:lifeline`);
			expect(lifeline?.type === "node" && lifeline.x + lifeline.width / 2).toBe(
				header.x + header.width / 2,
			);
		}
	});

	it("tightens a forty-message diagram until its labels read at a screen's size, each clear of the rest", () => {
		const scene = renderSequenceDiagram(rideBooking);
		// 88 between rows and 320 between lifelines drew it 3156 by 3720, its
		// 13 px labels 7 px tall on a 2000 px screen.
		expect((13 * 2000) / (Math.max(scene.width, scene.height) + 40)).toBeGreaterThanOrEqual(10);
		const headers = scene.elements
			.filter((e): e is NodeSceneElement => e.type === "node" && !e.nodeId.includes(":"))
			.toSorted((a, b) => a.x - b.x);
		expect(headers).toHaveLength(10);
		for (const [index, header] of headers.slice(1).entries())
			expect(header.x - headers[index]!.x - headers[index]!.width).toBeGreaterThanOrEqual(40);
		const lifelines = headers.map((header) => header.x + header.width / 2);
		// Each label as Excalidraw centers it: on a three-point arrow's middle point,
		// otherwise its midpoint, wrapped at 160.
		const labels = rideBooking.messages.map((message) => {
			const { points } = arrow(scene, message.id);
			const middle =
				points.length === 3
					? points[1]!
					: { x: (points[0].x + points.at(-1)!.x) / 2, y: points[0].y };
			const text = wrapTextToWidth(message.label, 160, 13);
			return {
				id: message.id,
				...middle,
				width: wrappedLabelWidth(text, 13, 160),
				height: text.split("\n").length * 13 * 1.35,
			};
		});
		for (const label of labels)
			for (const lifeline of lifelines)
				expect(Math.abs(label.x - lifeline), label.id).toBeGreaterThanOrEqual(label.width / 2 + 12);
		for (const [index, label] of labels.entries())
			for (const other of labels.slice(index + 1))
				expect(
					Math.abs(label.x - other.x) < (label.width + other.width) / 2 + 4 &&
						Math.abs(label.y - other.y) < (label.height + other.height) / 2 + 4,
					`${label.id} and ${other.id}`,
				).toBe(false);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("tightens no further than keeps a label clear of the bars nested inside its target", () => {
		// Nineteen calls nest into p1, so the last reaches p1 a bar 108 right of its
		// lifeline, and its label, centered between its ends, moves right with it:
		// a step of 220 held the label clear of one bar, but put it over p1's outer one.
		const calls = Array.from({ length: 19 }, (_, index) => ({
			id: `c${index}`,
			source: "p0",
			target: "p1",
			label: "Validate credentials token",
		}));
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				id: "nested-calls",
				title: "Nested calls",
				type: "sequence",
				participants: Array.from({ length: 12 }, (_, index) => ({
					id: `p${index}`,
					label: `p${index}`,
				})),
				messages: [
					...calls,
					...calls.toReversed().map((call) => ({
						id: `r${call.id.slice(1)}`,
						source: "p1",
						target: "p0",
						label: call.label,
						type: "return" as const,
					})),
				],
			}),
		);
		const rows = calls.map((call) => arrow(scene, call.id).points[0].y);
		expect(rows[1]! - rows[0]!).toBeLessThan(88);
		const nodes = scene.elements.filter((e): e is NodeSceneElement => e.type === "node");
		for (const element of scene.elements) {
			if (element.type !== "arrow") continue;
			const { points } = element;
			const middle =
				points.length === 3
					? points[1]!
					: { x: (points[0].x + points.at(-1)!.x) / 2, y: points[0].y };
			const text = wrapTextToWidth(element.label ?? "", 160, 13);
			const [width, height] = [
				wrappedLabelWidth(text, 13, 160),
				text.split("\n").length * 13 * 1.35,
			];
			for (const node of nodes)
				expect(
					middle.x - width / 2 < node.x + node.width &&
						node.x < middle.x + width / 2 &&
						middle.y - height / 2 < node.y + node.height &&
						node.y < middle.y + height / 2,
					`${element.edgeId} over ${node.nodeId}`,
				).toBe(false);
		}
	});

	it("keeps a diagram that reads at a screen's size at its natural spacing", () => {
		const scene = renderSequenceDiagram(sequence);
		const rows = ["start", "charge", "receipt"].map((id) => arrow(scene, id).points[0].y);
		expect(rows[1]! - rows[0]!).toBe(88);
		expect(rows[2]! - rows[1]!).toBe(88);
		const headers = scene.elements
			.filter((e): e is NodeSceneElement => e.type === "node" && !e.nodeId.includes(":"))
			.toSorted((a, b) => a.x - b.x);
		expect(headers[1]!.x - headers[0]!.x).toBe(320);
	});

	it("labels a message clear of the lifelines it passes", () => {
		// Excalidraw centers a bound label on a three-point arrow's middle point and a
		// two-point arrow's midpoint; Receipt spans two columns, so its midpoint would
		// sit on the Store lifeline.
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				...sequence,
				participants: [...sequence.participants, { id: "bank", label: "Bank" }],
				messages: [
					...sequence.messages,
					{ id: "settle", source: "customer", target: "bank", label: "Settle" },
				],
			}),
		);
		const lifelines = scene.elements
			.filter((e) => e.type === "node" && e.nodeId.endsWith(":lifeline"))
			.map((e) => (e.type === "node" ? e.x + e.width / 2 : 0));
		const labelPoint = (points: readonly { x: number; y: number }[]) =>
			points.length % 2 === 1
				? points[(points.length - 1) / 2]!
				: {
						x: (points[points.length / 2 - 1]!.x + points[points.length / 2]!.x) / 2,
						y: points[0]!.y,
					};
		for (const id of ["start", "charge", "receipt", "settle"]) {
			const { points } = arrow(scene, id);
			expect(new Set(points.map((point) => point.y)).size).toBe(1);
			const { x } = labelPoint(points);
			// Wrapped arrow labels are at most 160px wide; a column step is 320px.
			for (const lifeline of lifelines) expect(Math.abs(x - lifeline)).toBeGreaterThanOrEqual(80);
		}
		// Receipt's label sits in the gap beside its source, Payments.
		const receipt = arrow(scene, "receipt").points;
		expect(receipt).toHaveLength(3);
		expect(receipt[1]!.x).toBe((lifelines[2]! + lifelines[1]!) / 2);
		expect(arrow(scene, "settle").points).toHaveLength(2);
	});

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

	it("draws a self-message as a loop out of its lifeline and back on its own row", () => {
		const plain = renderSequenceDiagram(sequence);
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				...sequence,
				messages: [
					sequence.messages[0]!,
					{ id: "retry", source: "payments", target: "payments", label: "Retry charge" },
					...sequence.messages.slice(1),
				],
			}),
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		const loop = arrow(scene, "retry");
		const lifeline = scene.elements.find((element) => element.id === "node:payments:lifeline");
		if (lifeline?.type !== "node") throw new Error("Missing the payments lifeline.");
		const lifelineRight = lifeline.x + lifeline.width;
		// Out of the lifeline's right edge, out, down and back into its own bar.
		const [start, out, down, end] = loop.points;
		expect(loop.points).toHaveLength(4);
		expect(loop.sourceNodeId).toBe("payments:lifeline");
		expect(start).toEqual({ x: lifelineRight, y: start.y });
		expect(out!.y).toBe(start.y);
		expect(down!.x).toBe(out!.x);
		expect(end!.y).toBe(down!.y);
		const bar = activationBars(scene).find(
			(candidate) => candidate.nodeId === "payments:lifeline:activation:retry",
		);
		if (!bar) throw new Error("Missing the self-call bar.");
		expect(loop.targetNodeId).toBe(bar.nodeId);
		expect(end!.x).toBe(bar.x + bar.width);
		expect(bar.y).toBeLessThan(end!.y);
		expect(bar.y + bar.height).toBeGreaterThan(end!.y);
		expect(isStructurallyValidSequenceActivation(scene, bar)).toBe(true);
		// The label is a free text beside the loop's outer leg, grouped with the
		// loop, and the loop is as tall as the label.
		const label = scene.elements.find((element) => element.id === "arrow:retry:label");
		if (label?.type !== "text") throw new Error("Missing the loop label.");
		const width = estimateTextWidth("Retry charge", 13);
		expect(label.containerId).toBeUndefined();
		expect(label.groupIds).toEqual(loop.groupIds);
		expect(label.x - width / 2).toBeGreaterThan(out!.x);
		expect(label.y).toBe((start.y + down!.y) / 2);
		expect(down!.y - start.y).toBeGreaterThanOrEqual(Math.ceil(13 * 1.35));
		// Messages keep their order, and rows after the loop shift by its height.
		expect(
			scene.elements.flatMap((element) => (element.type === "arrow" ? [element.edgeId] : [])),
		).toEqual(["start", "retry", "charge", "receipt"]);
		const loopHeight = down!.y - start.y;
		expect(start.y).toBe(arrow(plain, "charge").points[0].y);
		expect(arrow(scene, "charge").points[0].y).toBe(
			arrow(plain, "receipt").points[0].y + loopHeight,
		);
		expect(scene.height).toBe(plain.height + 88 + loopHeight);
		// The last column's loop label stays inside the scene.
		expect(scene.width).toBeGreaterThanOrEqual(label.x + width / 2 + 48);
	});

	it("widens the gap after a participant so a deeply nested self-message label clears the next lifeline", () => {
		const calls = Array.from({ length: 19 }, (_, index) => ({
			id: `call-${index}`,
			source: "b",
			target: "a",
			label: `Call ${index}`,
		}));
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				id: "deep-self",
				title: "Deep self-message",
				type: "sequence",
				participants: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
				],
				messages: [
					...calls,
					{ id: "validate", source: "a", target: "a", label: "ValidateCredentialsToken" },
					...calls.toReversed().map((call) => ({
						id: `reply-${call.id}`,
						source: "a",
						target: "b",
						label: `Reply ${call.label}`,
						type: "return" as const,
					})),
				],
			}),
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		const label = scene.elements.find((element) => element.id === "arrow:validate:label");
		const lifeline = scene.elements.find((element) => element.id === "node:b:lifeline");
		if (label?.type !== "text" || lifeline?.type !== "node") throw new Error("Missing elements.");
		const right = label.x + estimateTextWidth("ValidateCredentialsToken", 13) / 2;
		expect(right).toBeLessThan(lifeline.x);
		// Only the gap after the deeply nested participant widens.
		const header = (id: string) =>
			scene.elements.find(
				(element): element is NodeSceneElement => element.type === "node" && element.nodeId === id,
			);
		expect(header("b")!.x - header("a")!.x).toBeGreaterThan(header("a")!.width + 140);
	});

	it("nests a self-call's bar inside the active bar and attaches the loop to both", () => {
		const scene = renderSequenceDiagram(
			parseSequenceDiagram({
				id: "oauth-self",
				title: "OAuth with credential check",
				type: "sequence",
				participants: [
					{ id: "browser", label: "Browser" },
					{ id: "idp", label: "Identity Provider" },
				],
				messages: [
					{ id: "authorize", source: "browser", target: "idp", label: "Authorize" },
					{ id: "validate", source: "idp", target: "idp", label: "Validate credentials" },
					{ id: "audit", source: "idp", target: "idp", label: "Audit", type: "return" },
					{ id: "code", source: "idp", target: "browser", label: "Code", type: "return" },
				],
			}),
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		const bar = (call: string) => {
			const found = activationBars(scene).find(
				(candidate) => candidate.nodeId === `idp:lifeline:activation:${call}`,
			);
			if (!found) throw new Error(`Missing bar for ${call}.`);
			return found;
		};
		expect(activationBars(scene).map((candidate) => candidate.nodeId)).toEqual([
			"idp:lifeline:activation:authorize",
			"idp:lifeline:activation:validate",
		]);
		const outer = bar("authorize");
		const inner = bar("validate");
		expect(inner.x - outer.x).toBe(outer.width / 2);
		expect(inner.y).toBeGreaterThan(outer.y);
		expect(inner.y + inner.height).toBeLessThan(outer.y + outer.height);
		const validate = arrow(scene, "validate");
		expect([validate.sourceNodeId, validate.targetNodeId]).toEqual([outer.nodeId, inner.nodeId]);
		expect(validate.points[0].x).toBe(outer.x + outer.width);
		expect(validate.points.at(-1)?.x).toBe(inner.x + inner.width);
		// A self-return draws a dashed loop on the active bar and opens no bar.
		const audit = arrow(scene, "audit");
		expect([audit.sourceNodeId, audit.targetNodeId]).toEqual([outer.nodeId, outer.nodeId]);
		expect(audit.strokeStyle).toBe("dashed");
		// The outer bar still closes on the IdP's return to the browser.
		expect(arrow(scene, "code").sourceNodeId).toBe(outer.nodeId);
		for (const candidate of activationBars(scene)) {
			expect(isStructurallyValidSequenceActivation(scene, candidate)).toBe(true);
		}
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

	it("draws participant logos above their labels and grows the shared header row", () => {
		const plain = renderSequenceDiagram({
			...deployWebhookLogoSequence,
			participants: deployWebhookLogoSequence.participants.map(({ icon: _icon, ...rest }) => rest),
		});
		const scene = renderSequenceDiagram(deployWebhookLogoSequence);
		const header = (id: string) =>
			scene.elements.find(
				(element): element is NodeSceneElement => element.type === "node" && element.nodeId === id,
			);
		expect(header("github")?.icon).toEqual({ slug: "github", size: 28 });
		expect(header("developer")?.icon).toBeUndefined();
		// Every header shares one height, tall enough for the logo band.
		expect(header("developer")?.height).toBe(header("github")?.height);
		// A one-line label box (19px text + 18px padding) plus the 36px logo band.
		expect(header("github")?.height).toBeGreaterThanOrEqual(19 + 18 + 36);
		expect(header("github")?.height).toBeGreaterThan(
			plain.elements.find(
				(element): element is NodeSceneElement =>
					element.type === "node" && element.nodeId === "github",
			)?.height ?? Infinity,
		);
		expect(scene.elements.find((element) => element.id === "label:github")).toMatchObject({
			verticalAlign: "bottom",
		});
		expect(scene.elements.find((element) => element.id === "label:developer")).not.toHaveProperty(
			"verticalAlign",
		);
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h1"/></svg>';
		const embedded = embedCanvasIcons(scene, (slug) => ({ name: slug, svg }));
		expect(embedded.dropped).toEqual([]);
		expect(getCanvasValidationIssues(embedded.scene)).toEqual([]);
	});
});
