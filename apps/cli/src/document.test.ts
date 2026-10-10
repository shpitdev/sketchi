import { assert, describe, it } from "@effect/vitest";
import { FlowchartSpec, MindmapSpec, SequenceDiagramSpec } from "@sketchi/diagram-agent";
import { Effect, Schema } from "effect";

import { documentId, parseJsonDocument, validateStorageId } from "./document.js";
import { flowchartInput, mindmapInput, sequenceInput } from "./__tests__/fixtures.js";

const PathSafeStorageIdSchema = Schema.String.check(
	Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,48}$/u),
);

describe("canonical document decoding", () => {
	it.effect("decodes all canonical documents through package authority", () =>
		Effect.gen(function* () {
			const flowchart = yield* parseJsonDocument(JSON.stringify(flowchartInput));
			const mindmap = yield* parseJsonDocument(JSON.stringify(mindmapInput));
			const sequence = yield* parseJsonDocument(JSON.stringify(sequenceInput));

			assert.strictEqual(flowchart.type, "flowchart");
			assert.instanceOf(flowchart.spec, FlowchartSpec);
			assert.strictEqual(flowchart.spec.layout.direction, "TB");
			assert.strictEqual(mindmap.type, "mindmap");
			assert.instanceOf(mindmap.spec, MindmapSpec);
			assert.strictEqual(mindmap.spec.layout.direction, "LR");
			assert.strictEqual(sequence.type, "sequence");
			assert.instanceOf(sequence.spec, SequenceDiagramSpec);
			assert.strictEqual(sequence.spec.messages.length, 4);
		}),
	);

	it.effect("keeps malformed JSON and invalid documents distinct", () =>
		Effect.gen(function* () {
			const malformed = yield* Effect.flip(parseJsonDocument("{"));
			const invalid = yield* Effect.flip(parseJsonDocument("{}"));

			assert.strictEqual(malformed._tag, "CliInputError");
			if (malformed._tag === "CliInputError") {
				assert.strictEqual(malformed.code, "invalid_json");
			}
			assert.strictEqual(invalid._tag, "CliValidationError");
			if (invalid._tag === "CliValidationError") {
				assert.isAbove(invalid.details.length, 0);
			}
		}),
	);

	it.effect("derives a deterministic id when the shared spec omits one", () =>
		Effect.gen(function* () {
			const document = yield* parseJsonDocument(
				JSON.stringify({
					...mindmapInput,
					spec: {
						...mindmapInput.spec,
						id: undefined,
						title: "  Launch & Learn  ",
					},
				}),
			);

			assert.strictEqual(documentId(document), "launch-learn");
		}),
	);

	it.effect.prop(
		"accepts every generated path-safe storage id without rewriting it",
		{
			id: PathSafeStorageIdSchema,
		},
		({ id }) =>
			Effect.gen(function* () {
				assert.strictEqual(yield* validateStorageId(id), id);
			}),
	);
});
