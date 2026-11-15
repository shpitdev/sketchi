import { describe, it, expect } from "vitest";
import { Result } from "effect";
import {
	parseWireframeDiagram,
	WIREFRAME_MAX_COMPONENTS,
	WIREFRAME_MAX_SCREENS,
	WIREFRAME_MAX_ELEMENTS,
} from "./document.js";
import { renderWireframeDiagram } from "./render.js";
import { wireframeBoxIssues, wireframeLayoutIssues } from "./readout.js";

describe("wireframe bounded placement", () => {
	it("places the maximum tree deterministically with bounded component reads", () => {
		const diagram = parseWireframeDiagram({
			id: "capacity",
			type: "wireframe",
			title: "Capacity",
			screens: Array.from({ length: WIREFRAME_MAX_SCREENS }, (_, screen) => ({
				id: `s${screen}`,
				name: `Screen ${screen}`,
				device: "desktop",
				children: Array.from({ length: screen === 0 ? 30 : 26 }, (_, i) => ({
					type: "heading",
					text: `Heading ${i}`,
				})),
			})),
		}).pipe(Result.getOrThrow);
		let reads = 0;
		const counted = {
			...diagram,
			screens: diagram.screens.map((screen) => ({
				...screen,
				children: new Proxy(screen.children, {
					get(target, key, receiver) {
						if (typeof key === "string" && /^\d+$/.test(key)) reads++;
						return Reflect.get(target, key, receiver);
					},
				}),
			})),
		};
		const { scene, layout } = renderWireframeDiagram(counted);
		expect(layout.screens.reduce((sum, screen) => sum + screen.components.length, 0)).toBe(
			WIREFRAME_MAX_COMPONENTS,
		);
		expect(reads).toBeLessThanOrEqual(WIREFRAME_MAX_COMPONENTS * 8);
		expect(renderWireframeDiagram(counted).scene).toEqual(scene);
		expect(scene.elements.length).toBeLessThanOrEqual(WIREFRAME_MAX_ELEMENTS);
		expect(wireframeBoxIssues(layout)).toEqual([]);
		expect(wireframeLayoutIssues(scene)).toEqual([]);
		const frames = scene.elements.filter((element) => element.type === "frame");
		const width =
			Math.max(...frames.map((frame) => frame.x + frame.width)) -
			Math.min(...frames.map((frame) => frame.x));
		const height =
			Math.max(...frames.map((frame) => frame.y + frame.height)) -
			Math.min(...frames.map((frame) => frame.y));
		expect(width / height).toBeLessThanOrEqual(2.45);
	});
});
