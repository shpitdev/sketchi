import { parseIntermediateDiagram, type IntermediateDiagram } from "./intermediate.js";
import { parseFlowchartDiagram } from "./types/flowchart.js";
import awsThreeTier from "./fixtures/zones/aws-three-tier.js";
import hybridCloud from "./fixtures/zones/hybrid-cloud.js";
import kindedFlat from "./fixtures/zones/kinded-flat.js";
import kubernetesCluster from "./fixtures/zones/kubernetes-cluster.js";

function flowchart(fixture: object, direction: "LR" | "TB" = "LR") {
	return parseFlowchartDiagram({
		...fixture,
		type: "flowchart",
		layout: { direction, edgeRouting: "orthogonal" },
	});
}

/**
 * Architecture flowcharts with nested zones and infrastructure shapes: an AWS
 * three-tier app, a Kubernetes cluster, a hybrid on-prem and cloud setup, and
 * flat zones that only name their kind. Every node must sit in its zone, every
 * zone inside its parent and apart from its siblings, and edges must cross
 * zone outlines without running along them.
 */
export const zoneFixtures = {
	"aws-three-tier": flowchart(awsThreeTier),
	"kubernetes-cluster": flowchart(kubernetesCluster, "TB"),
	"hybrid-cloud": flowchart(hybridCloud),
	"kinded-flat": flowchart(kindedFlat, "TB"),
};

/** Zones of the thirty-node stress case, each with its parent and kind. */
const STRESS_ZONES = [
	{ id: "aws", label: "AWS", kind: "cloud" },
	{ id: "region", label: "us-east-1", kind: "region", parent: "aws" },
	{ id: "vpc", label: "Production VPC", kind: "vpc", parent: "region" },
	{ id: "public", label: "Public subnet", kind: "subnet", parent: "vpc" },
	{ id: "app", label: "App subnet", kind: "subnet", parent: "vpc" },
	{ id: "data", label: "Data subnet", kind: "subnet", parent: "vpc" },
	{ id: "onprem", label: "On-prem data center", kind: "datacenter" },
	{ id: "corp", label: "Corporate network", kind: "zone", parent: "onprem" },
] as const;

/** Thirty services in flow order, each with its zone (none for the two outside). */
const STRESS_NODES: readonly (readonly [label: string, zone?: string, shape?: string])[] = [
	["Customers"],
	["CloudFront CDN", "aws"],
	["WAF rules", "region"],
	["Route 53 DNS", "region"],
	["Load balancer", "public"],
	["NAT gateway", "public"],
	["Bastion host", "public"],
	["Web frontend", "app"],
	["Auth service", "app"],
	["Catalog service", "app"],
	["Cart service", "app"],
	["Checkout service", "app"],
	["Payments service", "app"],
	["Session cache", "data", "database"],
	["Catalog database", "data", "database"],
	["Orders database", "data", "database"],
	["Order events", "region", "queue"],
	["Email worker", "vpc"],
	["Invoice renderer", "vpc"],
	["Invoice PDFs", "region", "document"],
	["Analytics stream", "region", "queue"],
	["Data warehouse", "aws", "database"],
	["VPN gateway", "vpc"],
	["Corporate VPN", "corp"],
	["ERP sync", "corp"],
	["ERP system", "corp"],
	["Finance team", "corp"],
	["Mainframe ledger", "onprem", "database"],
	["Audit log", "onprem", "document"],
	["Partners"],
];

/** Forward edges of the stress flow, by node index. */
const STRESS_EDGES: readonly (readonly [number, number])[] = [
	[0, 1],
	[1, 2],
	[2, 4],
	[3, 4],
	[0, 3],
	[4, 7],
	[5, 7],
	[6, 8],
	[7, 8],
	[7, 9],
	[7, 10],
	[10, 11],
	[11, 12],
	[8, 13],
	[9, 14],
	[11, 15],
	[12, 15],
	[11, 16],
	[16, 17],
	[16, 18],
	[18, 19],
	[16, 20],
	[20, 21],
	[12, 22],
	[22, 23],
	[23, 24],
	[24, 25],
	[25, 26],
	[25, 27],
	[24, 28],
	[29, 22],
];

/**
 * Zoned graphs past a flowchart's limits, drawn straight from the graph
 * contract: zones four deep across two availability zones, and thirty
 * services in eight zones, from a cloud down to its subnets and an on-prem
 * data center.
 */
export const zoneStressFixtures: Readonly<
	Record<"depth-four" | "thirty-services", IntermediateDiagram>
> = {
	"depth-four": parseIntermediateDiagram({
		id: "depth-four",
		title: "Two availability zones, four zones deep",
		type: "flowchart",
		groups: [
			{ id: "region", label: "us-west-2", kind: "region" },
			{ id: "vpc", label: "VPC", kind: "vpc", parent: "region" },
			{ id: "az-a", label: "us-west-2a", kind: "zone", parent: "vpc" },
			{ id: "az-b", label: "us-west-2b", kind: "zone", parent: "vpc" },
			{ id: "public-a", label: "Public subnet A", kind: "subnet", parent: "az-a" },
			{ id: "private-a", label: "Private subnet A", kind: "subnet", parent: "az-a" },
			{ id: "public-b", label: "Public subnet B", kind: "subnet", parent: "az-b" },
			{ id: "private-b", label: "Private subnet B", kind: "subnet", parent: "az-b" },
		],
		nodes: [
			{ id: "users", label: "Users", kind: "start" },
			{ id: "alb", label: "Load balancer", kind: "process", group: "vpc" },
			{ id: "web-a", label: "Web server A", kind: "process", group: "public-a" },
			{ id: "web-b", label: "Web server B", kind: "process", group: "public-b" },
			{ id: "app-a", label: "App server A", kind: "process", group: "private-a" },
			{ id: "app-b", label: "App server B", kind: "process", group: "private-b" },
			{ id: "db-a", label: "Primary database", kind: "end", shape: "database", group: "private-a" },
			{ id: "db-b", label: "Standby database", kind: "end", shape: "database", group: "private-b" },
			{ id: "s3", label: "Backups bucket", kind: "end", shape: "storage", group: "region" },
		],
		edges: [
			{ id: "e1", source: "users", target: "alb" },
			{ id: "e2", source: "alb", target: "web-a" },
			{ id: "e3", source: "alb", target: "web-b" },
			{ id: "e4", source: "web-a", target: "app-a" },
			{ id: "e5", source: "web-b", target: "app-b" },
			{ id: "e6", source: "app-a", target: "db-a" },
			{ id: "e7", source: "app-b", target: "db-b" },
			{ id: "e8", source: "db-a", target: "db-b", label: "replicates" },
			{ id: "e9", source: "db-a", target: "s3", label: "backs up" },
		],
		layout: { direction: "LR", edgeRouting: "orthogonal" },
	}),
	"thirty-services": parseIntermediateDiagram({
		id: "thirty-services",
		title: "Thirty services in eight zones",
		type: "flowchart",
		groups: STRESS_ZONES,
		nodes: STRESS_NODES.map(([label, zone, shape], index) => ({
			id: `s${index}`,
			label,
			kind: index === 0 ? "start" : "process",
			...(zone ? { group: zone } : {}),
			...(shape ? { shape } : {}),
		})),
		edges: STRESS_EDGES.map(([source, target], index) => ({
			id: `e${index}`,
			source: `s${source}`,
			target: `s${target}`,
		})),
		layout: { direction: "LR", edgeRouting: "orthogonal" },
	}),
};
