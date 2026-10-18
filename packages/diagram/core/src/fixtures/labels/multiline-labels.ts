/**
 * Multiword branch labels that wrap, authored line breaks, and a labeled retry loop back to an
 * earlier step.
 */
export default {
	id: "multiline-labels",
	title: "Multi-line labels",
	nodes: [
		{
			id: "request",
			label: "Refund requested",
			kind: "start",
		},
		{
			id: "eligible",
			label: "Refund within the policy window?",
			kind: "decision",
		},
		{
			id: "provider",
			label: "Ask the payment provider",
			kind: "process",
		},
		{
			id: "confirmed",
			label: "Provider confirmed?",
			kind: "decision",
		},
		{
			id: "refund",
			label: "Issue the refund",
			kind: "process",
		},
		{
			id: "deny",
			label: "Explain the decision to the customer",
			kind: "end",
		},
		{
			id: "closed",
			label: "Refund closed",
			kind: "end",
		},
	],
	edges: [
		{
			id: "e1",
			source: "request",
			target: "eligible",
		},
		{
			id: "e2",
			source: "eligible",
			target: "provider",
			label: "Yes, within the window and eligible for a full refund",
		},
		{
			id: "e3",
			source: "eligible",
			target: "deny",
			label: "No — outside\nthe policy window",
		},
		{
			id: "e4",
			source: "provider",
			target: "confirmed",
			label: "Request sent to the provider",
		},
		{
			id: "e5",
			source: "confirmed",
			target: "refund",
			label: "Confirmed by the provider",
		},
		{
			id: "e6",
			source: "confirmed",
			target: "provider",
			label: "Retry after the provider\nconfirms the hold",
		},
		{
			id: "e7",
			source: "refund",
			target: "closed",
		},
	],
	layout: {
		direction: "TB",
	},
} as const;
