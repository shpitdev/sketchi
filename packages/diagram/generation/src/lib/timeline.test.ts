import { describe, expect, it } from "vitest";
import { timelineFixture } from "@sketchi/diagram-core";
import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";

describe("timeline generation", () => {
	function candidate(events: unknown = timelineFixture.events) {
		return candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title: timelineFixture.title,
				diagram: { ...timelineFixture, events },
			}),
		});
	}
	it("parses semantic timeline events", () => {
		const output = candidate();
		expect(output.error).toBeUndefined();
		expect(
			enforceCandidateRequestRequirements(output, {
				model: "fixture",
				prompt: { id: "timeline", request: "release timeline", requestedType: "timeline" },
			}).error,
		).toBeUndefined();
	});
	it("preserves semantic validation repair hints for invalid dates", () => {
		const output = candidate([{ id: "bad", label: "Public beta", date: "2026-02-30" }]);
		expect(output.error).toBeDefined();
		expect(output.diagnostics.join(" ")).toContain("invalid_timeline_date");
		expect(output.diagnostics.join(" ")).toContain("Hint:");
	});
});
