import { describe, expect, it } from "vitest";
import { quadrantFixture } from "../families/quadrant/document.js";
import { candidateFromText } from "./candidates.js";

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

	it("keeps semantic repair hints for scores left out of 0 to 1", () => {
		const output = candidate({ points: [{ label: "SSO login", x: 75, y: 85 }] });
		expect(output.error).toBeDefined();
		expect(output.diagnostics.join(" ")).toContain("quadrant.invalid_quadrant_point");
		expect(output.diagnostics.join(" ")).toContain("Divide a score out of 100 by 100");
	});
});
