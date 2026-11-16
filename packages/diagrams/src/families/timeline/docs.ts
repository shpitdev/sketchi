import { TIMELINE_RULES } from "./rules";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Timeline", hint: "best for dated milestones and chronologies" },
	summary: "dated or ordered events, milestones and phases",
	fastPath: `spec: { title, events: [{ id, label, date?, end?, order?, kind?: "milestone", lane? }], lanes?: string[], today? }. ${TIMELINE_RULES.compact(PROMPT)}`,
	codeHint: "dated or ordered events",
	catalogOrder: 5,
	fastPathOrder: 1,
	studioOrder: 0,
	toolName: "build_timeline" as const,
	toolDescription:
		"Build and persist a native timeline from semantic events with dates or explicit order: optional phases (end), milestones, lanes and a stated today. The host lays out the timeline. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildTimeline",
		kind: "operation" as const,
		title: "buildTimeline",
		topic: "buildTimeline" as const,
		keywords: [
			"timeline",
			"chronology",
			"milestones",
			"dates",
			"events",
			"roadmap",
			"phases",
			"lanes",
		],
		snippet:
			"Create a native timeline from dated milestones, phases, or explicitly ordered events.",
		content: [
			"buildTimeline accepts { spec: { id?, title, events: [{ id, label, date?, end?, order?, kind?, lane?, description? }], lanes?, today? }, options? }. The renderer owns layout: a time-scaled axis, alternating labels and wrapped rows.",
			`${TIMELINE_RULES.precision(PROMPT)} ${TIMELINE_RULES.mode} ${TIMELINE_RULES.noInvention}`,
			`${TIMELINE_RULES.optional(PROMPT)} ${TIMELINE_RULES.ties}`,
			"Results match the other native builders, including a hosted PNG by default in execute.",
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "Launch phases",
				language: "js" as const,
				code: `async () => sketchi.buildTimeline({ spec: { title: "Launch", events: [{ id: "beta", label: "Beta", date: "2026-06-01", end: "2026-07-31" }, { id: "ga", label: "GA", date: "2026-08-04", kind: "milestone" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
