import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { groupFixtures, groupRegionIssues, type CanvasSpec } from "@sketchi/diagram-core";
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
				createId: (prefix) => `${prefix}_groups`,
			}),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
}

const spec = {
	title: "Expense approval by team",
	groups: [
		{ id: "employee", label: " Employee " },
		{ id: "finance", label: "Finance" },
	],
	nodes: [
		{ id: "submit", label: "Submit expense report", kind: "start", group: "employee" },
		{ id: "approved", label: "Approved?", kind: "decision" },
		{ id: "revise", label: "Revise the report", kind: "process", group: "employee" },
		{ id: "pay", label: "Pay the employee", kind: "end", group: "finance" },
	],
	edges: [
		{ source: "submit", target: "approved" },
		{ source: "approved", target: "pay", label: "yes" },
		{ source: "approved", target: "revise", label: "no" },
		{ source: "revise", target: "approved" },
	],
};

describe("Code Mode flowchart groups", () => {
	it("builds declared groups into editable, named frames", async () => {
		const built = await build(spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.groups).toEqual([
			{ id: "employee", label: "Employee" },
			{ id: "finance", label: "Finance" },
		]);
		expect(built.normalizedSpec.nodes.map((node) => node.group)).toEqual([
			"employee",
			undefined,
			"employee",
			"finance",
		]);
		const scene = built.artifact.formats.find((format) => format.format === "scene")
			?.inline as CanvasSpec;
		expect(groupRegionIssues(scene)).toEqual([]);
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(
			excalidraw.elements
				.filter((element) => element.type === "frame")
				.map((element) => [element.id, element["name"]]),
		).toEqual([
			["group:employee", "Employee"],
			["group:finance", "Finance"],
		]);
		expect(excalidraw.elements.find((element) => element.id === "node:revise")?.["frameId"]).toBe(
			"group:employee",
		);
	});

	it("rejects a node in an undeclared group with a repair hint", async () => {
		const built = await build({
			...spec,
			nodes: spec.nodes.map((node) =>
				node.id === "pay" ? { ...node, group: "Finance team" } : node,
			),
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_flowchart");
		// Moving the only Finance node also leaves that group empty; both point at the fix.
		expect(built.issues).toEqual([
			expect.objectContaining({
				code: "unknown_node_group",
				ref: { kind: "node", id: "pay", path: "spec.nodes.group" },
				hint: 'Set group to a declared group id ("employee", "finance") or declare "Finance team" in groups.',
			}),
			expect.objectContaining({
				code: "empty_group",
				ref: { kind: "group", id: "finance", path: "spec.groups" },
			}),
		]);
	});

	it("rejects an empty or repeated group with a group reference", async () => {
		const built = await build({
			...spec,
			groups: [...spec.groups, { id: "finance", label: "Again" }, { id: "legal", label: "Legal" }],
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.issues.map((issue) => [issue.code, issue.ref])).toEqual([
			["duplicate_group_id", { kind: "group", id: "finance", path: "spec.groups" }],
			["empty_group", { kind: "group", id: "legal", path: "spec.groups" }],
		]);
	});

	it("keeps groups through the canonical document a generated diagram builds from", () => {
		const document = canonicalDocumentFromDiagram(groupFixtures["mixed-membership"]);
		expect(document.type).toBe("flowchart");
		if (document.type !== "flowchart") return;
		expect(document.spec.groups).toEqual([
			{ id: "warehouse", label: "Warehouse" },
			{ id: "shipping", label: "Shipping partner" },
		]);
		expect(document.spec.nodes.find((node) => node.id === "pick")?.group).toBe("warehouse");
		expect(document.spec.nodes.find((node) => node.id === "order")?.group).toBeUndefined();
	});
});
