import { describe, expect, it } from "vitest";
import { evaluateScenarioDiagram } from "./evaluate.js";
import { timelineScenarios } from "./timeline-scenarios.js";

describe("prompt-grounded timeline scenarios", () => {
	for (const scenario of timelineScenarios) {
		it(`${scenario.id}: accepts the fixture and reordered dated input`, () => {
			expect(evaluateScenarioDiagram(scenario, scenario.expectedDiagram).ok).toBe(true);
			expect(
				evaluateScenarioDiagram(scenario, {
					...scenario.expectedDiagram,
					events: [...scenario.expectedDiagram.events].reverse(),
				}).ok,
			).toBe(true);
		});
		it(`${scenario.id}: rejects missing, invented and renamed events`, () => {
			const input = scenario.expectedDiagram;
			expect(
				evaluateScenarioDiagram(scenario, { ...input, events: input.events.slice(1) }).ok,
			).toBe(false);
			expect(
				evaluateScenarioDiagram(scenario, {
					...input,
					events: input.events.map((event, i) =>
						i === 0 ? { ...event, label: "Invented event" } : event,
					),
				}).ok,
			).toBe(false);
			expect(
				evaluateScenarioDiagram(scenario, {
					...input,
					events: [...input.events, { ...input.events[0], id: "invented" }],
				}).ok,
			).toBe(false);
		});
		it(`${scenario.id}: rejects wrong dates or explicit order on the model output`, () => {
			const input = scenario.expectedDiagram;
			const wrong = {
				...input,
				events: input.events.map((event, i) =>
					i === 0 ? { ...event, ...(event.date ? { date: "2026-12-31" } : { order: 99 }) } : event,
				),
			};
			expect(evaluateScenarioDiagram(scenario, wrong).ok).toBe(false);
			expect(evaluateScenarioDiagram(scenario, input, wrong).ok).toBe(false);
		});
	}
});
