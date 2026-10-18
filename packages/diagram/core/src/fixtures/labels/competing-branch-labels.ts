/** One decision with four nearby labeled branches and a labeled loop back from a decision. */
export default {
	id: "competing-branch-labels",
	title: "Competing branch labels",
	nodes: [
		{
			id: "triage",
			label: "Triage the report",
			kind: "start",
		},
		{
			id: "kind",
			label: "Which kind of report?",
			kind: "decision",
		},
		{
			id: "bug",
			label: "Reproduce the bug",
			kind: "process",
		},
		{
			id: "feature",
			label: "Log the feature",
			kind: "process",
		},
		{
			id: "question",
			label: "Answer the question",
			kind: "process",
		},
		{
			id: "duplicate",
			label: "Link the duplicate",
			kind: "process",
		},
		{
			id: "reproduced",
			label: "Reproduced?",
			kind: "decision",
		},
		{
			id: "fix",
			label: "Fix and verify",
			kind: "process",
		},
		{
			id: "closed",
			label: "Close the report",
			kind: "end",
		},
	],
	edges: [
		{
			id: "e1",
			source: "triage",
			target: "kind",
		},
		{
			id: "e2",
			source: "kind",
			target: "bug",
			label: "Unexpected behavior",
		},
		{
			id: "e3",
			source: "kind",
			target: "feature",
			label: "Enhancement",
		},
		{
			id: "e4",
			source: "kind",
			target: "question",
			label: "Unanswered question",
		},
		{
			id: "e5",
			source: "kind",
			target: "duplicate",
			label: "Duplicate",
		},
		{
			id: "e6",
			source: "bug",
			target: "reproduced",
		},
		{
			id: "e7",
			source: "reproduced",
			target: "fix",
			label: "Reproduced",
		},
		{
			id: "e8",
			source: "reproduced",
			target: "bug",
			label: "Unreproducible",
		},
		{
			id: "e9",
			source: "fix",
			target: "closed",
		},
		{
			id: "e10",
			source: "feature",
			target: "closed",
		},
		{
			id: "e11",
			source: "question",
			target: "closed",
		},
		{
			id: "e12",
			source: "duplicate",
			target: "closed",
		},
	],
	layout: {
		direction: "TB",
	},
} as const;
