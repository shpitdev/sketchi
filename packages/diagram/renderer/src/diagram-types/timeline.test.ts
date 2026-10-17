import { describe, expect, it } from "vitest";
import {
	getCanvasValidationIssues,
	parseTimelineDiagram,
	timelineFixture,
} from "@sketchi/diagram-core";
import { renderDiagram } from "../diagram.js";

describe("native timeline layout", () => {
	it("renders and converts deterministic chronological content using existing primitives", () => {
		const scene = renderDiagram({
			...timelineFixture,
			events: [...timelineFixture.events].reverse(),
		});
		expect(scene).toEqual(renderDiagram(timelineFixture));
		expect(
			scene.elements.filter((element) => element.type === "node").map((element) => element.nodeId),
		).toEqual(["event:plan", "event:beta", "event:release"]);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});
	it("wraps a long chronology without overlapping cards or a huge single row", () => {
		const diagram = parseTimelineDiagram({
			...timelineFixture,
			events: Array.from({ length: 60 }, (_, index) => ({
				id: `event-${index}`,
				order: index,
				label: `Milestone ${index + 1}`,
				description: "Preserve all supplied details in a readable multiline card.",
			})),
		});
		const scene = renderDiagram(diagram);
		expect(scene.width / scene.height).toBeLessThan(3);
		expect(scene.height / scene.width).toBeLessThan(3);
		const cards = scene.elements.filter((element) => element.type === "node");
		expect(cards).toHaveLength(60);
		for (const [i, a] of cards.entries())
			for (const b of cards.slice(i + 1)) {
				expect(
					a.x + a.width <= b.x ||
						b.x + b.width <= a.x ||
						a.y + a.height <= b.y ||
						b.y + b.height <= a.y,
				).toBe(true);
			}
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});
});
