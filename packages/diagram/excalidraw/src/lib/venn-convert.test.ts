import { describe, expect, it } from "vitest";
import { vennFixture, vennStressFixtures } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const exported = convertSceneToExcalidraw(renderDiagram(vennFixture));
const element = (id: string) => exported.elements.find((candidate) => candidate.id === id)!;

describe("Venn Excalidraw export", () => {
	it("draws each set as a translucent filled ellipse under an outline, grouped with its label", () => {
		expect(element("node:venn:set:0:fill")).toMatchObject({
			type: "ellipse",
			opacity: 22,
			fillStyle: "solid",
			strokeColor: "#2a78d6",
			roughness: 0,
			groupIds: ["venn:set:0"],
			customData: { sketchiRendererRole: "venn-set" },
		});
		expect(element("node:venn:set:0")).toMatchObject({
			type: "ellipse",
			opacity: 100,
			backgroundColor: "transparent",
			strokeWidth: 2,
			groupIds: ["venn:set:0"],
			customData: { sketchiRendererRole: "venn-set" },
		});
		expect(element("venn:set:0:label")).toMatchObject({
			type: "text",
			containerId: null,
			text: "Design",
			groupIds: ["venn:set:0"],
		});
	});

	it("gives no circle a generated label, and keeps region text free, centred and grouped", () => {
		const texts = exported.elements.filter((candidate) => candidate.type === "text");
		expect(texts.some((text) => text["containerId"])).toBe(false);
		expect(element("venn:region:0+1+2:item:0")).toMatchObject({
			type: "text",
			textAlign: "center",
			text: "Customer\nempathy",
			groupIds: ["venn:region:0+1+2"],
		});
		for (const text of texts) expect(text["text"], text.id).toBe(text["originalText"]);
	});

	it("validates, and still validates after a save and reload", () => {
		for (const diagram of [vennFixture, ...Object.values(vennStressFixtures)]) {
			const scene = convertSceneToExcalidraw(renderDiagram(diagram));
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
			const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(scene)));
			expect(validateExcalidrawScene(reloaded), diagram.id).toEqual({ ok: true, issues: [] });
		}
	});
});
