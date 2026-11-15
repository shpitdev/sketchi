/**
 * The expense flow whose receipt request returns to the receipt check: the
 * check sends its two branches out by its side vertices, so the return wound
 * round to the check's far side, beside a branch, instead of rising into its
 * free bottom vertex. From a generated eval sample (Sol, the #538 A/B, sample 3).
 */
export default {
	id: "expense-reimbursement",
	title: "Expense reimbursement",
	nodes: [
		{
			id: "submitted",
			label: "Expense is submitted",
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
			kind: "process",
		},
		{
			id: "check",
			label: "Run a policy check",
			kind: "process",
		},
		{
			id: "policy",
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
			source: "submitted",
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
			source: "request",
			target: "receipt",
		},
		{
			id: "edge-4",
			source: "receipt",
			target: "check",
			label: "Attached",
		},
		{
			id: "edge-5",
			source: "check",
			target: "policy",
		},
		{
			id: "edge-6",
			source: "policy",
			target: "manager",
			label: "Within policy",
		},
		{
			id: "edge-7",
			source: "policy",
			target: "finance",
			label: "Out of policy",
		},
		{
			id: "edge-8",
			source: "finance",
			target: "exception",
		},
		{
			id: "edge-9",
			source: "exception",
			target: "manager",
			label: "Approved",
		},
		{
			id: "edge-10",
			source: "exception",
			target: "reject",
			label: "Rejected",
		},
		{
			id: "edge-11",
			source: "manager",
			target: "payment",
		},
	],
} as const;
