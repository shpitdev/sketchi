/**
 * Two checks fail into one rollback from the same side. The nearer failure
 * turns straight down into it, so the farther one must arrive outside it or on
 * the side it approaches from instead of crossing it twice.
 */
export default {
	id: "rollout-failures",
	title: "Feature flag rollout",
	nodes: [
		{ id: "ready", label: "Flag is ready", kind: "start" },
		{ id: "internal", label: "Enable internally", kind: "process" },
		{ id: "internal-health", label: "Internal checks healthy?", kind: "decision" },
		{ id: "beta", label: "Enable beta cohort", kind: "process" },
		{ id: "beta-health", label: "Beta checks healthy?", kind: "decision" },
		{ id: "ramp", label: "Ramp to all users", kind: "process" },
		{ id: "complete", label: "Rollout complete", kind: "end" },
		{ id: "rollback", label: "Roll back the feature", kind: "end" },
	],
	edges: [
		{ id: "enable", source: "ready", target: "internal" },
		{ id: "check-internal", source: "internal", target: "internal-health" },
		{ id: "internal-healthy", source: "internal-health", target: "beta", label: "Healthy" },
		{ id: "internal-fail", source: "internal-health", target: "rollback", label: "Fail" },
		{ id: "check-beta", source: "beta", target: "beta-health" },
		{ id: "beta-healthy", source: "beta-health", target: "ramp", label: "Healthy" },
		{ id: "beta-unhealthy", source: "beta-health", target: "rollback", label: "Unhealthy" },
		{ id: "finish", source: "ramp", target: "complete" },
	],
} as const;
