import { STATE_MACHINE_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "State machine", hint: "best for states, events and lifecycles" },
	summary: "states and the events, guards and actions that move between them",
	fastPath: `spec: { title, initial: top-level start state, states: [{ id, label? (defaults to id), kind?: "final" | "choice", parent?: compositeId, initial?: substateId }], transitions: [{ source, target, event?, guard?, action? }] }. A composite (a state named as parent) sets its own initial to its first substate; composites do not nest. Each transition out of a choice has a guard, without brackets: ${STATE_MACHINE_RULES.guards(PROMPT)} ${STATE_MACHINE_RULES.endsLifecycle}`,
	codeHint: undefined,
	catalogOrder: 8,
	fastPathOrder: 3,
	studioOrder: 4,
	toolName: "build_state_machine" as const,
	toolDescription:
		'Build and persist a native state machine: states, the initial state, and transitions labeled by event, guard and action. kind "final" ends the machine, kind "choice" branches on guards, and a state named as parent groups its substates into a composite with its own initial. Transitions may enter or leave a composite or return to their own state. The host lays out the machine. Repair structured issues, up to three total attempts.',

	entry: (requestType: string) => ({
		id: "buildStateMachine",
		kind: "operation" as const,
		title: "buildStateMachine",
		topic: "buildStateMachine" as const,
		keywords: [
			"state machine",
			"state diagram",
			"states",
			"transitions",
			"lifecycle",
			"events",
			"guards",
			"statechart",
		],
		snippet: "Create a native state machine from states and the transitions between them.",
		content: [
			`buildStateMachine accepts { spec: { id?, title, initial, states: [{ id, label?, kind?, parent?, initial? }], transitions: [{ id?, source, target, event?, guard?, action? }], layout?: { direction } }, options? }. ${STATE_MACHINE_RULES.layout}`,
			[
				STATE_MACHINE_RULES.ids,
				STATE_MACHINE_RULES.label,
				STATE_MACHINE_RULES.initial,
				STATE_MACHINE_RULES.kinds(PROMPT),
				STATE_MACHINE_RULES.composite,
			].join(" "),
			`${STATE_MACHINE_RULES.transitions} ${STATE_MACHINE_RULES.reachable} ${STATE_MACHINE_RULES.endsLifecycle}`,
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "Media player with a composite state",
				language: "js" as const,
				code: `async () => sketchi.buildStateMachine({ spec: { title: "Media player", initial: "stopped", states: [{ id: "stopped", label: "Stopped" }, { id: "active", label: "Active", initial: "playing" }, { id: "playing", label: "Playing", parent: "active" }, { id: "paused", label: "Paused", parent: "active" }, { id: "ejected", kind: "final" }], transitions: [{ source: "stopped", target: "active", event: "play" }, { source: "playing", target: "paused", event: "pause" }, { source: "paused", target: "playing", event: "resume" }, { source: "playing", target: "playing", event: "seek", action: "jump" }, { source: "active", target: "stopped", event: "stop" }, { source: "stopped", target: "ejected", event: "eject", guard: "tray open" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
