/** A waitlist whose keep-waiting loop returns to the response check that the ready check hangs from. From a generated eval sample. */
export default {
	id: "restaurant-waitlist",
	title: "Restaurant waitlist",
	nodes: [
		{
			id: "arrives",
			label: "Party arrives",
			kind: "start",
		},
		{
			id: "quote",
			label: "Host quotes a wait time",
			kind: "process",
		},
		{
			id: "available",
			label: "Table available?",
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
			id: "notified",
			label: "Party notified",
			kind: "process",
		},
		{
			id: "responds",
			label: "Party responds?",
			kind: "decision",
		},
		{
			id: "remove",
			label: "Remove the party from the list",
			kind: "end",
		},
		{
			id: "ready",
			label: "Table ready?",
			kind: "decision",
		},
		{
			id: "waiting",
			label: "Keeps waiting",
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
			label: "Available",
		},
		{
			id: "edge-4",
			source: "available",
			target: "add",
			label: "Not available",
		},
		{
			id: "edge-5",
			source: "add",
			target: "notified",
		},
		{
			id: "edge-6",
			source: "notified",
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
			target: "waiting",
			label: "Not ready",
		},
		{
			id: "edge-11",
			source: "waiting",
			target: "responds",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
