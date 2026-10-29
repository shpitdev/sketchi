/**
 * A row of five team groups and two ungrouped closing steps, fifteen steps
 * long, whose wrap steps two lines sideways beside an end until the ends'
 * polish straightens them. From the #548 delta review.
 */
export default {
	id: "five-team-row",
	title: "Five-team row",
	nodes: [
		{
			id: "n0",
			label: "Step",
			kind: "start",
			group: "g0",
		},
		{
			id: "n2",
			label: "Step",
			kind: "process",
			group: "g0",
		},
		{
			id: "n3",
			label: "Step",
			kind: "process",
			group: "g1",
		},
		{
			id: "n4",
			label: "Step",
			kind: "process",
			group: "g1",
		},
		{
			id: "n5",
			label: "Step",
			kind: "process",
			group: "g2",
		},
		{
			id: "n6",
			label: "Step",
			kind: "process",
			group: "g2",
		},
		{
			id: "n7",
			label: "Customer submits a request for approval",
			kind: "decision",
			group: "g3",
		},
		{
			id: "n8",
			label: "Step",
			kind: "process",
			group: "g3",
		},
		{
			id: "n9",
			label: "Step",
			kind: "process",
			group: "g3",
		},
		{
			id: "n10",
			label: "Step",
			kind: "process",
			group: "g4",
		},
		{
			id: "n11",
			label: "Step",
			kind: "process",
			group: "g4",
		},
		{
			id: "n12",
			label: "Step",
			kind: "process",
			group: "g4",
		},
		{
			id: "n13",
			label: "Step",
			kind: "process",
			group: "g4",
		},
		{
			id: "n14",
			label: "Step",
			kind: "process",
		},
		{
			id: "n15",
			label: "Customer submits a request for approval",
			kind: "end",
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
		},
		{
			id: "e3",
			source: "n3",
			target: "n4",
			label: "Next step",
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
			label: "Yes",
		},
		{
			id: "e8",
			source: "n8",
			target: "n9",
		},
		{
			id: "e9",
			source: "n9",
			target: "n10",
		},
		{
			id: "e10",
			source: "n10",
			target: "n11",
		},
		{
			id: "e11",
			source: "n11",
			target: "n12",
		},
		{
			id: "e12",
			source: "n12",
			target: "n13",
			label: "Next step",
		},
		{
			id: "e13",
			source: "n13",
			target: "n14",
		},
		{
			id: "e14",
			source: "n14",
			target: "n15",
			label: "Next step",
		},
		{
			id: "e15",
			source: "n7",
			target: "n9",
			label: "No",
		},
	],
	groups: [
		{
			id: "g0",
			label: "Team",
		},
		{
			id: "g1",
			label: "Team",
		},
		{
			id: "g2",
			label: "Legal and compliance",
		},
		{
			id: "g3",
			label: "Team",
		},
		{
			id: "g4",
			label: "Team",
		},
	],
} as const;
