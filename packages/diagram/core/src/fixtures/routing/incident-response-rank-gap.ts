/**
 * The incident response flow whose monitoring step leads to the resolution
 * through a rank gap narrower than twice a port jog's reach: the line steps
 * 148 units sideways across a 96-unit gap, so no place for the step clears
 * both its ends. From a generated eval sample (Oct 18).
 */
export default {
	id: "incident-response-escalation-flow",
	title: "Incident response escalation flow",
	nodes: [
		{
			id: "alert",
			label: "Alert is received",
			kind: "start",
		},
		{
			id: "triage",
			label: "Triaged",
			kind: "process",
		},
		{
			id: "real",
			label: "Is it a real incident?",
			kind: "decision",
		},
		{
			id: "close",
			label: "False alarms close",
			kind: "end",
		},
		{
			id: "declare",
			label: "Real incidents are declared",
			kind: "process",
		},
		{
			id: "notify",
			label: "Stakeholders are notified",
			kind: "process",
		},
		{
			id: "evidence",
			label: "Collect logs and deploy evidence",
			kind: "process",
			description: "Collect fresh evidence on each escalation loop.",
		},
		{
			id: "cause",
			label: "Root cause: deploy, code, or provider?",
			kind: "decision",
		},
		{
			id: "rollback",
			label: "Roll back",
			kind: "process",
		},
		{
			id: "hotfix",
			label: "Prepare a hotfix",
			kind: "process",
		},
		{
			id: "provider",
			label: "Escalate to the provider",
			kind: "end",
		},
		{
			id: "stable",
			label: "Is the service stable?",
			kind: "decision",
		},
		{
			id: "monitor",
			label: "Monitoring",
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
			target: "close",
			label: "No — false alarm",
		},
		{
			id: "edge-4",
			source: "real",
			target: "declare",
			label: "Yes — real incident",
		},
		{
			id: "edge-5",
			source: "declare",
			target: "notify",
		},
		{
			id: "edge-6",
			source: "notify",
			target: "evidence",
		},
		{
			id: "edge-7",
			source: "evidence",
			target: "cause",
		},
		{
			id: "edge-8",
			source: "cause",
			target: "rollback",
			label: "Deploy",
		},
		{
			id: "edge-9",
			source: "cause",
			target: "hotfix",
			label: "Code",
		},
		{
			id: "edge-10",
			source: "cause",
			target: "provider",
			label: "Provider",
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
			label: "Yes — stable",
		},
		{
			id: "edge-14",
			source: "monitor",
			target: "resolved",
		},
		{
			id: "edge-15",
			source: "stable",
			target: "escalate",
			label: "No — unstable",
		},
		{
			id: "edge-16",
			source: "escalate",
			target: "evidence",
			label: "Collect fresh evidence",
		},
	],
} as const;
