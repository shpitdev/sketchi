import type { RuleSource } from "./source.js";

/** How a request becomes a journey map; see FLOWCHART_RULES. */
export const JOURNEY_RULES = {
	stages: (source: RuleSource) =>
		`Return stages: [{ name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }] in the order ${source} gives them.`,
	score: "score is a whole number from 1 (very negative) to 5 (very positive); 3 is neutral.",
	actors: (source: RuleSource) =>
		`actor is who acts (several who share a step: "Customer, Agent") and touchpoint is the channel (Email, Website, Phone); set the one ${source} states for each step. persona is whose journey it is, with any role ${source} gives; actors lists them when ${source} names several.`,
	notes: (source: RuleSource) =>
		`painPoints and opportunities are short phrases under the stage ${source} puts them in.`,
	copy: (source: RuleSource) =>
		`Copy every stage, step, score, actor, touchpoint, pain point and opportunity ${source} states; invent none.`,
} as const;
