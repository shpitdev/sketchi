import { describe, expect, it } from "vitest";
import {
	formatGanttDay,
	parseGanttDay,
	parseGanttDiagram,
	type GanttDiagram,
} from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/**
 * A plan of `count` tasks: each depends on up to `fanIn` earlier tasks, mostly
 * recent ones, with milestones and phases mixed in.
 */
function plan(seed: number, count: number, fanIn: number): GanttDiagram {
	const next = random(seed);
	const origin = parseGanttDay("2026-01-05")!;
	const span = [20, 120, 400][seed % 3]!;
	let dependencies = 0;
	const tasks = Array.from({ length: count }, (_, index) => {
		const start = origin + Math.floor((index / count) * span + next() * 10);
		const milestone = next() < 0.15;
		const earlier = Array.from({ length: index }, (_, at) => `t${at}`).reverse();
		const dependsOn = earlier
			.filter((_, distance) => next() < (distance < 6 ? 0.35 : 0.04))
			.slice(0, Math.min(fanIn, 120 - dependencies));
		dependencies += dependsOn.length;
		return {
			id: `t${index}`,
			label: `Task ${index} ${"review ".repeat(Math.floor(next() * 3))}`.trim(),
			start: formatGanttDay(start),
			...(milestone ? { milestone: true } : { duration: 1 + Math.floor(next() * span * 0.2) }),
			phase: `Phase ${Math.floor((index / count) * 4) + 1}`,
			...(dependsOn.length ? { dependsOn } : {}),
		};
	});
	return parseGanttDiagram({ id: `plan-${seed}`, title: `Plan ${seed}`, type: "gantt", tasks });
}

describe("Gantt export", () => {
	// Dependencies are elbow arrows bound to their bars: none passes through another shape, none
	// lies on another, and every endpoint lands on its bar.
	it.each([1, 2, 3, 4, 5, 6])("exports plan %i with no Excalidraw issue", (seed) => {
		const diagram = plan(seed, 12 + seed * 6, 2);
		const scene = renderDiagram(diagram);
		expect(validateExcalidrawScene(convertSceneToExcalidraw(scene))).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("exports a milestone that waits on 19 parallel tasks, each arrow on its own path", () => {
		const diagram = parseGanttDiagram({
			id: "fan-in",
			title: "Fan-in",
			type: "gantt",
			tasks: [
				...Array.from({ length: 19 }, (_, index) => ({
					id: `t${index}`,
					label: `Task ${index}`,
					start: "2026-03-02",
					duration: 5,
				})),
				{
					id: "done",
					label: "Done",
					start: "2026-03-09",
					milestone: true,
					dependsOn: Array.from({ length: 19 }, (_, index) => `t${index}`),
				},
			],
		});
		expect(validateExcalidrawScene(convertSceneToExcalidraw(renderDiagram(diagram)))).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("draws every dependency of a crowded plan within the canvas limits", () => {
		const diagram = plan(7, 45, 4);
		const scene = renderDiagram(diagram);
		const dependencies = diagram.tasks.reduce(
			(sum, task) => sum + (task.dependsOn?.length ?? 0),
			0,
		);
		expect(scene.elements.filter((element) => element.type === "arrow")).toHaveLength(dependencies);
		expect(validateExcalidrawScene(convertSceneToExcalidraw(scene))).toEqual({
			ok: true,
			issues: [],
		});
	});
});
