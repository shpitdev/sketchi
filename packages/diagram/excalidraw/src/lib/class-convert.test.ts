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

	it("binds every relationship as an elbow arrow to its classes' outlines, with UML heads and dashes", () => {
		expect(element("edge:shape-draws")).toMatchObject({
			elbowed: true,
			startArrowhead: null,
			endArrowhead: "triangle_outline",
			strokeStyle: "dashed",
			startBinding: { elementId: "node:Shape" },
			endBinding: { elementId: "node:Drawable" },
		});
		expect(element("edge:circle-is-shape")).toMatchObject({
			elbowed: true,
			endArrowhead: "triangle_outline",
			strokeStyle: "solid",
		});
		expect(element("edge:canvas-holds")).toMatchObject({
			elbowed: true,
			startArrowhead: "diamond_outline",
			endArrowhead: null,
			startBinding: { elementId: "node:Canvas" },
			endBinding: { elementId: "node:Shape" },
		});
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
