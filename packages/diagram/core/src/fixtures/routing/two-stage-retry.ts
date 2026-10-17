/** Two direct returns must not collapse onto one boundary corridor. */
export default {
	id: "two-stage-retry",
	title: "Revisit earlier checks",
	nodes: [
		{ id: "s", label: "Received", kind: "start" },
		...["Prepare", "Inspect", "Review", "Rework"].map((label, i) => ({
			id: ["a", "b", "c", "d"][i]!,
			label,
			kind: "process" as const,
		})),
		{ id: "end", label: "Released", kind: "end" },
	],
	edges: [
		["s", "a"],
		["a", "b"],
		["b", "c"],
		["c", "d"],
		["d", "end"],
		["d", "a"],
		["d", "b"],
	].map(([source, target], i) => ({ id: `e${i}`, source: source!, target: target! })),
} as const;
