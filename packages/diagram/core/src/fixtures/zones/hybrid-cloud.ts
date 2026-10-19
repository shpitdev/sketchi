/**
 * A hybrid setup: an on-premises data center with its corporate network,
 * joined by a VPN to a VPC in a cloud region, where orders queue for a sync
 * function that writes them to a cloud database and archives each invoice.
 */
export default {
	id: "hybrid-cloud",
	title: "Hybrid on-prem and cloud",
	groups: [
		{ id: "onprem", label: "On-prem data center", kind: "datacenter" },
		{ id: "corp", label: "Corporate network", kind: "zone", parent: "onprem" },
		{ id: "aws", label: "AWS", kind: "cloud" },
		{ id: "region", label: "eu-west-1", kind: "region", parent: "aws" },
		{ id: "vpc", label: "Production VPC", kind: "vpc", parent: "region" },
		{ id: "private", label: "Private subnet", kind: "subnet", parent: "vpc" },
	],
	nodes: [
		{ id: "staff", label: "Office staff", kind: "start", group: "corp" },
		{ id: "erp", label: "Legacy ERP", kind: "process", group: "corp" },
		{ id: "oracle", label: "Oracle database", kind: "end", shape: "database", group: "onprem" },
		{ id: "vpn", label: "Site-to-site VPN", kind: "process", group: "vpc" },
		{ id: "api", label: "Order API", kind: "process", group: "private" },
		{ id: "orders", label: "Order queue", kind: "process", shape: "queue", group: "region" },
		{ id: "sync", label: "Sync function", kind: "process", group: "region" },
		{ id: "dynamo", label: "Orders table", kind: "end", shape: "database", group: "region" },
		{ id: "invoice", label: "Invoice archive", kind: "end", shape: "document", group: "region" },
	],
	edges: [
		{ id: "e1", source: "staff", target: "erp" },
		{ id: "e2", source: "erp", target: "oracle" },
		{ id: "e3", source: "erp", target: "vpn" },
		{ id: "e4", source: "vpn", target: "api" },
		{ id: "e5", source: "api", target: "orders" },
		{ id: "e6", source: "orders", target: "sync" },
		{ id: "e7", source: "sync", target: "dynamo" },
		{ id: "e8", source: "sync", target: "invoice" },
	],
} as const;
