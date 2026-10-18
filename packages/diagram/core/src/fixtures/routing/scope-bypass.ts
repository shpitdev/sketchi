/**
 * A decision's bypass branch and the straight path meet at one end node. The
 * bypass leaves a side vertex, so it must land on that side of the straight
 * arrival instead of crossing it. Five short steps stay in one column.
 */
export default {
	id: "scope-bypass",
	title: "Diagram request",
	nodes: [
		{ id: "received", label: "Prompt received", kind: "start" },
		{ id: "requirements", label: "Extract requirements", kind: "process" },
		{ id: "scope", label: "Is the scope clear?", kind: "decision" },
		{ id: "draft", label: "Draft typed IR", kind: "process" },
		{ id: "review", label: "Review", kind: "end" },
	],
	edges: [
		{ id: "extract", source: "received", target: "requirements" },
		{ id: "assess", source: "requirements", target: "scope" },
		{ id: "clear", source: "scope", target: "draft", label: "Yes" },
		{ id: "unclear", source: "scope", target: "review", label: "No" },
		{ id: "submit", source: "draft", target: "review" },
	],
} as const;
