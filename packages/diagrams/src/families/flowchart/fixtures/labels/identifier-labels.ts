/**
 * Identifiers, a URL, CJK and emoji in node and branch labels: words stay whole, long tokens
 * break at boundaries.
 */
export default {
	id: "identifier-labels",
	title: "Identifier labels",
	nodes: [
		{
			id: "call",
			label: "buildSequenceDiagram",
			kind: "start",
		},
		{
			id: "check",
			label: "Layout renderer-independent?",
			kind: "decision",
		},
		{
			id: "export",
			label: "exportToExcalidrawScene(spec)",
			kind: "process",
		},
		{
			id: "fetch",
			label: "Fetch https://playground.sketchi.app/api/v1/artifacts/download",
			kind: "process",
		},
		{
			id: "cjk",
			label: "品質保証レビュー承認待ち",
			kind: "process",
		},
		{
			id: "done",
			label: "Ship 🚀 release",
			kind: "end",
		},
	],
	edges: [
		{
			id: "e1",
			source: "call",
			target: "check",
		},
		{
			id: "e2",
			source: "check",
			target: "export",
			label: "renderer-independent",
		},
		{
			id: "e3",
			source: "check",
			target: "fetch",
			label: "buildSequenceDiagram",
		},
		{
			id: "e4",
			source: "export",
			target: "cjk",
			label: "品質保証レビュー承認待ち",
		},
		{
			id: "e5",
			source: "fetch",
			target: "done",
			label: "https://example.com/api/v1/artifacts/download",
		},
		{
			id: "e6",
			source: "cjk",
			target: "done",
			label: "🚀🚀 shipped",
		},
	],
	layout: {
		direction: "TB",
	},
} as const;
