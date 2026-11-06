/**
 * Incident response whose three stability checks each send a yes branch to
 * Monitor service and a no branch to Escalate incident. Three of three
 * generated samples drew the middle check's no branch and the right check's
 * yes branch turning one unit apart in the gap between the two checks: one
 * bend for two lines of opposite meaning.
 */
export default {
	id: "incident-response-escalation",
	title: "Incident response escalation",
	nodes: [
		{ id: "start", label: "Alert received", kind: "start" },
		{ id: "triage", label: "Triage alert", kind: "process" },
		{ id: "real", label: "Real incident?", kind: "decision" },
		{ id: "close_false", label: "Close false alarm", kind: "end" },
		{ id: "declare", label: "Declare incident", kind: "process" },
		{ id: "notify", label: "Notify stakeholders", kind: "process" },
		{ id: "collect", label: "Collect logs and deploy evidence", kind: "process" },
		{ id: "classify", label: "Classify root cause", kind: "decision" },
		{ id: "rollback", label: "Roll back deploy", kind: "process" },
		{ id: "hotfix", label: "Prepare hotfix", kind: "process" },
		{ id: "escalate_provider", label: "Escalate to provider", kind: "process" },
		{ id: "stable1", label: "Service stable?", kind: "decision" },
		{ id: "stable2", label: "Service stable?", kind: "decision" },
		{ id: "stable3", label: "Service stable?", kind: "decision" },
		{ id: "monitor", label: "Monitor service", kind: "process" },
		{ id: "resolved", label: "Incident resolved", kind: "end" },
		{ id: "escalate", label: "Escalate incident", kind: "process" },
	],
	edges: [
		{ id: "e1", source: "start", target: "triage" },
		{ id: "e2", source: "triage", target: "real" },
		{ id: "e3", source: "real", target: "close_false", label: "no" },
		{ id: "e4", source: "real", target: "declare", label: "yes" },
		{ id: "e5", source: "declare", target: "notify" },
		{ id: "e6", source: "notify", target: "collect" },
		{ id: "e7", source: "collect", target: "classify" },
		{ id: "e8", source: "classify", target: "rollback", label: "deploy" },
		{ id: "e9", source: "classify", target: "hotfix", label: "code" },
		{ id: "e10", source: "classify", target: "escalate_provider", label: "provider" },
		{ id: "e11", source: "rollback", target: "stable1" },
		{ id: "e12", source: "hotfix", target: "stable2" },
		{ id: "e13", source: "escalate_provider", target: "stable3" },
		{ id: "e14", source: "stable1", target: "monitor", label: "yes" },
		{ id: "e15", source: "stable1", target: "escalate", label: "no" },
		{ id: "e16", source: "stable2", target: "monitor", label: "yes" },
		{ id: "e17", source: "stable2", target: "escalate", label: "no" },
		{ id: "e18", source: "stable3", target: "monitor", label: "yes" },
		{ id: "e19", source: "stable3", target: "escalate", label: "no" },
		{ id: "e20", source: "monitor", target: "resolved" },
		{ id: "e21", source: "escalate", target: "collect", label: "collect fresh evidence" },
	],
} as const;
