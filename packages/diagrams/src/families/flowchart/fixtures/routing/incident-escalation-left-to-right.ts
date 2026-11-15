/** Incident escalation asked for left to right, whose line from Monitoring once stepped down midway and ran along the fix check's yes branch, one unit from it, into Resolve incident: two lines drawn as one. Round 30 (Sonnet), two of five samples. */
export default {
	id: "incident-escalation",
	title: "Incident Escalation",
	nodes: [
		{
			id: "mon",
			label: "Monitoring creates alert",
			kind: "start",
		},
		{
			id: "ack",
			label: "Responder acknowledges alert",
			kind: "process",
		},
		{
			id: "sev",
			label: "Severity?",
			kind: "decision",
		},
		{
			id: "bridge",
			label: "Incident bridge",
			kind: "process",
		},
		{
			id: "mit",
			label: "Mitigate impact",
			kind: "process",
		},
		{
			id: "comm",
			label: "Send customer communications",
			kind: "process",
		},
		{
			id: "res",
			label: "Resolve incident",
			kind: "end",
		},
		{
			id: "tri",
			label: "Triage queue",
			kind: "process",
			shape: "queue",
		},
		{
			id: "fix",
			label: "Is there a fix?",
			kind: "decision",
		},
		{
			id: "low",
			label: "Monitoring",
			kind: "process",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "mon",
			target: "ack",
		},
		{
			id: "edge-2",
			source: "ack",
			target: "sev",
		},
		{
			id: "edge-3",
			source: "sev",
			target: "bridge",
			label: "High",
		},
		{
			id: "edge-4",
			source: "sev",
			target: "tri",
			label: "Medium",
		},
		{
			id: "edge-5",
			source: "sev",
			target: "low",
			label: "Low",
		},
		{
			id: "edge-6",
			source: "bridge",
			target: "mit",
		},
		{
			id: "edge-7",
			source: "mit",
			target: "comm",
		},
		{
			id: "edge-8",
			source: "comm",
			target: "res",
		},
		{
			id: "edge-9",
			source: "tri",
			target: "fix",
		},
		{
			id: "edge-10",
			source: "fix",
			target: "res",
			label: "Yes",
		},
		{
			id: "edge-11",
			source: "fix",
			target: "bridge",
			label: "No, escalate",
		},
		{
			id: "edge-12",
			source: "low",
			target: "res",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
