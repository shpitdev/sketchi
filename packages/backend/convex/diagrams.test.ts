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

const EXCALIDRAW_POST_URL = "https://json.excalidraw.com/api/v2/post/";
const EXCALIDRAW_GET_URL = "https://json.excalidraw.com/api/v2/";
const IV_LENGTH_BYTES = 12;
const AES_GCM_KEY_LENGTH = 128;

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

async function createV1ShareLink(
  elements: unknown[],
  appState: Record<string, unknown> = {}
): Promise<string> {
  const payload = JSON.stringify({ elements, appState });
  const encodedPayload = new TextEncoder().encode(payload);

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_GCM_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedPayload
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  const response = await fetch(EXCALIDRAW_POST_URL, {
    method: "POST",
    body: combined,
  });

  if (!response.ok) {
    throw new Error(
      `Upload failed: ${response.status} ${await response.text()}`
    );
  }

  const { id } = (await response.json()) as { id: string };

  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.k) {
    throw new Error("Failed to export encryption key");
  }

  return `https://excalidraw.com/#json=${id},${jwk.k}`;
}

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

  test("modifyDiagram returns V2 share link for V1 input", async () => {
    const v1ShareUrl = await createV1ShareLink(RENDERED.elements, {});

    const result = await t.action(api.diagrams.modifyDiagram, {
      shareUrl: v1ShareUrl,
      request:
        "node-1_text text = 'Updated Start' node-1_text originalText = 'Updated Start'",
      options: {
        preferExplicitEdits: true,
      },
    });

    expect(result.status).toBe("success");
    expect(result.shareLink?.shareId).toBeTruthy();

    const shareId = result.shareLink?.shareId ?? "";
    const rawFetch = await fetch(`${EXCALIDRAW_GET_URL}${shareId}`);
    expect(rawFetch.ok).toBe(true);
    const bytes = new Uint8Array(await rawFetch.arrayBuffer());
    expect(
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
        0
      )
    ).toBe(1);
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
