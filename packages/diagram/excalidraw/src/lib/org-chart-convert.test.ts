import { describe, expect, it } from "vitest";
import {
	CANVAS_SPEC_VERSION,
	type CanvasSpec,
	orgChartFixture,
	orgChartStressFixtures,
} from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const exported = convertSceneToExcalidraw(renderDiagram(orgChartFixture));
const element = (id: string) => exported.elements.find((candidate) => candidate.id === id)!;

describe("org chart Excalidraw export", () => {
	it("groups each card with its texts and binds its name and title", () => {
		expect(element("node:ada")).toMatchObject({
			type: "rectangle",
			groupIds: ["person:ada"],
			boundElements: expect.arrayContaining([{ id: "label:ada", type: "text" }]),
		});
		expect(element("label:ada")).toMatchObject({
			type: "text",
			containerId: "node:ada",
			verticalAlign: "bottom",
			text: "Chief Executive Officer\nExecutive",
		});
		expect(element("text:ada:name")).toMatchObject({
			type: "text",
			containerId: null,
			text: "Ada Lovelace",
			groupIds: ["person:ada"],
		});
		for (const text of exported.elements.filter((candidate) => candidate.type === "text"))
			expect(text["text"], text.id).toBe(text["originalText"]);
	});

	it("binds every reporting line to both cards, as a headless elbow line along its bus", () => {
		const reporting = element("edge:linus");
		expect(reporting).toMatchObject({
			type: "arrow",
			elbowed: true,
			roughness: 0,
			startArrowhead: null,
			endArrowhead: null,
			startBinding: { elementId: "node:ada" },
			endBinding: { elementId: "node:linus" },
		});
		expect(element("edge:dotted:ken-to-radia")).toMatchObject({
			strokeStyle: "dashed",
			endArrowhead: "arrow",
			startBinding: { elementId: "node:ken" },
			endBinding: { elementId: "node:radia" },
		});
	});

	it("draws department regions as named frames holding their members", () => {
		const regions = convertSceneToExcalidraw(renderDiagram(orgChartStressFixtures.regions));
		const frames = regions.elements.filter((candidate) => candidate.type === "frame");
		expect(frames.length).toBeGreaterThan(1);
		for (const frame of frames) {
			const members = regions.elements.filter((candidate) => candidate["frameId"] === frame.id);
			expect(
				members.some((candidate) => candidate.type === "rectangle"),
				frame.id,
			).toBe(true);
		}
		expect(validateExcalidrawScene(regions)).toEqual({ ok: true, issues: [] });
	});

	it("validates, and still validates after a save and reload", () => {
		for (const diagram of [orgChartFixture, ...Object.values(orgChartStressFixtures)]) {
			const scene = convertSceneToExcalidraw(renderDiagram(diagram));
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
			const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(scene)));
			expect(validateExcalidrawScene(reloaded), diagram.id).toEqual({ ok: true, issues: [] });
		}
	});
});

/** A manager over two reports, wired by the lines given. */
function busScene(lines: { id: string; source: string; points: { x: number; y: number }[] }[]) {
	const card = (id: string, x: number, y: number) => ({
		type: "node" as const,
		id: `node:${id}`,
		nodeId: id,
		shape: "rectangle" as const,
		x,
		y,
		width: 100,
		height: 40,
		label: id,
	});
	const scene: CanvasSpec = {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: "bus",
		title: "Bus",
		width: 600,
		height: 300,
		accentColor: "#000000",
		backgroundColor: "#ffffff",
		elements: [
			card("boss", 250, 20),
			card("other", 450, 20),
			card("a", 50, 200),
			card("b", 150, 200),
			...lines.map((line) => ({
				type: "arrow" as const,
				id: `edge:${line.id}`,
				edgeId: line.id,
				sourceNodeId: line.source,
				targetNodeId: line.id,
				points: line.points as [{ x: number; y: number }, ...{ x: number; y: number }[]],
				endArrowhead: null,
			})),
		],
		layers: [],
		layouts: [],
		zOrder: [],
	};
	return validateExcalidrawScene(
		convertSceneToExcalidraw({ ...scene, zOrder: scene.elements.map((entry) => entry.id) }),
	);
}

describe("shared trunks", () => {
	const toA = [
		{ x: 300, y: 60 },
		{ x: 300, y: 120 },
		{ x: 100, y: 120 },
		{ x: 100, y: 200 },
	];
	const toB = [
		{ x: 300, y: 60 },
		{ x: 300, y: 120 },
		{ x: 200, y: 120 },
		{ x: 200, y: 200 },
	];
	const overlaps = (result: ReturnType<typeof validateExcalidrawScene>) =>
		result.issues.filter((issue) => issue.code === "overlapping-arrow-segment");

	it("lets lines leaving one card at one point run together until they part, as a bus", () => {
		expect(
			overlaps(
				busScene([
					{ id: "a", source: "boss", points: toA },
					{ id: "b", source: "boss", points: toB },
				]),
			),
		).toEqual([]);
	});

	it("still reports lines from different cards, or one point, running together", () => {
		// The second line leaves another card and joins the first one's run.
		expect(
			overlaps(
				busScene([
					{ id: "a", source: "boss", points: toA },
					{
						id: "b",
						source: "other",
						points: [
							{ x: 500, y: 60 },
							{ x: 500, y: 120 },
							{ x: 200, y: 120 },
							{ x: 200, y: 200 },
						],
					},
				]),
			),
		).not.toEqual([]);
		// The second line leaves the same card at another point before joining the run.
		expect(
			overlaps(
				busScene([
					{ id: "a", source: "boss", points: toA },
					{
						id: "b",
						source: "boss",
						points: [
							{ x: 340, y: 60 },
							{ x: 340, y: 120 },
							{ x: 200, y: 120 },
							{ x: 200, y: 200 },
						],
					},
				]),
			),
		).not.toEqual([]);
	});
});
