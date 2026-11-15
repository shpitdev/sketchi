/** An incident response whose escalation loops back to collecting evidence while the provider branch skips past it to resolution. From a generated eval sample. */
export default {
	id: "incident-response-provider-loop",
	title: "Incident Response Escalation Flow",
	nodes: [
		{
			id: "alert",
			label: "Alert is received",
			kind: "start",
		},
		{
			id: "triage",
			label: "Alert is triaged",
			kind: "process",
		},
		{
			id: "real",
			label: "Is it a real incident?",
			kind: "decision",
		},
		{
			id: "closed",
			label: "False alarm closed",
			kind: "end",
		},
		{
			id: "declare",
			label: "Declare incident",
			kind: "process",
		},
		{
			id: "notify",
			label: "Notify stakeholders",
			kind: "process",
		},
		{
			id: "collect",
			label: "Collect logs and deploy evidence",
			kind: "process",
		},
		{
			id: "rc",
			label: "Classify root cause",
			kind: "decision",
		},
		{
			id: "rollback",
			label: "Roll back",
			kind: "process",
		},
		{
			id: "hotfix",
			label: "Prepare hotfix",
			kind: "process",
		},
		{
			id: "provider",
			label: "Escalate to the provider",
			kind: "process",
		},
		{
			id: "stable",
			label: "Is the service stable?",
			kind: "decision",
		},
		{
			id: "monitor",
			label: "Monitor",
			kind: "process",
		},
		{
			id: "resolved",
			label: "Resolved",
			kind: "end",
		},
		{
			id: "escalate",
			label: "Escalate",
			kind: "process",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "alert",
			target: "triage",
		},
		{
			id: "edge-2",
			source: "triage",
			target: "real",
		},
		{
			id: "edge-3",
			source: "real",
			target: "closed",
			label: "no",
		},
		{
			id: "edge-4",
			source: "real",
			target: "declare",
			label: "yes",
		},
		{
			id: "edge-5",
			source: "declare",
			target: "notify",
		},
		{
			id: "edge-6",
			source: "notify",
			target: "collect",
		},
		{
			id: "edge-7",
			source: "collect",
			target: "rc",
		},
		{
			id: "edge-8",
			source: "rc",
			target: "rollback",
			label: "deploy",
		},
		{
			id: "edge-9",
			source: "rc",
			target: "hotfix",
			label: "code",
		},
		{
			id: "edge-10",
			source: "rc",
			target: "provider",
			label: "provider",
		},
		{
			id: "edge-11",
			source: "rollback",
			target: "stable",
		},
		{
			id: "edge-12",
			source: "hotfix",
			target: "stable",
		},
		{
			id: "edge-13",
			source: "stable",
			target: "monitor",
			label: "yes",
		},
		{
			id: "edge-14",
			source: "stable",
			target: "escalate",
			label: "no",
		},
		{
			id: "edge-15",
			source: "escalate",
			target: "collect",
		},
		{
			id: "edge-16",
			source: "monitor",
			target: "resolved",
		},
		{
			id: "edge-17",
			source: "provider",
			target: "resolved",
		},
	],
};
