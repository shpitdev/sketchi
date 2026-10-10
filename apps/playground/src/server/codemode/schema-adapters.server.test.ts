import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  BuildFlowchartResultSchema,
  GetArtifactRequestSchema,
} from "@sketchi/diagram-agent";

import { CodeModeSearchRequestSchema } from "./mcp-docs.server";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";

const SearchRequestInputSchema = Schema.Struct({
  query: Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z ]{0,79}$/u)),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
});
const GetArtifactInputSchema = Schema.Struct({
  artifactId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,80}$/u)),
  format: Schema.Literals(["scene", "excalidraw", "png"]),
  inline: Schema.Boolean,
});

describe("Playground Effect schema adapters", () => {
  it.effect.prop(
    "accepts every generated MCP search request through Standard Schema",
    {
      input: SearchRequestInputSchema,
    },
    ({ input }) =>
      Effect.promise(async () => {
        const result =
          await CodeModeSearchRequestSchema["~standard"].validate(input);
        assert.isTrue("value" in result);
        if ("value" in result) {
          assert.deepEqual(result.value, input);
        }
      }),
  );

  it.effect.prop(
    "preserves generated package inputs through Standard Schema",
    {
      input: GetArtifactInputSchema,
    },
    ({ input }) =>
      Effect.promise(async () => {
        const result = await toPlaygroundStandardSchema(
          GetArtifactRequestSchema,
        )["~standard"].validate(input);
        if ("issues" in result)
          return assert.fail("Expected a valid package input.");
        const decoded = result.value;
        if (decoded === null || typeof decoded !== "object") {
          return assert.fail("Standard Schema returned a non-object input.");
        }
        assert.deepEqual(Object.fromEntries(Object.entries(decoded)), input);
      }),
  );

  it.effect(
    "reports bounded MCP search failures with Standard Schema paths",
    () =>
      Effect.promise(async () => {
        const emptyQuery = await CodeModeSearchRequestSchema[
          "~standard"
        ].validate({ query: "" });
        assert.isTrue("issues" in emptyQuery);
        if ("issues" in emptyQuery) {
          assert.deepStrictEqual(emptyQuery.issues?.[0]?.path, ["query"]);
        }

        const excessiveLimit = await CodeModeSearchRequestSchema[
          "~standard"
        ].validate({ query: "diagram", limit: 21 });
        assert.isTrue("issues" in excessiveLimit);
        if ("issues" in excessiveLimit) {
          assert.deepStrictEqual(excessiveLimit.issues?.[0]?.path, ["limit"]);
        }
      }),
  );

  it.effect("validates canonical route repair issues at the output edge", () =>
    Effect.promise(async () => {
      const result = await toPlaygroundStandardSchema(
        BuildFlowchartResultSchema,
      )["~standard"].validate({
        ok: false,
        status: "invalid_input",
        issues: [
          {
            code: "missing_field",
            severity: "error",
            stage: "input",
            ref: { kind: "request", path: "spec" },
            message: 'Required at "spec".',
            hint: "Provide spec.",
          },
        ],
      });
      assert.isTrue("value" in result);
    }),
  );
});
