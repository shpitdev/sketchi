import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import {
	getStateMachineValidationIssues,
	mediaPlayerStateMachine,
	parseStateMachineDiagram,
	type StateMachineDiagram,
	stateMachineDiagramType,
	stateMachineFixture,
	stateTransitionLabel,
} from "./state-machine";

const codes = (input: Partial<StateMachineDiagram>) =>
	getStateMachineValidationIssues({ ...mediaPlayerStateMachine, ...input }).map(
		(issue) => issue.code,
	);

describe("StateMachine diagram type", () => {
	it("has typed fixtures that satisfy the canonical diagram contract", () => {
		expect(stateMachineFixture.type).toBe(stateMachineDiagramType);
		expect(parseCanonicalDiagram(stateMachineFixture)).toEqual(stateMachineFixture);
		expect(parseCanonicalDiagram(mediaPlayerStateMachine)).toEqual(mediaPlayerStateMachine);
	});

	it("labels a transition event [guard] / action, each part optional", () => {
		expect(stateTransitionLabel({ event: "pay", guard: "card valid", action: "charge" })).toBe(
			"pay [card valid] / charge",
		);
		expect(stateTransitionLabel({ guard: "[in stock]" })).toBe("[in stock]");
		expect(stateTransitionLabel({ event: "cancel", action: "/ refund" })).toBe("cancel / refund");
		expect(stateTransitionLabel({})).toBe("");
	});

	it("accepts self-loops, composite transitions, choices and unlabeled finals", () => {
		expect(
			parseStateMachineDiagram({
				id: "lock",
				title: "Lock",
				type: "state-machine",
				initial: "locked",
				states: [
					{ id: "locked", label: "Locked" },
					{ id: "check", kind: "choice" },
					{ id: "open", label: "Open" },
					{ id: "done", kind: "final" },
				],
				transitions: [
					{ id: "code", source: "locked", target: "check", event: "enter code" },
					{ id: "ok", source: "check", target: "open", guard: "code valid" },
					{ id: "bad", source: "check", target: "locked", guard: "else" },
					{ id: "tick", source: "locked", target: "locked", event: "tick" },
					{ id: "close", source: "open", target: "done" },
				],
			}).states,
		).toHaveLength(4);
	});

	it("enters a composite's initial substate only on entry to the composite itself", () => {
		// Entering Paused directly leaves Playing unreachable.
		expect(
			codes({
				transitions: [
					{ id: "jump", source: "stopped", target: "paused", event: "resume" },
					{ id: "stop", source: "active", target: "stopped", event: "stop" },
				],
			}),
		).toEqual(["unreachable_state"]);
		// Starting in a composite enters it, so it needs an initial substate.
		expect(
			codes({
				initial: "active",
				states: mediaPlayerStateMachine.states.map((state) =>
					state.id === "active" ? { id: "active", label: "Active" } : state,
				),
				transitions: [
					{ id: "stop", source: "active", target: "stopped", event: "stop" },
					{ id: "pause", source: "stopped", target: "paused", event: "pause" },
					{ id: "resume", source: "stopped", target: "playing", event: "resume" },
				],
			}),
		).toEqual(["missing_composite_initial"]);
	});

	it("requires a guard on every branch of a choice, with at most one else", () => {
		const choice = (guards: readonly (string | undefined)[]) =>
			codes({
				states: [...mediaPlayerStateMachine.states, { id: "pick", kind: "choice" }],
				transitions: [
					...mediaPlayerStateMachine.transitions,
					{ id: "to-pick", source: "stopped", target: "pick", event: "pick" },
					...guards.map((guard, index) => ({
						id: `branch-${index}`,
						source: "pick",
						target: index === 0 ? "active" : "stopped",
						...(guard === undefined ? {} : { guard }),
					})),
				],
			});
		expect(choice(["ready", "else"])).toEqual([]);
		expect(choice(["ready", undefined])).toEqual(["unguarded_choice_branch"]);
		expect(choice(["else", "else"])).toEqual(["unguarded_choice_branch"]);
		expect(
			getStateMachineValidationIssues({
				...mediaPlayerStateMachine,
				states: [...mediaPlayerStateMachine.states, { id: "pick", kind: "choice" }],
				transitions: [
					...mediaPlayerStateMachine.transitions,
					{ id: "to-pick", source: "stopped", target: "pick" },
					{ id: "a", source: "pick", target: "active" },
					{ id: "b", source: "pick", target: "stopped", guard: "else" },
				],
			})[0]?.hint,
		).toBe('Give every branch of a choice a guard; one may be "else".');
	});

	it("rejects malformed machines with a repair hint per issue", () => {
		expect(codes({ initial: "playing" })).toEqual(["unknown_initial_state"]);
		expect(codes({ initial: "missing" })).toEqual(["unknown_initial_state"]);
		expect(
			codes({
				states: [
					...mediaPlayerStateMachine.states,
					{ id: "deep", label: "Deep", parent: "paused" },
				],
			}),
		).toContain("nested_composite");
		expect(
			codes({
				states: mediaPlayerStateMachine.states.map((state) =>
					state.id === "active" ? { id: "active", label: "Active" } : state,
				),
			}),
		).toContain("missing_composite_initial");
		expect(
			codes({
				transitions: [
					...mediaPlayerStateMachine.transitions,
					{ id: "inner", source: "active", target: "paused", event: "jump" },
				],
			}),
		).toEqual(["composite_member_transition"]);
		expect(
			codes({
				states: [...mediaPlayerStateMachine.states, { id: "a:b", label: "Colon" }],
				transitions: [
					...mediaPlayerStateMachine.transitions,
					{ id: "colon", source: "stopped", target: "a:b" },
				],
			}),
		).toEqual(["invalid_state_id"]);
		expect(
			codes({ states: [...mediaPlayerStateMachine.states, { id: "orphan", label: "Orphan" }] }),
		).toEqual(["unreachable_state"]);
		expect(
			codes({
				states: [...mediaPlayerStateMachine.states, { id: "end", kind: "final" }],
				transitions: [
					...mediaPlayerStateMachine.transitions,
					{ id: "eject", source: "stopped", target: "end" },
					{ id: "revive", source: "end", target: "stopped" },
				],
			}),
		).toEqual(["final_has_outgoing"]);
		expect(
			codes({
				states: [...mediaPlayerStateMachine.states, { id: "pick", kind: "choice" }],
				transitions: [
					...mediaPlayerStateMachine.transitions,
					{ id: "to-pick", source: "stopped", target: "pick" },
					{ id: "from-pick", source: "pick", target: "stopped", guard: "always" },
				],
			}),
		).toEqual(["underbranched_choice"]);
		expect(codes({ states: [...mediaPlayerStateMachine.states, { id: "unnamed" }] })).toEqual([
			"missing_state_label",
			"unreachable_state",
		]);
		for (const issue of getStateMachineValidationIssues({
			...mediaPlayerStateMachine,
			initial: "missing",
		}))
			expect(issue.hint.length).toBeGreaterThan(10);
	});
});
