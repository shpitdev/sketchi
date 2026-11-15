import { SANKEY_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Sankey diagram", hint: "best for budgets, traffic and funnels that flow" },
	summary: "Sankey diagrams of weighted flows between stages",
	fastPath: `spec: { title, nodes: [{ id, label }], links: [{ source, target, value, label? }], unit? ("$k", "visits") }. ${SANKEY_RULES.flows}`,
	codeHint: undefined,
	catalogOrder: 15,
	fastPathOrder: 11,
	studioOrder: 11,
	toolName: "build_sankey" as const,
	toolDescription:
		"Build and persist a native Sankey diagram of weighted flows: budgets, traffic, funnels with drop-offs, energy or material flows. Give nodes [{ id, label }] and links [{ source, target, value }] with every stated amount (value > 0), an optional label per link, and an optional unit. The host lays out columns, bars as tall as each node's total and bands as wide as each value, and writes every total and value. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildSankey",
		kind: "operation" as const,
		title: "buildSankey",
		topic: "buildSankey" as const,
		keywords: [
			"sankey",
			"flow diagram",
			"budget flow",
			"funnel",
			"traffic sources",
			"energy flow",
			"drop-off",
			"alluvial",
		],
		snippet: "Create a native Sankey diagram from nodes and the weighted flows between them.",
		content: [
			"buildSankey accepts { spec: { id?, title, nodes: [{ id, label, color? }], links: [{ source, target, value, label? }], unit? }, options? }. The renderer owns layout: each node one column past the longest run of links into it, a bar as tall as the larger of its inflow and outflow with its label and total, and each link a band as wide as its value in its source's color, with its value written. A band under 3 px draws at 3 px; its value stays exact.",
			[
				SANKEY_RULES.links,
				SANKEY_RULES.optional,
				SANKEY_RULES.copy,
				SANKEY_RULES.structure,
				SANKEY_RULES.unit,
				SANKEY_RULES.dropOff(PROMPT),
			].join(" "),
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "A cloud budget from departments to services",
				language: "js" as const,
				code: `async () => sketchi.buildSankey({ spec: { title: "Cloud budget", unit: "$k", nodes: [{ id: "eng", label: "Engineering" }, { id: "data", label: "Data" }, { id: "compute", label: "Compute" }, { id: "storage", label: "Storage" }], links: [{ source: "eng", target: "compute", value: 310 }, { source: "eng", target: "storage", value: 45 }, { source: "data", target: "compute", value: 140 }, { source: "data", target: "storage", value: 4 }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
