import {
	compositeStateIds,
	parseStateMachineDiagram,
	stateKind,
	stateLabel,
	type StateMachineDiagram,
	type StateMachineState,
	type StateMachineStateKind,
} from "@sketchi/diagram-core";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/**
 * A state the prompt names. A generated state matches when its kind matches
 * and its label contains any alternative, case-insensitively; a final state
 * or a choice may go unlabeled, so one without `labels` matches by kind.
 */
export interface StateMachineScenarioState {
	readonly labels?: readonly string[];
	readonly kind?: StateMachineStateKind;
	/** The composite the prompt puts this state in, by its key. */
	readonly parent?: string;
	/** For a composite: the substate it starts in, by its key. */
	readonly initial?: string;
}

/**
 * A transition the prompt states, between states by key. Each stated part must
 * appear in its own structured field: the event in `event`, the condition in
 * `guard`, the effect in `action`. A transition into or out of a composite
 * must start or end at the composite itself, not one of its substates.
 */
export interface StateMachineScenarioTransition {
	readonly source: string;
	readonly target: string;
	readonly event?: readonly string[];
	readonly guard?: readonly string[];
	readonly action?: readonly string[];
}

export interface StateMachineScenario {
	readonly assertions: {
		/** The key of the state the machine starts in. */
		readonly initial: string;
		readonly states: Readonly<Record<string, StateMachineScenarioState>>;
		readonly transitions: readonly StateMachineScenarioTransition[];
	};
	readonly description: string;
	readonly diagramType: "state-machine";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: StateMachineDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/**
 * Case-insensitive: a phrase ("card valid", "< 3") anywhere in the text, a
 * word of up to three letters ("pay") as a whole word, and a longer word as
 * the start of one ("deliver" matches "Delivered", "connected" does not
 * match "Disconnected").
 */
function matchesAny(text: string | undefined, alternatives: readonly string[]): boolean {
	const normalized = (text ?? "").trim().toLowerCase();
	const words = normalized.split(/[^\p{L}\p{N}]+/u);
	return alternatives.some((alternative) => {
		const expected = alternative.trim().toLowerCase();
		if (!/^[\p{L}\p{N}]+$/u.test(expected)) return normalized.includes(expected);
		return expected.length <= 3
			? words.includes(expected)
			: words.some((word) => word.startsWith(expected));
	});
}

/**
 * A labeled final state reads as that state followed by the end, so a named
 * state matches a labeled final and a named final matches a state that
 * transitions into a final. Unlabeled finals and choices match by kind.
 */
function stateMatches(
	state: StateMachineState,
	expected: StateMachineScenarioState,
	diagram: StateMachineDiagram,
): boolean {
	const kind = stateKind(state);
	if (expected.labels === undefined) return kind === (expected.kind ?? "state");
	if (!matchesAny(stateLabel(state), expected.labels)) return false;
	if (expected.kind === "choice") return kind === "choice";
	if (expected.kind === "final") return kind === "final" || endsIn(state, diagram);
	return kind === "state" || kind === "final";
}

/** A state that ends the machine: a final state, or one with a transition into one. */
function endsIn(state: StateMachineState, diagram: StateMachineDiagram): boolean {
	const finals = new Set(
		diagram.states.flatMap((candidate) => (stateKind(candidate) === "final" ? [candidate.id] : [])),
	);
	return (
		finals.has(state.id) ||
		diagram.transitions.some(
			(transition) => transition.source === state.id && finals.has(transition.target),
		)
	);
}

/**
 * A transition enters the expected state when it targets that state or, for a composite, the
 * substate the composite starts in: entering a composite lands in its initial substate either way.
 */
function entersTarget(
	state: StateMachineState,
	expected: StateMachineScenarioState,
	diagram: StateMachineDiagram,
	byId: ReadonlyMap<string, StateMachineState>,
): boolean {
	if (stateMatches(state, expected, diagram)) return true;
	if (expected.initial === undefined || state.parent === undefined) return false;
	const composite = byId.get(state.parent);
	return (
		composite !== undefined &&
		composite.initial === state.id &&
		stateMatches(composite, expected, diagram)
	);
}

function describe(key: string, expected: StateMachineScenarioState | undefined): string {
	return expected?.labels?.join("|") ?? expected?.kind ?? key;
}

function describeTransition(
	transition: StateMachineScenarioTransition,
	states: StateMachineScenario["assertions"]["states"],
): string {
	const parts = [
		transition.event && `event "${transition.event.join("|")}"`,
		transition.guard && `guard "${transition.guard.join("|")}"`,
		transition.action && `action "${transition.action.join("|")}"`,
	].filter(Boolean);
	return `${describe(transition.source, states[transition.source])} -> ${describe(transition.target, states[transition.target])}${parts.length > 0 ? ` with ${parts.join(", ")}` : ""}`;
}

/**
 * State-machine checks score what the prompt states: each named state (and its
 * composite), the initial state, each composite's initial substate, and each
 * transition between the right states with its event, guard and action in
 * their own fields. Self-loops and final states are transitions like any other.
 */
export function stateMachineScenarioChecks(
	scenario: StateMachineScenario,
	diagram: StateMachineDiagram,
): ScenarioCheck[] {
	const { assertions } = scenario;
	const byId = new Map(diagram.states.map((state) => [state.id, state]));
	const composites = compositeStateIds(diagram);
	const candidates = (key: string) => {
		const expected = assertions.states[key]!;
		return diagram.states.filter((state) => stateMatches(state, expected, diagram));
	};
	const stateChecks = Object.entries(assertions.states).flatMap(([key, expected]) => {
		const matches = candidates(key);
		const parent = expected.parent;
		const placed = matches.filter((state) =>
			parent === undefined
				? state.parent === undefined
				: state.parent !== undefined &&
					stateMatches(byId.get(state.parent) ?? state, assertions.states[parent]!, diagram),
		);
		const checks: ScenarioCheck[] = [
			{
				id: `state:${key}`,
				passed: matches.length > 0,
				message: `Expected a ${expected.kind ?? "state"} like "${describe(key, expected)}".`,
			},
			{
				id: `state-parent:${key}`,
				passed: placed.length > 0,
				message:
					parent === undefined
						? `Expected "${describe(key, expected)}" outside every composite state.`
						: `Expected "${describe(key, expected)}" inside composite "${describe(parent, assertions.states[parent])}".`,
			},
		];
		if (expected.initial !== undefined) {
			const first = assertions.states[expected.initial]!;
			checks.push({
				id: `composite-initial:${key}`,
				passed: matches.some(
					(state) =>
						composites.has(state.id) &&
						state.initial !== undefined &&
						stateMatches(byId.get(state.initial) ?? state, first, diagram),
				),
				message: `Expected composite "${describe(key, expected)}" to start in "${describe(expected.initial, first)}".`,
			});
		}
		return checks;
	});
	const initial = byId.get(diagram.initial);
	const transitionChecks = assertions.transitions.map((expected, index) => {
		const source = assertions.states[expected.source]!;
		const target = assertions.states[expected.target]!;
		// A state that is itself a labeled final already ends the machine.
		const endsHere =
			target.kind === "final" &&
			target.labels === undefined &&
			expected.event === undefined &&
			diagram.states.some(
				(state) =>
					stateKind(state) === "final" &&
					stateLabel(state) !== undefined &&
					stateMatches(state, source, diagram),
			);
		const passed =
			endsHere ||
			diagram.transitions.some(
				(transition) =>
					byId.has(transition.source) &&
					byId.has(transition.target) &&
					stateMatches(byId.get(transition.source)!, source, diagram) &&
					entersTarget(byId.get(transition.target)!, target, diagram, byId) &&
					(expected.source !== expected.target || transition.source === transition.target) &&
					(expected.event === undefined || matchesAny(transition.event, expected.event)) &&
					(expected.guard === undefined || matchesAny(transition.guard, expected.guard)) &&
					(expected.action === undefined || matchesAny(transition.action, expected.action)),
			);
		return {
			id: `transition:${index + 1}`,
			passed,
			message: `Expected a transition ${describeTransition(expected, assertions.states)}.`,
		};
	});
	return [
		...stateChecks,
		{
			id: "initial-state",
			passed:
				initial !== undefined &&
				stateMatches(initial, assertions.states[assertions.initial]!, diagram),
			message: `Expected the machine to start in "${describe(assertions.initial, assertions.states[assertions.initial])}".`,
		},
		...transitionChecks,
	];
}

type StateDefinition = readonly [
	key: string,
	expected: StateMachineScenarioState,
	/** The drawn label, when the expected state has one. */
	label?: string,
];
type TransitionDefinition = readonly [
	expected: StateMachineScenarioTransition,
	drawn?: { readonly event?: string; readonly guard?: string; readonly action?: string },
];

interface StateMachineScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly initial: string;
	readonly states: readonly StateDefinition[];
	readonly transitions: readonly TransitionDefinition[];
}

function defineStateMachineScenario(
	definition: StateMachineScenarioDefinition,
): StateMachineScenario {
	const { initial, states, transitions, ...scenario } = definition;
	const first = (alternatives: readonly string[] | undefined) => alternatives?.[0];
	return {
		...scenario,
		diagramType: "state-machine",
		logos: [],
		assertions: {
			initial,
			states: Object.fromEntries(states.map(([key, expected]) => [key, expected])),
			transitions: transitions.map(([expected]) => expected),
		},
		expectedDiagram: parseStateMachineDiagram({
			id: definition.id,
			title: definition.title,
			type: "state-machine",
			initial,
			states: states.map(([id, expected, label]) => ({
				id,
				...(label ? { label } : {}),
				...(expected.kind ? { kind: expected.kind } : {}),
				...(expected.parent ? { parent: expected.parent } : {}),
				...(expected.initial ? { initial: expected.initial } : {}),
			})),
			transitions: transitions.map(([expected, drawn], index) => {
				const event = drawn?.event ?? first(expected.event);
				const guard = drawn?.guard ?? first(expected.guard);
				const action = drawn?.action ?? first(expected.action);
				return {
					id: `t${index + 1}`,
					source: expected.source,
					target: expected.target,
					...(event ? { event } : {}),
					...(guard ? { guard } : {}),
					...(action ? { action } : {}),
				};
			}),
		}),
	};
}

const stateMachineScenarioDefinitions: readonly StateMachineScenarioDefinition[] = [
	{
		id: "order-lifecycle-state-machine",
		title: "Order lifecycle",
		difficulty: "standard",
		tags: ["state-machine", "lifecycle", "guards", "returns"],
		description:
			"A lifecycle with a guarded payment, cancellations with and without a refund, a return from shipping and three ends.",
		prompt:
			"Draw a state machine for an order lifecycle. An order starts in Pending payment. On pay, guarded by card valid, with action charge card, it moves to Paid. From Pending payment, cancel moves it to Cancelled. From Paid, ship moves it to Shipped, and cancel with action refund payment moves it to Cancelled. From Shipped, deliver moves it to Delivered, and return to sender moves it back to Paid. From Delivered, request return, guarded by within 30 days, with action issue refund, moves it to Refunded. Delivered, Cancelled and Refunded each end the lifecycle.",
		initial: "pending",
		states: [
			["pending", { labels: ["pending"] }, "Pending payment"],
			["paid", { labels: ["paid"] }, "Paid"],
			["shipped", { labels: ["shipped"] }, "Shipped"],
			["delivered", { labels: ["delivered"] }, "Delivered"],
			["cancelled", { labels: ["cancel"] }, "Cancelled"],
			["refunded", { labels: ["refund"] }, "Refunded"],
			["end", { kind: "final" }],
		],
		transitions: [
			[
				{
					source: "pending",
					target: "paid",
					event: ["pay"],
					guard: ["card valid", "valid card"],
					action: ["charge"],
				},
				{ action: "charge card" },
			],
			[{ source: "pending", target: "cancelled", event: ["cancel"] }],
			[{ source: "paid", target: "shipped", event: ["ship"] }],
			[
				{ source: "paid", target: "cancelled", event: ["cancel"], action: ["refund"] },
				{ action: "refund payment" },
			],
			[{ source: "shipped", target: "delivered", event: ["deliver"] }],
			[{ source: "shipped", target: "paid", event: ["return to sender", "returned to sender"] }],
			[
				{
					source: "delivered",
					target: "refunded",
					event: ["return"],
					guard: ["30 days"],
					action: ["refund"],
				},
				{ event: "request return", guard: "within 30 days", action: "issue refund" },
			],
			[{ source: "delivered", target: "end" }],
			[{ source: "cancelled", target: "end" }],
			[{ source: "refunded", target: "end" }],
		],
	},
	{
		id: "media-player-state-machine",
		title: "Media player",
		difficulty: "standard",
		tags: ["state-machine", "composite", "self-loop"],
		description:
			"A composite Active state entered and left at its frame, with its own initial substate and a self-loop inside.",
		prompt:
			"State machine for a media player. It starts Stopped. Play moves it into Active, a composite state that starts in Playing. Inside Active, pause moves Playing to Paused and resume moves Paused back to Playing; seek keeps it in Playing with action jump to position. Stop, from anywhere in Active, returns it to Stopped. Eject from Stopped ends the machine.",
		initial: "stopped",
		states: [
			["stopped", { labels: ["stopped"] }, "Stopped"],
			["active", { labels: ["active"], initial: "playing" }, "Active"],
			["playing", { labels: ["playing"], parent: "active" }, "Playing"],
			["paused", { labels: ["paused"], parent: "active" }, "Paused"],
			["end", { kind: "final" }],
		],
		transitions: [
			[{ source: "stopped", target: "active", event: ["play"] }],
			[{ source: "playing", target: "paused", event: ["pause"] }],
			[{ source: "paused", target: "playing", event: ["resume"] }],
			[
				{ source: "playing", target: "playing", event: ["seek"], action: ["jump"] },
				{ action: "jump to position" },
			],
			[{ source: "active", target: "stopped", event: ["stop"] }],
			[{ source: "stopped", target: "end", event: ["eject"] }],
		],
	},
	{
		id: "turnstile-state-machine",
		title: "Coin turnstile",
		difficulty: "smoke",
		tags: ["state-machine", "self-loop", "guards"],
		description:
			"Two states that move back and forth, each with a self-loop, and a guarded unlock.",
		prompt:
			"Draw the state machine of a coin-operated turnstile. It starts Locked. Inserting a coin, guarded by coin valid, unlocks it with action release the arm, moving it to Unlocked. Pushing while Locked keeps it Locked with action sound the alarm. Inserting a coin while Unlocked keeps it Unlocked with action return the coin. Pushing while Unlocked moves it back to Locked.",
		initial: "locked",
		states: [
			["locked", { labels: ["locked"] }, "Locked"],
			["unlocked", { labels: ["unlocked"] }, "Unlocked"],
		],
		transitions: [
			[
				{
					source: "locked",
					target: "unlocked",
					event: ["coin"],
					guard: ["valid"],
					action: ["release"],
				},
				{ event: "coin", guard: "coin valid", action: "release the arm" },
			],
			[
				{ source: "locked", target: "locked", event: ["push"], action: ["alarm"] },
				{ action: "sound the alarm" },
			],
			[
				{ source: "unlocked", target: "unlocked", event: ["coin"], action: ["return"] },
				{ action: "return the coin" },
			],
			[{ source: "unlocked", target: "locked", event: ["push"] }],
		],
	},
	{
		id: "connection-retry-state-machine",
		title: "Connection with retries",
		difficulty: "challenge",
		tags: ["state-machine", "choice", "composite", "guards"],
		description:
			"A guarded retry choice, a final failure, and a composite Connected state left as a whole.",
		prompt:
			"State machine for a network connection. It starts Disconnected. Connect moves it to Connecting. In Connecting, handshake ok moves it into Connected, a composite state that starts in Idle; timeout moves it to a choice: if retries left, guarded by retries < 3, it goes back to Connecting with action increment retries, otherwise, guarded by no retries left, it goes to Failed, which ends the machine. Inside Connected, start stream moves Idle to Streaming and stop stream moves Streaming back to Idle. Disconnect, from anywhere in Connected, returns it to Disconnected.",
		initial: "disconnected",
		states: [
			["disconnected", { labels: ["disconnected"] }, "Disconnected"],
			["connecting", { labels: ["connecting"] }, "Connecting"],
			["connected", { labels: ["connected"], initial: "idle" }, "Connected"],
			["idle", { labels: ["idle"], parent: "connected" }, "Idle"],
			["streaming", { labels: ["streaming"], parent: "connected" }, "Streaming"],
			["retry", { kind: "choice" }],
			["failed", { labels: ["failed"], kind: "final" }, "Failed"],
		],
		transitions: [
			[{ source: "disconnected", target: "connecting", event: ["connect"] }],
			[
				{ source: "connecting", target: "connected", event: ["handshake"] },
				{ event: "handshake ok" },
			],
			[{ source: "connecting", target: "retry", event: ["timeout"] }],
			[
				{
					source: "retry",
					target: "connecting",
					guard: ["< 3", "retries left"],
					action: ["increment"],
				},
				{ guard: "retries < 3", action: "increment retries" },
			],
			[{ source: "retry", target: "failed", guard: ["no retries"] }, { guard: "no retries left" }],
			[{ source: "idle", target: "streaming", event: ["start"] }, { event: "start stream" }],
			[{ source: "streaming", target: "idle", event: ["stop"] }, { event: "stop stream" }],
			[{ source: "connected", target: "disconnected", event: ["disconnect"] }],
		],
	},
];

export const stateMachineScenarios: readonly StateMachineScenario[] =
	stateMachineScenarioDefinitions.map(defineStateMachineScenario);
