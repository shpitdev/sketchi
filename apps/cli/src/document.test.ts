import { SequenceDocument } from "@sketchi/diagrams/families/sequence/document";
import { FlowchartDocumentSchema } from "@sketchi/diagrams/families/flowchart/document";
import { assert, describe, it } from "@effect/vitest";

import { MindmapDocument } from "@sketchi/diagrams/families/mindmap/index";
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
			assert.isTrue(Schema.is(FlowchartDocumentSchema)(flowchart.spec));
			assert.strictEqual(mindmap.type, "mindmap");
			assert(Schema.is(MindmapDocument)(mindmap.spec));
			assert.strictEqual(mindmap.spec.layout.direction, "LR");
			assert.strictEqual(sequence.type, "sequence");
			assert(Schema.is(SequenceDocument)(sequence.spec));
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

	it.effect("reports spec-relative schema paths once for converted and unconverted families", () =>
		Effect.gen(function* () {
			for (const type of ["sequence", "mindmap", "venn", "flowchart", "timeline"]) {
				const error = yield* Effect.flip(
					parseJsonDocument(JSON.stringify({ type, spec: { title: 42 } })),
				);
				assert.strictEqual(error._tag, "CliValidationError");
				if (error._tag === "CliValidationError") {
					assert.isTrue(
						error.details.some((detail) => detail.startsWith("spec.title:")),
						type,
					);
					assert.isFalse(
						error.details.some((detail) => detail.startsWith("spec.spec.")),
						type,
					);
				}
			}
		}),
	);

	it.effect("rejects oversized mindmap slots before decoding malformed children", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				parseJsonDocument(
					JSON.stringify({
						type: "mindmap",
						spec: {
							title: "Too many",
							root: { label: "Root", children: Array.from({ length: 201 }, () => null) },
						},
					}),
				),
			);
			assert.strictEqual(error._tag, "CliValidationError");
			if (error._tag === "CliValidationError") {
				assert.strictEqual(error.details.length, 1);
				assert.include(error.details[0], "maximum of 200 topic slots");
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
