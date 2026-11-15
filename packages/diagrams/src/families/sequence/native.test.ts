import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { parseSequenceDiagram } from "./document.js";
import { sequenceFixture, apiRequestSequence, selfMessageSequence } from "./fixtures.js";
import { renderSequenceDiagram } from "./render.js";
describe("sequence native exports", () => {
	it("accepts sequence messages that cross intermediate lifelines", () => {
		const scene = convertSceneToExcalidraw(
			renderSequenceDiagram({
				type: "sequence",
				id: "cross-lifeline",
				title: "Cross lifeline",
				participants: [
					{ id: "left", label: "Left" },
					{
						id: "middle",
						label: "Middle",
						kind: "sequence-lifeline",
					},
					{ id: "right", label: "Right" },
				],
				messages: [
					{
						id: "cross",
						source: "left",
						target: "right",
						label: "Cross middle",
					},
				],
				style: { accentColor: "#000000", backgroundColor: "#ffffff" },
			}),
		);

		expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
		expect(scene.elements.find((element) => element.id === "node:middle:lifeline")).toMatchObject({
			customData: { sketchiRendererRole: "sequence-lifeline" },
		});
		expect(scene.elements.find((element) => element.id === "node:middle")).not.toHaveProperty(
			"customData.sketchiRendererRole",
		);
	});
	it("exports a self-message as an elbow loop bound to its bars with its label beside it", () => {
		const diagram = parseSequenceDiagram({
			id: "oauth-self",
			title: "OAuth with credential check",
			type: "sequence",
			participants: [
				{ id: "browser", label: "Browser" },
				{ id: "idp", label: "Identity Provider" },
			],
			messages: [
				{ id: "authorize", source: "browser", target: "idp", label: "Authorize" },
				{ id: "validate", source: "idp", target: "idp", label: "Validate the user's credentials" },
				{ id: "code", source: "idp", target: "browser", label: "Code", type: "return" },
				{ id: "retry", source: "browser", target: "browser", label: "Retry", type: "return" },
			],
		}).pipe(Result.getOrThrow);
		const scene = convertSceneToExcalidraw(renderSequenceDiagram(diagram));
		expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
		const element = (id: string) => {
			const found = scene.elements.find((candidate) => candidate.id === id);
			if (!found) throw new Error(`Missing ${id}.`);
			return found;
		};
		const loop = element("arrow:validate");
		expect(loop).toMatchObject({
			type: "arrow",
			elbowed: true,
			startBinding: { elementId: "node:idp:lifeline:activation:authorize" },
			endBinding: { elementId: "node:idp:lifeline:activation:validate" },
			boundElements: null,
		});
		// Both ends leave the bars' right sides, a hair out so Excalidraw reads them leaving right.
		for (const key of ["startBinding", "endBinding"] as const) {
			const [x] = (loop[key] as { fixedPoint: [number, number] }).fixedPoint;
			expect(x).toBeGreaterThan(1);
			expect(x).toBeLessThan(1.001);
		}
		expect(element("node:idp:lifeline:activation:validate").boundElements).toEqual(
			expect.arrayContaining([{ id: "arrow:validate", type: "arrow" }]),
		);
		// The label is free text right of the loop's outer leg, grouped with the
		// loop so they move together, and keeps its stored wrap on edit.
		const points = loop.points as [number, number][];
		const label = element("arrow:validate:label");
		expect(label).toMatchObject({
			type: "text",
			containerId: null,
			autoResize: false,
			groupIds: loop.groupIds,
		});
		expect(loop.groupIds).toEqual(["message:validate"]);
		expect(label.x as number).toBeGreaterThan((loop.x as number) + points[1]![0]);
		const loopTop = (loop.y as number) + points[1]![1];
		const loopBottom = (loop.y as number) + points[2]![1];
		expect(label.y as number).toBeGreaterThanOrEqual(loopTop);
		expect((label.y as number) + (label.height as number)).toBeLessThanOrEqual(loopBottom);
		// The idle browser's self-return loops on its lifeline.
		expect(element("arrow:retry")).toMatchObject({
			elbowed: true,
			strokeStyle: "dashed",
			startBinding: { elementId: "node:browser:lifeline" },
			endBinding: { elementId: "node:browser:lifeline" },
		});
	});
	it("exports activation bars as unlabeled bound shapes that other messages may cross", () => {
		const nested = parseSequenceDiagram({
			id: "oauth",
			title: "OAuth callback",
			type: "sequence",
			participants: [
				{ id: "client", label: "Client" },
				{ id: "api", label: "API" },
				{ id: "auth", label: "Auth" },
			],
			messages: [
				{ id: "login", source: "client", target: "api", label: "Log in" },
				{ id: "authorize", source: "api", target: "auth", label: "Authorize" },
				{ id: "callback", source: "auth", target: "api", label: "Callback" },
				{ id: "ack", source: "api", target: "auth", label: "Ack", type: "return" },
				{ id: "token", source: "auth", target: "api", label: "Token", type: "return" },
				{ id: "direct", source: "auth", target: "client", label: "Direct notice" },
				{ id: "session", source: "api", target: "client", label: "Session", type: "return" },
			],
		}).pipe(Result.getOrThrow);
		for (const diagram of [apiRequestSequence, selfMessageSequence, nested]) {
			const scene = convertSceneToExcalidraw(renderSequenceDiagram(diagram));
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
		}

		const scene = convertSceneToExcalidraw(renderSequenceDiagram(sequenceFixture));
		const bar = scene.elements.find(
			(element) => element.id === "node:store:lifeline:activation:checkout",
		);
		expect(bar).toMatchObject({
			type: "rectangle",
			customData: { sketchiRendererRole: "sequence-activation" },
			boundElements: expect.arrayContaining([
				{ id: "arrow:checkout", type: "arrow" },
				{ id: "arrow:receipt", type: "arrow" },
			]),
		});
		expect(
			scene.elements.some(
				(element) =>
					element.type === "text" &&
					element.containerId === "node:store:lifeline:activation:checkout",
			),
		).toBe(false);
	});
});
