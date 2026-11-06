import { describe, expect, it } from "vitest";

import { candidateFromText } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";
import { asksForStyling, generatedStyles } from "./styling.js";

const flowchart = {
	id: "release",
	type: "flowchart",
	nodes: [
		{ id: "start", label: "Change proposed", kind: "start" },
		{ id: "gate", label: "Approved?", kind: "decision" },
		{ id: "ship", label: "Ship", kind: "end" },
		{ id: "revise", label: "Revise", kind: "end" },
	],
	edges: [
		{ id: "e1", source: "start", target: "gate" },
		{ id: "e2", source: "gate", target: "ship", label: "yes" },
		{ id: "e3", source: "gate", target: "revise", label: "no" },
	],
	layout: { direction: "TB", edgeRouting: "orthogonal" },
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
		expect(candidate.styles?.map((style) => [...style.targets])).toEqual([["e3", "revise"]]);
	});
});
