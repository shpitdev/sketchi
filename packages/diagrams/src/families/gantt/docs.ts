import { GANTT_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Gantt chart", hint: "best for scheduled tasks, dependencies and milestones" },
	summary: "Gantt charts of dated tasks, durations, dependencies and milestones",
	fastPath: `spec: { title, tasks: [{ id, label, start: "YYYY-MM-DD", end? (last day) | duration? (days), milestone?: true, phase?, dependsOn?: [ids finishing first], progress?: % }], phases?, today? }. ${GANTT_RULES.duration}`,
	codeHint: "project schedules",
	catalogOrder: 7,
	fastPathOrder: 5,
	studioOrder: 5,
	toolName: "build_gantt" as const,
	toolDescription:
		"Build and persist a native Gantt chart: tasks with id, label, start (YYYY-MM-DD) and end (last day, inclusive) or duration (calendar days), optional milestone, phase, finish-to-start dependsOn ids and progress percent. The host draws the date axis, rows and dependency arrows. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildGantt",
		kind: "operation" as const,
		title: "buildGantt",
		topic: "buildGantt" as const,
		keywords: [
			"gantt",
			"project plan",
			"schedule",
			"tasks",
			"dependencies",
			"milestones",
			"durations",
			"roadmap",
		],
		snippet:
			"Create a native Gantt chart from dated tasks, durations, dependencies and milestones.",
		content: [
			"buildGantt accepts { spec: { id?, title, tasks: [{ id, label, start, end?, duration?, milestone?, phase?, dependsOn?, progress? }], phases?, today? }, options? }. The renderer owns layout: a to-scale date axis, one row per task under phase headers, and dependency arrows.",
			`${GANTT_RULES.tasks} ${GANTT_RULES.optional(PROMPT)} ${GANTT_RULES.limits}`,
			`${GANTT_RULES.duration} ${GANTT_RULES.copy(PROMPT)} ${GANTT_RULES.conflicts}`,
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "Release plan",
				language: "js" as const,
				code: `async () => sketchi.buildGantt({ spec: { title: "Release plan", tasks: [{ id: "design", label: "Design", start: "2026-03-02", end: "2026-03-06" }, { id: "build", label: "Build", start: "2026-03-09", duration: 10, dependsOn: ["design"] }, { id: "launch", label: "Launch", start: "2026-03-19", milestone: true, dependsOn: ["build"] }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
