import { describe, expect, it } from "vitest";

import {
	CANVAS_NODE_ICON,
	canvasBoundTextInset,
	canvasNodeIconBox,
	deployPipelineLogoFlowchart,
	embedCanvasIcons,
	flowchartFixture,
	getCanvasValidationIssues,
	pharmaBatchDispositionFlowchart,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
	segmentsOverlapInterior,
	type CanvasShapeElement,
	type CanvasSpec,
	type CanvasTextElement,
	type LayoutDirection,
} from "@sketchi/diagram-core";

import { renderIntermediateDiagram } from "./scene";

const LABEL_LINE_HEIGHT = 1.35;
const LABEL_WIDTH_FACTOR = 0.62;

function deployPipeline(direction: LayoutDirection) {
	return {
		...deployPipelineLogoFlowchart,
		layout: { ...deployPipelineLogoFlowchart.layout, direction },
	};
}

function nodes(scene: CanvasSpec): CanvasShapeElement[] {
	return scene.elements.filter((element): element is CanvasShapeElement => element.type === "node");
}

function labelFor(scene: CanvasSpec, node: CanvasShapeElement) {
	const label = scene.elements.find(
		(element): element is CanvasTextElement =>
			element.type === "text" && element.containerId === node.id,
	);
	if (!label) throw new Error(`Missing label for ${node.id}.`);
	return label;
}

/** Excalidraw 0.18 getBoundTextMaxWidth / getBoundTextMaxHeight. */
function excalidrawBoundTextBox(node: CanvasShapeElement) {
	const padding = CANVAS_NODE_ICON.boundTextPadding * 2;
	if (node.shape === "diamond") {
		return {
			width: Math.round(node.width / 2) - padding,
			height: Math.round(node.height / 2) - padding,
		};
	}
	if (node.shape === "ellipse") {
		return {
			width: Math.round((node.width / 2) * Math.SQRT2) - padding,
			height: Math.round((node.height / 2) * Math.SQRT2) - padding,
		};
	}
	return { width: node.width - padding, height: node.height - padding };
}

function labelSize(label: CanvasTextElement) {
	const lines = label.text.split("\n");
	return {
		width: Math.max(...lines.map((line) => line.length)) * label.fontSize * LABEL_WIDTH_FACTOR,
		height: Math.ceil(lines.length * label.fontSize * LABEL_LINE_HEIGHT),
	};
}

describe("node logo layout", () => {
	for (const direction of ["TB", "LR"] as const) {
		it(`stacks each logo above a bottom-aligned label inside the text box (${direction})`, () => {
			const scene = renderIntermediateDiagram(deployPipeline(direction));
			const sizes = Object.fromEntries(nodes(scene).map((node) => [node.nodeId, node.icon?.size]));
			expect(sizes).toEqual({
				push: 24,
				build: 28,
				tests: 20,
				fix: undefined,
				ship: 24,
			});

			for (const node of nodes(scene).filter((entry) => entry.icon)) {
				const icon = canvasNodeIconBox(node);
				const label = labelFor(scene, node);
				const inset = canvasBoundTextInset(node);
				const box = excalidrawBoundTextBox(node);
				const text = labelSize(label);
				if (!icon) throw new Error(`Missing icon box for ${node.id}.`);

				expect(label.verticalAlign, node.id).toBe("bottom");
				// The logo is centered inside the bound-text box, below its top edge.
				expect(icon.x + icon.width / 2).toBeCloseTo(node.x + node.width / 2);
				expect(icon.y).toBeGreaterThanOrEqual(node.y + inset.y);
				// A bottom-aligned label starts below the logo and its gap.
				const labelTop = node.y + node.height - inset.y - text.height;
				expect(labelTop, node.id).toBeGreaterThanOrEqual(
					icon.y + icon.height + CANVAS_NODE_ICON.gap - 0.5,
				);
				// Excalidraw's edit-time box holds the label width and the logo band.
				expect(text.width, node.id).toBeLessThanOrEqual(box.width);
				expect(text.height + icon.height + CANVAS_NODE_ICON.gap * 2, node.id).toBeLessThanOrEqual(
					box.height,
				);
			}
		});

		it(`routes around logo nodes without crossings or overlaps (${direction})`, () => {
			const scene = renderIntermediateDiagram(deployPipeline(direction));
			const arrows = scene.elements.filter((element) => element.type === "arrow");
			const sceneNodes = nodes(scene);

			for (const arrow of arrows) {
				const segments = segmentsFromPoints(arrow.points);
				for (const node of sceneNodes) {
					if (node.nodeId === arrow.sourceNodeId || node.nodeId === arrow.targetNodeId) {
						continue;
					}
					for (const segment of segments) {
						expect(
							segmentCrossesBoundsInterior(segment, node),
							`${arrow.id} crosses ${node.id}`,
						).toBe(false);
					}
				}
			}
			for (const [index, left] of arrows.entries()) {
				for (const right of arrows.slice(index + 1)) {
					const overlaps = segmentsFromPoints(left.points).some((a) =>
						segmentsFromPoints(right.points).some((b) => segmentsOverlapInterior(a, b)),
					);
					expect(overlaps, `${left.id} overlaps ${right.id}`).toBe(false);
				}
			}
		});
	}

	it("validates once assets are embedded and renders deterministically", () => {
		const diagram = deployPipeline("TB");
		const scene = renderIntermediateDiagram(diagram);
		const { scene: embedded, dropped } = embedCanvasIcons(scene, (slug) => ({
			name: slug,
			svg: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>',
		}));

		expect(dropped).toEqual([]);
		expect(getCanvasValidationIssues(embedded)).toEqual([]);
		expect(renderIntermediateDiagram(diagram)).toEqual(scene);
	});

	it("keeps every logo when Excalidraw rounds its text box", () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>';
		const words = ["배포", "완료", "및", "알림", "部署", "🚀", "Ship", "W"];
		const labels = ["배포 완료 및 알림"];
		for (let length = 1; length <= 60; length += 1) {
			const parts = Array.from({ length }, (_, index) => words[(index + length) % words.length]);
			labels.push(parts.join(" "), parts.join(length % 2 === 0 ? "" : "-"));
		}
		for (const kind of ["start", "process", "decision"] as const) {
			for (const [index, label] of labels.entries()) {
				const scene = renderIntermediateDiagram({
					id: "rounding",
					title: "Rounding",
					nodes: [{ id: `n${index}`, label, kind, icon: { slug: "github" } }],
					edges: [],
				});
				const { scene: embedded, dropped } = embedCanvasIcons(scene, () => ({
					name: "GitHub",
					svg,
				}));
				expect(dropped, `${kind}: ${label}`).toEqual([]);
				expect(getCanvasValidationIssues(embedded), `${kind}: ${label}`).toEqual([]);
			}
		}
	});

	it("keeps plain nodes free of icons and middle-aligned labels", () => {
		const scene = renderIntermediateDiagram(flowchartFixture);
		for (const node of nodes(scene)) {
			expect(node.icon).toBeUndefined();
			expect(labelFor(scene, node).verticalAlign).toBeUndefined();
		}
	});
});

describe("decision label sizing", () => {
	it("sizes diamonds so an Excalidraw edit keeps the stored wrap", () => {
		for (const fixture of [flowchartFixture, pharmaBatchDispositionFlowchart]) {
			const scene = renderIntermediateDiagram(fixture);
			for (const node of nodes(scene).filter((entry) => entry.shape === "diamond")) {
				const box = excalidrawBoundTextBox(node);
				const text = labelSize(labelFor(scene, node));
				expect(text.width, node.id).toBeLessThanOrEqual(box.width);
				expect(text.height, node.id).toBeLessThanOrEqual(box.height);
			}
		}
	});

	it("wraps long decision labels to the narrower diamond measure", () => {
		const scene = renderIntermediateDiagram({
			...flowchartFixture,
			nodes: flowchartFixture.nodes.map((node) =>
				node.id === "clear" ? { ...node, label: "Is the requested scope clear enough?" } : node,
			),
		});
		const diamond = nodes(scene).find((node) => node.nodeId === "clear");
		if (!diamond) throw new Error("Missing decision node.");

		expect(diamond.label.split("\n").every((line) => line.length <= 12)).toBe(true);
		const box = excalidrawBoundTextBox(diamond);
		const text = labelSize(labelFor(scene, diamond));
		expect(text.width).toBeLessThanOrEqual(box.width);
		expect(text.height).toBeLessThanOrEqual(box.height);
	});
});
