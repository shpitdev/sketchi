import {
	type ErCardinality,
	type ErDiagram,
	type ErEntity,
	erEntityName,
	erFieldKeys,
	parseErDiagram,
	parseErEnd,
	parseErFieldShorthand,
} from "@sketchi/diagram-core";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/** A field the prompt states, with every marker it states. */
export interface ErScenarioField {
	readonly name: string;
	/** Accepted spellings of its type; omitted when the prompt states none. */
	readonly types?: readonly string[];
	readonly pk: boolean;
	readonly fk: boolean;
	readonly unique: boolean;
	readonly nullable: boolean;
}

/** An entity the prompt names: the names it may go by and its fields in order. */
export interface ErScenarioEntity {
	readonly names: readonly string[];
	readonly fields: readonly ErScenarioField[];
}

/**
 * A relationship the prompt states, between entities by key, through the
 * named field at each end when it names one, with the cardinalities that read
 * as what the prompt states at each end, the stated one first.
 */
export interface ErScenarioRelationship {
	readonly from: { readonly entity: string; readonly field?: string };
	readonly to: { readonly entity: string; readonly field?: string };
	readonly fromCardinalities: readonly ErCardinality[];
	readonly toCardinalities: readonly ErCardinality[];
}

export interface ErScenario {
	readonly assertions: {
		readonly entities: Readonly<Record<string, ErScenarioEntity>>;
		readonly relationships: readonly ErScenarioRelationship[];
	};
	readonly description: string;
	readonly diagramType: "er";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: ErDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/** Names compare without case, spaces or punctuation: `customer_id` matches `customerId`. */
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function entityMatches(entity: ErEntity, expected: ErScenarioEntity): boolean {
	const names = new Set([key(entity.id), key(erEntityName(entity))]);
	return expected.names.some((name) => names.has(key(name)));
}

function fieldOf(entity: ErEntity, name: string) {
	return entity.fields.find((field) => key(field.name) === key(name));
}

function describeEnd(
	end: ErScenarioRelationship["from"],
	entities: ErScenario["assertions"]["entities"],
): string {
	const name = entities[end.entity]!.names[0]!;
	return end.field ? `${name}.${end.field}` : name;
}

/**
 * The field a drawn end attaches to: the one it names or, opposite an end that
 * names one, its entity's single primary key, as the renderer attaches it.
 */
function drawnField(
	diagram: ErDiagram,
	end: string,
	other: string,
): { readonly entity: ErEntity | undefined; readonly field: string | undefined } {
	const parsed = parseErEnd(end);
	const entity = diagram.entities.find((candidate) => candidate.id === parsed.entity);
	if (!entity || parsed.field !== undefined) return { entity, field: parsed.field };
	const keys = entity.fields.filter((field) => field.pk);
	return {
		entity,
		field: parseErEnd(other).field !== undefined && keys.length === 1 ? keys[0]!.name : undefined,
	};
}

/**
 * ER checks score what the prompt states, each on its own: every entity, every
 * field of it with its type and its exact key and null markers, no entity or
 * relationship the prompt does not state, and every relationship between the
 * right entities through the right fields, with the right cardinality at each
 * end, written in either direction.
 */
export function erScenarioChecks(scenario: ErScenario, diagram: ErDiagram): ScenarioCheck[] {
	const { entities, relationships } = scenario.assertions;
	const matched = new Map(
		Object.entries(entities).map(([entityKey, expected]) => [
			entityKey,
			diagram.entities.find((entity) => entityMatches(entity, expected)),
		]),
	);
	const entityChecks = Object.entries(entities).flatMap(([entityKey, expected]) => {
		const entity = matched.get(entityKey);
		const name = expected.names[0]!;
		return [
			{
				id: `entity:${entityKey}`,
				passed: entity !== undefined,
				message: `Expected an entity named "${expected.names.join('" or "')}".`,
			},
			...expected.fields.flatMap((field): ScenarioCheck[] => {
				const found = entity ? fieldOf(entity, field.name) : undefined;
				const markers = (flags: {
					readonly pk?: boolean | undefined;
					readonly fk?: boolean | undefined;
					readonly unique?: boolean | undefined;
					readonly nullable?: boolean | undefined;
				}) =>
					[
						flags.pk && "PK",
						flags.fk && "FK",
						flags.unique && !flags.pk && "UK",
						flags.nullable && "nullable",
					]
						.filter(Boolean)
						.join(" ") || "no markers";
				return [
					{
						id: `field:${entityKey}.${field.name}`,
						passed: found !== undefined,
						message: `Expected field "${field.name}" in "${name}".`,
					},
					...(field.types
						? [
								{
									id: `type:${entityKey}.${field.name}`,
									passed:
										found?.type !== undefined &&
										field.types.some((type) => key(type) === key(found.type!)),
									message: `Expected "${name}.${field.name}" to have type "${field.types.join('" or "')}".`,
								},
							]
						: []),
					{
						id: `keys:${entityKey}.${field.name}`,
						// A primary key is unique already, so unique beside it changes nothing.
						passed:
							found !== undefined &&
							Boolean(found.pk) === field.pk &&
							Boolean(found.fk) === field.fk &&
							Boolean(found.unique || found.pk) === (field.unique || field.pk) &&
							Boolean(found.nullable) === field.nullable,
						message: `Expected "${name}.${field.name}" marked ${markers(field)}${found ? `; found ${markers(found)}` : ""}.`,
					},
				];
			}),
		];
	});
	const endMatches = (
		drawn: ReturnType<typeof drawnField>,
		expected: ErScenarioRelationship["from"],
	) =>
		drawn.entity !== undefined &&
		drawn.entity === matched.get(expected.entity) &&
		(expected.field === undefined ||
			(drawn.field !== undefined && key(drawn.field) === key(expected.field)));
	const relationshipChecks = relationships.flatMap((expected, index) => {
		// Each relationship as written and reversed, with the cardinality at each end.
		const ways = diagram.relationships.flatMap((relationship) => {
			const from = drawnField(diagram, relationship.from, relationship.to);
			const to = drawnField(diagram, relationship.to, relationship.from);
			return [
				{
					from,
					to,
					fromCardinality: relationship.fromCardinality,
					toCardinality: relationship.toCardinality,
				},
				{
					from: to,
					to: from,
					fromCardinality: relationship.toCardinality,
					toCardinality: relationship.fromCardinality,
				},
			];
		});
		const joined = ways.filter(
			(way) => endMatches(way.from, expected.from) && endMatches(way.to, expected.to),
		);
		const description = `${describeEnd(expected.from, entities)} to ${describeEnd(expected.to, entities)}`;
		return [
			{
				id: `relationship:${index + 1}`,
				passed: joined.length > 0,
				message: `Expected a relationship from ${description}.`,
			},
			{
				id: `cardinality:${index + 1}`,
				passed: joined.some(
					(way) =>
						expected.fromCardinalities.includes(way.fromCardinality) &&
						expected.toCardinalities.includes(way.toCardinality),
				),
				message: `Expected ${description} to be ${expected.fromCardinalities.join(" | ")} to ${expected.toCardinalities.join(" | ")}.`,
			},
		];
	});
	const expectedCount = Object.keys(entities).length;
	return [
		...entityChecks,
		{
			id: "entities-exact",
			passed: diagram.entities.length === expectedCount,
			message: `Expected exactly ${expectedCount} entities; found ${diagram.entities.length}.`,
		},
		...relationshipChecks,
		{
			id: "relationships-exact",
			passed: diagram.relationships.length === relationships.length,
			message: `Expected exactly ${relationships.length} relationships; found ${diagram.relationships.length}.`,
		},
	];
}

/** The arrowhead the renderer draws for each cardinality, and whether it adds a ring. */
const DRAWN_HEADS: Readonly<Record<ErCardinality, readonly [string, boolean]>> = {
	one: ["crowfoot_one", false],
	"zero-or-one": ["crowfoot_one", true],
	many: ["crowfoot_many", false],
	"one-or-many": ["crowfoot_one_or_many", false],
	"zero-or-many": ["crowfoot_many", true],
};

/**
 * The drawn scene says what the diagram says: each table's name band names its
 * entity, its columns list every field, key marker and type in order, and each
 * relationship's line ends in the head of its cardinality at each table, with
 * a ring on its line at each optional end.
 */
export function erDrawnCheck(diagram: ErDiagram, scene: RenderedDiagramScene): ScenarioCheck {
	const texts = new Map(
		scene.elements.flatMap((element) =>
			element.type === "text" ? [[element.id, element.text] as const] : [],
		),
	);
	const rings = scene.elements.filter(
		(element) => element.type === "node" && element.rendererRole === "er-optional",
	);
	const problems: string[] = [];
	for (const entity of diagram.entities) {
		if (texts.get(`label:${entity.id}:header`) !== erEntityName(entity))
			problems.push(`${entity.id} name band`);
		if (entity.fields.length === 0) continue;
		// A column is one text of a line per row, or, where a row grew, a text per row with text.
		const column = (suffix: string) =>
			texts.get(`text:${entity.id}:${suffix}`)?.split("\n") ??
			entity.fields.map((_, row) => texts.get(`text:${entity.id}:${suffix}:${row}`) ?? "");
		const [fields, keys, types] = [column("fields"), column("keys"), column("types")];
		entity.fields.forEach((field, row) => {
			if (fields[row]?.replace(/\?$/u, "") !== field.name)
				problems.push(`${entity.id}.${field.name} row`);
			if ((keys[row] ?? "") !== erFieldKeys(field).join(" "))
				problems.push(`${entity.id}.${field.name} keys`);
			if (field.type && types[row]?.replace(/\?$/u, "") !== field.type)
				problems.push(`${entity.id}.${field.name} type`);
		});
	}
	for (const relationship of diagram.relationships) {
		const arrow = scene.elements.find(
			(element) => element.type === "arrow" && element.edgeId === relationship.id,
		);
		if (!arrow || arrow.type !== "arrow") {
			problems.push(`${relationship.id} line`);
			continue;
		}
		const from = parseErEnd(relationship.from).entity;
		// A ring belongs to an end when it sits on that end's own first run, near its tip.
		const ringOn = (tip: { x: number; y: number }, next: { x: number; y: number }) => {
			const length = Math.hypot(next.x - tip.x, next.y - tip.y) || 1;
			const [dx, dy] = [(next.x - tip.x) / length, (next.y - tip.y) / length];
			return rings.some((ring) => {
				if (ring.type !== "node") return false;
				const [cx, cy] = [ring.x + ring.width / 2 - tip.x, ring.y + ring.height / 2 - tip.y];
				const along = cx * dx + cy * dy;
				return Math.abs(cx * dy - cy * dx) < 1 && along > 0 && along < 60;
			});
		};
		const wrong = (start: ErCardinality, end: ErCardinality) =>
			(
				[
					[start, arrow.startArrowhead, arrow.points[0], arrow.points[1]],
					[end, arrow.endArrowhead, arrow.points.at(-1)!, arrow.points.at(-2)],
				] as const
			).flatMap(([cardinality, head, tip, next]) => {
				const [expectedHead, ring] = DRAWN_HEADS[cardinality];
				return head !== expectedHead || ringOn(tip, next ?? tip) !== ring
					? [`${relationship.id} ${cardinality} end`]
					: [];
			});
		const written = wrong(relationship.fromCardinality, relationship.toCardinality);
		const reversed = wrong(relationship.toCardinality, relationship.fromCardinality);
		// The line runs from its source table, either way round; a line from a table
		// to itself may run either way.
		problems.push(
			...(arrow.sourceNodeId === arrow.targetNodeId
				? written.length <= reversed.length
					? written
					: reversed
				: arrow.sourceNodeId === from
					? written
					: reversed),
		);
	}
	return {
		id: "er-drawn",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every table, field, marker and relationship end is drawn as the diagram states."
				: `Drawn differently from the diagram: ${problems.slice(0, 8).join(", ")}.`,
	};
}

type EntityDefinition = readonly [
	key: string,
	names: readonly string[],
	/** Fields on one line each, `name type markers`; `a|b` accepts either type. */
	fields: readonly string[],
];
/** A cardinality, or every one that reads as the prompt's, the fixture's first. */
type CardinalityDefinition = ErCardinality | readonly [ErCardinality, ...ErCardinality[]];
type RelationshipDefinition = readonly [
	from: string,
	to: string,
	fromCardinality: CardinalityDefinition,
	toCardinality: CardinalityDefinition,
	label?: string,
];

/**
 * A many end of pasted DDL that no sentence pins down: a foreign key cannot say
 * whether every parent has a child, so any many reads as it.
 */
const ANY_MANY = ["zero-or-many", "many", "one-or-many"] as const;
const cardinalitiesOf = (cardinality: CardinalityDefinition): readonly ErCardinality[] =>
	typeof cardinality === "string" ? [cardinality] : cardinality;

interface ErScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly entities: readonly EntityDefinition[];
	readonly relationships: readonly RelationshipDefinition[];
}

function defineErScenario(definition: ErScenarioDefinition): ErScenario {
	const { entities, relationships, ...scenario } = definition;
	const fieldsOf = (lines: readonly string[]) =>
		lines.map((line) => {
			const parsed = parseErFieldShorthand(line);
			return {
				name: parsed.name,
				...(parsed.type ? { types: parsed.type.split("|") } : {}),
				pk: parsed.pk === true,
				fk: parsed.fk === true,
				unique: parsed.unique === true,
				nullable: parsed.nullable === true,
			};
		});
	const endOf = (end: string) => {
		const parsed = parseErEnd(end);
		return parsed.field === undefined
			? { entity: parsed.entity }
			: { entity: parsed.entity, field: parsed.field };
	};
	return {
		...scenario,
		diagramType: "er",
		logos: [],
		assertions: {
			entities: Object.fromEntries(
				entities.map(([entityKey, names, fields]) => [
					entityKey,
					{ names, fields: fieldsOf(fields) },
				]),
			),
			relationships: relationships.map(([from, to, fromCardinality, toCardinality]) => ({
				from: endOf(from),
				to: endOf(to),
				fromCardinalities: cardinalitiesOf(fromCardinality),
				toCardinalities: cardinalitiesOf(toCardinality),
			})),
		},
		expectedDiagram: parseErDiagram({
			id: definition.id,
			title: definition.title,
			type: "er",
			entities: entities.map(([id, names, fields]) => ({
				id,
				...(names[0] !== id ? { name: names[0] } : {}),
				fields: fieldsOf(fields).map(({ types, pk, fk, unique, nullable, name }) => ({
					name,
					...(types ? { type: types[0] } : {}),
					...(pk ? { pk } : {}),
					...(fk ? { fk } : {}),
					...(unique ? { unique } : {}),
					...(nullable ? { nullable } : {}),
				})),
			})),
			relationships: relationships.map(
				([from, to, fromCardinality, toCardinality, label], index) => ({
					id: `r${index + 1}`,
					from,
					to,
					fromCardinality: cardinalitiesOf(fromCardinality)[0]!,
					toCardinality: cardinalitiesOf(toCardinality)[0]!,
					...(label ? { label } : {}),
				}),
			),
		}),
	};
}

// Tables the prose prompt and its pasted-DDL twin state alike.
const shopEntities: readonly EntityDefinition[] = [
	["customers", ["customers", "customer"], ["id uuid PK", "email text UK", "name text"]],
	[
		"products",
		["products", "product"],
		["id uuid PK", "sku text UK", "name text", "price numeric(10,2)"],
	],
	[
		"orders",
		["orders", "order"],
		["id uuid PK", "customer_id uuid FK", "placed_at timestamptz", "shipped_at timestamptz?"],
	],
	[
		"order_items",
		["order_items", "order_item", "order items"],
		["order_id uuid PK FK", "product_id uuid PK FK", "quantity int|integer"],
	],
];

const courseEntities: readonly EntityDefinition[] = [
	["students", ["students", "student"], ["id int|integer PK", "name text", "email text UK"]],
	["courses", ["courses", "course"], ["id int|integer PK", "code text UK", "title text"]],
	[
		"enrollments",
		["enrollments", "enrollment"],
		[
			"student_id int|integer PK FK",
			"course_id int|integer PK FK",
			"enrolled_on date",
			"grade text?",
		],
	],
];

const orgChartEntities: readonly EntityDefinition[] = [
	[
		"employees",
		["employees", "employee"],
		[
			"id int|integer PK",
			"manager_id int|integer? FK",
			"department_id int|integer FK",
			"name text",
		],
	],
	["departments", ["departments", "department"], ["id int|integer PK", "name text UK"]],
];

const saasWorkspaceEntities: readonly EntityDefinition[] = [
	["organizations", ["organizations", "organization", "orgs"], ["id uuid PK", "name text"]],
	["users", ["users", "user"], ["id uuid PK", "email text UK", "name text"]],
	[
		"memberships",
		["memberships", "membership"],
		["organization_id uuid PK FK", "user_id uuid PK FK", "role text"],
	],
	["projects", ["projects", "project"], ["id uuid PK", "organization_id uuid FK", "name text"]],
	[
		"tasks",
		["tasks", "task"],
		["id uuid PK", "project_id uuid FK", "assignee_id uuid? FK", "title text", "due_on date?"],
	],
	[
		"comments",
		["comments", "comment"],
		["id uuid PK", "task_id uuid FK", "author_id uuid FK", "body text"],
	],
	["labels", ["labels", "label"], ["id uuid PK", "organization_id uuid FK", "name text"]],
	[
		"task_labels",
		["task_labels", "task_label", "task labels"],
		["task_id uuid PK FK", "label_id uuid PK FK"],
	],
	["plans", ["plans", "plan"], ["id uuid PK", "name text UK", "monthly_price numeric"]],
	[
		"subscriptions",
		["subscriptions", "subscription"],
		["id uuid PK", "organization_id uuid FK UK", "plan_id uuid FK", "renews_on date"],
	],
	[
		"invoices",
		["invoices", "invoice"],
		["id uuid PK", "subscription_id uuid FK", "amount numeric", "paid_at timestamptz?"],
	],
	[
		"api_keys",
		["api_keys", "api_key", "api keys"],
		["id uuid PK", "organization_id uuid FK", "created_by uuid FK", "token_hash text UK"],
	],
];

const erScenarioDefinitions: readonly ErScenarioDefinition[] = [
	{
		id: "shop-orders-er",
		title: "Shop orders",
		difficulty: "standard",
		tags: ["er", "schema", "foreign-keys", "composite-key"],
		description:
			"A small shop schema: customers place orders of products through order items with a composite key, and a nullable timestamp.",
		prompt:
			"Draw an ER diagram of a small online shop's database. customers has id (uuid, primary key), email (text, unique) and name (text). products has id (uuid, primary key), sku (text, unique), name (text) and price (numeric(10,2)). orders has id (uuid, primary key), customer_id (uuid, foreign key to customers.id), placed_at (timestamptz) and shipped_at (timestamptz, nullable). order_items has order_id (uuid, foreign key to orders.id) and product_id (uuid, foreign key to products.id), which together form its primary key, and quantity (int). A customer places zero or many orders, and each order belongs to exactly one customer. An order has one or many order items, and each order item belongs to exactly one order. A product appears in zero or many order items, and each order item refers to exactly one product.",
		entities: shopEntities,
		relationships: [
			["customers.id", "orders.customer_id", "one", "zero-or-many", "places"],
			["orders.id", "order_items.order_id", "one", "one-or-many"],
			["products.id", "order_items.product_id", "one", "zero-or-many"],
		],
	},
	{
		id: "shop-orders-er-v2",
		title: "Shop orders",
		difficulty: "standard",
		tags: ["er", "schema", "foreign-keys", "composite-key", "real-voice"],
		description:
			"A small shop schema: customers place orders of products through order items with a composite key, and a nullable timestamp.",
		prompt: [
			"ER diagram for this pls",
			"",
			"create table customers (id uuid primary key, email text not null unique, name text not null);",
			"create table products (id uuid primary key, sku text not null unique, name text not null, price numeric(10,2) not null);",
			"create table orders (id uuid primary key, customer_id uuid not null references customers(id), placed_at timestamptz not null, shipped_at timestamptz);",
			"create table order_items (order_id uuid not null references orders(id), product_id uuid not null references products(id), quantity int not null, primary key (order_id, product_id));",
			"",
			"every order has at least one item",
		].join("\n"),
		entities: shopEntities,
		// The DDL leaves open whether a customer or product needs any rows; the
		// sentence says every order has an item.
		relationships: [
			["customers.id", "orders.customer_id", "one", ANY_MANY, "places"],
			["orders.id", "order_items.order_id", "one", "one-or-many"],
			["products.id", "order_items.product_id", "one", ANY_MANY],
		],
	},
	{
		id: "course-enrollment-er",
		title: "Course enrollment",
		difficulty: "smoke",
		tags: ["er", "many-to-many", "join-table"],
		description:
			"Students and courses joined many-to-many through an enrollments table with a composite key and a nullable grade.",
		prompt:
			"ER diagram for course enrollment. students has id (int, primary key), name (text) and email (text, unique). courses has id (int, primary key), code (text, unique) and title (text). Students and courses are many-to-many through enrollments: enrollments has student_id (int, foreign key to students.id) and course_id (int, foreign key to courses.id), which together form its primary key, plus enrolled_on (date) and grade (text, nullable). A student has zero or many enrollments, and each enrollment belongs to exactly one student. A course has zero or many enrollments, and each enrollment is for exactly one course.",
		entities: courseEntities,
		relationships: [
			["students.id", "enrollments.student_id", "one", "zero-or-many"],
			["courses.id", "enrollments.course_id", "one", "zero-or-many"],
		],
	},
	{
		id: "course-enrollment-er-v2",
		title: "Course enrollment",
		difficulty: "smoke",
		tags: ["er", "many-to-many", "join-table", "real-voice"],
		description:
			"Students and courses joined many-to-many through an enrollments table with a composite key and a nullable grade.",
		prompt: [
			"can you make an ER diagram of our enrollment tables",
			"",
			"create table students (id int primary key, name text not null, email text not null unique);",
			"create table courses (id int primary key, code text not null unique, title text not null);",
			"create table enrollments (student_id int not null references students(id), course_id int not null references courses(id), enrolled_on date not null, grade text, primary key (student_id, course_id));",
		].join("\n"),
		entities: courseEntities,
		// The DDL leaves open whether a student or course needs an enrollment.
		relationships: [
			["students.id", "enrollments.student_id", "one", ANY_MANY],
			["courses.id", "enrollments.course_id", "one", ANY_MANY],
		],
	},
	{
		id: "org-chart-er",
		title: "Org chart",
		difficulty: "standard",
		tags: ["er", "self-reference", "optional"],
		description:
			"Employees who report to an optional manager in the same table, and work in a department.",
		prompt:
			"Draw an ER diagram of an org chart. employees has id (int, primary key), manager_id (int, nullable, foreign key to employees.id), department_id (int, foreign key to departments.id) and name (text). departments has id (int, primary key) and name (text, unique). Each employee reports to zero or one manager, who is another employee, and a manager has zero or many direct reports. Each employee works in exactly one department, and a department has one or many employees.",
		entities: orgChartEntities,
		relationships: [
			["employees.manager_id", "employees.id", "zero-or-many", "zero-or-one", "reports to"],
			["departments.id", "employees.department_id", "one", "one-or-many"],
		],
	},
	{
		id: "org-chart-er-v2",
		title: "Org chart",
		difficulty: "standard",
		tags: ["er", "self-reference", "optional", "real-voice"],
		description:
			"Employees who report to an optional manager in the same table, and work in a department.",
		prompt: [
			"ER diagram of our org chart schema:",
			"",
			"create table departments (id int primary key, name text not null unique);",
			"create table employees (id int primary key, manager_id int references employees(id), department_id int not null references departments(id), name text not null);",
			"",
			"no department is ever empty",
		].join("\n"),
		entities: orgChartEntities,
		// The DDL leaves open whether a manager needs reports; the sentence says
		// every department has an employee.
		relationships: [
			["employees.manager_id", "employees.id", ANY_MANY, "zero-or-one", "reports to"],
			["departments.id", "employees.department_id", "one", "one-or-many"],
		],
	},
	{
		id: "saas-workspace-er",
		title: "SaaS workspace",
		difficulty: "challenge",
		tags: ["er", "large", "many-to-many", "optional"],
		description:
			"A twelve-table SaaS schema: organizations hold members, projects, tasks with labels and comments, a subscription with invoices, and API keys.",
		prompt:
			"Draw an ER diagram of a SaaS workspace database with exactly these twelve tables. organizations has id (uuid, primary key) and name (text). users has id (uuid, primary key), email (text, unique) and name (text). memberships has organization_id (uuid, foreign key to organizations.id) and user_id (uuid, foreign key to users.id), which together form its primary key, and role (text). projects has id (uuid, primary key), organization_id (uuid, foreign key to organizations.id) and name (text). tasks has id (uuid, primary key), project_id (uuid, foreign key to projects.id), assignee_id (uuid, nullable, foreign key to users.id), title (text) and due_on (date, nullable). comments has id (uuid, primary key), task_id (uuid, foreign key to tasks.id), author_id (uuid, foreign key to users.id) and body (text). labels has id (uuid, primary key), organization_id (uuid, foreign key to organizations.id) and name (text). task_labels has task_id (uuid, foreign key to tasks.id) and label_id (uuid, foreign key to labels.id), which together form its primary key. plans has id (uuid, primary key), name (text, unique) and monthly_price (numeric). subscriptions has id (uuid, primary key), organization_id (uuid, unique, foreign key to organizations.id), plan_id (uuid, foreign key to plans.id) and renews_on (date). invoices has id (uuid, primary key), subscription_id (uuid, foreign key to subscriptions.id), amount (numeric) and paid_at (timestamptz, nullable). api_keys has id (uuid, primary key), organization_id (uuid, foreign key to organizations.id), created_by (uuid, foreign key to users.id) and token_hash (text, unique). Cardinalities: an organization has one or many memberships, and a user has zero or many memberships; each membership belongs to exactly one organization and exactly one user. An organization has zero or many projects, labels and API keys, each of which belongs to exactly one organization. A project has zero or many tasks, and each task belongs to exactly one project. A task has zero or one assignee, and a user is assigned zero or many tasks. A task has zero or many comments, and each comment is on exactly one task; a user writes zero or many comments, and each comment has exactly one author. A task has zero or many task labels and a label has zero or many task labels; each task label joins exactly one task and exactly one label. An organization has zero or one subscription, and each subscription belongs to exactly one organization. A plan has zero or many subscriptions, and each subscription is on exactly one plan. A subscription has zero or many invoices, and each invoice belongs to exactly one subscription. A user creates zero or many API keys, and each API key was created by exactly one user.",
		entities: saasWorkspaceEntities,
		relationships: [
			["organizations.id", "memberships.organization_id", "one", "one-or-many"],
			["users.id", "memberships.user_id", "one", "zero-or-many"],
			["organizations.id", "projects.organization_id", "one", "zero-or-many"],
			["projects.id", "tasks.project_id", "one", "zero-or-many"],
			["users.id", "tasks.assignee_id", "zero-or-one", "zero-or-many"],
			["tasks.id", "comments.task_id", "one", "zero-or-many"],
			["users.id", "comments.author_id", "one", "zero-or-many"],
			["organizations.id", "labels.organization_id", "one", "zero-or-many"],
			["tasks.id", "task_labels.task_id", "one", "zero-or-many"],
			["labels.id", "task_labels.label_id", "one", "zero-or-many"],
			["organizations.id", "subscriptions.organization_id", "one", "zero-or-one"],
			["plans.id", "subscriptions.plan_id", "one", "zero-or-many"],
			["subscriptions.id", "invoices.subscription_id", "one", "zero-or-many"],
			["organizations.id", "api_keys.organization_id", "one", "zero-or-many"],
			["users.id", "api_keys.created_by", "one", "zero-or-many"],
		],
	},
	{
		id: "saas-workspace-er-v2",
		title: "SaaS workspace",
		difficulty: "challenge",
		tags: ["er", "large", "many-to-many", "optional", "real-voice"],
		description:
			"A twelve-table SaaS schema: organizations hold members, projects, tasks with labels and comments, a subscription with invoices, and API keys.",
		prompt: [
			"need an ER diagram of the workspace db, schema below. an org always has at least one member",
			"",
			"create table organizations (id uuid primary key, name text not null);",
			"create table users (id uuid primary key, email text not null unique, name text not null);",
			"create table memberships (organization_id uuid not null references organizations(id), user_id uuid not null references users(id), role text not null, primary key (organization_id, user_id));",
			"create table projects (id uuid primary key, organization_id uuid not null references organizations(id), name text not null);",
			"create table tasks (id uuid primary key, project_id uuid not null references projects(id), assignee_id uuid references users(id), title text not null, due_on date);",
			"create table comments (id uuid primary key, task_id uuid not null references tasks(id), author_id uuid not null references users(id), body text not null);",
			"create table labels (id uuid primary key, organization_id uuid not null references organizations(id), name text not null);",
			"create table task_labels (task_id uuid not null references tasks(id), label_id uuid not null references labels(id), primary key (task_id, label_id));",
			"create table plans (id uuid primary key, name text not null unique, monthly_price numeric not null);",
			"create table subscriptions (id uuid primary key, organization_id uuid not null unique references organizations(id), plan_id uuid not null references plans(id), renews_on date not null);",
			"create table invoices (id uuid primary key, subscription_id uuid not null references subscriptions(id), amount numeric not null, paid_at timestamptz);",
			"create table api_keys (id uuid primary key, organization_id uuid not null references organizations(id), created_by uuid not null references users(id), token_hash text not null unique);",
		].join("\n"),
		entities: saasWorkspaceEntities,
		// Only memberships has a stated minimum; the unique organization_id makes a
		// subscription at most one per organization.
		relationships: [
			["organizations.id", "memberships.organization_id", "one", "one-or-many"],
			["users.id", "memberships.user_id", "one", ANY_MANY],
			["organizations.id", "projects.organization_id", "one", ANY_MANY],
			["projects.id", "tasks.project_id", "one", ANY_MANY],
			["users.id", "tasks.assignee_id", "zero-or-one", ANY_MANY],
			["tasks.id", "comments.task_id", "one", ANY_MANY],
			["users.id", "comments.author_id", "one", ANY_MANY],
			["organizations.id", "labels.organization_id", "one", ANY_MANY],
			["tasks.id", "task_labels.task_id", "one", ANY_MANY],
			["labels.id", "task_labels.label_id", "one", ANY_MANY],
			["organizations.id", "subscriptions.organization_id", "one", "zero-or-one"],
			["plans.id", "subscriptions.plan_id", "one", ANY_MANY],
			["subscriptions.id", "invoices.subscription_id", "one", ANY_MANY],
			["organizations.id", "api_keys.organization_id", "one", ANY_MANY],
			["users.id", "api_keys.created_by", "one", ANY_MANY],
		],
	},
];

export const erScenarios: readonly ErScenario[] = erScenarioDefinitions.map(defineErScenario);
