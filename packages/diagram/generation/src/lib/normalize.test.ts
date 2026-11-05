import { describe, expect, it } from "vitest";

import {
	candidateFromText,
	enforceCandidateRequestRequirements,
	WRONG_DIAGRAM_TYPE_ERROR,
} from "./candidates.js";

function parse(diagram: unknown) {
	return candidateFromText({
		model: "test",
		provider: "fixture",
		text: JSON.stringify({
			title: "Title",
			diagram,
		}),
	});
}

describe("mindmap trees", () => {
	const tree = (root: unknown, extra: object = {}) =>
		parse({ id: "plan", type: "mindmap", root, ...extra });

	it("reads a tree with no layout and leaves with no children", () => {
		const candidate = tree({
			label: "Plan",
			children: [{ label: "Food", children: [{ label: "Catering" }] }, { label: "Venue" }],
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram?.type).toBe("mindmap");
	});

	it("keeps a layout the model chose", () => {
		const candidate = tree(
			{ label: "Plan", children: [{ label: "Venue" }] },
			{ layout: { direction: "RL", edgeRouting: "curved" } },
		);
		expect(candidate.diagram).toMatchObject({ layout: { direction: "RL" } });
	});

	it.each([
		["an object", { label: "Catering" }],
		["a string", "Catering"],
		["null", null],
	])("sends children written as %s to repair instead of dropping them", (_name, children) => {
		const candidate = tree({ label: "Plan", children: [{ label: "Food", children }] });
		expect(candidate.diagram).toBeUndefined();
		expect(candidate.error).toBeDefined();
		expect(candidate.diagnostics.join()).toContain("children");
	});

	it("still rejects a root with no topics", () => {
		expect(tree({ label: "Plan" }).error).toBeDefined();
	});
});

describe("flowchart node shapes", () => {
	it("draws an unknown shape by its kind and keeps a real one", () => {
		const candidate = parse({
			type: "flowchart",
			id: "flow",
			nodes: [
				{ id: "a", label: "Start", kind: "start", shape: "ellipse" },
				{ id: "b", label: "Orders", kind: "process", shape: "database" },
				{ id: "c", label: "End", kind: "end" },
			],
			edges: [
				{ id: "a-b", source: "a", target: "b" },
				{ id: "b-c", source: "b", target: "c" },
			],
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toMatchObject({ nodes: [{ id: "a" }, { shape: "database" }, {}] });
		expect(candidate.diagnostics.join()).toContain("shape_dropped");
	});
});

describe("flowchart steps with nothing after them", () => {
	const flow = (nodes: readonly object[], edges: readonly object[]) =>
		parse({ type: "flowchart", id: "flow", nodes, edges });

	it("end their path, without a repair", () => {
		const candidate = flow(
			[
				{ id: "a", label: "Start", kind: "start" },
				{ id: "b", label: "Route it", kind: "decision" },
				{ id: "c", label: "Left", kind: "process" },
				{ id: "d", label: "Right", kind: "process" },
				{ id: "e", label: "Done", kind: "end" },
			],
			[
				{ id: "a-b", source: "a", target: "b" },
				{ id: "b-c", source: "b", target: "c", label: "left" },
				{ id: "b-d", source: "b", target: "d", label: "right" },
				{ id: "d-e", source: "d", target: "e" },
			],
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toMatchObject({
			nodes: [{}, {}, { id: "c", kind: "end" }, { id: "d", kind: "process" }, {}],
		});
	});

	it("still rejects a decision with nothing after it", () => {
		const candidate = flow(
			[
				{ id: "a", label: "Start", kind: "start" },
				{ id: "b", label: "Route it", kind: "decision" },
			],
			[{ id: "a-b", source: "a", target: "b" }],
		);
		expect(candidate.error).toBeDefined();
	});
});

describe("the response envelope", () => {
	const flowchart = {
		type: "flowchart",
		id: "flow",
		nodes: [
			{ id: "a", label: "Start", kind: "start" },
			{ id: "b", label: "End", kind: "end" },
		],
		edges: [{ id: "a-b", source: "a", target: "b" }],
	};

	it("takes the family from diagram.type", () => {
		expect(parse(flowchart).diagram?.type).toBe("flowchart");
	});

	it("ignores a plan an older prompt asked for", () => {
		const candidate = candidateFromText({
			model: "test",
			provider: "fixture",
			text: JSON.stringify({ intent: { requirements: [{ target: "nope" }] }, diagram: flowchart }),
		});
		expect(candidate.error).toBeUndefined();
	});

	it.each([
		["no diagram", undefined, "diagram_missing"],
		["a family Sketchi does not have", { ...flowchart, type: "gitgraph" }, "diagram_type_invalid"],
		["no type", { id: "x" }, "diagram_type_invalid"],
	])("rejects %s", (_name, diagram, code) => {
		const candidate = parse(diagram);
		expect(candidate.error).toBeDefined();
		expect(candidate.diagnostics.join()).toContain(code);
	});

	it("holds a typed request to its type, and leaves it alone otherwise", () => {
		const parsed = parse(flowchart);
		const typed = (requestedType: "flowchart" | "sequence") =>
			enforceCandidateRequestRequirements(parsed, {
				model: "test",
				prompt: { id: "x", request: "Draw it", requestedType },
			});
		expect(typed("flowchart").diagram?.type).toBe("flowchart");
		expect(typed("sequence").diagram).toBeUndefined();
		expect(typed("sequence").error).toBe(WRONG_DIAGRAM_TYPE_ERROR);
		expect(typed("sequence").diagnostics.join()).toContain("explicit_type_not_met");
	});
});
