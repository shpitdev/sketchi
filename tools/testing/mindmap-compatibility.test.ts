import { describe, expect, it } from "vitest";
import { normalizeMindmapLayoutAgainstFrozen } from "./mindmap-compatibility.mjs";

describe("mindmap layout receipt migration", () => {
	const frozen = {
		diagramId: "plan",
		width: 840,
		height: 352,
		elements: [
			{
				type: "node",
				id: "node:topic-0",
				nodeId: "topic-0",
				shape: "rectangle",
				label: "Launch plan",
				x: 48,
				y: 232,
				width: 184,
				height: 72,
			},
			{
				type: "arrow",
				id: "edge:branch-0-0",
				sourceNodeId: "topic-0",
				targetNodeId: "topic-0-0",
				points: [
					{ x: 232, y: 268 },
					{ x: 344, y: 120 },
				],
			},
		],
		zOrder: ["node:topic-0", "edge:branch-0-0"],
	};
	const current = {
		diagramId: "plan",
		width: 900,
		height: 434,
		elements: [
			{
				...frozen.elements[1],
				points: [
					{ x: 300, y: 200 },
					{ x: 320, y: 150 },
					{ x: 344, y: 120 },
				],
				curved: true,
				endArrowhead: null,
				strokeColor: "#2a78d6",
			},
			{
				...frozen.elements[0],
				shape: "ellipse",
				label: "Launch\nplan",
				x: 324,
				y: 171,
				fillColor: "#ebe4e2",
			},
		],
		zOrder: ["edge:branch-0-0", "node:topic-0"],
	};

	it("restores the redrawn geometry, styling and order of mindmap elements", () =>
		expect(normalizeMindmapLayoutAgainstFrozen(current, frozen)).toEqual(frozen));

	it("restores the same through a JSON-encoded body", () =>
		expect(
			normalizeMindmapLayoutAgainstFrozen(JSON.stringify(current), JSON.stringify(frozen)),
		).toBe(JSON.stringify(frozen)));

	it("does not mask changed endpoints, labels or members", () => {
		const changed = (element: object, index: number) => ({
			...current,
			elements: current.elements.map((entry, at) =>
				at === index ? { ...entry, ...element } : entry,
			),
		});
		expect(
			normalizeMindmapLayoutAgainstFrozen(changed({ targetNodeId: "x" }, 0), frozen),
		).not.toEqual(frozen);
		expect(
			normalizeMindmapLayoutAgainstFrozen(changed({ label: "Launch" }, 1), frozen),
		).not.toEqual(frozen);
		expect(
			normalizeMindmapLayoutAgainstFrozen(
				{ ...current, elements: [...current.elements, { type: "node", id: "node:topic-9" }] },
				frozen,
			),
		).not.toEqual(frozen);
	});

	it("leaves other diagrams to compare exactly", () => {
		const flowchart = { width: 600, elements: [{ id: "node:start", x: 1 }] };
		expect(
			normalizeMindmapLayoutAgainstFrozen(
				{ width: 640, elements: [{ id: "node:start", x: 2 }] },
				flowchart,
			),
		).not.toEqual(flowchart);
	});
});
