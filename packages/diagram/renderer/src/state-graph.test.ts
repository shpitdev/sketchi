import { describe, expect, it } from "vitest";
import {
	AXIS_ALIGNED_EPSILON,
	getCanvasValidationIssues,
	groupRegionIssues,
	type IntermediateDiagram,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
} from "@sketchi/diagram-core";
import {
	isStructurallyValidStateMarker,
	type ArrowSceneElement,
	type FrameSceneElement,
	type NodeSceneElement,
	type RenderedDiagramScene,
	renderGraphDiagram,
	type TextSceneElement,
} from "./scene";

/**
 * Graphs as a state machine draws them: pseudostates (an initial dot, final
 * bullseyes, an unlabeled choice), self-loops, a transition and its return,
 * and transitions into and out of a composite state's frame. The graph contract
 * rejects these, so they render through renderGraphDiagram.
 */
const node = (id: string, label: string, kind: string, group?: string) => ({
	id,
	label,
	kind,
	metadata: {},
	...(group ? { group } : {}),
});
const edge = (id: string, source: string, target: string, label?: string) => ({
	id,
	source,
	target,
	metadata: {},
	...(label ? { label } : {}),
});
const graph = (input: Pick<IntermediateDiagram, "edges" | "id" | "nodes" | "groups">) =>
	({
		title: input.id,
		type: "flowchart",
		style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
		metadata: {},
		layout: { direction: "TB", edgeRouting: "orthogonal" },
		...input,
	}) as IntermediateDiagram;

const order = graph({
	id: "order",
	nodes: [
		node("init", "", "initial"),
		node("pending", "Pending payment", "state"),
		node("paid", "Paid", "state"),
		node("shipped", "Shipped", "state"),
		node("cancelled", "Cancelled", "state"),
		node("end-shipped", "", "final"),
		node("end-cancelled", "", "final"),
	],
	edges: [
		edge("start", "init", "pending"),
		edge("pay", "pending", "paid", "pay [card valid] / charge"),
		edge("cancel", "pending", "cancelled", "cancel"),
		edge("ship", "paid", "shipped", "ship / notify"),
		edge("reject", "shipped", "paid", "reject shipment"),
		edge("remind", "pending", "pending", "remind / email"),
		edge("done", "shipped", "end-shipped"),
		edge("closed", "cancelled", "end-cancelled"),
	],
});

const player = graph({
	id: "player",
	groups: [{ id: "active", label: "Active" }],
	nodes: [
		node("init", "", "initial"),
		node("stopped", "Stopped", "state"),
		node("active-init", "", "initial", "active"),
		node("playing", "Playing", "state", "active"),
		node("paused", "Paused", "state", "active"),
	],
	edges: [
		edge("start", "init", "stopped"),
		edge("play", "stopped", "active", "play"),
		edge("enter", "active-init", "playing"),
		edge("pause", "playing", "paused", "pause"),
		edge("resume", "paused", "playing", "resume"),
		edge("stop", "active", "stopped", "stop"),
		edge("seek", "playing", "playing", "seek / jump"),
	],
});

const light = graph({
	id: "light",
	nodes: [
		node("init", "", "initial"),
		node("red", "Red", "state"),
		node("check", "", "choice"),
		node("green", "Green", "state"),
	],
	edges: [
		edge("start", "init", "red"),
		edge("timer", "red", "check", "timer"),
		edge("go", "check", "green", "[car waiting]"),
		edge("wait", "check", "red", "[else]"),
		edge("expire", "green", "red", "timer"),
		edge("tick", "red", "red", "tick / count"),
	],
});

const directions = ["TB", "BT", "LR", "RL"] as const;
const render = (diagram: IntermediateDiagram, direction: (typeof directions)[number]) =>
	renderGraphDiagram(
		{ ...diagram, layout: { direction, edgeRouting: "orthogonal" } },
		{ pairedReturns: true },
	);
const nodesOf = (scene: RenderedDiagramScene) =>
	scene.elements.filter((e): e is NodeSceneElement => e.type === "node");
const arrowOf = (scene: RenderedDiagramScene, edgeId: string) =>
	scene.elements.find((e): e is ArrowSceneElement => e.type === "arrow" && e.edgeId === edgeId)!;
const nodeOf = (scene: RenderedDiagramScene, nodeId: string) =>
	nodesOf(scene).find((candidate) => candidate.nodeId === nodeId)!;
const labelOf = (scene: RenderedDiagramScene, edgeId: string) =>
	scene.elements.find(
		(e): e is TextSceneElement => e.type === "text" && e.id === `edge:${edgeId}:label`,
	)!;
const labelBox = (label: TextSceneElement) => {
	const lines = label.text.split("\n");
	const width = Math.min(label.maxWidth ?? 160, label.text.length * 8);
	const height = lines.length * label.fontSize * 1.35;
	return { x: label.x - width / 2, y: label.y - height / 2, width, height };
};

/** Arrows overlapping another arrow or crossing a node they do not end at. */
function routeDefects(scene: RenderedDiagramScene): string[] {
	const arrows = scene.elements.filter((e): e is ArrowSceneElement => e.type === "arrow");
	const defects: string[] = [];
	for (const arrow of arrows) {
		for (const shape of nodesOf(scene))
			if (
				shape.nodeId !== arrow.sourceNodeId &&
				shape.nodeId !== arrow.targetNodeId &&
				segmentsFromPoints(arrow.points).some((segment) =>
					segmentCrossesBoundsInterior(segment, shape),
				)
			)
				defects.push(`${arrow.id} crosses ${shape.id}`);
	}
	return defects;
}

describe.each(directions)("state graphs %s", (direction) => {
	it.each([order, player, light])("draws $id with valid geometry", (diagram) => {
		const scene = render(diagram, direction);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(groupRegionIssues(scene)).toEqual([]);
		expect(routeDefects(scene)).toEqual([]);
	});

	it("draws pseudostates as fixed, unlabeled markers", () => {
		const scene = render(order, direction);
		for (const [id, size] of [
			["init", 20],
			["end-shipped", 28],
			["end-cancelled", 28],
		] as const) {
			const marker = nodeOf(scene, id);
			expect([marker.shape, marker.width, marker.height]).toEqual(["circle", size, size]);
			expect(scene.elements.some((e) => e.type === "text" && e.containerId === marker.id)).toBe(
				false,
			);
		}
		const choice = nodeOf(render(light, direction), "check");
		expect(choice.shape).toBe("diamond");
		expect(choice.width).toBe(choice.height);
		expect(choice.width).toBeGreaterThanOrEqual(44);
		// Markers keep their role through edits: the initial dot filled, the final
		// a ring with a filled core grouped to it.
		for (const marker of [nodeOf(scene, "init"), nodeOf(scene, "end-shipped"), choice]) {
			expect(marker.rendererRole).toBe("state-marker");
			expect(isStructurallyValidStateMarker(marker)).toBe(true);
		}
		expect(nodeOf(scene, "init")).toMatchObject({ fillColor: "#8f707f", fillStyle: "solid" });
		const ring = nodeOf(scene, "end-shipped");
		const core = nodeOf(scene, "end-shipped:core");
		expect(core).toMatchObject({ fillColor: "#8f707f", rendererRole: "state-marker" });
		expect(core.groupIds).toEqual(ring.groupIds);
		expect(core.x > ring.x && core.x + core.width < ring.x + ring.width).toBe(true);
	});

	it("keeps every marker it draws structurally valid, however large a choice grows", () => {
		const branches = [1, 2, 3, 4, 5];
		const wide = graph({
			id: "wide-choice",
			nodes: [
				node("init", "", "initial"),
				node("intake", "Intake", "state"),
				node("route", "", "choice"),
				...branches.map((n) => node(`s${n}`, `Handler ${n}`, "state")),
				node("end", "", "final"),
			],
			edges: [
				edge("start", "init", "intake"),
				edge("triage", "intake", "route", "triage"),
				...branches.map((n) =>
					edge(`b${n}`, "route", `s${n}`, `[condition ${n} applies to this request]`),
				),
				edge("done", "s1", "end"),
			],
		});
		const scene = render(wide, direction);
		const markers = nodesOf(scene).filter((shape) => shape.rendererRole === "state-marker");
		expect(
			markers.map((marker) => marker.kind ?? "").toSorted((a, b) => a.localeCompare(b)),
		).toEqual(["choice", "final", "final-core", "initial"]);
		for (const marker of markers)
			expect(isStructurallyValidStateMarker(marker), marker.id).toBe(true);
	});

	it("lines a marker up with its transition, which runs straight", () => {
		const scene = render(order, direction);
		for (const id of ["start", "done", "closed"])
			expect(arrowOf(scene, id).points, id).toHaveLength(2);
	});

	it("draws a self-loop around a corner of its state with the label outside", () => {
		for (const [diagram, id, stateId] of [
			[order, "remind", "pending"],
			[player, "seek", "playing"],
			[light, "tick", "red"],
		] as const) {
			const scene = render(diagram, direction);
			const loop = arrowOf(scene, id);
			const state = nodeOf(scene, stateId);
			// Out of one side, around the corner, into the adjacent side.
			expect(loop.points).toHaveLength(5);
			const [start, , , , end] = loop.points;
			const side = (point: { x: number; y: number }) =>
				Math.abs(point.x - state.x) < AXIS_ALIGNED_EPSILON
					? "left"
					: Math.abs(point.x - state.x - state.width) < AXIS_ALIGNED_EPSILON
						? "right"
						: Math.abs(point.y - state.y) < AXIS_ALIGNED_EPSILON
							? "top"
							: "bottom";
			const [from, to] = [side(start), side(end!)];
			expect(["left", "right"].includes(from) !== ["left", "right"].includes(to)).toBe(true);
			// The loop and its label stay outside the state.
			const outside = segmentsFromPoints(loop.points).every(
				(segment) => !segmentCrossesBoundsInterior(segment, state),
			);
			expect(outside).toBe(true);
			const box = labelBox(labelOf(scene, id));
			expect(
				segmentsFromPoints(loop.points).some((s) => segmentCrossesBoundsInterior(s, box)),
			).toBe(false);
			expect(
				box.x < state.x + state.width &&
					state.x < box.x + box.width &&
					box.y < state.y + state.height &&
					state.y < box.y + box.height,
			).toBe(false);
		}
	});

	it("draws a transition and its return as two parallel lines, labels outside", () => {
		for (const [diagram, there, back] of [
			[order, "ship", "reject"],
			[player, "pause", "resume"],
		] as const) {
			const scene = render(diagram, direction);
			const [forward, ret] = [arrowOf(scene, there), arrowOf(scene, back)];
			// Each leaves the side the other arrives at, and they never share a point.
			expect(forward.points.at(-1)).not.toEqual(ret.points[0]);
			expect(ret.points.at(-1)).not.toEqual(forward.points[0]);
			const axis = direction === "TB" || direction === "BT" ? "x" : "y";
			const [a, b] = [forward.points[0][axis], ret.points.at(-1)![axis]];
			expect(Math.abs(a - b)).toBeGreaterThanOrEqual(18);
			// The forward line runs on the low side with its label beyond it; the
			// return runs on the high side with its label beyond that.
			expect(a).toBeLessThan(b);
			expect(labelOf(scene, there)[axis]).toBeLessThan(a);
			expect(labelOf(scene, back)[axis]).toBeGreaterThan(b);
		}
	});

	it("routes transitions into and out of a composite state to its frame", () => {
		const scene = render(player, direction);
		const frame = scene.elements.find((e): e is FrameSceneElement => e.type === "frame")!;
		expect(frame).toMatchObject({ id: "group:active", name: "Active", nodeId: "active" });
		const onOutline = (point: { x: number; y: number }) =>
			(Math.abs(point.x - frame.x) < AXIS_ALIGNED_EPSILON ||
				Math.abs(point.x - frame.x - frame.width) < AXIS_ALIGNED_EPSILON ||
				Math.abs(point.y - frame.y) < AXIS_ALIGNED_EPSILON ||
				Math.abs(point.y - frame.y - frame.height) < AXIS_ALIGNED_EPSILON) &&
			point.x >= frame.x - AXIS_ALIGNED_EPSILON &&
			point.x <= frame.x + frame.width + AXIS_ALIGNED_EPSILON &&
			point.y >= frame.y - AXIS_ALIGNED_EPSILON &&
			point.y <= frame.y + frame.height + AXIS_ALIGNED_EPSILON;
		expect(onOutline(arrowOf(scene, "play").points.at(-1)!)).toBe(true);
		expect(onOutline(arrowOf(scene, "stop").points[0])).toBe(true);
		// Neither enters the frame; its members, inner dot included, stay inside.
		for (const id of ["play", "stop"])
			expect(
				segmentsFromPoints(arrowOf(scene, id).points).some((segment) =>
					segmentCrossesBoundsInterior(segment, frame),
				),
			).toBe(false);
		for (const id of ["active-init", "playing", "paused"])
			expect(nodeOf(scene, id).frameId).toBe("group:active");
	});
});
