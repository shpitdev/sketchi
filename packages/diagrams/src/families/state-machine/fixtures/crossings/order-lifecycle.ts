/**
 * An order lifecycle with two cancellations converging on Cancelled. From a
 * generated eval sample, and the capture round 16 drew most often, its return
 * label under the Paid to Cancelled run.
 */
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
		},
		{
			id: "refunded",
			label: "Refunded",
		},
		{
			id: "end",
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
		{
			id: "transition-9-cancelled-end",
			source: "cancelled",
			target: "end",
		},
		{
			id: "transition-10-refunded-end",
			source: "refunded",
			target: "end",
		},
	],
} as const;
