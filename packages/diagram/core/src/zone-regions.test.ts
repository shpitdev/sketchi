import { describe, expect, it } from "vitest";

import type { CanvasSpec } from "./canvas.js";
import { zoneRegionIssues } from "./zone-regions.js";

const zone = {
	type: "node",
	id: "group:vpc",
	nodeId: "group:vpc",
	rendererRole: "zone",
	shape: "rectangle",
	x: 0,
	y: 0,
	width: 400,
	height: 300,
	label: "VPC",
} as const;
const node = {
	type: "node",
	id: "node:api",
	nodeId: "api",
	shape: "rectangle",
	x: 40,
	y: 80,
	width: 184,
	height: 72,
	label: "API",
} as const;

function scene(elements: CanvasSpec["elements"]): CanvasSpec {
	return {
		kind: "canvas",
		version: 1,
		diagramId: "zones",
		title: "Zones",
		width: 400,
		height: 300,
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
		elements,
		layers: [],
		layouts: [],
		zOrder: elements.map((element) => element.id),
	};
}

describe("zoneRegionIssues", () => {
	const diagram = { groups: [{ id: "vpc" }], nodes: [{ id: "api", group: "vpc" }] };

	it("reads a zone and its label clear", () => {
		expect(
			zoneRegionIssues(
				scene([
					zone,
					node,
					{
						type: "text",
						id: "zone-label:vpc",
						x: 40,
						y: 18,
						text: "VPC",
						fontSize: 14,
						maxWidth: 376,
					},
				]),
				diagram,
			),
		).toEqual([]);
	});

	it("names a zone drawn without its label instead of failing", () => {
		expect(zoneRegionIssues(scene([zone, node]), diagram).map((issue) => issue.code)).toEqual([
			"zone-missing",
		]);
	});
});
