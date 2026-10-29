import { describe, expect, it } from "vitest";
import type { QuadrantDiagram } from "@sketchi/diagram-core";
import { readQuadrantScene, renderDiagram } from "@sketchi/diagram-renderer";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";

import { evaluateScenarioDiagram } from "./evaluate.js";
import { FixtureGenerationClientLayer } from "./fixture-client.js";
import { candidateFromMcpResult } from "./mcp-results.js";
import { toDiagramGenerationPrompt } from "./prompt.js";
import {
	quadrantDrawnCheck,
	quadrantLayoutCheck,
	quadrantScenarios,
} from "./quadrant-scenarios.js";

const scenario = (id: string) => quadrantScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: QuadrantDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const backlog = scenario("effort-impact-quadrant").expectedDiagram;
const eisenhower = scenario("eisenhower-matrix-quadrant").expectedDiagram;
const positioning = scenario("competitor-positioning-quadrant").expectedDiagram;
const withPoint = (
	diagram: QuadrantDiagram,
	label: string,
	change: (point: QuadrantDiagram["points"][number]) => QuadrantDiagram["points"][number],
): QuadrantDiagram => ({
	...diagram,
	points: diagram.points.map((point) => (point.label === label ? change(point) : point)),
});

describe("prompt-grounded quadrant scenarios", () => {
	it("covers a crowded challenge, membership only, a highlight and an empty quadrant", () => {
		expect(quadrantScenarios.map((entry) => entry.difficulty).toSorted()).toEqual([
			"challenge",
			"smoke",
			"standard",
		]);
		expect(backlog.points).toHaveLength(15);
		const quickWins = backlog.points.filter((point) => point.x < 0.5 && point.y > 0.5);
		expect(quickWins).toHaveLength(8);
		expect(backlog.points.some((point) => point.x === 0.5)).toBe(true);
		expect(eisenhower.points).toHaveLength(8);
		expect(positioning.points.filter((point) => point.group)).toHaveLength(1);
		for (const entry of quadrantScenarios) expect(entry.prompt).toContain("quadrant chart");
	});

	it("passes its own expected diagram, including what the scene draws and its layout", () => {
		for (const entry of quadrantScenarios)
			expect(failed(entry.id, entry.expectedDiagram), entry.id).toEqual([]);
	});

	it("lays the challenge's crowded quick wins out with leaders and its midline point readable", () => {
		const scene = renderDiagram(backlog);
		expect(quadrantLayoutCheck(backlog, scene).passed).toBe(true);
		expect(quadrantDrawnCheck(backlog, scene).passed).toBe(true);
		const { dots, plot } = readQuadrantScene(scene);
		const admin = backlog.points.findIndex((point) => point.label === "Admin role templates");
		const center = dots.find((dot) => dot.index === admin)!.center;
		expect(center.x).toBeCloseTo((plot!.left + plot!.right) / 2, 1);
	});

	it("accepts an axis drawn high to low when every name and point follows it", () => {
		// Urgent on the left puts Do first top-left; every task mirrors across the urgency axis.
		const reversed: QuadrantDiagram = {
			...eisenhower,
			xAxis: { title: "Urgency", low: "Urgent", high: "Not urgent" },
			quadrants: {
				topLeft: eisenhower.quadrants.topRight,
				topRight: eisenhower.quadrants.topLeft,
				bottomLeft: eisenhower.quadrants.bottomRight,
				bottomRight: eisenhower.quadrants.bottomLeft,
			},
			points: eisenhower.points.map((point) => ({ ...point, x: 1 - point.x })),
		};
		expect(failed("eisenhower-matrix-quadrant", reversed)).toEqual([]);
		const backward: QuadrantDiagram = {
			...backlog,
			yAxis: { title: "Impact", low: "High impact", high: "Low impact" },
			quadrants: {
				topLeft: backlog.quadrants.bottomLeft,
				topRight: backlog.quadrants.bottomRight,
				bottomLeft: backlog.quadrants.topLeft,
				bottomRight: backlog.quadrants.topRight,
			},
			points: backlog.points.map((point) => ({ ...point, y: 1 - point.y })),
		};
		expect(failed("effort-impact-quadrant", backward)).toEqual([]);
	});

	it("accepts the stated end words for an axis the prompt leaves unlabeled", () => {
		const worded: QuadrantDiagram = {
			...eisenhower,
			xAxis: { title: "Urgency", low: "Less urgent", high: "More urgent" },
			yAxis: { title: "Importance", low: "Unimportant", high: "Very important" },
		};
		expect(failed("eisenhower-matrix-quadrant", worded)).toEqual([]);
	});

	it.each([
		[
			"a point moved across a midline",
			"effort-impact-quadrant",
			() => withPoint(backlog, "Dark mode", (point) => ({ ...point, x: 0.6 })),
			["position:dark-mode"],
		],
		[
			"two quadrant names swapped",
			"effort-impact-quadrant",
			() => ({
				...backlog,
				quadrants: {
					...backlog.quadrants,
					topLeft: backlog.quadrants.topRight,
					topRight: backlog.quadrants.topLeft,
				},
			}),
			["quadrant:quick-wins", "quadrant:major-projects"],
		],
		[
			"an axis whose ends contradict the placements",
			"effort-impact-quadrant",
			() => ({ ...backlog, xAxis: { title: "Effort", low: "High effort", high: "Low effort" } }),
			[
				"quadrant:quick-wins",
				"quadrant:major-projects",
				"quadrant:fill-ins",
				"quadrant:thankless-tasks",
				// Read through the stated ends, every point off the midline lands mirrored.
				...scenario("effort-impact-quadrant")
					.expectedDiagram.points.filter((point) => point.x !== 0.5)
					.map(
						(point) =>
							`position:${Object.entries(scenario("effort-impact-quadrant").assertions.points).find(([, expected]) => expected.labels[0] === point.label)![0]}`,
					),
			],
		],
		[
			"an unstated axis end",
			"effort-impact-quadrant",
			() => ({ ...backlog, xAxis: { title: "Effort", low: "Easy", high: "Hard" } }),
			["axis-ends:x"],
		],
		[
			"the wrong variable on an axis",
			"competitor-positioning-quadrant",
			() => ({ ...positioning, xAxis: { ...positioning.xAxis, title: "Cost" } }),
			["axis:x"],
		],
		[
			"a task in the wrong quadrant",
			"eisenhower-matrix-quadrant",
			() => withPoint(eisenhower, "Browse conference swag", (point) => ({ ...point, y: 0.8 })),
			["quadrant-of:conference-swag"],
		],
		[
			"a task on a midline",
			"eisenhower-matrix-quadrant",
			() => withPoint(eisenhower, "Mentor the new hire", (point) => ({ ...point, x: 0.49 })),
			["quadrant-of:mentor"],
		],
		[
			"an invented item",
			"competitor-positioning-quadrant",
			() => ({
				...positioning,
				points: [...positioning.points, { label: "Notion", x: 0.3, y: 0.8 }],
			}),
			["points-exact"],
		],
		[
			"a dropped item",
			"competitor-positioning-quadrant",
			() => ({
				...positioning,
				points: positioning.points.filter((point) => point.label !== "Jira"),
			}),
			["point:jira", "position:jira", "points-exact"],
		],
		[
			"the highlight shared with a competitor",
			"competitor-positioning-quadrant",
			() => withPoint(positioning, "Trello", (point) => ({ ...point, group: "Our product" })),
			["highlight:our-product"],
		],
		[
			"no highlight at all",
			"competitor-positioning-quadrant",
			() => withPoint(positioning, "Our product", ({ group: _group, ...point }) => point),
			["highlight:our-product"],
		],
		[
			"a point in the quadrant the scores leave empty",
			"competitor-positioning-quadrant",
			() => withPoint(positioning, "ClickUp", (point) => ({ ...point, y: 0.45 })),
			["position:clickup", "empty:budget-and-complex"],
		],
	] as const)("fails %s", (_, id, change, checks) => {
		expect(failed(id, change()).toSorted()).toEqual([...checks].toSorted());
	});

	it("reads the drawing: a moved dot or a label over another fails the scene checks", () => {
		const scene = renderDiagram(positioning);
		const moved = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "node" && element.nodeId === "quadrant:point:0"
					? { ...element, x: element.x + 12 }
					: element,
			),
		};
		expect(quadrantDrawnCheck(positioning, moved).message).toContain("Trello dot");
		const label = scene.elements.find((element) => element.id === "quadrant:label:1")!;
		const stacked = {
			...scene,
			elements: scene.elements.map((element) =>
				element.id === "quadrant:label:0" && element.type === "text" && label.type === "text"
					? { ...element, x: label.x, y: label.y }
					: element,
			),
		};
		expect(quadrantLayoutCheck(positioning, stacked).passed).toBe(false);
		const renamed = {
			...scene,
			elements: scene.elements.map((element) =>
				element.id === "quadrant:axis:y:high" && element.type === "text"
					? { ...element, text: "Easy" }
					: element,
			),
		};
		expect(quadrantDrawnCheck(positioning, renamed).message).toContain("y axis high");
	});

	it("serves the fixture model's diagram, meeting its count and every named point", async () => {
		const candidate = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* DiagramGenerationClient;
				return yield* client.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario("effort-impact-quadrant")),
				});
			}).pipe(Effect.provide(FixtureGenerationClientLayer)),
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toEqual(backlog);
	});

	it("grades a buildQuadrantChart receipt from an MCP execute", () => {
		const { type: _type, ...spec } = positioning;
		const receipt = {
			ok: true,
			status: "accepted",
			operation: "buildQuadrantChart",
			buildId: "build-1",
			normalizedSpec: spec,
			quality: { accepted: true },
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, result: { ok: true, status: "accepted", buildId: "build-1" }, builds: [receipt] },
			"quadrant",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected the accepted receipt.");
		expect(failed("competitor-positioning-quadrant", candidate.diagram as QuadrantDiagram)).toEqual(
			[],
		);
	});
});
