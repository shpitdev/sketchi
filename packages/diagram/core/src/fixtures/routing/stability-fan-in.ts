/** Three remediation paths meet at one decision, and a retry loop rejoins a centered spine. */
export default {
	id: "stability-fan-in",
	title: "Incident remediation",
	nodes: [
		{ id: "evidence", label: "Collect evidence", kind: "start" },
		{ id: "cause", label: "Classify root cause", kind: "decision" },
		{ id: "rollback", label: "Roll back deploy", kind: "process" },
		{ id: "hotfix", label: "Prepare hotfix", kind: "process" },
		{ id: "provider", label: "Escalate to provider", kind: "process" },
		{ id: "stable", label: "Service stable?", kind: "decision" },
		{ id: "monitor", label: "Monitor service", kind: "end" },
		{ id: "escalate", label: "Escalate unstable service", kind: "process" },
		{ id: "fresh", label: "Collect fresh evidence", kind: "process" },
	],
	edges: [
		{ id: "classify", source: "evidence", target: "cause" },
		{ id: "deploy", source: "cause", target: "rollback", label: "Deploy" },
		{ id: "code", source: "cause", target: "hotfix", label: "Code" },
		{ id: "vendor", source: "cause", target: "provider", label: "Provider" },
		{ id: "check-rollback", source: "rollback", target: "stable" },
		{ id: "check-hotfix", source: "hotfix", target: "stable" },
		{ id: "check-provider", source: "provider", target: "stable" },
		{ id: "healthy", source: "stable", target: "monitor", label: "Yes" },
		{ id: "unhealthy", source: "stable", target: "escalate", label: "No" },
		{ id: "gather", source: "escalate", target: "fresh" },
		{ id: "retry", source: "fresh", target: "cause" },
	],
} as const;
