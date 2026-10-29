import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { sankeyFixture, sankeyStressFixtures } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildSankeyResultSchema } from "./contract.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { applyDiagramPatch, buildSankey, CodeModeRuntimeEnvironment } from "./runtime.js";

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
		buildSankey({
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

/** The documented example: two departments' spend on three services. */
const budgetSpec = {
	title: "Cloud budget",
	unit: "$k",
	nodes: [
		{ id: "eng", label: "Engineering" },
		{ id: "data", label: "Data" },
		{ id: "compute", label: "Compute" },
		{ id: "storage", label: "Storage" },
		{ id: "db", label: "Databases" },
	],
	links: [
		{ source: "eng", target: "compute", value: 180 },
		{ source: "eng", target: "db", value: 60 },
		{ source: "data", target: "storage", value: 85 },
		{ source: "data", target: "compute", value: 4 },
	],
};

describe("Code Mode native Sankey diagram", () => {
	it("builds the documented spec into bars, bands and every value", async () => {
		const built = await build(budgetSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(BuildSankeyResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec).toMatchObject({
			id: "cloud-budget",
			title: "Cloud budget",
			unit: "$k",
		});
		expect(built.normalizedSpec.links).toEqual(budgetSpec.links);
		expect(built.quality.summary).toEqual({ nodeCount: 5, edgeCount: 4 });
		const scene = inline(built).get("scene") as RenderedDiagramScene;
		const texts = scene.elements.flatMap((element) =>
			element.type === "text" ? [element.text] : [],
		);
		expect(texts).toEqual(
			expect.arrayContaining(["Engineering\n$240k", "Compute\n$184k", "$180k", "$4k"]),
		);
		const excalidraw = inline(built).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(
			excalidraw.elements.find((element) => element.id === "node:sankey:link:eng:compute"),
		).toMatchObject({
			type: "line",
			customData: { sketchiShape: "polygon", sketchiRendererRole: "sankey-mark" },
		});
	});

	it("reads flows with from, to and amount, and nodes named only by their links", async () => {
		const built = await build({
			title: "Hiring funnel",
			flows: [
				{ from: "Applicants", to: "Phone screen", amount: 300 },
				{ from: "Applicants", to: "Rejected", amount: 900 },
				{ from: "Phone screen", to: "Rejected", amount: "150" },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.nodes).toEqual([
			{ id: "applicants", label: "Applicants" },
			{ id: "phone-screen", label: "Phone screen" },
			{ id: "rejected", label: "Rejected" },
		]);
		expect(built.normalizedSpec.links.at(-1)).toEqual({
			source: "phone-screen",
			target: "rejected",
			value: 150,
		});
	});

	it("keeps every mark's role and the values through a patch", async () => {
		const built = await build(budgetSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["sankey:node:eng"] },
						style: { strokeColor: "#1f44c9" },
					},
				],
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene", "excalidraw"],
				},
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const scene = inline(patched).get("scene") as RenderedDiagramScene;
		expect(scene.elements.find((element) => element.id === "node:sankey:node:eng")).toMatchObject({
			strokeColor: "#1f44c9",
			rendererRole: "sankey-mark",
		});
		expect(
			scene.elements.find((element) => element.id === "node:sankey:link:eng:compute"),
		).toMatchObject({
			shape: "polygon",
			rendererRole: "sankey-mark",
		});
		const excalidraw = inline(patched).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		// Bars carry no generated label after a patch; their totals stay beside them.
		expect(
			excalidraw.elements.filter(
				(element) => element.type === "text" && element["text"] === "Engineering",
			),
		).toHaveLength(0);
	});

	it("round-trips canonical diagrams through their Code Mode documents", async () => {
		for (const diagram of [
			sankeyFixture,
			sankeyStressFixtures.energy,
			sankeyStressFixtures.hiring,
		]) {
			const document = canonicalDocumentFromDiagram(diagram);
			expect(document.type).toBe("sankey");
			const built = await build(document.spec);
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.nodes).toEqual(diagram.nodes);
			expect(built.normalizedSpec.links).toEqual(diagram.links);
			expect(built.normalizedSpec.unit).toBe(diagram.unit);
		}
	});

	it.each([
		[
			{ links: [...budgetSpec.links, { source: "compute", target: "eng", value: 1 }] },
			"sankey_cycle",
		],
		[{ links: [...budgetSpec.links, { source: "eng", target: "eng", value: 1 }] }, "self_loop"],
		[
			{ links: [...budgetSpec.links, { source: "eng", target: "ghost", value: 1 }] },
			"invalid_sankey_flow",
		],
		[
			{ links: [...budgetSpec.links, { source: "eng", target: "compute", value: 2 }] },
			"invalid_sankey_flow",
		],
		[
			{ links: [{ source: "eng", target: "compute", value: -5 }, ...budgetSpec.links.slice(1)] },
			"invalid_sankey_flow",
		],
		[{ nodes: [...budgetSpec.nodes, { id: "idle", label: "Idle" }] }, "invalid_sankey_node"],
		[{ nodes: [...budgetSpec.nodes, { id: "eng", label: "Again" }] }, "duplicate_node_id"],
		[{ nodes: [...budgetSpec.nodes.slice(0, 4), { id: "db", label: " \n " }] }, "missing_field"],
	])("rejects an invalid flow with a repair hint (%#)", async (change, code) => {
		const built = await build({ ...budgetSpec, ...change });
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_sankey");
		expect(built.issues.map((entry) => entry.code)).toContain(code);
		for (const entry of built.issues) expect(entry.hint?.length).toBeGreaterThan(10);
	});

	it("rejects a malformed node list before building rather than inventing nodes", async () => {
		for (const nodes of [null, { eng: "Engineering" }, "Engineering"]) {
			const built = await build({ title: "Budget", nodes, flows: budgetSpec.links });
			expect(built.ok, JSON.stringify(nodes)).toBe(false);
			if (built.ok) continue;
			expect(built.status).toBe("invalid_input");
			expect(JSON.stringify(built.issues)).toContain("nodes");
		}
	});

	it("rejects a layout whose labels would overlap, with a repair hint, and builds it once they are short", async () => {
		const teams = Array.from({ length: 8 }, (_, index) => ({
			id: `t${index}`,
			label: `Team ${index + 1}`,
		}));
		const services = Array.from({ length: 8 }, (_, index) => ({
			id: `s${index}`,
			label: `Service ${index + 1}`,
		}));
		const spec = (label?: string) => ({
			title: "All to all",
			nodes: [...teams, ...services],
			links: teams.flatMap((team) =>
				services.map((service) => ({
					source: team.id,
					target: service.id,
					value: 1,
					...(label ? { label } : {}),
				})),
			),
		});
		const crowded = await build(spec("Renewals and expansions and other income"));
		expect(crowded.ok).toBe(false);
		if (crowded.ok) return;
		expect(crowded.status).toBe("quality_failed");
		expect(crowded.quality?.accepted).toBe(false);
		expect(crowded.issues).toEqual([
			expect.objectContaining({
				code: "quality_below_threshold",
				hint: expect.stringContaining("leave link labels out"),
			}),
		]);
		const plain = await build(spec());
		if (!plain.ok) throw new Error(JSON.stringify(plain.issues));
	});

	it("rejects a link without a value before building, naming the field", async () => {
		const built = await build({
			...budgetSpec,
			links: [{ source: "eng", target: "compute" }, ...budgetSpec.links.slice(1)],
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_input");
		expect(JSON.stringify(built.issues)).toContain("value");
	});
});
