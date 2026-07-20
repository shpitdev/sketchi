import { assert, describe, it } from "@effect/vitest";
import { FlowchartSpec, MindmapSpec } from "@sketchi/diagram-agent";
import { Effect } from "effect";
import { FastCheck } from "effect/testing";

import {
  documentId,
  parseJsonDocument,
  validateStorageId,
} from "./document.js";
import { flowchartInput, mindmapInput } from "./__tests__/fixtures.js";

describe("canonical document decoding", () => {
  it.effect(
    "decodes flowchart and mindmap documents through package authority",
    () =>
      Effect.gen(function* () {
        const flowchart = yield* parseJsonDocument(
          JSON.stringify(flowchartInput),
        );
        const mindmap = yield* parseJsonDocument(JSON.stringify(mindmapInput));

        assert.strictEqual(flowchart.type, "flowchart");
        assert.instanceOf(flowchart.spec, FlowchartSpec);
        assert.strictEqual(flowchart.spec.layout.direction, "TB");
        assert.strictEqual(mindmap.type, "mindmap");
        assert.instanceOf(mindmap.spec, MindmapSpec);
        assert.strictEqual(mindmap.spec.layout.direction, "LR");
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
      id: FastCheck.tuple(
        FastCheck.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"),
        FastCheck.array(
          FastCheck.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789._-"),
          { maxLength: 48 },
        ),
      ).map(([head, tail]) => `${head}${tail.join("")}`),
    },
    ({ id }) =>
      Effect.gen(function* () {
        assert.strictEqual(yield* validateStorageId(id), id);
      }),
  );
});
