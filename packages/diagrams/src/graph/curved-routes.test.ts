import { describe, expect, it } from "vitest";
import { SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";
import type { GraphAnchor } from "./options.js";
import { renderGraphDiagram } from "./scene.js";
import { strays } from "../../test/readability-helpers.js";

describe("curved routes", () => {
	// A composed shape's curved or tapered side sits inside its box, up to a
	// bucket's taper (24 here) at its foot, so a line's straight run there can
	// end inside the box and still be clear of the shape.
	it.each([
		["bucket", "right", 65, { x: 600, y: 420 }, "left"],
		["bucket", "left", 65, { x: -560, y: 420 }, "right"],
		["cylinder", "bottom", 90, { x: 520, y: 520 }, "left"],
		["cylinder", "top", 90, { x: 520, y: -380 }, "left"],
		["pipe", "right", 60, { x: 600, y: 420 }, "left"],
		["pipe", "left", 60, { x: -560, y: 420 }, "right"],
		["document", "bottom", 70, { x: 520, y: 520 }, "left"],
	] as const)(
		"curves a line leaving a %s's %s side, into neither node's drawn shape",
		(shape, side, offset, at, targetSide) => {
			const placement = new Map([
				["a", { x: 0, y: 0, width: 300, height: 200 }],
				["b", { ...at, width: 184, height: 72 }],
			]);
			const route = (source: string, target: string, anchors: Map<string, GraphAnchor>) =>
				renderGraphDiagram(
					{
						nodes: [
							{ id: "a", label: "Composed", kind: "start", shape },
							{ id: "b", label: "Step", kind: "end", shape: "ellipse" },
						],
						edges: [{ id: "e", source, target }],
						layout: { direction: "TB", edgeRouting: "curved" },
					},
					{ id: "composed", title: "Composed", style: SKETCHI_DIAGRAM_STYLE },
					{ placement, anchors },
				);
			// Leaving the composed side, then arriving at it.
			for (const scene of [
				route(
					"a",
					"b",
					new Map([
						["e:source", { side, offset }],
						["e:target", { side: targetSide, offset: 0 }],
					]),
				),
				route(
					"b",
					"a",
					new Map([
						["e:target", { side, offset }],
						["e:source", { side: targetSide, offset: 0 }],
					]),
				),
			]) {
				const [line] = scene.elements.flatMap((element) =>
					element.type === "arrow" ? [element] : [],
				);
				expect(line?.curved).toBe(true);
				// Square lines run only horizontally or vertically; a curved corner does not.
				expect(
					line!.points.some(
						(point, index) =>
							index > 0 &&
							Math.abs(point.x - line!.points[index - 1]!.x) > 0.01 &&
							Math.abs(point.y - line!.points[index - 1]!.y) > 0.01,
					),
				).toBe(true);
				expect(strays(scene)).toEqual([]);
			}
		},
	);
});
