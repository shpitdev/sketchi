/** Two release paths meet at one terminal; decision branches turn once into their targets. */
export default {
	id: "release-fan-in",
	title: "Fix release",
	nodes: [
		{ id: "confirmed", label: "Bug confirmed", kind: "start" },
		{ id: "security", label: "Security impact?", kind: "decision" },
		{ id: "triage", label: "Security triage", kind: "process" },
		{ id: "hotfix", label: "Hotfix branch", kind: "process" },
		{ id: "priority", label: "High priority?", kind: "decision" },
		{ id: "sprint", label: "Sprint backlog", kind: "process" },
		{ id: "release", label: "Release fix", kind: "end" },
		{ id: "backlog", label: "Regular backlog", kind: "end" },
	],
	edges: [
		{ id: "assess", source: "confirmed", target: "security" },
		{ id: "secure", source: "security", target: "triage", label: "Yes" },
		{ id: "branch", source: "triage", target: "hotfix" },
		{ id: "ship-hotfix", source: "hotfix", target: "release" },
		{ id: "prioritize", source: "security", target: "priority", label: "No" },
		{ id: "plan", source: "priority", target: "sprint", label: "Yes" },
		{ id: "ship-sprint", source: "sprint", target: "release" },
		{ id: "defer", source: "priority", target: "backlog", label: "No" },
	],
} as const;
