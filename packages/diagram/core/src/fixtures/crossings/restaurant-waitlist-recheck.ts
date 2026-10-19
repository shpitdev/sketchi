/** The waitlist as another sample drew it. From a generated eval sample. */
export default {
	id: "restaurant-waitlist",
	title: "Restaurant waitlist",
	nodes: [
		{
			id: "arrives",
			label: "A party arrives",
			kind: "start",
		},
		{
			id: "quote",
			label: "Host quotes a wait time",
			kind: "process",
		},
		{
			id: "available",
			label: "Is a table available?",
			kind: "decision",
		},
		{
			id: "seat",
			label: "Seat the party",
			kind: "end",
		},
		{
			id: "add",
			label: "Add the party to the waitlist",
			kind: "process",
		},
		{
			id: "notify",
			label: "Notify the party",
			kind: "process",
		},
		{
			id: "responds",
			label: "Does the party respond?",
			kind: "decision",
		},
		{
			id: "remove",
			label: "Remove the party from the list",
			kind: "end",
		},
		{
			id: "ready",
			label: "Is the table ready?",
			kind: "decision",
		},
		{
			id: "wait",
			label: "Keep waiting",
			kind: "process",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "arrives",
			target: "quote",
		},
		{
			id: "edge-2",
			source: "quote",
			target: "available",
		},
		{
			id: "edge-3",
			source: "available",
			target: "seat",
			label: "Yes",
		},
		{
			id: "edge-4",
			source: "available",
			target: "add",
			label: "No",
		},
		{
			id: "edge-5",
			source: "add",
			target: "notify",
		},
		{
			id: "edge-6",
			source: "notify",
			target: "responds",
		},
		{
			id: "edge-7",
			source: "responds",
			target: "remove",
			label: "No response",
		},
		{
			id: "edge-8",
			source: "responds",
			target: "ready",
			label: "Responds",
		},
		{
			id: "edge-9",
			source: "ready",
			target: "seat",
			label: "Ready",
		},
		{
			id: "edge-10",
			source: "ready",
			target: "wait",
			label: "Not ready",
		},
		{
			id: "edge-11",
			source: "wait",
			target: "responds",
			label: "Check response again",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
