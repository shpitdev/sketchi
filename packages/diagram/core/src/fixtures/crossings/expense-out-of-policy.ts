/** An expense flow whose short out-of-policy branch once set its label so close beside its line that the arrowhead's wing touched the text. From a live eval sample (Sol, round 20). */
export default {
	id: "expense-reimbursement",
	title: "Expense reimbursement",
	nodes: [
		{
			id: "submit",
			label: "An expense is submitted",
			kind: "start",
		},
		{
			id: "receipt",
			label: "Receipt attached?",
			kind: "decision",
		},
		{
			id: "request",
			label: "Request a receipt",
			kind: "end",
		},
		{
			id: "policy",
			label: "Run a policy check",
			kind: "process",
		},
		{
			id: "within",
			label: "Within policy?",
			kind: "decision",
		},
		{
			id: "manager",
			label: "Manager approval",
			kind: "process",
		},
		{
			id: "payment",
			label: "Payment",
			kind: "end",
		},
		{
			id: "finance",
			label: "Finance exception review",
			kind: "process",
		},
		{
			id: "exception",
			label: "Exception approved?",
			kind: "decision",
		},
		{
			id: "reject",
			label: "Reject the expense",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "submit",
			target: "receipt",
		},
		{
			id: "edge-2",
			source: "receipt",
			target: "request",
			label: "Missing",
		},
		{
			id: "edge-3",
			source: "receipt",
			target: "policy",
			label: "Attached",
		},
		{
			id: "edge-4",
			source: "policy",
			target: "within",
		},
		{
			id: "edge-5",
			source: "within",
			target: "manager",
			label: "Within policy",
		},
		{
			id: "edge-6",
			source: "within",
			target: "finance",
			label: "Out of policy",
		},
		{
			id: "edge-7",
			source: "finance",
			target: "exception",
		},
		{
			id: "edge-8",
			source: "exception",
			target: "manager",
			label: "Approved",
		},
		{
			id: "edge-9",
			source: "exception",
			target: "reject",
			label: "Rejected",
		},
		{
			id: "edge-10",
			source: "manager",
			target: "payment",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
