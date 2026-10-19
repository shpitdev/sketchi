/** Expense approval in three team groups with a rejection loop back into the employee's group. From a generated eval sample. */
export default {
	id: "expense-approval-process",
	title: "Expense Approval Process",
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
			label: "Is it approved?",
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
			label: "Rejected",
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
			label: "Approved",
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
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
