import { stateLabel } from "@sketchi/diagram-core";
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
	it("draws a shape Sketchi doesn't have plain and keeps a real one", () => {
		const candidate = parse({
			type: "flowchart",
			id: "flow",
			nodes: {
				a: { label: "Start", shape: "ellipse" },
				b: { label: "Orders", shape: "database" },
				c: "End",
			},
			edges: [
				["a", "b"],
				["b", "c"],
			],
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toMatchObject({ nodes: [{ id: "a" }, { shape: "database" }, {}] });
		expect(candidate.flowchart?.nodes["a"]).toEqual({ label: "Start" });
		expect(candidate.diagnostics.join()).toContain("shape_dropped");
	});
});

describe("flowchart roles", () => {
	const flow = (nodes: Record<string, unknown>, edges: readonly unknown[]) =>
		parse({ type: "flowchart", id: "flow", nodes, edges });

	it("come from the edges: a step nothing follows ends its path", () => {
		const candidate = flow(
			{
				a: "Start",
				b: { label: "Route it", shape: "diamond" },
				c: "Left",
				d: "Right",
				e: "Done",
			},
			[
				["a", "b"],
				["b", "c", "left"],
				["b", "d", "right"],
				["d", "e"],
			],
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toMatchObject({
			nodes: [
				{ id: "a", kind: "start" },
				{ id: "b", kind: "decision" },
				{ id: "c", kind: "end" },
				{ id: "d", kind: "process" },
				{ id: "e", kind: "end" },
			],
		});
	});

	it("draw a question nothing follows as where its path ends", () => {
		const candidate = flow({ a: "Start", b: "Route it?" }, [["a", "b"]]);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toMatchObject({ nodes: [{ kind: "start" }, { kind: "end" }] });
	});
});

describe("a final state with outgoing transitions", () => {
	const machine = (states: readonly object[], transitions: readonly object[]) =>
		parse({ type: "state-machine", id: "order", initial: "open", states, transitions });

	it("keeps its ending and its transitions, without a repair", () => {
		const candidate = machine(
			[
				{ id: "open" },
				{ id: "done", label: "Done", kind: "final" },
				{ id: "refunded", kind: "final" },
			],
			[
				{ id: "close", source: "open", target: "done", event: "close" },
				{ id: "refund", source: "done", target: "refunded", event: "refund" },
			],
		);
		expect(candidate.error).toBeUndefined();
		const diagram = candidate.diagram;
		if (diagram?.type !== "state-machine") throw new Error("Expected a state machine.");
		expect(diagram.states.find((state) => state.id === "done")?.kind).not.toBe("final");
		expect(diagram.states.find((state) => state.id === "end")?.kind).toBe("final");
		expect(diagram.transitions.map((entry) => [entry.source, entry.target])).toEqual([
			["open", "done"],
			["done", "refunded"],
			["done", "end"],
		]);
	});

	it("draws the new ending as an anonymous marker, whatever the state is called", () => {
		const candidate = machine(
			[{ id: "open" }, { id: "delivered", kind: "final" }, { id: "refunded", kind: "final" }],
			[
				{ id: "ship", source: "open", target: "delivered" },
				{ id: "refund", source: "delivered", target: "refunded" },
			],
		);
		if (candidate.diagram?.type !== "state-machine") throw new Error("Expected a state machine.");
		const added = candidate.diagram.states.find(
			(state) => state.kind === "final" && state.id !== "refunded",
		);
		expect(added).toBeDefined();
		expect(added && stateLabel(added)).toBeUndefined();
	});

	it("does not reuse an id the diagram already has", () => {
		const candidate = machine(
			[
				{ id: "open" },
				{ id: "end", label: "Archived" },
				{ id: "end-2", kind: "final" },
				{ id: "delivered", kind: "final" },
				{ id: "refunded", kind: "final" },
				{ id: "lost", kind: "final" },
			],
			[
				{ id: "ship", source: "open", target: "delivered" },
				{ id: "archive", source: "open", target: "end" },
				{ id: "finish", source: "end", target: "end-2" },
				{ id: "delivered-ends", source: "delivered", target: "refunded" },
				{ id: "misplace", source: "delivered", target: "lost" },
				{ id: "lost-ends", source: "lost", target: "refunded" },
			],
		);
		expect(candidate.error).toBeUndefined();
		if (candidate.diagram?.type !== "state-machine") throw new Error("Expected a state machine.");
		const { states, transitions } = candidate.diagram;
		expect(new Set(states.map((state) => state.id)).size).toBe(states.length);
		expect(new Set(transitions.map((entry) => entry.id)).size).toBe(transitions.length);
		const targets = (source: string) =>
			transitions.filter((entry) => entry.source === source).map((entry) => entry.target);
		expect(targets("delivered")).toEqual(["refunded", "lost", "end-3"]);
		expect(targets("lost")).toEqual(["refunded", "end-4"]);
		expect(states.find((state) => state.id === "end")?.kind).toBeUndefined();
	});

	it("leaves a final state with nothing after it alone", () => {
		const candidate = machine(
			[{ id: "open" }, { id: "done", kind: "final" }],
			[{ id: "close", source: "open", target: "done" }],
		);
		if (candidate.diagram?.type !== "state-machine") throw new Error("Expected a state machine.");
		expect(candidate.diagram.states.map((state) => state.id)).toEqual(["open", "done"]);
	});
});

describe("the response envelope", () => {
	const flowchart = {
		type: "flowchart",
		id: "flow",
		nodes: { a: "Start", b: "End" },
		edges: [["a", "b"]],
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

describe("glyphs the export font cannot draw", () => {
	it("writes arrows and comparison signs in ASCII", () => {
		const candidate = parse({
			id: "budget",
			type: "sankey",
			nodes: [
				{ id: "eng", label: "Engineering → Compute" },
				{ id: "ops", label: "Ops ≥ 10" },
			],
			links: [{ source: "eng", target: "ops", value: 5 }],
		});
		expect(candidate.error).toBeUndefined();
		expect(JSON.stringify(candidate.diagram)).toContain("Engineering -> Compute");
		expect(JSON.stringify(candidate.diagram)).toContain("Ops >= 10");
		expect(candidate.diagnostics[0]).toMatch(/^glyph_replaced/u);
	});
});

describe("a diagram without an id", () => {
	it("takes one from its title instead of failing validation", () => {
		const candidate = candidateFromText({
			model: "test",
			provider: "fixture",
			text: JSON.stringify({
				title: "API p50 latency, one week",
				diagram: {
					type: "chart",
					kind: "line",
					categories: ["Mon", "Tue"],
					series: [{ name: "p50", values: [182, 175] }],
				},
			}),
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram?.id).toBe("api-p50-latency-one-week");
	});
});
