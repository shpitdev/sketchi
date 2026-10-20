import { describe, expect, it } from "vitest";

import {
	describedArchitectureFlowchart,
	embedCanvasIcons,
	parseFlowchartDiagram,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import {
	convertSceneToExcalidraw,
	type ExcalidrawElement,
	validateExcalidrawScene,
} from "./convert";

/** The fields these checks read from an exported element. */
type Placed = ExcalidrawElement & {
	groupIds: string[];
	x: number;
	y: number;
	width: number;
	height: number;
	text?: string;
	verticalAlign?: string;
};

const SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>';

const diagram = parseFlowchartDiagram({
	id: "described",
	title: "Described",
	type: "flowchart",
	nodes: [
		{ id: "users", label: "Users", kind: "start", description: "Send requests" },
		{ id: "web", label: "Web service", kind: "process", description: "ECS Fargate" },
		{ id: "check", label: "Healthy?", kind: "decision", description: "Two passing probes" },
		{
			id: "db",
			label: "Orders database",
			kind: "end",
			shape: "database",
			icon: { slug: "postgresql" },
			description: "RDS PostgreSQL, Multi-AZ primary with a read replica",
		},
		{ id: "page", label: "Page on-call", kind: "end" },
	],
	edges: [
		{ id: "e1", source: "users", target: "web" },
		{ id: "e2", source: "web", target: "check" },
		{ id: "e3", source: "check", target: "db", label: "yes" },
		{ id: "e4", source: "check", target: "page", label: "no" },
	],
	layout: { direction: "LR", edgeRouting: "orthogonal" },
});

describe("node descriptions in Excalidraw", () => {
	const { scene } = embedCanvasIcons(renderIntermediateDiagram(diagram), (slug) => ({
		name: slug,
		svg: SVG,
	}));
	const elements = convertSceneToExcalidraw(scene).elements as Placed[];
	const byId = new Map(elements.map((element) => [element.id, element]));

	it("exports each description as free text grouped with its node, label and logo", () => {
		expect(validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues).toEqual([]);
		for (const node of diagram.nodes.filter((entry) => entry.description)) {
			const shape = byId.get(`node:${node.id}`)!;
			const label = byId.get(`label:${node.id}`)!;
			const description = byId.get(`description:${node.id}`)!;
			expect(description, node.id).toMatchObject({
				type: "text",
				containerId: null,
				fontSize: 12,
				lineHeight: 1.25,
				strokeColor: "#5f574c",
			});
			// Whole words, nothing dropped.
			expect(String(description.text).replaceAll("\n", " "), node.id).toBe(node.description);
			// Excalidraw selects and moves an element's outermost group as one.
			const outer = shape.groupIds.at(-1);
			expect(outer, node.id).toBe(`node:${node.id}:described`);
			expect(label.groupIds.at(-1), node.id).toBe(outer);
			expect(description.groupIds.at(-1), node.id).toBe(outer);
			// Its logo and a composed shape's strokes too.
			const parts = elements.filter(
				(entry) =>
					entry.id.startsWith(`node-${node.id}-`) || entry.id.startsWith(`node:${node.id}:stroke`),
			);
			if (node.id === "db") expect(parts.length).toBeGreaterThan(1);
			for (const element of parts) expect(element.groupIds.at(-1), element.id).toBe(outer);
			// Inside the node, under its centered label.
			expect(label.verticalAlign, node.id).toBe("middle");
			expect(description.y, node.id).toBeGreaterThanOrEqual(label.y + label.height);
			expect(description.x, node.id).toBeGreaterThanOrEqual(shape.x);
			expect(description.x + description.width, node.id).toBeLessThanOrEqual(shape.x + shape.width);
			expect(description.y + description.height, node.id).toBeLessThanOrEqual(
				shape.y + shape.height,
			);
		}
		expect(byId.get("description:page")).toBeUndefined();
		expect(byId.get("node:page")!.groupIds).toEqual([]);
	});

	it.each(["LR", "TB", "RL", "BT"] as const)(
		"exports the described architecture valid in %s",
		(direction) => {
			const described = embedCanvasIcons(
				renderIntermediateDiagram({
					...describedArchitectureFlowchart,
					layout: { ...describedArchitectureFlowchart.layout, direction },
				}),
				(slug) => ({ name: slug, svg: SVG }),
			).scene;
			const exported = convertSceneToExcalidraw(described);
			expect(validateExcalidrawScene(exported).issues).toEqual([]);
			expect(
				exported.elements.filter((element) => element.id.startsWith("description:")),
			).toHaveLength(4);
		},
	);
});
