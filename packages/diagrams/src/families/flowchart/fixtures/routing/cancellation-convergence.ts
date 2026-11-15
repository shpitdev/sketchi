/** Two No branches from different decisions converge on one step without sharing an approach. */
export default {
	id: "cancellation-convergence",
	title: "Subscription cancellation",
	nodes: [
		{ id: "requested", label: "Member requests cancellation", kind: "start" },
		{ id: "reason", label: "Collect the cancellation reason", kind: "process" },
		{ id: "eligible", label: "Eligible for a retention offer?", kind: "decision" },
		{ id: "offer", label: "Present retention offer", kind: "process" },
		{ id: "accepted", label: "Offer accepted?", kind: "decision" },
		{ id: "keep", label: "Retain member", kind: "end" },
		{ id: "confirm", label: "Confirm cancellation", kind: "process" },
		{ id: "close", label: "Close account", kind: "end" },
	],
	edges: [
		{ id: "record", source: "requested", target: "reason" },
		{ id: "check", source: "reason", target: "eligible" },
		{ id: "offer-save", source: "eligible", target: "offer", label: "Yes" },
		{ id: "not-eligible", source: "eligible", target: "confirm", label: "No" },
		{ id: "decide", source: "offer", target: "accepted" },
		{ id: "kept", source: "accepted", target: "keep", label: "Yes" },
		{ id: "declined", source: "accepted", target: "confirm", label: "No" },
		{ id: "close-account", source: "confirm", target: "close" },
	],
} as const;
