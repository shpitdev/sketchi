/**
 * The three-zone request path asked for left to right, whose public internet,
 * DMZ and private subnet a top-level wrap stacked one under another: two bands
 * missed the target aspect, so three did. From a generated eval sample (Sol,
 * the real-voice v2 prompt, #596).
 */
export default {
	id: "web-request-across-three-network-zones",
	title: "Web request across three network zones",
	nodes: [
		{
			id: "browser",
			label: "Browser sends a request",
			kind: "start",
			group: "public",
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
			id: "cached",
			label: "Return cached page",
			kind: "end",
			group: "dmz",
		},
		{
			id: "waf",
			label: "WAF",
			kind: "process",
			group: "dmz",
		},
		{
			id: "filter",
			label: "Filter the request",
			kind: "process",
			group: "dmz",
		},
		{
			id: "api",
			label: "API server handles the request",
			kind: "process",
			group: "private",
		},
		{
			id: "db",
			label: "Query the database",
			kind: "process",
			group: "private",
			shape: "database",
		},
		{
			id: "response",
			label: "Return response",
			kind: "end",
			group: "private",
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
			target: "cached",
			label: "Hit",
		},
		{
			id: "edge-4",
			source: "hit",
			target: "waf",
			label: "Miss",
		},
		{
			id: "edge-5",
			source: "waf",
			target: "filter",
		},
		{
			id: "edge-6",
			source: "filter",
			target: "api",
		},
		{
			id: "edge-7",
			source: "api",
			target: "db",
		},
		{
			id: "edge-8",
			source: "db",
			target: "response",
		},
	],
	groups: [
		{
			id: "public",
			label: "Public internet",
		},
		{
			id: "dmz",
			label: "DMZ",
		},
		{
			id: "private",
			label: "Private subnet",
			kind: "subnet",
		},
	],
} as const;
