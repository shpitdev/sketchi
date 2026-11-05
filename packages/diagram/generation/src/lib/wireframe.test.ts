import { describe, expect, it } from "vitest";
import { wireframeFixture } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Mobile login",
			diagram,
		}),
	});
}

describe("wireframe generation", () => {
	it("teaches the wireframe shape when the type is requested", () => {
		const messages = buildDiagramGenerationMessages({
			id: "login",
			request: "Wireframe our login screen.",
			requestedType: "wireframe",
		});
		expect(messages.system).toContain("Wireframe IR rules");
		expect(messages.system).toContain('device: "desktop" | "tablet" | "mobile"');
		expect(messages.user).toContain('"type":"wireframe"');
	});

	it("reads component aliases and keeps a lone screen's tree under screens", () => {
		const parsed = candidate({
			id: "login",
			type: "wireframe",
			device: "phone",
			components: [
				{ type: "h1", label: "Welcome back" },
				{ type: "text-field", label: "Email" },
				{ type: "button", label: "Sign in", primary: true },
			],
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		if (diagram?.type !== "wireframe") throw new Error("Expected a wireframe.");
		expect(diagram.screens).toEqual([
			{
				id: "mobile-login",
				name: "Mobile login",
				device: "mobile",
				children: [
					{ type: "heading", level: 1, text: "Welcome back" },
					{ type: "input", label: "Email" },
					{ type: "button", text: "Sign in", variant: "primary" },
				],
			},
		]);
	});

	it("reports a component it cannot draw with its repair hint", () => {
		const parsed = candidate({
			...wireframeFixture,
			screens: [{ ...wireframeFixture.screens[0]!, children: [{ type: "button" }] }],
		});
		expect(parsed.diagram).toBeUndefined();
		expect(parsed.diagnostics.join(" ")).toContain("wireframe.missing_wireframe_text");
		expect(parsed.diagnostics.join(" ")).toContain("Hint:");
	});
});
