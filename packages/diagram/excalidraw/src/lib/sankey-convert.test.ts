import { describe, expect, it } from "vitest";
import { sankeyFixture, sankeyStressFixtures } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const exported = convertSceneToExcalidraw(renderDiagram(sankeyFixture));
const element = (id: string) => exported.elements.find((candidate) => candidate.id === id)!;

describe("Sankey Excalidraw export", () => {
	it("draws each flow as a closed, filled, translucent outline grouped with its value", () => {
		const band = element("node:sankey:link:engineering:compute");
		expect(band).toMatchObject({
			type: "line",
			roughness: 0,
			roundness: null,
			opacity: 45,
			fillStyle: "solid",
			groupIds: ["sankey:link:engineering:compute"],
			customData: { sketchiShape: "polygon", sketchiRendererRole: "sankey-mark" },
		});
		const points = band["points"] as [number, number][];
		expect(points.at(-1)).toEqual(points[0]);
		expect(band["backgroundColor"]).toBe(band["strokeColor"]);
		expect(element("text:sankey:link:engineering:compute")).toMatchObject({
			type: "text",
			text: "$180k",
			groupIds: ["sankey:link:engineering:compute"],
		});
	});

	it("draws each node as a square-cornered bar grouped with its label and total", () => {
		expect(element("node:sankey:node:engineering")).toMatchObject({
			type: "rectangle",
			roughness: 0,
			roundness: null,
			groupIds: ["sankey:node:engineering"],
			customData: { sketchiRendererRole: "sankey-mark" },
		});
		expect(element("text:sankey:node:engineering")).toMatchObject({
			type: "text",
			containerId: null,
			text: "Engineering\n$305k",
			groupIds: ["sankey:node:engineering"],
		});
		// Bars bind no generated label; their text sits beside them.
		expect(
			exported.elements.some((candidate) => candidate.id.startsWith("__sketchi_node_label__")),
		).toBe(false);
		for (const text of exported.elements.filter((candidate) => candidate.type === "text"))
			expect(text["text"], text.id).toBe(text["originalText"]);
	});

	it("validates, and still validates after a save and reload", () => {
		for (const diagram of [sankeyFixture, ...Object.values(sankeyStressFixtures)]) {
			const scene = convertSceneToExcalidraw(renderDiagram(diagram));
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
			const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(scene)));
			expect(validateExcalidrawScene(reloaded), diagram.id).toEqual({ ok: true, issues: [] });
		}
	});
});
