/** An expense approval split across three teams, with a revise loop back into the first team. */
export default {
	id: "grouped-approval",
	title: "Expense approval by team",
	groups: [
		{ id: "employee", label: "Employee" },
		{ id: "manager", label: "Manager" },
		{ id: "finance", label: "Finance" },
	],
	nodes: [
		{ id: "incurred", label: "Expense incurred", kind: "start" },
		{ id: "submit", label: "Submit expense report", kind: "process", group: "employee" },
		{ id: "review", label: "Review the report", kind: "process", group: "manager" },
		{ id: "approved", label: "Approved?", kind: "decision", group: "manager" },
		{ id: "revise", label: "Revise the report", kind: "process", group: "employee" },
		{ id: "verify", label: "Verify receipts", kind: "process", group: "finance" },
		{ id: "pay", label: "Pay the employee", kind: "process", group: "finance" },
		{ id: "paid", label: "Expense paid", kind: "end" },
	],
	edges: [
		{ id: "e1", source: "incurred", target: "submit" },
		{ id: "e2", source: "submit", target: "review" },
		{ id: "e3", source: "review", target: "approved" },
		{ id: "e4", source: "approved", target: "verify", label: "yes" },
		{ id: "e5", source: "approved", target: "revise", label: "no" },
		{ id: "e6", source: "revise", target: "submit" },
		{ id: "e7", source: "verify", target: "pay" },
		{ id: "e8", source: "pay", target: "paid" },
	],
} as const;
