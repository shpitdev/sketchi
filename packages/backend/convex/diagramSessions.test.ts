/**
 * TEST SCENARIO: Convex diagramSessions CRUD + OCC + size guard
 * - create -> get returns empty scene with version 0
 * - setLatestScene success increments version
 * - setLatestScene conflict (stale expectedVersion) returns structured conflict result
 * - setLatestScene rejects over-size scene with explicit error code
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const t = convexTest(schema, modules);

const HEX_32_PATTERN = /^[0-9a-f]{32}$/;

describe("diagramSessions", () => {
  test("create -> get returns empty scene with version 0", async () => {
    const { sessionId } = await t.mutation(api.diagramSessions.create, {});

    expect(sessionId).toHaveLength(32);
    expect(HEX_32_PATTERN.test(sessionId)).toBe(true);

    const session = await t.query(api.diagramSessions.get, { sessionId });

    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe(sessionId);
    expect(session?.latestScene).toBeNull();
    expect(session?.latestSceneVersion).toBe(0);
    expect(session?.createdAt).toBeGreaterThan(0);
    expect(session?.updatedAt).toBeGreaterThan(0);
  });

  test("get returns null for unknown sessionId", async () => {
    const session = await t.query(api.diagramSessions.get, {
      sessionId: "deadbeefdeadbeefdeadbeefdeadbeef",
    });

    expect(session).toBeNull();
  });

  test("setLatestScene success increments version", async () => {
    const { sessionId } = await t.mutation(api.diagramSessions.create, {});

    const result = await t.mutation(api.diagramSessions.setLatestScene, {
      sessionId,
      expectedVersion: 0,
      elements: [{ id: "rect-1", type: "rectangle", x: 0, y: 0 }],
      appState: { viewBackgroundColor: "#ffffff" },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("unexpected status");
    }
    expect(result.latestSceneVersion).toBe(1);
    expect(result.savedAt).toBeGreaterThan(0);

    const session = await t.query(api.diagramSessions.get, { sessionId });
    expect(session?.latestSceneVersion).toBe(1);
    expect(session?.latestScene).not.toBeNull();
    expect(session?.latestScene?.elements).toHaveLength(1);

    const result2 = await t.mutation(api.diagramSessions.setLatestScene, {
      sessionId,
      expectedVersion: 1,
      elements: [
        { id: "rect-1", type: "rectangle", x: 0, y: 0 },
        { id: "rect-2", type: "rectangle", x: 100, y: 100 },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
    });

    expect(result2.status).toBe("success");
    if (result2.status !== "success") {
      throw new Error("unexpected status");
    }
    expect(result2.latestSceneVersion).toBe(2);

    const session2 = await t.query(api.diagramSessions.get, { sessionId });
    expect(session2?.latestSceneVersion).toBe(2);
    expect(session2?.latestScene?.elements).toHaveLength(2);
  });

  test("setLatestScene conflict returns structured result without clobbering", async () => {
    const { sessionId } = await t.mutation(api.diagramSessions.create, {});

    const originalElements = [
      { id: "original", type: "rectangle", x: 0, y: 0 },
    ];
    await t.mutation(api.diagramSessions.setLatestScene, {
      sessionId,
      expectedVersion: 0,
      elements: originalElements,
      appState: {},
    });

    const conflictResult = await t.mutation(
      api.diagramSessions.setLatestScene,
      {
        sessionId,
        expectedVersion: 0,
        elements: [{ id: "clobberer", type: "ellipse", x: 50, y: 50 }],
        appState: {},
      }
    );

    expect(conflictResult.status).toBe("conflict");
    if (conflictResult.status !== "conflict") {
      throw new Error("unexpected status");
    }
    expect(conflictResult.latestSceneVersion).toBe(1);

    const session = await t.query(api.diagramSessions.get, { sessionId });
    expect(session?.latestSceneVersion).toBe(1);
    expect(session?.latestScene?.elements).toEqual(originalElements);
  });

  test("setLatestScene rejects over-size scene with explicit error code", async () => {
    const { sessionId } = await t.mutation(api.diagramSessions.create, {});

    const bigString = "x".repeat(200_000);
    const largeElements = Array.from({ length: 10 }, (_, i) => ({
      id: `element-${i}`,
      type: "text",
      text: bigString,
      x: i * 100,
      y: 0,
    }));

    const result = await t.mutation(api.diagramSessions.setLatestScene, {
      sessionId,
      expectedVersion: 0,
      elements: largeElements,
      appState: {},
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("unexpected status");
    }
    expect("reason" in result && result.reason).toBe("scene-too-large");
    expect("maxBytes" in result && result.maxBytes).toBe(900_000);
    expect(
      "actualBytes" in result && typeof result.actualBytes === "number"
        ? result.actualBytes
        : 0
    ).toBeGreaterThan(900_000);

    const session = await t.query(api.diagramSessions.get, { sessionId });
    expect(session?.latestSceneVersion).toBe(0);
    expect(session?.latestScene).toBeNull();
  });

  test("setLatestScene strips transient appState keys", async () => {
    const { sessionId } = await t.mutation(api.diagramSessions.create, {});

    await t.mutation(api.diagramSessions.setLatestScene, {
      sessionId,
      expectedVersion: 0,
      elements: [{ id: "rect-1", type: "rectangle", x: 0, y: 0 }],
      appState: {
        viewBackgroundColor: "#ffffff",
        selectedElementIds: { "rect-1": true },
        selectedGroupIds: { "group-1": true },
        editingElement: { id: "rect-1" },
        openDialog: "settings",
        collaborators: [{ id: "user-1" }],
        cursorButton: "up",
        zoom: { value: 1.5 },
      },
    });

    const session = await t.query(api.diagramSessions.get, { sessionId });
    const savedAppState = session?.latestScene?.appState as
      | Record<string, unknown>
      | undefined;

    expect(savedAppState?.viewBackgroundColor).toBe("#ffffff");
    expect(savedAppState?.zoom).toEqual({ value: 1.5 });

    expect(savedAppState?.selectedElementIds).toBeUndefined();
    expect(savedAppState?.selectedGroupIds).toBeUndefined();
    expect(savedAppState?.editingElement).toBeUndefined();
    expect(savedAppState?.openDialog).toBeUndefined();
    expect(savedAppState?.collaborators).toBeUndefined();
    expect(savedAppState?.cursorButton).toBeUndefined();
  });

  test("setLatestScene throws for unknown session", async () => {
    await expect(
      t.mutation(api.diagramSessions.setLatestScene, {
        sessionId: "0000000000000000ffffffffffffffff",
        expectedVersion: 0,
        elements: [],
        appState: {},
      })
    ).rejects.toThrow("Session not found");
  });
});
