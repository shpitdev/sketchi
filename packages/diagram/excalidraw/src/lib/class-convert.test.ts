import { describe, expect, it } from "vitest";
import { classFixture } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const exported = convertSceneToExcalidraw(renderDiagram(classFixture));
const element = (id: string) => exported.elements.find((candidate) => candidate.id === id)!;

describe("class diagram Excalidraw export", () => {
	it("keeps each class box square-cornered and grouped, its texts unwrapped", () => {
		for (const id of ["node:Shape", "node:Shape:name", "node:Shape:methods"])
			expect(element(id), id).toMatchObject({
				type: "rectangle",
				roundness: null,
				groupIds: ["class:Shape"],
				customData: { sketchiRendererRole: "class-box" },
			});
		expect(element("label:Shape:name")).toMatchObject({
			type: "text",
			containerId: "node:Shape:name",
			text: "«abstract»\nShape",
		});
		for (const text of exported.elements.filter((candidate) => candidate.type === "text"))
			expect(text["text"], text.id).toBe(text["originalText"]);
	});

	it("binds every relationship to fixed points on its classes, with UML heads and dashes", () => {
		expect(element("edge:shape-draws")).toMatchObject({
			startArrowhead: null,
			endArrowhead: "triangle_outline",
			strokeStyle: "dashed",
			startBinding: { elementId: "node:Shape" },
			endBinding: { elementId: "node:Drawable" },
		});
		expect(element("edge:circle-is-shape")).toMatchObject({
			endArrowhead: "triangle_outline",
			strokeStyle: "solid",
		});
		expect(element("edge:canvas-holds")).toMatchObject({
			startArrowhead: "diamond_outline",
			endArrowhead: null,
			startBinding: { elementId: "node:Canvas" },
			endBinding: { elementId: "node:Shape" },
		});
		// Each is an elbow arrow at fixed points, so an end keeps its place on its class
		// when the class moves, with every inner run pinned.
		for (const id of ["edge:shape-draws", "edge:circle-is-shape", "edge:canvas-holds"]) {
			const arrow = element(id);
			const points = arrow["points"] as unknown[];
			expect(arrow["elbowed"], id).toBe(true);
			expect(arrow["fixedSegments"], id).toHaveLength(Math.max(0, points.length - 3));
			expect(arrow["startBinding"], id).toMatchObject({ fixedPoint: expect.any(Array) });
			expect(arrow["endBinding"], id).toMatchObject({ fixedPoint: expect.any(Array) });
		}
		// A multiplicity or role moves with its class.
		expect(element("relationship:canvas-holds:to:role")).toMatchObject({
			type: "text",
			text: "shapes",
			groupIds: ["class:Shape"],
		});
	});

	it("validates, and still validates after a save and reload", () => {
		expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
		const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(exported)));
		expect(validateExcalidrawScene(reloaded)).toEqual({ ok: true, issues: [] });
	});
});
