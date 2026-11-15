import { ER_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "ER diagram", hint: "best for database tables, keys and relationships" },
	summary: "database schemas: tables, fields, keys and relationships",
	fastPath: `spec: { title, entities: [{ id, fields: ["id uuid PK", "customer_id uuid FK", "email text UK", "note text?"] }], relationships: [{ from: "orders.customer_id", to: "customers.id", fromCardinality: "zero-or-many", toCardinality: "one", label? }] }. ${ER_RULES.cardinalities}`,
	codeHint: "database schemas",
	catalogOrder: 9,
	fastPathOrder: 6,
	studioOrder: 6,
	toolName: "build_er_diagram" as const,
	toolDescription:
		'Build and persist a native ER diagram: entities drawn as tables of fields with PK, FK and UK markers, and relationships with a cardinality at each end ("one", "zero-or-one", "many", "one-or-many" or "zero-or-many") drawn as crow\'s-foot lines between the rows they join. Fields may be strings "name type markers"; relationship ends are "entity.field" or an entity id. The host lays out the tables. Repair structured issues, up to three total attempts.',

	entry: (requestType: string) => ({
		id: "buildErDiagram",
		kind: "operation" as const,
		title: "buildErDiagram",
		topic: "buildErDiagram" as const,
		keywords: [
			"er diagram",
			"erd",
			"entity relationship",
			"database schema",
			"tables",
			"foreign key",
			"crow's foot",
			"data model",
		],
		snippet: "Create a native ER diagram from entities, their fields and keys, and relationships.",
		content: [
			"buildErDiagram accepts { spec: { id?, title, entities: [{ id, name?, fields }], relationships: [{ id?, from, to, fromCardinality, toCardinality, label? }] }, options? }. The renderer draws each entity as a table and each relationship as a crow's-foot line between the rows it joins.",
			`${ER_RULES.fields} ${ER_RULES.ids}`,
			[
				ER_RULES.direction(PROMPT),
				ER_RULES.cardinalities,
				ER_RULES.cardinalityFromKeys(PROMPT),
				ER_RULES.example,
			].join(" "),
			ER_RULES.copy(PROMPT),
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "Customers and orders",
				language: "js" as const,
				code: `async () => sketchi.buildErDiagram({ spec: { title: "Shop", entities: [{ id: "customers", fields: ["id uuid PK", "email text UK"] }, { id: "orders", fields: ["id uuid PK", "customer_id uuid FK", "shipped_at date?"] }], relationships: [{ from: "orders.customer_id", to: "customers.id", fromCardinality: "zero-or-many", toCardinality: "one", label: "places" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
