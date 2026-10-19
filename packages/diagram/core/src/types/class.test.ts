import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import {
	type ClassDiagram,
	classAttributeText,
	classDiagramType,
	classFixture,
	classKeywordLine,
	classMethodText,
	getClassValidationIssues,
	isClassMultiplicity,
	parseClassAttributeShorthand,
	parseClassDiagram,
	parseClassMethodShorthand,
	resolveClassMultiplicity,
	resolveClassShorthand,
} from "./class";

const codes = (input: Partial<ClassDiagram>) =>
	getClassValidationIssues({ ...classFixture, ...input }).map((issue) => issue.code);
const node = (
	id: string,
	extra: Record<string, unknown> = {},
): ClassDiagram["classes"][number] => ({
	id,
	attributes: [],
	methods: [],
	...extra,
});
const relation = (
	kind: ClassDiagram["relationships"][number]["kind"],
	from: string,
	to: string,
	extra: Record<string, unknown> = {},
): ClassDiagram["relationships"][number] => ({
	id: `${from}-${kind}-${to}`,
	kind,
	from,
	to,
	...extra,
});

describe("Class diagram type", () => {
	it("has a typed fixture that satisfies the canonical diagram contract", () => {
		expect(classFixture.type).toBe(classDiagramType);
		expect(parseCanonicalDiagram(classFixture)).toEqual(classFixture);
	});

	it("draws members as UML writes them, with visibility, types and markers", () => {
		const [drawable, shape, , , square, canvas] = classFixture.classes;
		expect(shape!.attributes.map(classAttributeText)).toEqual(["# x: double", "# y: double"]);
		expect(shape!.methods.map(classMethodText)).toEqual([
			"+ area(): double {abstract}",
			"+ moveTo(x: double, y: double): void",
		]);
		expect(drawable!.methods.map(classMethodText)).toEqual(["draw(ctx: Canvas): void"]);
		expect(square!.methods.map(classMethodText)).toEqual(["+ of(side: double): Square {static}"]);
		expect(canvas!.attributes.map(classAttributeText)).toEqual(["+ MAX_SHAPES: int {static}"]);
	});

	it("puts a kind's keyword and any stereotype over the name", () => {
		expect(classKeywordLine({ kind: "interface" })).toBe("«interface»");
		expect(classKeywordLine({ kind: "abstract" })).toBe("«abstract»");
		expect(classKeywordLine({ kind: "enum" })).toBe("«enumeration»");
		expect(classKeywordLine({ stereotype: "entity" })).toBe("«entity»");
		expect(classKeywordLine({ kind: "interface", stereotype: "remote" })).toBe(
			"«interface, remote»",
		);
		expect(classKeywordLine({})).toBeUndefined();
	});

	it("reads members written on one line", () => {
		expect(parseClassAttributeShorthand("- radius: double")).toEqual({
			name: "radius",
			type: "double",
			visibility: "private",
		});
		expect(parseClassAttributeShorthand("+ count: int {static}")).toEqual({
			name: "count",
			type: "int",
			visibility: "public",
			static: true,
		});
		expect(parseClassAttributeShorthand("protected static id: UUID")).toEqual({
			name: "id",
			type: "UUID",
			visibility: "protected",
			static: true,
		});
		expect(parseClassAttributeShorthand("RED")).toEqual({ name: "RED" });
		expect(parseClassMethodShorthand("+ area(): double")).toEqual({
			name: "area",
			params: [],
			returns: "double",
			visibility: "public",
		});
		expect(
			parseClassMethodShorthand("# render(ctx: Canvas, opts: Map<String, int>): void {abstract}"),
		).toEqual({
			name: "render",
			params: [
				{ name: "ctx", type: "Canvas" },
				{ name: "opts", type: "Map<String, int>" },
			],
			returns: "void",
			visibility: "protected",
			abstract: true,
		});
		expect(parseClassMethodShorthand("~ notify()")).toEqual({
			name: "notify",
			params: [],
			visibility: "package",
		});
		expect(parseClassMethodShorthand("static of(x: int): Point")).toMatchObject({
			name: "of",
			static: true,
		});
	});

	it("reads a parenthesized return type and supplementary-plane characters intact", () => {
		expect(parseClassMethodShorthand("+ make(): (int) => string")).toEqual({
			name: "make",
			params: [],
			returns: "(int) => string",
			visibility: "public",
		});
		expect(parseClassMethodShorthand("+ apply(f: (int) => string, n: int): void")).toMatchObject({
			params: [
				{ name: "f", type: "(int) => string" },
				{ name: "n", type: "int" },
			],
			returns: "void",
		});
		expect(parseClassMethodShorthand("+ run(𐐀: int, b: int): void").params).toEqual([
			{ name: "𐐀", type: "int" },
			{ name: "b", type: "int" },
		]);
	});

	it("resolves multiplicity words and n bounds, and checks what UML accepts", () => {
		expect(resolveClassMultiplicity("many")).toBe("*");
		expect(resolveClassMultiplicity("one or more")).toBe("1..*");
		expect(resolveClassMultiplicity("0..n")).toBe("0..*");
		expect(resolveClassMultiplicity("0 .. 1")).toBe("0..1");
		expect(resolveClassMultiplicity(1)).toBe("1");
		for (const value of ["1", "0..1", "*", "1..*", "0..*", "2..4"])
			expect(isClassMultiplicity(value), value).toBe(true);
		for (const value of ["*..1", "4..2", "few", "1..", ""])
			expect(isClassMultiplicity(value), value).toBe(false);
	});

	it("resolves the shapes models write before decoding", () => {
		const resolved = resolveClassShorthand({
			id: "pay",
			title: "Payments",
			type: "class",
			classes: [
				{
					id: "Payment",
					kind: "Abstract",
					attributes: ["- amount: Money"],
					methods: [
						"+ pay(): bool {abstract}",
						{ name: "refund", parameters: ["why: string"], returnType: "void", visibility: "+" },
					],
				},
				{ id: "Status", values: ["PENDING", "PAID"] },
				{ id: "Card" },
			],
			relationships: [
				{ id: "r1", source: "Card", target: "Payment", type: "extends" },
				{ id: "r2", from: "Payment", to: "Status", kind: "association", toMultiplicity: "one" },
			],
		});
		const diagram = parseClassDiagram(resolved);
		expect(diagram.classes[0]).toMatchObject({
			kind: "abstract",
			attributes: [{ name: "amount", type: "Money", visibility: "private" }],
			methods: [
				{ name: "pay", returns: "bool", abstract: true, visibility: "public" },
				{
					name: "refund",
					params: [{ name: "why", type: "string" }],
					returns: "void",
					visibility: "public",
				},
			],
		});
		expect(diagram.classes[1]).toMatchObject({
			kind: "enum",
			attributes: [{ name: "PENDING" }, { name: "PAID" }],
		});
		expect(diagram.relationships[0]).toMatchObject({
			kind: "inheritance",
			from: "Card",
			to: "Payment",
		});
		expect(diagram.relationships[1]).toMatchObject({ toMultiplicity: "1" });
	});

	it("rejects unknown classes, duplicates and malformed ids", () => {
		const [drawable, shape] = classFixture.classes;
		expect(codes({ relationships: [relation("association", "Shape", "Ghost")] })).toEqual([
			"missing_relationship_class",
		]);
		expect(codes({ classes: [drawable!, { ...drawable! }], relationships: [] })).toEqual([
			"duplicate_class_id",
		]);
		expect(
			codes({
				classes: [drawable!, { ...shape!, id: "Other", name: "drawable" }],
				relationships: [],
			}),
		).toEqual(["duplicate_class_name"]);
		expect(codes({ classes: [node("Line Item")], relationships: [] })).toEqual([
			"invalid_class_id",
		]);
		expect(
			codes({
				classes: [node("A", { attributes: [{ name: "x" }, { name: "X", type: "int" }] })],
				relationships: [],
			}),
		).toEqual(["duplicate_member"]);
		// Overloads differ in their parameters.
		expect(
			codes({
				classes: [
					node("A", {
						methods: [
							{ name: "add", params: [{ name: "x", type: "int" }] },
							{ name: "add", params: [{ name: "x", type: "double" }] },
						],
					}),
				],
				relationships: [],
			}),
		).toEqual([]);
	});

	it("rejects inheritance cycles, interfaces extending classes and realizations of classes", () => {
		expect(
			codes({
				relationships: [
					relation("inheritance", "Circle", "Shape"),
					relation("inheritance", "Shape", "Circle"),
				],
			}),
		).toEqual(["inheritance_cycle"]);
		expect(codes({ relationships: [relation("inheritance", "Shape", "Shape")] })).toEqual([
			"inheritance_cycle",
		]);
		expect(codes({ relationships: [relation("inheritance", "Drawable", "Shape")] })).toEqual([
			"invalid_inheritance",
		]);
		expect(codes({ relationships: [relation("inheritance", "Shape", "Drawable")] })).toEqual([
			"invalid_inheritance",
		]);
		expect(codes({ relationships: [relation("realization", "Circle", "Shape")] })).toEqual([
			"invalid_realization",
		]);
		expect(
			codes({
				relationships: [
					relation("inheritance", "Circle", "Shape"),
					relation("inheritance", "Circle", "Shape"),
				].map((r, at) => ({ ...r, id: `r${at}` })),
			}),
		).toEqual(["invalid_inheritance"]);
	});

	it("keeps multiplicities and roles to the kinds that carry them", () => {
		expect(
			codes({
				relationships: [relation("inheritance", "Circle", "Shape", { toMultiplicity: "1" })],
			}),
		).toEqual(["misplaced_end_label"]);
		expect(
			codes({
				relationships: [relation("dependency", "Circle", "Canvas", { navigable: true })],
			}),
		).toEqual(["misplaced_end_label"]);
		// A whole may navigate to its part: an open arrow at the part's end.
		expect(
			codes({
				relationships: [relation("aggregation", "Canvas", "Circle", { navigable: true })],
			}),
		).toEqual([]);
		expect(
			codes({
				relationships: [relation("association", "Circle", "Canvas", { toMultiplicity: "few" })],
			}),
		).toEqual(["invalid_multiplicity"]);
		expect(
			codes({
				relationships: [relation("composition", "Canvas", "Circle", { fromMultiplicity: "*" })],
			}),
		).toEqual(["invalid_multiplicity"]);
		expect(
			codes({
				relationships: [
					relation("composition", "Canvas", "Circle", {
						fromMultiplicity: "1",
						toMultiplicity: "1..*",
						toRole: "circles",
					}),
				],
			}),
		).toEqual([]);
	});
});
