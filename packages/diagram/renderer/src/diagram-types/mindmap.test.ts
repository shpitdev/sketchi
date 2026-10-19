import { describe, expect, it } from "vitest";

import {
	getCanvasValidationIssues,
	type MindmapTopicTree,
	mindmapDiagramFromTree,
	mindmapFixture,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram.js";
import { mindmapLayoutIssues } from "../mindmap-readout.js";
import type {
	ArrowSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	ScenePoint,
} from "../scene.js";

const nodes = (scene: RenderedDiagramScene) =>
	scene.elements.filter((element): element is NodeSceneElement => element.type === "node");
const arrows = (scene: RenderedDiagramScene) =>
	scene.elements.filter((element): element is ArrowSceneElement => element.type === "arrow");
const node = (scene: RenderedDiagramScene, id: string) =>
	nodes(scene).find((entry) => entry.nodeId === id)!;
const centerX = (shape: NodeSceneElement) => shape.x + shape.width / 2;
const centerY = (shape: NodeSceneElement) => shape.y + shape.height / 2;
const leaves = (...labels: string[]): MindmapTopicTree[] => labels.map((label) => ({ label }));

function mindmap(root: MindmapTopicTree, direction: "LR" | "RL" = "LR") {
	return mindmapDiagramFromTree({ id: "test-map", title: "Test map", root, direction });
}

const product = mindmap({
	label: "App launch",
	children: [
		{ label: "Goals", children: leaves("10k signups", "4-star rating") },
		{ label: "Features", children: leaves("Shared budgets", "Bank sync", "Spending alerts") },
		{ label: "Design", children: leaves("Onboarding flow", "Dark mode") },
		{ label: "Engineering", children: leaves("Load testing", "Crash reporting") },
		{ label: "Marketing", children: leaves("Launch video", "Press kit") },
		{ label: "Support", children: leaves("Help center", "In-app chat") },
	],
});

describe("Mindmap renderer", () => {
	it("renders the fixture into a valid deterministic scene", () => {
		const scene = renderDiagram(mindmapFixture);
		expect(scene.diagramId).toBe("public-mindmap-capability");
		expect(nodes(scene)).toHaveLength(mindmapFixture.nodes.length);
		expect(arrows(scene)).toHaveLength(mindmapFixture.edges.length);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(mindmapLayoutIssues(scene)).toEqual([]);
		expect(renderDiagram(mindmapFixture)).toEqual(scene);
	});

	it("centers the central topic and balances main branches on both sides, clockwise", () => {
		const scene = renderDiagram(product);
		const root = node(scene, "topic-0");
		expect(root).toMatchObject({ kind: "root", shape: "ellipse" });
		const main = [0, 1, 2, 3, 4, 5].map((index) => node(scene, `topic-0-${index}`));
		const right = main.filter((shape) => centerX(shape) > centerX(root));
		const left = main.filter((shape) => centerX(shape) < centerX(root));
		expect([right.length, left.length]).toEqual([3, 3]);
		// The first branches run down the right from the top, the rest up the left.
		expect(right.map((shape) => shape.nodeId)).toEqual(["topic-0-0", "topic-0-1", "topic-0-2"]);
		expect(
			right.every((shape, index) => index === 0 || centerY(shape) > centerY(right[index - 1]!)),
		).toBe(true);
		expect(left.map((shape) => shape.nodeId)).toEqual(["topic-0-3", "topic-0-4", "topic-0-5"]);
		expect(
			left.every((shape, index) => index === 0 || centerY(shape) < centerY(left[index - 1]!)),
		).toBe(true);
		// Subtrees grow away from the center.
		expect(node(scene, "topic-0-0-0").x).toBeGreaterThan(node(scene, "topic-0-0").x);
		expect(node(scene, "topic-0-3-0").x).toBeLessThan(node(scene, "topic-0-3").x);
		expect(mindmapLayoutIssues(scene)).toEqual([]);
	});

	it("mirrors the clockwise order for RL", () => {
		const scene = renderDiagram({ ...product, layout: { ...product.layout, direction: "RL" } });
		const root = node(scene, "topic-0");
		expect(centerX(node(scene, "topic-0-0"))).toBeLessThan(centerX(root));
		expect(centerX(node(scene, "topic-0-5"))).toBeGreaterThan(centerX(root));
		expect(mindmapLayoutIssues(scene)).toEqual([]);
	});

	it("steps label size down from the center and colors each branch", () => {
		const scene = renderDiagram(product);
		const fontOf = (id: string) =>
			scene.elements.find((element) => element.type === "text" && element.id === `label:${id}`)!;
		expect([fontOf("topic-0"), fontOf("topic-0-0"), fontOf("topic-0-0-0")]).toMatchObject([
			{ fontSize: 20 },
			{ fontSize: 16 },
			{ fontSize: 14 },
		]);
		const goals = node(scene, "topic-0-0");
		const features = node(scene, "topic-0-1");
		expect(goals.strokeColor).not.toBe(features.strokeColor);
		expect(node(scene, "topic-0-0-1").strokeColor).toBe(goals.strokeColor);
		expect(arrows(scene).find((arrow) => arrow.targetNodeId === "topic-0-0-1")?.strokeColor).toBe(
			goals.strokeColor,
		);
	});

	it("joins topics with curves, no arrowheads, bound to both ends and grouped by branch", () => {
		const scene = renderDiagram(product);
		for (const arrow of arrows(scene)) {
			expect(arrow.endArrowhead).toBeNull();
			const source = node(scene, arrow.sourceNodeId);
			const target = node(scene, arrow.targetNodeId);
			const end = arrow.points.at(-1)!;
			// Each curve arrives level at its child's inner edge.
			expect(end.y).toBe(centerY(target));
			expect([target.x, target.x + target.width]).toContain(end.x);
			if (arrow.points.length > 2) expect(arrow.curved).toBe(true);
			const start = arrow.points[0];
			if (source.kind === "root") {
				// The curve from the center leaves the central topic's ellipse.
				const a = source.width / 2;
				const b = source.height / 2;
				expect(
					((start.x - source.x - a) / a) ** 2 + ((start.y - source.y - b) / b) ** 2,
				).toBeCloseTo(1, 2);
				expect(arrow.groupIds).toBeUndefined();
			} else {
				expect([source.x, source.x + source.width]).toContain(start.x);
				expect(arrow.groupIds).toEqual(target.groupIds);
			}
		}
		const branch = scene.elements.filter((element) =>
			"groupIds" in element ? element.groupIds?.includes("branch:topic-0-1") : false,
		);
		// Features: its topic, three subtopics, their labels and the three curves out of it.
		expect(branch).toHaveLength(4 + 4 + 3);
	});

	it("staggers two lone branches rather than drawing a long strip", () => {
		const scene = renderDiagram(
			mindmap({ label: "Decision", children: leaves("Option A", "Option B") }),
		);
		const [a, b] = [node(scene, "topic-0-0"), node(scene, "topic-0-1")];
		expect(centerY(a)).toBeLessThan(centerY(node(scene, "topic-0")));
		expect(centerY(b)).toBeGreaterThan(centerY(node(scene, "topic-0")));
		expect(scene.width / scene.height).toBeLessThanOrEqual(2.5);
	});

	it("folds a deep chain into a list below its topics instead of one long row", () => {
		const chain = [
			"First",
			"Second",
			"Third",
			"Fourth",
			"Fifth",
			"Sixth",
		].reduceRight<MindmapTopicTree>(
			(child, label) => ({ label: `${label} step`, children: [child] }),
			{ label: "Seventh step" },
		);
		const scene = renderDiagram(mindmap({ label: "Root idea", children: [chain] }));
		const sixth = node(scene, "topic-0-0-0-0-0-0");
		const seventh = node(scene, "topic-0-0-0-0-0-0-0");
		// Folded: the deepest steps sit below the one before them, indented.
		expect(seventh.y).toBeGreaterThan(sixth.y + sixth.height);
		expect(seventh.x).toBeGreaterThan(sixth.x);
		expect(scene.width / scene.height).toBeLessThanOrEqual(2.5);
		expect(mindmapLayoutIssues(scene)).toEqual([]);
	});
});

describe("mindmapLayoutIssues", () => {
	const scene = renderDiagram(product);
	const moved = (id: string, change: (element: NodeSceneElement) => Partial<NodeSceneElement>) => ({
		...scene,
		elements: scene.elements.map((element) =>
			element.type === "node" && element.nodeId === id
				? { ...element, ...change(element) }
				: element,
		),
	});

	it("reports topics drawn over each other", () => {
		const goals = node(scene, "topic-0-0");
		expect(
			mindmapLayoutIssues(moved("topic-0-1", () => ({ x: goals.x + 4, y: goals.y + 4 }))).map(
				(issue) => issue.kind,
			),
		).toContain("overlap");
	});

	/** The scene with an arrow redrawn as a straight line to `end`. */
	const redrawn = (
		changes: readonly (readonly [ArrowSceneElement, ScenePoint])[],
	): RenderedDiagramScene => ({
		...scene,
		elements: scene.elements.map((element) => {
			const change = changes.find(([arrow]) => arrow === element);
			return change
				? { ...change[0], points: [change[0].points[0], change[1]], curved: false }
				: element;
		}),
	});
	const into = (id: string) => arrows(scene).find((arrow) => arrow.targetNodeId === id)!;

	it("reports a connector through a topic", () => {
		const design = node(scene, "topic-0-2-0");
		const through = redrawn([[into("topic-0-0-0"), { x: centerX(design), y: centerY(design) }]]);
		expect(mindmapLayoutIssues(through).map((issue) => issue.kind)).toContain("through-node");
	});

	it("reports connectors that cross", () => {
		const goals = into("topic-0-0");
		const features = into("topic-0-1");
		// Swap where the curves to Goals and Features arrive, as straight lines.
		const crossed = redrawn([
			[goals, features.points.at(-1)!],
			[features, goals.points.at(-1)!],
		]);
		expect(mindmapLayoutIssues(crossed).map((issue) => issue.kind)).toContain("crossing");
	});
});
