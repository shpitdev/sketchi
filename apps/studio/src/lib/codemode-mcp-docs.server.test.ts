import { describe, expect, it } from "vitest";

import { DIAGRAM_PATCH_OPERATION_NAMES } from "@sketchi/diagram-agent";
import {
  getCodeModeDocs,
  searchCodeModeDocs,
} from "./codemode-mcp-docs.server";

describe("Code Mode MCP docs", () => {
  it("documents the harness-first execute contract", () => {
    const docs = getCodeModeDocs({ topic: "execute" });

    expect(docs.content).toContain("typed host tools");
    expect(docs.content).toContain("sketchi.buildFlowchart");
    expect(docs.content).toContain("sketchi.getArtifact");
    expect(docs.content).toContain("sketchi.applyDiagramPatch");
    expect(docs.examples.map((example) => example.code)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/};\s*$/)]),
    );
    expect(docs.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Accepted graph followed by visual patch",
        }),
      ]),
    );
  });

  it("searches operation guidance and non-goals", () => {
    const patchResults = searchCodeModeDocs({
      query: "purple diamond selector",
    });
    expect(patchResults.results.map((result) => result.id)).toContain(
      "applyDiagramPatch",
    );

    const managedResults = searchCodeModeDocs({
      query: "convex managed threads",
    });
    expect(managedResults.results.map((result) => result.id)).toContain(
      "managed-thread-non-goal",
    );
  });

  it("documents patch envelopes and operation names for harness discovery", () => {
    const docs = getCodeModeDocs({ topic: "applyDiagramPatch" });

    expect(docs.content).toContain("source: { artifactId");
    expect(docs.content).toContain("Supported operation names");
    expect(docs.content).toContain("replaceText");
    expect(docs.content).toContain("strokeColor");
    expect(docs.content).toContain("interface ApplyDiagramPatchRequest");
    expect(docs.content).toContain('"png"');
    expect(docs.content).toContain("hosted visual proof");
    expect(docs.content).not.toContain("{ excalidraw: unknown }");
    expect(docs.content).not.toContain('format?: "scene" | "excalidraw"');
    expect(docs.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringContaining('op: "replaceText"'),
        }),
      ]),
    );

    const operationResults = searchCodeModeDocs({
      query: "setText setLabel rename label operation",
    });
    expect(operationResults.results.map((result) => result.id)).toContain(
      "patchOperations",
    );

    const operationDocs = getCodeModeDocs({ topic: "patchOperations" });
    for (const operationName of DIAGRAM_PATCH_OPERATION_NAMES) {
      expect(operationDocs.content).toContain(operationName);
      expect(
        operationDocs.examples.map((example) => example.code).join("\n"),
      ).toContain(operationName);
    }
  });
});
