import { describe, expect, it } from "vitest";
import { journeyFixture, journeyStressFixtures } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const exported = convertSceneToExcalidraw(renderDiagram(journeyFixture));
const element = (id: string) => exported.elements.find((candidate) => candidate.id === id)!;

describe("journey map Excalidraw export", () => {
	it("binds each stage's name to its header and each step's label to its card, grouped with its details", () => {
		expect(element("node:journey:stage:1")).toMatchObject({
			type: "rectangle",
			boundElements: expect.arrayContaining([{ id: "label:journey:stage:1", type: "text" }]),
		});
		expect(element("label:journey:stage:1")).toMatchObject({
			containerId: "node:journey:stage:1",
			text: "Purchase",
		});
		expect(element("node:journey:step:1-1")).toMatchObject({
			type: "rectangle",
			groupIds: ["journey:step:1-1"],
			boundElements: expect.arrayContaining([{ id: "label:journey:step:1-1", type: "text" }]),
		});
		expect(element("label:journey:step:1-1")).toMatchObject({
			type: "text",
			containerId: "node:journey:step:1-1",
			verticalAlign: "top",
			groupIds: ["journey:step:1-1"],
		});
		expect(element("text:journey:step:1-1:details")).toMatchObject({
			type: "text",
			containerId: null,
			text: "Website",
			groupIds: ["journey:step:1-1"],
		});
		for (const text of exported.elements.filter((candidate) => candidate.type === "text"))
			expect(text["text"], text.id).toBe(text["originalText"]);
	});

	it("draws each face as a grouped ellipse with eyes and a curved mouth, and the curve as one rounded line", () => {
		expect(element("node:journey:face:2-1")).toMatchObject({
			type: "ellipse",
			groupIds: ["journey:face:2-1"],
			customData: { sketchiRendererRole: "journey-mark" },
			roughness: 0,
		});
		// A face carries no label of its own: its score lives in its shape and height.
		expect(
			exported.elements.some((candidate) => candidate["containerId"] === "node:journey:face:2-1"),
		).toBe(false);
		expect(element("line:journey:face:2-1:mouth")).toMatchObject({
			type: "line",
			groupIds: ["journey:face:2-1"],
			roundness: { type: 2 },
		});
		expect(element("line:journey:curve:0")).toMatchObject({
			type: "line",
			roundness: { type: 2 },
			roughness: 0,
		});
		expect(element("line:journey:baseline:0")).toMatchObject({
			type: "line",
			strokeStyle: "dashed",
		});
		// The curve and baseline sit behind every card and face.
		const order = exported.elements.map((candidate) => candidate.id);
		expect(order.indexOf("line:journey:curve:0")).toBeLessThan(
			order.indexOf("node:journey:face:0-0"),
		);
	});

	it("validates, and still validates after a save and reload", () => {
		for (const diagram of [journeyFixture, ...Object.values(journeyStressFixtures)]) {
			const scene = convertSceneToExcalidraw(renderDiagram(diagram));
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
			const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(scene)));
			expect(validateExcalidrawScene(reloaded), diagram.id).toEqual({ ok: true, issues: [] });
		}
	});
});
