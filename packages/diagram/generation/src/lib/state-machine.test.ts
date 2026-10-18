import { describe, expect, it } from "vitest";
import { stateMachineFixture } from "@sketchi/diagram-core";

import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";

const request = {
	model: "fixture",
	prompt: { id: "order", request: "order lifecycle", requestedType: "state-machine" as const },
};
function enforced(cycles: number, transitions = stateMachineFixture.transitions) {
	return enforceCandidateRequestRequirements(
		candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title: stateMachineFixture.title,
				intent: {
					requestedKind: "state-machine",
					nativeKind: "state-machine",
					requirements: [{ kind: "count", target: "cycles", comparator: "minimum", value: cycles }],
				},
				diagram: { ...stateMachineFixture, transitions },
			}),
		}),
		request,
	);
}

describe("state-machine generation", () => {
	it("counts loops, a self-loop included, toward a cycles requirement", () => {
		// The fixture has the after-24h self-loop and the shipped/paid return.
		expect(enforced(2).error).toBeUndefined();
		const withoutSelfLoop = stateMachineFixture.transitions.filter(
			(transition) => transition.source !== transition.target,
		);
		expect(enforced(2, withoutSelfLoop).diagnostics.join(" ")).toContain(
			"requirement_count_not_met: cycles must be at least 2",
		);
		expect(enforced(1, withoutSelfLoop).error).toBeUndefined();
	});
});
