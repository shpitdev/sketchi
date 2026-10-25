import { describe, expect, it } from "vitest";
import {
	crossingFixtures,
	queriedArchitectureFlowchart,
	receiptReturnFlowchart,
	routingFixtures,
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
