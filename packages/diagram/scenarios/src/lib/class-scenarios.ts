import {
	type ClassDiagram,
	type ClassKind,
	type ClassNode,
	type ClassRelationshipKind,
	type ClassVisibility,
	classAttributeText,
	classKeywordLine,
	classMethodText,
	classNodeKind,
	classNodeName,
	estimateTextWidth,
	parseClassAttributeShorthand,
	parseClassDiagram,
	parseClassMethodShorthand,
	resolveClassMultiplicity,
	segmentsFromPoints,
} from "@sketchi/diagram-core";
import { classRelationshipHeads, type RenderedDiagramScene } from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/** An attribute the prompt states: its name, accepted types and the markers it states. */
export interface ClassScenarioAttribute {
	readonly name: string;
	readonly types?: readonly string[];
	readonly visibility?: ClassVisibility;
	readonly static: boolean;
}

/** A method the prompt states: its name, each parameter's accepted types in order, and its return. */
export interface ClassScenarioMethod {
	readonly name: string;
	readonly params: readonly (readonly string[])[];
	readonly returns?: readonly string[];
	readonly visibility?: ClassVisibility;
	readonly static: boolean;
	readonly abstract: boolean;
}

/** A class the prompt names: the names it may go by, its kind and its members. */
export interface ClassScenarioClass {
	readonly names: readonly string[];
	readonly kind: ClassKind;
	readonly attributes: readonly ClassScenarioAttribute[];
	readonly methods: readonly ClassScenarioMethod[];
}

/** A relationship the prompt states between classes by key, with what it states at each end. */
export interface ClassScenarioRelationship {
	readonly kind: ClassRelationshipKind;
	/**
	 * Every kind the prompt allows, `kind` first. Pasted source cannot tell an
	 * association from an aggregation or composition unless the asker says so.
	 */
	readonly kinds?: readonly ClassRelationshipKind[];
	readonly from: string;
	readonly to: string;
	/** Accepted multiplicities at each end, `|`-separated; none when the prompt states none. */
	readonly fromMultiplicity?: string;
	readonly toMultiplicity?: string;
	/** Ends whose multiplicity the prompt leaves open: any multiplicity, or none, passes. */
	readonly open?: readonly ("from" | "to")[];
	readonly fromRole?: string;
	readonly toRole?: string;
	readonly navigable?: boolean;
	/**
	 * A relationship the prompt leaves to the reader, such as a field typed by an
	 * enum: it may be left out, but drawn, it must be one the prompt allows.
	 */
	readonly optional?: boolean;
}

export interface ClassScenario {
	readonly assertions: {
		readonly classes: Readonly<Record<string, ClassScenarioClass>>;
		readonly relationships: readonly ClassScenarioRelationship[];
	};
	readonly description: string;
	readonly diagramType: "class";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: ClassDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/** Names compare without case, spaces or punctuation: `line_item` matches `LineItem`. */
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** Types compare without case or spaces, so `List<Item>` matches `list<item>`. */
const typeKey = (text: string) => text.toLowerCase().replace(/\s+/gu, "");
const typeMatches = (found: string | undefined, accepted: readonly string[]) =>
	found !== undefined && accepted.some((type) => typeKey(type) === typeKey(found));

/** A multiplicity as UML reads it: `0..*` and `*` are one, as are `1..1` and `1`. */
function multiplicityKey(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const resolved = String(resolveClassMultiplicity(value));
	return resolved === "0..*" ? "*" : resolved === "1..1" ? "1" : resolved;
}

function classMatches(node: ClassNode, expected: ClassScenarioClass): boolean {
	const names = new Set([key(node.id), key(classNodeName(node))]);
	return expected.names.some((name) => names.has(key(name)));
}

/** Kinds whose direction carries no meaning: an association may be written either way. */
const UNDIRECTED: ReadonlySet<ClassRelationshipKind> = new Set(["association"]);

/**
 * Class checks score what the prompt states, each on its own: every class and
 * its kind, every attribute with its type, visibility and static marker, every
 * method with its parameter types, return type, visibility and markers, no
 * class or relationship the prompt does not state, and every relationship
 * between the right classes, of the right kind and in the right direction, with
 * the multiplicities, roles and navigability it states at each end.
 */
export function classScenarioChecks(
	scenario: ClassScenario,
	diagram: ClassDiagram,
): ScenarioCheck[] {
	const { classes, relationships } = scenario.assertions;
	const matched = new Map(
		Object.entries(classes).map(([classKey, expected]) => [
			classKey,
			diagram.classes.find((node) => classMatches(node, expected)),
		]),
	);
	const classChecks = Object.entries(classes).flatMap(([classKey, expected]): ScenarioCheck[] => {
		const node = matched.get(classKey);
		const name = expected.names[0]!;
		return [
			{
				id: `class:${classKey}`,
				passed: node !== undefined,
				message: `Expected a class named "${expected.names.join('" or "')}".`,
			},
			{
				id: `kind:${classKey}`,
				passed: node !== undefined && classNodeKind(node) === expected.kind,
				message: `Expected "${name}" to be ${expected.kind === "class" ? "a plain class" : `kind "${expected.kind}"`}${node ? `; found "${classNodeKind(node)}"` : ""}.`,
			},
			...expected.attributes.flatMap((attribute): ScenarioCheck[] => {
				const found = node?.attributes.find(
					(candidate) => key(candidate.name) === key(attribute.name),
				);
				return [
					{
						id: `attribute:${classKey}.${attribute.name}`,
						passed: found !== undefined,
						message: `Expected attribute "${attribute.name}" in "${name}".`,
					},
					...(attribute.types
						? [
								{
									id: `type:${classKey}.${attribute.name}`,
									passed: typeMatches(found?.type, attribute.types),
									message: `Expected "${name}.${attribute.name}" to have type "${attribute.types.join('" or "')}".`,
								},
							]
						: []),
					{
						id: `modifiers:${classKey}.${attribute.name}`,
						passed:
							found !== undefined &&
							(attribute.visibility === undefined || found.visibility === attribute.visibility) &&
							Boolean(found.static) === attribute.static,
						message: `Expected "${name}.${attribute.name}" to be ${attribute.visibility ?? "of any visibility"}${attribute.static ? " and static" : ", not static"}.`,
					},
				];
			}),
			...expected.methods.flatMap((method): ScenarioCheck[] => {
				const found = node?.methods.filter((candidate) => key(candidate.name) === key(method.name));
				const signature = found?.find(
					(candidate) =>
						candidate.params.length === method.params.length &&
						candidate.params.every((param, index) =>
							typeMatches(param.type, method.params[index]!),
						) &&
						(method.returns === undefined || typeMatches(candidate.returns, method.returns)),
				);
				const written = `${method.name}(${method.params.map((types) => types[0]).join(", ")})${method.returns ? `: ${method.returns[0]}` : ""}`;
				return [
					{
						id: `method:${classKey}.${method.name}`,
						passed: (found?.length ?? 0) > 0,
						message: `Expected method "${method.name}" in "${name}".`,
					},
					{
						id: `signature:${classKey}.${method.name}`,
						passed: signature !== undefined,
						message: `Expected "${name}.${written}".`,
					},
					{
						id: `modifiers:${classKey}.${method.name}()`,
						passed:
							signature !== undefined &&
							(method.visibility === undefined || signature.visibility === method.visibility) &&
							Boolean(signature.static) === method.static &&
							Boolean(signature.abstract) === method.abstract,
						message: `Expected "${name}.${method.name}()" to be ${method.visibility ?? "of any visibility"}${method.static ? ", static" : ""}${method.abstract ? ", abstract" : ""}.`,
					},
				];
			}),
		];
	});
	const relationshipChecks = relationships.flatMap((expected, index): ScenarioCheck[] => {
		const [from, to] = [matched.get(expected.from), matched.get(expected.to)];
		const label = `${classes[expected.from]!.names[0]} to ${classes[expected.to]!.names[0]}`;
		// Each relationship joining the two classes, read from the expected `from` end.
		const joined =
			from && to
				? diagram.relationships.flatMap((relationship) => {
						const [a, b] = [relationship.from.trim(), relationship.to.trim()];
						if (a === from.id && b === to.id) return [{ relationship, reversed: false }];
						if (a === to.id && b === from.id) return [{ relationship, reversed: true }];
						return [];
					})
				: [];
		const kinds = expected.kinds ?? [expected.kind];
		const kinded = joined.filter(
			({ relationship, reversed }) =>
				kinds.includes(relationship.kind) && (!reversed || UNDIRECTED.has(relationship.kind)),
		);
		// An optional relationship left out passes every check of its own.
		const absent = expected.optional === true && joined.length === 0;
		const end = (way: (typeof kinded)[number], side: "from" | "to") => {
			const actual = way.reversed ? (side === "from" ? "to" : "from") : side;
			return {
				multiplicity: way.relationship[`${actual}Multiplicity`],
				role: way.relationship[`${actual}Role`],
			};
		};
		const accepted = (side: "from" | "to") =>
			expected[`${side}Multiplicity`]?.split("|").map(multiplicityKey) ?? [undefined];
		const ends = (way: (typeof kinded)[number]) =>
			(["from", "to"] as const).every(
				(side) =>
					expected.open?.includes(side) ||
					accepted(side).includes(multiplicityKey(end(way, side).multiplicity)),
			);
		const roles = (way: (typeof kinded)[number]) =>
			(["from", "to"] as const).every((side) => {
				const role = expected[`${side}Role`];
				return role === undefined || key(end(way, side).role ?? "") === key(role);
			});
		const multiplicities = (["from", "to"] as const).map((side) =>
			expected.open?.includes(side)
				? "any"
				: (expected[`${side}Multiplicity`]?.split("|").join(" or ") ?? "none"),
		);
		const kindText = kinds
			.map((kind) => (kind === "association" ? "an association" : `a ${kind}`))
			.join(" or ");
		return [
			{
				id: `relationship:${index + 1}`,
				passed: joined.length > 0 || absent,
				message: `Expected a relationship from ${label}${expected.optional ? ", or none" : ""}.`,
			},
			{
				id: `relationship-kind:${index + 1}`,
				passed: kinded.length > 0 || absent,
				message: `Expected ${label} to be ${kindText}${kinds.every((kind) => UNDIRECTED.has(kind)) ? "" : ` from ${classes[expected.from]!.names[0]}`}.`,
			},
			...(expected.kind === "inheritance" ||
			expected.kind === "realization" ||
			expected.kind === "dependency"
				? []
				: [
						{
							id: `multiplicity:${index + 1}`,
							passed: kinded.some(ends) || absent,
							message: `Expected ${label} to be ${multiplicities[0]} to ${multiplicities[1]}.`,
						},
					]),
			...(expected.fromRole || expected.toRole
				? [
						{
							id: `role:${index + 1}`,
							passed: kinded.some(roles) || absent,
							message: `Expected ${label} to carry role ${[expected.fromRole, expected.toRole]
								.filter(Boolean)
								.map((role) => `"${role}"`)
								.join(" and ")}.`,
						},
					]
				: []),
			...(expected.navigable !== undefined
				? [
						{
							id: `navigable:${index + 1}`,
							passed:
								absent ||
								kinded.some(
									({ relationship, reversed }) =>
										!reversed && Boolean(relationship.navigable) === expected.navigable,
								),
							message: `Expected ${label} ${expected.navigable ? "to be navigable toward" : "not to be navigable toward"} ${classes[expected.to]!.names[0]}.`,
						},
					]
				: []),
		];
	});
	const expectedCount = Object.keys(classes).length;
	const required = relationships.filter((relationship) => !relationship.optional).length;
	return [
		...classChecks,
		{
			id: "classes-exact",
			passed: diagram.classes.length === expectedCount,
			message: `Expected exactly ${expectedCount} classes; found ${diagram.classes.length}.`,
		},
		...relationshipChecks,
		{
			id: "relationships-exact",
			passed:
				diagram.relationships.length >= required &&
				diagram.relationships.length <= relationships.length,
			message: `Expected exactly ${required === relationships.length ? required : `${required} to ${relationships.length}`} relationships; found ${diagram.relationships.length}.`,
		},
	];
}

/** A drawn end label belongs to its end when it sits this near the end's tip. */
const END_LABEL_REACH = 110;

/**
 * The drawn scene says what the diagram says: each class's name band carries
 * its keyword and name, its compartments list every member as UML writes it,
 * and each relationship's line runs from `from` to `to` with its kind's heads
 * and dashes, its multiplicities and roles drawn beside the right ends.
 */
export function classDrawnCheck(diagram: ClassDiagram, scene: RenderedDiagramScene): ScenarioCheck {
	const texts = new Map(
		scene.elements.flatMap((element) =>
			element.type === "text" ? [[element.id, element] as const] : [],
		),
	);
	const problems: string[] = [];
	for (const node of diagram.classes) {
		const keyword = classKeywordLine(node);
		const name = classNodeName(node).trim();
		if (texts.get(`label:${node.id}:name`)?.text !== (keyword ? `${keyword}\n${name}` : name))
			problems.push(`${node.id} name band`);
		for (const [compartment, lines] of [
			["attributes", node.attributes.map(classAttributeText)],
			["methods", node.methods.map(classMethodText)],
		] as const) {
			const drawn = texts.get(`text:${node.id}:${compartment}`)?.text.split("\n") ?? [];
			if (lines.length > 0 && drawn.join("\n") !== lines.join("\n"))
				problems.push(`${node.id} ${compartment}`);
		}
	}
	for (const relationship of diagram.relationships) {
		const arrow = scene.elements.find(
			(element) => element.type === "arrow" && element.edgeId === relationship.id,
		);
		if (!arrow || arrow.type !== "arrow") {
			problems.push(`${relationship.id} line`);
			continue;
		}
		const heads = classRelationshipHeads(relationship);
		if (
			arrow.sourceNodeId !== relationship.from.trim() ||
			arrow.targetNodeId !== relationship.to.trim() ||
			(arrow.startArrowhead ?? null) !== heads.from ||
			(arrow.endArrowhead ?? null) !== heads.to ||
			(arrow.strokeStyle ?? "solid") !== heads.stroke
		)
			problems.push(`${relationship.id} ${relationship.kind} heads`);
		for (const end of ["from", "to"] as const) {
			const tip = end === "from" ? arrow.points[0] : arrow.points.at(-1)!;
			for (const [suffix, value] of [
				["multiplicity", relationship[`${end}Multiplicity`]],
				["role", relationship[`${end}Role`]],
			] as const) {
				if (value === undefined) continue;
				const text = texts.get(`relationship:${relationship.id}:${end}:${suffix}`);
				if (
					!text ||
					text.text !== value.trim() ||
					Math.hypot(text.x - tip.x, text.y - tip.y) > END_LABEL_REACH
				)
					problems.push(`${relationship.id} ${end} ${suffix}`);
			}
		}
		if (
			relationship.label &&
			texts.get(`relationship:${relationship.id}:name`)?.text !== relationship.label.trim()
		)
			problems.push(`${relationship.id} name`);
	}
	return {
		id: "class-drawn",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every class, member, head, multiplicity and role is drawn as the diagram states."
				: `Drawn differently from the diagram: ${problems.slice(0, 8).join(", ")}.`,
	};
}

/**
 * Every multiplicity, role and relationship name stands clear: of every class
 * box, of every line and of every other label.
 */
export function classClearanceCheck(scene: RenderedDiagramScene): ScenarioCheck {
	const boxes = scene.elements.flatMap((element) =>
		element.type === "node" && element.kind === "class" ? [element] : [],
	);
	// A class's name is bound to its band; every relationship's labels carry its namespace.
	const labels = scene.elements.flatMap((element) =>
		element.type === "text" &&
		element.containerId === undefined &&
		element.id.startsWith("relationship:")
			? [element]
			: [],
	);
	const rects = labels.map((label) => {
		const width = estimateTextWidth(label.text, label.fontSize);
		const height = label.text.split("\n").length * label.fontSize * 1.35;
		return {
			id: label.id,
			left: label.x - width / 2,
			right: label.x + width / 2,
			top: label.y - height / 2,
			bottom: label.y + height / 2,
		};
	});
	const segments = scene.elements.flatMap((element) =>
		element.type === "arrow"
			? segmentsFromPoints(element.points).map((segment) => ({ segment, id: element.id }))
			: [],
	);
	const problems: string[] = [];
	for (const [index, rect] of rects.entries()) {
		for (const box of boxes)
			if (
				rect.left < box.x + box.width &&
				box.x < rect.right &&
				rect.top < box.y + box.height &&
				box.y < rect.bottom
			)
				problems.push(`${rect.id} on ${box.nodeId}`);
		for (const { segment, id } of segments) {
			const crosses =
				segment.orientation === "horizontal"
					? segment.staticCoordinate > rect.top &&
						segment.staticCoordinate < rect.bottom &&
						segment.max > rect.left &&
						segment.min < rect.right
					: segment.staticCoordinate > rect.left &&
						segment.staticCoordinate < rect.right &&
						segment.max > rect.top &&
						segment.min < rect.bottom;
			if (crosses) problems.push(`${rect.id} on ${id}`);
		}
		for (const other of rects.slice(index + 1))
			if (
				rect.left < other.right &&
				other.left < rect.right &&
				rect.top < other.bottom &&
				other.top < rect.bottom
			)
				problems.push(`${rect.id} on ${other.id}`);
	}
	return {
		id: "class-clearance",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every multiplicity, role and relationship name stands clear of boxes, lines and other labels."
				: `Labels collide: ${problems.slice(0, 8).join(", ")}.`,
	};
}

type ClassDefinition = readonly [
	key: string,
	names: readonly string[],
	kind: ClassKind,
	/** Members as UML writes them; `a|b` accepts either type. */
	attributes: readonly string[],
	methods: readonly string[],
];
type RelationshipDefinition = readonly [
	/** The fixture's kind, or every kind the prompt allows with the fixture's first. */
	kind: ClassRelationshipKind | readonly [ClassRelationshipKind, ...ClassRelationshipKind[]],
	from: string,
	to: string,
	ends?: Omit<ClassScenarioRelationship, "kind" | "kinds" | "from" | "to"> & {
		readonly label?: string;
	},
];

interface ClassScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly classes: readonly ClassDefinition[];
	readonly relationships: readonly RelationshipDefinition[];
}

function defineClassScenario(definition: ClassScenarioDefinition): ClassScenario {
	const { classes, relationships, ...scenario } = definition;
	const first = (types: string | undefined) => types?.split("|")[0];
	const attributesOf = (lines: readonly string[]) => lines.map(parseClassAttributeShorthand);
	const methodsOf = (lines: readonly string[]) => lines.map(parseClassMethodShorthand);
	return {
		...scenario,
		diagramType: "class",
		logos: [],
		assertions: {
			classes: Object.fromEntries(
				classes.map(([classKey, names, kind, attributes, methods]) => [
					classKey,
					{
						names,
						kind,
						attributes: attributesOf(attributes).map((attribute) => ({
							name: attribute.name,
							...(attribute.type ? { types: attribute.type.split("|") } : {}),
							...(attribute.visibility ? { visibility: attribute.visibility } : {}),
							static: attribute.static === true,
						})),
						methods: methodsOf(methods).map((method) => ({
							name: method.name,
							params: method.params.map((param) => (param.type ?? param.name).split("|")),
							...(method.returns ? { returns: method.returns.split("|") } : {}),
							...(method.visibility ? { visibility: method.visibility } : {}),
							static: method.static === true,
							abstract: method.abstract === true,
						})),
					},
				]),
			),
			relationships: relationships.map(([kind, from, to, ends]) => {
				const { label: _label, ...rest } = ends ?? {};
				return typeof kind === "string"
					? { kind, from, to, ...rest }
					: { kind: kind[0], kinds: kind, from, to, ...rest };
			}),
		},
		expectedDiagram: parseClassDiagram({
			id: definition.id,
			title: definition.title,
			type: "class",
			classes: classes.map(([id, names, kind, attributes, methods]) => ({
				id,
				...(names[0] !== id ? { name: names[0] } : {}),
				...(kind === "class" ? {} : { kind }),
				attributes: attributesOf(attributes).map((attribute) => ({
					...attribute,
					...(attribute.type ? { type: first(attribute.type) } : {}),
				})),
				methods: methodsOf(methods).map((method) => ({
					...method,
					params: method.params.map((param) => ({
						name: param.name,
						...(param.type ? { type: first(param.type) } : {}),
					})),
					...(method.returns ? { returns: first(method.returns) } : {}),
				})),
			})),
			relationships: relationships.map(([kind, from, to, ends], index) => {
				const { open: _open, optional: _optional, ...drawn } = ends ?? {};
				return {
					id: `r${index + 1}`,
					kind: typeof kind === "string" ? kind : kind[0],
					from,
					to,
					...drawn,
					...(drawn.fromMultiplicity
						? { fromMultiplicity: drawn.fromMultiplicity.split("|")[0]! }
						: {}),
					...(drawn.toMultiplicity ? { toMultiplicity: drawn.toMultiplicity.split("|")[0]! } : {}),
				};
			}),
		}),
	};
}

const classScenarioDefinitions: readonly ClassScenarioDefinition[] = [
	{
		id: "shape-hierarchy-class-v2",
		title: "Shape hierarchy",
		difficulty: "smoke",
		tags: ["class", "inheritance", "interface", "abstract", "aggregation", "real-voice"],
		description:
			"An interface every shape implements through an abstract base, two concrete shapes, a square that refines the rectangle, and a canvas that aggregates shapes.",
		prompt: [
			"class diagram of our shape lib",
			"",
			"interface Drawable {",
			"  draw(ctx: Canvas): void;",
			"}",
			"",
			"abstract class Shape implements Drawable {",
			"  protected x: number;",
			"  protected y: number;",
			"  abstract area(): number;",
			"  moveTo(x: number, y: number): void { ... }",
			"}",
			"",
			"class Circle extends Shape {",
			"  private radius: number;",
			"  area(): number { ... }",
			"}",
			"",
			"class Rectangle extends Shape {",
			"  private width: number;",
			"  private height: number;",
			"  area(): number { ... }",
			"}",
			"",
			"class Square extends Rectangle {",
			"  static of(side: number): Square { ... }",
			"}",
			"",
			"class Canvas {",
			"  static MAX_SHAPES: number = 500;",
			"  shapes: Shape[] = [];",
			"  add(shape: Shape): void { ... }",
			"}",
		].join("\n"),
		// Types follow the pasted TypeScript: `number`, not `double` or `int`.
		classes: [
			["Drawable", ["Drawable"], "interface", [], ["+ draw(ctx: Canvas): void"]],
			[
				"Shape",
				["Shape"],
				"abstract",
				["# x: number", "# y: number"],
				["+ area(): number {abstract}", "+ moveTo(x: number, y: number): void"],
			],
			["Circle", ["Circle"], "class", ["- radius: number"], ["+ area(): number"]],
			[
				"Rectangle",
				["Rectangle"],
				"class",
				["- width: number", "- height: number"],
				["+ area(): number"],
			],
			["Square", ["Square"], "class", [], ["+ of(side: number): Square {static}"]],
			[
				"Canvas",
				["Canvas"],
				"class",
				["+ MAX_SHAPES: number {static}"],
				["+ add(shape: Shape): void"],
			],
		],
		relationships: [
			["realization", "Shape", "Drawable"],
			["inheritance", "Circle", "Shape"],
			["inheritance", "Rectangle", "Shape"],
			["inheritance", "Square", "Rectangle"],
			// `shapes: Shape[]` is the relationship by its role, listed as an
			// attribute or not; the source cannot say its kind or the canvas end.
			[
				["aggregation", "association", "composition"],
				"Canvas",
				"Shape",
				{ fromMultiplicity: "1", toMultiplicity: "0..*", toRole: "shapes", open: ["from"] },
			],
		],
	},
	{
		id: "online-shop-domain-class-v2",
		title: "Online shop domain",
		difficulty: "standard",
		tags: [
			"class",
			"domain-model",
			"composition",
			"aggregation",
			"multiplicity",
			"enum",
			"real-voice",
		],
		description:
			"A shop's domain model: customers with addresses place orders composed of line items for products, paid by one of two payment kinds, with an order status enum.",
		prompt: [
			"class diagram of our shop domain. an order is composed of its line items and a customer aggregates their addresses; every order has at least one item and every customer at least one address",
			"",
			"public class Customer {",
			"    private UUID id;",
			"    private String name;",
			"    private String email;",
			"    private List<Address> addresses;",
			"    private List<Order> orders;",
			"    public Order placeOrder(Cart cart) { ... }",
			"}",
			"",
			"public class Address {",
			"    private String street;",
			"    private String city;",
			"    private String postcode;",
			"}",
			"",
			"public class Order {",
			"    private UUID id;",
			"    private Instant placedAt;",
			"    private OrderStatus status;",
			"    private List<LineItem> items;",
			"    private Payment payment;",
			"    public Money total() { ... }",
			"    public void cancel() { ... }",
			"}",
			"",
			"public class LineItem {",
			"    private int quantity;",
			"    private Money unitPrice;",
			"    private Product product;",
			"    public Money subtotal() { ... }",
			"}",
			"",
			"public class Product {",
			"    private String sku;",
			"    private String name;",
			"    private Money price;",
			"}",
			"",
			"public abstract class Payment {",
			"    protected Money amount;",
			"    protected Instant paidAt;",
			"    public abstract boolean authorize();",
			"}",
			"",
			"public class CardPayment extends Payment {",
			"    private String cardLast4;",
			"    public boolean authorize() { ... }",
			"}",
			"",
			"public class BankTransfer extends Payment {",
			"    private String iban;",
			"    public boolean authorize() { ... }",
			"}",
			"",
			"public enum OrderStatus { PENDING, PAID, SHIPPED, CANCELLED }",
		].join("\n"),
		// Types follow the pasted Java (`Instant`, not `DateTime`). Each field typed
		// by a class is a relationship navigable from the class that holds it; the
		// asker states composition, aggregation and the at-least-one ends, a single
		// reference reads as 1 or 0..1, and the end that holds no field stays open.
		classes: [
			[
				"Customer",
				["Customer"],
				"class",
				["- id: UUID", "- name: String", "- email: String"],
				["+ placeOrder(cart: Cart): Order"],
			],
			[
				"Address",
				["Address"],
				"class",
				["- street: String", "- city: String", "- postcode: String"],
				[],
			],
			[
				"Order",
				["Order"],
				"class",
				["- id: UUID", "- placedAt: Instant", "- status: OrderStatus"],
				["+ total(): Money", "+ cancel(): void"],
			],
			[
				"LineItem",
				["LineItem", "Line item"],
				"class",
				["- quantity: int|integer", "- unitPrice: Money"],
				["+ subtotal(): Money"],
			],
			["Product", ["Product"], "class", ["- sku: String", "- name: String", "- price: Money"], []],
			[
				"Payment",
				["Payment"],
				"abstract",
				["# amount: Money", "# paidAt: Instant"],
				["+ authorize(): boolean|bool {abstract}"],
			],
			[
				"CardPayment",
				["CardPayment", "Card payment"],
				"class",
				["- cardLast4: String"],
				["+ authorize(): boolean|bool"],
			],
			[
				"BankTransfer",
				["BankTransfer", "Bank transfer"],
				"class",
				["- iban: String"],
				["+ authorize(): boolean|bool"],
			],
			[
				"OrderStatus",
				["OrderStatus", "Order status"],
				"enum",
				["PENDING", "PAID", "SHIPPED", "CANCELLED"],
				[],
			],
		],
		relationships: [
			[
				"association",
				"Customer",
				"Order",
				{ fromMultiplicity: "1", toMultiplicity: "0..*", navigable: true, open: ["from"] },
			],
			[
				"aggregation",
				"Customer",
				"Address",
				{ fromMultiplicity: "1", toMultiplicity: "1..*", toRole: "addresses", open: ["from"] },
			],
			[
				"composition",
				"Order",
				"LineItem",
				{ fromMultiplicity: "1", toMultiplicity: "1..*", toRole: "items", open: ["from"] },
			],
			[
				"association",
				"LineItem",
				"Product",
				{ fromMultiplicity: "*", toMultiplicity: "1|0..1", navigable: true, open: ["from"] },
			],
			[
				"association",
				"Order",
				"Payment",
				{ fromMultiplicity: "1", toMultiplicity: "0..1|1", open: ["from"] },
			],
			["inheritance", "CardPayment", "Payment"],
			["inheritance", "BankTransfer", "Payment"],
			// `status: OrderStatus` may stay an attribute type or also draw its line.
			[
				["dependency", "association"],
				"Order",
				"OrderStatus",
				{ optional: true, open: ["from", "to"] },
			],
		],
	},
	{
		id: "observer-pattern-class-v2",
		title: "Observer pattern",
		difficulty: "standard",
		tags: ["class", "design-pattern", "interface", "realization", "dependency", "real-voice"],
		description:
			"The observer pattern: a weather station implements a subject interface that notifies observers, and two displays implement the observer interface.",
		prompt: [
			"class diagram of the observer setup in our weather app",
			"",
			"public interface Subject {",
			"    void attach(Observer o);",
			"    void detach(Observer o);",
			"    void notifyObservers();",
			"}",
			"",
			"public interface Observer {",
			"    void update(Subject subject);",
			"}",
			"",
			"public class WeatherStation implements Subject {",
			"    private double temperature;",
			"    private double humidity;",
			"    private List<Observer> observers;",
			"    public void attach(Observer o) { ... }",
			"    public void detach(Observer o) { ... }",
			"    public void notifyObservers() { ... }",
			"    public void setMeasurements(double t, double h) { ... }",
			"    public double getTemperature() { ... }",
			"}",
			"",
			"public class PhoneDisplay implements Observer {",
			"    private double lastReading;",
			"    public void update(Subject subject) {",
			"        lastReading = ((WeatherStation) subject).getTemperature();",
			"    }",
			"}",
			"",
			"public class WindowDisplay implements Observer {",
			"    public void update(Subject subject) { ... }",
			"}",
		].join("\n"),
		// The pasted Java keeps the observer list on WeatherStation, not on the
		// Subject interface, and adds the getter the phone display's cast reads.
		classes: [
			[
				"Subject",
				["Subject"],
				"interface",
				[],
				["+ attach(o: Observer): void", "+ detach(o: Observer): void", "+ notifyObservers(): void"],
			],
			["Observer", ["Observer"], "interface", [], ["+ update(subject: Subject): void"]],
			[
				"WeatherStation",
				["WeatherStation", "Weather station"],
				"class",
				["- temperature: double", "- humidity: double"],
				[
					"+ attach(o: Observer): void",
					"+ detach(o: Observer): void",
					"+ notifyObservers(): void",
					"+ setMeasurements(t: double, h: double): void",
					"+ getTemperature(): double",
				],
			],
			[
				"PhoneDisplay",
				["PhoneDisplay", "Phone display"],
				"class",
				["- lastReading: double"],
				["+ update(subject: Subject): void"],
			],
			[
				"WindowDisplay",
				["WindowDisplay", "Window display"],
				"class",
				[],
				["+ update(subject: Subject): void"],
			],
		],
		relationships: [
			[
				"association",
				"WeatherStation",
				"Observer",
				// The Java cannot state the station end: any multiplicity, or none.
				{ toMultiplicity: "0..*", toRole: "observers", navigable: true, open: ["from"] },
			],
			["realization", "WeatherStation", "Subject"],
			["realization", "PhoneDisplay", "Observer"],
			["realization", "WindowDisplay", "Observer"],
			["dependency", "PhoneDisplay", "WeatherStation"],
		],
	},
	{
		id: "library-system-class-v2",
		title: "Library system",
		difficulty: "challenge",
		tags: ["class", "large", "inheritance", "composition", "multiplicity", "real-voice"],
		description:
			"A fifteen-class library system: items in a catalog with three subclasses, members of two kinds who borrow and reserve items, loans with fines, and librarians at branches.",
		prompt: [
			"class diagram of our library system. a library is composed of its branches (at least one) and its catalog, and a loan of its fine; the catalog aggregates items. every book has at least one author",
			"",
			"public class Library {",
			"    private String name;",
			"    private List<Branch> branches;",
			"    private Catalog catalog;",
			"    public List<Item> search(String query) { ... }",
			"}",
			"",
			"public class Branch {",
			"    private String address;",
			"}",
			"",
			"public class Catalog {",
			"    private List<Item> items;",
			"    public void add(Item item) { ... }",
			"    public Book find(String isbn) { ... }",
			"}",
			"",
			"public abstract class Item {",
			"    protected UUID id;",
			"    protected String title;",
			"    public abstract int loanPeriod();",
			"}",
			"",
			"public class Book extends Item {",
			"    private String isbn;",
			"    private int pages;",
			"    private List<Author> authors;",
			"    public int loanPeriod() { ... }",
			"}",
			"",
			"public class DVD extends Item {",
			"    private int minutes;",
			"    public int loanPeriod() { ... }",
			"}",
			"",
			"public class Magazine extends Item {",
			"    private int issue;",
			"    public int loanPeriod() { ... }",
			"}",
			"",
			"public class Author {",
			"    private String name;",
			"    private List<Book> books;",
			"}",
			"",
			"public class Member {",
			"    private String memberId;",
			"    private String name;",
			"    private List<Loan> loans;",
			"    private List<Reservation> reservations;",
			"    public Loan borrow(Item item) { ... }",
			"    public Reservation reserve(Item item) { ... }",
			"}",
			"",
			"public class StudentMember extends Member {",
			"    private String school;",
			"}",
			"",
			"public class StaffMember extends Member {",
			"    private String department;",
			"}",
			"",
			"public class Loan {",
			"    private Date due;",
			"    private Date returned;",
			"    private Item item;",
			"    private Fine fine;",
			"    public boolean isOverdue() { ... }",
			"}",
			"",
			"public class Reservation {",
			"    private Date placed;",
			"    private Item item;",
			"}",
			"",
			"public class Fine {",
			"    private Money amount;",
			"    public void pay() { ... }",
			"}",
			"",
			"public class Librarian {",
			"    private String staffId;",
			"    private Branch branch;",
			"    public void checkOut(Loan loan) { ... }",
			"}",
		].join("\n"),
		// As in the shop: each field typed by a class is a relationship from the
		// class that holds it, the asker states the compositions, the aggregation
		// and the at-least-one ends, a single reference reads as 1 or 0..1, and an
		// end that holds no field stays open. `checkOut(loan: Loan)` only uses a
		// loan, so its dependency may be drawn or left out.
		classes: [
			[
				"Library",
				["Library"],
				"class",
				["- name: String"],
				["+ search(query: String): List<Item>"],
			],
			["Branch", ["Branch"], "class", ["- address: String"], []],
			[
				"Catalog",
				["Catalog"],
				"class",
				[],
				["+ add(item: Item): void", "+ find(isbn: String): Book"],
			],
			[
				"Item",
				["Item"],
				"abstract",
				["# id: UUID", "# title: String"],
				["+ loanPeriod(): int|integer {abstract}"],
			],
			[
				"Book",
				["Book"],
				"class",
				["- isbn: String", "- pages: int|integer"],
				["+ loanPeriod(): int|integer"],
			],
			["DVD", ["DVD", "Dvd"], "class", ["- minutes: int|integer"], ["+ loanPeriod(): int|integer"]],
			[
				"Magazine",
				["Magazine"],
				"class",
				["- issue: int|integer"],
				["+ loanPeriod(): int|integer"],
			],
			["Author", ["Author"], "class", ["- name: String"], []],
			[
				"Member",
				["Member"],
				"class",
				["- memberId: String", "- name: String"],
				["+ borrow(item: Item): Loan", "+ reserve(item: Item): Reservation"],
			],
			["StudentMember", ["StudentMember", "Student member"], "class", ["- school: String"], []],
			["StaffMember", ["StaffMember", "Staff member"], "class", ["- department: String"], []],
			[
				"Loan",
				["Loan"],
				"class",
				["- due: Date", "- returned: Date"],
				["+ isOverdue(): boolean|bool"],
			],
			["Reservation", ["Reservation"], "class", ["- placed: Date"], []],
			["Fine", ["Fine"], "class", ["- amount: Money"], ["+ pay(): void"]],
			[
				"Librarian",
				["Librarian"],
				"class",
				["- staffId: String"],
				["+ checkOut(loan: Loan): void"],
			],
		],
		relationships: [
			[
				"composition",
				"Library",
				"Branch",
				{ fromMultiplicity: "1", toMultiplicity: "1..*", open: ["from"] },
			],
			[
				"composition",
				"Library",
				"Catalog",
				{ fromMultiplicity: "1", toMultiplicity: "1|0..1", open: ["from"] },
			],
			[
				"aggregation",
				"Catalog",
				"Item",
				{ fromMultiplicity: "1", toMultiplicity: "0..*", toRole: "items", open: ["from"] },
			],
			["inheritance", "Book", "Item"],
			["inheritance", "DVD", "Item"],
			["inheritance", "Magazine", "Item"],
			[
				"association",
				"Book",
				"Author",
				{ fromMultiplicity: "*", toMultiplicity: "1..*", toRole: "authors" },
			],
			["inheritance", "StudentMember", "Member"],
			["inheritance", "StaffMember", "Member"],
			[
				"association",
				"Member",
				"Loan",
				{ fromMultiplicity: "1", toMultiplicity: "0..*", navigable: true, open: ["from"] },
			],
			[
				"association",
				"Loan",
				"Item",
				{ fromMultiplicity: "*", toMultiplicity: "1|0..1", navigable: true, open: ["from"] },
			],
			[
				"association",
				"Member",
				"Reservation",
				{ fromMultiplicity: "1", toMultiplicity: "0..*", open: ["from"] },
			],
			[
				"association",
				"Reservation",
				"Item",
				{ fromMultiplicity: "*", toMultiplicity: "1|0..1", open: ["from"] },
			],
			[
				"composition",
				"Loan",
				"Fine",
				{ fromMultiplicity: "1", toMultiplicity: "0..1|1", open: ["from"] },
			],
			["dependency", "Librarian", "Loan", { optional: true }],
			[
				"association",
				"Librarian",
				"Branch",
				{ fromMultiplicity: "*", toMultiplicity: "1|0..1", open: ["from"] },
			],
		],
	},
];

export const classScenarios: readonly ClassScenario[] =
	classScenarioDefinitions.map(defineClassScenario);
