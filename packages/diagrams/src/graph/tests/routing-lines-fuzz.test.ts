// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import {
	crossingFixtures,
	sideFixtures,
} from "../../families/flowchart/fixtures/crossing-fixtures";
import { parseFlowchartDiagram } from "../../families/flowchart/document";
import { groupFixtures } from "../../families/flowchart/fixtures/group-fixtures";
import { laneFixtures } from "../../families/flowchart/fixtures/lane-fixtures";
import {
	fanInChecksFlowchart,
	leftToRightIncidentFlowchart,
	routingFixtures,
} from "../../families/flowchart/fixtures/routing-fixtures";
import { zoneFixtures } from "../../families/flowchart/fixtures/zone-fixtures";
import { renderFlowchartDiagram } from "../../families/flowchart/render";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
	FULL,
	routingCounts,
	KNOWN_TOUCHING_FIXTURES,
	fanInFlowcharts,
	KNOWN_TOUCHING_FAN_INS,
} from "./routing-fuzz-helpers";

describe("lines sharing a segment", () => {
	// Two lines drawn along one run read as one, and a reader cannot follow
	// either. Main drew every incident escalation flow so left to right and
	// right to left: the fix check's yes branch and Monitoring's line one unit
	// apart for about 500 units into Resolve incident. No realistic flowchart
	// may, in any direction; the random graphs above, far denser, may draw no
	// more than pinned (SHARED).
	const fixtures = [
		...Object.entries(crossingFixtures),
		...Object.entries(sideFixtures),
		...Object.entries(routingFixtures),
		["incident-escalation-left-to-right", leftToRightIncidentFlowchart] as const,
		...(FULL
			? [
					...Object.entries(groupFixtures),
					...Object.entries(zoneFixtures),
					...Object.entries(laneFixtures),
				]
			: []),
	];
	it.each(FULL ? (["TB", "BT", "LR", "RL"] as const) : (["LR", "RL"] as const))(
		"draws no realistic flowchart with two lines along one segment: %s",
		(direction) => {
			expect(
				fixtures.flatMap(([name, fixture]) => {
					const { shared } = routingCounts(
						renderFlowchartDiagram({
							...fixture,
							layout: { ...fixture.layout, direction },
						}),
					);
					return shared > 0 ? [`${name}: ${shared}`] : [];
				}),
			).toEqual([]);
		},
		60_000,
	);
});

describe("lines that touch", () => {
	// Two lines that meet anywhere but a clean crossing, one bending or ending on
	// or beside the other, read as one line that forks or merges there. Main drew
	// every generated incident response whose three stability checks fan into
	// Monitor service and Escalate incident with one check's no branch and its
	// neighbor's yes branch turning one unit apart. No realistic flowchart may, in
	// any direction, but those still known; the random graphs above, far denser,
	// may draw no more than pinned (TOUCHES).
	const fixtures = [
		...Object.entries(crossingFixtures),
		...Object.entries(sideFixtures),
		...Object.entries(routingFixtures),
		["incident-escalation-left-to-right", leftToRightIncidentFlowchart] as const,
		["incident-fan-in-checks", fanInChecksFlowchart] as const,
		...(FULL
			? [
					...Object.entries(groupFixtures),
					...Object.entries(zoneFixtures),
					...Object.entries(laneFixtures),
				]
			: []),
	];
	it.each(["TB", "BT", "LR", "RL"] as const)(
		"draws no realistic flowchart with two lines touching: %s",
		(direction) => {
			expect(
				fixtures.flatMap(([name, fixture]) => {
					const { touches } = routingCounts(
						renderFlowchartDiagram({
							...fixture,
							layout: { ...fixture.layout, direction },
						}),
					);
					const known = KNOWN_TOUCHING_FIXTURES[`${name}:${direction}`] ?? 0;
					return touches > known ? [`${name}: ${known} -> ${touches}`] : [];
				}),
			).toEqual([]);
		},
		120_000,
	);

	const fanIns = fanInFlowcharts().filter((spec) => FULL || spec.id === "fan-in-3-0-loop");
	it.each(["TB", "BT", "LR", "RL"] as const)(
		"draws checks fanning into shared steps with no more lines touching than known: %s",
		(direction) => {
			expect(
				fanIns.flatMap((spec) => {
					const { touches } = routingCounts(
						renderFlowchartDiagram(
							parseFlowchartDiagram({
								...spec,
								type: "flowchart",
								layout: { direction, edgeRouting: "orthogonal" },
							}).pipe(Result.getOrThrow),
						),
					);
					const known = KNOWN_TOUCHING_FAN_INS[`${spec.id}:${direction}`] ?? 0;
					return touches > known ? [`${spec.id}:${direction}: ${known} -> ${touches}`] : [];
				}),
			).toEqual([]);
		},
		300_000,
	);
});
