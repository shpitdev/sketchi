import { parseIntermediateDiagram, type IntermediateDiagram } from "./intermediate.js";
import { parseFlowchartDiagram } from "./types/flowchart.js";
import hiring from "./fixtures/lanes/hiring.js";
import incidentResponse from "./fixtures/lanes/incident-response.js";
import orderFulfilment from "./fixtures/lanes/order-fulfilment.js";
import singleLane from "./fixtures/lanes/single-lane.js";
import skipLanes from "./fixtures/lanes/skip-lanes.js";

function flowchart(fixture: object, direction: "LR" | "TB" = "LR") {
	return parseFlowchartDiagram({
		...fixture,
		type: "flowchart",
		layout: { direction, edgeRouting: "orthogonal" },
	});
}

/**
 * Swimlane flowcharts: handoffs between neighboring lanes, a loop back across
 * lanes, handoffs that skip a lane, parallel steps in one lane and a single
 * lane. Every step must sit in its lane, lanes in declared order, and edges
 * cross lane boundaries without running along them.
 */
export const laneFixtures = {
	"order-fulfilment": flowchart(orderFulfilment),
	hiring: flowchart(hiring, "TB"),
	"incident-response": flowchart(incidentResponse),
	"skip-lanes": flowchart(skipLanes),
	"single-lane": flowchart(singleLane, "TB"),
};

const STRESS_ACTORS = ["Customer", "Support", "Billing", "Engineering", "QA", "Release"];
const STRESS_STEPS = [
	"Report the problem",
	"Triage the ticket",
	"Check the account",
	"Reproduce the bug",
	"Write a fix",
	"Review the change",
	"Run regression tests",
	"Approve the release",
	"Ship the fix",
	"Confirm with customer",
];

/**
 * The lane of each of thirty steps: mostly a handoff to the neighboring lane,
 * sometimes a step in the same lane, and a jump of two lanes every fifth step.
 */
const STRESS_WALK = Array.from({ length: 30 }).reduce<number[]>((walk, _, index) => {
	const previous = walk.at(-1) ?? 0;
	const step = [0, 1, 1, 0, 2, -1, 1, 0, -1, -2][index % 10]!;
	const next = previous + step;
	return [...walk, next < 0 || next > 5 ? previous - step : next];
}, []);

/**
 * Laned graphs past a flowchart's limits, drawn straight from the graph
 * contract: six lanes, thirty steps in a long chain that hands off on most
 * steps, and a dense graph whose loops return across several lanes.
 */
export const laneStressFixtures: Readonly<
	Record<"six-lanes-thirty-steps" | "cross-lane-loops", IntermediateDiagram>
> = {
	"six-lanes-thirty-steps": parseIntermediateDiagram({
		id: "six-lanes-thirty-steps",
		title: "Thirty steps across six lanes",
		type: "flowchart",
		lanes: STRESS_ACTORS.map((label, index) => ({ id: `l${index}`, label })),
		nodes: Array.from({ length: 30 }, (_, index) => ({
			id: `s${index}`,
			label: `${STRESS_STEPS[index % STRESS_STEPS.length]} ${index}`,
			kind: index === 0 ? "start" : index === 29 ? "end" : index % 7 === 3 ? "decision" : "process",
			lane: `l${STRESS_WALK[index]}`,
		})),
		edges: [
			...Array.from({ length: 29 }, (_, index) => ({
				id: `e${index}`,
				source: `s${index}`,
				target: `s${index + 1}`,
				...(index % 7 === 3 ? { label: "yes" } : {}),
			})),
			// Each decision's other branch skips ahead or loops back.
			...Array.from({ length: 30 }, (_, index) => index)
				.filter((index) => index % 7 === 3 && index < 28)
				.map((index) => ({
					id: `b${index}`,
					source: `s${index}`,
					target: `s${index % 2 === 0 ? index + 2 : index - 2}`,
					label: "no",
				})),
		],
		layout: { direction: "LR", edgeRouting: "orthogonal" },
	}),
	"cross-lane-loops": parseIntermediateDiagram({
		id: "cross-lane-loops",
		title: "Loops across lanes",
		type: "flowchart",
		lanes: STRESS_ACTORS.slice(0, 4).map((label, index) => ({ id: `l${index}`, label })),
		nodes: Array.from({ length: 14 }, (_, index) => ({
			id: `n${index}`,
			label: `${STRESS_STEPS[index % STRESS_STEPS.length]} ${index}`,
			kind: index === 0 ? "start" : index === 13 ? "end" : index % 3 === 2 ? "decision" : "process",
			lane: `l${(index * 3) % 4}`,
		})),
		edges: [
			...Array.from({ length: 13 }, (_, index) => ({
				id: `e${index}`,
				source: `n${index}`,
				target: `n${index + 1}`,
				...(index % 3 === 2 ? { label: "yes" } : {}),
			})),
			// Every decision loops back one to three steps, into another lane.
			...[2, 5, 8, 11].map((index) => ({
				id: `loop${index}`,
				source: `n${index}`,
				target: `n${Math.max(1, index - 2 - (index % 2))}`,
				label: "retry",
			})),
		],
		layout: { direction: "LR", edgeRouting: "orthogonal" },
	}),
};
