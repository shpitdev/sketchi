import { describe, expect, it } from "vitest";

import {
	canvasBoundTextBox,
	canvasBoundTextInset,
	canvasNodeIconBox,
	describedArchitectureFlowchart,
	embedCanvasIcons,
	estimateTextWidth,
	getCanvasValidationIssues,
	type CanvasShapeElement,
	type CanvasSpec,
	type CanvasTextElement,
	type LayoutDirection,
	zoneRegionIssues,
} from "@sketchi/diagram-core";

import {
	longNodeDescriptions,
	NODE_DESCRIPTION_MAX_LINES,
	renderIntermediateDiagram,
} from "./scene";

const LABEL_LINE_HEIGHT = 1.35;

function nodes(scene: CanvasSpec): CanvasShapeElement[] {
	return scene.elements.filter((element): element is CanvasShapeElement => element.type === "node");
}

function texts(scene: CanvasSpec): CanvasTextElement[] {
	return scene.elements.filter((element): element is CanvasTextElement => element.type === "text");
}

function labelFor(scene: CanvasSpec, node: CanvasShapeElement) {
	const label = texts(scene).find((element) => element.containerId === node.id);
	if (!label) throw new Error(`Missing label for ${node.id}.`);
	return label;
}

function descriptionFor(scene: CanvasSpec, node: CanvasShapeElement) {
	return texts(scene).find((element) => element.id === `description:${node.nodeId}`);
}

function textBox(text: CanvasTextElement, lineHeight = text.lineHeight ?? LABEL_LINE_HEIGHT) {
	const width = estimateTextWidth(text.text, text.fontSize);
	const height = Math.ceil(text.text.split("\n").length * text.fontSize * lineHeight);
	return { x: text.x - width / 2, y: text.y - height / 2, width, height };
}

/** The described architecture the round-16 Sonnet samples drew without ECS. */
function awsThreeTier(direction: LayoutDirection = "LR") {
	return {
		...describedArchitectureFlowchart,
		layout: { ...describedArchitectureFlowchart.layout, direction },
	};
}

/** Every node fits its description under its label, inside Excalidraw's text box. */
function expectDescriptionsFit(scene: CanvasSpec, described: ReadonlyMap<string, string>) {
	for (const node of nodes(scene)) {
		const description = descriptionFor(scene, node);
		const authored = described.get(node.nodeId);
		if (!authored) {
			expect(description, node.id).toBeUndefined();
			continue;
		}
		if (!description) throw new Error(`Missing description for ${node.id}.`);
		const label = labelFor(scene, node);
		// Whole words, nothing dropped.
		expect(description.text.split("\n").join(" "), node.id).toBe(authored);
		// Smaller and muted, grouped with its node and label, never bound.
		expect(description.fontSize, node.id).toBeLessThan(label.fontSize);
		expect(description.textColor, node.id).toBeDefined();
		expect(description.containerId, node.id).toBeUndefined();
		const group = node.groupIds?.[0];
		expect(group, node.id).toBeDefined();
		expect(label.groupIds, node.id).toContain(group);
		expect(description.groupIds, node.id).toContain(group);
		expect(description.frameId, node.id).toBe(node.frameId);
		// The label is centered so an Excalidraw edit keeps it in place.
		expect(label.verticalAlign, node.id).toBeUndefined();
		const inset = canvasBoundTextInset(node);
		const box = canvasBoundTextBox(node);
		const inner = { x: node.x + inset.x, y: node.y + inset.y, ...box };
		const labelBox = textBox(label);
		const labelTop = node.y + node.height / 2 - labelBox.height / 2;
		const descriptionBox = textBox(description);
		expect(descriptionBox.y, node.id).toBeGreaterThanOrEqual(labelTop + labelBox.height);
		expect(descriptionBox.y + descriptionBox.height, node.id).toBeLessThanOrEqual(
			inner.y + inner.height + 0.5,
		);
		expect(descriptionBox.x, node.id).toBeGreaterThanOrEqual(inner.x - 0.5);
		expect(descriptionBox.x + descriptionBox.width, node.id).toBeLessThanOrEqual(
			inner.x + inner.width + 0.5,
		);
		const icon = canvasNodeIconBox(node);
		if (icon) expect(labelTop, node.id).toBeGreaterThanOrEqual(icon.y + icon.height);
	}
}

describe("node descriptions", () => {
	for (const direction of ["LR", "TB", "RL", "BT"] as const) {
		it(`draws each description as a subtitle under its label (${direction})`, () => {
			const diagram = awsThreeTier(direction);
			const scene = renderIntermediateDiagram(diagram);
			const described = new Map(
				diagram.nodes.flatMap((node) =>
					node.description ? [[node.id, node.description] as const] : [],
				),
			);
			expectDescriptionsFit(scene, described);
			expect(zoneRegionIssues(scene, diagram)).toEqual([]);
			const { scene: embedded, dropped } = embedCanvasIcons(scene, (slug) => ({
				name: slug,
				svg: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>',
			}));
			expect(dropped).toEqual([]);
			expect(getCanvasValidationIssues(embedded)).toEqual([]);
			expect(longNodeDescriptions(scene)).toEqual([]);
		});
	}

	it("fits a description in every node shape", () => {
		const description = "Checks the order total against the customer's approved credit limit";
		const kinds = [
			{ kind: "start" },
			{ kind: "process" },
			{ kind: "decision" },
			{ kind: "process", shape: "database" },
			{ kind: "process", shape: "queue" },
			{ kind: "process", shape: "document" },
			{ kind: "process", shape: "storage" },
			{ kind: "process", icon: { slug: "github" } },
			{ kind: "decision", icon: { slug: "github" } },
			{ kind: "end", icon: { slug: "github" } },
		] as const;
		for (const [index, extra] of kinds.entries()) {
			const scene = renderIntermediateDiagram({
				id: "shapes",
				title: "Shapes",
				nodes: [{ id: `n${index}`, label: "Credit check", description, ...extra }],
				edges: [],
			});
			expectDescriptionsFit(scene, new Map([[`n${index}`, description]]));
		}
	});

	it("widens a node within bounds before wrapping a third line, and reports longer ones", () => {
		const short = "ECS Fargate";
		const long = "Interprets the request and orchestrates diagram creation";
		const essay =
			"Application entry point; package names have not been verified against repository source, so this node stands for the conceptual boundary only and every caller reaches it first";
		const scene = renderIntermediateDiagram({
			id: "long",
			title: "Long",
			nodes: [
				{ id: "a", label: "Web", kind: "start", description: short },
				{ id: "b", label: "Agent", kind: "process", description: long },
				{ id: "c", label: "App", kind: "end", description: essay },
			],
			edges: [
				{ id: "e1", source: "a", target: "b" },
				{ id: "e2", source: "b", target: "c" },
			],
		});
		expectDescriptionsFit(
			scene,
			new Map([
				["a", short],
				["b", long],
				["c", essay],
			]),
		);
		const lines = (id: string) =>
			descriptionFor(
				scene,
				nodes(scene).find((node) => node.nodeId === id)!,
			)!.text.split("\n").length;
		expect(lines("a")).toBe(1);
		expect(lines("b")).toBeLessThanOrEqual(2);
		expect(lines("c")).toBeGreaterThan(NODE_DESCRIPTION_MAX_LINES);
		for (const node of nodes(scene))
			expect(node.width, node.id).toBeLessThanOrEqual(node.shape === "rectangle" ? 300 : 400);
		expect(longNodeDescriptions(scene)).toEqual(["c"]);
	});

	it("leaves nodes without a description untouched", () => {
		const diagram = awsThreeTier();
		const plain = {
			...diagram,
			nodes: diagram.nodes.map(({ description: _description, ...node }) => node),
		};
		const scene = renderIntermediateDiagram(plain);
		expect(texts(scene).some((text) => text.id.startsWith("description:"))).toBe(false);
		expect(nodes(scene).every((node) => node.groupIds === undefined)).toBe(true);
	});
});
