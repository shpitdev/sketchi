/** Vendor approval with a preferred-vendor bypass and a renegotiation loop back into legal review. From a generated eval sample. */
export default {
	id: "procurement-vendor-approval",
	title: "Procurement vendor approval",
	nodes: [
		{
			id: "need",
			label: "Business need is identified",
			kind: "start",
		},
		{
			id: "quotes",
			label: "Quotes are collected",
			kind: "process",
		},
		{
			id: "preferred",
			label: "Is there a preferred vendor?",
			kind: "decision",
		},
		{
			id: "bid",
			label: "Run a competitive bid",
			kind: "process",
		},
		{
			id: "risk",
			label: "Risk assessment",
			kind: "process",
		},
		{
			id: "acceptable",
			label: "Is risk acceptable?",
			kind: "decision",
		},
		{
			id: "reject",
			label: "Reject the vendor",
			kind: "end",
		},
		{
			id: "legal",
			label: "Legal review",
			kind: "process",
		},
		{
			id: "approved",
			label: "Does legal approve?",
			kind: "decision",
		},
		{
			id: "renegotiate",
			label: "Renegotiate terms",
			kind: "process",
		},
		{
			id: "contract",
			label: "Create the contract",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "need",
			target: "quotes",
		},
		{
			id: "edge-2",
			source: "quotes",
			target: "preferred",
		},
		{
			id: "edge-3",
			source: "preferred",
			target: "risk",
			label: "Yes",
		},
		{
			id: "edge-4",
			source: "preferred",
			target: "bid",
			label: "No",
		},
		{
			id: "edge-5",
			source: "bid",
			target: "risk",
		},
		{
			id: "edge-6",
			source: "risk",
			target: "acceptable",
		},
		{
			id: "edge-7",
			source: "acceptable",
			target: "reject",
			label: "No",
		},
		{
			id: "edge-8",
			source: "acceptable",
			target: "legal",
			label: "Yes",
		},
		{
			id: "edge-9",
			source: "legal",
			target: "approved",
		},
		{
			id: "edge-10",
			source: "approved",
			target: "contract",
			label: "Yes",
		},
		{
			id: "edge-11",
			source: "approved",
			target: "renegotiate",
			label: "No",
		},
		{
			id: "edge-12",
			source: "renegotiate",
			target: "legal",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
