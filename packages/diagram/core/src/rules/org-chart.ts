import type { RuleSource } from "./source.js";

/** How a request becomes an org chart; see FLOWCHART_RULES. */
export const ORG_CHART_RULES = {
	manager: (source: RuleSource) =>
		`manager is the id of the person they report to; exactly one person, the top, has none, unless ${source} states separate trees (then set forest: true).`,
	/** The execute code parameter's form of `manager`. */
	managerCompact:
		"manager is the id they report to; only the top person has none (forest: true for several).",
	ids: "Ids hold no colon.",
	noCycles: "No reporting line may cycle.",
	assistant:
		"assistant: true places an assistant beside their manager; an assistant has no reports.",
	avatar: "avatar: true draws an initials placeholder.",
	dottedLines: (source: RuleSource) =>
		`Return dottedLines: [{ id, report, manager, label? }] for each dotted-line or matrix report ${source} states: report also answers to manager, outside the solid line. Put the scope or reason ${source} gives for it ("for clinical systems") in label.`,
	groupByDepartment:
		"groupByDepartment: true draws each department below the top as a labeled region.",
	groupOnlyWhenAsked: (source: RuleSource) =>
		`Set groupByDepartment: true only when ${source} asks to group departments into regions.`,
	copy: (source: RuleSource) =>
		`Copy every person, title, department, reporting line and dotted line ${source} states; invent none.`,
} as const;
