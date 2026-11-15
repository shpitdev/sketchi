/** Mixed-label returns need distinct lateral departure capacity. */
export default {
	id: "multi-stage-rework",
	title: "Rework earlier stages",
	nodes: [
		{ id: "start", label: "Received", kind: "start" },
		...["Intake", "Validate", "Assemble", "Review", "Rework", "Release"].map((label, i) => ({
			id: String(i),
			label,
			kind: i === 5 ? ("end" as const) : ("process" as const),
		})),
	],
	edges: [
		{ id: "start", source: "start", target: "0" },
		...Array.from({ length: 5 }, (_, i) => ({
			id: `e${i}`,
			source: String(i),
			target: String(i + 1),
		})),
		...Array.from({ length: 4 }, (_, i) => ({
			id: `back${i}`,
			source: "4",
			target: String(i),
			...(i === 0 ? { label: "Retry" } : {}),
		})),
	],
} as const;
