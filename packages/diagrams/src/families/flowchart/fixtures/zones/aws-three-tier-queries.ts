/**
 * The three-tier AWS app as models drew it, both services querying one
 * database: the API's queries once dipped below the database to hook up into
 * its foot, and the users' requests swung out around the region's name to
 * drop into the load balancer. From a generated eval sample.
 */
export default {
	id: "aws-architecture",
	title: "AWS Architecture",
	groups: [
		{ id: "region", label: "us-east-1", kind: "region" },
		{ id: "vpc", label: "VPC", parent: "region", kind: "vpc" },
		{ id: "pub", label: "Public subnet", parent: "vpc", kind: "subnet" },
		{ id: "priv", label: "Private subnet", parent: "vpc", kind: "subnet" },
		{ id: "dbs", label: "Database subnet", parent: "vpc", kind: "subnet" },
	],
	nodes: [
		{ id: "users", label: "Users", kind: "start" },
		{ id: "alb", label: "Application Load Balancer", kind: "process", group: "pub" },
		{ id: "web", label: "Web service", kind: "process", group: "priv" },
		{ id: "api", label: "API service", kind: "process", group: "priv" },
		{
			id: "rds",
			label: "RDS PostgreSQL",
			kind: "end",
			icon: { slug: "postgresql" },
			group: "dbs",
			shape: "database",
		},
		{ id: "s3", label: "S3 bucket", kind: "end", group: "region", shape: "storage" },
	],
	edges: [
		{ id: "edge-1", source: "users", target: "alb", label: "requests" },
		{ id: "edge-2", source: "alb", target: "web" },
		{ id: "edge-3", source: "alb", target: "api" },
		{ id: "edge-4", source: "web", target: "rds", label: "queries" },
		{ id: "edge-5", source: "api", target: "rds", label: "queries" },
		{ id: "edge-6", source: "api", target: "s3", label: "stores uploads" },
	],
	style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
} as const;
