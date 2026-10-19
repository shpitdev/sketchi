import {
	CodeModeArtifactStorageMemory,
	makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import {
	canonicalDocument,
	flowchartInput,
	mindmapInput,
	sequenceInput,
} from "./__tests__/fixtures.js";

const builderLayer = DiagramBuilderLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			CodeModeArtifactStorageMemory,
			makeCodeModeRuntimeEnvironmentLayer({
				createId: (prefix) => `${prefix}_cli_layer_test`,
			}),
		),
	),
);

layer(builderLayer)("Effect-native Code Mode builder layer", (it) => {
	it.effect("builds every canonical document type into stored offline artifacts", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const flowchart = yield* builder.build(canonicalDocument(flowchartInput));
			const mindmap = yield* builder.build(canonicalDocument(mindmapInput));
			const sequence = yield* builder.build(canonicalDocument(sequenceInput));

			assert.strictEqual(flowchart.type, "flowchart");
			assert.isAbove(flowchart.scene.elements.length, 0);
			assert.strictEqual(flowchart.excalidraw.type, "excalidraw");
			assert.strictEqual(mindmap.type, "mindmap");
			assert.isAbove(mindmap.scene.elements.length, 0);
			assert.strictEqual(mindmap.png, undefined);
			assert.strictEqual(sequence.type, "sequence");
			assert.isAbove(sequence.scene.elements.length, 0);
			assert.strictEqual(sequence.excalidraw.type, "excalidraw");
		}),
	);

	it.effect("builds a flowchart document's declared lanes into lane bands", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const built = yield* builder.build(
				canonicalDocument({
					type: "flowchart",
					spec: {
						title: "Ticket handling",
						lanes: [
							{ id: "customer", label: "Customer" },
							{ id: "support", label: "Support" },
						],
						nodes: [
							{ id: "open", label: "Open a ticket", kind: "start", lane: "customer" },
							{ id: "answer", label: "Answer the ticket", kind: "end", lane: "support" },
						],
						edges: [{ source: "open", target: "answer" }],
					},
				}),
			);
			assert.deepStrictEqual(
				built.scene.elements.flatMap((element) =>
					element.type === "node" && element.rendererRole === "swimlane" ? [element.label] : [],
				),
				["Customer", "Support"],
			);
		}),
	);

	it.effect("builds a flowchart document's nested zones and shapes into zones and a cylinder", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const built = yield* builder.build(
				canonicalDocument({
					type: "flowchart",
					spec: {
						title: "Web app in a VPC",
						groups: [
							{ id: "vpc", label: "VPC", kind: "vpc" },
							{ id: "private", label: "Private subnet", kind: "subnet", parent: "vpc" },
						],
						nodes: [
							{ id: "users", label: "Users", kind: "start" },
							{ id: "api", label: "API service", kind: "process", group: "private" },
							{ id: "db", label: "Orders database", kind: "end", shape: "database", group: "vpc" },
						],
						edges: [
							{ source: "users", target: "api" },
							{ source: "api", target: "db" },
						],
					},
				}),
			);
			assert.deepStrictEqual(
				built.scene.elements.flatMap((element) =>
					element.type === "node" && element.rendererRole === "zone" ? [element.label] : [],
				),
				["VPC", "Private subnet"],
			);
			const db = built.scene.elements.find((element) => element.id === "node:db");
			assert.strictEqual(db?.type === "node" ? db.shape : undefined, "cylinder");
		}),
	);

	it.effect("maps Code Mode quality failures to typed CLI validation", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const invalid = canonicalDocument({
				type: "flowchart",
				spec: {
					id: "broken-decision",
					title: "Broken decision",
					nodes: [
						{ id: "start", label: "Start", kind: "start" },
						{ id: "decision", label: "Ready?", kind: "decision" },
						{ id: "end", label: "Done", kind: "end" },
					],
					edges: [
						{ source: "start", target: "decision" },
						{ source: "decision", target: "end", label: "Yes" },
					],
				},
			});
			const error = yield* Effect.flip(builder.build(invalid));

			assert.strictEqual(error._tag, "CliValidationError");
			if (error._tag === "CliValidationError") {
				assert.isAbove(error.details.length, 0);
			}
		}),
	);
});
