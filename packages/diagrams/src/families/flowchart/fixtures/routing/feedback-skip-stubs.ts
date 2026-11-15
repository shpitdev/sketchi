/** Skip routes must not occupy later routes' endpoint stubs after a retry moves sides. */
export default {
	id: "feedback-skip-stubs",
	title: "Retry with skipped stages",
	nodes: [
		{ id: "0", label: "Step 0", kind: "start" },
		{ id: "1", label: "Step 1", kind: "process" },
		{ id: "2", label: "Step 2", kind: "process" },
		{ id: "3", label: "Step 3", kind: "process" },
		{ id: "4", label: "Step 4", kind: "process" },
		{ id: "5", label: "Step 5", kind: "end" },
	],
	edges: [
		{ id: "e0", source: "0", target: "1" },
		{ id: "e1", source: "1", target: "2" },
		{ id: "e2", source: "2", target: "3" },
		{ id: "e3", source: "3", target: "4", label: "Path 3" },
		{ id: "e4", source: "4", target: "5" },
		{ id: "e5", source: "3", target: "5" },
		{ id: "feedback", source: "4", target: "1" },
		{ id: "e7", source: "2", target: "4" },
	],
} as const;
