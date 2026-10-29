import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { vennFixture, vennStressFixtures } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildVennDiagramResultSchema } from "./contract.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { applyDiagramPatch, buildVennDiagram, CodeModeRuntimeEnvironment } from "./runtime.js";

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
		buildVennDiagram({
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

/** The documented example: two sets, each side and the overlap. */
const phonesSpec = {
	title: "iOS vs Android",
	sets: [
		{ id: "ios", label: "iOS" },
		{ id: "android", label: "Android" },
	],
	regions: [
		{ sets: ["ios"], items: ["Live Activities", "Apple Pay"] },
		{ sets: ["android"], items: ["Google Pay"] },
		{ sets: ["ios", "android"], items: ["Push notifications", "Dark mode"] },
	],
};

describe("Code Mode native Venn diagram", () => {
	it("builds the documented spec into circles, labels and region text", async () => {
		const built = await build(phonesSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(BuildVennDiagramResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec).toMatchObject({
			id: "ios-vs-android",
			title: "iOS vs Android",
			sets: phonesSpec.sets,
			regions: phonesSpec.regions,
		});
		expect(built.quality.summary).toEqual({ nodeCount: 2, edgeCount: 0 });
		const excalidraw = inline(built).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const text = (id: string) => excalidraw.elements.find((element) => element.id === id)?.["text"];
		expect(text("venn:set:0:label")).toBe("iOS");
		expect(text("venn:region:0+1:item:1")).toBe("Dark mode");
		expect(text("venn:region:1:item:0")).toBe("Google Pay");
	});

	it("reads sets named by label, members, string sets and whole memberships", async () => {
		const built = await build({
			title: "Plans",
			sets: [
				{ label: "Basic", items: ["SSO", "API access"] },
				{ label: "Pro", items: ["SSO", "API access", "Audit log"] },
			],
			regions: [{ sets: "Pro", members: ["Priority support"] }],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.sets).toEqual([
			{ id: "Basic", label: "Basic" },
			{ id: "Pro", label: "Pro" },
		]);
		expect(built.normalizedSpec.regions).toEqual([
			{ sets: ["Pro"], items: ["Priority support", "Audit log"] },
			{ sets: ["Basic", "Pro"], items: ["SSO", "API access"] },
		]);
	});

	it("keeps each set's circles and texts through a patch", async () => {
		const built = await build(phonesSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["venn:set:0"] },
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
		expect(scene.elements.find((element) => element.id === "node:venn:set:0")).toMatchObject({
			strokeColor: "#1f44c9",
			rendererRole: "venn-set",
		});
		expect(scene.elements.find((element) => element.id === "node:venn:set:0:fill")).toMatchObject({
			rendererRole: "venn-set",
			opacity: 22,
		});
		const excalidraw = inline(patched).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		// No circle grows a generated label, so each label is drawn once.
		expect(
			excalidraw.elements.filter((element) => element.type === "text" && element["text"] === "iOS"),
		).toHaveLength(1);
	});

	it("round-trips canonical diagrams through their Code Mode documents", async () => {
		for (const diagram of [vennFixture, vennStressFixtures.counts, vennStressFixtures.empty]) {
			const document = canonicalDocumentFromDiagram(diagram);
			expect(document.type).toBe("venn");
			const built = await build(document.spec);
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.sets).toEqual(diagram.sets);
			expect(built.normalizedSpec.regions).toEqual(diagram.regions);
		}
	});

	it.each([
		[{ sets: [{ id: "a", label: "A" }] }, "invalid_venn_set"],
		[
			{
				sets: ["a", "b", "c", "d"].map((id) => ({ id, label: id })),
				regions: [],
			},
			"invalid_venn_set",
		],
		[
			{ sets: [...phonesSpec.sets, { id: "web", label: "Web", color: "plaid" }], regions: [] },
			"invalid_venn_set",
		],
		[{ sets: [...phonesSpec.sets, { id: "ios", label: "Web" }] }, "duplicate_node_id"],
		[{ regions: [{ sets: ["ios", "web"], items: ["Push"] }] }, "invalid_venn_region"],
		[
			{
				regions: [
					{ sets: ["ios", "android"], items: ["Push"] },
					{ sets: ["android", "ios"], items: ["Maps"] },
				],
			},
			"invalid_venn_region",
		],
		[{ regions: [{ sets: ["ios"], items: ["Push"], count: 2 }] }, "invalid_venn_region"],
		[{ regions: [{ sets: ["ios"], items: ["x".repeat(61)] }] }, "label_too_long"],
		[
			{
				regions: [
					{ sets: ["ios"], items: Array.from({ length: 13 }, (_, index) => `Item ${index}`) },
				],
			},
			"venn_too_large",
		],
	])("rejects %j with a structured repair issue", async (change, code) => {
		const result = await build({ ...phonesSpec, ...change });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_venn_diagram");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.ref?.path?.startsWith("spec."))).toBe(
			true,
		);
	});

	it("builds a lone region object, and rejects a malformed regions value before building", async () => {
		const lone = await build({ ...phonesSpec, regions: { sets: ["ios"], items: ["Apple Pay"] } });
		if (!lone.ok) throw new Error(JSON.stringify(lone.issues));
		expect(lone.normalizedSpec.regions).toEqual([{ sets: ["ios"], items: ["Apple Pay"] }]);
		for (const regions of ["Apple Pay", null]) {
			const result = await build({ ...phonesSpec, regions });
			expect(result.ok, String(regions)).toBe(false);
			expect(result.status).toBe("invalid_input");
		}
	});

	it("renders an authored line break, and rejects an inherited palette name with a hint", async () => {
		const breaks = await build({
			...phonesSpec,
			regions: [{ sets: ["ios"], items: ["Live\nActivities"] }],
		});
		expect(breaks.ok, JSON.stringify(breaks.issues)).toBe(true);
		const inherited = await build({
			...phonesSpec,
			sets: [{ id: "ios", label: "iOS", color: "constructor" }, phonesSpec.sets[1]],
		});
		expect(inherited.status).toBe("invalid_venn_diagram");
		expect(inherited.issues.map((issue) => issue.code)).toEqual(["invalid_venn_set"]);
	});

	it("rejects a region without sets before building, naming the field", async () => {
		const result = await build({ ...phonesSpec, regions: [{ items: ["Push"] }] });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(JSON.stringify(result.issues)).toContain("sets");
	});
});
