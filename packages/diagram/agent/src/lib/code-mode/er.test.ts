import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { erFixture, orgChartEr } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildErDiagramResultSchema } from "./contract.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { applyDiagramPatch, buildErDiagram, CodeModeRuntimeEnvironment } from "./runtime.js";

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
		}),
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

describe("Code Mode native ER diagram", () => {
	it("builds the documented spec into tables and a crow's-foot line bound to its rows", async () => {
		const built = await build(shopSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(BuildErDiagramResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec.entities[1]).toEqual({
			id: "orders",
			fields: [
				{ name: "id", type: "uuid", pk: true },
				{ name: "customer_id", type: "uuid", fk: true },
				{ name: "shipped_at", type: "date", nullable: true },
			],
		});
		expect(built.normalizedSpec.relationships[0]).toMatchObject({ id: "relationship-1" });
		expect(built.quality.summary).toEqual({ nodeCount: 2, edgeCount: 1 });
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
		// Every table element moves together.
		const orders = excalidraw.elements.filter((element) =>
			(element["groupIds"] as string[]).includes("table:orders"),
		);
		expect(orders.map((element) => element.id).sort()).toEqual([
			"label:orders:header",
			"node:orders",
			"node:orders:header",
			"node:orders:optional:0",
			"text:orders:fields",
			"text:orders:keys",
			"text:orders:types",
		]);
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

	it("assigns omitted relationship ids clear of explicit ones", async () => {
		const built = await build({
			...shopSpec,
			relationships: [
				shopSpec.relationships[0],
				{
					id: "relationship-1",
					from: "customers",
					to: "orders",
					fromCardinality: "one",
					toCardinality: "many",
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.relationships.map((relationship) => relationship.id)).toEqual([
			"relationship-2",
			"relationship-1",
		]);
	});

	it("keeps table and ring roles through a patch, with no name drawn in a table's middle", async () => {
		const built = await build(shopSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{ op: "setStyle", selector: { nodeIds: ["orders"] }, style: { strokeColor: "#1f44c9" } },
				],
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene", "excalidraw"],
				},
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const formats = new Map(
			patched.artifact.formats.map((format) => [format.format, format.inline]),
		);
		const scene = formats.get("scene") as RenderedDiagramScene;
		const roles = scene.elements.flatMap((element) =>
			element.type === "node" ? [[element.id, element.rendererRole]] : [],
		);
		expect(Object.fromEntries(roles)).toEqual({
			"node:customers": "er-table",
			"node:customers:header": "er-table",
			"node:orders": "er-table",
			"node:orders:header": "er-table",
			"node:orders:optional:0": "er-optional",
		});
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		// Only the name band carries the table's name.
		expect(
			excalidraw.elements.filter(
				(element) => element.type === "text" && element["text"] === "orders",
			),
		).toHaveLength(1);
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

	it.each([
		[
			{ relationships: [{ ...shopSpec.relationships[0], to: "customers.uuid" }] },
			"unknown_relationship_field",
		],
		[
			{ relationships: [{ ...shopSpec.relationships[0], to: "clients.id" }] },
			"missing_edge_target",
		],
		[
			{ relationships: [{ ...shopSpec.relationships[0], from: "carts.customer_id" }] },
			"missing_edge_source",
		],
		[
			{
				entities: [shopSpec.entities[0], { id: "orders", fields: ["id uuid PK", "ID int"] }],
				relationships: [],
			},
			"invalid_field",
		],
		[{ entities: [{ id: "orders", fields: ["id uuid PK?"] }], relationships: [] }, "invalid_field"],
		[{ entities: [{ id: "public.orders", fields: [] }], relationships: [] }, "invalid_entity"],
		[
			{
				relationships: [
					{ from: "orders.id", to: "orders.id", fromCardinality: "one", toCardinality: "one" },
				],
			},
			"invalid_relationship",
		],
	])("rejects %j with a structured repair issue", async (change, code) => {
		const result = await build({ ...shopSpec, ...change });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_er_diagram");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.ref?.path?.startsWith("spec."))).toBe(
			true,
		);
	});

	it("rejects an unknown cardinality before building, naming the allowed values", async () => {
		const result = await build({
			...shopSpec,
			relationships: [{ ...shopSpec.relationships[0], toCardinality: "lots" }],
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(JSON.stringify(result.issues)).toContain("zero-or-many");
	});
});
