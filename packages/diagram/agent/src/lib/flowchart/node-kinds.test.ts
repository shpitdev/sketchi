import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { FLOWCHART_NODE_KIND_HINT, resolveFlowchartNodeKinds } from "./node-kinds.js";
import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../code-mode/artifacts.js";
import { buildFlowchart, CodeModeRuntimeEnvironment } from "../code-mode/runtime.js";

function build(spec: unknown) {
	return Effect.runPromise(
		buildFlowchart({ spec, options: { artifactFormats: ["scene"], inlineArtifacts: [] } }).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_kinds`,
			}),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
}

const edges = [
	{ source: "receive", target: "match" },
	{ source: "match", target: "matches" },
	{ source: "matches", target: "approve", label: "yes" },
	{ source: "matches", target: "review", label: "no" },
	{ source: "review", target: "approve" },
];
/** Invoice approval as models send it: a type key, synonyms and omitted kinds. */
const invoice = (nodes: Array<Record<string, unknown>>) => ({
	title: "Invoice approval",
	nodes,
	edges,
});
const kinds = (input: unknown) =>
	(
		resolveFlowchartNodeKinds({ spec: input }) as { spec: { nodes: Array<{ kind?: unknown }> } }
	).spec.nodes.map((node) => node.kind);

const branchOutcomes = (
	end: Record<string, unknown> = { kind: "end" },
	label = "Request a receipt",
) => ({
	title: "Branch outcomes",
	nodes: [
		{ id: "start", label: "Begin", kind: "start" },
		{ id: "decision", label: "Continue?", kind: "decision" },
		{ id: "action", label, kind: "process" },
		{ id: "end", label: "Complete", ...end },
	],
	edges: [
		{ source: "start", target: "decision" },
		{ source: "decision", target: "action", label: "no" },
		{ source: "decision", target: "end", label: "yes" },
	],
});

describe("flowchart node kinds", () => {
	it.each(["Request a receipt", "Escalate to provider"])(
		"builds a terminal action marked process without a repair turn: %s",
		async (label) => {
			const built = await build(branchOutcomes({ kind: "end" }, label));
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.nodes.find((node) => node.id === "action")).toEqual({
				id: "action",
				label,
				kind: "end",
			});
			expect(built.normalizedSpec.edges).toHaveLength(3);
		},
	);

	it.each([
		["kind synonym", { kind: "finish" }],
		["type key", { type: "end" }],
		["type synonym", { type: "exit" }],
		["terminal by position", { kind: "terminal" }],
		["type terminal by position", { type: "terminator" }],
		["omitted kind resolved by position", {}],
	])("uses a connected end resolved from %s", async (_name, end) => {
		const built = await build(branchOutcomes(end));
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(
			built.normalizedSpec.nodes.filter((node) => node.kind === "end").map((node) => node.id),
		).toEqual(["action", "end"]);
	});

	it.each(["end", "finish"])(
		"does not let an unconnected %s suppress missing outgoing edges",
		async (kind) => {
			const spec = branchOutcomes();
			const built = await build({
				...spec,
				nodes: spec.nodes.map((node) => (node.id === "end" ? { ...node, kind } : node)),
				edges: spec.edges.filter((edge) => edge.target !== "end"),
			});
			expect(built).toMatchObject({
				ok: false,
				status: "invalid_flowchart",
				issues: expect.arrayContaining([
					expect.objectContaining({
						code: "missing_outgoing_edge",
						ref: { kind: "node", id: "action" },
					}),
				]),
			});
		},
	);

	it.each([false, true])(
		"rejects an unfinished process chain (unconnected end: %s)",
		async (includeEnd) => {
			const built = await build({
				title: "Unfinished chain",
				nodes: [
					{ id: "start", label: "Begin", kind: "start" },
					{ id: "a", label: "A", kind: "process" },
					{ id: "b", label: "B", kind: "process" },
					...(includeEnd ? [{ id: "end", label: "Done", kind: "end" }] : []),
				],
				edges: [
					{ source: "start", target: "a" },
					{ source: "a", target: "b" },
				],
			});
			expect(built).toMatchObject({
				ok: false,
				issues: expect.arrayContaining([
					expect.objectContaining({
						code: "missing_outgoing_edge",
						ref: { kind: "node", id: "b" },
					}),
				]),
			});
			if (!includeEnd)
				expect(built.issues).toEqual(
					expect.arrayContaining([expect.objectContaining({ code: "missing_end" })]),
				);
		},
	);

	it.each(["question", "unlabeled branch", "non-decision source", "isolated process", "no end"])(
		"keeps %s invalid at the build boundary",
		async (reason) => {
			const spec = branchOutcomes();
			const nodes = spec.nodes.map((node) => {
				if (node.id === "action" && reason === "question") return { ...node, label: "Ready?" };
				if (node.id === "decision" && reason === "non-decision source")
					return { ...node, label: "Route", kind: "process" };
				if (node.id === "end" && reason === "no end") return { ...node, kind: "process" };
				return node;
			});
			const edges = spec.edges.flatMap((edge) => {
				if (edge.target !== "action") return [edge];
				if (reason === "isolated process") return [];
				if (reason === "unlabeled branch") return [{ source: edge.source, target: edge.target }];
				return [edge];
			});
			const built = await build({ ...spec, nodes, edges });
			expect(built).toMatchObject({
				ok: false,
				issues: expect.arrayContaining([
					expect.objectContaining({
						code: "missing_outgoing_edge",
						ref: { kind: "node", id: "action" },
					}),
				]),
			});
			if (reason === "no end")
				expect(built.issues).toEqual(
					expect.arrayContaining([expect.objectContaining({ code: "missing_end" })]),
				);
		},
	);

	it("maps synonyms, a type key and terminal by position", () => {
		expect(
			kinds(
				invoice([
					{ id: "receive", label: "Receive invoice", type: "Start" },
					{ id: "match", label: "Match to purchase order", kind: "task" },
					{ id: "matches", label: "Matches?", kind: "condition" },
					{ id: "review", label: "Exception review", kind: "Action" },
					{ id: "approve", label: "Approve payment", kind: "terminal" },
				]),
			),
		).toEqual(["start", "process", "decision", "process", "end"]);
		expect(
			resolveFlowchartNodeKinds({
				spec: invoice([{ id: "receive", label: "Receive invoice", type: "start" }]),
			}),
		).toEqual({
			spec: invoice([{ id: "receive", label: "Receive invoice", kind: "start" }]),
		});
	});

	it("fills an omitted kind only where the graph decides it", () => {
		expect(
			kinds(
				invoice([
					{ id: "receive", label: "Receive invoice" },
					{ id: "match", label: "Match to purchase order" },
					{ id: "matches", label: "Matches purchase order" },
					{ id: "review", label: "Exception review" },
					{ id: "approve", label: "Approve payment" },
				]),
			),
		).toEqual(["start", "process", undefined, "process", "end"]);
		// A question with one way out is still left for the caller to name.
		expect(
			kinds({
				title: "Question",
				nodes: [
					{ id: "a", label: "Open", kind: "start" },
					{ id: "b", label: "Ready?" },
					{ id: "c", label: "Done", kind: "end" },
				],
				edges: [
					{ source: "a", target: "b" },
					{ source: "b", target: "c" },
				],
			}),
		).toEqual(["start", undefined, "end"]);
		// Judged on the label the build will draw, after tool-output fragments are cleaned.
		expect(
			kinds({
				title: "Question",
				nodes: [
					{ id: "a", label: "Open", kind: "start" },
					{ id: "b", label: "Ready?,kind:" },
					{ id: "c", label: "Done", kind: "end" },
				],
				edges: [
					{ source: "a", target: "b" },
					{ source: "b", target: "c" },
				],
			}),
		).toEqual(["start", undefined, "end"]);
		// Several entries leave the start to the caller.
		expect(
			kinds({
				title: "Two entries",
				nodes: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
					{ id: "c", label: "C" },
				],
				edges: [
					{ source: "a", target: "c" },
					{ source: "b", target: "c" },
				],
			}),
		).toEqual([undefined, undefined, "end"]);
	});

	it("reads { from, to } edges as { source, target }", () => {
		const fromTo = {
			title: "Invoice approval",
			nodes: [
				{ id: "receive", label: "Receive invoice", kind: "start" },
				{ id: "match", label: "Match to purchase order" },
				{ id: "approve", label: "Approve payment" },
			],
			edges: [
				{ from: "receive", to: "match" },
				{ from: "match", to: "approve", label: "matched" },
			],
		};
		expect(resolveFlowchartNodeKinds({ spec: fromTo })).toEqual({
			spec: {
				...fromTo,
				nodes: [
					{ id: "receive", label: "Receive invoice", kind: "start" },
					{ id: "match", label: "Match to purchase order" },
					{ id: "approve", label: "Approve payment", kind: "end" },
				],
				edges: [
					{ source: "receive", target: "match" },
					{ label: "matched", source: "match", target: "approve" },
				],
			},
		});
	});

	it("leaves unknown kinds and non-flowchart input alone", () => {
		const input = { spec: invoice([{ id: "receive", label: "Receive", kind: "subroutine" }]) };
		expect(resolveFlowchartNodeKinds(input)).toBe(input);
		expect(resolveFlowchartNodeKinds(null)).toBeNull();
		expect(resolveFlowchartNodeKinds({ spec: { nodes: "x" } })).toEqual({ spec: { nodes: "x" } });
	});

	it("builds a recoverable spec first try and names the allowed kinds otherwise", async () => {
		const built = await build(
			invoice([
				{ id: "receive", label: "Receive invoice", type: "start" },
				{ id: "match", label: "Match to purchase order", kind: "step" },
				{ id: "matches", label: "Matches purchase order?", kind: "decision" },
				{ id: "review", label: "Exception review" },
				{ id: "approve", label: "Approve payment" },
			]),
		);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.nodes.map((node) => node.kind)).toEqual([
			"start",
			"process",
			"decision",
			"process",
			"end",
		]);

		// A would-be decision without a kind is never drawn as a step.
		const rejected = await build(
			invoice([
				{ id: "receive", label: "Receive invoice", kind: "start" },
				{ id: "match", label: "Match to purchase order", kind: "process" },
				{ id: "matches", label: "Matches purchase order" },
				{ id: "review", label: "Exception review", kind: "process" },
				{ id: "approve", label: "Approve payment", kind: "end" },
			]),
		);
		expect(rejected).toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [
				{
					code: "missing_field",
					ref: { kind: "request", path: "spec.nodes.[2].kind" },
					hint: FLOWCHART_NODE_KIND_HINT,
				},
			],
		});
		expect(FLOWCHART_NODE_KIND_HINT).toContain('"start"');
		expect(FLOWCHART_NODE_KIND_HINT).toContain('"decision"');
	});
});
