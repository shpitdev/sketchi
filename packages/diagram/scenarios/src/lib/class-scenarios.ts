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
	readonly from: string;
	readonly to: string;
	readonly fromMultiplicity?: string;
	readonly toMultiplicity?: string;
	readonly fromRole?: string;
	readonly toRole?: string;
	readonly navigable?: boolean;
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
		const kinded = joined.filter(
			({ relationship, reversed }) =>
				relationship.kind === expected.kind && (!reversed || UNDIRECTED.has(expected.kind)),
		);
		const end = (way: (typeof kinded)[number], side: "from" | "to") => {
			const actual = way.reversed ? (side === "from" ? "to" : "from") : side;
			return {
				multiplicity: way.relationship[`${actual}Multiplicity`],
				role: way.relationship[`${actual}Role`],
			};
		};
		const ends = (way: (typeof kinded)[number]) =>
			(["from", "to"] as const).every(
				(side) =>
					multiplicityKey(end(way, side).multiplicity) ===
					multiplicityKey(expected[`${side}Multiplicity`]),
			);
		const roles = (way: (typeof kinded)[number]) =>
			(["from", "to"] as const).every((side) => {
				const role = expected[`${side}Role`];
				return role === undefined || key(end(way, side).role ?? "") === key(role);
			});
		const multiplicities = [expected.fromMultiplicity ?? "none", expected.toMultiplicity ?? "none"];
		return [
			{
				id: `relationship:${index + 1}`,
				passed: joined.length > 0,
				message: `Expected a relationship from ${label}.`,
			},
			{
				id: `relationship-kind:${index + 1}`,
				passed: kinded.length > 0,
				message: `Expected ${label} to be ${expected.kind === "association" ? "an association" : `a ${expected.kind}`}${UNDIRECTED.has(expected.kind) ? "" : ` from ${classes[expected.from]!.names[0]}`}.`,
			},
			...(expected.kind === "inheritance" ||
			expected.kind === "realization" ||
			expected.kind === "dependency"
				? []
				: [
						{
							id: `multiplicity:${index + 1}`,
							passed: kinded.some(ends),
							message: `Expected ${label} to be ${multiplicities[0]} to ${multiplicities[1]}.`,
						},
					]),
			...(expected.fromRole || expected.toRole
				? [
						{
							id: `role:${index + 1}`,
							passed: kinded.some(roles),
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
							passed: kinded.some(
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
			passed: diagram.relationships.length === relationships.length,
			message: `Expected exactly ${relationships.length} relationships; found ${diagram.relationships.length}.`,
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
	kind: ClassRelationshipKind,
	from: string,
	to: string,
	ends?: Omit<ClassScenarioRelationship, "kind" | "from" | "to"> & { readonly label?: string },
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
				return { kind, from, to, ...rest };
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
			relationships: relationships.map(([kind, from, to, ends], index) => ({
				id: `r${index + 1}`,
				kind,
				from,
				to,
				...ends,
			})),
		}),
	};
}

const classScenarioDefinitions: readonly ClassScenarioDefinition[] = [
	{
		id: "shape-hierarchy-class",
		title: "Shape hierarchy",
		difficulty: "smoke",
		tags: ["class", "inheritance", "interface", "abstract", "aggregation"],
		description:
			"An interface every shape implements through an abstract base, two concrete shapes, a square that refines the rectangle, and a canvas that aggregates shapes.",
		prompt:
			"Draw a UML class diagram of a shape library. Drawable is an interface with one public method draw(ctx: Canvas): void. Shape is an abstract class that implements Drawable; it has protected attributes x: double and y: double, a public abstract method area(): double and a public method moveTo(x: double, y: double): void. Circle extends Shape, with a private attribute radius: double and a public method area(): double. Rectangle extends Shape, with private attributes width: double and height: double and a public method area(): double. Square extends Rectangle and has a public static method of(side: double): Square. Canvas is a class with a public static attribute MAX_SHAPES: int and a public method add(shape: Shape): void. A Canvas aggregates zero or more shapes, which it knows by the role shapes, and each shape belongs to exactly one canvas.",
		classes: [
			["Drawable", ["Drawable"], "interface", [], ["+ draw(ctx: Canvas): void"]],
			[
				"Shape",
				["Shape"],
				"abstract",
				["# x: double", "# y: double"],
				["+ area(): double {abstract}", "+ moveTo(x: double, y: double): void"],
			],
			["Circle", ["Circle"], "class", ["- radius: double"], ["+ area(): double"]],
			[
				"Rectangle",
				["Rectangle"],
				"class",
				["- width: double", "- height: double"],
				["+ area(): double"],
			],
			["Square", ["Square"], "class", [], ["+ of(side: double): Square {static}"]],
			[
				"Canvas",
				["Canvas"],
				"class",
				["+ MAX_SHAPES: int|integer {static}"],
				["+ add(shape: Shape): void"],
			],
		],
		relationships: [
			["realization", "Shape", "Drawable"],
			["inheritance", "Circle", "Shape"],
			["inheritance", "Rectangle", "Shape"],
			["inheritance", "Square", "Rectangle"],
			[
				"aggregation",
				"Canvas",
				"Shape",
				{ fromMultiplicity: "1", toMultiplicity: "0..*", toRole: "shapes" },
			],
		],
	},
	{
		id: "online-shop-domain-class",
		title: "Online shop domain",
		difficulty: "standard",
		tags: ["class", "domain-model", "composition", "aggregation", "multiplicity", "enum"],
		description:
			"A shop's domain model: customers with addresses place orders composed of line items for products, paid by one of two payment kinds, with an order status enum.",
		prompt:
			"Draw a UML class diagram of an online shop's domain model. Customer has private attributes id: UUID, name: String and email: String, and a public method placeOrder(cart: Cart): Order. Address has private attributes street: String, city: String and postcode: String. Order has private attributes id: UUID, placedAt: DateTime and status: OrderStatus, and public methods total(): Money and cancel(): void. LineItem has private attributes quantity: int and unitPrice: Money, and a public method subtotal(): Money. Product has private attributes sku: String, name: String and price: Money. Payment is an abstract class with protected attributes amount: Money and paidAt: DateTime and a public abstract method authorize(): bool. CardPayment and BankTransfer both extend Payment; CardPayment has a private attribute cardLast4: String and BankTransfer a private attribute iban: String, and each has a public method authorize(): bool. OrderStatus is an enumeration with the values PENDING, PAID, SHIPPED and CANCELLED. Relationships: a Customer places zero or more orders, and each order is placed by exactly one customer (an association named places, navigable from Customer to Order). A Customer aggregates one or more addresses, by the role addresses, and each address belongs to exactly one customer. An Order is composed of one or more line items, by the role items, and each line item belongs to exactly one order. Each line item refers to exactly one product, and a product appears in many line items (an association navigable from LineItem to Product). An Order is paid by zero or one payment, and each payment pays exactly one order. Order depends on OrderStatus.",
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
				["- id: UUID", "- placedAt: DateTime", "- status: OrderStatus"],
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
				["# amount: Money", "# paidAt: DateTime"],
				["+ authorize(): bool|boolean {abstract}"],
			],
			[
				"CardPayment",
				["CardPayment", "Card payment"],
				"class",
				["- cardLast4: String"],
				["+ authorize(): bool|boolean"],
			],
			[
				"BankTransfer",
				["BankTransfer", "Bank transfer"],
				"class",
				["- iban: String"],
				["+ authorize(): bool|boolean"],
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
				{ fromMultiplicity: "1", toMultiplicity: "0..*", navigable: true, label: "places" },
			],
			[
				"aggregation",
				"Customer",
				"Address",
				{ fromMultiplicity: "1", toMultiplicity: "1..*", toRole: "addresses" },
			],
			[
				"composition",
				"Order",
				"LineItem",
				{ fromMultiplicity: "1", toMultiplicity: "1..*", toRole: "items" },
			],
			[
				"association",
				"LineItem",
				"Product",
				{ fromMultiplicity: "*", toMultiplicity: "1", navigable: true },
			],
			["association", "Order", "Payment", { fromMultiplicity: "1", toMultiplicity: "0..1" }],
			["inheritance", "CardPayment", "Payment"],
			["inheritance", "BankTransfer", "Payment"],
			["dependency", "Order", "OrderStatus"],
		],
	},
	{
		id: "observer-pattern-class",
		title: "Observer pattern",
		difficulty: "standard",
		tags: ["class", "design-pattern", "interface", "realization", "dependency"],
		description:
			"The observer pattern: a weather station implements a subject interface that notifies observers, and two displays implement the observer interface.",
		prompt:
			"Draw a UML class diagram of the observer pattern for a weather app. Subject is an interface with public methods attach(o: Observer): void, detach(o: Observer): void and notifyObservers(): void. Observer is an interface with a public method update(subject: Subject): void. WeatherStation implements Subject; it has private attributes temperature: double and humidity: double, and public methods attach(o: Observer): void, detach(o: Observer): void, notifyObservers(): void and setMeasurements(t: double, h: double): void. PhoneDisplay implements Observer, with a private attribute lastReading: double and a public method update(subject: Subject): void. WindowDisplay implements Observer, with a public method update(subject: Subject): void. A Subject knows zero or more observers by the role observers, through an association navigable from Subject to Observer, and each observer is attached to exactly one subject. PhoneDisplay depends on WeatherStation, a dependency named reads.",
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
				"Subject",
				"Observer",
				{ fromMultiplicity: "1", toMultiplicity: "0..*", toRole: "observers", navigable: true },
			],
			["realization", "WeatherStation", "Subject"],
			["realization", "PhoneDisplay", "Observer"],
			["realization", "WindowDisplay", "Observer"],
			["dependency", "PhoneDisplay", "WeatherStation", { label: "reads" }],
		],
	},
	{
		id: "library-system-class",
		title: "Library system",
		difficulty: "challenge",
		tags: ["class", "large", "inheritance", "composition", "multiplicity"],
		description:
			"A fifteen-class library system: items in a catalog with three subclasses, members of two kinds who borrow and reserve items, loans with fines, and librarians at branches.",
		prompt:
			"Draw a UML class diagram of a library system with exactly these fifteen classes. Library has a private attribute name: String and a public method search(query: String): List<Item>. Branch has a private attribute address: String. Catalog has public methods add(item: Item): void and find(isbn: String): Book. Item is an abstract class with protected attributes id: UUID and title: String and a public abstract method loanPeriod(): int. Book, DVD and Magazine each extend Item and have a public method loanPeriod(): int; Book has private attributes isbn: String and pages: int, DVD a private attribute minutes: int, and Magazine a private attribute issue: int. Author has a private attribute name: String. Member has private attributes memberId: String and name: String and public methods borrow(item: Item): Loan and reserve(item: Item): Reservation. StudentMember and StaffMember both extend Member; StudentMember has a private attribute school: String and StaffMember a private attribute department: String. Loan has private attributes due: Date and returned: Date and a public method isOverdue(): bool. Reservation has a private attribute placed: Date. Fine has a private attribute amount: Money and a public method pay(): void. Librarian has a private attribute staffId: String and a public method checkOut(loan: Loan): void. Relationships: a Library is composed of one or more branches, each in exactly one library, and of exactly one catalog, which belongs to exactly one library. A Catalog aggregates zero or more items by the role items, and each item is in exactly one catalog. A book is written by one or more authors, by the role authors, and an author writes many books (an association). A Member borrows zero or more loans and each loan has exactly one member (an association navigable from Member to Loan). Each loan is for exactly one item, and an item has many loans (an association navigable from Loan to Item). A Member places zero or more reservations, each by exactly one member, and each reservation is for exactly one item, which has many reservations (both associations). A Loan is composed of zero or one fine, which belongs to exactly one loan. Librarian depends on Loan, a dependency named checks out. Each librarian works at exactly one branch, and a branch has many librarians (an association).",
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
				["+ isOverdue(): bool|boolean"],
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
			["composition", "Library", "Branch", { fromMultiplicity: "1", toMultiplicity: "1..*" }],
			["composition", "Library", "Catalog", { fromMultiplicity: "1", toMultiplicity: "1" }],
			[
				"aggregation",
				"Catalog",
				"Item",
				{ fromMultiplicity: "1", toMultiplicity: "0..*", toRole: "items" },
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
				{ fromMultiplicity: "1", toMultiplicity: "0..*", navigable: true },
			],
			[
				"association",
				"Loan",
				"Item",
				{ fromMultiplicity: "*", toMultiplicity: "1", navigable: true },
			],
			["association", "Member", "Reservation", { fromMultiplicity: "1", toMultiplicity: "0..*" }],
			["association", "Reservation", "Item", { fromMultiplicity: "*", toMultiplicity: "1" }],
			["composition", "Loan", "Fine", { fromMultiplicity: "1", toMultiplicity: "0..1" }],
			["dependency", "Librarian", "Loan", { label: "checks out" }],
			["association", "Librarian", "Branch", { fromMultiplicity: "*", toMultiplicity: "1" }],
		],
	},
];

export const classScenarios: readonly ClassScenario[] =
	classScenarioDefinitions.map(defineClassScenario);
