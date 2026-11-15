/** Renewal dunning with two loops: a retried charge back to the top and another reminder back to the update check. From a generated eval sample. */
export default {
	id: "subscription-renewal-dunning",
	title: "Subscription renewal dunning",
	nodes: [
		{
			id: "due",
			label: "A renewal is due",
			kind: "start",
		},
		{
			id: "charge",
			label: "Charges payment",
			kind: "process",
		},
		{
			id: "success",
			label: "Payment succeeds?",
			kind: "decision",
		},
		{
			id: "renew",
			label: "Renew the subscription",
			kind: "end",
		},
		{
			id: "reminder",
			label: "Send a reminder",
			kind: "process",
		},
		{
			id: "updated",
			label: "Payment was updated?",
			kind: "decision",
		},
		{
			id: "expired",
			label: "Grace period has expired?",
			kind: "decision",
		},
		{
			id: "pause",
			label: "Pause the subscription",
			kind: "end",
		},
		{
			id: "another",
			label: "Send another reminder",
			kind: "process",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "due",
			target: "charge",
		},
		{
			id: "edge-2",
			source: "charge",
			target: "success",
		},
		{
			id: "edge-3",
			source: "success",
			target: "renew",
			label: "Yes",
		},
		{
			id: "edge-4",
			source: "success",
			target: "reminder",
			label: "No",
		},
		{
			id: "edge-5",
			source: "reminder",
			target: "updated",
		},
		{
			id: "edge-6",
			source: "updated",
			target: "charge",
			label: "Yes — retry charge",
		},
		{
			id: "edge-7",
			source: "updated",
			target: "expired",
			label: "No",
		},
		{
			id: "edge-8",
			source: "expired",
			target: "pause",
			label: "Yes",
		},
		{
			id: "edge-9",
			source: "expired",
			target: "another",
			label: "No",
		},
		{
			id: "edge-10",
			source: "another",
			target: "updated",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
