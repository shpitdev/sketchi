import { describe, expect, it } from "vitest";
import {
	applySelectionEvent,
	describeSelectionNotice,
	remainingCapacity,
	selectResultsLabel,
	SELECTION_LIMIT,
} from "./selection";

describe("selection policy", () => {
	it("caps additions in user order, counts only new slugs and describes truncation", () => {
		const slugs = Array.from({ length: 400 }, (_, i) => `icon-${i}`);
		const result = applySelectionEvent(new Set(["icon-5"]), { type: "select-all", slugs });
		expect([...result.slugs].slice(0, 4)).toEqual(["icon-5", "icon-0", "icon-1", "icon-2"]);
		expect(result.slugs.size).toBe(SELECTION_LIMIT);
		expect(result.notice).toEqual({ kind: "selected", added: 299, skipped: 100 });
		expect(describeSelectionNotice(result.notice!)).toBe(
			"Selected 299, 100 left out at the 300 icon cap.",
		);
		expect(remainingCapacity(result.slugs)).toBe(0);
		expect(selectResultsLabel(400, 300)).toBe("Select 300");
		expect(selectResultsLabel(100, 0)).toBe("Selection full");
		expect(selectResultsLabel(2, 300)).toBe("Select all");
	});
	it("announces repeated refusals and lets removed icons rejoin at the end", () => {
		const first = applySelectionEvent(new Set(["a", "b"]), { type: "toggle", slug: "c" }, 2);
		expect(first.notice).toEqual({ kind: "full" });
		expect(applySelectionEvent(first.slugs, { type: "toggle", slug: "c" }, 2).notice).toEqual({
			kind: "full",
		});
		const removed = applySelectionEvent(first.slugs, { type: "toggle", slug: "a" }, 2);
		expect([...applySelectionEvent(removed.slugs, { type: "toggle", slug: "a" }, 2).slugs]).toEqual(
			["b", "a"],
		);
	});
	it("removes only matching results and announces actual changes once", () => {
		const removed = applySelectionEvent(new Set(["a", "b", "c"]), {
			type: "deselect",
			slugs: ["a", "b", "missing"],
		});
		expect([...removed.slugs]).toEqual(["c"]);
		expect(describeSelectionNotice(removed.notice!)).toBe("2 icons removed from the selection.");
		expect(
			applySelectionEvent(removed.slugs, { type: "deselect", slugs: ["a"] }).notice,
		).toBeUndefined();
		const cleared = applySelectionEvent(removed.slugs, { type: "clear" });
		expect(cleared.slugs.size).toBe(0);
		expect(describeSelectionNotice(cleared.notice!)).toBe("Selection cleared.");
		expect(applySelectionEvent(cleared.slugs, { type: "clear" }).notice).toBeUndefined();
		expect(describeSelectionNotice({ kind: "selected", added: 1, skipped: 0 })).toBe(
			"1 icon selected.",
		);
	});
});
