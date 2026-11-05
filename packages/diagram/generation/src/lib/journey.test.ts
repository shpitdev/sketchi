import { describe, expect, it } from "vitest";
import { journeyFixture } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Online purchase",
			diagram,
		}),
	});
}

describe("journey map generation", () => {
	it("teaches the journey shape and its 1-5 scale when the type is requested", () => {
		const messages = buildDiagramGenerationMessages({
			id: "buy",
			request: "Draw a user journey map of buying shoes online.",
			requestedType: "journey",
		});
		expect(messages.system).toContain("Journey map IR rules");
		expect(messages.system).toContain("1 (very negative) to 5 (very positive); 3 is neutral");
		expect(messages.user).toContain('"type":"journey"');
	});

	it("reads Mermaid sections, tasks and sentiment as stages, steps and scores", () => {
		const parsed = candidate({
			id: "buy",
			type: "journey",
			sections: [
				{
					title: "Discover",
					tasks: [{ task: "Sees an ad", sentiment: "4", channel: "Instagram" }],
					pains: ["Too many ads"],
				},
			],
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		if (diagram?.type !== "journey") throw new Error("Expected a journey map.");
		expect(diagram.stages).toEqual([
			{
				name: "Discover",
				steps: [{ label: "Sees an ad", score: 4, touchpoint: "Instagram" }],
				painPoints: ["Too many ads"],
			},
		]);
	});

	it("reports a score off the scale with its repair hint", () => {
		const parsed = candidate({
			...journeyFixture,
			stages: [{ name: "Discover", steps: [{ label: "Sees an ad", score: 8 }] }],
		});
		expect(parsed.diagram).toBeUndefined();
		expect(parsed.diagnostics.join(" ")).toContain("journey.invalid_journey_score");
		expect(parsed.diagnostics.join(" ")).toContain("Hint:");
	});
});
