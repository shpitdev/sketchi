/**
 * Expense approval across three team groups, read left to right, with a
 * rejection that the employee revises and resubmits. Drawn as one row of
 * groups it ran 4.96:1. From a generated eval sample (Sol, round 25, sample 4).
 */
export default {
	id: "expense-approval-process-by-team",
	title: "Expense Approval Process by Team",
	nodes: [
		{
			id: "submit",
			label: "Employee submits an expense report",
			kind: "start",
			group: "employee",
		},
		{
			id: "review",
			label: "Manager reviews the report",
			kind: "process",
			group: "manager",
		},
		{
			id: "approved",
			label: "Is the report approved?",
			kind: "decision",
			group: "manager",
		},
		{
			id: "revise",
			label: "Employee revises the report",
			kind: "process",
			group: "employee",
		},
		{
			id: "resubmit",
			label: "Employee resubmits it for review",
			kind: "process",
			group: "employee",
		},
		{
			id: "verify",
			label: "Finance verifies the receipts",
			kind: "process",
			group: "finance",
		},
		{
			id: "pay",
			label: "Finance pays the employee",
			kind: "end",
			group: "finance",
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
			target: "revise",
			label: "No — rejected",
		},
		{
			id: "edge-4",
			source: "revise",
			target: "resubmit",
		},
		{
			id: "edge-5",
			source: "resubmit",
			target: "review",
		},
		{
			id: "edge-6",
			source: "approved",
			target: "verify",
			label: "Yes — approved",
		},
		{
			id: "edge-7",
			source: "verify",
			target: "pay",
		},
	],
	groups: [
		{
			id: "employee",
			label: "Employee",
		},
		{
			id: "manager",
			label: "Manager",
		},
		{
			id: "finance",
			label: "Finance",
		},
	],
} as const;
