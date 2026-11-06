import type { RuleSource } from "./source.js";

const guards = (source: RuleSource) =>
	`copy each guard ${source} states; use "else" only for a branch ${source} gives no condition.`;

/** How a request becomes a state machine; see FLOWCHART_RULES. */
export const STATE_MACHINE_RULES = {
	ids: 'Every state has a unique id without ":".',
	label: "A regular state label defaults to its id verbatim; explicit labels must not be blank.",
	initial: "initial is the top-level state the machine starts in.",
	kinds: (source: RuleSource) =>
		`kind "final" ends the machine: name it when it is a named outcome (for example Failed); generic ends need no name; kind "choice" is a branch point whose outgoing transitions each carry a guard: ${guards(source)}`,
	guards,
	composite:
		"A composite state is a state other states name as parent; give it initial, the substate it starts in. Composites do not nest.",
	transitions:
		"Every transition has a unique id, source, target, and optional event, guard (the condition, without brackets) and action. A transition may leave or enter a composite, or return to its own state.",
	reachable: "Every state must be reachable from initial.",
	/** Sketchi splits such a state into the state and its own end (splitContinuingFinalStates). */
	endsLifecycle:
		'A state that ends the lifecycle is "final" even if something leaves it; Sketchi then draws its own end after it.',
	layout: "Omit layout to let the renderer pick LR or TB.",
} as const;
