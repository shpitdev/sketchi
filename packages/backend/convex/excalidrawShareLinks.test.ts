import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const t = convexTest(schema, modules);
const shareLinksApi = api.excalidrawShareLinks;

function buildValidExcalidrawElements() {
  const updated = 1_725_000_000_000;
  const rect1 = {
    id: "rect-1",
    type: "rectangle",
    x: 100,
    y: 100,
    width: 200,
    height: 120,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    roundness: { type: 3 },
    seed: 10_101,
    version: 1,
    versionNonce: 30_101,
    isDeleted: false,
    boundElements: [
      { id: "rect-1-text", type: "text" },
      { id: "arrow-1", type: "arrow" },
    ],
    updated,
    link: null,
    locked: false,
  };

  const rect1Text = {
    id: "rect-1-text",
    type: "text",
    x: 120,
    y: 145,
    width: 160,
    height: 30,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a1",
    roundness: null,
    seed: 10_102,
    version: 1,
    versionNonce: 30_102,
    isDeleted: false,
    boundElements: null,
    updated,
    link: null,
    locked: false,
    text: "Share Link Test",
    fontSize: 16,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: "rect-1",
    originalText: "Share Link Test",
    autoResize: true,
    lineHeight: 1.25,
  };

  const rect2 = {
    id: "rect-2",
    type: "rectangle",
    x: 420,
    y: 240,
    width: 220,
    height: 120,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a2",
    roundness: { type: 3 },
    seed: 10_103,
    version: 1,
    versionNonce: 30_103,
    isDeleted: false,
    boundElements: [{ id: "arrow-1", type: "arrow" }],
    updated,
    link: null,
    locked: false,
  };

  const arrow1 = {
    id: "arrow-1",
    type: "arrow",
    x: 300,
    y: 190,
    width: 180,
    height: 140,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a3",
    roundness: { type: 2 },
    seed: 10_104,
    version: 1,
    versionNonce: 30_104,
    isDeleted: false,
    boundElements: null,
    updated,
    link: null,
    locked: false,
    points: [
      [0, 0],
      [180, 140],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: "rect-1", focus: 0, gap: 6 },
    endBinding: { elementId: "rect-2", focus: 0, gap: 6 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };

  return [rect1, rect1Text, rect2, arrow1];
}

function assertValidExcalidrawElements(elements: unknown[]): void {
  for (const element of elements) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(element).toBeTruthy();
    if (!element || typeof element !== "object") {
      throw new Error("Element is not an object");
    }

    const base = element as Record<string, unknown>;
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.id).toBe("string");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.type).toBe("string");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.x).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.y).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.width).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.height).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.angle).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.strokeColor).toBe("string");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.backgroundColor).toBe("string");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.fillStyle).toBe("string");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.strokeWidth).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.strokeStyle).toBe("string");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.roughness).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.opacity).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(Array.isArray(base.groupIds)).toBe(true);
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(base.frameId === null || typeof base.frameId === "string").toBe(
      true
    );
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(base.index === null || typeof base.index === "string").toBe(true);
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.seed).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.version).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.versionNonce).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.isDeleted).toBe("boolean");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.updated).toBe("number");
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(base.link === null || typeof base.link === "string").toBe(true);
    // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
    expect(typeof base.locked).toBe("boolean");

    if (base.boundElements !== null) {
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(Array.isArray(base.boundElements)).toBe(true);
      for (const bound of base.boundElements as unknown[]) {
        // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
        expect(bound && typeof bound === "object").toBe(true);
        const boundRecord = bound as Record<string, unknown>;
        // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
        expect(typeof boundRecord.id).toBe("string");
        // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
        expect(typeof boundRecord.type).toBe("string");
      }
    }

    if (base.type === "arrow" || base.type === "line") {
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(Array.isArray(base.points)).toBe(true);
      const points = base.points as unknown[];
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(points.length).toBeGreaterThanOrEqual(2);
      for (const point of points) {
        // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
        expect(Array.isArray(point)).toBe(true);
        const coords = point as unknown[];
        // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
        expect(coords.length).toBe(2);
        // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
        expect(typeof coords[0]).toBe("number");
        // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
        expect(typeof coords[1]).toBe("number");
      }
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(
        base.lastCommittedPoint === null ||
          Array.isArray(base.lastCommittedPoint)
      ).toBe(true);
    }

    if (base.type === "text") {
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(typeof base.text).toBe("string");
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(typeof base.fontSize).toBe("number");
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(typeof base.fontFamily).toBe("number");
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(typeof base.textAlign).toBe("string");
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(typeof base.verticalAlign).toBe("string");
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(typeof base.lineHeight).toBe("number");
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
      expect(
        base.containerId === null || typeof base.containerId === "string"
      ).toBe(true);
    }
  }
}

test("share link actions round-trip elements", async () => {
  const elements = buildValidExcalidrawElements();

  const appState = { viewBackgroundColor: "#ffffff" };

  assertValidExcalidrawElements(elements);

  const created = await t.action(shareLinksApi.createShareLinkFromElements, {
    elements,
    appState,
  });

  expect(created.url).toContain(created.shareId);
  expect(created.encryptionKey.length).toBeGreaterThan(10);

  const rawFetch = await fetch(
    `https://json.excalidraw.com/api/v2/${created.shareId}`
  );
  expect(rawFetch.ok).toBe(true);

  const parsed = await t.action(shareLinksApi.parseShareLinkToElements, {
    url: created.url,
  });

  assertValidExcalidrawElements(parsed.elements);

  expect(parsed.elements).toEqual(elements);
  expect(parsed.appState).toEqual(appState);

  const outputDir = fileURLToPath(new URL("../test-results", import.meta.url));
  await mkdir(outputDir, { recursive: true });
  const report = {
    scenario: "excalidraw share link round-trip",
    shareId: created.shareId,
    url: created.url,
    elementsCount: parsed.elements.length,
    elementTypes: parsed.elements.map(
      (element: { type?: string }) => element.type ?? "unknown"
    ),
    appStateKeys: Object.keys(parsed.appState ?? {}),
    createdAt: new Date().toISOString(),
  };

  await writeFile(
    join(outputDir, "excalidraw-share-links.json"),
    JSON.stringify(report, null, 2)
  );

  await writeFile(
    join(outputDir, "excalidraw-share-links.md"),
    [
      "# Excalidraw Share Link Test",
      "",
      `- Scenario: ${report.scenario}`,
      `- Share ID: ${report.shareId}`,
      `- URL: ${report.url}`,
      `- Elements: ${report.elementsCount}`,
      `- Element types: ${report.elementTypes.join(", ")}`,
      `- AppState keys: ${report.appStateKeys.join(", ") || "none"}`,
      `- Created: ${report.createdAt}`,
      "",
    ].join("\n")
  );
});

test("parseShareLinkToElements rejects invalid url", async () => {
  await expect(
    t.action(shareLinksApi.parseShareLinkToElements, {
      url: "https://example.com",
    })
  ).rejects.toThrow("Invalid Excalidraw share URL format");
});
