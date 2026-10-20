import { describe, expect, it } from "vitest";
import { mediaPlayerStateMachine, stateMachineFixture } from "@sketchi/diagram-core";

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
	it("materializes omitted composite entries and returns a non-blocking warning", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title: "Player",
				intent: { requestedKind: "state-machine", nativeKind: "state-machine", requirements: [] },
				diagram: {
					...mediaPlayerStateMachine,
					states: mediaPlayerStateMachine.states.map(({ initial: _initial, ...state }) => state),
				},
			}),
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toMatchObject({
			states: expect.arrayContaining([{ id: "active", label: "Active", initial: "playing" }]),
		});
		expect(candidate.diagnostics).toEqual([]);
		expect(candidate.warnings).toEqual([
			expect.objectContaining({
				code: "composite_initial_defaulted",
				severity: "warning",
				message:
					'Composite "active" has no initial; defaulted to its first listed regular substate "playing".',
			}),
		]);
	});

	it("accepts omitted state labels through generation and enforces their displayed ids", () => {
		const diagram = {
			...mediaPlayerStateMachine,
			states: mediaPlayerStateMachine.states.map(({ label: _label, ...state }) => state),
		};
		const candidate = enforceCandidateRequestRequirements(
			candidateFromText({
				model: "fixture",
				provider: "fixture",
				text: JSON.stringify({
					title: diagram.title,
					intent: {
						requestedKind: "state-machine",
						nativeKind: "state-machine",
						requirements: ["stopped", "active", "playing", "paused"].map((value) => ({
							kind: "label",
							target: "state",
							value,
						})),
					},
					diagram,
				}),
			}),
			request,
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagnostics).toEqual([]);
		expect(candidate.diagram).toMatchObject(diagram);
	});

	it.each(["", " ", "\t\n"])("rejects an explicit blank generated label %j", (label) => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title: mediaPlayerStateMachine.title,
				intent: { requestedKind: "state-machine", nativeKind: "state-machine", requirements: [] },
				diagram: {
					...mediaPlayerStateMachine,
					states: mediaPlayerStateMachine.states.map((state) =>
						state.id === "stopped" ? { ...state, label } : state,
					),
				},
			}),
		});
		expect(candidate.error).toBeDefined();
		expect(candidate.diagram).toBeUndefined();
	});

	it("preserves explicitly generated labels byte for byte", () => {
		const label = "  Stopped\n  (ready_to_play)  ";
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title: mediaPlayerStateMachine.title,
				intent: { requestedKind: "state-machine", nativeKind: "state-machine", requirements: [] },
				diagram: {
					...mediaPlayerStateMachine,
					states: mediaPlayerStateMachine.states.map((state) =>
						state.id === "stopped" ? { ...state, label } : state,
					),
				},
			}),
		});
		expect(candidate.error).toBeUndefined();
		if (candidate.diagram?.type !== "state-machine") throw new Error("Expected state machine");
		expect(candidate.diagram.states[0]?.label).toBe(label);
	});

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
