import { describe, expect, it } from "vitest";

import { DIAGRAM_AGENT_SYSTEM_PROMPT, MAX_DIAGRAM_BUILD_ATTEMPTS } from "./policy.js";

describe("diagram agent policy", () => {
	it("states the configured build budget and final-attempt stop rule", () => {
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			`Hard limit of ${MAX_DIAGRAM_BUILD_ATTEMPTS} attempts per turn`,
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

	it("routes time-ordered interactions to the sequence build tool", () => {
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain("build_flowchart with { spec: FlowchartSpec }");
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			"build_sequence_diagram with { spec: SequenceDiagramSpec }",
		);
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain("SEQUENCE CRAFT");
		// A named type wins over the topic in both directions.
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			"When the user names a diagram type, use that type's tool whatever the topic",
		);
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			"a flowchart of an OAuth handshake is still a flowchart",
		);
	});
});
