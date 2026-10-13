export default {
	id: "pharma-batch-disposition",
	title: "Pharma Batch Disposition",
	nodes: [
		{
			id: "received",
			label: "Batch received",
			kind: "start",
		},
		{
			id: "coa_review",
			label: "QA reviews Certificate of Analysis (CoA)",
			kind: "process",
		},
		{
			id: "spec_check",
			label: "Batch passes specs?",
			kind: "decision",
		},
		{
			id: "final_review",
			label: "QA Manager final review",
			kind: "process",
		},
		{
			id: "packaging",
			label: "Packaging",
			kind: "process",
		},
		{
			id: "released",
			label: "Packaged batch released",
			kind: "end",
		},
		{
			id: "investigation",
			label: "Investigation",
			kind: "process",
		},
		{
			id: "rejected",
			label: "Reject batch",
			kind: "end",
		},
	],
	edges: [
		{
			id: "e1",
			source: "received",
			target: "coa_review",
		},
		{
			id: "e2",
			source: "coa_review",
			target: "spec_check",
		},
		{
			id: "e3",
			source: "spec_check",
			target: "final_review",
			label: "Pass",
		},
		{
			id: "e4",
			source: "spec_check",
			target: "investigation",
			label: "Retest",
		},
		{
			id: "e5",
			source: "spec_check",
			target: "rejected",
			label: "Reject",
		},
		{
			id: "e6",
			source: "final_review",
			target: "packaging",
		},
		{
			id: "e7",
			source: "packaging",
			target: "released",
		},
		{
			id: "e8",
			source: "investigation",
			target: "final_review",
			label: "Returns to final review",
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
