/**
 * The hybrid setup with labeled lines, its orders table and invoice archive one
 * rank in a band hanging under the sync function, so the archive stands behind
 * the table. From a generated eval sample (Sonnet, round 19, sample 3), whose
 * lines to both hooked around the region's margin.
 */
export default {
	id: "hybrid-cloud-labeled",
	title: "Hybrid setup: on-prem data center to AWS",
	groups: [
		{ id: "dc", label: "On-prem data center", kind: "datacenter" },
		{ id: "corp", label: "Corporate network", parent: "dc", kind: "zone" },
		{ id: "aws", label: "AWS cloud", kind: "cloud" },
		{ id: "reg", label: "eu-west-1", parent: "aws", kind: "region" },
		{ id: "vpc", label: "Production VPC", parent: "reg", kind: "vpc" },
		{ id: "priv", label: "Private subnet", parent: "vpc", kind: "subnet" },
	],
	nodes: [
		{ id: "staff", label: "Office staff enter orders", kind: "start", group: "corp" },
		{ id: "erp", label: "Legacy ERP", kind: "process", group: "corp" },
		{
			id: "ora",
			label: "Oracle database",
			kind: "end",
			group: "dc",
			shape: "database",
		},
		{ id: "vpn", label: "Site-to-site VPN gateway", kind: "process", group: "vpc" },
		{ id: "api", label: "Order API", kind: "process", group: "priv" },
		{ id: "q", label: "Order queue", kind: "process", group: "reg", shape: "queue" },
		{ id: "sync", label: "Sync function", kind: "process", group: "reg" },
		{ id: "tbl", label: "Orders table", kind: "end", group: "reg", shape: "database" },
		{ id: "arc", label: "Invoice archive (PDF)", kind: "end", group: "reg", shape: "document" },
	],
	edges: [
		{ id: "edge-1", source: "staff", target: "erp" },
		{ id: "edge-2", source: "erp", target: "ora", label: "stores records" },
		{ id: "edge-3", source: "erp", target: "vpn", label: "sends orders" },
		{ id: "edge-4", source: "vpn", target: "api" },
		{ id: "edge-5", source: "api", target: "q" },
		{ id: "edge-6", source: "q", target: "sync" },
		{ id: "edge-7", source: "sync", target: "tbl", label: "writes orders" },
		{ id: "edge-8", source: "sync", target: "arc", label: "saves invoice PDF" },
	],
} as const;
