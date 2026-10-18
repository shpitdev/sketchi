/** A request path through three network zones; its fixture reads left to right. */
export default {
	id: "three-zone-service",
	title: "Request path across network zones",
	groups: [
		{ id: "internet", label: "Public internet" },
		{ id: "edge", label: "Edge network" },
		{ id: "private", label: "Private subnet" },
	],
	nodes: [
		{ id: "browser", label: "Browser sends request", kind: "start", group: "internet" },
		{ id: "cdn", label: "CDN serves cache", kind: "process", group: "edge" },
		{ id: "cached", label: "Cache hit?", kind: "decision", group: "edge" },
		{ id: "waf", label: "WAF filters traffic", kind: "process", group: "edge" },
		{ id: "api", label: "API handles request", kind: "process", group: "private" },
		{ id: "db", label: "Query the database", kind: "process", group: "private" },
		{ id: "response", label: "Response returned", kind: "end" },
	],
	edges: [
		{ id: "e1", source: "browser", target: "cdn" },
		{ id: "e2", source: "cdn", target: "cached" },
		{ id: "e3", source: "cached", target: "response", label: "hit" },
		{ id: "e4", source: "cached", target: "waf", label: "miss" },
		{ id: "e5", source: "waf", target: "api" },
		{ id: "e6", source: "api", target: "db" },
		{ id: "e7", source: "db", target: "response" },
	],
} as const;
