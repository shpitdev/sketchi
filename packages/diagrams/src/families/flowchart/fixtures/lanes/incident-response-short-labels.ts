/** Incident response across three actors with round 29's shorter labels: its shorter decision left the row of lanes past 2.5:1. Round 29 (Sonnet). */
export default {
	id: "incident-response",
	title: "Incident Response",
	nodes: [
		{
			id: "alert",
			label: "Alert fires",
			kind: "start",
			lane: "oncall",
		},
		{
			id: "triage",
			label: "Triage alert",
			kind: "process",
			lane: "oncall",
		},
		{
			id: "page",
			label: "Page SRE",
			kind: "process",
			lane: "oncall",
		},
		{
			id: "inv",
			label: "Investigate incident",
			kind: "process",
			lane: "sre",
		},
		{
			id: "mit",
			label: "Apply mitigation",
			kind: "process",
			lane: "sre",
		},
		{
			id: "status",
			label: "Post status update",
			kind: "process",
			lane: "comms",
		},
		{
			id: "res",
			label: "Incident resolved?",
			kind: "decision",
			lane: "oncall",
		},
		{
			id: "pub",
			label: "Publish resolution",
			kind: "end",
			lane: "comms",
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
			target: "page",
		},
		{
			id: "edge-3",
			source: "page",
			target: "inv",
		},
		{
			id: "edge-4",
			source: "inv",
			target: "mit",
		},
		{
			id: "edge-5",
			source: "mit",
			target: "status",
		},
		{
			id: "edge-6",
			source: "status",
			target: "res",
		},
		{
			id: "edge-7",
			source: "res",
			target: "inv",
			label: "No",
		},
		{
			id: "edge-8",
			source: "res",
			target: "pub",
			label: "Yes",
		},
	],
	lanes: [
		{
			id: "oncall",
			label: "On-call",
		},
		{
			id: "sre",
			label: "SRE",
		},
		{
			id: "comms",
			label: "Comms",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
