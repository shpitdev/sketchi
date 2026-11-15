/**
 * Stress case: a group whose members sit far apart in the flow, so edges leave
 * it and come back, plus a long group label and a one-node group.
 */
export default {
	id: "scattered-members",
	title: "Incident handling across on-call and support",
	groups: [
		{ id: "support", label: "Customer support desk and escalation team" },
		{ id: "oncall", label: "On-call" },
		{ id: "comms", label: "Comms" },
	],
	nodes: [
		{ id: "report", label: "Customer reports issue", kind: "start", group: "support" },
		{ id: "triage", label: "Triage the report", kind: "process", group: "support" },
		{ id: "outage", label: "Outage?", kind: "decision" },
		{ id: "page", label: "Page on-call", kind: "process", group: "oncall" },
		{ id: "mitigate", label: "Mitigate impact", kind: "process", group: "oncall" },
		{ id: "fixed", label: "Fixed?", kind: "decision", group: "oncall" },
		{ id: "status", label: "Post status update", kind: "process", group: "comms" },
		{ id: "reply", label: "Reply to customer", kind: "process", group: "support" },
		{ id: "closed", label: "Ticket closed", kind: "end", group: "support" },
	],
	edges: [
		{ id: "e1", source: "report", target: "triage" },
		{ id: "e2", source: "triage", target: "outage" },
		{ id: "e3", source: "outage", target: "page", label: "yes" },
		{ id: "e4", source: "outage", target: "reply", label: "no" },
		{ id: "e5", source: "page", target: "mitigate" },
		{ id: "e6", source: "mitigate", target: "fixed" },
		{ id: "e7", source: "fixed", target: "status", label: "yes" },
		{ id: "e8", source: "fixed", target: "mitigate", label: "not yet" },
		{ id: "e9", source: "status", target: "reply" },
		{ id: "e10", source: "reply", target: "closed" },
	],
} as const;
