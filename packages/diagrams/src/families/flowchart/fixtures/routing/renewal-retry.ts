/** A centered spine into a process that a later decision loops back to. */
export default {
	id: "renewal-retry",
	title: "Subscription renewal",
	nodes: [
		{ id: "due", label: "Renewal due", kind: "start" },
		{ id: "charge", label: "Charge payment", kind: "process" },
		{ id: "paid", label: "Payment succeeded?", kind: "decision" },
		{ id: "renew", label: "Renew subscription", kind: "end" },
		{ id: "remind", label: "Send reminder", kind: "process" },
		{ id: "updated", label: "Payment updated?", kind: "decision" },
		{ id: "pause", label: "Pause subscription", kind: "end" },
	],
	edges: [
		{ id: "bill", source: "due", target: "charge" },
		{ id: "confirm", source: "charge", target: "paid" },
		{ id: "renewed", source: "paid", target: "renew", label: "Yes" },
		{ id: "declined", source: "paid", target: "remind", label: "No" },
		{ id: "wait", source: "remind", target: "updated" },
		{ id: "retry", source: "updated", target: "charge", label: "Yes" },
		{ id: "expired", source: "updated", target: "pause", label: "No" },
	],
} as const;
