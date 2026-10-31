import { describe, expect, it } from "vitest";
import {
	crossingFixtures,
	leftToRightIncidentFlowchart,
	queriedArchitectureFlowchart,
	receiptReturnFlowchart,
	routingFixtures,
	routingQualityScale,
	sharedSegments,
	sideFixtures,
	wrappedLabelWidth,
	wrapTextToWidth,
} from "@sketchi/diagram-core";
import { arrowCrossings, renderIntermediateDiagram, type RenderedDiagramScene } from "./scene";

type Point = { readonly x: number; readonly y: number };
type Side = "top" | "right" | "bottom" | "left";

function line(scene: RenderedDiagramScene, edgeId: string) {
	const arrow = scene.elements.find(
		(element) => element.type === "arrow" && element.edgeId === edgeId,
	);
	if (arrow?.type !== "arrow") throw new Error(`No line for ${edgeId}`);
	return arrow;
}

/** The side of a node's box a line's end lies on. */
function sideOf(scene: RenderedDiagramScene, nodeId: string, point: Point): Side | undefined {
	const node = scene.elements.find(
		(element) => element.type === "node" && element.nodeId === nodeId,
	);
	if (node?.type !== "node") throw new Error(`No node ${nodeId}`);
	const near = (a: number, b: number) => Math.abs(a - b) < 1;
	if (near(point.y, node.y)) return "top";
	if (near(point.y, node.y + node.height)) return "bottom";
	if (near(point.x, node.x)) return "left";
	if (near(point.x, node.x + node.width)) return "right";
	return undefined;
}

/** Where a line leaves its source and where it enters its target. */
function sides(scene: RenderedDiagramScene, edgeId: string): [Side | undefined, Side | undefined] {
	const { points, sourceNodeId, targetNodeId } = line(scene, edgeId);
	return [sideOf(scene, sourceNodeId, points[0]), sideOf(scene, targetNodeId, points.at(-1)!)];
}

/** Turns along a line, its straight runs merged. */
function bends(points: readonly Point[]): number {
	let turns = 0;
	for (let index = 1; index + 1 < points.length; index += 1) {
		const [a, b, c] = [points[index - 1]!, points[index]!, points[index + 1]!];
		if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) turns += 1;
	}
	return turns;
}

describe("decision branch sides", () => {
	it("sends the fix check's escalation down to the bridge's side and its fix down the far side, crossing nothing", () => {
		// The yes branch once left right, jogged back left and crossed the no
		// branch, which left the other way and wrapped back under the check.
		const scene = renderIntermediateDiagram(crossingFixtures["incident-escalation-shared-resolve"]);
		expect(sides(scene, "edge-11")).toEqual(["bottom", "left"]);
		expect(sides(scene, "edge-10")[0]).toBe("left");
		expect(
			arrowCrossings(
				scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : [])),
			),
		).toBe(0);
	});

	it.each([["invoice-approval", "e9"]] as const)(
		"leaves %s's last check forward to a target behind its other branch, into the side facing it",
		(name, edgeId) => {
			// The branch once left by the vertex facing away, wrapped down the
			// outside and turned back into its target's top beside another head.
			const scene = renderIntermediateDiagram(routingFixtures[name]);
			expect(sides(scene, edgeId)).toEqual(["bottom", "right"]);
			expect(bends(line(scene, edgeId).points)).toBe(1);
		},
	);
});

describe("returns into a decision", () => {
	it("raises the receipt request's return into the check's free bottom vertex, not round to its far side", () => {
		// The check sends its branches out by its side vertices; the return once
		// wound right, up and back left into the far face, beside the right branch.
		const scene = renderIntermediateDiagram(receiptReturnFlowchart);
		const check = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "receipt",
		);
		if (check?.type !== "node") throw new Error("No receipt check");
		const { points } = line(scene, "edge-3");
		expect(sides(scene, "edge-3")[1]).toBe("bottom");
		expect(points.at(-1)!.x).toBe(check.x + check.width / 2);
		expect(bends(points)).toBeLessThanOrEqual(1);
	});
});

describe("arrival sides", () => {
	const scene = renderIntermediateDiagram(queriedArchitectureFlowchart);

	it("enters the database from the side both queries approach, without dipping below it", () => {
		// The API's queries once ran past the database's foot, dipped and hooked up into it.
		expect(sides(scene, "edge-4")[1]).toBe("left");
		expect(sides(scene, "edge-5")[1]).toBe("left");
		expect(bends(line(scene, "edge-5").points)).toBe(2);
	});

	it("drops the users' requests into the load balancer without swinging around the region's name", () => {
		const { points } = line(scene, "edge-1");
		const [start, end] = [points[0], points.at(-1)!];
		expect(bends(points)).toBeLessThanOrEqual(2);
		expect(
			points.every(
				(point) =>
					point.x >= Math.min(start.x, end.x) - 1 && point.x <= Math.max(start.x, end.x) + 1,
			),
		).toBe(true);
	});
});

const arrowsOf = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));

describe("live incident samples", () => {
	it("draws the queued triage sample with one crossing where main drew two", () => {
		// Monitoring's line once crossed the triage connector, and the high line
		// crossed the fix check's yes beside the bridge.
		const scene = renderIntermediateDiagram(sideFixtures["incident-escalation-queue"]);
		expect(arrowCrossings(arrowsOf(scene))).toBeLessThanOrEqual(1);
	});

	it.each(["incident-escalation-queue", "incident-escalation-straight-escalation"] as const)(
		"drops %s's escalation straight from the fix check into the bridge below it",
		(name) => {
			// The escalation once left by the check's bottom, swung left and turned
			// back into the bridge's left side, though the bridge stands straight below.
			const scene = renderIntermediateDiagram(sideFixtures[name]);
			expect(sides(scene, "edge-11")).toEqual(["bottom", "top"]);
			expect(bends(line(scene, "edge-11").points)).toBe(0);
		},
	);
});

/** A node of the scene by its id. */
function nodeOf(scene: RenderedDiagramScene, nodeId: string) {
	const node = scene.elements.find(
		(element) => element.type === "node" && element.nodeId === nodeId,
	);
	if (node?.type !== "node") throw new Error(`No node ${nodeId}`);
	return node;
}

/** The side of its target a line enters by, from the way its last run heads; curved sides included. */
function arrivalSide(points: readonly Point[]): Side {
	const [before, end] = [points.at(-2)!, points.at(-1)!];
	return Math.abs(end.x - before.x) > Math.abs(end.y - before.y)
		? end.x < before.x
			? "right"
			: "left"
		: end.y > before.y
			? "top"
			: "bottom";
}

describe("branches merging into one end", () => {
	it.each([
		"patient-intake-merge-detour",
		"patient-intake-merge-crossing",
		"patient-intake-merge-long",
	] as const)(
		"brings %s's insurance and self-pay branches into routine scheduling by sides facing them, crossing nothing",
		(name) => {
			// With round 29's shorter labels the self-pay branch once ran down past
			// routine scheduling, along its foot and round into its far side, or,
			// a little narrower, crossed the insurance branch into its top.
			const scene = renderIntermediateDiagram(crossingFixtures[name]);
			expect(arrowCrossings(arrowsOf(scene))).toBe(0);
			for (const edgeId of ["edge-6", "edge-8"]) {
				const { points, sourceNodeId, targetNodeId } = line(scene, edgeId);
				const [source, target] = [nodeOf(scene, sourceNodeId), nodeOf(scene, targetNodeId)];
				const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
				const facing = {
					top: from.y < target.y,
					right: from.x > target.x + target.width,
					bottom: from.y > target.y + target.height,
					left: from.x < target.x,
				};
				expect(facing[arrivalSide(points)]).toBe(true);
				// No run strays past the box the two nodes span.
				const [left, top] = [Math.min(source.x, target.x), Math.min(source.y, target.y)];
				const right = Math.max(source.x + source.width, target.x + target.width);
				const bottom = Math.max(source.y + source.height, target.y + target.height);
				for (const point of points) {
					expect(point.x).toBeGreaterThanOrEqual(left - 1);
					expect(point.x).toBeLessThanOrEqual(right + 1);
					expect(point.y).toBeGreaterThanOrEqual(top - 1);
					expect(point.y).toBeLessThanOrEqual(bottom + 1);
				}
			}
		},
	);

	it("brings Monitoring into Resolve incident's side beneath the fix check's yes branch, crossing nothing", () => {
		// Monitoring's line runs down outside the yes branch. It once turned in
		// over Resolve incident's top and crossed the yes branch on its way, in
		// every sample of rounds 27, 28 and 29.
		const scene = renderIntermediateDiagram(
			crossingFixtures["incident-escalation-monitoring-merge"],
		);
		expect(arrowCrossings(arrowsOf(scene))).toBe(0);
		const [yes, monitoring] = [line(scene, "edge-10").points, line(scene, "edge-12").points];
		expect(arrivalSide(yes)).toBe("right");
		expect(arrivalSide(monitoring)).toBe("right");
		expect(yes.at(-1)!.y).toBeLessThan(monitoring.at(-1)!.y);
	});

	it("keeps Monitoring's line off the fix check's yes branch into Resolve incident, left to right", () => {
		// Both lines run beneath the queue row. Monitoring's once stepped down
		// midway, clear of its port, and ran along the yes branch one unit from
		// it for about 500 units: two lines drawn as one. Round 30, two of five
		// Sonnet samples.
		const scene = renderIntermediateDiagram(leftToRightIncidentFlowchart);
		const routes = arrowsOf(scene).map((arrow) => ({ id: arrow.edgeId, points: arrow.points }));
		expect(arrowCrossings(arrowsOf(scene))).toBe(0);
		expect(sharedSegments(routes, routingQualityScale(scene))).toEqual([]);
		const [yes, monitoring] = [line(scene, "edge-10").points, line(scene, "edge-12").points];
		const below = (points: readonly Point[]) => Math.max(...points.map((point) => point.y));
		expect(below(monitoring)).toBeGreaterThan(below(yes));
		// Monitoring steps down before the yes branch begins, not beside it.
		expect(monitoring[1]!.x).toBeLessThan(yes[0].x);
	});
});

describe("branch labels", () => {
	it("keeps a short branch's label clear of its own arrowhead's wing", () => {
		const scene = renderIntermediateDiagram(sideFixtures["expense-out-of-policy"]);
		const label = scene.elements.find(
			(element) => element.type === "text" && element.id === "edge:edge-6:label",
		);
		if (label?.type !== "text") throw new Error("No label for edge-6");
		const { points } = line(scene, "edge-6");
		const text = wrapTextToWidth(label.text, label.maxWidth ?? 160, label.fontSize);
		const width = wrappedLabelWidth(text, label.fontSize, label.maxWidth ?? 160);
		const left = label.x - width / 2;
		// An arrowhead's wing reaches 25 sin 20 degrees, 8.6 units, beside its line.
		expect(left - points[0].x).toBeGreaterThan(25 * Math.sin((20 * Math.PI) / 180) + 2);
	});
});
