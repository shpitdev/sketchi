import { describe, expect, it } from "vitest";
import { timelineFixture } from "../families/timeline/document.js";
import { candidateFromText } from "./candidates.js";

describe("timeline generation", () => {
	it("preserves semantic validation repair hints for invalid dates", () => {
		const output = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title: timelineFixture.title,
				diagram: {
					...timelineFixture,
					events: [{ id: "bad", label: "Public beta", date: "2026-02-30" }],
				},
			}),
		});
		expect(output.error).toBeDefined();
		expect(output.diagnostics.join(" ")).toContain("invalid_timeline_date");
		expect(output.diagnostics.join(" ")).toContain("Hint:");
	});
});
