/**
 * Expense approval across three team groups, read left to right, whose
 * rejected report goes straight back for review once revised. Drawn as one
 * row of groups it ran 4.26:1. From a generated eval sample (Sonnet, round 25,
 * sample 3).
 */
export default {
	id: "expense-approval-process",
	title: "Expense Approval Process",
	nodes: [
		{
			id: "submit",
			label: "Employee submits expense report",
			kind: "start",
			group: "emp",
		},
		{
			id: "review",
			label: "Manager reviews the report",
			kind: "process",
			group: "mgr",
		},
		{
			id: "approved",
			label: "Is the report approved?",
			kind: "decision",
			group: "mgr",
		},
		{
			id: "revise",
			label: "Employee revises the report",
			kind: "process",
			group: "emp",
		},
		{
			id: "verify",
			label: "Finance verifies the receipts",
			kind: "process",
			group: "fin",
		},
		{
			id: "pay",
			label: "Finance pays the employee",
			kind: "end",
			group: "fin",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "submit",
			target: "review",
		},
		{
			id: "edge-2",
			source: "review",
			target: "approved",
		},
		{
			id: "edge-3",
			source: "approved",
			target: "verify",
			label: "yes",
		},
		{
			id: "edge-4",
			source: "approved",
			target: "revise",
			label: "no",
		},
		{
			id: "edge-5",
			source: "revise",
			target: "review",
			label: "resubmit",
		},
		{
			id: "edge-6",
			source: "verify",
			target: "pay",
		},
	],
	groups: [
		{
			id: "emp",
			label: "Employee",
		},
		{
			id: "mgr",
			label: "Manager",
		},
		{
			id: "fin",
			label: "Finance",
		},
	],
} as const;
