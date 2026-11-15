/** Order fulfilment across four actors: straight handoffs, a stock decision and a payment loop between distant lanes. */
export default {
	id: "order-fulfilment-lanes",
	title: "Order fulfilment",
	lanes: [
		{ id: "customer", label: "Customer" },
		{ id: "sales", label: "Sales" },
		{ id: "warehouse", label: "Warehouse" },
		{ id: "billing", label: "Billing" },
	],
	nodes: [
		{ id: "place", label: "Place order", kind: "start", lane: "customer" },
		{ id: "review", label: "Review order", kind: "process", lane: "sales" },
		{ id: "stock", label: "Items in stock?", kind: "decision", lane: "sales" },
		{ id: "backorder", label: "Notify backorder", kind: "end", lane: "sales" },
		{ id: "pick", label: "Pick items", kind: "process", lane: "warehouse" },
		{ id: "pack", label: "Pack the order", kind: "process", lane: "warehouse" },
		{ id: "ship", label: "Ship the order", kind: "process", lane: "warehouse" },
		{ id: "invoice", label: "Send invoice", kind: "process", lane: "billing" },
		{ id: "pay", label: "Pay the invoice", kind: "process", lane: "customer" },
		{ id: "record", label: "Record payment", kind: "end", lane: "billing" },
	],
	edges: [
		{ id: "e1", source: "place", target: "review" },
		{ id: "e2", source: "review", target: "stock" },
		{ id: "e3", source: "stock", target: "backorder", label: "no" },
		{ id: "e4", source: "stock", target: "pick", label: "yes" },
		{ id: "e5", source: "pick", target: "pack" },
		{ id: "e6", source: "pack", target: "ship" },
		{ id: "e7", source: "ship", target: "invoice" },
		{ id: "e8", source: "invoice", target: "pay" },
		{ id: "e9", source: "pay", target: "record" },
	],
} as const;
