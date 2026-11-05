import { describe, expect, it } from "vitest";
import { quadrantFixture } from "@sketchi/diagram-core";
import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

describe("quadrant chart generation", () => {
	function candidate(diagram: object = {}) {
		const { title, ...fixture } = quadrantFixture;
		return candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title,
				diagram: { ...fixture, ...diagram },
			}),
		});
	}
	const request = {
		model: "fixture",
		prompt: {
			id: "quadrant",
			request: "effort vs impact quadrant chart",
			requestedType: "quadrant" as const,
		},
	};

	it("tells the model how axis ends, corners and scores map, with an example", () => {
		const messages = buildDiagramGenerationMessages(request.prompt);
		expect(messages.system).toContain('Use diagram type "quadrant".');
		expect(messages.system).toContain("a score out of 100 is score / 100");
		expect(messages.user).toContain('"quadrants":{"topLeft":"Quick wins"');
	});

	it("parses a quadrant chart", () => {
		const output = candidate();
		expect(output.error).toBeUndefined();
		expect(output.diagram?.type).toBe("quadrant");
		expect(enforceCandidateRequestRequirements(output, request).error).toBeUndefined();
	});

	it("keeps semantic repair hints for scores left out of 0 to 1", () => {
		const output = candidate({ points: [{ label: "SSO login", x: 75, y: 85 }] });
		expect(output.error).toBeDefined();
		expect(output.diagnostics.join(" ")).toContain("quadrant.invalid_quadrant_point");
		expect(output.diagnostics.join(" ")).toContain("Divide a score out of 100 by 100");
	});
});
