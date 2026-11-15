/** Stress case: every node in one group, including a retry loop. */
export default {
	id: "single-group",
	title: "Payment retries inside the billing service",
	groups: [{ id: "billing", label: "Billing service" }],
	nodes: [
		{ id: "charge", label: "Charge the card", kind: "start", group: "billing" },
		{ id: "ok", label: "Charge succeeded?", kind: "decision", group: "billing" },
		{ id: "wait", label: "Wait and retry", kind: "process", group: "billing" },
		{ id: "receipt", label: "Send receipt", kind: "end", group: "billing" },
	],
	edges: [
		{ id: "e1", source: "charge", target: "ok" },
		{ id: "e2", source: "ok", target: "receipt", label: "yes" },
		{ id: "e3", source: "ok", target: "wait", label: "no" },
		{ id: "e4", source: "wait", target: "ok" },
	],
} as const;
