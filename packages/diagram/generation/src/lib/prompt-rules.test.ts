import { describe, expect, it } from "vitest";

import { CURATED_EXAMPLES } from "./examples.js";
import { buildDiagramGenerationMessages } from "./messages.js";

const base = {
	type: "flowchart",
	id: "release-flow",
	title: "Release approval",
	nodes: [{ id: "start", label: "Change proposed", kind: "start" }],
	edges: [],
	style: { accentColor: "#000000", backgroundColor: "#ffffff" },
};

describe("buildDiagramGenerationMessages", () => {
	it("narrows the input to the explicitly selected family instead of paying for all family rules", () => {
		const prompt = { id: "budget", request: "Engineering sends 5 to Compute" };
		const untyped = buildDiagramGenerationMessages(prompt);
		const typed = buildDiagramGenerationMessages({ ...prompt, requestedType: "sankey" });

		expect(typed.system).toContain("Sankey IR rules:");
		expect(typed.system).not.toContain("Flowchart document rules:");
		expect(untyped.system).toContain("Sankey IR rules:");
		expect(untyped.system).toContain("Flowchart document rules:");
		expect(typed.system.length).toBeLessThan(untyped.system.length / 3);
		expect(typed.user).toContain("The caller explicitly requires sankey.");
		expect(untyped.user).not.toContain("Type authority:");
	});

	it("sends the selected family's curated request and answer alongside the actual request", () => {
		const request = "Show our inventory tables, not the example's enrollment tables";
		const { user } = buildDiagramGenerationMessages({
			id: "inventory",
			request,
			requestedType: "er",
		});

		expect(user).toContain(`Scenario:\n${request}\n`);
		expect(user).toContain(
			`Request: ${CURATED_EXAMPLES.er?.request}\nAnswer: ${CURATED_EXAMPLES.er?.answer}`,
		);
		expect(user).not.toContain(
			CURATED_EXAMPLES.flowchart?.answer ?? expect.fail("Missing flowchart example"),
		);
	});

	it("falls back to the family's JSON shape or the general example when no curated example applies", () => {
		const timeline = buildDiagramGenerationMessages({
			id: "history",
			request: "Apollo program",
			requestedType: "timeline",
		});
		const untyped = buildDiagramGenerationMessages({
			id: "choose",
			request: "Draw our release approval",
		});
		const timelineJson = timeline.user.slice(timeline.user.indexOf("{"));
		const generalJson = untyped.user.slice(untyped.user.indexOf("{"));

		expect(JSON.parse(timelineJson)).toMatchObject({
			diagram: { type: "timeline", events: expect.any(Array) },
		});
		expect(JSON.parse(generalJson)).toMatchObject({
			diagram: { type: "flowchart", nodes: expect.any(Object), edges: expect.any(Array) },
		});
		expect(timeline.user).not.toContain("Worked example:");
		expect(untyped.user).not.toContain("Worked example:");
	});

	it("serializes current revision content without the palette and sends the new request instead of an example", () => {
		const request = 'Add a review step named "QA"\nKeep CDN → origin unchanged.';
		const { user } = buildDiagramGenerationMessages({
			id: "revision",
			request,
			requestedType: "flowchart",
			base,
		});
		const current =
			user.split("Current diagram:\n")[1]?.split("\n\nRevision request:\n")[0] ??
			expect.fail("Missing revision content");
		const { style: _palette, ...content } = base;

		expect(JSON.parse(current)).toEqual(content);
		expect(user).toContain(`Revision request:\n${request}\n`);
		expect(user).not.toContain("Expected JSON shape");
		expect(user).not.toContain("Scenario:");
	});

	it("does not leak curated examples, revision or styling payload into a subsequent fresh request", () => {
		const prompt = { id: "fresh", request: "Explain the release process" };
		const before = buildDiagramGenerationMessages(prompt);
		buildDiagramGenerationMessages({
			id: "previous-example",
			request: "Inventory tables",
			requestedType: "er",
		});
		buildDiagramGenerationMessages({
			id: "styled-revision",
			request: "Make Change proposed red",
			base,
			styling: true,
		});
		const fresh = buildDiagramGenerationMessages(prompt);

		expect(fresh).toEqual(before);
		expect(fresh.user).toContain(`Scenario:\n${prompt.request}\n`);
		expect(fresh.user).toContain("Expected JSON shape");
		expect(fresh.user).not.toContain(base.id);
		expect(fresh.user).not.toContain("Revision request:");
		expect(fresh.user).not.toContain("Worked example:");
		expect(fresh.system).not.toContain("Revision:");
		expect(fresh.system).not.toContain("Styling:");
	});
});
