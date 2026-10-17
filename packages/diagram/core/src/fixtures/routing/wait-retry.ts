/** A later decision retries an earlier branching decision. */
export default {
	id: "wait-retry",
	title: "Wait and retry",
	nodes: [
		{ id: "start", label: "Join queue", kind: "start" },
		{ id: "responds", label: "Responds?", kind: "decision" },
		{ id: "leave", label: "Leave queue", kind: "end" },
		{ id: "ready", label: "Ready?", kind: "decision" },
		{ id: "done", label: "Continue", kind: "end" },
		{ id: "wait", label: "Keep waiting", kind: "process" },
	],
	edges: [
		{ id: "start", source: "start", target: "responds" },
		{ id: "leave", source: "responds", target: "leave", label: "No" },
		{ id: "ready", source: "responds", target: "ready", label: "Yes" },
		{ id: "done", source: "ready", target: "done", label: "Yes" },
		{ id: "wait", source: "ready", target: "wait", label: "No" },
		{ id: "feedback", source: "wait", target: "responds" },
	],
} as const;
