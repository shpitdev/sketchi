import { describe, expect, it } from "vitest";
import { parseTimelineDiagram, type TimelineDiagram } from "@sketchi/diagram-core";
import fixtures from "./fixtures/timeline-descriptions.json";
import { evaluateScenarioDiagram } from "./evaluate.js";
import {
	timelineScenarioChecks,
	timelineScenarios,
	type TimelineScenario,
} from "./timeline-scenarios.js";

const lunar = timelineScenarios.find((scenario) => scenario.id === "lunar-mission-timeline")!;
const description = lunar.assertions.events[6]!.description!;
const descriptionCheck = (diagram: TimelineDiagram, scenario: TimelineScenario = lunar) =>
	timelineScenarioChecks(scenario, diagram).find((check) => check.id === "timeline-event:7");
const withTouchdown = (label: string, detail?: string): TimelineDiagram => ({
	...lunar.expectedDiagram,
	events: lunar.expectedDiagram.events.map(({ description: _description, ...event }) =>
		event.id === "touchdown"
			? { ...event, label, ...(detail === undefined ? {} : { description: detail }) }
			: event,
	),
});

describe("timeline event descriptions", () => {
	it.each(fixtures.slice(0, 4).map((spec, index) => ({ spec, sample: index + 1 })))(
		"accepts the full description in the event label from real sample $sample",
		({ spec }) => {
			const diagram = parseTimelineDiagram(spec);
			expect(descriptionCheck(diagram)).toMatchObject({ passed: true });
			expect(evaluateScenarioDiagram(lunar, diagram).ok).toBe(true);
		},
	);

	it("keeps the real sample that omitted the description failing", () => {
		const diagram = parseTimelineDiagram(fixtures[4]);
		expect(descriptionCheck(diagram)).toMatchObject({ passed: false });
		expect(evaluateScenarioDiagram(lunar, diagram).ok).toBe(false);
	});

	it.each([": ", " — ", " – ", " - ", " | ", "; ", "\n"])(
		"accepts an event name and complete description separated by %j",
		(separator) => {
			expect(descriptionCheck(withTouchdown(`Touchdown${separator}${description}`))).toMatchObject({
				passed: true,
			});
		},
	);

	it("uses the existing case, punctuation and whitespace normalization", () => {
		expect(
			descriptionCheck(withTouchdown("TOUCHDOWN: FIRST soft landing, near\nthe south pole!")),
		).toMatchObject({ passed: true });
	});

	it("preserves the existing description-field substring rule", () => {
		expect(
			descriptionCheck(withTouchdown("Touchdown", `Note: ${description} Confirmed.`)),
		).toMatchObject({ passed: true });
	});

	it.each([
		["missing description", "Touchdown"],
		["partial description", "Touchdown: First soft landing"],
		["paraphrased description", "Touchdown: First gentle landing by the south pole."],
		["missing event name at the correct date", description],
		["event name only as part of another word", `NotTouchdown: ${description}`],
		["extra words in the event name", `Not Touchdown: ${description}`],
		["extra words in the description", `Touchdown: ${description} Another landing.`],
		["description before the name", `${description}: Touchdown`],
		["no separator", `Touchdown ${description}`],
	])("rejects %s", (_name, label) => {
		expect(descriptionCheck(withTouchdown(label))).toMatchObject({ passed: false });
	});

	it.each(["label", "description"] as const)(
		"rejects the description in another event's %s",
		(field) => {
			const missing = withTouchdown("Touchdown");
			const diagram = {
				...missing,
				events: missing.events.map((event) =>
					event.id === "drive"
						? {
								...event,
								[field]: field === "label" ? `${event.label}: ${description}` : description,
							}
						: event,
				),
			};
			expect(descriptionCheck(diagram)).toMatchObject({ passed: false });
		},
	);

	it("does not relax the matched event's date or other details", () => {
		const inline = withTouchdown(`Touchdown: ${description}`);
		const wrongDate = {
			...inline,
			events: inline.events.map((event) =>
				event.id === "touchdown" ? { ...event, date: "2027-05-04" } : event,
			),
		};
		expect(descriptionCheck(wrongDate)).toMatchObject({ passed: false });
		expect(
			descriptionCheck(inline, {
				...lunar,
				assertions: {
					...lunar.assertions,
					events: lunar.assertions.events.map((event, index) =>
						index === 6 ? { ...event, kind: "milestone", lane: "Lander" } : event,
					),
				},
			}),
		).toMatchObject({ passed: false });
	});

	it("applies the same rule to any stated description and label alternative", () => {
		const scenario: TimelineScenario = {
			...lunar,
			assertions: {
				...lunar.assertions,
				events: lunar.assertions.events.map((event, index) =>
					index === 0
						? { ...event, labels: ["Liftoff", "Launch"], description: "Depart Earth." }
						: event,
				),
			},
		};
		const diagram = {
			...lunar.expectedDiagram,
			events: lunar.expectedDiagram.events.map((event, index) =>
				index === 0 ? { ...event, label: "Launch — Depart Earth." } : event,
			),
		};
		expect(timelineScenarioChecks(scenario, diagram).every((check) => check.passed)).toBe(true);
	});
});
