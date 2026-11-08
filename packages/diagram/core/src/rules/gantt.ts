import { GANTT_MAX_PHASES, GANTT_MAX_TASKS } from "../types/gantt.js";
import type { RuleSource } from "./source.js";

/** How a request becomes a Gantt chart; see FLOWCHART_RULES. */
export const GANTT_RULES = {
	tasks:
		"Return tasks with unique id, label, start (YYYY-MM-DD), and end (last day, inclusive) or duration (calendar days counting start). A milestone is milestone: true with start only. Never supply coordinates.",
	duration: "Pass a stated duration as duration, not a computed end.",
	optional: (source: RuleSource) =>
		`Optional: dependsOn lists the ids of tasks that must finish first; phase names a header for every task only when ${source} itself names phases; otherwise omit it (phases sets their order); progress is percent complete; today only when stated.`,
	dependencies: (source: RuleSource) =>
		`Set dependsOn only where ${source} states that a task waits for another, as an after or depends-on column or wording such as "after X" or "once X is done". Tasks that only follow one another in date order depend on nothing.`,
	listedTasks: (source: RuleSource) =>
		`A list in ${source} headed "phases:" or "milestones:" names tasks, not the phase headers they sit under.`,
	limits: `Use 1–${GANTT_MAX_TASKS} tasks, at most ${GANTT_MAX_PHASES} phases, and no dependency cycles.`,
	copy: (source: RuleSource) =>
		`Copy every task, date, dependency, milestone and phase from ${source}; invent none.`,
	conflicts:
		"A task that starts before a predecessor finishes still builds, with a gantt_schedule_conflict warning.",
} as const;
