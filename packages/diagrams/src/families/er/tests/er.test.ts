import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import {
	ER_MAX_ENTITIES,
	type ErDiagram,
	erFixture,
	ErValidationIssueCodeSchema,
	getErValidationIssues,
	orgChartEr,
} from "../document.js";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts.js";
import { erBuild } from "../build.js";
import { buildResponse } from "../../../build/operation.js";
import { canonicalDocumentFromDiagram } from "../../../build/documents.js";
import { buildErDiagram } from "../../../build/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime.js";

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
		buildErDiagram({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(buildResponse),
	);
}

/** The documented example: one-line fields, relationship ids omitted. */
const shopSpec = {
	title: "Shop",
	entities: [
		{ id: "customers", fields: ["id uuid PK", "email text UK"] },
		{ id: "orders", fields: ["id uuid PK", "customer_id uuid FK", "shipped_at date?"] },
	],
	relationships: [
		{
			from: "orders.customer_id",
			to: "customers.id",
			fromCardinality: "zero-or-many",
			toCardinality: "one",
			label: "places",
		},
	],
};

describe("Code Mode ER diagram", () => {
	it("builds the documented spec into tables and a crow's-foot line bound to its rows", async () => {
		const built = await build(shopSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(erBuild.result)(built)).not.toThrow();
		expect(built.normalizedSpec.entities[1]).toEqual({
			id: "orders",
			fields: [
				{ name: "id", type: "uuid", pk: true },
				{ name: "customer_id", type: "uuid", fk: true },
				{ name: "shipped_at", type: "date", nullable: true },
			],
		});
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const line = excalidraw.elements.find((element) => element.id === "edge:relationship-1")!;
		// The one end leaves customers; the zero-or-many end draws a foot and a ring at orders.
		expect(line).toMatchObject({
			startArrowhead: "crowfoot_one",
			endArrowhead: "crowfoot_many",
			elbowed: true,
		});
		expect(excalidraw.elements.filter((element) => element.type === "ellipse")).toHaveLength(1);
	});

	it("reads cardinality aliases, source/target and a combined cardinality", async () => {
		const built = await build({
			...shopSpec,
			relationships: [
				{
					source: "orders.customer_id",
					target: "customers.id",
					fromCardinality: "0..*",
					toCardinality: "1",
				},
				{ from: "customers", to: "orders", cardinality: "one-to-many" },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(
			built.normalizedSpec.relationships.map((relationship) => [
				relationship.from,
				relationship.fromCardinality,
				relationship.to,
				relationship.toCardinality,
			]),
		).toEqual([
			["orders.customer_id", "zero-or-many", "customers.id", "one"],
			["customers", "one", "orders", "many"],
		]);
	});

	it("round-trips canonical diagrams through their Code Mode documents", async () => {
		for (const diagram of [erFixture, orgChartEr]) {
			const document = canonicalDocumentFromDiagram(diagram);
			expect(document.type).toBe("er");
			const built = await build(document.spec);
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.entities).toEqual(diagram.entities);
			expect(built.normalizedSpec.relationships).toEqual(diagram.relationships);
		}
	});
});

type Entity = ErDiagram["entities"][number];
type Relationship = ErDiagram["relationships"][number];
const withEntities = (...entities: Entity[]) => [...erFixture.entities, ...entities];
const withRelationships = (...relationships: Relationship[]) => [
	...erFixture.relationships,
	...relationships,
];
const link = (from: string, to: string, id = "extra"): Relationship => ({
	id,
	from,
	to,
	fromCardinality: "one",
	toCardinality: "zero-or-many",
});

/** One minimal bad schema per code the validator owns. */
const bad: Record<string, Partial<ErDiagram>> = {
	er_too_large: {
		entities: withEntities(
			...Array.from({ length: ER_MAX_ENTITIES }, (_, index) => ({ id: `t${index}`, fields: [] })),
		),
	},
	invalid_entity_id: { entities: withEntities({ id: "bad id", fields: [] }) },
	duplicate_entity_id: { entities: withEntities({ id: "orders", fields: [] }) },
	duplicate_entity_name: {
		entities: withEntities({ id: "buyers", name: "Customers", fields: [] }),
	},
	duplicate_field_name: {
		entities: withEntities({ id: "notes", fields: [{ name: "body" }, { name: "Body" }] }),
	},
	er_text_too_long: { entities: withEntities({ id: "notes", fields: [{ name: "x".repeat(65) }] }) },
	nullable_primary_key: {
		entities: withEntities({ id: "notes", fields: [{ name: "id", pk: true, nullable: true }] }),
	},
	duplicate_relationship_id: {
		relationships: withRelationships(link("customers", "orders", "places")),
	},
	missing_relationship_entity: { relationships: withRelationships(link("ghosts", "orders")) },
	missing_relationship_field: {
		relationships: withRelationships(link("orders.ghost_id", "customers.id")),
	},
	self_referencing_field: { relationships: withRelationships(link("orders.id", "orders.id")) },
};

describe("ER validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(ErValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad schema", (code, change) => {
		const issues = getErValidationIssues({ ...erFixture, ...change });
		expect(issues.map((issue) => issue.code)).toContain(code);
	});
});
