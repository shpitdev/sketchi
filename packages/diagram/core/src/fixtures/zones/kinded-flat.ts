/** Flat zones that only name their kind: two availability zones behind one balancer. */
export default {
	id: "kinded-flat",
	title: "Two availability zones",
	groups: [
		{ id: "az-a", label: "us-east-1a", kind: "zone" },
		{ id: "az-b", label: "us-east-1b", kind: "zone" },
	],
	nodes: [
		{ id: "lb", label: "Network Load Balancer", kind: "start" },
		{ id: "app-a", label: "App server A", kind: "process", group: "az-a" },
		{ id: "db-a", label: "Primary database", kind: "end", shape: "database", group: "az-a" },
		{ id: "app-b", label: "App server B", kind: "process", group: "az-b" },
		{ id: "db-b", label: "Standby replica", kind: "end", shape: "database", group: "az-b" },
	],
	edges: [
		{ id: "e1", source: "lb", target: "app-a" },
		{ id: "e2", source: "lb", target: "app-b" },
		{ id: "e3", source: "app-a", target: "db-a" },
		{ id: "e4", source: "app-b", target: "db-b" },
	],
} as const;
