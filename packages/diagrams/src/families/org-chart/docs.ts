import { ORG_CHART_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Org chart", hint: "best for people, titles and who reports to whom" },
	summary: "org charts of people, titles and reporting lines",
	fastPath: `spec: { title, people: [{ id, name, title?, department?, manager?, assistant?: true }], dottedLines?: [{ report, manager, label?: stated scope }], groupByDepartment? }. ${ORG_CHART_RULES.managerCompact}`,
	codeHint: undefined,
	catalogOrder: 12,
	fastPathOrder: 8,
	studioOrder: 8,
	toolName: "build_org_chart" as const,
	toolDescription:
		"Build and persist a native org chart: one card per person with their name, title and department, each manager above the reports they lead, long lists of reports stacked in columns, assistants beside their manager, and dotted-line (matrix) reports dashed. Give each person an id, name and manager, with optional title, department, assistant: true and avatar: true; add dottedLines: [{ report, manager }] for secondary reports and groupByDepartment: true for department regions. The host lays out the chart. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildOrgChart",
		kind: "operation" as const,
		title: "buildOrgChart",
		topic: "buildOrgChart" as const,
		keywords: [
			"org chart",
			"organization chart",
			"team structure",
			"reporting line",
			"hierarchy",
			"manager",
			"direct reports",
			"dotted line",
		],
		snippet: "Create a native org chart from people, their titles and the managers they report to.",
		content: [
			"buildOrgChart accepts { spec: { id?, title, people: [{ id, name, title?, department?, manager?, assistant?, avatar? }], dottedLines?: [{ id?, report, manager, label? }], groupByDepartment?, forest? }, options? }. The renderer draws each person as a card of name, title and department, managers above the reports their bus line feeds, long lists of reports stacked in one or two columns, and each department in a color of its own.",
			[
				ORG_CHART_RULES.manager(PROMPT),
				ORG_CHART_RULES.noCycles,
				ORG_CHART_RULES.assistant,
				ORG_CHART_RULES.avatar,
				ORG_CHART_RULES.ids,
			].join(" "),
			`${ORG_CHART_RULES.dottedLines(PROMPT)} ${ORG_CHART_RULES.groupByDepartment}`,
			ORG_CHART_RULES.copy(PROMPT),
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "A startup with an assistant and a dotted line",
				language: "js" as const,
				code: `async () => sketchi.buildOrgChart({ spec: { title: "Startup team", people: [{ id: "ceo", name: "Ada Lovelace", title: "CEO" }, { id: "ea", name: "Grace Hopper", title: "Executive Assistant", manager: "ceo", assistant: true }, { id: "cto", name: "Alan Turing", title: "CTO", department: "Engineering", manager: "ceo" }, { id: "dev", name: "Ken Thompson", title: "Engineer", department: "Engineering", manager: "cto" }, { id: "cpo", name: "Radia Perlman", title: "CPO", department: "Product", manager: "ceo" }], dottedLines: [{ report: "dev", manager: "cpo", label: "platform roadmap" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
