import { describe, expect, it } from "vitest";
import { crossingFixtures } from "./crossing-fixtures.js";
import { routingFixtures } from "./routing-fixtures.js";
import { renderFlowchartDiagram } from "./render.js";
import {
	crossings,
	cornerEnds,
	outlineGaps,
	arrowheadsCrossed,
} from "../../../test/readability-helpers.js";

/** Room every line keeps from the outline of a node it passes. */
const NODE_CLEARANCE = 12;

/**
 * Crossings each fixture drew on main (fd92ae12; the waitlist's table-ready loop
 * and the incident response's provider loop, f492f6c4) and draws now, counting
 * a line that crosses a route where the route runs straight on. The loop trades
 * vertices with the ready check's other branch; the provider branch keeps a
 * lane of its own past the ranks it skips (Arrangement.skipLanes).
 */
const CROSSINGS: Readonly<Record<keyof typeof crossingFixtures, readonly [number, number]>> = {
	"incident-escalation": [3, 0],
	"incident-escalation-bridge": [3, 0],
	"incident-escalation-early-bridge": [3, 0],
	"incident-escalation-shared-resolve": [2, 0],
	"incident-escalation-monitoring-merge": [1, 0],
	"subscription-renewal-dunning": [2, 0],
	"subscription-renewal-grace": [2, 0],
	"patient-intake-scheduling": [1, 0],
	"patient-intake-merge-detour": [0, 0],
	"patient-intake-merge-crossing": [1, 0],
	"patient-intake-merge-long": [0, 0],
	"procurement-vendor-approval": [1, 0],
	"procurement-vendor-approval-legal": [2, 0],
	"restaurant-waitlist": [1, 0],
	"restaurant-waitlist-recheck": [1, 0],
	"restaurant-waitlist-table-ready": [1, 0],
	"incident-response-provider-loop": [1, 0],
	"grouped-expense-approval": [1, 0],
	"content-moderation": [0, 0],
};

const flowcharts = Object.keys(crossingFixtures) as (keyof typeof crossingFixtures)[];
const scenes = new Map(
	flowcharts.map((name) => [name, renderFlowchartDiagram(crossingFixtures[name])] as const),
);

describe("avoidable crossings in generated flowcharts", () => {
	if (process.env.PRINT_CROSSINGS)
		console.log(flowcharts.map((name) => `${name}: ${crossings(scenes.get(name)!).length}`));

	it.each(flowcharts)("draws %s with fewer crossings than main, or none", (name) => {
		const [main, now] = CROSSINGS[name];
		expect(crossings(scenes.get(name)!).length).toBeLessThanOrEqual(now);
		expect(now).toBeLessThanOrEqual(Math.max(0, main - 1));
	});

	it.each(["TB", "BT", "LR", "RL"] as const)(
		"keeps every line of each crossing fixture clear of other arrowheads in %s",
		(direction) => {
			const crossed = flowcharts.flatMap((name) =>
				arrowheadsCrossed(
					renderFlowchartDiagram({
						...crossingFixtures[name],
						layout: { direction, edgeRouting: "orthogonal" },
					}),
				).map((finding) => `${name}: ${finding}`),
			);
			expect(crossed).toEqual([]);
		},
	);

	it.each(flowcharts)("meets every rounded node of %s on the straight part of a side", (name) => {
		expect(cornerEnds(scenes.get(name)!)).toEqual([]);
	});

	it("keeps each line clear of every node it passes, rounded and pointed nodes included", () => {
		const close = flowcharts.flatMap((name) =>
			outlineGaps(scenes.get(name)!)
				.filter(({ gap }) => gap < NODE_CLEARANCE)
				.map(({ edge, gap, node }) => `${name}: ${edge} ${gap.toFixed(1)} px from ${node}`),
		);
		expect(close).toEqual([]);
	});

	it.each(["TB", "BT", "LR", "RL"] as const)(
		"keeps each routing fixture's lines clear of the nodes they pass in %s",
		(direction) => {
			const close = Object.entries(routingFixtures).flatMap(([name, fixture]) =>
				outlineGaps(
					renderFlowchartDiagram({
						...fixture,
						layout: { direction, edgeRouting: "orthogonal" },
					}),
				)
					.filter(({ gap }) => gap < NODE_CLEARANCE)
					.map(({ edge, gap, node }) => `${name}: ${edge} ${gap.toFixed(1)} px from ${node}`),
			);
			expect(close).toEqual([]);
		},
	);
});
