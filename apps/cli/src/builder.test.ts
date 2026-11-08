import {
	CodeModeArtifactStorageMemory,
	makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import {
	canonicalDocument,
	compositeStateMachineInput,
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
	it.effect("retains accepted composite-default warnings for CLI reporting", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const built = yield* builder.build(canonicalDocument(compositeStateMachineInput));
			assert.strictEqual(built.warnings?.[0]?.code, "composite_initial_defaulted");
			assert.include(built.warnings?.[0]?.message ?? "", '"playing"');
		}),
	);

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
						nodes: {
							open: "Open a ticket",
							answer: "Answer the ticket",
						},
						edges: [["open", "answer"]],
						lanes: {
							customer: { label: "Customer", contains: ["open"] },
							support: { label: "Support", contains: ["answer"] },
						},
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
						nodes: {
							users: "Users",
							api: "API service",
							db: { label: "Orders database", shape: "database" },
						},
						edges: [
							["users", "api"],
							["api", "db"],
						],
						groups: {
							vpc: { label: "VPC", kind: "vpc", contains: ["db", "private"] },
							private: { label: "Private subnet", kind: "subnet", contains: ["api"] },
						},
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
					id: "two-islands",
					title: "Two islands",
					nodes: {
						order: "Take order",
						ship: "Ship order",
						invoice: "Send invoice",
						paid: "Record payment",
					},
					edges: [
						["order", "ship"],
						["invoice", "paid"],
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
