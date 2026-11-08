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
		submit: { label: "Submit expense report", lane: "employee" },
		approved: { label: "Approved?", lane: "manager" },
		revise: { label: "Revise the report", lane: "employee" },
		pay: { label: "Pay the employee", lane: "finance" },
	},
	edges: [
		["submit", "approved"],
		["approved", "pay", "yes"],
		["approved", "revise", "no"],
		["revise", "approved"],
	],
	lanes: { employee: " Employee ", manager: "Manager", finance: "Finance" },
};

describe("Code Mode flowchart lanes", () => {
	it("returns a corrected node lane reference and a resolution note", async () => {
		const built = await build({
			...spec,
			nodes: { ...spec.nodes, submit: { label: "Submit expense report", lane: " EMPLOYEE, " } },
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.nodes["submit"]).toMatchObject({ lane: "employee" });
		expect(built.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "reference_resolved",
					severity: "info",
					message: expect.stringContaining("nodes.submit.lane"),
				}),
			]),
		);
	});

	it("builds declared lanes into locked bands that hold their steps", async () => {
		const built = await build({ ...spec, lanes: { ...spec.lanes, customer: "Customer" } });
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.lanes).toEqual({
			employee: "Employee",
			manager: "Manager",
			finance: "Finance",
			customer: "Customer",
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
		expect(excalidraw.elements.find((element) => element.id === "lane:customer")).toMatchObject({
			type: "rectangle",
			locked: true,
		});
		const band = excalidraw.elements.find((element) => element.id === "lane:manager");
		expect(band).toMatchObject({ type: "rectangle", locked: true, roundness: null });
		expect(
			excalidraw.elements.find((element) => element.id === "lane:manager:label")?.["text"],
		).toBe("Manager");
	});

	it("rejects a node that names no lane or an undeclared one, with a repair hint", async () => {
		const built = await build({
			...spec,
			nodes: { ...spec.nodes, revise: "Revise the report", pay: { label: "Pay", lane: "payroll" } },
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_flowchart");
		expect(built.issues).toEqual([
			expect.objectContaining({
				code: "node_without_lane",
				ref: { kind: "node", id: "revise", path: "spec.nodes.revise.lane" },
				hint: 'Set its lane to whoever does it ("employee", "manager", "finance").',
			}),
			expect.objectContaining({
				code: "unknown_node_lane",
				ref: { kind: "node", id: "pay", path: "spec.nodes.pay.lane" },
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
