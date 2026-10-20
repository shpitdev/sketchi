/**
 * The three-tier AWS app as models describe it: short labels with the
 * technology in a description, which draws as a subtitle under the label.
 */
export default {
	id: "aws-three-tier-described",
	title: "AWS three-tier app",
	groups: [
		{ id: "region", label: "us-east-1", kind: "region" },
		{ id: "vpc", label: "VPC", kind: "vpc", parent: "region" },
		{ id: "public", label: "Public subnet", kind: "subnet", parent: "vpc" },
		{ id: "private", label: "Private subnet", kind: "subnet", parent: "vpc" },
		{ id: "data", label: "Database subnet", kind: "subnet", parent: "vpc" },
	],
	nodes: [
		{ id: "users", label: "Users", kind: "start", description: "Send requests" },
		{ id: "alb", label: "Application Load Balancer", kind: "process", group: "public" },
		{
			id: "web",
			label: "Web service",
			kind: "process",
			description: "ECS Fargate",
			group: "private",
		},
		{
			id: "api",
			label: "API service",
			kind: "process",
			description: "ECS Fargate, two tasks behind the load balancer",
			group: "private",
		},
		{
			id: "rds",
			label: "RDS PostgreSQL",
			kind: "end",
			shape: "database",
			icon: { slug: "postgresql" },
			description: "Multi-AZ primary",
			group: "data",
		},
		{ id: "s3", label: "S3 bucket", kind: "end", shape: "storage", group: "region" },
	],
	edges: [
		{ id: "e1", source: "users", target: "alb", label: "requests" },
		{ id: "e2", source: "alb", target: "web", label: "routes" },
		{ id: "e3", source: "alb", target: "api", label: "routes" },
		{ id: "e4", source: "web", target: "rds", label: "queries" },
		{ id: "e5", source: "api", target: "rds", label: "queries" },
		{ id: "e6", source: "api", target: "s3", label: "stores uploads" },
	],
} as const;
