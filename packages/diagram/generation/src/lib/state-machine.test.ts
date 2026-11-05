import { describe, expect, it } from "vitest";
import { mediaPlayerStateMachine } from "@sketchi/diagram-core";

import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";

const request = {
	model: "fixture",
	prompt: { id: "order", request: "order lifecycle", requestedType: "state-machine" as const },
};
describe("state-machine generation", () => {
	it("materializes omitted composite entries and returns a non-blocking warning", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title: "Player",
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
});
