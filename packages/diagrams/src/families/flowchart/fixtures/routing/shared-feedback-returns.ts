/** Several returns share an earlier stage; its final departure/arrival ports must stay distinct. */
export default {
	id: "shared-feedback-returns",
	title: "Revisit earlier checks",
	nodes: [
		{ id: "start", label: "Received", kind: "start" },
		{ id: "a", label: "Intake", kind: "process" },
		{ id: "b", label: "Inspect", kind: "process" },
		{ id: "c", label: "Review", kind: "process" },
		{ id: "d", label: "Approve", kind: "process" },
		{ id: "end", label: "Released", kind: "end" },
	],
	edges: [
		{ id: "entry", source: "start", target: "a" },
		{ id: "ab", source: "a", target: "b" },
		{ id: "bc", source: "b", target: "c" },
		{ id: "cd", source: "c", target: "d" },
		{ id: "release", source: "d", target: "end" },
		{ id: "ba", source: "b", target: "a" },
		{ id: "ca", source: "c", target: "a", label: "Retry" },
		{ id: "da", source: "d", target: "a" },
	],
} as const;
