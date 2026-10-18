import { describe, expect, it } from "vitest";
import {
	canvasFrameNameWidth,
	flowchartFixture,
	getCanvasValidationIssues,
	groupFixtures,
	groupRegionIssues,
	routingQualityFindings,
	routingQualityScale,
} from "@sketchi/diagram-core";
import {
	renderIntermediateDiagram,
	type ArrowSceneElement,
	type FrameSceneElement,
	type NodeSceneElement,
	type RenderedDiagramScene,
} from "./scene";

const directions = ["TB", "BT", "LR", "RL"] as const;
type Direction = (typeof directions)[number];
type Name = keyof typeof groupFixtures;
const names = Object.keys(groupFixtures) as Name[];

const scenes = new Map<string, RenderedDiagramScene>();
function rendered(name: Name, direction: Direction = groupFixtures[name].layout.direction) {
	const key = `${name}:${direction}`;
	if (!scenes.has(key))
		scenes.set(
			key,
			renderIntermediateDiagram({
				...groupFixtures[name],
				layout: { direction, edgeRouting: "orthogonal" },
			}),
		);
	return scenes.get(key)!;
}

const framesOf = (scene: RenderedDiagramScene) =>
	scene.elements.filter((e): e is FrameSceneElement => e.type === "frame");
const nodesOf = (scene: RenderedDiagramScene) =>
	scene.elements.filter((e): e is NodeSceneElement => e.type === "node");
const arrowsOf = (scene: RenderedDiagramScene) =>
	scene.elements.filter((e): e is ArrowSceneElement => e.type === "arrow");
const arrow = (scene: RenderedDiagramScene, edgeId: string) =>
	arrowsOf(scene).find((candidate) => candidate.edgeId === edgeId)!;

describe.each(directions)("grouped flowcharts %s", (direction) => {
	it.each(names)("draws %s with each group whole, apart and clear", (name) => {
		const fixture = groupFixtures[name];
		const scene = rendered(name, direction);
		// One frame per group, named by its label, holding exactly its members.
		expect(framesOf(scene).map((frame) => [frame.id, frame.name])).toEqual(
			fixture.groups!.map((group) => [`group:${group.id}`, group.label]),
		);
		for (const node of nodesOf(scene)) {
			const group = fixture.nodes.find((candidate) => candidate.id === node.nodeId)!.group;
			expect(node.frameId).toBe(group === undefined ? undefined : `group:${group}`);
			const label = scene.elements.find((e) => e.type === "text" && e.containerId === node.id);
			expect(label?.frameId).toBe(node.frameId);
		}
		expect(groupRegionIssues(scene)).toEqual([]);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		// Frames sit under everything they hold.
		expect(scene.zOrder.slice(0, fixture.groups!.length)).toEqual(
			fixture.groups!.map((group) => `group:${group.id}`),
		);
	});
});

describe("grouped flowchart layout", () => {
	it("runs the flow straight from one group into the next", () => {
		const scene = rendered("grouped-approval");
		// Expense incurred → Submit, Submit → Review, Approved? → Verify, Pay → Expense paid.
		for (const edgeId of ["e1", "e2", "e4", "e8"])
			expect(arrow(scene, edgeId).points).toHaveLength(2);
		const findings = routingQualityFindings(
			arrowsOf(scene).map((a) => ({
				id: a.id,
				points: a.points,
				sourceId: a.sourceNodeId,
				targetId: a.targetNodeId,
			})),
			routingQualityScale(scene),
		);
		expect(findings).toEqual([]);
	});

	it("lays a long grouped flow's groups across it instead of one long strip", () => {
		const scene = rendered("three-zone-service");
		const nodes = new Map(nodesOf(scene).map((node) => [node.nodeId, node]));
		// The edge zone reads top to bottom inside a left-to-right flow.
		expect(
			new Set(["cdn", "cached", "waf"].map((id) => nodes.get(id)!.x + nodes.get(id)!.width / 2))
				.size,
		).toBe(1);
		expect(nodes.get("cdn")!.y).toBeLessThan(nodes.get("cached")!.y);
		expect(nodes.get("cached")!.y).toBeLessThan(nodes.get("waf")!.y);
		expect(Math.max(scene.width / scene.height, scene.height / scene.width)).toBeLessThan(2.5);
		// Zones still read left to right.
		const [internet, edge, subnet] = framesOf(scene);
		expect(internet!.x + internet!.width).toBeLessThan(edge!.x);
		expect(edge!.x + edge!.width).toBeLessThan(subnet!.x);
	});

	it("keeps a group's own edges inside its frame, as frame children", () => {
		const scene = rendered("single-group");
		for (const route of arrowsOf(scene)) expect(route.frameId).toBe("group:billing");
		for (const text of scene.elements.filter((e) => e.type === "text" && !e.containerId))
			expect(text.frameId).toBe("group:billing");
	});

	it("keeps the edges between groups out of frames", () => {
		const scene = rendered("mixed-membership");
		expect(arrow(scene, "e6").frameId).toBeUndefined();
		expect(arrow(scene, "e2").frameId).toBeUndefined();
		expect(arrow(scene, "e4").frameId).toBe("group:warehouse");
	});

	it("sizes a frame to hold a labeled branch that loops back inside it", () => {
		const scene = rendered("scattered-members");
		const [, oncall] = framesOf(scene);
		expect(arrow(scene, "e8").frameId).toBe("group:oncall");
		for (const point of arrow(scene, "e8").points) {
			expect(point.y).toBeLessThan(oncall!.y + oncall!.height);
			expect(point.x).toBeLessThan(oncall!.x + oncall!.width);
		}
	});

	it.each(directions)("widens a frame to its whole wide-glyph name in %s", (direction) => {
		// Excalidraw cuts a frame's name to the frame's width when it paints it; thirty
		// Helvetica W glyphs at 14 px paint 30 x 14 x 0.944 px wide.
		const label = "W".repeat(30);
		const fixture = groupFixtures["three-zone-service"];
		const scene = renderIntermediateDiagram({
			...fixture,
			// The one-node internet zone is narrower than its name.
			groups: fixture.groups!.map((group) =>
				group.id === "internet" ? { ...group, label } : group,
			),
			layout: { direction, edgeRouting: "orthogonal" },
		});
		const [frame] = framesOf(scene);
		expect(frame!.width).toBeGreaterThanOrEqual(30 * 14 * 0.944);
		expect(frame!.width).toBeGreaterThanOrEqual(canvasFrameNameWidth(label));
		expect(groupRegionIssues(scene)).toEqual([]);
	});

	it("renders an ungrouped flowchart exactly as before", () => {
		const { groups: _groups, ...ungrouped } = flowchartFixture;
		expect(renderIntermediateDiagram({ ...ungrouped, groups: [] })).toEqual(
			renderIntermediateDiagram(ungrouped),
		);
		expect(framesOf(renderIntermediateDiagram(ungrouped))).toEqual([]);
	});
});
