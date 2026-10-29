import { describe, expect, it } from "vitest";
import { wireframeFixture, wireframeStressFixtures } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const exported = convertSceneToExcalidraw(renderDiagram(wireframeStressFixtures["settings"]!));
const element = (id: string) => {
	const found = exported.elements.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`No element ${id}`);
	return found;
};

describe("wireframe Excalidraw export", () => {
	it("draws each screen as a named frame that holds every element of its screen", () => {
		const frame = element("frame:settings");
		expect(frame).toMatchObject({ type: "frame", name: "Settings", width: 1280 });
		const others = exported.elements.filter((candidate) => candidate.type !== "frame");
		expect(others.every((candidate) => candidate.frameId === "frame:settings")).toBe(true);
	});

	it("binds a button's label and keeps every widget's parts in its group", () => {
		const save = "wf:settings:2.1";
		expect(element(`${save}:box`)).toMatchObject({
			type: "rectangle",
			backgroundColor: "#1971c2",
			groupIds: ["group:settings:2.1", "group:settings:2"],
			boundElements: [{ id: `${save}:label`, type: "text" }],
			customData: { sketchiRendererRole: "wireframe-widget" },
		});
		expect(element(`${save}:label`)).toMatchObject({
			type: "text",
			containerId: `${save}:box`,
			text: "Save changes",
			strokeColor: "#ffffff",
		});
		const field = "wf:settings:1.3.0.0";
		for (const part of ["label", "box", "placeholder"])
			expect(element(`${field}:${part}`).groupIds, part).toEqual([
				"group:settings:1.3.0.0",
				"group:settings:1.3",
			]);
	});

	it("rounds widgets by at most 8 and keeps regions square", () => {
		expect(element("wf:settings:1.3.0.0:box")["roundness"]).toEqual({ type: 3, value: 8 });
		expect(element("wf:settings:0:box")["roundness"]).toBeNull();
		expect(element("wf:settings:0:box")["customData"]).toEqual({
			sketchiRendererRole: "wireframe-region",
		});
	});

	it("draws a toggle's track as a closed stadium and its knob on the side of its state", () => {
		const track = element("wf:settings:1.5.0:track");
		expect(track).toMatchObject({ type: "line", backgroundColor: "#1971c2" });
		const points = track["points"] as [number, number][];
		expect(points[0]).toEqual(points.at(-1));
		expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(36, 0);
		expect(element("wf:settings:1.5.0:knob")).toMatchObject({ type: "ellipse" });
	});

	it("exports every fixture valid, and the same after a reload", () => {
		for (const diagram of [wireframeFixture, ...Object.values(wireframeStressFixtures)]) {
			const scene = convertSceneToExcalidraw(renderDiagram(diagram));
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
			const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(scene))) as typeof scene;
			expect(validateExcalidrawScene(reloaded), diagram.id).toEqual({ ok: true, issues: [] });
			for (const text of scene.elements.filter((candidate) => candidate.type === "text"))
				expect(text["text"], text.id).toBe(text["originalText"]);
		}
	});
});
