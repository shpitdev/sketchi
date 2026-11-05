import { describe, expect, it } from "vitest";
import { vennFixture } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Product team skills",
			diagram,
		}),
	});
}

describe("Venn diagram generation", () => {
	it("teaches the Venn shape when the type is requested", () => {
		const messages = buildDiagramGenerationMessages({
			id: "skills",
			request: "Draw a Venn diagram of our team skills.",
			requestedType: "venn",
		});
		expect(messages.system).toContain("Venn diagram IR rules");
		expect(messages.system).toContain('["a", "b"] is a and b but not c');
		expect(messages.user).toContain('"type":"venn"');
	});

	it("reads sets named by label and whole set memberships", () => {
		const parsed = candidate({
			id: "phones",
			type: "venn",
			sets: [
				{ label: "iOS", items: ["Apple Pay", "Push notifications"] },
				{ label: "Android", items: ["Google Pay", "Push notifications"] },
			],
			regions: [{ sets: ["iOS", "Android"], items: ["Dark mode"] }],
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		if (diagram?.type !== "venn") throw new Error("Expected a Venn diagram.");
		expect(diagram.sets).toEqual([
			{ id: "iOS", label: "iOS" },
			{ id: "Android", label: "Android" },
		]);
		expect(diagram.regions).toEqual([
			{ sets: ["iOS", "Android"], items: ["Dark mode", "Push notifications"] },
			{ sets: ["iOS"], items: ["Apple Pay"] },
			{ sets: ["Android"], items: ["Google Pay"] },
		]);
	});

	it("reports an unknown set with its repair hint", () => {
		const parsed = candidate({
			...vennFixture,
			regions: [...vennFixture.regions, { sets: ["design", "marketing"], items: ["Brand"] }],
		});
		expect(parsed.diagram).toBeUndefined();
		expect(parsed.diagnostics.join(" ")).toContain("venn.unknown_venn_set");
		expect(parsed.diagnostics.join(" ")).toContain("Hint:");
	});
});
