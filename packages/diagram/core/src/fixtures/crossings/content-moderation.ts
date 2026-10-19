/** Content moderation whose no-violation branch passes the escalation terminal on its way to restore. From a generated eval sample. */
export default {
	id: "content-moderation",
	title: "Content moderation",
	nodes: [
		{
			id: "report",
			label: "Report is received",
			kind: "start",
		},
		{
			id: "scan",
			label: "Automated scan runs",
			kind: "process",
		},
		{
			id: "severe",
			label: "Severe harm detected?",
			kind: "decision",
		},
		{
			id: "remove",
			label: "Remove the content",
			kind: "process",
		},
		{
			id: "escalate",
			label: "Escalate to safety",
			kind: "end",
		},
		{
			id: "violation",
			label: "Policy violation?",
			kind: "decision",
		},
		{
			id: "restore",
			label: "Restore content",
			kind: "end",
		},
		{
			id: "review",
			label: "Human review",
			kind: "process",
		},
		{
			id: "action",
			label: "Action needed?",
			kind: "decision",
		},
		{
			id: "limit",
			label: "Limits content",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "report",
			target: "scan",
		},
		{
			id: "edge-2",
			source: "scan",
			target: "severe",
		},
		{
			id: "edge-3",
			source: "severe",
			target: "remove",
			label: "Yes",
		},
		{
			id: "edge-4",
			source: "remove",
			target: "escalate",
		},
		{
			id: "edge-5",
			source: "severe",
			target: "violation",
			label: "No",
		},
		{
			id: "edge-6",
			source: "violation",
			target: "restore",
			label: "No",
		},
		{
			id: "edge-7",
			source: "violation",
			target: "review",
			label: "Yes",
		},
		{
			id: "edge-8",
			source: "review",
			target: "action",
		},
		{
			id: "edge-9",
			source: "action",
			target: "limit",
			label: "Yes",
		},
		{
			id: "edge-10",
			source: "action",
			target: "restore",
			label: "No",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
