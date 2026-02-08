import { describe, expect, test } from "vitest";

import { applyDiagramDiff } from "./diagram-modification";

describe("applyDiagramDiff change tracking", () => {
  test("does not report modifiedIds for empty changes", () => {
    const elements = [
      { id: "a", type: "rectangle", backgroundColor: "#ffffff" },
    ] as unknown as Parameters<typeof applyDiagramDiff>[0];

    const result = applyDiagramDiff(elements, {
      modify: [{ id: "a", changes: {} }],
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.changes.modifiedIds).toEqual([]);
  });

  test("does not report modifiedIds when patch values are identical", () => {
    const elements = [
      { id: "a", type: "rectangle", backgroundColor: "#ffffff" },
    ] as unknown as Parameters<typeof applyDiagramDiff>[0];

    const result = applyDiagramDiff(elements, {
      modify: [{ id: "a", changes: { backgroundColor: "#ffffff" } }],
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.changes.modifiedIds).toEqual([]);
  });

  test("reports modifiedIds when a value actually changes", () => {
    const elements = [
      { id: "a", type: "rectangle", backgroundColor: "#ffffff" },
    ] as unknown as Parameters<typeof applyDiagramDiff>[0];

    const result = applyDiagramDiff(elements, {
      modify: [{ id: "a", changes: { backgroundColor: "#000000" } }],
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.changes.modifiedIds).toEqual(["a"]);

    expect(result.ok && result.elements[0]?.backgroundColor).toBe("#000000");
  });
});
