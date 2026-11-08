import { describe, expect, it } from "vitest";

import { candidateFromText } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";
import { asksForStyling, generatedStyles } from "./styling.js";

const flowchart = {
	id: "release",
	type: "flowchart",
	nodes: { start: "Change proposed", gate: "Approved?", ship: "Ship", revise: "Revise" },
	edges: [
		["start", "gate"],
		["gate", "ship", "yes"],
		["gate", "revise", "no"],
	],
};

describe("request-driven styling", () => {
	it("sends the styling rules only to a request that asks for colors or shapes", () => {
		expect(asksForStyling("Draw the reject path in red")).toBe(true);
		expect(asksForStyling("Make the gate a purple diamond")).toBe(true);
		expect(asksForStyling("Use #7c3aed for the gate")).toBe(true);
		expect(asksForStyling("Map release approval with pass and revise branches")).toBe(false);

		const styled = buildDiagramGenerationMessages({ id: "s", request: "red gate", styling: true });
		const plain = buildDiagramGenerationMessages({ id: "p", request: "a gate" });
		expect(styled.system).toContain("Styling:");
		expect(styled.system).toContain('also return styles: [{ "targets"');
		expect(plain.system).not.toContain("Styling:");
	});

	it("keeps well-formed styles and drops the rest with a diagnostic", () => {
		const diagnostics: string[] = [];
		const styles = generatedStyles(
			[
				{ targets: ["gate"], fillColor: "#ede9fe", strokeColor: "#7c3aed", shape: "Diamond" },
				{ targets: ["e3"], strokeColor: "red" },
				{ targets: [], fillColor: "#ffffff" },
				{ targets: ["ship"] },
			],
			diagnostics,
		);
		expect(styles.map((style) => ({ ...style }))).toEqual([
			{ targets: ["gate"], fillColor: "#ede9fe", strokeColor: "#7c3aed", shape: "diamond" },
		]);
		expect(diagnostics).toHaveLength(3);
		expect(diagnostics[0]).toContain("style_dropped: styles.1");
	});

	it("carries a response's styles on the candidate beside its diagram", () => {
		const candidate = candidateFromText({
			model: "test",
			provider: "fixture",
			text: JSON.stringify({
				title: "Release",
				diagram: flowchart,
				styles: [{ targets: ["e3", "revise"], strokeColor: "#dc2626" }],
			}),
		});
		expect(candidate.error).toBeUndefined();
		// A flowchart node's color moves into its document; only the edge stays a style.
		expect(candidate.flowchart?.nodes["revise"]).toEqual({ label: "Revise", color: "red" });
		expect(candidate.styles?.map((style) => [...style.targets])).toEqual([["e3"]]);
	});

	it("moves a flowchart's node colors and diamonds into its document, the nearest palette color for any hex", () => {
		const candidate = candidateFromText({
			model: "test",
			provider: "fixture",
			text: JSON.stringify({
				title: "Release",
				diagram: flowchart,
				styles: [
					{ targets: ["Ship"], fillColor: "#dcfce7", strokeColor: "#16a34a" },
					{ targets: ["start"], strokeColor: "#ff0000", textColor: "#111111" },
					{ targets: ["revise"], shape: "circle" },
					{ targets: ["gate"], shape: "diamond", fillColor: "#ede9fe" },
				],
			}),
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.flowchart?.nodes).toEqual({
			start: { label: "Change proposed", color: "red" },
			gate: { label: "Approved?", color: "purple", shape: "diamond" },
			ship: { label: "Ship", color: "green" },
			revise: "Revise",
		});
		expect(candidate.styles?.map((style) => ({ ...style, targets: [...style.targets] }))).toEqual([
			{ targets: ["start"], textColor: "#111111" },
			{ targets: ["revise"], shape: "circle" },
		]);
	});

	it("tells a flowchart to color nodes in its document", () => {
		const styled = buildDiagramGenerationMessages({ id: "s", request: "red gate", styling: true });
		expect(styled.system).toContain("A flowchart colors a node with its own color field instead");
	});
});
