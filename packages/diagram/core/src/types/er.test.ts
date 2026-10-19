import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import {
	type ErDiagram,
	erDiagramType,
	erFieldKeys,
	erFixture,
	getErValidationIssues,
	orgChartEr,
	parseErDiagram,
	parseErEnd,
	parseErFieldShorthand,
	resolveErCardinality,
	resolveErShorthand,
} from "./er";

const codes = (input: Partial<ErDiagram>) =>
	getErValidationIssues({ ...erFixture, ...input }).map((issue) => issue.code);

describe("ER diagram type", () => {
	it("has typed fixtures that satisfy the canonical diagram contract", () => {
		expect(erFixture.type).toBe(erDiagramType);
		expect(parseCanonicalDiagram(erFixture)).toEqual(erFixture);
		expect(parseCanonicalDiagram(orgChartEr)).toEqual(orgChartEr);
	});

	it("reads relationship ends as an entity or entity.field", () => {
		expect(parseErEnd("orders")).toEqual({ entity: "orders" });
		expect(parseErEnd("orders.customer_id")).toEqual({ entity: "orders", field: "customer_id" });
		expect(parseErEnd(" orders . customer_id ")).toEqual({
			entity: "orders",
			field: "customer_id",
		});
	});

	it("shows key markers in reading order, a primary key's uniqueness implied", () => {
		expect(erFieldKeys({ pk: true, fk: true })).toEqual(["PK", "FK"]);
		expect(erFieldKeys({ pk: true, unique: true })).toEqual(["PK"]);
		expect(erFieldKeys({ fk: true, unique: true })).toEqual(["FK", "UK"]);
		expect(erFieldKeys({})).toEqual([]);
	});

	it("rejects unknown entities and fields, duplicates, nullable keys and too much", () => {
		const [customers, orders] = erFixture.entities;
		expect(
			codes({
				relationships: [
					{ ...erFixture.relationships[0]!, from: "clients.id" },
					{ ...erFixture.relationships[1]!, to: "order_items.missing" },
				],
			}),
		).toEqual(["missing_relationship_entity", "missing_relationship_field"]);
		expect(codes({ entities: [customers!, { ...customers! }], relationships: [] })).toEqual([
			"duplicate_entity_id",
		]);
		expect(
			codes({
				entities: [customers!, { ...orders!, id: "orders2", name: "Customers" }],
				relationships: [],
			}),
		).toEqual(["duplicate_entity_name"]);
		expect(
			codes({
				entities: [
					{ ...customers!, id: "customer.accounts" },
					{
						...orders!,
						fields: [
							{ name: "id", pk: true, nullable: true },
							{ name: "ID", type: "uuid" },
						],
					},
				],
				relationships: [],
			}),
		).toEqual(["invalid_entity_id", "nullable_primary_key", "duplicate_field_name"]);
		expect(
			codes({
				relationships: [
					{
						id: "self",
						from: "orders.id",
						to: "orders.id",
						fromCardinality: "one",
						toCardinality: "one",
					},
				],
			}),
		).toEqual(["self_referencing_field"]);
		expect(
			codes({
				relationships: [...erFixture.relationships, { ...erFixture.relationships[0]! }],
			}),
		).toEqual(["duplicate_relationship_id"]);
		expect(
			codes({
				entities: Array.from({ length: 31 }, (_, index) => ({ id: `t${index}`, fields: [] })),
				relationships: [],
			}),
		).toEqual(["er_too_large"]);
		expect(
			codes({
				entities: [{ id: "wide", fields: [{ name: "x".repeat(65) }] }],
				relationships: [],
			}),
		).toEqual(["er_text_too_long"]);
	});

	it("accepts a self-reference from a foreign key to the key it references", () => {
		expect(
			parseErDiagram({
				id: "tree",
				title: "Tree",
				type: "er",
				entities: [
					{
						id: "nodes",
						fields: [
							{ name: "id", pk: true },
							{ name: "parent_id", fk: true, nullable: true },
						],
					},
				],
				relationships: [
					{
						id: "parent",
						from: "nodes.parent_id",
						to: "nodes.id",
						fromCardinality: "zero-or-many",
						toCardinality: "zero-or-one",
					},
				],
			}).relationships,
		).toHaveLength(1);
	});
});

describe("ER shorthand", () => {
	it("reads a field written on one line", () => {
		expect(parseErFieldShorthand("id uuid PK")).toEqual({ name: "id", type: "uuid", pk: true });
		expect(parseErFieldShorthand("order_id uuid PK FK")).toEqual({
			name: "order_id",
			type: "uuid",
			pk: true,
			fk: true,
		});
		expect(parseErFieldShorthand("email text UNIQUE")).toEqual({
			name: "email",
			type: "text",
			unique: true,
		});
		expect(parseErFieldShorthand("bio text?")).toEqual({
			name: "bio",
			type: "text",
			nullable: true,
		});
		expect(parseErFieldShorthand("manager_id int FK?")).toEqual({
			name: "manager_id",
			type: "int",
			fk: true,
			nullable: true,
		});
		expect(parseErFieldShorthand("price numeric(10, 2) NOT NULL")).toEqual({
			name: "price",
			type: "numeric(10, 2)",
		});
		expect(parseErFieldShorthand("PK id uuid")).toEqual({ name: "id", type: "uuid", pk: true });
		expect(parseErFieldShorthand("note?")).toEqual({ name: "note", nullable: true });
		expect(parseErFieldShorthand("created_at timestamp with time zone NULL")).toEqual({
			name: "created_at",
			type: "timestamp with time zone",
			nullable: true,
		});
	});

	it("reads cardinality aliases and keeps unknown values for decoding to report", () => {
		expect(resolveErCardinality("1")).toBe("one");
		expect(resolveErCardinality("Exactly One")).toBe("one");
		expect(resolveErCardinality("0..1")).toBe("zero-or-one");
		expect(resolveErCardinality("*")).toBe("many");
		expect(resolveErCardinality("one or more")).toBe("one-or-many");
		expect(resolveErCardinality("0..*")).toBe("zero-or-many");
		expect(resolveErCardinality("zero_or_many")).toBe("zero-or-many");
		expect(resolveErCardinality("lots")).toBe("lots");
	});

	it("resolves shorthand fields, from/to aliases and a combined cardinality before decoding", () => {
		const resolved = resolveErShorthand({
			title: "Shop",
			entities: [
				{ id: "customers", fields: ["id uuid PK"] },
				{ id: "orders", fields: ["id uuid PK", "customer_id uuid FK"] },
			],
			relationships: [
				{ source: "customers.id", target: "orders.customer_id", cardinality: "1:N" },
				{ from: "orders", to: "customers", cardinality: "weird" },
			],
		});
		expect(resolved).toEqual({
			title: "Shop",
			entities: [
				{ id: "customers", fields: [{ name: "id", type: "uuid", pk: true }] },
				{
					id: "orders",
					fields: [
						{ name: "id", type: "uuid", pk: true },
						{ name: "customer_id", type: "uuid", fk: true },
					],
				},
			],
			relationships: [
				{
					from: "customers.id",
					to: "orders.customer_id",
					fromCardinality: "one",
					toCardinality: "many",
				},
				{ from: "orders", to: "customers", cardinality: "weird" },
			],
		});
	});
});
