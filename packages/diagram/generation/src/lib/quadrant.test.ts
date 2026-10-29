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
				intent: {
					requestedKind: "quadrant",
					nativeKind: "quadrant",
					requirements: [
						{ kind: "count", target: "points", comparator: "exact", value: 5 },
						{ kind: "label", target: "point", value: "SSO login" },
						{ kind: "label", target: "quadrant", value: "Quick wins" },
					],
				},
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

	it("parses a quadrant chart and enforces point and quadrant requirements", () => {
		const output = candidate();
		expect(output.error).toBeUndefined();
		expect(output.diagram?.type).toBe("quadrant");
		expect(enforceCandidateRequestRequirements(output, request).error).toBeUndefined();
		const missing = candidate({
			points: quadrantFixture.points.filter((point) => point.label !== "SSO login"),
		});
		expect(enforceCandidateRequestRequirements(missing, request).error).toBeDefined();
		const renamed = candidate({ quadrants: { ...quadrantFixture.quadrants, topLeft: "Wins" } });
		expect(enforceCandidateRequestRequirements(renamed, request).error).toBeDefined();
	});

	it("keeps semantic repair hints for scores left out of 0 to 1", () => {
		const output = candidate({ points: [{ label: "SSO login", x: 75, y: 85 }] });
		expect(output.error).toBeDefined();
		expect(output.diagnostics.join(" ")).toContain("quadrant.invalid_quadrant_point");
		expect(output.diagnostics.join(" ")).toContain("Divide a score out of 100 by 100");
	});
});
