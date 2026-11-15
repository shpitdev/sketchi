/**
 * The ten-node hybrid setup whose region's wrap beside the data center left
 * the sync function's lines to the orders table and the invoice PDF crossing
 * once, which one line's side change removes, so the data center stacked
 * above the cloud. From a generated eval sample (Sol, the #538 A/B, sample 1).
 */
export default {
	id: "hybrid-order-processing",
	title: "Hybrid order processing",
	nodes: [
		{
			id: "staff",
			label: "Office staff",
			kind: "start",
			description: "Enter orders",
			group: "corp",
		},
		{
			id: "erp",
			label: "Legacy ERP",
			kind: "process",
			group: "corp",
		},
		{
			id: "oracle",
			label: "Oracle database",
			kind: "end",
			icon: {
				slug: "oracle",
			},
			group: "dc",
			shape: "database",
		},
		{
			id: "vpn",
			label: "Site-to-site VPN gateway",
			kind: "process",
			group: "vpc",
		},
		{
			id: "api",
			label: "Order API",
			kind: "process",
			group: "private",
		},
		{
			id: "queue",
			label: "Order queue",
			kind: "process",
			group: "region",
			shape: "queue",
		},
		{
			id: "sync",
			label: "Sync function",
			kind: "process",
			group: "region",
		},
		{
			id: "table",
			label: "Orders table",
			kind: "end",
			group: "region",
			shape: "database",
		},
		{
			id: "pdf",
			label: "Invoice PDF document",
			kind: "process",
			group: "region",
			shape: "document",
		},
		{
			id: "archive",
			label: "Invoice archive",
			kind: "end",
			group: "region",
			shape: "storage",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "staff",
			target: "erp",
			label: "Enter orders",
		},
		{
			id: "edge-2",
			source: "erp",
			target: "oracle",
			label: "Store records",
		},
		{
			id: "edge-3",
			source: "erp",
			target: "vpn",
			label: "Send orders",
		},
		{
			id: "edge-4",
			source: "vpn",
			target: "api",
			label: "Pass orders",
		},
		{
			id: "edge-5",
			source: "api",
			target: "queue",
			label: "Put each order",
		},
		{
			id: "edge-6",
			source: "queue",
			target: "sync",
			label: "Take orders",
		},
		{
			id: "edge-7",
			source: "sync",
			target: "table",
			label: "Write orders",
		},
		{
			id: "edge-8",
			source: "sync",
			target: "pdf",
			label: "Save each invoice as PDF",
		},
		{
			id: "edge-9",
			source: "pdf",
			target: "archive",
			label: "Store",
		},
	],
	groups: [
		{
			id: "dc",
			label: "On-prem data center",
			kind: "datacenter",
		},
		{
			id: "corp",
			label: "Corporate network",
			parent: "dc",
		},
		{
			id: "aws",
			label: "AWS cloud",
			kind: "cloud",
		},
		{
			id: "region",
			label: "eu-west-1",
			parent: "aws",
			kind: "region",
		},
		{
			id: "vpc",
			label: "Production VPC",
			parent: "region",
			kind: "vpc",
		},
		{
			id: "private",
			label: "Private subnet",
			parent: "vpc",
			kind: "subnet",
		},
	],
} as const;
