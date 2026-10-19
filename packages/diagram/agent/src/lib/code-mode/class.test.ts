import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { classFixture } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildClassDiagramResultSchema } from "./contract.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { applyDiagramPatch, buildClassDiagram, CodeModeRuntimeEnvironment } from "./runtime.js";

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
		buildClassDiagram({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}),
	);
}

/** The documented example: one-line members, relationship ids omitted. */
const shapesSpec = {
	title: "Shapes",
	classes: [
		{
			id: "Shape",
			kind: "abstract",
			attributes: ["# x: double"],
			methods: ["+ area(): double {abstract}"],
		},
		{ id: "Circle", attributes: ["- radius: double"], methods: ["+ area(): double"] },
		{ id: "Canvas", methods: ["+ add(s: Shape): void"] },
	],
	relationships: [
		{ kind: "inheritance", from: "Circle", to: "Shape" },
		{
			kind: "aggregation",
			from: "Canvas",
			to: "Shape",
			fromMultiplicity: "1",
			toMultiplicity: "0..*",
			toRole: "shapes",
		},
	],
};

describe("Code Mode native class diagram", () => {
	it("builds the documented spec into class boxes and lines with UML heads", async () => {
		const built = await build(shapesSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(BuildClassDiagramResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec.classes[0]).toEqual({
			id: "Shape",
			kind: "abstract",
			attributes: [{ name: "x", type: "double", visibility: "protected" }],
			methods: [
				{ name: "area", params: [], returns: "double", visibility: "public", abstract: true },
			],
		});
		expect(built.normalizedSpec.classes[2]!.methods[0]).toEqual({
			name: "add",
			params: [{ name: "s", type: "Shape" }],
			returns: "void",
			visibility: "public",
		});
		expect(built.normalizedSpec.relationships.map((relationship) => relationship.id)).toEqual([
			"relationship-1",
			"relationship-2",
		]);
		expect(built.quality.summary).toEqual({ nodeCount: 3, edgeCount: 2 });
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(
			excalidraw.elements.find((element) => element.id === "edge:relationship-1"),
		).toMatchObject({
			startArrowhead: null,
			endArrowhead: "triangle_outline",
			strokeStyle: "solid",
			elbowed: true,
		});
		expect(
			excalidraw.elements.find((element) => element.id === "edge:relationship-2"),
		).toMatchObject({
			startArrowhead: "diamond_outline",
			endArrowhead: null,
			elbowed: true,
		});
		// Every element of a class moves together, its end labels with it.
		const shape = excalidraw.elements.filter((element) =>
			(element["groupIds"] as string[]).includes("class:Shape"),
		);
		expect(shape.map((element) => element.id).sort()).toEqual([
			"label:Shape:name",
			"node:Shape",
			"node:Shape:methods",
			"node:Shape:name",
			"relationship:relationship-2:to:multiplicity",
			"relationship:relationship-2:to:role",
			"text:Shape:attributes",
			"text:Shape:methods",
		]);
		expect(excalidraw.elements.find((element) => element.id === "label:Shape:name")).toMatchObject({
			text: "«abstract»\nShape",
		});
	});

	it("reads kind and multiplicity aliases, source/target, visibility words and enum values", async () => {
		const built = await build({
			title: "Payments",
			classes: [
				{
					id: "Payment",
					kind: "Abstract",
					attributes: [{ name: "amount", type: "Money", visibility: "-" }],
					methods: [{ name: "pay", parameters: ["card: Card"], returnType: "bool" }],
				},
				{ id: "Card" },
				{ id: "Status", values: ["PENDING", "PAID"] },
			],
			relationships: [
				{ source: "Card", target: "Payment", type: "extends" },
				{ from: "Payment", to: "Status", kind: "association", toMultiplicity: "one or more" },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.classes[0]).toMatchObject({
			kind: "abstract",
			attributes: [{ name: "amount", type: "Money", visibility: "private" }],
			methods: [{ name: "pay", params: [{ name: "card", type: "Card" }], returns: "bool" }],
		});
		expect(built.normalizedSpec.classes[2]).toMatchObject({
			kind: "enum",
			attributes: [{ name: "PENDING" }, { name: "PAID" }],
		});
		expect(built.normalizedSpec.relationships).toMatchObject([
			{ kind: "inheritance", from: "Card", to: "Payment" },
			{ kind: "association", toMultiplicity: "1..*" },
		]);
	});

	it("assigns omitted relationship ids clear of explicit ones", async () => {
		const built = await build({
			...shapesSpec,
			relationships: [
				shapesSpec.relationships[0],
				{ ...shapesSpec.relationships[1], id: "relationship-1" },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.relationships.map((relationship) => relationship.id)).toEqual([
			"relationship-2",
			"relationship-1",
		]);
	});

	it("keeps class box roles through a patch, with no name drawn in a box's middle", async () => {
		const built = await build(shapesSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{ op: "setStyle", selector: { nodeIds: ["Circle"] }, style: { strokeColor: "#1f44c9" } },
				],
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene", "excalidraw"],
				},
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const formats = new Map(
			patched.artifact.formats.map((format) => [format.format, format.inline]),
		);
		const scene = formats.get("scene") as RenderedDiagramScene;
		const roles = new Set(
			scene.elements.flatMap((element) => (element.type === "node" ? [element.rendererRole] : [])),
		);
		expect([...roles]).toEqual(["class-box"]);
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		// Only the name band carries the class's name.
		expect(
			excalidraw.elements.filter(
				(element) => element.type === "text" && element["text"] === "Circle",
			),
		).toHaveLength(1);
	});

	it("round-trips canonical diagrams through their Code Mode documents", async () => {
		const document = canonicalDocumentFromDiagram(classFixture);
		expect(document.type).toBe("class");
		const built = await build(document.spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.classes).toEqual(classFixture.classes);
		expect(built.normalizedSpec.relationships).toEqual(classFixture.relationships);
	});

	it.each([
		[
			{ relationships: [{ kind: "association", from: "Circle", to: "Ghost" }] },
			"missing_edge_target",
		],
		[
			{ relationships: [{ kind: "association", from: "Ghost", to: "Circle" }] },
			"missing_edge_source",
		],
		[
			{
				relationships: [
					{ kind: "inheritance", from: "Circle", to: "Shape" },
					{ kind: "inheritance", from: "Shape", to: "Circle" },
				],
			},
			"invalid_generalization",
		],
		[
			{ relationships: [{ kind: "realization", from: "Circle", to: "Shape" }] },
			"invalid_generalization",
		],
		[
			{
				relationships: [{ kind: "inheritance", from: "Circle", to: "Shape", toMultiplicity: "1" }],
			},
			"invalid_relationship",
		],
		[
			{
				relationships: [
					{ kind: "association", from: "Circle", to: "Shape", toMultiplicity: "few" },
				],
			},
			"invalid_relationship",
		],
		[{ classes: [{ id: "Line Item" }], relationships: [] }, "invalid_class"],
		[
			{ classes: [{ id: "A", attributes: ["- x: int", "+ x: double"] }], relationships: [] },
			"invalid_member",
		],
	])("rejects %j with a structured repair issue", async (change, code) => {
		const result = await build({ ...shapesSpec, ...change });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_class_diagram");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.ref?.path?.startsWith("spec."))).toBe(
			true,
		);
	});

	it("rejects an unknown relationship kind before building, naming the allowed values", async () => {
		const result = await build({
			...shapesSpec,
			relationships: [{ kind: "owns", from: "Canvas", to: "Shape" }],
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(JSON.stringify(result.issues)).toContain("composition");
	});
});
