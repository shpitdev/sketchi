/** Every step in one lane: a plain flow in one band. */
export default {
	id: "single-lane",
	title: "Ticket handling",
	lanes: [{ id: "support", label: "Support desk" }],
	nodes: [
		{ id: "open", label: "Ticket opened", kind: "start", lane: "support" },
		{ id: "answer", label: "Answer the customer", kind: "process", lane: "support" },
		{ id: "solved", label: "Solved?", kind: "decision", lane: "support" },
		{ id: "escalate", label: "Escalate", kind: "process", lane: "support" },
		{ id: "close", label: "Close the ticket", kind: "end", lane: "support" },
	],
	edges: [
		{ id: "e1", source: "open", target: "answer" },
		{ id: "e2", source: "answer", target: "solved" },
		{ id: "e3", source: "solved", target: "close", label: "yes" },
		{ id: "e4", source: "solved", target: "escalate", label: "no" },
		{ id: "e5", source: "escalate", target: "answer" },
	],
} as const;
