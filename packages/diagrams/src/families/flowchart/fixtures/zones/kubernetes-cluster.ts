/**
 * A Kubernetes cluster: an ingress namespace, a frontend namespace and a
 * backend namespace of services and pods, with a managed database and a
 * message queue outside the cluster.
 */
export default {
	id: "kubernetes-cluster",
	title: "Kubernetes cluster",
	groups: [
		{ id: "cluster", label: "GKE cluster", kind: "cluster" },
		{ id: "edge", label: "ingress-nginx", kind: "namespace", parent: "cluster" },
		{ id: "frontend", label: "frontend", kind: "namespace", parent: "cluster" },
		{ id: "backend", label: "backend", kind: "namespace", parent: "cluster" },
	],
	nodes: [
		{ id: "client", label: "Browser", kind: "start" },
		{ id: "ingress", label: "Ingress controller", kind: "process", group: "edge" },
		{ id: "web-svc", label: "web Service", kind: "process", group: "frontend" },
		{ id: "web-pods", label: "web Pods", kind: "process", group: "frontend" },
		{ id: "api-svc", label: "api Service", kind: "process", group: "backend" },
		{ id: "api-pods", label: "api Pods", kind: "process", group: "backend" },
		{ id: "worker", label: "worker Pods", kind: "process", group: "backend" },
		{ id: "queue", label: "RabbitMQ jobs queue", kind: "process", shape: "queue" },
		{ id: "db", label: "Cloud SQL Postgres", kind: "end", shape: "database" },
	],
	edges: [
		{ id: "e1", source: "client", target: "ingress" },
		{ id: "e2", source: "ingress", target: "web-svc" },
		{ id: "e3", source: "web-svc", target: "web-pods" },
		{ id: "e4", source: "web-pods", target: "api-svc" },
		{ id: "e5", source: "api-svc", target: "api-pods" },
		{ id: "e6", source: "api-pods", target: "db" },
		{ id: "e7", source: "api-pods", target: "queue" },
		{ id: "e8", source: "queue", target: "worker" },
		{ id: "e9", source: "worker", target: "db" },
	],
} as const;
