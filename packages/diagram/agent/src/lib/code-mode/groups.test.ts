import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { groupRegionIssues, type CanvasSpec } from "@sketchi/diagram-core";
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
				createId: (prefix) => `${prefix}_groups`,
			}),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
}

const spec = {
	title: "Expense approval by team",
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
	groups: {
		employee: { label: " Employee ", contains: ["submit", "revise"] },
		finance: { label: "Finance", contains: ["pay"] },
	},
};

describe("Code Mode flowchart groups", () => {
	it("returns corrected document refs and a note through the shared MCP builder", async () => {
		const built = await build({
			title: "Form",
			nodes: { submit_form: "Submit form", review_form: "Review form" },
			edges: [["SUBMIT FORM,", "review-form."]],
			groups: { employee: { label: "Employee", contains: ["submit-form"] } },
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.edges).toEqual([["submit_form", "review_form"]]);
		expect(built.normalizedSpec.groups?.["employee"]?.contains).toEqual(["submit_form"]);
		expect(built.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "reference_resolved",
					severity: "info",
					message: expect.stringContaining("submit_form"),
				}),
			]),
		);
	});

	it("builds declared groups into editable, named frames", async () => {
		const built = await build(spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.groups).toEqual({
			employee: { label: "Employee", contains: ["submit", "revise"] },
			finance: { label: "Finance", contains: ["pay"] },
		});
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

	it("rejects a group listing an undeclared id with the nearest ids in its hint", async () => {
		const built = await build({
			...spec,
			groups: { ...spec.groups, finance: { label: "Finance", contains: ["payy"] } },
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_flowchart");
		expect(built.issues).toEqual([
			expect.objectContaining({
				code: "unknown_member",
				ref: { kind: "group", id: "finance", path: "spec.groups.finance.contains[0]" },
				hint: 'Use a declared node or group id ("pay"), or declare "payy".',
			}),
		]);
	});

	it("rejects a node two groups list when neither holds the other", async () => {
		const built = await build({
			...spec,
			groups: { ...spec.groups, finance: { label: "Finance", contains: ["pay", "revise"] } },
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.issues.map((issue) => [issue.code, issue.ref])).toEqual([
			["overlapping_containers", { kind: "node", id: "revise", path: "spec.groups" }],
		]);
	});
});
