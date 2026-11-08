import {
	CHART_RULES,
	CLASS_RULES,
	ER_RULES,
	FLOWCHART_RULES,
	GANTT_RULES,
	JOURNEY_RULES,
	ORG_CHART_RULES,
	QUADRANT_RULES,
	SANKEY_RULES,
	SEQUENCE_MAX_MESSAGES,
	SEQUENCE_MAX_PARTICIPANTS,
	SEQUENCE_RULES,
	STATE_MACHINE_RULES,
	TIMELINE_RULES,
	VENN_RULES,
	WIREFRAME_RULES,
} from "@sketchi/diagram-core";
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
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			"build_flowchart with { spec } (the flowchart document)",
		);
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

describe("Studio chat rules", () => {
	it("reads every family's rules from diagram-core in the user's voice", () => {
		for (const rule of [
			FLOWCHART_RULES.labelForm,
			FLOWCHART_RULES.documentLanes("the user"),
			SEQUENCE_RULES.selfStep,
			STATE_MACHINE_RULES.kinds("the user"),
			STATE_MACHINE_RULES.endsLifecycle,
			GANTT_RULES.duration,
			ER_RULES.cardinalityFromKeys("the user"),
			CLASS_RULES.typedFields("the user"),
			ORG_CHART_RULES.groupOnlyWhenAsked("the user"),
			JOURNEY_RULES.actors("the user"),
			SANKEY_RULES.dropOff("the user"),
			WIREFRAME_RULES.screens,
			QUADRANT_RULES.axes("the user"),
			VENN_RULES.regions,
			TIMELINE_RULES.precision("the user"),
			CHART_RULES.noRounding,
		]) {
			expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(rule);
		}
	});

	it("allows self-messages, lays flows out top to bottom unless asked, and states limits once", () => {
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).not.toContain("two different participant ids");
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).not.toContain('"LR" for pipelines and lifecycles');
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(FLOWCHART_RULES.documentDirection("the user"));
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).not.toContain("read best");
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).toContain(
			`Use at most ${SEQUENCE_MAX_PARTICIPANTS} participants and ${SEQUENCE_MAX_MESSAGES} messages.`,
		);
		expect(DIAGRAM_AGENT_SYSTEM_PROMPT).not.toContain("5 words max");
	});
});
