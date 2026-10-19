import { describe, expect, it } from "vitest";

import {
	classFixture,
	classStressFixtures,
	estimateTextWidth,
	getCanvasValidationIssues,
	parseClassDiagram,
	segmentsFromPoints,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram.js";
import type { ArrowSceneElement, NodeSceneElement, RenderedDiagramScene } from "../scene.js";

const nodes = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "node" ? [element] : []));
const arrows = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
const text = (scene: RenderedDiagramScene, id: string) =>
	scene.elements.find((element) => element.type === "text" && element.id === id);
const box = (scene: RenderedDiagramScene, id: string) =>
	nodes(scene).find((node) => node.id === `node:${id}`)!;
const arrow = (scene: RenderedDiagramScene, id: string) =>
	arrows(scene).find((candidate) => candidate.edgeId === id)!;

const orthogonal = (line: ArrowSceneElement) =>
	line.points.every(
		(point, index) =>
			index === 0 ||
			Math.abs(point.x - line.points[index - 1]!.x) < 0.01 ||
			Math.abs(point.y - line.points[index - 1]!.y) < 0.01,
	);

/** The side of a box a point sits on, if any. */
function sideOf(node: NodeSceneElement, point: { x: number; y: number }): string | undefined {
	if (Math.abs(point.y - node.y) < 0.01) return "top";
	if (Math.abs(point.y - node.y - node.height) < 0.01) return "bottom";
	if (Math.abs(point.x - node.x) < 0.01) return "left";
	if (Math.abs(point.x - node.x - node.width) < 0.01) return "right";
	return undefined;
}

/** Every free label's box, as the label is drawn. */
function labelBoxes(scene: RenderedDiagramScene) {
	return scene.elements.flatMap((element) => {
		if (
			element.type !== "text" ||
			element.containerId !== undefined ||
			!element.id.startsWith("relationship:")
		)
			return [];
		const width = estimateTextWidth(element.text, element.fontSize);
		const height = element.text.split("\n").length * element.fontSize * 1.35;
		return [
			{
				id: element.id,
				left: element.x - width / 2,
				right: element.x + width / 2,
				top: element.y - height / 2,
				bottom: element.y + height / 2,
			},
		];
	});
}

const all = [classFixture, ...Object.values(classStressFixtures)];

describe("class diagram renderer", () => {
	it("renders every fixture into a valid deterministic scene", () => {
		for (const diagram of all) {
			const scene = renderDiagram(diagram);
			expect(scene.diagramId).toBe(diagram.id);
			expect(getCanvasValidationIssues(scene), diagram.id).toEqual([]);
			expect(renderDiagram(diagram)).toEqual(scene);
		}
	});

	it("draws each class as a group: an outline, a name band with its keyword, and its compartments", () => {
		const scene = renderDiagram(classFixture);
		const shape = box(scene, "Shape");
		expect(shape).toMatchObject({
			rendererRole: "class-box",
			kind: "class",
			groupIds: ["class:Shape"],
		});
		const band = box(scene, "Shape:name");
		expect(band).toMatchObject({
			rendererRole: "class-box",
			x: shape.x,
			y: shape.y,
			width: shape.width,
		});
		const methods = box(scene, "Shape:methods");
		expect(methods.y + methods.height).toBe(shape.y + shape.height);
		expect(methods.y).toBeGreaterThan(band.y + band.height);
		expect(text(scene, "label:Shape:name")).toMatchObject({
			text: "«abstract»\nShape",
			containerId: band.id,
		});
		expect(text(scene, "text:Shape:attributes")).toMatchObject({
			text: "# x: double\n# y: double",
			textAlign: "left",
			groupIds: ["class:Shape"],
		});
		expect(text(scene, "text:Shape:methods")).toMatchObject({
			text: "+ area(): double {abstract}\n+ moveTo(x: double, y: double): void",
		});
		expect(text(scene, "label:Drawable:name")).toMatchObject({ text: "«interface»\nDrawable" });
		expect(text(scene, "text:Square:methods")).toMatchObject({
			text: "+ of(side: double): Square {static}",
		});
	});

	it("draws each relationship kind with its UML heads and dashes", () => {
		const diagram = parseClassDiagram({
			id: "kinds",
			title: "Kinds",
			type: "class",
			classes: ["A", "B", "C", "D", "E", "F", "G"]
				.map((id) => ({ id }))
				.concat([{ id: "I", kind: "interface" } as never]),
			relationships: [
				{ id: "inherit", kind: "inheritance", from: "B", to: "A" },
				{ id: "realize", kind: "realization", from: "C", to: "I" },
				{ id: "compose", kind: "composition", from: "A", to: "D" },
				{ id: "aggregate", kind: "aggregation", from: "A", to: "E" },
				{ id: "associate", kind: "association", from: "D", to: "F" },
				{ id: "navigate", kind: "association", from: "E", to: "G", navigable: true },
				{ id: "depend", kind: "dependency", from: "F", to: "G" },
			],
		});
		const scene = renderDiagram(diagram);
		const heads = Object.fromEntries(
			arrows(scene).map((line) => [
				line.edgeId,
				[line.startArrowhead, line.endArrowhead, line.strokeStyle ?? "solid"],
			]),
		);
		expect(heads).toEqual({
			inherit: [null, "triangle_outline", "solid"],
			realize: [null, "triangle_outline", "dashed"],
			compose: ["diamond", null, "solid"],
			aggregate: ["diamond_outline", null, "solid"],
			associate: [null, null, "solid"],
			navigate: [null, "arrow", "solid"],
			depend: [null, "arrow", "dashed"],
		});
		for (const line of arrows(scene)) {
			expect(orthogonal(line), line.id).toBe(true);
			const [first, last] = [
				segmentsFromPoints(line.points)[0]!,
				segmentsFromPoints(line.points).at(-1)!,
			];
			// Every head sits on a straight run long enough to draw it at full size.
			expect(first.max - first.min, line.id).toBeGreaterThanOrEqual(50);
			expect(last.max - last.min, line.id).toBeGreaterThanOrEqual(50);
		}
	});

	it("keeps a relationship's labels apart from a class of the same id", () => {
		const diagram = parseClassDiagram({
			id: "ids",
			title: "Ids",
			type: "class",
			classes: [{ id: "A" }, { id: "B" }],
			relationships: [
				{ id: "A", kind: "association", from: "A", to: "B", label: "owns", toMultiplicity: "1" },
			],
		});
		const scene = renderDiagram(diagram);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		const ids = scene.elements.map((element) => element.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("never packs a superclass's arrivals closer than a port step: the box grows instead", () => {
		const children = Array.from({ length: 12 }, (_, at) => `S${at}`);
		const diagram = parseClassDiagram({
			id: "fan",
			title: "Fan in",
			type: "class",
			classes: [{ id: "Base" }, ...children.map((id) => ({ id }))],
			relationships: children.map((id) => ({
				id: `${id}-is-base`,
				kind: "inheritance",
				from: id,
				to: "Base",
			})),
		});
		const scene = renderDiagram(diagram);
		const base = box(scene, "Base");
		const ports = arrows(scene)
			.map((line) => line.points.at(-1)!)
			.filter((point) => sideOf(base, point) === "bottom")
			.map((point) => point.x)
			.sort((a, b) => a - b);
		expect(ports).toHaveLength(12);
		for (const [index, x] of ports.slice(1).entries())
			expect(x - ports[index]!, `${index}`).toBeGreaterThanOrEqual(32);
		expect(text(scene, "label:Base:name")).toMatchObject({ x: base.x + base.width / 2 });
		expect(box(scene, "Base:name").width).toBe(base.width);
	});

	it("draws an open arrow at the part end of a navigable aggregation", () => {
		const diagram = parseClassDiagram({
			id: "nav",
			title: "Nav",
			type: "class",
			classes: [{ id: "Canvas" }, { id: "Shape" }],
			relationships: [
				{ id: "holds", kind: "aggregation", from: "Canvas", to: "Shape", navigable: true },
			],
		});
		expect(arrow(renderDiagram(diagram), "holds")).toMatchObject({
			startArrowhead: "diamond_outline",
			endArrowhead: "arrow",
		});
	});

	it("stands each superclass above its subclasses, siblings level, lines from top to bottom", () => {
		const scene = renderDiagram(classFixture);
		const [drawable, shape, circle, rectangle, square] = [
			"Drawable",
			"Shape",
			"Circle",
			"Rectangle",
			"Square",
		].map((id) => box(scene, id));
		expect(drawable!.y + drawable!.height).toBeLessThan(shape!.y);
		expect(shape!.y + shape!.height).toBeLessThan(circle!.y);
		expect(circle!.y).toBe(rectangle!.y);
		expect(rectangle!.y + rectangle!.height).toBeLessThan(square!.y);
		for (const [id, child, parent] of [
			["circle-is-shape", circle, shape],
			["rectangle-is-shape", rectangle, shape],
			["square-is-rectangle", square, rectangle],
			["shape-draws", shape, drawable],
		] as const) {
			const line = arrow(scene, id);
			expect(sideOf(child!, line.points[0]), id).toBe("top");
			expect(sideOf(parent!, line.points.at(-1)!), id).toBe("bottom");
		}
		// A subclass standing under its superclass's side draws a straight line up.
		expect(arrow(scene, "square-is-rectangle").points).toHaveLength(2);
	});

	it("gives every relationship end a port of its own", () => {
		for (const diagram of all) {
			const scene = renderDiagram(diagram);
			const ports = arrows(scene).flatMap((line) => [
				`${line.sourceNodeId}@${line.points[0].x},${line.points[0].y}`,
				`${line.targetNodeId}@${line.points.at(-1)!.x},${line.points.at(-1)!.y}`,
			]);
			expect(new Set(ports).size, diagram.id).toBe(ports.length);
		}
	});

	it("puts multiplicities and roles beside their ends, clear of every box, line and other label", () => {
		for (const diagram of all) {
			const scene = renderDiagram(diagram);
			const outlines = nodes(scene).filter((node) => node.kind === "class");
			const segments = arrows(scene).flatMap((line) => segmentsFromPoints(line.points));
			const labels = labelBoxes(scene);
			for (const [index, label] of labels.entries()) {
				for (const outline of outlines)
					expect(
						label.left < outline.x + outline.width &&
							outline.x < label.right &&
							label.top < outline.y + outline.height &&
							outline.y < label.bottom,
						`${diagram.id} ${label.id} on ${outline.id}`,
					).toBe(false);
				for (const segment of segments)
					expect(
						segment.orientation === "horizontal"
							? segment.staticCoordinate > label.top &&
									segment.staticCoordinate < label.bottom &&
									segment.max > label.left &&
									segment.min < label.right
							: segment.staticCoordinate > label.left &&
									segment.staticCoordinate < label.right &&
									segment.max > label.top &&
									segment.min < label.bottom,
						`${diagram.id} ${label.id} on a line`,
					).toBe(false);
				for (const other of labels.slice(index + 1))
					expect(
						label.left < other.right &&
							other.left < label.right &&
							label.top < other.bottom &&
							other.top < label.bottom,
						`${diagram.id} ${label.id} on ${other.id}`,
					).toBe(false);
			}
		}
		const scene = renderDiagram(classFixture);
		const holds = arrow(scene, "canvas-holds");
		const shape = box(scene, "Shape");
		const role = text(scene, "relationship:canvas-holds:to:role")!;
		expect(role).toMatchObject({ text: "shapes", groupIds: ["class:Shape"] });
		const tip = holds.points.at(-1)!;
		expect(sideOf(shape, tip)).toBeDefined();
		if (role.type === "text") expect(Math.hypot(role.x - tip.x, role.y - tip.y)).toBeLessThan(80);
	});

	it("loops a relationship to its own class out and back on one side, nesting a second", () => {
		const scene = renderDiagram(classStressFixtures.selfReference);
		const employee = box(scene, "Employee");
		for (const id of ["manages", "mentors"]) {
			const loop = arrow(scene, id);
			expect(loop.sourceNodeId).toBe("Employee");
			expect(loop.targetNodeId).toBe("Employee");
			expect(sideOf(employee, loop.points[0])).toBe(sideOf(employee, loop.points.at(-1)!));
		}
	});

	it("breaks a ring of related classes across rows, so no line reaches around a box", () => {
		const scene = renderDiagram(classStressFixtures.acrossRow);
		const ring = ["Checkout", "PricingStrategy", "Cart"].map((id) => box(scene, id));
		expect(new Set(ring.map((node) => node.y)).size).toBeGreaterThan(1);
		for (const id of ["uses", "prices", "totals"]) {
			const line = arrow(scene, id);
			const [from, to] = [box(scene, line.sourceNodeId), box(scene, line.targetNodeId)];
			const sides = [sideOf(from, line.points[0]), sideOf(to, line.points.at(-1)!)];
			// Ends face each other: no line leaves and returns by one side of a row.
			expect(sides[0], id).not.toBe(sides[1]);
		}
	});
});
