import { describe, expect, it } from "vitest";
import { parseQuadrantDiagram, quadrantFixture } from "@sketchi/diagram-core";
import { renderQuadrantDiagram } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const grouped = parseQuadrantDiagram({
	...quadrantFixture,
	id: "grouped-quadrant",
	points: [
		{ label: "Acme", x: 0.2, y: 0.8, group: "Us" },
		{ label: "Globex", x: 0.7, y: 0.6, group: "Rivals" },
		...Array.from({ length: 6 }, (_, index) => ({
			label: `Clustered item ${index + 1}`,
			x: 0.72 + (index % 3) * 0.01,
			y: 0.25 + Math.floor(index / 3) * 0.01,
		})),
	],
});
const exported = convertSceneToExcalidraw(renderQuadrantDiagram(grouped));
const element = (id: string) => exported.elements.find((candidate) => candidate.id === id)!;

describe("quadrant chart Excalidraw export", () => {
	it("draws each quadrant as a square-cornered, unlabeled tint grouped with its name", () => {
		for (const key of ["topLeft", "topRight", "bottomLeft", "bottomRight"]) {
			expect(element(`node:quadrant:region:${key}`)).toMatchObject({
				type: "rectangle",
				roundness: null,
				roughness: 0,
				boundElements: null,
				groupIds: [`quadrant:region:${key}`],
				customData: { sketchiRendererRole: "quadrant-mark" },
			});
			expect(element(`quadrant:name:${key}`)).toMatchObject({
				type: "text",
				containerId: null,
				groupIds: [`quadrant:region:${key}`],
			});
		}
	});

	it("groups each dot with its label and leader, so dragging a point keeps them together", () => {
		const dots = exported.elements.filter((candidate) =>
			candidate.id.startsWith("node:quadrant:point:"),
		);
		expect(dots).toHaveLength(grouped.points.length);
		for (const dot of dots) {
			expect(dot).toMatchObject({ type: "ellipse", roughness: 0, boundElements: null });
			const index = dot.id.split(":").at(-1);
			expect(element(`quadrant:label:${index}`)["groupIds"]).toEqual([`quadrant:point:${index}`]);
		}
		const leaders = exported.elements.filter((candidate) =>
			candidate.id.startsWith("quadrant:leader:"),
		);
		expect(leaders.length).toBeGreaterThan(0);
		for (const leader of leaders) {
			const index = leader.id.split(":").at(-1);
			expect(leader).toMatchObject({ type: "line", groupIds: [`quadrant:point:${index}`] });
		}
	});

	it("draws both axes as arrows toward their high ends, grouped with their labels", () => {
		for (const axis of ["x", "y"])
			expect(element(`quadrant:axis:${axis}`)).toMatchObject({
				type: "arrow",
				endArrowhead: "arrow",
				groupIds: [`quadrant:axis:${axis}`],
			});
		expect(element("quadrant:axis:x:low")).toMatchObject({
			text: "Low effort",
			groupIds: ["quadrant:axis:x"],
		});
	});

	it("keeps every text whole and validates after a save and reload", () => {
		for (const text of exported.elements.filter((candidate) => candidate.type === "text"))
			expect(text["text"], text.id).toBe(text["originalText"]);
		for (const diagram of [quadrantFixture, grouped]) {
			const scene = convertSceneToExcalidraw(renderQuadrantDiagram(diagram));
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
			const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(scene)));
			expect(validateExcalidrawScene(reloaded), diagram.id).toEqual({ ok: true, issues: [] });
		}
	});
});
