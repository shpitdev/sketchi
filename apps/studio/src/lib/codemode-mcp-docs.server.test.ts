import { describe, expect, it } from "vitest";

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
});
