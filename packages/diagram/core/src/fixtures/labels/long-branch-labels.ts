/**
 * Round-3 loan underwriting: decision branches labeled with whole words wider than a diamond
 * label line.
 */
export default {
	id: "loan-application-underwriting",
	title: "Loan Application Underwriting",
	nodes: [
		{
			id: "submitted",
			label: "Application submitted",
			kind: "start",
		},
		{
			id: "identity",
			label: "Verify identity",
			kind: "process",
		},
		{
			id: "identity_decision",
			label: "Identity verified?",
			kind: "decision",
		},
		{
			id: "identity_decline",
			label: "Decline application",
			kind: "end",
		},
		{
			id: "credit",
			label: "Credit review",
			kind: "process",
		},
		{
			id: "credit_decision",
			label: "Acceptable credit?",
			kind: "decision",
		},
		{
			id: "manual",
			label: "Manual underwriting",
			kind: "process",
		},
		{
			id: "exception",
			label: "Exception approved?",
			kind: "decision",
		},
		{
			id: "exception_decline",
			label: "Decline application",
			kind: "end",
		},
		{
			id: "income",
			label: "Income verification",
			kind: "process",
		},
		{
			id: "approved",
			label: "Approve loan",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "submitted",
			target: "identity",
		},
		{
			id: "edge-2",
			source: "identity",
			target: "identity_decision",
		},
		{
			id: "edge-3",
			source: "identity_decision",
			target: "identity_decline",
			label: "Failed",
		},
		{
			id: "edge-4",
			source: "identity_decision",
			target: "credit",
			label: "Verified",
		},
		{
			id: "edge-5",
			source: "credit",
			target: "credit_decision",
		},
		{
			id: "edge-6",
			source: "credit_decision",
			target: "income",
			label: "Acceptable",
		},
		{
			id: "edge-7",
			source: "credit_decision",
			target: "manual",
			label: "Unacceptable",
		},
		{
			id: "edge-8",
			source: "manual",
			target: "exception",
		},
		{
			id: "edge-9",
			source: "exception",
			target: "income",
			label: "Yes",
		},
		{
			id: "edge-10",
			source: "exception",
			target: "exception_decline",
			label: "No",
		},
		{
			id: "edge-11",
			source: "income",
			target: "approved",
		},
	],
	layout: {
		direction: "TB",
	},
} as const;
