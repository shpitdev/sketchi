import { describe, expect, it } from "vitest";

import {
	getCanvasValidationIssues,
	groupRegionIssues,
	mediaPlayerStateMachine,
	parseStateMachineDiagram,
	type StateMachineDiagram,
	stateMachineFixture,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram.js";
import type { RenderedDiagramScene } from "../scene.js";

const nodes = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "node" ? [element] : []));
const arrows = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
const texts = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "text" ? [element.text] : []));

describe("StateMachine renderer", () => {
	it("draws regular-state ids and composite names without labels", () => {
		const diagram = parseStateMachineDiagram({
			...mediaPlayerStateMachine,
			states: mediaPlayerStateMachine.states.map(({ label: _label, ...state }) => state),
		});
		const scene = renderDiagram(diagram);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(groupRegionIssues(scene)).toEqual([]);
		expect(texts(scene)).toEqual(expect.arrayContaining(["stopped", "playing", "paused"]));
		expect(scene.elements).toContainEqual(
			expect.objectContaining({ type: "frame", name: "active" }),
		);
	});

	it("renders each fixture into a valid deterministic scene", () => {
		for (const diagram of [stateMachineFixture, mediaPlayerStateMachine]) {
			const scene = renderDiagram(diagram);
			expect(scene.diagramId).toBe(diagram.id);
			expect(getCanvasValidationIssues(scene)).toEqual([]);
			expect(groupRegionIssues(scene)).toEqual([]);
			expect(renderDiagram(diagram)).toEqual(scene);
		}
	});

	it("draws an initial dot, compact labels and one bullseye per transition into a final", () => {
		const scene = renderDiagram(stateMachineFixture);
		const initial = nodes(scene).find((node) => node.nodeId === ":initial")!;
		expect(initial).toMatchObject({ kind: "initial", rendererRole: "state-marker" });
		expect(arrows(scene).find((arrow) => arrow.sourceNodeId === ":initial")?.targetNodeId).toBe(
			"pending",
		);
		expect(texts(scene)).toEqual(
			expect.arrayContaining(["pay [card valid] / charge", "after 24h / email", "cancel"]),
		);
		// "done" is reached twice: each arrival ends at a bullseye of its own.
		expect(
			nodes(scene)
				.filter((node) => node.kind === "final")
				.map((node) => node.nodeId)
				.sort(),
		).toEqual(["done", "done:2"]);
		// The completion transition carries no label.
		expect(arrows(scene).find((arrow) => arrow.edgeId === "close")?.label).toBeUndefined();
	});

	it("frames a composite with its own initial dot and routes its transitions to the frame", () => {
		const scene = renderDiagram(mediaPlayerStateMachine);
		const frame = scene.elements.find((element) => element.type === "frame")!;
		expect(frame).toMatchObject({ id: "group:active", name: "Active", nodeId: "active" });
		const inside = nodes(scene)
			.filter((node) => node.frameId === "group:active")
			.map((node) => node.nodeId);
		expect(inside).toEqual(["active:initial", "playing", "paused"]);
		const play = arrows(scene).find((arrow) => arrow.edgeId === "play")!;
		const stop = arrows(scene).find((arrow) => arrow.edgeId === "stop")!;
		expect([play.targetNodeId, stop.sourceNodeId]).toEqual(["active", "active"]);
	});

	it("draws a labeled final as its state followed by a bullseye", () => {
		const diagram: StateMachineDiagram = parseStateMachineDiagram({
			id: "ticket",
			title: "Ticket",
			type: "state-machine",
			initial: "open",
			states: [
				{ id: "open", label: "Open" },
				{ id: "closed", label: "Closed", kind: "final" },
			],
			transitions: [{ id: "resolve", source: "open", target: "closed", event: "resolve" }],
		});
		const scene = renderDiagram(diagram);
		expect(nodes(scene).find((node) => node.nodeId === "closed")).toMatchObject({
			kind: "state",
			label: "Closed",
		});
		expect(arrows(scene).find((arrow) => arrow.edgeId === "closed:end")?.targetNodeId).toBe(
			"closed:end",
		);
	});

	it("never lets its own edges collide with authored transition ids", () => {
		const diagram = parseStateMachineDiagram({
			id: "colliding",
			title: "Colliding ids",
			type: "state-machine",
			initial: "stopped",
			states: [
				{ id: "stopped", label: "Stopped" },
				{ id: "active", label: "Active", initial: "playing" },
				{ id: "playing", label: "Playing", parent: "active" },
				{ id: "closed", label: "Closed", kind: "final" },
			],
			transitions: [
				{ id: ":initial", source: "stopped", target: "active", event: "play" },
				{ id: "active:initial", source: "active", target: "stopped", event: "stop" },
				{ id: "closed:end", source: "stopped", target: "closed", event: "close" },
			],
		});
		const scene = renderDiagram(diagram);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		const ids = arrows(scene).map((arrow) => arrow.edgeId);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of [":initial", "active:initial", "closed:end"])
			expect(arrows(scene).find((arrow) => arrow.edgeId === id)?.label).toBeDefined();
	});

	it("keeps an authored direction and otherwise picks one that reads", () => {
		const across = renderDiagram({ ...stateMachineFixture, layout: { direction: "LR" } });
		const down = renderDiagram({ ...stateMachineFixture, layout: { direction: "TB" } });
		expect(across.width / across.height).toBeGreaterThan(down.width / down.height);
		const chosen = renderDiagram(stateMachineFixture);
		expect(
			Math.max(chosen.width / chosen.height, chosen.height / chosen.width),
		).toBeLessThanOrEqual(2.5);
		expect([across, down].map((scene) => scene.width)).toContain(chosen.width);
	});
});
