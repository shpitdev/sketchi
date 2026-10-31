/**
 * The hybrid setup asked for left to right, whose cloud a top-level wrap hung
 * under the data center, the ERP's line running down and back left to the VPN
 * gateway. From a generated eval sample (Sol, the real-voice v2 prompt, #584).
 */
export default {
	id: "hybrid-order-processing-aws-eu-west-1",
	title: "Hybrid order processing — AWS eu-west-1",
	nodes: [
		{
			id: "staff",
			label: "Office staff",
			kind: "start",
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
			id: "archive",
			label: "Invoice archive",
			kind: "end",
			description: "Invoices saved as PDFs",
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
		},
		{
			id: "edge-4",
			source: "vpn",
			target: "api",
		},
		{
			id: "edge-5",
			source: "api",
			target: "queue",
		},
		{
			id: "edge-6",
			source: "queue",
			target: "sync",
		},
		{
			id: "edge-7",
			source: "sync",
			target: "table",
		},
		{
			id: "edge-8",
			source: "sync",
			target: "archive",
			label: "Save each invoice as a PDF",
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
