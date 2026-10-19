/** Handoffs that skip a lane in both directions, a lane with parallel steps, and a single-step lane. */
export default {
	id: "skip-lanes",
	title: "Purchase request",
	lanes: [
		{ id: "requester", label: "Requester" },
		{ id: "procurement", label: "Procurement" },
		{ id: "finance", label: "Finance" },
		{ id: "vendor", label: "Vendor" },
	],
	nodes: [
		{ id: "request", label: "Raise purchase request", kind: "start", lane: "requester" },
		{ id: "budget", label: "Within budget?", kind: "decision", lane: "finance" },
		{ id: "quotes", label: "Collect quotes", kind: "process", lane: "procurement" },
		{ id: "compare", label: "Compare vendors", kind: "process", lane: "procurement" },
		{ id: "terms", label: "Check payment terms", kind: "process", lane: "finance" },
		{ id: "order", label: "Place purchase order", kind: "process", lane: "procurement" },
		{ id: "deliver", label: "Deliver goods", kind: "process", lane: "vendor" },
		{ id: "receive", label: "Receive goods", kind: "end", lane: "requester" },
		{ id: "denied", label: "Request denied", kind: "end", lane: "requester" },
	],
	edges: [
		{ id: "e1", source: "request", target: "budget" },
		{ id: "e2", source: "budget", target: "quotes", label: "yes" },
		{ id: "e3", source: "budget", target: "denied", label: "no" },
		{ id: "e4", source: "quotes", target: "compare" },
		{ id: "e5", source: "quotes", target: "terms" },
		{ id: "e6", source: "compare", target: "order" },
		{ id: "e7", source: "terms", target: "order" },
		{ id: "e8", source: "order", target: "deliver" },
		{ id: "e9", source: "deliver", target: "receive" },
	],
} as const;
