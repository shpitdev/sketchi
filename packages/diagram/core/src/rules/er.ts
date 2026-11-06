import type { RuleSource } from "./source.js";

/** How a request becomes an ER diagram; see FLOWCHART_RULES. */
export const ER_RULES = {
	fields:
		'Each field is one string "name type markers": "id uuid PK", "order_id uuid PK FK" (composite), "email text UK", "note text?" (nullable), "parent_id int? FK", with type optional.',
	ids: "Ids hold no dot or space; name defaults to the id.",
	direction: (source: RuleSource) =>
		`from is the end holding the foreign key and to the end it points at, as "entity.field" when ${source} states the key columns ("orders.customer_id" to "customers.id"), otherwise the entity id alone.`,
	cardinalities:
		'Each cardinality is "one", "zero-or-one", "many", "one-or-many" or "zero-or-many": how many rows of that end relate to one row of the other end.',
	cardinalityFromKeys: (source: RuleSource) =>
		`fromCardinality is one-or-many if ${source} says no row of the other side goes without one, zero-or-one if the key is unique or the sole primary key, otherwise zero-or-many. toCardinality is zero-or-one if the key is nullable, otherwise one. A not-null key decides only toCardinality.`,
	example:
		'An order has one customer and a customer zero or many orders: from "orders.customer_id", fromCardinality "zero-or-many", to "customers.id", toCardinality "one".',
	keys: "Mark every key column PK, FK or UK as stated.",
	copy: (source: RuleSource) =>
		`Copy every table, field, type, key, nullable marker and cardinality ${source} states; invent none.`,
} as const;
