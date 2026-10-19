import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { orgChartFixture, orgChartStressFixtures } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildOrgChartResultSchema } from "./contract.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { applyDiagramPatch, buildOrgChart, CodeModeRuntimeEnvironment } from "./runtime.js";

const storage = makeMemoryArtifactStorage();
function run<A>(
	effect: Effect.Effect<A, never, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}
function build(spec: unknown) {
	return run(
		buildOrgChart({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}),
	);
}
const inline = (built: { artifact: { formats: { format: string; inline?: unknown }[] } }) =>
	new Map(built.artifact.formats.map((format) => [format.format, format.inline]));

/** The documented example: a CEO, an assistant, a CTO and an engineer, and a dotted line. */
const startupSpec = {
	title: "Startup team",
	people: [
		{ id: "ceo", name: "Ada Lovelace", title: "CEO" },
		{
			id: "ea",
			name: "Grace Hopper",
			title: "Executive Assistant",
			manager: "ceo",
			assistant: true,
		},
		{ id: "cto", name: "Alan Turing", title: "CTO", department: "Engineering", manager: "ceo" },
		{
			id: "dev",
			name: "Ken Thompson",
			title: "Engineer",
			department: "Engineering",
			manager: "cto",
		},
		{ id: "cpo", name: "Radia Perlman", title: "CPO", department: "Product", manager: "ceo" },
	],
	dottedLines: [{ report: "dev", manager: "cpo" }],
};

describe("Code Mode native org chart", () => {
	it("builds the documented spec into cards, reporting lines and a dotted line", async () => {
		const built = await build(startupSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(BuildOrgChartResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec).toMatchObject({
			id: "startup-team",
			title: "Startup team",
			dottedLines: [{ id: "dev-dotted-cpo", report: "dev", manager: "cpo" }],
		});
		expect(built.normalizedSpec.people[1]).toEqual({
			id: "ea",
			name: "Grace Hopper",
			title: "Executive Assistant",
			manager: "ceo",
			assistant: true,
		});
		expect(built.quality.summary).toEqual({ nodeCount: 5, edgeCount: 5 });
		const excalidraw = inline(built).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(excalidraw.elements.find((element) => element.id === "edge:cto")).toMatchObject({
			startArrowhead: null,
			endArrowhead: null,
			startBinding: { elementId: "node:ceo" },
			endBinding: { elementId: "node:cto" },
		});
		expect(
			excalidraw.elements.find((element) => element.id === "edge:dotted:dev-dotted-cpo"),
		).toMatchObject({ strokeStyle: "dashed", endArrowhead: "arrow" });
	});

	it("reads manager, title and team aliases, listed reports and dotted lines on a person", async () => {
		const built = await build({
			title: "Aliases",
			people: [
				{ id: "ceo", name: "Ada", role: "CEO", directReports: ["cto"] },
				{ id: "cto", name: "Alan", position: "CTO", team: "Engineering", dottedLineTo: "ceo" },
				{ id: "dev", name: "Ken", jobTitle: "Engineer", reportsTo: "cto" },
				{ id: "ea", name: "Grace", kind: "assistant", managerId: "ceo" },
			],
		});
		expect(built.ok, JSON.stringify(built.issues)).toBe(false);
		// A dotted line onto one's own solid manager is no second line.
		expect(built.issues.map((issue) => issue.code)).toEqual(["invalid_reporting_line"]);
		const fixed = await build({
			title: "Aliases",
			people: [
				{ id: "ceo", name: "Ada", role: "CEO", directReports: ["cto", "cpo"] },
				{ id: "cto", name: "Alan", position: "CTO", team: "Engineering" },
				{ id: "cpo", name: "Radia", position: "CPO", team: "Product" },
				{ id: "dev", name: "Ken", jobTitle: "Engineer", reportsTo: "cto", dottedLineTo: "cpo" },
				{ id: "ea", name: "Grace", kind: "assistant", managerId: "ceo" },
			],
		});
		if (!fixed.ok) throw new Error(JSON.stringify(fixed.issues));
		expect(fixed.normalizedSpec.people.map((person) => [person.id, person.manager])).toEqual([
			["ceo", undefined],
			["cto", "ceo"],
			["cpo", "ceo"],
			["dev", "cto"],
			["ea", "ceo"],
		]);
		expect(fixed.normalizedSpec.people[4]?.assistant).toBe(true);
		expect(fixed.normalizedSpec.dottedLines).toEqual([
			{ id: "dev-dotted-cpo", report: "dev", manager: "cpo" },
		]);
	});

	it("names omitted dotted-line ids by their ends, clear of explicit ones", async () => {
		const built = await build({
			...startupSpec,
			dottedLines: [
				{ report: "dev", manager: "cpo" },
				{ id: "dev-dotted-cpo", report: "ea", manager: "cto" },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.dottedLines.map((line) => line.id)).toEqual([
			"dev-dotted-cpo-2",
			"dev-dotted-cpo",
		]);
	});

	it("keeps cards and their texts through a patch", async () => {
		const built = await build(startupSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{ op: "setStyle", selector: { nodeIds: ["cto"] }, style: { strokeColor: "#1f44c9" } },
				],
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene", "excalidraw"],
				},
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const scene = inline(patched).get("scene") as RenderedDiagramScene;
		expect(scene.elements.find((element) => element.id === "node:cto")).toMatchObject({
			strokeColor: "#1f44c9",
		});
		const excalidraw = inline(patched).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		// The name is drawn once, above the title the card binds.
		expect(
			excalidraw.elements.filter(
				(element) => element.type === "text" && element["text"] === "Alan Turing",
			),
		).toHaveLength(1);
	});

	it("round-trips canonical diagrams through their Code Mode documents", async () => {
		for (const diagram of [orgChartFixture, orgChartStressFixtures.regions]) {
			const document = canonicalDocumentFromDiagram(diagram);
			expect(document.type).toBe("org-chart");
			const built = await build(document.spec);
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.people).toEqual(diagram.people);
			expect(built.normalizedSpec.dottedLines).toEqual(diagram.dottedLines);
			expect(built.normalizedSpec.groupByDepartment).toBe(diagram.groupByDepartment);
		}
	});

	it.each([
		[
			{ people: [...startupSpec.people, { id: "x", name: "X", manager: "ghost" }] },
			"missing_edge_source",
		],
		[{ people: [...startupSpec.people, { id: "board", name: "Board" }] }, "invalid_reporting_line"],
		[
			{
				people: [
					{ id: "a", name: "A", manager: "b" },
					{ id: "b", name: "B", manager: "a" },
					{ id: "c", name: "C" },
				],
				dottedLines: [],
			},
			"invalid_reporting_line",
		],
		[{ people: [...startupSpec.people, { id: "x", name: "X", manager: "ea" }] }, "invalid_person"],
		[{ people: [{ id: "a:b", name: "A" }], dottedLines: [] }, "invalid_person"],
		[
			{ people: [...startupSpec.people, { id: "ceo", name: "Twin", manager: "cto" }] },
			"duplicate_node_id",
		],
		[{ dottedLines: [{ report: "dev", manager: "ghost" }] }, "invalid_reporting_line"],
		[
			{
				people: Array.from({ length: 101 }, (_, index) => ({
					id: `p${index}`,
					name: `Person ${index}`,
					...(index === 0 ? {} : { manager: "p0" }),
				})),
				dottedLines: [],
			},
			"org_chart_too_large",
		],
		[{ people: [{ id: "a", name: "N".repeat(61) }], dottedLines: [] }, "label_too_long"],
	])("rejects %j with a structured repair issue", async (change, code) => {
		const result = await build({ ...startupSpec, ...change });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_org_chart");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.ref?.path?.startsWith("spec."))).toBe(
			true,
		);
	});

	it("rejects repeated ids around a cycle as an invalid chart, and keeps a lone dotted line", async () => {
		const cyclic = await build({
			title: "Twins",
			people: [
				{ id: "a", name: "A", manager: "b" },
				{ id: "b", name: "B", manager: "a" },
				{ id: "a", name: "Another A" },
			],
		});
		expect(cyclic.status).toBe("invalid_org_chart");
		expect(cyclic.issues.map((issue) => issue.code)).toContain("duplicate_node_id");
		const lone = await build({
			...startupSpec,
			dottedLines: { report: "dev", manager: "cpo", label: "for clinical systems" },
		});
		if (!lone.ok) throw new Error(JSON.stringify(lone.issues));
		expect(lone.normalizedSpec.dottedLines).toEqual([
			{ id: "dev-dotted-cpo", report: "dev", manager: "cpo", label: "for clinical systems" },
		]);
	});

	it("draws separate trees only as an explicit forest", async () => {
		const people = [...startupSpec.people, { id: "board", name: "Board chair" }];
		expect((await build({ ...startupSpec, people })).ok).toBe(false);
		expect((await build({ ...startupSpec, people, forest: true })).ok).toBe(true);
	});

	it("rejects a person without a name before building, naming the field", async () => {
		const result = await build({ title: "Team", people: [{ id: "a", title: "CEO" }] });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(JSON.stringify(result.issues)).toContain("name");
	});
});
