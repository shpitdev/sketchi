import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const stateMachineDiagramType = "state-machine" as const;

/**
 * A named state, an unlabeled final state (drawn as a bullseye) or a choice
 * pseudostate (a diamond whose outgoing transitions carry guards).
 */
export const STATE_MACHINE_STATE_KINDS = ["state", "final", "choice"] as const;
export const STATE_MACHINE_DIRECTIONS = ["TB", "LR"] as const;

/** Larger machines stop reading as one diagram; split them instead. */
export const STATE_MACHINE_MAX_STATES = 30;
export const STATE_MACHINE_MAX_TRANSITIONS = 60;
export const STATE_MACHINE_MAX_COMPOSITES = 6;
export const STATE_MACHINE_MAX_ISSUES = 20;

export const StateMachineStateKindSchema = Schema.Literals(STATE_MACHINE_STATE_KINDS);
export type StateMachineStateKind = typeof StateMachineStateKindSchema.Type;

/**
 * One state. A state that other states name as `parent` is a composite: it is
 * drawn as a frame around them, and its `initial` names the substate it enters
 * first. Composites hold states but never another composite.
 */
export class StateMachineState extends Schema.Class<StateMachineState>("StateMachineState")({
	id: Schema.NonEmptyString,
	/** Omitted labels default to the id verbatim for regular states only. */
	label: Schema.optionalKey(Schema.NonEmptyString),
	kind: Schema.optionalKey(StateMachineStateKindSchema),
	/** The composite state this state belongs to. */
	parent: Schema.optionalKey(Schema.NonEmptyString),
	/** For a composite: the substate a transition into the composite enters. */
	initial: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const StateMachineStateSchema = StateMachineState;

/**
 * A transition, drawn with one compact label `event [guard] / action`. Every
 * part is optional; a transition without any is a completion transition. A
 * transition may leave or enter a composite, and may return to its own state.
 */
export class StateMachineTransition extends Schema.Class<StateMachineTransition>(
	"StateMachineTransition",
)({
	id: Schema.NonEmptyString,
	source: Schema.NonEmptyString,
	target: Schema.NonEmptyString,
	event: Schema.optionalKey(Schema.NonEmptyString),
	guard: Schema.optionalKey(Schema.NonEmptyString),
	action: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const StateMachineTransitionSchema = StateMachineTransition;

export class StateMachineLayout extends Schema.Class<StateMachineLayout>("StateMachineLayout")({
	direction: Schema.Literals(STATE_MACHINE_DIRECTIONS),
}) {}

/**
 * The canonical state machine: states (some composite), the state the machine
 * starts in, and transitions. Every surface that accepts, generates, renders
 * or evaluates a state machine uses this shape.
 */
export class StateMachineDiagram extends Schema.Class<StateMachineDiagram>("StateMachineDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(stateMachineDiagramType),
	/** The top-level state the initial pseudostate points to. */
	initial: Schema.NonEmptyString,
	states: Schema.Array(StateMachineState).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	transitions: Schema.Array(StateMachineTransition).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
	/** Omit to let the renderer pick the direction that reads best. */
	layout: Schema.optionalKey(StateMachineLayout),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const StateMachineDiagramSchema = StateMachineDiagram;

export const StateMachineValidationIssueCodeSchema = Schema.Literals([
	"state_machine_too_large",
	"invalid_state_id",
	"duplicate_state_id",
	"duplicate_transition_id",
	"missing_state_label",
	"unknown_initial_state",
	"unknown_parent_state",
	"nested_composite",
	"missing_transition_source",
	"missing_transition_target",
	"final_has_outgoing",
	"composite_member_transition",
	"missing_composite_initial",
	"underbranched_choice",
	"unguarded_choice_branch",
	"unreachable_state",
]);
export type StateMachineValidationIssueCode = typeof StateMachineValidationIssueCodeSchema.Type;

export class StateMachineValidationIssue extends Schema.Class<StateMachineValidationIssue>(
	"StateMachineValidationIssue",
)({
	code: StateMachineValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `states.[1].parent`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}

/** The kind a state draws as; states default to "state". */
export function stateKind(state: Pick<StateMachineState, "kind">): StateMachineStateKind {
	return state.kind ?? "state";
}

/** The displayed label, matching class/ER names without humanizing ids or rewriting explicit labels. */
export function stateLabel(
	state: Pick<StateMachineState, "id" | "label" | "kind">,
): string | undefined {
	return state.label ?? (stateKind(state) === "state" ? state.id : undefined);
}

/** Ids of the composite states: states some other state names as its parent. */
export function compositeStateIds(diagram: Pick<StateMachineDiagram, "states">): Set<string> {
	return new Set(diagram.states.flatMap((state) => (state.parent ? [state.parent] : [])));
}

/** A guard reads in brackets and an action after a slash; authored ones may carry them already. */
function bare(text: string, pattern: RegExp): string {
	return text.replace(pattern, "").trim();
}

/** One compact label for a transition: `event [guard] / action`, each part optional. */
export function stateTransitionLabel(
	transition: Pick<StateMachineTransition, "action" | "event" | "guard">,
): string {
	const guard = transition.guard ? bare(transition.guard, /^\s*\[|\]\s*$/gu) : "";
	const action = transition.action ? bare(transition.action, /^\s*\//u) : "";
	return [transition.event?.trim(), guard && `[${guard}]`, action && `/ ${action}`]
		.filter(Boolean)
		.join(" ");
}

/**
 * States a run can be in: from the initial state, along transitions. Entering a
 * composite enters its initial substate. Being in a substate is being in its
 * composite, which can then take the composite's own transitions, but that
 * never enters the composite's initial substate.
 */
function reachableStates(diagram: StateMachineDiagram): Set<string> {
	const states = new Map(diagram.states.map((state) => [state.id, state]));
	const reached = new Set<string>();
	const entered = new Set<string>();
	const queue: { readonly id: string; readonly entry: boolean }[] = [
		{ id: diagram.initial, entry: true },
	];
	while (queue.length > 0) {
		const { id, entry } = queue.pop()!;
		const state = states.get(id);
		if (!state || (reached.has(id) && (!entry || entered.has(id)))) continue;
		if (entry) {
			entered.add(id);
			if (state.initial) queue.push({ id: state.initial, entry: true });
		}
		if (reached.has(id)) continue;
		reached.add(id);
		if (state.parent) queue.push({ id: state.parent, entry: false });
		for (const transition of diagram.transitions)
			if (transition.source === id) queue.push({ id: transition.target, entry: true });
	}
	return reached;
}

export function getStateMachineValidationIssues(
	diagram: StateMachineDiagram,
): StateMachineValidationIssue[] {
	const issues: StateMachineValidationIssue[] = [];
	const composites = compositeStateIds(diagram);
	if (diagram.states.length > STATE_MACHINE_MAX_STATES) {
		issues.push({
			code: "state_machine_too_large",
			path: "states",
			message: `State machine has ${diagram.states.length} states; the supported maximum is ${STATE_MACHINE_MAX_STATES}.`,
			hint: "Split the machine into smaller machines or merge minor states.",
		});
	}
	if (diagram.transitions.length > STATE_MACHINE_MAX_TRANSITIONS) {
		issues.push({
			code: "state_machine_too_large",
			path: "transitions",
			message: `State machine has ${diagram.transitions.length} transitions; the supported maximum is ${STATE_MACHINE_MAX_TRANSITIONS}.`,
			hint: "Move transitions every substate shares onto their composite state.",
		});
	}
	if (composites.size > STATE_MACHINE_MAX_COMPOSITES) {
		issues.push({
			code: "state_machine_too_large",
			path: "states",
			message: `State machine has ${composites.size} composite states; the supported maximum is ${STATE_MACHINE_MAX_COMPOSITES}.`,
			hint: "Flatten minor composite states into their parents.",
		});
	}

	const states = new Map<string, StateMachineState>();
	diagram.states.forEach((state, index) => {
		if (state.id.includes(":")) {
			issues.push({
				code: "invalid_state_id",
				path: `states.[${index}].id`,
				message: `State id "${state.id}" contains ":".`,
				hint: "Use letters, digits, hyphens or underscores in state ids.",
			});
		}
		if (states.has(state.id)) {
			issues.push({
				code: "duplicate_state_id",
				path: `states.[${index}].id`,
				message: `State id "${state.id}" is used more than once.`,
				hint: "Give every state a unique id.",
			});
		}
		states.set(state.id, state);
		const label = stateLabel(state);
		if (label !== undefined && !label.trim()) {
			issues.push({
				code: "missing_state_label",
				path: `states.[${index}].label`,
				message: `State "${state.id}" has no label.`,
				hint: "Omit the label to use the default, or provide a non-blank label.",
			});
		}
	});

	diagram.states.forEach((state, index) => {
		if (state.parent !== undefined) {
			const parent = states.get(state.parent);
			if (!parent || stateKind(parent) !== "state") {
				issues.push({
					code: "unknown_parent_state",
					path: `states.[${index}].parent`,
					message: `State "${state.id}" names "${state.parent}" as its parent, which is not a state.`,
					hint: "Set parent to the id of a state (not a final state or choice), or remove it.",
				});
			} else if (parent.parent !== undefined) {
				issues.push({
					code: "nested_composite",
					path: `states.[${index}].parent`,
					message: `State "${state.id}" sits in "${parent.id}", which itself sits in "${parent.parent}".`,
					hint: "Composite states hold states but not other composites; flatten one level.",
				});
			}
		}
		if (state.initial !== undefined) {
			const child = states.get(state.initial);
			if (!child || child.parent !== state.id || stateKind(child) === "final") {
				issues.push({
					code: "unknown_initial_state",
					path: `states.[${index}].initial`,
					message: `Composite "${state.id}" starts in "${state.initial}", which is not one of its substates.`,
					hint: `Set initial to a substate whose parent is "${state.id}", or remove it.`,
				});
			}
		}
	});

	const initial = states.get(diagram.initial);
	if (initial && composites.has(initial.id) && initial.initial === undefined) {
		issues.push({
			code: "missing_composite_initial",
			path: "initial",
			message: `The machine starts in composite "${initial.id}", which has no initial substate.`,
			hint: `Set initial on "${initial.id}" to the substate it starts in.`,
		});
	}
	if (!initial || initial.parent !== undefined || stateKind(initial) === "final") {
		issues.push({
			code: "unknown_initial_state",
			path: "initial",
			message: `The machine starts in "${diagram.initial}", which is not a top-level state.`,
			hint: "Set initial to the id of the top-level state the machine starts in.",
		});
	}

	const transitionIds = new Set<string>();
	const outgoing = new Map<string, number>();
	diagram.transitions.forEach((transition, index) => {
		if (transitionIds.has(transition.id)) {
			issues.push({
				code: "duplicate_transition_id",
				path: `transitions.[${index}].id`,
				message: `Transition id "${transition.id}" is used more than once.`,
				hint: "Give every transition a unique id, or omit ids to generate them.",
			});
		}
		transitionIds.add(transition.id);
		outgoing.set(transition.source, (outgoing.get(transition.source) ?? 0) + 1);
		const source = states.get(transition.source);
		const target = states.get(transition.target);
		if (!source) {
			issues.push({
				code: "missing_transition_source",
				path: `transitions.[${index}].source`,
				message: `Transition "${transition.id}" leaves "${transition.source}", which is not a state.`,
				hint: "Set source to the id of a declared state.",
			});
		}
		if (!target) {
			issues.push({
				code: "missing_transition_target",
				path: `transitions.[${index}].target`,
				message: `Transition "${transition.id}" enters "${transition.target}", which is not a state.`,
				hint: "Set target to the id of a declared state.",
			});
		}
		if (source && stateKind(source) === "final") {
			issues.push({
				code: "final_has_outgoing",
				path: `transitions.[${index}].source`,
				message: `Transition "${transition.id}" leaves final state "${source.id}".`,
				hint: "A final state ends the machine; leave from the state before it instead.",
			});
		}
		if (
			source &&
			target &&
			((composites.has(source.id) && (target.id === source.id || target.parent === source.id)) ||
				(composites.has(target.id) && source.parent === target.id))
		) {
			issues.push({
				code: "composite_member_transition",
				path: `transitions.[${index}]`,
				message: `Transition "${transition.id}" joins composite "${composites.has(source.id) ? source.id : target.id}" to itself or its own substate.`,
				hint: "Connect substates to each other, or the composite to a state outside it.",
			});
		}
		if (target && composites.has(target.id) && target.initial === undefined) {
			issues.push({
				code: "missing_composite_initial",
				path: `transitions.[${index}].target`,
				message: `Transition "${transition.id}" enters composite "${target.id}", which has no initial substate.`,
				hint: `Set initial on "${target.id}" to the substate it enters first, or target that substate.`,
			});
		}
	});

	diagram.states.forEach((state, index) => {
		if (stateKind(state) === "choice" && (outgoing.get(state.id) ?? 0) < 2) {
			issues.push({
				code: "underbranched_choice",
				path: `states.[${index}]`,
				message: `Choice "${state.id}" has fewer than two outgoing transitions.`,
				hint: "Give a choice two or more outgoing transitions, each with a guard.",
			});
		}
		if (stateKind(state) !== "choice") return;
		const guards = diagram.transitions
			.filter((transition) => transition.source === state.id)
			.map((transition) => transition.guard?.replace(/^\s*\[|\]\s*$/gu, "").trim() ?? "");
		if (
			guards.some((guard) => guard === "") ||
			guards.filter((guard) => guard.toLowerCase() === "else").length > 1
		)
			issues.push({
				code: "unguarded_choice_branch",
				path: `states.[${index}]`,
				message: `Choice "${state.id}" has a branch without its own guard.`,
				hint: 'Give every branch of a choice a guard; one may be "else".',
			});
	});

	if (initial) {
		const reached = reachableStates(diagram);
		diagram.states.forEach((state, index) => {
			if (!reached.has(state.id)) {
				issues.push({
					code: "unreachable_state",
					path: `states.[${index}]`,
					message: `State "${state.id}" cannot be reached from the initial state.`,
					hint: "Add a transition into it, or make it its composite's initial substate.",
				});
			}
		});
	}
	return issues.slice(0, STATE_MACHINE_MAX_ISSUES);
}

export class StateMachineValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly StateMachineValidationIssue[]) {
		super(issues[0]?.message ?? "State machine failed semantic validation.");
		this.name = "StateMachineValidationError";
	}
}

export function validateStateMachineDiagram(diagram: StateMachineDiagram): StateMachineDiagram {
	const issues = getStateMachineValidationIssues(diagram);
	if (issues.length > 0) {
		throw new StateMachineValidationError(issues);
	}
	return diagram;
}

export function parseStateMachineDiagram(input: unknown): StateMachineDiagram {
	return validateStateMachineDiagram(
		Schema.decodeUnknownSync(StateMachineDiagram, { errors: "all" })(input),
	);
}

/** An order lifecycle: a guarded payment, a self-loop, a return pair and cancellation. */
export const stateMachineFixture = parseStateMachineDiagram({
	id: "order-lifecycle",
	title: "Order lifecycle",
	type: stateMachineDiagramType,
	initial: "pending",
	states: [
		{ id: "pending", label: "Pending payment" },
		{ id: "paid", label: "Paid" },
		{ id: "shipped", label: "Shipped" },
		{ id: "cancelled", label: "Cancelled" },
		{ id: "done", kind: "final" },
	],
	transitions: [
		{
			id: "pay",
			source: "pending",
			target: "paid",
			event: "pay",
			guard: "card valid",
			action: "charge",
		},
		{ id: "remind", source: "pending", target: "pending", event: "after 24h", action: "email" },
		{ id: "cancel", source: "pending", target: "cancelled", event: "cancel" },
		{ id: "ship", source: "paid", target: "shipped", event: "ship" },
		{ id: "reject", source: "shipped", target: "paid", event: "reject shipment" },
		{ id: "deliver", source: "shipped", target: "done", event: "deliver" },
		{ id: "close", source: "cancelled", target: "done" },
	],
});

/** A media player whose Active composite starts in Playing and stops from either substate. */
export const mediaPlayerStateMachine = parseStateMachineDiagram({
	id: "media-player",
	title: "Media player",
	type: stateMachineDiagramType,
	initial: "stopped",
	states: [
		{ id: "stopped", label: "Stopped" },
		{ id: "active", label: "Active", initial: "playing" },
		{ id: "playing", label: "Playing", parent: "active" },
		{ id: "paused", label: "Paused", parent: "active" },
	],
	transitions: [
		{ id: "play", source: "stopped", target: "active", event: "play" },
		{ id: "pause", source: "playing", target: "paused", event: "pause" },
		{ id: "resume", source: "paused", target: "playing", event: "resume" },
		{ id: "seek", source: "playing", target: "playing", event: "seek", action: "jump" },
		{ id: "stop", source: "active", target: "stopped", event: "stop" },
	],
});
