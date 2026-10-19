import { describe, expect, it } from "vitest";
import type { StateMachineDiagram } from "@sketchi/diagram-core";
import { type ArrowSceneElement, arrowCrossings, renderDiagram } from "@sketchi/diagram-renderer";

import { evaluateScenarioDiagram } from "./evaluate.js";
import { stateMachineScenarios } from "./state-machine-scenarios.js";

const scenario = (id: string) => stateMachineScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: StateMachineDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
type Transition = StateMachineDiagram["transitions"][number];
const withTransition = (
	diagram: StateMachineDiagram,
	id: string,
	change: (transition: Transition) => Transition | undefined,
): StateMachineDiagram => ({
	...diagram,
	transitions: diagram.transitions.flatMap((transition) =>
		transition.id === id ? (change(transition) ?? []) : [transition],
	),
});

describe("prompt-grounded state-machine scenarios", () => {
	it("checks the core display-name defaults on an unlabeled media-player candidate", () => {
		const entry = scenario("media-player-state-machine");
		const diagram = {
			...entry.expectedDiagram,
			states: entry.expectedDiagram.states.map(({ label: _label, ...state }) => state),
		};
		expect(failed(entry.id, diagram)).toEqual([]);
	});

	it.each(["connection-retry-state-machine", "order-lifecycle-state-machine"])(
		"scores named-final defaults just like explicit labels: %s",
		(id) => {
			const entry = scenario(id);
			const diagram = {
				...entry.expectedDiagram,
				states: entry.expectedDiagram.states.map(({ label, ...state }) => {
					if (id.startsWith("order") && ["cancelled", "refunded"].includes(state.id))
						return { ...state, kind: "final" as const };
					return state;
				}),
				transitions: entry.expectedDiagram.transitions.filter(
					(transition) =>
						!(
							(transition.source === "cancelled" || transition.source === "refunded") &&
							transition.target === "end"
						),
				),
			};
			expect(failed(id, diagram)).toEqual([]);
		},
	);

	it("covers guards, returns, self-loops, composites, choices and finals", () => {
		const diagrams = stateMachineScenarios.map((entry) => entry.expectedDiagram);
		expect(stateMachineScenarios.length).toBeGreaterThanOrEqual(3);
		expect(diagrams.some((d) => d.transitions.some((t) => t.source === t.target))).toBe(true);
		expect(diagrams.some((d) => d.transitions.some((t) => t.guard && t.action))).toBe(true);
		expect(diagrams.some((d) => d.states.some((state) => state.parent))).toBe(true);
		expect(diagrams.some((d) => d.states.some((state) => state.kind === "choice"))).toBe(true);
		expect(diagrams.some((d) => d.states.some((state) => state.kind === "final"))).toBe(true);
		// A transition and its return between the same two states.
		expect(
			diagrams.some((d) =>
				d.transitions.some((t) =>
					d.transitions.some((u) => u.source === t.target && u.target === t.source && t !== u),
				),
			),
		).toBe(true);
	});

	it("draws every scenario without crossings", () => {
		// The media player's eject once ran through its stop return, and the
		// connection's timeout into the retry choice crossed the retry back to
		// Connecting; both now leave and arrive by sides that cross nothing.
		for (const entry of stateMachineScenarios) {
			const arrows = renderDiagram(entry.expectedDiagram).elements.filter(
				(element): element is ArrowSceneElement => element.type === "arrow",
			);
			expect(arrowCrossings(arrows), entry.id).toBe(0);
		}
	});

	for (const entry of stateMachineScenarios) {
		it(`${entry.id}: accepts its fixture with zero validator issues`, () => {
			const evaluation = evaluateScenarioDiagram(entry, entry.expectedDiagram);
			expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
			expect(evaluation.excalidrawValidation.issues).toEqual([]);
		});

		it(`${entry.id}: requires every stated state and transition`, () => {
			const input = entry.expectedDiagram;
			for (const transition of input.transitions) {
				const without = withTransition(input, transition.id, () => undefined);
				// Dropping a transition may strand a state; score only valid machines.
				try {
					expect(failed(entry.id, without), transition.id).not.toEqual([]);
				} catch (error) {
					if (!(error instanceof Error) || !error.name.includes("Validation")) throw error;
				}
			}
			const renamed = {
				...input,
				states: input.states.map((state) =>
					state.id === input.initial ? { ...state, label: "Invented state" } : state,
				),
			};
			expect(failed(entry.id, renamed)).toContain("initial-state");
		});
	}

	it("checks a guard, event and action each in its own field", () => {
		const order = scenario("order-lifecycle-state-machine").expectedDiagram;
		const pay = order.transitions.find((t) => t.event === "pay")!;
		expect(
			failed(
				"order-lifecycle-state-machine",
				withTransition(order, pay.id, ({ guard: _guard, ...rest }) => rest),
			),
		).toEqual(["transition:1"]);
		// A guard folded into the event text is not a guard.
		expect(
			failed(
				"order-lifecycle-state-machine",
				withTransition(order, pay.id, ({ guard: _guard, ...rest }) => ({
					...rest,
					event: "pay [card valid]",
				})),
			),
		).toEqual(["transition:1"]);
		expect(
			failed(
				"order-lifecycle-state-machine",
				withTransition(order, pay.id, ({ action: _action, ...rest }) => rest),
			),
		).toEqual(["transition:1"]);
	});

	it("checks composite membership, its initial substate and transitions at its frame", () => {
		const player = scenario("media-player-state-machine").expectedDiagram;
		// Paused drawn outside Active.
		expect(
			failed("media-player-state-machine", {
				...player,
				states: player.states.map(({ parent: _parent, ...state }) =>
					state.id === "paused" ? state : { ...state, ...(_parent ? { parent: _parent } : {}) },
				),
			}),
		).toContain("state-parent:paused");
		// Active starting in Paused.
		expect(
			failed("media-player-state-machine", {
				...player,
				states: player.states.map((state) =>
					state.id === "active" ? { ...state, initial: "paused" } : state,
				),
			}),
		).toEqual(["composite-initial:active"]);
		// Stop drawn from Playing only, not from the composite.
		const stop = player.transitions.find((t) => t.event === "stop")!;
		expect(
			failed(
				"media-player-state-machine",
				withTransition(player, stop.id, (transition) => ({ ...transition, source: "playing" })),
			),
		).toEqual(["transition:5"]);
		// Play aimed at Playing, the substate Active starts in, enters Active all the same.
		const play = player.transitions.find((t) => t.event === "play")!;
		expect(
			failed(
				"media-player-state-machine",
				withTransition(player, play.id, (transition) => ({ ...transition, target: "playing" })),
			),
		).toEqual([]);
		// Aimed at Paused, a substate Active does not start in, it misses Active.
		expect(
			failed(
				"media-player-state-machine",
				withTransition(player, play.id, (transition) => ({ ...transition, target: "paused" })),
			),
		).toEqual(["transition:1"]);
	});

	it("checks self-loops and accepts a labeled final for a named end", () => {
		const turnstile = scenario("turnstile-state-machine").expectedDiagram;
		const alarm = turnstile.transitions.find(
			(t) => t.source === "locked" && t.target === "locked",
		)!;
		expect(
			failed(
				"turnstile-state-machine",
				withTransition(turnstile, alarm.id, (transition) => ({
					...transition,
					target: "unlocked",
				})),
			),
		).toEqual(["transition:2"]);
		// Failed drawn as a state that transitions into an unlabeled final.
		const connection = scenario("connection-retry-state-machine").expectedDiagram;
		const failedState = {
			...connection,
			states: [
				...connection.states.map((state) =>
					state.id === "failed" ? { id: "failed", label: "Failed" } : state,
				),
				{ id: "end", kind: "final" as const },
			],
			transitions: [...connection.transitions, { id: "give-up", source: "failed", target: "end" }],
		};
		expect(failed("connection-retry-state-machine", failedState)).toEqual([]);
	});
});
