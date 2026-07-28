import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { DIAGRAM_PATCH_OPERATION_NAMES } from "@sketchi/diagram-agent";
import {
  getCodeModeDocs,
  searchCodeModeDocs,
  SKETCHI_CODE_MODE_TYPES,
  SKETCHI_CODE_MODE_VERSION,
} from "./mcp-docs.server";

describe("Code Mode MCP docs", () => {
  it("documents the harness-first execute contract", () => {
    const docs = getCodeModeDocs({ topic: "execute" });

    expect(docs.content).toContain("typed host tools");
    expect(docs.content).toContain("sketchi.buildFlowchart");
    expect(docs.content).toContain("sketchi.buildMindmap");
    expect(docs.content).toContain("sketchi.buildSequenceDiagram");
    expect(docs.content).toContain("sketchi.getArtifact");
    expect(docs.content).toContain("sketchi.applyDiagramPatch");
    expect(docs.content).toContain("Excalidraw and PNG URLs");
    expect(docs.content).toContain("artifactDelivery");
    expect(docs.content).toContain("finalResponseText");
    expect(docs.content).toContain("Do not synthesize a Mermaid");
    expect(docs.content).toContain("Do not call file/create/artifact tools");
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

  it("emits a complete semantic-builder public type contract", () => {
    expect(SKETCHI_CODE_MODE_VERSION).toBe("2026-07-23");
    expect(SKETCHI_CODE_MODE_TYPES).toContain("interface BuildMindmapRequest");
    expect(SKETCHI_CODE_MODE_TYPES).toContain("type BuildMindmapResult");
    expect(SKETCHI_CODE_MODE_TYPES).toContain(
      "interface BuildSequenceDiagramRequest",
    );
    expect(SKETCHI_CODE_MODE_TYPES).toContain(
      "type BuildSequenceDiagramResult",
    );
    expect(SKETCHI_CODE_MODE_TYPES).toContain(
      'stage: "input" | "flowchart" | "mindmap"',
    );
    expect(SKETCHI_CODE_MODE_TYPES).toContain("type CodeModeIssueCode");
    expect(SKETCHI_CODE_MODE_TYPES).toContain("code: CodeModeIssueCode");
    for (const issueCode of [
      "nonterminating_node",
      "flowchart_too_large",
      "request_too_large",
    ]) {
      expect(SKETCHI_CODE_MODE_TYPES).toContain(`"${issueCode}"`);
    }
    for (const operation of [
      "buildFlowchart",
      "buildMindmap",
      "buildSequenceDiagram",
      "getArtifact",
      "applyDiagramPatch",
    ]) {
      expect(SKETCHI_CODE_MODE_TYPES).toContain(`${operation}(`);
      expect(getCodeModeDocs({ topic: "overview" }).content).toContain(
        operation,
      );
      expect(getCodeModeDocs({ topic: "execute" }).content).toContain(
        operation,
      );
    }
    expect(getCodeModeDocs({ topic: "buildMindmap" }).content).toContain(
      "Do not supply coordinates, edges, or Excalidraw JSON",
    );
    expect(getCodeModeDocs({ topic: "buildMindmap" }).content).toContain(
      "intentional output formats",
    );
    const sequenceDocs = getCodeModeDocs({ topic: "buildSequenceDiagram" });
    expect(sequenceDocs.content).toContain("preserved left-to-right");
    expect(sequenceDocs.content).toContain("preserved top-to-bottom");
    expect(sequenceDocs.content).toContain("Self-referential messages");
    expect(sequenceDocs.examples[0]?.code).toContain(
      "sketchi.buildSequenceDiagram",
    );
  });

  it("keeps the published catalog complete for bounded build failures", () => {
    const catalog = readFileSync("docs/mcp-tool-catalog.md", "utf8");
    for (const declaration of [
      "interface BuildMindmapRequest",
      "type BuildMindmapResult",
      "interface BuildSequenceDiagramRequest",
      "buildSequenceDiagram",
      '"request_too_large"',
      '"nonterminating_node"',
      '"flowchart_too_large"',
      '"mindmap_too_deep"',
      '"mindmap_too_large"',
    ]) {
      expect(catalog).toContain(declaration);
    }
    expect(catalog).toContain("flowchart, mindmap, or sequence artifact");
    expect(catalog).toContain("matching `buildFlowchart`,");
    expect(catalog).toContain("24 nodes");
    expect(catalog).toContain("64 edges");
    expect(catalog).toContain("256 KiB");
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

    const finalArtifactResults = searchCodeModeDocs({
      query: "do not create markdown mermaid final artifact url",
    });
    expect(finalArtifactResults.results.map((result) => result.id)).toContain(
      "no-mermaid-wrapper-non-goal",
    );

    const boundedFlowchartResults = searchCodeModeDocs({
      query: "nonterminating cycle 24 nodes 64 edges request_too_large",
    });
    expect(boundedFlowchartResults.results.map((result) => result.id)).toEqual(
      expect.arrayContaining(["buildFlowchart", "issues"]),
    );

    const sequenceResults = searchCodeModeDocs({
      query: "chronological participant lifeline messages",
    });
    expect(sequenceResults.results.map((result) => result.id)).toContain(
      "buildSequenceDiagram",
    );
  });

  it("documents importable Excalidraw artifact URLs", () => {
    const docs = getCodeModeDocs({ topic: "getArtifact" });

    expect(docs.content).toContain("importable Excalidraw file JSON");
    expect(docs.content).toContain("url fields");
    expect(docs.content).toContain("format=excalidraw&raw=true");
    expect(docs.content).toContain("format=png&raw=true");
  });

  it("documents broad architecture prompt shaping", () => {
    const docs = getCodeModeDocs({ topic: "buildFlowchart" });

    expect(docs.content).toContain("broad or vague repo/system architecture");
    expect(docs.content).toContain("8-14 high-signal nodes");
    expect(docs.content).toContain("single readable spine");
    expect(docs.content).toContain("group related packages into layers");
    expect(docs.content).toContain("24 nodes");
    expect(docs.content).toContain("64 edges");
    expect(docs.content).toContain("nonterminating_node");
    expect(docs.content).toContain("request_too_large");
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
