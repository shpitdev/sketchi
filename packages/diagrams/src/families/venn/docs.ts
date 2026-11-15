import { VENN_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Venn diagram", hint: "best for what two or three overlapping sets share" },
	summary: "Venn diagrams of what overlapping sets share",
	fastPath: `spec: { title, sets: [{ id, label }], regions: [{ sets: [ids], items?: string[], count? }] }. ${VENN_RULES.regionsCompact}`,
	codeHint: undefined,
	catalogOrder: 13,
	fastPathOrder: 9,
	studioOrder: 9,
	toolName: "build_venn_diagram" as const,
	toolDescription:
		"Build and persist a native Venn diagram: two or three equal, overlapping translucent circles, each set's label outside its circle, and each region's items or count inside exactly that region. Give sets: [{ id, label }] and regions: [{ sets, items }], one region per overlap. The host lays out the circles and sizes them to fit. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildVennDiagram",
		kind: "operation" as const,
		title: "buildVennDiagram",
		topic: "buildVennDiagram" as const,
		keywords: ["venn", "venn diagram", "overlap", "intersection", "shared", "in common", "sets"],
		snippet: "Create a native Venn diagram from two or three sets and the items in each region.",
		content: [
			"buildVennDiagram accepts { spec: { id?, title, sets: [{ id, label, color? }], regions?: [{ sets, label?, items?, count? }] }, options? }. The renderer draws two or three equal, overlapping translucent circles, each set's label outside its circle, and each region's items, one per line, centred inside exactly that region; it sizes the circles until every region's text fits.",
			`${VENN_RULES.regions} ${VENN_RULES.contents(PROMPT)} ${VENN_RULES.color}`,
			VENN_RULES.copy(PROMPT),
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "Two sets and their overlap",
				language: "js" as const,
				code: `async () => sketchi.buildVennDiagram({ spec: { title: "iOS vs Android", sets: [{ id: "ios", label: "iOS" }, { id: "android", label: "Android" }], regions: [{ sets: ["ios"], items: ["Apple Pay"] }, { sets: ["android"], items: ["Google Pay"] }, { sets: ["ios", "android"], items: ["Push notifications", "Dark mode"] }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
