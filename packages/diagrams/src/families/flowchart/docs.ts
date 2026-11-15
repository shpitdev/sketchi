import { FLOWCHART_NODE_COLOR_NAMES } from "../../families/flowchart/document.js";
import { FLOWCHART_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;
const FLOWCHART_COLORS = FLOWCHART_NODE_COLOR_NAMES.map((name) => `"${name}"`).join(" | ");
const FLOWCHART_SPEC = `spec: { title, direction?: "TB" | "LR", curved?: true, logos?: true | "exact", nodes: { [id]: label | { label, note?, shape?: "database" | "queue" | "document" | "storage" | "diamond", icon?: name | null, color?: ${FLOWCHART_COLORS} (only when asked), group?: id, lane?: id } }, edges: [[from, to, label?]] (ends may list ids), groups?: { [id]: { label, kind?, contains?: [ids] } }, lanes?: { [id]: label } }`;
const FLOWCHART_DOC_RULES = [
	[
		"Pass { spec, request }: request is the prompt, verbatim; the build lists what it misses.",
		"Each coverage issue names a stated arrow, step or zone the accepted diagram lacks; one editFlowchart adds it.",
	],
	[FLOWCHART_RULES.separateNodes(PROMPT)],
	[FLOWCHART_RULES.statedChecks],
	[FLOWCHART_RULES.labelWords(PROMPT)],
	[FLOWCHART_RULES.labelForm],
	[FLOWCHART_RULES.labelScope(PROMPT)],
	[FLOWCHART_RULES.namedOutcomes(PROMPT)],
	[FLOWCHART_RULES.documentRoles(PROMPT)],
	[FLOWCHART_RULES.documentNoInventedSteps(PROMPT)],
	[FLOWCHART_RULES.documentBranches(PROMPT)],
	[
		FLOWCHART_RULES.documentLoops,
		"A loop with no way out fails with nonterminating_node; a retry loop that keeps an exit is valid.",
	],
	[FLOWCHART_RULES.technologyLabels],
	[FLOWCHART_RULES.documentGroups(PROMPT)],
	[FLOWCHART_RULES.documentLanes(PROMPT)],
	[
		FLOWCHART_RULES.documentLogos(PROMPT),
		"The logo is drawn above the label. An icon naming no logo is dropped with an unknown_icon warning, and a vendor's logo on a label that does not name the vendor with icon_dropped; neither fails the build.",
	],
	[
		FLOWCHART_RULES.documentDirection(PROMPT),
		`${FLOWCHART_RULES.documentCurved(PROMPT)} Curved lines follow the routes square ones take, so none runs through a node, along another line or through a label.`,
	],
	[FLOWCHART_RULES.limits, FLOWCHART_RULES.limitsDetail],
	[FLOWCHART_RULES.summarize],
	[FLOWCHART_RULES.layers],
	[FLOWCHART_RULES.keepNamed(PROMPT)],
];
const flowchartDocs = (requestType: string) =>
	[
		"buildFlowchart accepts the flowchart document: title, nodes and edges, with optional direction, curved, logos, groups and lanes. Builds use the fixed Sketchi palette.",
		FLOWCHART_RULES.documentShape,
		...FLOWCHART_DOC_RULES.map(([rule, detail]) => (detail ? `${rule} ${detail}` : rule)),
		"",
		requestType,
	].join("\n");
const HOSTED_APP_LOGOS_EXAMPLE = `async () => sketchi.buildFlowchart({
  spec: {
    title: "Next.js page on Vercel",
    logos: true,
    nodes: {
      host: "Vercel routes the request",
      page: "Next.js page receives question",
      done: "Return answer"
    },
    edges: [["host", "page"], ["page", "done"]]
  },
  options: ${DELIVERY_OPTIONS}
})`;
export const docs = {
	choice: { label: "Flowchart", hint: "best for processes and decisions" },
	summary:
		"process steps and decisions, how systems or packages interact, and nested architecture zones",
	fastPath: undefined,
	codeHint: undefined,
	catalogOrder: 2,
	fastPathOrder: -1,
	studioOrder: 2,
	toolName: "build_flowchart" as const,
	toolDescription:
		"Build and persist one canonical flowchart artifact. Pass { spec } with the flowchart document: nodes as { id: label }, edges as [from, to, label?], optional groups and lanes that list what they contain. The host supplies artifact options and the user's request. If rejected, repair every structured issue and retry, up to three total attempts.",
	spec: FLOWCHART_SPEC,
	rules: FLOWCHART_DOC_RULES,
	entry: (requestType: string) => ({
		id: "buildFlowchart",
		kind: "operation" as const,
		title: "buildFlowchart",
		topic: "buildFlowchart" as const,
		keywords: [
			"build",
			"flowchart",
			"flowcharts",
			"node",
			"edge",
			"graph",
			"acceptance",
			"nonterminating",
			"cycle",
			"limit",
			"bounded",
			"24",
			"64",
			"architecture",
			"packages",
			"system",
			"request",
		],
		snippet: "Create the semantic flowchart first. Fix issues before styling or shape changes.",
		content: flowchartDocs(requestType),
		examples: [
			{
				title: "Separate application and hosting logos",
				language: "js" as const,
				code: HOSTED_APP_LOGOS_EXAMPLE,
			},
		],
	}),
};
