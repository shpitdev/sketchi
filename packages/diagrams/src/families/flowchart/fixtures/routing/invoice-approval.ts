export default {
	id: "invoice-approval",
	title: "Invoice approval",
	nodes: [
		{
			id: "received",
			label: "Invoice received",
			kind: "start",
		},
		{
			id: "match_po",
			label: "Match invoice to purchase order",
			kind: "process",
		},
		{
			id: "po_matched",
			label: "Invoice matches PO?",
			kind: "decision",
		},
		{
			id: "exception_review",
			label: "Route to exception review",
			kind: "process",
		},
		{
			id: "exception_resolved",
			label: "Exception resolved?",
			kind: "decision",
		},
		{
			id: "reject",
			label: "Reject invoice",
			kind: "end",
		},
		{
			id: "over_threshold",
			label: "Amount over approval threshold?",
			kind: "decision",
		},
		{
			id: "director_approval",
			label: "Director approval before payment",
			kind: "process",
		},
		{
			id: "schedule_payment",
			label: "Schedule payment",
			kind: "process",
		},
		{
			id: "paid",
			label: "Payment scheduled",
			kind: "end",
		},
	],
	edges: [
		{
			id: "e1",
			source: "received",
			target: "match_po",
		},
		{
			id: "e2",
			source: "match_po",
			target: "po_matched",
		},
		{
			id: "e3",
			source: "po_matched",
			target: "over_threshold",
			label: "Yes",
		},
		{
			id: "e4",
			source: "po_matched",
			target: "exception_review",
			label: "No",
		},
		{
			id: "e5",
			source: "exception_review",
			target: "exception_resolved",
		},
		{
			id: "e6",
			source: "exception_resolved",
			target: "over_threshold",
			label: "Yes",
		},
		{
			id: "e7",
			source: "exception_resolved",
			target: "reject",
			label: "No",
		},
		{
			id: "e8",
			source: "over_threshold",
			target: "director_approval",
			label: "Yes",
		},
		{
			id: "e9",
			source: "over_threshold",
			target: "schedule_payment",
			label: "No",
		},
		{
			id: "e10",
			source: "director_approval",
			target: "schedule_payment",
		},
		{
			id: "e11",
			source: "schedule_payment",
			target: "paid",
		},
	],
	layout: {
		direction: "TB",
	},
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
