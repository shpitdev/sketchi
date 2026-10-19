/**
 * A three-tier AWS app: a load balancer in a public subnet, services in a
 * private subnet and a database in a database subnet, all inside a VPC in a
 * region, with a bucket in the region outside the VPC.
 */
export default {
	id: "aws-three-tier",
	title: "AWS three-tier app",
	groups: [
		{ id: "region", label: "us-east-1", kind: "region" },
		{ id: "vpc", label: "VPC 10.0.0.0/16", kind: "vpc", parent: "region" },
		{ id: "public", label: "Public subnet", kind: "subnet", parent: "vpc" },
		{ id: "private", label: "Private subnet", kind: "subnet", parent: "vpc" },
		{ id: "data", label: "Database subnet", kind: "subnet", parent: "vpc" },
	],
	nodes: [
		{ id: "users", label: "Users", kind: "start" },
		{ id: "alb", label: "Application Load Balancer", kind: "process", group: "public" },
		{ id: "web", label: "ECS web service", kind: "process", group: "private" },
		{ id: "api", label: "ECS API service", kind: "process", group: "private" },
		{ id: "rds", label: "RDS PostgreSQL", kind: "end", shape: "database", group: "data" },
		{ id: "s3", label: "S3 assets bucket", kind: "end", shape: "storage", group: "region" },
	],
	edges: [
		{ id: "e1", source: "users", target: "alb" },
		{ id: "e2", source: "alb", target: "web" },
		{ id: "e3", source: "alb", target: "api" },
		{ id: "e4", source: "web", target: "rds" },
		{ id: "e5", source: "api", target: "rds" },
		{ id: "e6", source: "api", target: "s3" },
	],
} as const;
