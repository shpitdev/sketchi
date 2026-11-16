import { MINDMAP_RULES } from "./rules";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Mind map", hint: "best for ideas and topics" },
	summary: "a nested topic hierarchy",
	fastPath: `spec: { title, root: { label, children?: [{ label, children? }] }, layout?: { direction: "LR" | "RL" } }. ${MINDMAP_RULES.order}`,
	codeHint: undefined,
	catalogOrder: 4,
	fastPathOrder: 4,
	studioOrder: 3,
	toolName: "build_mindmap" as const,
	toolDescription:
		"Build and persist a native mindmap: a title and one root topic, each topic { label, children }. The host lays out the radial tree. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildMindmap",
		kind: "operation" as const,
		title: "buildMindmap",
		topic: "buildMindmap" as const,
		keywords: ["build", "mindmap", "topic", "hierarchy", "tree", "branch"],
		snippet: "Create a mindmap from a semantic nested topic hierarchy.",
		content: [
			"buildMindmap accepts a semantic MindmapDocument with one nested root topic. Do not supply coordinates, edges, or Excalidraw JSON. Builds use the fixed Sketchi palette.",
			"The semantic-input restriction does not limit outputs: scene, Excalidraw, and PNG remain intentional output formats selected through artifact options.",
			"Children remain in caller order and receive deterministic path identifiers such as topic-0-1-0.",
			"Use nested children to express branches and depth. The public boundary supports LR or RL hierarchy layout.",
			"If buildMindmap returns ok: false, repair the hierarchy from its typed issues and retry before patching.",
			"",
			requestType,
		].join("\n"),
		examples: [
			{
				title: "Product launch mindmap",
				language: "js" as const,
				code: `async () => sketchi.buildMindmap({\n  spec: {\n    title: "Product launch",\n    root: { label: "Launch", children: [\n      { label: "Product", children: [{ label: "Scope" }, { label: "Quality" }] },\n      { label: "Go to market", children: [{ label: "Docs" }, { label: "Enablement" }] }\n    ] }\n  },\n  options: ${DELIVERY_OPTIONS}\n})`,
			},
		],
	}),
};
