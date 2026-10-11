import { describe, expect, it } from "vitest";

import { firstBuildTool, studioRoutingCases } from "./studio-routing-eval";

describe("Studio routing eval", () => {
	it("covers a named type overriding the topic in both directions, and unnamed content", () => {
		const byId = new Map(studioRoutingCases.map((entry) => [entry.id, entry]));
		expect(byId.get("named-flowchart-sequence-topic")?.expected).toBe("build_flowchart");
		expect(byId.get("named-sequence-process-topic")?.expected).toBe("build_sequence_diagram");
		expect(new Set(studioRoutingCases.map((entry) => entry.expected))).toEqual(
			new Set(["build_flowchart", "build_sequence_diagram"]),
		);
	});

	it("reads the first build tool from a UI message stream", () => {
		const stream = [
			'data: {"type":"start"}',
			'data: {"type":"text-delta","id":"t","delta":"Sketching a sequence diagram."}',
			'data: {"type":"tool-input-start","toolCallId":"c1","toolName":"build_sequence_diagram"}',
			'data: {"type":"tool-input-start","toolCallId":"c2","toolName":"build_flowchart"}',
			"data: [DONE]",
		].join("\n\n");
		expect(firstBuildTool(stream)).toBe("build_sequence_diagram");
		expect(firstBuildTool('data: {"type":"text-delta","delta":"Which flow?"}')).toBeUndefined();
	});
});
