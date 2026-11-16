import { FlowchartDiagram, FLOWCHART_NODE_COLORS, flowchartDiagramFromSpec } from "./document.js";
import { Schema } from "effect";
import type {
	CanvasConnectorElement as ArrowSceneElement,
	CanvasShapeElement as NodeSceneElement,
} from "@sketchi/drawing";
import { SKETCHI_DIAGRAM_STYLE, getCanvasValidationIssues } from "@sketchi/drawing";

import { describe, expect, it } from "vitest";

import { flowchartFixture, pharmaBatchDispositionFlowchart } from "./fixtures/index.js";

import { renderFlowchartDiagram } from "./render";

describe("Flowchart renderer contract", () => {
	it("renders the generated fixture into deterministic scene elements", () => {
		const scene = renderFlowchartDiagram(flowchartFixture);

		expect(scene.diagramId).toBe("onboarding-flow");
		expect(renderFlowchartDiagram(flowchartFixture)).toEqual(scene);
		expect(
			scene.elements.filter((element) => element.type === "text" && element.containerId),
		).toHaveLength(flowchartFixture.nodes.length);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(scene.elements.filter((element) => element.type === "node")).toHaveLength(
			flowchartFixture.nodes.length,
		);
		expect(scene.elements.filter((element) => element.type === "arrow")).toHaveLength(
			flowchartFixture.edges.length,
		);
	});

	it("routes downward non-decision edges vertically before crossing ranks", () => {
		const scene = renderFlowchartDiagram(pharmaBatchDispositionFlowchart);
		const packagingArrow = scene.elements.find(
			(element) => element.type === "arrow" && element.edgeId === "review-packaging",
		);

		expect(packagingArrow).toMatchObject({
			type: "arrow",
			points: expect.arrayContaining([expect.objectContaining({ x: expect.any(Number) })]),
		});

		if (packagingArrow?.type !== "arrow") {
			throw new Error("Expected review-packaging arrow.");
		}

		const start = packagingArrow.points[0];
		const end = packagingArrow.points[packagingArrow.points.length - 1];

		if (!start || !end) {
			throw new Error("Expected an orthogonal review-packaging route.");
		}

		for (let index = 0; index < packagingArrow.points.length - 1; index += 1) {
			const previous = packagingArrow.points[index];
			const current = packagingArrow.points[index + 1];

			if (!previous || !current) {
				throw new Error("Expected contiguous route points.");
			}

			expect(previous.x === current.x || previous.y === current.y).toBe(true);
		}

		expect(end.y).toBeGreaterThan(start.y);
	});
});

describe("authored Flowchart drawing defaults", () => {
	it("uses the Sketchi palette when the authored document omits styling", () => {
		const scene = renderFlowchartDiagram(
			flowchartDiagramFromSpec({
				title: "Brand defaults",
				nodes: { start: "Start", done: "Done" },
				edges: [["start", "done"]],
			}),
		);
		expect(scene).toMatchObject(SKETCHI_DIAGRAM_STYLE);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});
});

interface TestScenePoint {
	x: number;
	y: number;
}

function shapeBoundaryValue(shape: NodeSceneElement, point: TestScenePoint): number | null {
	const halfWidth = shape.width / 2;
	const halfHeight = shape.height / 2;
	const centerX = shape.x + halfWidth;
	const centerY = shape.y + halfHeight;

	if (halfWidth === 0 || halfHeight === 0) {
		return null;
	}

	if (shape.shape === "diamond") {
		return Math.abs(point.x - centerX) / halfWidth + Math.abs(point.y - centerY) / halfHeight;
	}

	if (shape.shape === "ellipse" || shape.shape === "circle") {
		return ((point.x - centerX) / halfWidth) ** 2 + ((point.y - centerY) / halfHeight) ** 2;
	}

	return null;
}

function nonRectangularBoundaryValue(
	shape: NodeSceneElement | undefined,
	point: TestScenePoint | undefined,
): number | null {
	return shape && point ? shapeBoundaryValue(shape, point) : null;
}

function expectClosePoint(actual: TestScenePoint | undefined, expected: TestScenePoint) {
	if (!actual) {
		throw new Error("Expected a scene point.");
	}

	expect(Math.abs(actual.x - expected.x)).toBeLessThan(0.05);
	expect(Math.abs(actual.y - expected.y)).toBeLessThan(0.05);
}

describe("renderFlowchartDiagram", () => {
	it("keeps forward LR flowchart edges on horizontal ports", () => {
		const scene = renderFlowchartDiagram({
			...flowchartFixture,
			layout: { ...flowchartFixture.layout, direction: "LR" },
		});
		const source = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "prompt",
		);
		const target = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "requirements",
		);
		const arrow = scene.elements.find(
			(element) => element.type === "arrow" && element.edgeId === "prompt-requirements",
		);
		if (
			!source ||
			source.type !== "node" ||
			!target ||
			target.type !== "node" ||
			!arrow ||
			arrow.type !== "arrow"
		) {
			throw new Error("Expected LR flowchart route geometry.");
		}
		expect(arrow.points[0]?.x).toBe(source.x + source.width);
		expect(arrow.points.at(-1)?.x).toBe(target.x);
	});

	it("maps flowchart kinds to real scene shapes", () => {
		const scene = renderFlowchartDiagram(flowchartFixture);

		expect(
			scene.elements.find((element) => element.type === "node" && element.nodeId === "prompt"),
		).toMatchObject({ shape: "ellipse" });
		expect(
			scene.elements.find((element) => element.type === "node" && element.nodeId === "clear"),
		).toMatchObject({ shape: "diamond" });
	});

	it("wraps long labels into larger node boxes before real export", () => {
		const scene = renderFlowchartDiagram(pharmaBatchDispositionFlowchart);
		const qaReviewNode = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "qa-review",
		);

		expect(qaReviewNode).toMatchObject({
			type: "node",
			label: expect.stringContaining("\n"),
		});
		if (!qaReviewNode || qaReviewNode.type !== "node") {
			throw new Error("Expected qa-review to render as a node scene element.");
		}
		expect(qaReviewNode.height).toBeGreaterThan(72);
	});

	it("spreads decision branches into separate rank positions", () => {
		const scene = renderFlowchartDiagram(flowchartFixture);
		const clear = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "clear",
		);
		const draft = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "draft",
		);
		const review = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "review",
		);

		if (
			!clear ||
			clear.type !== "node" ||
			!draft ||
			draft.type !== "node" ||
			!review ||
			review.type !== "node"
		) {
			throw new Error("Expected onboarding nodes to render as scene nodes.");
		}

		expect(draft.y).toBeGreaterThan(clear.y);
		expect(review.y).toBeGreaterThan(draft.y);
		expect(draft.x + draft.width / 2).toBe(clear.x + clear.width / 2);
	});

	it("routes offset decision branches with orthogonal points", () => {
		const scene = renderFlowchartDiagram(flowchartFixture);
		const clear = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "clear",
		);
		const clearDraft = scene.elements.find(
			(element) => element.type === "arrow" && element.edgeId === "clear-draft",
		);
		const clearReview = scene.elements.find(
			(element) => element.type === "arrow" && element.edgeId === "clear-review",
		);

		expect(clearDraft).toMatchObject({ type: "arrow" });
		expect(clearReview).toMatchObject({ type: "arrow" });

		if (!clear || clear.type !== "node") {
			throw new Error("Expected clear to render as a node.");
		}
		if (!clearDraft || clearDraft.type !== "arrow") {
			throw new Error("Expected clear-draft to render as an arrow.");
		}
		if (!clearReview || clearReview.type !== "arrow") {
			throw new Error("Expected clear-review to render as an arrow.");
		}

		expect(clearDraft.points.length).toBe(2);
		expect(clearReview.points.length).toBeGreaterThan(2);
		expectClosePoint(clearDraft.points[0], {
			x: clear.x + clear.width / 2,
			y: clear.y + clear.height,
		});
		expectClosePoint(clearReview.points[0], {
			x: clear.x + clear.width,
			y: clear.y + clear.height / 2,
		});
		expect(clearReview.points[1]?.x).toBeGreaterThan(clearReview.points[0].x);
	});

	it("keeps offset ports on non-rectangular shape perimeters", () => {
		const scene = renderFlowchartDiagram(flowchartFixture);
		const nodesById = new Map(
			scene.elements
				.filter((element): element is NodeSceneElement => element.type === "node")
				.map((element) => [element.nodeId, element]),
		);
		const arrows = scene.elements.filter(
			(element): element is ArrowSceneElement => element.type === "arrow",
		);
		const checkedEndpoints: string[] = [];

		for (const arrow of arrows) {
			const source = nodesById.get(arrow.sourceNodeId);
			const target = nodesById.get(arrow.targetNodeId);
			const start = arrow.points[0];
			const end = arrow.points[arrow.points.length - 1];
			const sourceValue = nonRectangularBoundaryValue(source, start);
			const targetValue = nonRectangularBoundaryValue(target, end);

			if (sourceValue !== null) {
				checkedEndpoints.push(`${arrow.edgeId}:source`);
				expect(Math.abs(sourceValue - 1)).toBeLessThan(0.001);
			}

			if (targetValue !== null) {
				checkedEndpoints.push(`${arrow.edgeId}:target`);
				expect(Math.abs(targetValue - 1)).toBeLessThan(0.001);
			}
		}

		expect(checkedEndpoints).toEqual(
			expect.arrayContaining([
				"clear-draft:source",
				"clear-review:source",
				"clear-review:target",
				"draft-review:target",
			]),
		);
	});
});

it("draws a colored node in its palette stroke over a pale fill, at the standard width", () => {
	const scene = renderFlowchartDiagram(
		Schema.decodeUnknownSync(FlowchartDiagram)({
			...flowchartFixture,
			nodes: [
				{ id: "A", label: "Ready", color: "green", kind: "process" },
				{ id: "B", label: "Ship", kind: "process" },
			],
			edges: [{ id: "ab", source: "A", target: "B" }],
			type: "flowchart",
		}),
	);
	const node = (id: string) =>
		scene.elements.find((element) => element.type === "node" && element.nodeId === id);
	expect(node("A")).toMatchObject({
		strokeColor: FLOWCHART_NODE_COLORS.green.stroke,
		fillColor: FLOWCHART_NODE_COLORS.green.fill,
		fillStyle: "solid",
	});
	expect(node("A")).not.toHaveProperty("strokeWidth");
	expect(node("B")).not.toHaveProperty("strokeColor");
	expect(getCanvasValidationIssues(scene)).toEqual([]);
});
