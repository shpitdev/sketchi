/**
 * A row of four team groups with ungrouped steps between them and a decision
 * whose "No" branch skips ahead into a later group. Every wrap of its row once
 * drew that branch with a port jog main does not draw. From the #548 review.
 */
export default {
	id: "mixed-membership-row",
	title: "Mixed-membership row of teams",
	nodes: [
		{
			id: "n0",
			label: "Review report",
			kind: "start",
			group: "g0",
		},
		{
			id: "n2",
			label: "Review report",
			kind: "decision",
		},
		{
			id: "n3",
			label: "Review report",
			kind: "process",
		},
		{
			id: "n4",
			label: "Review report",
			kind: "process",
			group: "g2",
		},
		{
			id: "n5",
			label: "Review report",
			kind: "process",
			group: "g3",
		},
		{
			id: "n6",
			label: "Review report",
			kind: "process",
			group: "g3",
		},
		{
			id: "n7",
			label: "Review report",
			kind: "process",
		},
		{
			id: "n8",
			label: "Review report",
			kind: "process",
			group: "g5",
		},
		{
			id: "n9",
			label: "Review report",
			kind: "end",
			group: "g5",
		},
	],
	edges: [
		{
			id: "e0",
			source: "n0",
			target: "n2",
		},
		{
			id: "e2",
			source: "n2",
			target: "n3",
			label: "Yes",
		},
		{
			id: "e3",
			source: "n3",
			target: "n4",
		},
		{
			id: "e4",
			source: "n4",
			target: "n5",
		},
		{
			id: "e5",
			source: "n5",
			target: "n6",
		},
		{
			id: "e6",
			source: "n6",
			target: "n7",
		},
		{
			id: "e7",
			source: "n7",
			target: "n8",
		},
		{
			id: "e8",
			source: "n8",
			target: "n9",
		},
		{
			id: "e9",
			source: "n2",
			target: "n4",
			label: "No",
		},
	],
	groups: [
		{
			id: "g0",
			label: "Team 0",
		},
		{
			id: "g2",
			label: "Team 2",
		},
		{
			id: "g3",
			label: "Team 3",
		},
		{
			id: "g5",
			label: "Team 5",
		},
	],
} as const;
