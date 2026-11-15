/** A direct retry must clear the intermediate stage as well as its bound nodes. */
export default {
	id: "feedback-chain",
	title: "Repeat inspection",
	nodes: [
		{ id: "start", label: "Received", kind: "start" },
		{ id: "a", label: "Prepare", kind: "process" },
		{ id: "b", label: "Inspect", kind: "process" },
		{ id: "c", label: "Approve", kind: "process" },
		{ id: "end", label: "Released", kind: "end" },
	],
	edges: [
		{ id: "start", source: "start", target: "a" },
		{ id: "ab", source: "a", target: "b" },
		{ id: "bc", source: "b", target: "c" },
		{ id: "ca", source: "c", target: "a", label: "Retry" },
		{ id: "end", source: "c", target: "end" },
	],
} as const;
