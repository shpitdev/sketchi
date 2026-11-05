import { describe, expect, it } from "vitest";

import { candidateFromText } from "./candidates.js";

function parse(diagram: unknown, kind: string) {
	return candidateFromText({
		model: "test",
		provider: "fixture",
		text: JSON.stringify({
			title: "Title",
			intent: { requestedKind: kind, nativeKind: kind, requirements: [] },
			diagram,
		}),
	});
}

describe("mindmap trees", () => {
	const tree = (root: unknown, extra: object = {}) =>
		parse({ id: "plan", type: "mindmap", root, ...extra }, "mindmap");

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
		const candidate = parse(
			{
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
			},
			"flowchart",
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toMatchObject({ nodes: [{ id: "a" }, { shape: "database" }, {}] });
		expect(candidate.diagnostics.join()).toContain("shape_dropped");
	});
});
