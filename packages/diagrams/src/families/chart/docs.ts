import { CHART_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Chart", hint: "best for bar, line and pie charts of numbers" },
	summary: "bar, line or pie charts of numbers across categories",
	fastPath: `spec: { title, kind: "bar" | "line" | "pie", categories: string[], series: [{ name?, values: number[] }], unit? ("$M", "%"), categoryAxisTitle?, valueAxisTitle?, stacked? (bar), donut? (pie), orientation? ("horizontal", bar) }. ${CHART_RULES.series} ${CHART_RULES.pieCompact}`,
	codeHint: undefined,
	catalogOrder: 6,
	fastPathOrder: 0,
	studioOrder: 1,
	toolName: "build_chart" as const,
	toolDescription:
		"Build and persist a native bar, line or pie chart from categories and named series of numbers. The host draws axes, ticks, labels and legend. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildChart",
		kind: "operation" as const,
		title: "buildChart",
		topic: "buildChart" as const,
		keywords: [
			"chart",
			"bar",
			"line",
			"pie",
			"donut",
			"graph",
			"plot",
			"data",
			"values",
			"percent",
		],
		snippet: "Create a native bar, line or pie chart from categories and series of numbers.",
		content: [
			"buildChart accepts { spec: { id?, title, kind, categories, series: [{ name?, values }], unit?, categoryAxisTitle?, valueAxisTitle?, stacked?, donut?, orientation? }, options? }. The renderer owns layout: nice ticks, value labels, legend and pie leader lines.",
			CHART_RULES.kinds,
			`${CHART_RULES.categories} ${CHART_RULES.limits}`,
			`${CHART_RULES.copy(PROMPT)} ${CHART_RULES.noRounding} ${CHART_RULES.unit}`,
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "Grouped bars",
				language: "js" as const,
				code: `async () => sketchi.buildChart({ spec: { title: "Quarterly revenue", kind: "bar", categories: ["Q1", "Q2"], series: [{ name: "2025", values: [42, 51] }, { name: "2026", values: [48, 57] }], unit: "$M", valueAxisTitle: "Revenue" }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
