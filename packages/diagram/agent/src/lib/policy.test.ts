import { describe, expect, it } from "vitest";

import { DIAGRAM_AGENT_SYSTEM_PROMPT, MAX_FLOWCHART_BUILD_ATTEMPTS } from "./policy.js";

describe("diagram agent policy", () => {
	it("states the configured build budget and final-attempt stop rule", () => {
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			`Hard limit of ${MAX_FLOWCHART_BUILD_ATTEMPTS} attempts per turn`,
		);
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			"if the final attempt is still rejected, stop calling the tool",
		);
	});

	it("distinguishes structured issues from quality checks", () => {
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			"structured issue using its code, ref, message, and hint",
		);
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			"quality check using its code, refs, and message",
		);
	});
});
