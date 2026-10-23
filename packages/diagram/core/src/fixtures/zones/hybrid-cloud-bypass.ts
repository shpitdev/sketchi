/**
 * The hybrid setup whose ERP sends orders past the Oracle database it also
 * stores records in: the line to the VPN gateway runs under the database's
 * foot. From a generated eval sample (Sonnet, round 21, sample 1), where it
 * ran along the foot's outline.
 */
export default {
	id: "hybrid-cloud-bypass",
	title: "Hybrid setup",
	groups: [
		{ id: "dc", label: "On-prem data center", kind: "datacenter" },
		{ id: "corp", label: "Corporate network", parent: "dc", kind: "zone" },
		{ id: "aws", label: "AWS cloud", kind: "cloud" },
		{ id: "region", label: "eu-west-1", parent: "aws", kind: "region" },
		{ id: "vpc", label: "Production VPC", parent: "region", kind: "vpc" },
		{ id: "private", label: "Private subnet", parent: "vpc", kind: "subnet" },
	],
	nodes: [
		{ id: "staff", label: "Office staff", kind: "start", group: "corp" },
		{ id: "erp", label: "Legacy ERP", kind: "process", group: "corp" },
		{
			id: "oracle",
			label: "Oracle database",
			kind: "end",
			icon: { slug: "oracle" },
			group: "dc",
			shape: "database",
		},
		{ id: "vpn", label: "Site-to-site VPN gateway", kind: "process", group: "vpc" },
		{ id: "api", label: "Order API", kind: "process", group: "private" },
		{ id: "queue", label: "Order queue", kind: "process", group: "region", shape: "queue" },
		{ id: "sync", label: "Sync function", kind: "process", group: "region" },
		{ id: "orders", label: "Orders table", kind: "end", group: "region", shape: "database" },
		{ id: "archive", label: "Invoice archive", kind: "end", group: "region", shape: "document" },
	],
	edges: [
		{ id: "edge-1", source: "staff", target: "erp", label: "enters orders" },
		{ id: "edge-2", source: "erp", target: "oracle", label: "stores records" },
		{ id: "edge-3", source: "erp", target: "vpn", label: "sends orders" },
		{ id: "edge-4", source: "vpn", target: "api" },
		{ id: "edge-5", source: "api", target: "queue", label: "puts orders" },
		{ id: "edge-6", source: "queue", target: "sync" },
		{ id: "edge-7", source: "sync", target: "orders", label: "writes orders" },
		{ id: "edge-8", source: "sync", target: "archive", label: "saves invoice PDF" },
	],
} as const;
