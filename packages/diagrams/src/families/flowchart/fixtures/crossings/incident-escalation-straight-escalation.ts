/** The incident flow with the bridge straight below the fix check, whose escalation once swung left around it into the bridge's side instead of dropping straight in. From a live eval sample (Sonnet, round 20). */
export default {
	id: "incident-escalation",
	title: "Incident Escalation",
	nodes: [
		{
			id: "alert",
			label: "Monitoring creates an alert",
			kind: "start",
		},
		{
			id: "ack",
			label: "Responder acknowledges the alert",
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
			id: "triage",
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
			id: "mon",
			label: "Monitoring",
			kind: "process",
		},
		{
			id: "resolved",
			label: "Resolve the incident",
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
			target: "sev",
		},
		{
			id: "edge-3",
			source: "sev",
			target: "bridge",
			label: "high",
		},
		{
			id: "edge-4",
			source: "sev",
			target: "triage",
			label: "medium",
		},
		{
			id: "edge-5",
			source: "sev",
			target: "mon",
			label: "low",
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
			label: "yes",
		},
		{
			id: "edge-11",
			source: "fix",
			target: "bridge",
			label: "no, escalate",
		},
		{
			id: "edge-12",
			source: "mon",
			target: "resolved",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
