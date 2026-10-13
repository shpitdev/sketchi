import { describe, expect, it } from "vitest";
import {
	parseIntermediateDiagram,
	segmentsFromPoints,
	segmentCrossesBoundsInterior,
	routingFixtures,
	flowchartFixture,
	pharmaBatchDispositionFlowchart,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

describe.each(
	Object.entries({ ...routingFixtures, flowchartFixture, pharmaBatchDispositionFlowchart }),
)("routing export: %s", (_name, fixture) => {
	it("preserves binding, text fit, and non-overlapping segments", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(fixture));
		expect(validateExcalidrawScene(scene).issues).toEqual([]);
	});
});

const skipEdges = [
	["A", "B"],
	["B", "C"],
	["C", "D"],
	["A", "C"],
	["B", "D"],
];
it.each(["LR", "RL"] as const)("exports labeled skip edges in %s", (direction) => {
	const spec = parseIntermediateDiagram({
		id: "horizontal-skips",
		title: "Paths",
		type: "flowchart",
		nodes: ["A", "B", "C", "D"].map((id) => ({ id, label: id, kind: "process" })),
		edges: skipEdges.map(([source, target], i) => ({
			id: `path-${i}`,
			source,
			target,
			label: `Path ${i}`,
		})),
		layout: { direction, edgeRouting: "orthogonal" },
	});
	expect(
		validateExcalidrawScene(convertSceneToExcalidraw(renderIntermediateDiagram(spec))).issues,
	).toEqual([]);
});

it("keeps process fan-out labels and departure stubs disjoint", () => {
	const spec = parseIntermediateDiagram({
		id: "fanout",
		title: "Fan out",
		type: "flowchart",
		nodes: ["A", "B", "C"].map((id) => ({ id, label: id, kind: "process" })),
		edges: ["B", "C"].map((target, i) => ({
			id: target,
			source: "A",
			target,
			label: ["First", "Second"][i],
		})),
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	});
	const rendered = renderIntermediateDiagram(spec);
	const exported = convertSceneToExcalidraw(rendered);
	const labels = exported.elements
		.filter((e) => e.type === "text" && e.containerId === null)
		.map((e) => ({
			id: e.id,
			x: Number(e.x),
			y: Number(e.y),
			width: Number(e.width),
			height: Number(e.height),
		}));
	expect(labels).toHaveLength(2);
	const [a, b] = labels;
	expect(
		a!.x < b!.x + b!.width &&
			a!.x + a!.width > b!.x &&
			a!.y < b!.y + b!.height &&
			a!.y + a!.height > b!.y,
	).toBe(false);
	for (const label of labels)
		for (const arrow of rendered.elements.filter((e) => e.type === "arrow")) {
			expect(
				segmentsFromPoints(arrow.points).some((segment) =>
					segmentCrossesBoundsInterior(segment, label),
				),
				`${label.id}/${arrow.id}`,
			).toBe(false);
		}
	expect(validateExcalidrawScene(exported).issues).toEqual([]);
});

it("exports exactly one positioned label after clearing groups", () => {
	const scene = renderIntermediateDiagram(routingFixtures["pharma-batch-disposition"]);
	const exported = convertSceneToExcalidraw({
		...scene,
		elements: scene.elements.map((e) => ({ ...e, groupIds: [] })),
	});
	expect(new Set(exported.elements.map((e) => e.id)).size).toBe(exported.elements.length);
});
