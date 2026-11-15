/** Incident response across three actors, with a handoff that skips a lane and a mitigation loop back across lanes. */
export default {
	id: "incident-response-lanes",
	title: "Incident response",
	lanes: [
		{ id: "oncall", label: "On-call" },
		{ id: "sre", label: "SRE" },
		{ id: "comms", label: "Comms" },
	],
	nodes: [
		{ id: "alert", label: "Alert fires", kind: "start", lane: "oncall" },
		{ id: "triage", label: "Triage the alert", kind: "process", lane: "oncall" },
		{ id: "page", label: "Page the SRE", kind: "process", lane: "oncall" },
		{ id: "status", label: "Post status update", kind: "process", lane: "comms" },
		{ id: "investigate", label: "Investigate", kind: "process", lane: "sre" },
		{ id: "mitigate", label: "Apply mitigation", kind: "process", lane: "sre" },
		{ id: "resolved", label: "Resolved?", kind: "decision", lane: "oncall" },
		{ id: "close", label: "Publish resolution", kind: "end", lane: "comms" },
	],
	edges: [
		{ id: "e1", source: "alert", target: "triage" },
		{ id: "e2", source: "triage", target: "page" },
		{ id: "e3", source: "page", target: "investigate" },
		{ id: "e4", source: "investigate", target: "mitigate" },
		{ id: "e5", source: "mitigate", target: "status" },
		{ id: "e6", source: "status", target: "resolved" },
		{ id: "e7", source: "resolved", target: "investigate", label: "no" },
		{ id: "e8", source: "resolved", target: "close", label: "yes" },
	],
} as const;
