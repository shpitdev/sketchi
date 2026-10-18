/**
 * Seven stages in a line with a label on every handoff. A single LR row runs
 * about 22:1 and a TB column about 4:1, so either wraps into bands.
 */
export default {
	id: "package-chain",
	title: "Request to hosted artifact",
	nodes: [
		{ id: "app", label: "App request", kind: "start" },
		{ id: "agent", label: "Agent / orchestration", kind: "process" },
		{ id: "core", label: "Core diagram model", kind: "process" },
		{ id: "renderer", label: "Renderer", kind: "process" },
		{ id: "export", label: "Excalidraw export", kind: "process" },
		{ id: "host", label: "Artifact hosting / storage", kind: "process" },
		{ id: "response", label: "Hosted artifact response", kind: "end" },
	],
	edges: [
		{ id: "request", source: "app", target: "agent", label: "Request contract" },
		{ id: "build", source: "agent", target: "core", label: "Semantic builder input" },
		{ id: "validate", source: "core", target: "renderer", label: "Validated diagram spec" },
		{ id: "render", source: "renderer", target: "export", label: "CanvasSpec scene" },
		{ id: "store", source: "export", target: "host", label: "Exported artifact bundle" },
		{ id: "respond", source: "host", target: "response", label: "Artifact ID + hosted URLs" },
	],
} as const;
