import { assert, describe, it, layer } from "@effect/vitest";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import {
	renderSequenceDiagram,
	type RenderedDiagramScene as RendererScene,
} from "@sketchi/diagram-renderer";
import {
	makeTelemetryTestSink,
	makeWorkersTelemetryLayer,
	type TelemetryMetricEvent,
	type TelemetrySpanEvent,
} from "@sketchi/observability";
import { Cause, Effect, Exit, Fiber, Layer, Schema, Result } from "effect";

import { CodeModeArtifactStorageMemory } from "./artifacts";
import {
	formatContractSchemaError,
	BuildFlowchartRequestSchema,
	BuildSequenceDiagramRequestSchema,
	DIAGRAM_PATCH_OPERATION_NAMES,
	DiagramPatchOperationSchema,
	MindmapTopicSchema,
	RenderedDiagramSceneSchema,
	toCodeModeJsonSchema,
} from "./contract";
import { applyDiagramPatch, buildFlowchart, makeCodeModeRuntimeEnvironmentLayer } from "./runtime";

const renderingStarted = Promise.withResolvers<void>();
const patchOperationNames = new Set<string>(DIAGRAM_PATCH_OPERATION_NAMES);
const UnsupportedPatchOperationSchema = Schema.String.check(
	Schema.isBetweenLength(1, 40),
	Schema.makeFilter((operation) => !patchOperationNames.has(operation)),
);

const runtimeLayer = Layer.mergeAll(
	CodeModeArtifactStorageMemory,
	makeCodeModeRuntimeEnvironmentLayer({
		createId: (prefix) => `${prefix}-effect-test`,
		renderer: {
			renderPng: () =>
				Effect.sync(() => renderingStarted.resolve()).pipe(Effect.andThen(Effect.never)),
		},
	}),
);

describe("Code Mode telemetry", () => {
	it.effect("records bounded stage spans, correlation, and boundary metrics", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const telemetryLayer = makeWorkersTelemetryLayer({
			resource: { serviceName: "sketchi-codemode-test" },
			sink,
		});

		return Effect.gen(function* () {
			const result = yield* buildFlowchart({
				requestId: "request-effect-telemetry",
				spec: {
					title: "Simple approval flow",
					nodes: [
						{ id: "request", label: "Request arrives", kind: "start" },
						{ id: "approve", label: "Approved?", kind: "decision" },
						{ id: "done", label: "Done", kind: "end" },
						{ id: "revise", label: "Revise", kind: "end" },
					],
					edges: [
						{ source: "request", target: "approve" },
						{ source: "approve", target: "done", label: "yes" },
						{ source: "approve", target: "revise", label: "no" },
					],
					layout: { direction: "TB" },
				},
			});
			assert.isTrue(result.ok);

			const spans = probe.events.filter(
				(event): event is TelemetrySpanEvent => event.event === "effect.span",
			);
			const metrics = probe.events.filter(
				(event): event is TelemetryMetricEvent => event.event === "effect.metric",
			);
			assert.deepInclude(
				spans.find((span) => span.name === "codeMode.artifacts.store")?.attributes,
				{ "sketchi.request_id": "request-effect-telemetry" },
			);
			assert.isTrue(spans.some((span) => span.name === "codeMode.buildFlowchart.render"));
			assert.isTrue(spans.some((span) => span.name === "codeMode.artifacts.exportAndStore"));
			assert.isFalse(
				spans.some((span) =>
					/\.(parse|normalize|validate|quality|preflight|operations)$/.test(span.name),
				),
			);
			assert.deepInclude(
				spans.find((span) => span.name === "codeMode.artifacts.store")?.attributes,
				{ "sketchi.artifact_id": "artifact-effect-test" },
			);
			assert.deepInclude(
				metrics.find((metric) => metric.metric === "sketchi_codemode_requests")?.attributes,
				{
					operation: "buildFlowchart",
					outcome: "success",
					surface: "code_mode",
				},
			);
			assert.isTrue(metrics.some((metric) => metric.metric === "sketchi_codemode_artifacts"));
		}).pipe(Effect.provide(Layer.merge(runtimeLayer, telemetryLayer)));
	});
});

describe("structured contract issue metadata", () => {
	it("does not attach parser facades to contract schemas", () => {
		for (const schema of [
			BuildFlowchartRequestSchema,
			BuildSequenceDiagramRequestSchema,
			MindmapTopicSchema,
			RenderedDiagramSceneSchema,
		]) {
			assert.isFalse("parse" in schema);
			assert.isFalse("safeParse" in schema);
		}
	});

	it("retains literal-union kind when display wording changes", () => {
		const result = Schema.decodeUnknownResult(
			Schema.Literals(["scene", "png"]).annotate({
				message: "Choose a supported format.",
			}),
			{ errors: "all", reportInput: true },
		)("svg");
		assert.isFalse(Result.isSuccess(result));
		if (Result.isSuccess(result)) return assert.fail("Invalid format unexpectedly decoded.");
		assert.deepInclude(formatContractSchemaError(result.failure).issues[0], {
			issueTag: "AnyOf",
			astKind: "LiteralUnion",
			message: "Choose a supported format.",
		});
	});
	it("retains discriminator paths when display wording changes", () => {
		const schema = Schema.Struct({
			operations: Schema.Array(
				DiagramPatchOperationSchema.annotate({
					message: "Choose a supported operation.",
				}),
			),
		});
		const result = Schema.decodeUnknownResult(schema, {
			errors: "all",
			reportInput: true,
		})({
			operations: [{ op: "unknown" }],
		});
		assert.isFalse(Result.isSuccess(result));
		if (Result.isSuccess(result)) return assert.fail("Invalid operation unexpectedly decoded.");
		assert.deepInclude(formatContractSchemaError(result.failure).issues[0], {
			issueTag: "AnyOf",
			astKind: "Union",
			message: "Choose a supported operation.",
			path: ["operations", 0, "op"],
		});
	});
});

layer(runtimeLayer)("Code Mode Effect workflow", (it) => {
	it("keeps legacy style input decodable but out of the model contract", () => {
		const legacy = Schema.decodeUnknownSync(BuildFlowchartRequestSchema, {
			errors: "all",
			reportInput: true,
		})({
			spec: {
				title: "Legacy style",
				nodes: [{ id: "start", kind: "start", label: "Start" }],
				style: { accentColor: "#7c3aed", backgroundColor: "#ffffff" },
			},
		});
		assert.deepInclude(legacy.spec.style, {
			accentColor: "#7c3aed",
			backgroundColor: "#ffffff",
		});
		assert.notInclude(
			JSON.stringify(toCodeModeJsonSchema(BuildFlowchartRequestSchema.omit({ options: true }))),
			'"style"',
		);
	});

	it.effect("preserves golden request encoding and failure output", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeUnknownEffect(BuildFlowchartRequestSchema, {
				errors: "all",
				reportInput: true,
			})({
				spec: {
					nodes: [{ id: "start", kind: "start", label: "Start" }],
					title: "Golden flow",
				},
			});
			const encoded = yield* Schema.encodeEffect(BuildFlowchartRequestSchema)(decoded);
			assert.deepStrictEqual(encoded, {
				spec: {
					title: "Golden flow",
					nodes: [{ id: "start", label: "Start", kind: "start" }],
					edges: [],
					layout: { direction: "TB" },
					style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
				},
			});

			const failure = Schema.decodeUnknownResult(BuildFlowchartRequestSchema, {
				errors: "all",
				reportInput: true,
			})({
				requestId: "",
				spec: { nodes: [], title: "" },
			});
			assert.isFalse(Result.isSuccess(failure));
			if (Result.isSuccess(failure)) {
				return assert.fail("Invalid golden request unexpectedly decoded.");
			}
			assert.deepStrictEqual(formatContractSchemaError(failure.failure).issues, [
				{
					code: "custom",
					issueTag: "Filter",
					astKind: "String",
					message: "Too small: expected string to have >=1 characters",
					path: ["requestId"],
				},
				{
					code: "custom",
					issueTag: "Filter",
					astKind: "String",
					message: "Too small: expected string to have >=1 characters",
					path: ["spec", "title"],
				},
				{
					code: "custom",
					issueTag: "Filter",
					astKind: "Arrays",
					message: "Too small: expected array to have >=1 items",
					path: ["spec", "nodes"],
				},
			]);
		}),
	);

	it.effect.prop(
		"round-trips arbitrary recursive mindmap topics",
		{ topic: MindmapTopicSchema },
		({ topic }) =>
			Effect.gen(function* () {
				const encoded = yield* Schema.encodeEffect(MindmapTopicSchema)(topic);
				const decoded = yield* Schema.decodeUnknownEffect(MindmapTopicSchema)(encoded);
				assert.deepStrictEqual(decoded, topic);
			}),
	);

	it.effect("validates and defaults the sequence diagram contract", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeUnknownEffect(BuildSequenceDiagramRequestSchema, {
				errors: "all",
				reportInput: true,
			})({
				spec: {
					title: "Checkout",
					participants: [
						{ id: "customer", label: "Customer" },
						{ id: "store", label: "Store" },
					],
					messages: [
						{
							source: "customer",
							target: "store",
							label: "Checkout",
							type: "message",
						},
					],
				},
			});
			const encoded = yield* Schema.encodeEffect(BuildSequenceDiagramRequestSchema)(decoded);
			assert.deepStrictEqual(encoded, {
				spec: {
					title: "Checkout",
					participants: [
						{ id: "customer", label: "Customer" },
						{ id: "store", label: "Store" },
					],
					messages: [
						{
							source: "customer",
							target: "store",
							label: "Checkout",
							type: "message",
						},
					],
					style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
				},
			});

			const malformed = Schema.decodeUnknownResult(BuildSequenceDiagramRequestSchema, {
				errors: "all",
				reportInput: true,
			})({
				spec: {
					title: "Checkout",
					participants: [{ id: "store", label: "Store" }],
					messages: [{ source: "store", target: "store" }],
				},
			});
			assert.isFalse(Result.isSuccess(malformed));
			if (Result.isSuccess(malformed)) {
				return assert.fail("Malformed sequence message unexpectedly decoded.");
			}
			assert.deepInclude(formatContractSchemaError(malformed.failure).issues[0], {
				path: ["spec", "messages", 0, "label"],
			});
		}),
	);

	it.effect("preserves sequence stroke styles through scene encoding", () =>
		Effect.gen(function* () {
			const rendered = renderSequenceDiagram({
				type: "sequence",
				id: "return-message",
				title: "Return message",
				participants: [
					{ id: "client", label: "Client" },
					{ id: "api", label: "API" },
				],
				messages: [
					{
						id: "response",
						source: "api",
						target: "client",
						label: "Response",
						type: "return",
					},
				],
				style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
			});
			const encoded = yield* Schema.encodeEffect(RenderedDiagramSceneSchema)(
				yield* Schema.decodeUnknownEffect(RenderedDiagramSceneSchema, {
					errors: "all",
					reportInput: true,
				})(rendered),
			);
			const decoded = yield* Schema.decodeUnknownEffect(RenderedDiagramSceneSchema)(encoded);
			const converted = convertSceneToExcalidraw(decoded as RendererScene);

			assert.deepInclude(
				converted.elements.find((element) => element.id === "arrow:response"),
				{ strokeStyle: "dashed" },
			);
			assert.deepInclude(
				converted.elements.find((element) => element.id === "node:api:lifeline"),
				{ customData: { sketchiRendererRole: "sequence-lifeline" } },
			);
		}),
	);

	it.effect("forwards renderer cancellation and preserves interruption", () =>
		Effect.gen(function* () {
			const fiber = yield* Effect.forkChild(
				buildFlowchart({
					spec: {
						title: "Simple approval flow",
						nodes: [
							{ id: "request", label: "Request arrives", kind: "start" },
							{ id: "approve", label: "Approved?", kind: "decision" },
							{ id: "done", label: "Done", kind: "end" },
							{ id: "revise", label: "Revise", kind: "end" },
						],
						edges: [
							{ source: "request", target: "approve" },
							{ source: "approve", target: "done", label: "yes" },
							{ source: "approve", target: "revise", label: "no" },
						],
						layout: { direction: "TB" },
					},
					options: { artifactFormats: ["png"] },
				}),
			);
			yield* Effect.promise(() => renderingStarted.promise);
			yield* Fiber.interrupt(fiber);
			const exit = yield* Fiber.await(fiber);

			if (Exit.isSuccess(exit)) {
				return assert.fail("Interrupted Code Mode build unexpectedly succeeded.");
			}
			assert.isTrue(Cause.hasInterrupts(exit.cause));
		}),
	);

	it.effect.prop(
		"keeps arbitrary unsupported patch operations on the canonical schema issue path",
		{
			operation: UnsupportedPatchOperationSchema,
		},
		({ operation }) =>
			Effect.gen(function* () {
				const result = yield* applyDiagramPatch({
					source: { artifactId: "artifact-source" },
					operations: [{ op: operation }],
				});

				assert.isFalse(result.ok);
				if (result.ok) {
					return assert.fail("Unsupported patch operation was accepted.");
				}
				assert.strictEqual(result.status, "invalid_input");
				assert.deepInclude(result.issues[0], {
					code: "unsupported_patch_operation",
					ref: { kind: "request", path: "operations.[0].op" },
				});
				assert.include(result.issues[0]?.hint, DIAGRAM_PATCH_OPERATION_NAMES.join(", "));
			}),
	);
});
