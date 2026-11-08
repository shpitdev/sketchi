import { describe, expect, it } from "vitest";

import { candidateFromText } from "./candidates.js";
import { buildDiagramGenerationMessages, revisesFlowchartWithEdits } from "./messages.js";

const base = {
	type: "flowchart",
	id: "checkout",
	title: "Checkout",
	nodes: {
		cart: "Review cart",
		pay: "Take payment",
		ok: "Payment approved?",
		done: "Confirm order",
	},
	edges: [
		["cart", "pay"],
		["pay", "ok"],
		["ok", "done", "yes"],
		["ok", "cart", "no"],
	],
};

const answer = (body: unknown) =>
	candidateFromText({ model: "test", provider: "fixture", text: JSON.stringify(body) }, base);

describe("a flowchart revision written as edits", () => {
	it("asks a flowchart revision for edits, and any other revision for the whole diagram", () => {
		const prompt = { id: "r", request: "Add a fraud check before payment", base };
		expect(revisesFlowchartWithEdits(prompt)).toBe(true);
		const messages = buildDiagramGenerationMessages(prompt);
		expect(messages.system).toContain('Return one object: { "edits" }.');
		expect(messages.system).toContain('{ op: "insert", node: { id: label }, between: [from, to] }');
		expect(messages.system).not.toContain('Return one object: { "title", "diagram" }.');
		expect(messages.system).not.toContain("Styling:");

		const other = { ...prompt, requestedType: "sequence" as const };
		expect(revisesFlowchartWithEdits(other)).toBe(false);
		expect(buildDiagramGenerationMessages(other).system).toContain(
			'Return one object: { "title", "diagram" }.',
		);
	});

	it("applies the edits to the base and keeps them on the candidate", () => {
		const candidate = answer({
			edits: [
				{ op: "insert", node: { fraud: "Check for fraud" }, between: ["Review cart", "pay"] },
				{ op: "set", nodes: { done: { color: "green" } } },
			],
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.edits).toHaveLength(2);
		expect(candidate.flowchart).toMatchObject({
			id: "checkout",
			title: "Checkout",
			nodes: { fraud: "Check for fraud", done: { label: "Confirm order", color: "green" } },
		});
		expect(candidate.flowchart?.edges).toContainEqual(["cart", "fraud"]);
		expect(candidate.flowchart?.edges).toContainEqual(["fraud", "pay"]);
		const drawn = candidate.diagram;
		expect(drawn?.type === "flowchart" && drawn.nodes.map((node) => node.id)).toContain("fraud");
		expect(candidate.diagnostics).toContain(
			'reference_resolved: edits[0].between[0]: resolved "Review cart" to the node labeled it, "cart".',
		);
	});

	it("sends an edit naming what the base lacks back for repair, at its path", () => {
		const candidate = answer({
			edits: [{ op: "insert", node: { x: "X" }, between: ["cart", "shipping"] }],
		});
		expect(candidate.diagram).toBeUndefined();
		expect(candidate.diagnostics).toEqual([
			expect.stringMatching(/^flowchart\.unknown_edit_target at edits\[0\]\.between\[1\]: /),
		]);
	});

	it("draws an edited node with a stray shape plain, as a generated document does", () => {
		const candidate = answer({
			edits: [
				{
					op: "insert",
					node: { gate: { label: "Fraud gate", shape: "hexagon" } },
					between: ["cart", "pay"],
				},
			],
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.flowchart?.nodes["gate"]).toEqual({ label: "Fraud gate" });
		expect(candidate.diagnostics).toContain(
			'shape_dropped: node "gate" shape "hexagon" is not a Sketchi shape; the node draws plain.',
		);
	});

	it("keeps a null that clears a shape or a group kind", () => {
		const grouped = {
			...base,
			nodes: { ...base.nodes, pay: { label: "Take payment", shape: "database" } },
			groups: { shop: { label: "Shop", kind: "zone", contains: ["cart", "pay"] } },
		};
		const candidate = candidateFromText(
			{
				model: "test",
				provider: "fixture",
				text: JSON.stringify({
					edits: [{ op: "set", nodes: { pay: { shape: null } }, groups: { shop: { kind: null } } }],
				}),
			},
			grouped,
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.flowchart?.nodes["pay"]).toBe("Take payment");
		expect(candidate.flowchart?.groups?.["shop"]).toEqual({
			label: "Shop",
			contains: ["cart", "pay"],
		});
		expect(candidate.diagnostics.some((entry) => entry.startsWith("shape_dropped"))).toBe(false);
	});

	it("carries styles beside edits: a node's color into the document, an edge's as a style", () => {
		const candidate = answer({
			edits: [{ op: "set", nodes: { done: "Order confirmed" } }],
			styles: [
				{ targets: ["ok->cart"], strokeColor: "#dc2626" },
				{ targets: ["pay"], strokeColor: "#2563eb", fillColor: "#dbeafe" },
			],
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.edits).toHaveLength(1);
		expect(candidate.flowchart?.nodes["pay"]).toEqual({ label: "Take payment", color: "blue" });
		expect(candidate.styles?.map((style) => [...style.targets])).toEqual([["ok->cart"]]);
		const styled = buildDiagramGenerationMessages({
			id: "r",
			request: "Draw the retry edge in red",
			base,
			styling: true,
		});
		expect(styled.system).toContain("also return styles: [{");
		expect(styled.system).toContain("beside edits");
	});

	it("still accepts a whole revised diagram", () => {
		const { type, ...spec } = base;
		const candidate = answer({
			title: "Checkout",
			diagram: { type, ...spec, title: "Checkout", nodes: { ...spec.nodes, done: "Ship order" } },
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.edits).toBeUndefined();
		expect(candidate.flowchart?.nodes["done"]).toBe("Ship order");
	});
});
