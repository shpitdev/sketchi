/**
 * The three-zone request path whose cache decision's hit branch goes straight
 * to a response outside every zone, past the private subnet, which hung the
 * DMZ under the public internet. From a generated eval sample (Sonnet, the
 * real-voice v2 prompt, #596).
 */
export default {
	id: "web-request-across-network-zones",
	title: "Web Request Across Network Zones",
	nodes: [
		{
			id: "browser",
			label: "Browser sends request",
			kind: "start",
			group: "pub",
		},
		{
			id: "cache",
			label: "CDN checks its cache",
			kind: "process",
			group: "dmz",
		},
		{
			id: "hit",
			label: "Cache hit?",
			kind: "decision",
			group: "dmz",
		},
		{
			id: "waf",
			label: "WAF filters request",
			kind: "process",
			group: "dmz",
		},
		{
			id: "api",
			label: "API server handles request",
			kind: "process",
			group: "priv",
		},
		{
			id: "db",
			label: "Query database",
			kind: "process",
			group: "priv",
			shape: "database",
		},
		{
			id: "resp",
			label: "Response returned",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "browser",
			target: "cache",
		},
		{
			id: "edge-2",
			source: "cache",
			target: "hit",
		},
		{
			id: "edge-3",
			source: "hit",
			target: "resp",
			label: "yes: cached page",
		},
		{
			id: "edge-4",
			source: "hit",
			target: "waf",
			label: "no",
		},
		{
			id: "edge-5",
			source: "waf",
			target: "api",
		},
		{
			id: "edge-6",
			source: "api",
			target: "db",
		},
		{
			id: "edge-7",
			source: "db",
			target: "resp",
		},
	],
	groups: [
		{
			id: "pub",
			label: "Public Internet",
			kind: "zone",
		},
		{
			id: "dmz",
			label: "DMZ",
			kind: "zone",
		},
		{
			id: "priv",
			label: "Private Subnet",
			kind: "subnet",
		},
	],
} as const;
