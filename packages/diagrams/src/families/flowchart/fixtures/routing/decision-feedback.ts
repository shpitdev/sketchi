/** A decision's retry branch must keep its own departure side. */
export default {
	id: "decision-feedback",
	title: "Retry a failed attempt",
	nodes: [
		{ id: "start", label: "Start", kind: "start" },
		{ id: "attempt", label: "Attempt", kind: "process" },
		{ id: "check", label: "Success?", kind: "decision" },
		{ id: "done", label: "Done", kind: "end" },
	],
	edges: [
		{ id: "start", source: "start", target: "attempt" },
		{ id: "check", source: "attempt", target: "check" },
		{ id: "yes", source: "check", target: "done", label: "Yes" },
		{ id: "feedback", source: "check", target: "attempt", label: "Retry" },
	],
} as const;
