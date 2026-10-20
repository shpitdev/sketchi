/** The incident flow with the triage step drawn as a queue and the fix check straight between severity and the bridge. Its monitoring line once crossed the triage connector and its high line crossed the fix check's yes. From a live eval sample (Sol, round 20). */
export default {
	id: "incident-escalation",
	title: "Incident escalation",
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
			id: "triage",
			label: "Triage queue",
			kind: "process",
			shape: "queue",
		},
		{
			id: "monitor",
			label: "Monitoring",
			kind: "process",
		},
		{
			id: "fix",
			label: "Is there a fix?",
			kind: "decision",
		},
		{
			id: "mitigate",
			label: "Mitigates impact",
			kind: "process",
		},
		{
			id: "comms",
			label: "Sends customer communications",
			kind: "process",
		},
		{
			id: "resolved",
			label: "Resolved",
			kind: "end",
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
			label: "High",
		},
		{
			id: "edge-4",
			source: "severity",
			target: "triage",
			label: "Medium",
		},
		{
			id: "edge-5",
			source: "severity",
			target: "monitor",
			label: "Low",
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
			target: "resolved",
		},
		{
			id: "edge-9",
			source: "triage",
			target: "fix",
		},
		{
			id: "edge-10",
			source: "fix",
			target: "resolved",
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
			target: "resolved",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
