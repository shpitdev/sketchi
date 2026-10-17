/** A rejected review returns to an earlier process beside its forward branch. */
export default {
	id: "review-feedback",
	title: "Review feedback",
	nodes: [
		{ id: "start", label: "Received", kind: "start" },
		{ id: "prepare", label: "Prepare submission", kind: "process" },
		{ id: "review", label: "Ready?", kind: "decision" },
		{ id: "revise", label: "Request changes", kind: "process" },
		{ id: "done", label: "Accepted", kind: "end" },
	],
	edges: [
		{ id: "start", source: "start", target: "prepare" },
		{ id: "review", source: "prepare", target: "review" },
		{ id: "no", source: "review", target: "revise", label: "No" },
		{ id: "feedback", source: "revise", target: "prepare", label: "Changes ready" },
		{ id: "yes", source: "review", target: "done", label: "Yes" },
	],
} as const;
