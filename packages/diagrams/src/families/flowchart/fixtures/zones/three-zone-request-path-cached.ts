/**
 * The three-zone request path whose cached page goes straight to a response
 * outside every zone, past the private subnet, so the only cut that carried no
 * line skipping ranks hung the DMZ under the public internet. From a generated
 * eval sample (Sonnet, the real-voice v2 prompt, #596).
 */
export default {
	id: "web-request-across-network-zones",
	title: "Web request across network zones",
	nodes: [
		{
			id: "browser",
			label: "Browser",
			kind: "start",
			description: "Sends a request",
			group: "pub",
		},
		{
			id: "cache",
			label: "Cache hit?",
			kind: "decision",
			group: "dmz",
		},
		{
			id: "cached",
			label: "Return cached page",
			kind: "process",
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
			label: "request",
		},
		{
			id: "edge-2",
			source: "cache",
			target: "cached",
			label: "yes",
		},
		{
			id: "edge-3",
			source: "cache",
			target: "waf",
			label: "no",
		},
		{
			id: "edge-4",
			source: "waf",
			target: "api",
		},
		{
			id: "edge-5",
			source: "api",
			target: "db",
		},
		{
			id: "edge-6",
			source: "db",
			target: "resp",
		},
		{
			id: "edge-7",
			source: "cached",
			target: "resp",
		},
	],
	groups: [
		{
			id: "pub",
			label: "Public internet",
			kind: "zone",
		},
		{
			id: "dmz",
			label: "DMZ",
			kind: "zone",
		},
		{
			id: "priv",
			label: "Private subnet",
			kind: "subnet",
		},
	],
} as const;
