import { describe, expect, it } from "vitest";

import {
  addToSelection,
  applySelectionEvent,
  describeSelectAll,
  describeSelectionNotice,
  initialSelectionState,
  remainingCapacity,
  selectAllLabel,
  SELECTION_LIMIT,
  type SelectionEvent,
  type SelectionState,
} from "./selection";

const slugs = (count: number, prefix = "icon") =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

describe("addToSelection", () => {
  it("adds every slug when the selection stays under the limit", () => {
    const result = addToSelection(new Set(), slugs(5));
    expect(result.added).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.selected.size).toBe(5);
  });

  it("ignores slugs that are already selected", () => {
    const result = addToSelection(new Set(["icon-0"]), slugs(3));
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("stops at the limit and reports what was left out", () => {
    // The motivating case: a filtered query returning far more than the cap.
    const result = addToSelection(new Set(), slugs(1412));
    expect(result.selected.size).toBe(SELECTION_LIMIT);
    expect(result.added).toBe(SELECTION_LIMIT);
    expect(result.skipped).toBe(1412 - SELECTION_LIMIT);
  });

  it("counts a full selection against slugs from a different query", () => {
    const full = new Set(slugs(SELECTION_LIMIT, "old"));
    const result = addToSelection(full, slugs(4, "new"));
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(4);
    expect(result.selected.size).toBe(SELECTION_LIMIT);
  });

  it("never returns the original set instance", () => {
    const current = new Set(["icon-0"]);
    expect(addToSelection(current, []).selected).not.toBe(current);
  });
});

describe("remainingCapacity", () => {
  it("never goes negative", () => {
    expect(remainingCapacity(new Set(slugs(SELECTION_LIMIT + 10)))).toBe(0);
    expect(remainingCapacity(new Set(slugs(10)))).toBe(SELECTION_LIMIT - 10);
  });
});

describe("selectAllLabel", () => {
  it("names the exact count when everything fits", () => {
    expect(selectAllLabel(262, 262, SELECTION_LIMIT)).toBe("Select all 262");
  });

  it("states the truncation before the click rather than after", () => {
    expect(selectAllLabel(1412, 1412, SELECTION_LIMIT)).toBe(
      "Select 300 more of 1,412",
    );
  });

  it("never promises icons that are already selected", () => {
    expect(selectAllLabel(216, 0, 84)).toBe("All 216 selected");
  });

  it("reports a full selection", () => {
    expect(selectAllLabel(262, 262, 0)).toBe("Selection full");
  });
});

describe("describeSelectAll", () => {
  it("reports a clean selection", () => {
    expect(describeSelectAll({ added: 262, skipped: 0 })).toBe(
      "262 icons selected.",
    );
  });

  it("reports the capped remainder", () => {
    expect(describeSelectAll({ added: 300, skipped: 1112 })).toContain(
      "1,112 left out",
    );
  });

  it("uses the singular for a single icon", () => {
    expect(describeSelectAll({ added: 1, skipped: 0 })).toBe(
      "1 icon selected.",
    );
  });
});

describe("applySelectionEvent", () => {
  const fold = (
    events: readonly SelectionEvent[],
    limit?: number,
    from: SelectionState = initialSelectionState,
  ) =>
    events.reduce(
      (state, event) => applySelectionEvent(state, event, limit),
      from,
    );

  it("applies a run of toggles cumulatively", () => {
    // The batching guarantee in reducer form: folding N events over the state
    // must keep every one of them, never just the last.
    const state = fold([
      { slug: "a", type: "toggle" },
      { slug: "b", type: "toggle" },
      { slug: "c", type: "toggle" },
      { slug: "d", type: "toggle" },
      { slug: "e", type: "toggle" },
    ]);
    expect([...state.slugs]).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("treats a repeated toggle of one slug as on/off", () => {
    const state = fold([
      { slug: "a", type: "toggle" },
      { slug: "a", type: "toggle" },
      { slug: "a", type: "toggle" },
    ]);
    expect([...state.slugs]).toEqual(["a"]);
  });

  it("refuses to exceed the limit and says so", () => {
    const filled = fold(
      [
        { slug: "a", type: "toggle" },
        { slug: "b", type: "toggle" },
      ],
      2,
    );
    const state = applySelectionEvent(filled, { slug: "c", type: "toggle" }, 2);
    expect([...state.slugs]).toEqual(["a", "b"]);
    expect(state.notice).toEqual({ kind: "full" });
    expect(state.revision).toBeGreaterThan(filled.revision);
  });

  it("stays silent for ordinary toggles", () => {
    const state = applySelectionEvent(initialSelectionState, {
      slug: "a",
      type: "toggle",
    });
    expect(state.notice).toBeUndefined();
  });

  it("reports what select-all actually added", () => {
    const state = applySelectionEvent(
      initialSelectionState,
      { slugs: ["a", "b", "c"], type: "select-all" },
      2,
    );
    expect(state.notice).toEqual({ added: 2, kind: "selected", skipped: 1 });
    expect(state.slugs.size).toBe(2);
  });

  it("does not churn state when there is nothing to do", () => {
    expect(applySelectionEvent(initialSelectionState, { type: "clear" })).toBe(
      initialSelectionState,
    );
    const selected = fold([{ slug: "a", type: "toggle" }]);
    expect(
      applySelectionEvent(selected, { slugs: ["a"], type: "select-all" }),
    ).toBe(selected);
  });

  it("clears everything and announces it", () => {
    const selected = fold([
      { slug: "a", type: "toggle" },
      { slug: "b", type: "toggle" },
    ]);
    const state = applySelectionEvent(selected, { type: "clear" });
    expect(state.slugs.size).toBe(0);
    expect(state.notice).toEqual({ kind: "cleared" });
  });

  it("keeps the real limit at the documented cap", () => {
    const state = fold(
      Array.from({ length: SELECTION_LIMIT + 25 }, (_, index) => ({
        slug: `icon-${index}`,
        type: "toggle" as const,
      })),
    );
    expect(state.slugs.size).toBe(SELECTION_LIMIT);
  });
});

describe("describeSelectionNotice", () => {
  it("renders each notice kind", () => {
    expect(describeSelectionNotice({ kind: "cleared" })).toBe(
      "Selection cleared.",
    );
    expect(describeSelectionNotice({ kind: "full" })).toContain(
      "Selection is full",
    );
    expect(
      describeSelectionNotice({ added: 3, kind: "selected", skipped: 0 }),
    ).toBe("3 icons selected.");
  });
});
