/** A waitlist whose table-ready check loops back to notifying the party while the available branch skips past it to seating. From a generated eval sample. */
export default {
	id: "restaurant-waitlist-table-ready",
	title: "Restaurant Waitlist Flowchart",
	nodes: [
		{
			id: "start",
			label: "Party Arrives",
			kind: "start",
		},
		{
			id: "quote",
			label: "Quote Wait Time",
			kind: "process",
		},
		{
			id: "check_avail",
			label: "Table Available?",
			kind: "decision",
		},
		{
			id: "seat",
			label: "Seat Party",
			kind: "process",
		},
		{
			id: "add_list",
			label: "Add to Waitlist",
			kind: "process",
		},
		{
			id: "notify",
			label: "Notify Party",
			kind: "process",
		},
		{
			id: "respond",
			label: "Party Responds?",
			kind: "decision",
		},
		{
			id: "remove",
			label: "Remove from List",
			kind: "end",
		},
		{
			id: "ready",
			label: "Table Ready?",
			kind: "decision",
		},
		{
			id: "end",
			label: "Party Seated",
			kind: "end",
		},
	],
	edges: [
		{
			id: "e1",
			source: "start",
			target: "quote",
		},
		{
			id: "e2",
			source: "quote",
			target: "check_avail",
		},
		{
			id: "e3",
			source: "check_avail",
			target: "seat",
			label: "Available",
		},
		{
			id: "e4",
			source: "check_avail",
			target: "add_list",
			label: "Not Available",
		},
		{
			id: "e5",
			source: "add_list",
			target: "notify",
		},
		{
			id: "e6",
			source: "notify",
			target: "respond",
		},
		{
			id: "e7",
			source: "respond",
			target: "remove",
			label: "No",
		},
		{
			id: "e8",
			source: "respond",
			target: "ready",
			label: "Yes",
		},
		{
			id: "e9",
			source: "ready",
			target: "seat",
			label: "Yes",
		},
		{
			id: "e10",
			source: "ready",
			target: "notify",
			label: "No",
		},
		{
			id: "e11",
			source: "seat",
			target: "end",
		},
	],
};
