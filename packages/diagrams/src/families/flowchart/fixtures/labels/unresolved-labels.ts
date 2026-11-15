/** Round-3 invoice approval: dash-joined branch labels whose last word is wider than its line. */
export default {
	id: "invoice-approval-flowchart",
	title: "Invoice approval flowchart",
	nodes: [
		{
			id: "received",
			label: "Invoice received",
			kind: "start",
		},
		{
			id: "match",
			label: "Match to purchase order",
			kind: "process",
		},
		{
			id: "matches",
			label: "Matches purchase order?",
			kind: "decision",
		},
		{
			id: "review",
			label: "Exception review",
			kind: "process",
		},
		{
			id: "resolved",
			label: "Exception resolved?",
			kind: "decision",
		},
		{
			id: "reject",
			label: "Reject invoice",
			kind: "end",
		},
		{
			id: "threshold",
			label: "Amount over approval threshold?",
			kind: "decision",
		},
		{
			id: "director",
			label: "Director approval",
			kind: "process",
		},
		{
			id: "schedule",
			label: "Schedule payment",
			kind: "process",
		},
		{
			id: "payment",
			label: "Payment",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "received",
			target: "match",
		},
		{
			id: "edge-2",
			source: "match",
			target: "matches",
		},
		{
			id: "edge-3",
			source: "matches",
			target: "review",
			label: "No",
		},
		{
			id: "edge-4",
			source: "review",
			target: "resolved",
		},
		{
			id: "edge-5",
			source: "resolved",
			target: "reject",
			label: "No — unresolved",
		},
		{
			id: "edge-6",
			source: "resolved",
			target: "threshold",
			label: "Yes — resolved",
		},
		{
			id: "edge-7",
			source: "matches",
			target: "threshold",
			label: "Yes — matched",
		},
		{
			id: "edge-8",
			source: "threshold",
			target: "director",
			label: "Yes — over threshold",
		},
		{
			id: "edge-9",
			source: "threshold",
			target: "schedule",
			label: "No — at or below threshold",
		},
		{
			id: "edge-10",
			source: "director",
			target: "schedule",
		},
		{
			id: "edge-11",
			source: "schedule",
			target: "payment",
		},
	],
	layout: {
		direction: "TB",
	},
} as const;
