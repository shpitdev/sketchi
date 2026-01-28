/**
 * TEST SCENARIO: Convex diagrams actions
 * - generateDiagram uses mocked intermediate and produces a share link
 * - modifyDiagram applies explicit edits and returns updated elements + share link
 * - parseDiagram converts share link elements into IntermediateFormat
 * - shareDiagram returns a valid Excalidraw share link
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { generateIntermediate } from "../lib/agents";
import type { IntermediateFormat } from "../lib/diagram-intermediate";
import { renderIntermediateDiagram } from "../lib/diagram-renderer";
import { api } from "./_generated/api";
import { createExcalidrawShareLink } from "./lib/excalidrawShareLinks";
import schema from "./schema";
import { modules } from "./test.setup";

vi.mock("../lib/agents", () => ({
  generateIntermediate: vi.fn(),
}));

const t = convexTest(schema, modules);

const BASE_INTERMEDIATE: IntermediateFormat = {
  nodes: [
    { id: "node-1", label: "Start" },
    { id: "node-2", label: "End" },
  ],
  edges: [
    {
      fromId: "node-1",
      toId: "node-2",
      label: "next",
    },
  ],
  graphOptions: {
    diagramType: "flowchart",
  },
};

const RENDERED = renderIntermediateDiagram(BASE_INTERMEDIATE);

let baseShareLink: { url: string; shareId: string; encryptionKey: string };

describe.sequential("diagrams actions", () => {
  beforeAll(async () => {
    baseShareLink = await createExcalidrawShareLink(RENDERED.elements, {});
  });

  test("generateDiagram returns share link + elements", async () => {
    const mockedGenerate = vi.mocked(generateIntermediate);
    mockedGenerate.mockResolvedValue({
      intermediate: BASE_INTERMEDIATE,
      profileId: "general",
      iterations: 2,
      tokens: 42,
      durationMs: 120,
      traceId: "trace-mocked",
    });

    const result = await t.action(api.diagrams.generateDiagram, {
      prompt: "Generate a simple flowchart",
    });

    expect(result.status).toBe("success");
    expect(result.elements.length).toBeGreaterThan(0);
    expect(result.shareLink.url).toContain("https://excalidraw.com/#json=");
    expect(result.stats.nodeCount).toBe(2);
    expect(result.stats.edgeCount).toBe(1);
  });

  test("modifyDiagram applies explicit edits", async () => {
    const result = await t.action(api.diagrams.modifyDiagram, {
      shareUrl: baseShareLink.url,
      request:
        "node-1_text text = 'Updated Start' node-1_text originalText = 'Updated Start'",
      options: {
        preferExplicitEdits: true,
      },
    });

    expect(result.status).toBe("success");
    expect(result.shareLink?.url).toContain("https://excalidraw.com/#json=");
    const updatedText = result.elements?.find(
      (element: unknown) =>
        typeof element === "object" &&
        element !== null &&
        "id" in element &&
        (element as { id?: unknown }).id === "node-1_text"
    ) as { text?: string } | undefined;
    expect(updatedText?.text).toBe("Updated Start");
  });

  test("parseDiagram extracts IntermediateFormat", async () => {
    const result = await t.action(api.diagrams.parseDiagram, {
      shareUrl: baseShareLink.url,
    });

    expect(Array.isArray(result.elements)).toBe(true);
    expect(result.stats.nodeCount).toBe(2);
    expect(result.stats.edgeCount).toBe(1);
    const nodeIds = result.intermediate.nodes.map(
      (node: { id: string }) => node.id
    );
    expect(nodeIds).toContain("node-1");
    expect(nodeIds).toContain("node-2");
  });

  test("shareDiagram returns a share link", async () => {
    const result = await t.action(api.diagrams.shareDiagram, {
      elements: RENDERED.elements,
      appState: {},
    });

    expect(result.url).toContain("https://excalidraw.com/#json=");
    expect(result.shareId.length).toBeGreaterThan(0);
    expect(result.encryptionKey.length).toBeGreaterThan(0);
  });
});
