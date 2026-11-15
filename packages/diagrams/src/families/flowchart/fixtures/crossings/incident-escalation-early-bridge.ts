/** The incident flow as another sample drew it, the bridge reached from severity and from the fix check. From a generated eval sample. */
export default {
	id: "incident-escalation-flowchart",
	title: "Incident escalation flowchart",
	nodes: [
		{
			id: "alert",
			label: "Monitoring creates an alert",
			kind: "start",
		},
		{
			id: "ack",
			label: "Responder acknowledges it",
			kind: "process",
		},
		{
			id: "severity",
			label: "Severity",
			kind: "decision",
		},
		{
			id: "bridge",
			label: "Incident bridge",
			kind: "process",
		},
		{
			id: "mitigate",
			label: "Mitigate impact",
			kind: "process",
		},
		{
			id: "comms",
			label: "Send customer communications",
			kind: "process",
		},
		{
			id: "resolve",
			label: "Resolve the incident",
			kind: "end",
		},
		{
			id: "triage",
			label: "Triage queue",
			kind: "process",
		},
		{
			id: "fix",
			label: "Is there a fix?",
			kind: "decision",
		},
		{
			id: "monitor",
			label: "Monitoring low severity incidents",
			kind: "process",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "alert",
			target: "ack",
		},
		{
			id: "edge-2",
			source: "ack",
			target: "severity",
		},
		{
			id: "edge-3",
			source: "severity",
			target: "bridge",
			label: "High severity",
		},
		{
			id: "edge-4",
			source: "severity",
			target: "triage",
			label: "Medium severity",
		},
		{
			id: "edge-5",
			source: "severity",
			target: "monitor",
			label: "Low severity",
		},
		{
			id: "edge-6",
			source: "bridge",
			target: "mitigate",
		},
		{
			id: "edge-7",
			source: "mitigate",
			target: "comms",
		},
		{
			id: "edge-8",
			source: "comms",
			target: "resolve",
		},
		{
			id: "edge-9",
			source: "triage",
			target: "fix",
		},
		{
			id: "edge-10",
			source: "fix",
			target: "resolve",
			label: "Yes",
		},
		{
			id: "edge-11",
			source: "fix",
			target: "bridge",
			label: "No — escalate",
		},
		{
			id: "edge-12",
			source: "monitor",
			target: "resolve",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
