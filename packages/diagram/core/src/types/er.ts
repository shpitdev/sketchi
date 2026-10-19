import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const erDiagramType = "er" as const;

/**
 * How many rows of an entity relate to one row of the other entity, drawn at
 * that entity's end of the line: a bar for one, a crow's foot for many, a bar
 * and a foot for one or many, and a ring before the bar or foot when the
 * relationship is optional.
 */
export const ER_CARDINALITIES = [
	"one",
	"zero-or-one",
	"many",
	"one-or-many",
	"zero-or-many",
] as const;
export const ErCardinalitySchema = Schema.Literals(ER_CARDINALITIES);
export type ErCardinality = (typeof ER_CARDINALITIES)[number];

/** Larger schemas stop reading as one diagram; split them by area instead. */
export const ER_MAX_ENTITIES = 30;
export const ER_MAX_FIELDS_PER_ENTITY = 40;
export const ER_MAX_FIELDS = 240;
export const ER_MAX_RELATIONSHIPS = 60;
/** Names and types stay on one line, so their table grows to fit them. */
export const ER_MAX_NAME_LENGTH = 64;
export const ER_MAX_ISSUES = 20;

/** One column of an entity: its name, optional type, and key and null markers. */
export class ErField extends Schema.Class<ErField>("ErField")({
	name: Schema.NonEmptyString,
	type: Schema.optionalKey(Schema.NonEmptyString),
	/** Part of the primary key. */
	pk: Schema.optionalKey(Schema.Boolean),
	/** A foreign key: it holds another entity's key. */
	fk: Schema.optionalKey(Schema.Boolean),
	/** Unique across the entity's rows. */
	unique: Schema.optionalKey(Schema.Boolean),
	/** May be empty; drawn as `?` after the type. */
	nullable: Schema.optionalKey(Schema.Boolean),
}) {}
export const ErFieldSchema = ErField;

/** One entity, drawn as a table: a band with its name over a row per field. */
export class ErEntity extends Schema.Class<ErEntity>("ErEntity")({
	id: Schema.NonEmptyString,
	/** The name the table shows; the id when omitted. */
	name: Schema.optionalKey(Schema.NonEmptyString),
	fields: Schema.Array(ErField).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
}) {}
export const ErEntitySchema = ErEntity;

/**
 * A relationship between two entities. Each end names an entity id or, when
 * the relationship runs through a column, `entity.field`: the foreign key at
 * one end and the key it references at the other. Each end's cardinality is
 * how many rows of that end's entity relate to one row of the other.
 */
export class ErRelationship extends Schema.Class<ErRelationship>("ErRelationship")({
	id: Schema.NonEmptyString,
	from: Schema.NonEmptyString,
	to: Schema.NonEmptyString,
	fromCardinality: ErCardinalitySchema,
	toCardinality: ErCardinalitySchema,
	label: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const ErRelationshipSchema = ErRelationship;

/**
 * The canonical entity-relationship diagram: entities with their fields, and
 * the relationships between them. The renderer owns every coordinate. Every
 * surface that accepts, generates, renders or evaluates an ER diagram uses
 * this shape.
 */
export class ErDiagram extends Schema.Class<ErDiagram>("ErDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(erDiagramType),
	entities: Schema.Array(ErEntity).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	relationships: Schema.Array(ErRelationship).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const ErDiagramSchema = ErDiagram;

export const ErValidationIssueCodeSchema = Schema.Literals([
	"er_too_large",
	"invalid_entity_id",
	"duplicate_entity_id",
	"duplicate_entity_name",
	"duplicate_field_name",
	"er_text_too_long",
	"nullable_primary_key",
	"duplicate_relationship_id",
	"missing_relationship_entity",
	"missing_relationship_field",
	"self_referencing_field",
]);
export type ErValidationIssueCode = typeof ErValidationIssueCodeSchema.Type;

export class ErValidationIssue extends Schema.Class<ErValidationIssue>("ErValidationIssue")({
	code: ErValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `relationships.[1].to`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}

/** The name an entity's table shows. */
export function erEntityName(entity: Pick<ErEntity, "id" | "name">): string {
	return entity.name ?? entity.id;
}

/** One end of a relationship: the entity, and the field when it names one. */
export interface ErEnd {
	readonly entity: string;
	readonly field?: string;
}

/** Read `entity` or `entity.field`; entity ids never contain a dot. */
export function parseErEnd(end: string): ErEnd {
	const dot = end.indexOf(".");
	return dot < 0
		? { entity: end.trim() }
		: { entity: end.slice(0, dot).trim(), field: end.slice(dot + 1).trim() };
}

/** The key markers a field shows, in reading order: PK, FK, UK. */
export function erFieldKeys(field: Pick<ErField, "fk" | "pk" | "unique">): string[] {
	return [field.pk && "PK", field.fk && "FK", field.unique && !field.pk && "UK"].filter(
		(key): key is string => typeof key === "string",
	);
}

/** The key two entity or field names compare by: trimmed, ignoring case. */
export function erNameKey(name: string): string {
	return name.trim().toLowerCase();
}

export function getErValidationIssues(diagram: ErDiagram): ErValidationIssue[] {
	const issues: ErValidationIssue[] = [];
	const fieldCount = diagram.entities.reduce((sum, entity) => sum + entity.fields.length, 0);
	if (diagram.entities.length > ER_MAX_ENTITIES) {
		issues.push({
			code: "er_too_large",
			path: "entities",
			message: `The diagram has ${diagram.entities.length} entities; the supported maximum is ${ER_MAX_ENTITIES}.`,
			hint: "Split the schema into diagrams by area, or leave out minor lookup tables.",
		});
	}
	if (fieldCount > ER_MAX_FIELDS) {
		issues.push({
			code: "er_too_large",
			path: "entities",
			message: `The diagram has ${fieldCount} fields; the supported maximum is ${ER_MAX_FIELDS}.`,
			hint: "Keep the keys and the fields the request names, or split the schema by area.",
		});
	}
	if (diagram.relationships.length > ER_MAX_RELATIONSHIPS) {
		issues.push({
			code: "er_too_large",
			path: "relationships",
			message: `The diagram has ${diagram.relationships.length} relationships; the supported maximum is ${ER_MAX_RELATIONSHIPS}.`,
			hint: "Split the schema into diagrams by area.",
		});
	}

	const entities = new Map<string, ErEntity>();
	const names = new Map<string, string>();
	diagram.entities.forEach((entity, index) => {
		const path = `entities.[${index}]`;
		if (/[.:\s]/u.test(entity.id)) {
			issues.push({
				code: "invalid_entity_id",
				path: `${path}.id`,
				message: `Entity id "${entity.id}" contains a dot, a colon or a space.`,
				hint: 'Use letters, digits, hyphens or underscores in entity ids; relationships write "entity.field".',
			});
		}
		if (entities.has(entity.id)) {
			issues.push({
				code: "duplicate_entity_id",
				path: `${path}.id`,
				message: `Entity id "${entity.id}" is used more than once.`,
				hint: "Give every entity a unique id.",
			});
		}
		entities.set(entity.id, entity);
		const name = erEntityName(entity);
		const named = names.get(erNameKey(name));
		if (named !== undefined && named !== entity.id) {
			issues.push({
				code: "duplicate_entity_name",
				path: entity.name === undefined ? `${path}.id` : `${path}.name`,
				message: `Entities "${named}" and "${entity.id}" are both named "${name}".`,
				hint: "Give every entity a distinct name, or merge the two.",
			});
		}
		names.set(erNameKey(name), entity.id);
		if (name.length > ER_MAX_NAME_LENGTH) {
			issues.push({
				code: "er_text_too_long",
				path: entity.name === undefined ? `${path}.id` : `${path}.name`,
				message: `Entity name "${name}" is longer than ${ER_MAX_NAME_LENGTH} characters.`,
				hint: "Shorten the entity name.",
			});
		}
		if (entity.fields.length > ER_MAX_FIELDS_PER_ENTITY) {
			issues.push({
				code: "er_too_large",
				path: `${path}.fields`,
				message: `Entity "${entity.id}" has ${entity.fields.length} fields; the supported maximum is ${ER_MAX_FIELDS_PER_ENTITY}.`,
				hint: "Keep the keys and the fields the request names.",
			});
		}
		const fields = new Set<string>();
		entity.fields.forEach((field, fieldIndex) => {
			const fieldPath = `${path}.fields.[${fieldIndex}]`;
			if (fields.has(erNameKey(field.name))) {
				issues.push({
					code: "duplicate_field_name",
					path: `${fieldPath}.name`,
					message: `Entity "${entity.id}" has more than one field named "${field.name}".`,
					hint: "List each field once.",
				});
			}
			fields.add(erNameKey(field.name));
			for (const [key, text] of [
				["name", field.name],
				["type", field.type],
			] as const) {
				if (text === undefined) continue;
				if (text.length > ER_MAX_NAME_LENGTH || /\n/u.test(text)) {
					issues.push({
						code: "er_text_too_long",
						path: `${fieldPath}.${key}`,
						message: `Field ${key} "${text}" of "${entity.id}" is longer than ${ER_MAX_NAME_LENGTH} characters or spans lines.`,
						hint: `Write the field ${key} on one line of at most ${ER_MAX_NAME_LENGTH} characters.`,
					});
				}
			}
			if (field.pk && field.nullable) {
				issues.push({
					code: "nullable_primary_key",
					path: `${fieldPath}.nullable`,
					message: `Primary key "${entity.id}.${field.name}" is marked nullable.`,
					hint: "A primary key is never empty; drop nullable from it.",
				});
			}
		});
	});

	const relationshipIds = new Set<string>();
	diagram.relationships.forEach((relationship, index) => {
		const path = `relationships.[${index}]`;
		if (relationshipIds.has(relationship.id)) {
			issues.push({
				code: "duplicate_relationship_id",
				path: `${path}.id`,
				message: `Relationship id "${relationship.id}" is used more than once.`,
				hint: "Give every relationship a unique id, or omit ids to generate them.",
			});
		}
		relationshipIds.add(relationship.id);
		const ends = (["from", "to"] as const).map((key) => {
			const end = parseErEnd(relationship[key]);
			const entity = entities.get(end.entity);
			if (!entity) {
				issues.push({
					code: "missing_relationship_entity",
					path: `${path}.${key}`,
					message: `Relationship "${relationship.id}" ${key === "from" ? "starts" : "ends"} at "${end.entity}", which is not an entity.`,
					hint: 'Set it to an entity id, or "entity.field" for the column the relationship runs through.',
				});
				return undefined;
			}
			if (
				end.field !== undefined &&
				!entity.fields.some((field) => erNameKey(field.name) === erNameKey(end.field!))
			) {
				issues.push({
					code: "missing_relationship_field",
					path: `${path}.${key}`,
					message: `Relationship "${relationship.id}" names field "${end.field}", which "${entity.id}" does not have.`,
					hint: `Name one of the fields of "${entity.id}", add the field, or name the entity alone.`,
				});
				return undefined;
			}
			return end;
		});
		const [from, to] = ends;
		if (
			from?.field !== undefined &&
			to?.field !== undefined &&
			from.entity === to.entity &&
			erNameKey(from.field) === erNameKey(to.field)
		) {
			issues.push({
				code: "self_referencing_field",
				path,
				message: `Relationship "${relationship.id}" joins "${from.entity}.${from.field}" to itself.`,
				hint: "A self-reference runs from the foreign key to the key it references, such as employees.manager_id to employees.id.",
			});
		}
	});
	return issues.slice(0, ER_MAX_ISSUES);
}

export class ErValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly ErValidationIssue[]) {
		super(issues[0]?.message ?? "ER diagram failed semantic validation.");
		this.name = "ErValidationError";
	}
}

export function validateErDiagram(diagram: ErDiagram): ErDiagram {
	const issues = getErValidationIssues(diagram);
	if (issues.length > 0) {
		throw new ErValidationError(issues);
	}
	return diagram;
}

export function parseErDiagram(input: unknown): ErDiagram {
	return validateErDiagram(Schema.decodeUnknownSync(ErDiagram, { errors: "all" })(input));
}

/** A small shop: customers place orders of products, line by line. */
export const erFixture = parseErDiagram({
	id: "shop-schema",
	title: "Shop schema",
	type: erDiagramType,
	entities: [
		{
			id: "customers",
			fields: [
				{ name: "id", type: "uuid", pk: true },
				{ name: "email", type: "text", unique: true },
				{ name: "name", type: "text" },
			],
		},
		{
			id: "orders",
			fields: [
				{ name: "id", type: "uuid", pk: true },
				{ name: "customer_id", type: "uuid", fk: true },
				{ name: "placed_at", type: "timestamptz" },
				{ name: "shipped_at", type: "timestamptz", nullable: true },
			],
		},
		{
			id: "order_items",
			fields: [
				{ name: "order_id", type: "uuid", pk: true, fk: true },
				{ name: "product_id", type: "uuid", pk: true, fk: true },
				{ name: "quantity", type: "int" },
			],
		},
		{
			id: "products",
			fields: [
				{ name: "id", type: "uuid", pk: true },
				{ name: "sku", type: "text", unique: true },
				{ name: "price", type: "numeric(10,2)" },
			],
		},
	],
	relationships: [
		{
			id: "places",
			from: "customers.id",
			to: "orders.customer_id",
			fromCardinality: "one",
			toCardinality: "zero-or-many",
			label: "places",
		},
		{
			id: "contains",
			from: "orders.id",
			to: "order_items.order_id",
			fromCardinality: "one",
			toCardinality: "one-or-many",
		},
		{
			id: "ordered-as",
			from: "products.id",
			to: "order_items.product_id",
			fromCardinality: "one",
			toCardinality: "zero-or-many",
		},
	],
});

/** Employees who report to a manager, the same table, and may lead one department. */
export const orgChartEr = parseErDiagram({
	id: "org-schema",
	title: "Org schema",
	type: erDiagramType,
	entities: [
		{
			id: "employees",
			fields: [
				{ name: "id", type: "int", pk: true },
				{ name: "manager_id", type: "int", fk: true, nullable: true },
				{ name: "department_id", type: "int", fk: true },
				{ name: "name", type: "text" },
			],
		},
		{
			id: "departments",
			fields: [
				{ name: "id", type: "int", pk: true },
				{ name: "head_id", type: "int", fk: true, unique: true, nullable: true },
				{ name: "name", type: "text", unique: true },
			],
		},
	],
	relationships: [
		{
			id: "reports-to",
			from: "employees.id",
			to: "employees.manager_id",
			fromCardinality: "zero-or-one",
			toCardinality: "zero-or-many",
			label: "manages",
		},
		{
			id: "works-in",
			from: "departments.id",
			to: "employees.department_id",
			fromCardinality: "one",
			toCardinality: "one-or-many",
		},
		{
			id: "heads",
			from: "employees.id",
			to: "departments.head_id",
			fromCardinality: "zero-or-one",
			toCardinality: "zero-or-one",
			label: "heads",
		},
	],
});

const KEY_WORDS: Readonly<Record<string, "pk" | "fk" | "unique" | "nullable">> = {
	PK: "pk",
	FK: "fk",
	UK: "unique",
	UQ: "unique",
	UNIQUE: "unique",
	NULL: "nullable",
	NULLABLE: "nullable",
	"?": "nullable",
};

/**
 * Read a field written on one line, `name type markers`: `"id uuid PK"`,
 * `"order_id uuid PK FK"`, `"email text UK"`, `"bio text?"` (nullable),
 * `"price numeric(10, 2)"`. Markers (PK, FK, UK or UNIQUE, NULL) close the
 * line, or open it before the name; `NOT NULL` is dropped. The type is
 * whatever lies between, and may be omitted.
 */
export function parseErFieldShorthand(line: string): {
	name: string;
	type?: string;
	pk?: true;
	fk?: true;
	unique?: true;
	nullable?: true;
} {
	const tokens = line.trim().split(/\s+/u).filter(Boolean);
	const flags: Partial<Record<"pk" | "fk" | "unique" | "nullable", true>> = {};
	const marker = (token: string) => KEY_WORDS[token.toUpperCase()];
	while (tokens.length > 1) {
		const last = tokens.at(-1)!;
		if (last.toUpperCase() === "NULL" && tokens.at(-2)?.toUpperCase() === "NOT") {
			tokens.splice(-2, 2);
			continue;
		}
		// A marker may carry the nullable mark itself: "FK?".
		const flag =
			marker(last) ??
			(last.length > 1 && last.endsWith("?") ? marker(last.slice(0, -1)) : undefined);
		if (!flag) break;
		flags[flag] = true;
		if (last.length > 1 && last.endsWith("?")) flags.nullable = true;
		tokens.pop();
	}
	while (tokens.length > 1 && /^(?:PK|FK|UK)$/u.test(tokens[0]!))
		flags[marker(tokens.shift()!)!] = true;
	let name = tokens.shift() ?? line.trim();
	let type = tokens.join(" ");
	if (type.endsWith("?")) {
		type = type.slice(0, -1).trim();
		flags.nullable = true;
	}
	if (!type && name.length > 1 && name.endsWith("?")) {
		name = name.slice(0, -1);
		flags.nullable = true;
	}
	return { name, ...(type ? { type } : {}), ...flags };
}

const CARDINALITY_ALIASES: Readonly<Record<string, ErCardinality>> = {
	"1": "one",
	"1..1": "one",
	"exactly-one": "one",
	"one-and-only-one": "one",
	"only-one": "one",
	"mandatory-one": "one",
	"0..1": "zero-or-one",
	"0-1": "zero-or-one",
	"0-or-1": "zero-or-one",
	optional: "zero-or-one",
	"optional-one": "zero-or-one",
	"one-or-zero": "zero-or-one",
	"at-most-one": "zero-or-one",
	"*": "many",
	n: "many",
	m: "many",
	multiple: "many",
	"1..*": "one-or-many",
	"1..n": "one-or-many",
	"1-n": "one-or-many",
	"1+": "one-or-many",
	"at-least-one": "one-or-many",
	"one-or-more": "one-or-many",
	"many-mandatory": "one-or-many",
	"0..*": "zero-or-many",
	"0..n": "zero-or-many",
	"0-n": "zero-or-many",
	"0+": "zero-or-many",
	"zero-or-more": "zero-or-many",
	"optional-many": "zero-or-many",
	"many-optional": "zero-or-many",
};

/** A cardinality as written, read as one of the five, or kept as given when it is none of them. */
export function resolveErCardinality(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const key = value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/gu, "-");
	if ((ER_CARDINALITIES as readonly string[]).includes(key)) return key;
	return CARDINALITY_ALIASES[key] ?? value;
}

/** `"one-to-many"`, `"1:N"`, `"many-to-many"`: both ends, from first. */
function cardinalityPair(value: unknown): readonly [unknown, unknown] | undefined {
	if (typeof value !== "string") return undefined;
	const parts = value
		.trim()
		.toLowerCase()
		.split(/\s*(?:-to-|\sto\s|:)\s*/u);
	if (parts.length !== 2) return undefined;
	const side = (part: string) => resolveErCardinality(/^m$|^n$/u.test(part) ? "many" : part);
	return [side(parts[0]!), side(parts[1]!)];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Resolve the shapes models write for an ER diagram before it is decoded:
 * fields on one line (`"id uuid PK"`), cardinality aliases (`"1"`, `"0..*"`,
 * `"one or more"`), `source`/`target` for `from`/`to`, and one `cardinality`
 * such as `"one-to-many"` for both ends. Anything else keeps its value, so
 * decoding still reports it.
 */
export function resolveErShorthand(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const entities = Array.isArray(input["entities"])
		? input["entities"].map((entity) =>
				isRecord(entity) && Array.isArray(entity["fields"])
					? {
							...entity,
							fields: entity["fields"].map((field) =>
								typeof field === "string" ? parseErFieldShorthand(field) : field,
							),
						}
					: entity,
			)
		: input["entities"];
	const relationships = Array.isArray(input["relationships"])
		? input["relationships"].map((relationship) => {
				if (!isRecord(relationship)) return relationship;
				const { source, target, cardinality, ...rest } = relationship;
				const pair = cardinalityPair(cardinality);
				const resolved: Record<string, unknown> = {
					...rest,
					from: rest["from"] ?? source,
					to: rest["to"] ?? target,
					fromCardinality: resolveErCardinality(rest["fromCardinality"] ?? pair?.[0]),
					toCardinality: resolveErCardinality(rest["toCardinality"] ?? pair?.[1]),
				};
				for (const key of ["from", "to", "fromCardinality", "toCardinality"])
					if (resolved[key] === undefined) delete resolved[key];
				if (cardinality !== undefined && pair === undefined) resolved["cardinality"] = cardinality;
				return resolved;
			})
		: input["relationships"];
	return {
		...input,
		...(entities === undefined ? {} : { entities }),
		...(relationships === undefined ? {} : { relationships }),
	};
}
