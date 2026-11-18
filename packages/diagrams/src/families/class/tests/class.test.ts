// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { type CanvasShapeElement, type CanvasSpec } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts";
import { buildClassDiagram } from "../../../build/builds";
import { BuildRuntimeEnvironment } from "../../../build/runtime";
import { buildResponse } from "../../../build/operation";
import { renderDiagram } from "../../../family";
import { classBuild } from "../build";
import {
	CLASS_MAX_CLASSES,
	type ClassDiagram,
	classFixture,
	ClassValidationIssueCodeSchema,
	getClassValidationIssues,
} from "../document";

const storage = makeMemoryArtifactStorage();
function build(spec: unknown) {
	return Effect.runPromise(
		buildClassDiagram({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(
			buildResponse,
			Effect.provideService(BuildRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(ArtifactStorage, storage),
		),
	);
}
type Excalidraw = Parameters<typeof validateExcalidrawScene>[0];
async function excalidrawOf(spec: unknown) {
	const built = await build(spec);
	if (!built.ok) throw new Error(JSON.stringify(built.issues));
	const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
	const excalidraw = formats.get("excalidraw") as Excalidraw;
	expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	return { built, excalidraw };
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

describe("Code Mode class diagram", () => {
	it("builds the documented spec into grouped class boxes with UML members", async () => {
		const { built, excalidraw } = await excalidrawOf(shapesSpec);
		expect(() => Schema.decodeUnknownSync(classBuild.result)(built)).not.toThrow();
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

	it("draws each relationship kind with its UML heads, as elbows bound at fixed points", async () => {
		const { excalidraw } = await excalidrawOf({
			title: "Kinds",
			classes: [
				...["A", "B", "C", "D", "E", "F", "G"].map((id) => ({ id })),
				{ id: "I", kind: "interface" },
			],
			relationships: [
				{ id: "inherit", kind: "inheritance", from: "B", to: "A" },
				{ id: "realize", kind: "realization", from: "C", to: "I" },
				{ id: "compose", kind: "composition", from: "A", to: "D" },
				{ id: "aggregate", kind: "aggregation", from: "A", to: "E" },
				{ id: "associate", kind: "association", from: "D", to: "F" },
				{ id: "navigate", kind: "association", from: "E", to: "G", navigable: true },
				{ id: "depend", kind: "dependency", from: "F", to: "G" },
			],
		});
		const lines = excalidraw.elements.filter((element) => element.id.startsWith("edge:"));
		expect(
			Object.fromEntries(
				lines.map((line) => [
					line.id.slice("edge:".length),
					[line["startArrowhead"], line["endArrowhead"], line["strokeStyle"]],
				]),
			),
		).toEqual({
			inherit: [null, "triangle_outline", "solid"],
			realize: [null, "triangle_outline", "dashed"],
			compose: ["diamond", null, "solid"],
			aggregate: ["diamond_outline", null, "solid"],
			associate: [null, null, "solid"],
			navigate: [null, "arrow", "solid"],
			depend: [null, "arrow", "dashed"],
		});
		// An end keeps its place on its class when the class moves.
		for (const line of lines)
			expect(line, line.id).toMatchObject({
				elbowed: true,
				startBinding: { fixedPoint: expect.any(Array) },
				endBinding: { fixedPoint: expect.any(Array) },
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

	it("stands each superclass above its subclasses, lines from top to bottom", () => {
		const scene = renderDiagram(classFixture).pipe(Result.getOrThrow);
		const box = (id: string) =>
			scene.elements.find(
				(element): element is CanvasShapeElement =>
					element.type === "node" && element.id === `node:${id}`,
			)!;
		const arrow = (id: string) =>
			scene.elements.find(
				(element) => element.type === "arrow" && element.edgeId === id,
			) as Extract<CanvasSpec["elements"][number], { type: "arrow" }>;
		const below = (lower: string, upper: string) =>
			expect(box(upper).y + box(upper).height, `${upper} over ${lower}`).toBeLessThan(box(lower).y);
		below("Shape", "Drawable");
		below("Circle", "Shape");
		below("Square", "Rectangle");
		for (const [id, child, parent] of [
			["circle-is-shape", "Circle", "Shape"],
			["rectangle-is-shape", "Rectangle", "Shape"],
			["square-is-rectangle", "Square", "Rectangle"],
			["shape-draws", "Shape", "Drawable"],
		] as const) {
			const { points } = arrow(id);
			expect(points[0].y, `${id} leaves ${child}'s top`).toBeCloseTo(box(child).y, 2);
			expect(points.at(-1)!.y, `${id} enters ${parent}'s bottom`).toBeCloseTo(
				box(parent).y + box(parent).height,
				2,
			);
		}
	});
});

type Class = ClassDiagram["classes"][number];
type Relationship = ClassDiagram["relationships"][number];
const node = (id: string, extra: Partial<Class> = {}): Class => ({
	id,
	attributes: [],
	methods: [],
	...extra,
});
const withClasses = (...classes: Class[]) => [...classFixture.classes, ...classes];
const relate = (
	kind: Relationship["kind"],
	from: string,
	to: string,
	extra: Partial<Relationship> = {},
): Relationship => ({ id: "extra", kind, from, to, ...extra });
const withRelationships = (...relationships: Relationship[]) => [
	...classFixture.relationships,
	...relationships,
];

/** One minimal bad model per code the validator owns. */
const bad: Record<string, Partial<ClassDiagram>> = {
	class_too_large: {
		classes: withClasses(...Array.from({ length: CLASS_MAX_CLASSES }, (_, at) => node(`C${at}`))),
	},
	invalid_class_id: { classes: withClasses(node("Line Item")) },
	duplicate_class_id: { classes: withClasses(node("Circle")) },
	duplicate_class_name: { classes: withClasses(node("Other", { name: "Circle" })) },
	duplicate_member: {
		classes: withClasses(node("A", { attributes: [{ name: "x" }, { name: "X", type: "int" }] })),
	},
	class_text_too_long: { classes: withClasses(node("Long", { name: "x".repeat(65) })) },
	duplicate_relationship_id: {
		relationships: withRelationships(
			relate("association", "Circle", "Canvas", { id: "canvas-holds" }),
		),
	},
	missing_relationship_class: {
		relationships: withRelationships(relate("association", "Circle", "Ghost")),
	},
	inheritance_cycle: { relationships: withRelationships(relate("inheritance", "Shape", "Shape")) },
	invalid_inheritance: {
		relationships: withRelationships(relate("inheritance", "Drawable", "Shape")),
	},
	invalid_realization: {
		relationships: withRelationships(relate("realization", "Circle", "Canvas")),
	},
	invalid_multiplicity: {
		relationships: withRelationships(
			relate("association", "Circle", "Canvas", { toMultiplicity: "few" }),
		),
	},
	misplaced_end_label: {
		relationships: withRelationships(
			relate("dependency", "Circle", "Canvas", { toMultiplicity: "1" }),
		),
	},
};

describe("Class validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(ClassValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad model", (code, change) => {
		const issues = getClassValidationIssues({ ...classFixture, ...change });
		expect(issues.map((issue) => issue.code)).toContain(code);
	});
});
