/**
 * The hybrid setup with node descriptions, an Oracle logo and every line
 * labeled. Its region only wraps clear of crossings when its lines route
 * across as few others as they can; otherwise the data center stacks above the
 * cloud. From a generated eval sample (Sol, Oct 20).
 */
export default {
	id: "hybrid-cloud-described",
	title: "Hybrid order processing — on-premises to AWS",
	groups: [
		{ id: "dc", label: "On-prem data center", kind: "datacenter" },
		{ id: "corp", label: "Corporate network", parent: "dc" },
		{ id: "aws", label: "AWS cloud", kind: "cloud" },
		{ id: "region", label: "eu-west-1", parent: "aws", kind: "region" },
		{ id: "vpc", label: "Production VPC", parent: "region", kind: "vpc" },
		{ id: "private", label: "Private subnet", parent: "vpc", kind: "subnet" },
	],
	nodes: [
		{
			id: "staff",
			label: "Office staff",
			kind: "start",
			description: "Enter orders",
			group: "corp",
		},
		{ id: "erp", label: "Legacy ERP", kind: "process", group: "corp" },
		{
			id: "oracle",
			label: "Oracle database",
			kind: "end",
			description: "Stores records",
			icon: { slug: "oracle" },
			group: "dc",
			shape: "database",
		},
		{ id: "vpn", label: "Site-to-site VPN gateway", kind: "process", group: "vpc" },
		{ id: "api", label: "Order API", kind: "process", group: "private" },
		{ id: "queue", label: "Order queue", kind: "process", group: "region", shape: "queue" },
		{ id: "sync", label: "Sync function", kind: "process", group: "region" },
		{ id: "table", label: "Orders table", kind: "end", group: "region", shape: "database" },
		{
			id: "archive",
			label: "Invoice archive",
			kind: "end",
			description: "Each invoice saved as a PDF document",
			group: "region",
			shape: "storage",
		},
	],
	edges: [
		{ id: "edge-1", source: "staff", target: "erp", label: "Enter orders" },
		{ id: "edge-2", source: "erp", target: "oracle", label: "Stores records" },
		{ id: "edge-3", source: "erp", target: "vpn", label: "Sends orders" },
		{ id: "edge-4", source: "vpn", target: "api", label: "Passes orders" },
		{ id: "edge-5", source: "api", target: "queue", label: "Puts each order" },
		{ id: "edge-6", source: "queue", target: "sync", label: "Takes orders" },
		{ id: "edge-7", source: "sync", target: "table", label: "Writes orders" },
		{ id: "edge-8", source: "sync", target: "archive", label: "Saves invoice PDFs" },
	],
} as const;
