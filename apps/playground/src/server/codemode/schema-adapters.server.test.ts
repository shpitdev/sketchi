import { assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { FastCheck } from "effect/testing";

import {
  ApplyDiagramPatchRequestSchema,
  BuildFlowchartRequestSchema,
  BuildMindmapRequestSchema,
  GetArtifactRequestSchema,
  toCodeModeJsonSchema,
} from "@sketchi/diagram-agent";

import { CodeModeSearchRequestSchema } from "./mcp-docs.server";
import {
  CodeModeHttpSchemas,
  decodeCodeModeHttpInput,
} from "./http-schema.server";

describe("Playground Effect schema adapters", () => {
  it("keeps every route input structurally equal to the frozen package authority", () => {
    const schemaPairs = [
      {
        packageSchema: ApplyDiagramPatchRequestSchema,
        routeSchema: CodeModeHttpSchemas.applyDiagramPatch.input,
      },
      {
        packageSchema: BuildFlowchartRequestSchema,
        routeSchema: CodeModeHttpSchemas.buildFlowchart.input,
      },
      {
        packageSchema: BuildMindmapRequestSchema,
        routeSchema: CodeModeHttpSchemas.buildMindmap.input,
      },
      {
        packageSchema: GetArtifactRequestSchema,
        routeSchema: CodeModeHttpSchemas.getArtifact.input,
      },
    ];

    for (const { packageSchema, routeSchema } of schemaPairs) {
      expect(
        routeSchema["~standard"].jsonSchema.input({
          target: "draft-2020-12",
        }),
      ).toEqual(toCodeModeJsonSchema(packageSchema));
    }
  });

  it.effect.prop(
    "accepts every generated MCP search request through Standard Schema",
    {
      input: FastCheck.record({
        query: FastCheck.stringMatching(/^[A-Za-z][A-Za-z ]{0,79}$/),
        limit: FastCheck.integer({ min: 1, max: 20 }),
      }),
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
    "preserves generated package inputs at the HTTP adapter",
    {
      input: FastCheck.record({
        artifactId: FastCheck.stringMatching(/^[A-Za-z0-9_-]{1,80}$/),
        format: FastCheck.constantFrom("scene", "excalidraw", "png"),
        inline: FastCheck.boolean(),
      }),
    },
    ({ input }) =>
      Effect.promise(async () => {
        const decoded = await decodeCodeModeHttpInput(
          CodeModeHttpSchemas.getArtifact.input,
          input,
        );
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
      const result = await CodeModeHttpSchemas.buildFlowchart.output[
        "~standard"
      ].validate({
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
