import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { laneFixtures, laneRegionIssues, type CanvasSpec } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { buildFlowchart, CodeModeRuntimeEnvironment } from "./runtime.js";

function build(spec: unknown) {
	return Effect.runPromise(
		buildFlowchart({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_lanes`,
			}),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
}

const spec = {
	title: "Expense approval across roles",
	lanes: [
		{ id: "employee", label: " Employee " },
		{ id: "manager", label: "Manager" },
		{ id: "finance", label: "Finance" },
	],
	nodes: [
		{ id: "submit", label: "Submit expense report", kind: "start", lane: "employee" },
		{ id: "approved", label: "Approved?", kind: "decision", lane: "manager" },
		{ id: "revise", label: "Revise the report", kind: "process", lane: "employee" },
		{ id: "pay", label: "Pay the employee", kind: "end", lane: "finance" },
	],
	edges: [
		{ source: "submit", target: "approved" },
		{ source: "approved", target: "pay", label: "yes" },
		{ source: "approved", target: "revise", label: "no" },
		{ source: "revise", target: "approved" },
	],
	layout: { direction: "LR" },
};

describe("Code Mode flowchart lanes", () => {
	it("builds declared lanes into locked bands that hold their steps", async () => {
		const built = await build(spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.lanes).toEqual([
			{ id: "employee", label: "Employee" },
			{ id: "manager", label: "Manager" },
			{ id: "finance", label: "Finance" },
		]);
		expect(built.normalizedSpec.nodes.map((node) => node.lane)).toEqual([
			"employee",
			"manager",
			"employee",
			"finance",
		]);
		const scene = built.artifact.formats.find((format) => format.format === "scene")
			?.inline as CanvasSpec;
		expect(laneRegionIssues(scene, built.normalizedSpec)).toEqual([]);
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const band = excalidraw.elements.find((element) => element.id === "lane:manager");
		expect(band).toMatchObject({ type: "rectangle", locked: true, roundness: null });
		expect(
			excalidraw.elements.find((element) => element.id === "lane:manager:label")?.["text"],
		).toBe("Manager");
	});

	it("rejects a node in an undeclared lane or in none, with a repair hint", async () => {
		const built = await build({
			...spec,
			nodes: spec.nodes.map(({ lane, ...node }) =>
				node.id === "pay"
					? { ...node, lane: "Finance team" }
					: node.id === "revise"
						? node
						: { ...node, lane },
			),
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_flowchart");
		expect(built.issues).toEqual([
			expect.objectContaining({
				code: "unknown_node_lane",
				ref: { kind: "node", id: "revise", path: "spec.nodes.lane" },
				hint: 'Set lane to the declared lane id ("employee", "manager", "finance") of the actor that does this step.',
			}),
			expect.objectContaining({
				code: "unknown_node_lane",
				ref: { kind: "node", id: "pay", path: "spec.nodes.lane" },
				hint: 'Set lane to a declared lane id ("employee", "manager", "finance") or declare "Finance team" in lanes.',
			}),
			expect.objectContaining({
				code: "empty_lane",
				ref: { kind: "lane", id: "finance", path: "spec.lanes" },
			}),
		]);
	});

	it("rejects a repeated lane and lanes declared with groups", async () => {
		const built = await build({
			...spec,
			lanes: [...spec.lanes, { id: "finance", label: "Again" }],
			groups: [{ id: "team", label: "Team" }],
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.issues.map((issue) => [issue.code, issue.ref])).toEqual(
			expect.arrayContaining([
				["lanes_with_groups", { kind: "diagram", id: expect.any(String), path: "spec.groups" }],
				["duplicate_lane_id", { kind: "lane", id: "finance", path: "spec.lanes" }],
			]),
		);
	});

	it("keeps lanes through the canonical document a generated diagram builds from", () => {
		const document = canonicalDocumentFromDiagram(laneFixtures["order-fulfilment"]);
		expect(document.type).toBe("flowchart");
		if (document.type !== "flowchart") return;
		expect(document.spec.lanes?.map((lane) => lane.id)).toEqual([
			"customer",
			"sales",
			"warehouse",
			"billing",
		]);
		expect(document.spec.nodes.find((node) => node.id === "pay")?.lane).toBe("customer");
	});
});
