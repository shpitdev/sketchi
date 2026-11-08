import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
	flowchartDiagramFromDocument,
	laneRegionIssues,
	type CanvasSpec,
} from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
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
	direction: "LR",
	nodes: {
		submit: "Submit expense report",
		approved: "Approved?",
		revise: "Revise the report",
		pay: "Pay the employee",
	},
	edges: [
		["submit", "approved"],
		["approved", "pay", "yes"],
		["approved", "revise", "no"],
		["revise", "approved"],
	],
	lanes: {
		employee: { label: " Employee ", contains: ["submit", "revise"] },
		manager: { label: "Manager", contains: ["approved"] },
		finance: { label: "Finance", contains: ["pay"] },
	},
};

describe("Code Mode flowchart lanes", () => {
	it("builds declared lanes into locked bands that hold their steps", async () => {
		const built = await build(spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.lanes).toEqual({
			employee: { label: "Employee", contains: ["submit", "revise"] },
			manager: { label: "Manager", contains: ["approved"] },
			finance: { label: "Finance", contains: ["pay"] },
		});
		const drawn = flowchartDiagramFromDocument(built.normalizedSpec);
		if (!drawn.ok) throw new Error(JSON.stringify(drawn.issues));
		expect(drawn.diagram.nodes.map((node) => node.lane)).toEqual([
			"employee",
			"manager",
			"employee",
			"finance",
		]);
		const scene = built.artifact.formats.find((format) => format.format === "scene")
			?.inline as CanvasSpec;
		expect(laneRegionIssues(scene, drawn.diagram)).toEqual([]);
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const band = excalidraw.elements.find((element) => element.id === "lane:manager");
		expect(band).toMatchObject({ type: "rectangle", locked: true, roundness: null });
		expect(
			excalidraw.elements.find((element) => element.id === "lane:manager:label")?.["text"],
		).toBe("Manager");
	});

	it("rejects a node in no lane, or in two, with a repair hint", async () => {
		const built = await build({
			...spec,
			lanes: {
				employee: { label: "Employee", contains: ["submit"] },
				manager: { label: "Manager", contains: ["approved", "pay"] },
				finance: { label: "Finance", contains: ["pay"] },
			},
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_flowchart");
		expect(built.issues).toEqual([
			expect.objectContaining({
				code: "overlapping_containers",
				ref: { kind: "node", id: "pay", path: "spec.lanes.finance.contains[0]" },
			}),
			expect.objectContaining({
				code: "node_without_lane",
				ref: { kind: "node", id: "revise", path: "spec.lanes" },
				hint: 'List it in the lane of the actor that does it ("employee", "manager", "finance").',
			}),
		]);
	});

	it("rejects lanes declared with groups", async () => {
		const built = await build({
			...spec,
			groups: { team: { label: "Team", contains: ["submit"] } },
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.issues.map((issue) => [issue.code, issue.ref])).toEqual(
			expect.arrayContaining([["lanes_with_groups", { kind: "diagram", path: "spec.groups" }]]),
		);
	});
});
