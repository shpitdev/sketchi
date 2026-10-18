/** Grouped and ungrouped steps side by side, with a branch that skips a group. */
export default {
	id: "mixed-membership",
	title: "Order fulfilment with partial grouping",
	groups: [
		{ id: "warehouse", label: "Warehouse" },
		{ id: "shipping", label: "Shipping partner" },
	],
	nodes: [
		{ id: "order", label: "Order placed", kind: "start" },
		{ id: "fraud", label: "Fraud check passed?", kind: "decision" },
		{ id: "pick", label: "Pick items", kind: "process", group: "warehouse" },
		{ id: "pack", label: "Pack the order", kind: "process", group: "warehouse" },
		{ id: "label", label: "Print shipping label", kind: "process", group: "warehouse" },
		{ id: "collect", label: "Collect parcel", kind: "process", group: "shipping" },
		{ id: "deliver", label: "Deliver to customer", kind: "end", group: "shipping" },
		{ id: "cancel", label: "Cancel the order", kind: "end" },
	],
	edges: [
		{ id: "e1", source: "order", target: "fraud" },
		{ id: "e2", source: "fraud", target: "pick", label: "yes" },
		{ id: "e3", source: "fraud", target: "cancel", label: "no" },
		{ id: "e4", source: "pick", target: "pack" },
		{ id: "e5", source: "pack", target: "label" },
		{ id: "e6", source: "label", target: "collect" },
		{ id: "e7", source: "collect", target: "deliver" },
	],
} as const;
