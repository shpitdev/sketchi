/** Exact round-16 Sol capture: the return label sat under the Paid to Cancelled run, nearer it than its own line. */
export default {
	id: "order-lifecycle",
	title: "Order lifecycle",
	initial: "pending",
	states: [
		{
			id: "pending",
			label: "Pending payment",
		},
		{
			id: "paid",
			label: "Paid",
		},
		{
			id: "shipped",
			label: "Shipped",
		},
		{
			id: "delivered",
			label: "Delivered",
		},
		{
			id: "cancelled",
			label: "Cancelled",
			kind: "final",
		},
		{
			id: "refunded",
			label: "Refunded",
			kind: "final",
		},
		{
			id: "end",
			label: "Lifecycle ended",
			kind: "final",
		},
	],
	transitions: [
		{
			id: "transition-1-pending-paid",
			source: "pending",
			target: "paid",
			event: "pay",
			guard: "card valid",
			action: "charge card",
		},
		{
			id: "transition-2-pending-cancelled",
			source: "pending",
			target: "cancelled",
			event: "cancel",
		},
		{
			id: "transition-3-paid-shipped",
			source: "paid",
			target: "shipped",
			event: "ship",
		},
		{
			id: "transition-4-paid-cancelled",
			source: "paid",
			target: "cancelled",
			event: "cancel",
			action: "refund payment",
		},
		{
			id: "transition-5-shipped-delivered",
			source: "shipped",
			target: "delivered",
			event: "deliver",
		},
		{
			id: "transition-6-shipped-paid",
			source: "shipped",
			target: "paid",
			event: "return to sender",
		},
		{
			id: "transition-7-delivered-refunded",
			source: "delivered",
			target: "refunded",
			event: "request return",
			guard: "within 30 days",
			action: "issue refund",
		},
		{
			id: "transition-8-delivered-end",
			source: "delivered",
			target: "end",
		},
	],
} as const;
