/**
 * The hybrid setup asked for left to right, whose corporate network holds the
 * data center, and whose cloud a top-level wrap hung under that network, the
 * ERP's line dropping to the VPN gateway. From a generated eval sample (Haiku,
 * the real-voice v2 prompt, 2026-11-08).
 */
export default {
	id: "hybrid-order-sync",
	title: "Hybrid order sync to AWS",
	nodes: [
		{ id: "staff", label: "Office staff enter orders", kind: "start", group: "corp" },
		{ id: "erp", label: "Legacy ERP", kind: "process", group: "dc" },
		{ id: "oracle", label: "Oracle database", kind: "end", group: "dc", shape: "database" },
		{ id: "vpn", label: "Site-to-site VPN gateway", kind: "process", group: "vpc" },
		{ id: "api", label: "Order API", kind: "process", group: "private" },
		{ id: "queue", label: "Order queue", kind: "process", group: "private", shape: "queue" },
		{ id: "sync", label: "Sync function", kind: "process", group: "private" },
		{ id: "orders", label: "Orders table", kind: "end", group: "private", shape: "database" },
		{ id: "archive", label: "Invoice archive", kind: "end", group: "private", shape: "storage" },
	],
	edges: [
		{ id: "edge-1", source: "staff", target: "erp" },
		{ id: "edge-2", source: "erp", target: "oracle", label: "stores records" },
		{ id: "edge-3", source: "erp", target: "vpn" },
		{ id: "edge-4", source: "vpn", target: "api" },
		{ id: "edge-5", source: "api", target: "queue" },
		{ id: "edge-6", source: "queue", target: "sync" },
		{ id: "edge-7", source: "sync", target: "orders" },
		{ id: "edge-8", source: "sync", target: "archive", label: "saves invoice PDF" },
	],
	groups: [
		{ id: "corp", label: "Corporate network", kind: "zone" },
		{ id: "dc", label: "On-prem data center", parent: "corp", kind: "datacenter" },
		{ id: "aws", label: "AWS cloud (eu-west-1)", kind: "cloud" },
		{ id: "vpc", label: "Production VPC (eu-west-1)", parent: "aws", kind: "vpc" },
		{ id: "private", label: "Private subnet", parent: "vpc", kind: "subnet" },
	],
} as const;
