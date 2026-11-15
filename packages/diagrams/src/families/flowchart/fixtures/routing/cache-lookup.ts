/**
 * A request flow whose second column opens with a decision: a TB column runs
 * about 3:1 and wraps after the cache check, so the flow steps through the gap
 * between columns into the decision, whose two branches must leave by other
 * vertices. A row wraps before the cache check.
 */
export default {
	id: "cache-lookup",
	title: "Answer a question from the cache or the model",
	nodes: [
		{ id: "host", label: "App receives the question", kind: "start" },
		{ id: "page", label: "Page sends the question to the API", kind: "process" },
		{ id: "auth", label: "Authenticate the user", kind: "process" },
		{ id: "limit", label: "Apply the rate limit", kind: "process" },
		{ id: "cache", label: "Check the answer cache", kind: "process" },
		{ id: "hit", label: "Cache hit?", kind: "decision" },
		{ id: "cached", label: "Return the cached answer", kind: "end" },
		{ id: "model", label: "Call the language model", kind: "process" },
		{ id: "store", label: "Store the answer in the cache", kind: "process" },
		{ id: "log", label: "Log any errors", kind: "process" },
		{ id: "answer", label: "Return the answer", kind: "end" },
	],
	edges: [
		{ id: "ask", source: "host", target: "page" },
		{ id: "verify", source: "page", target: "auth" },
		{ id: "throttle", source: "auth", target: "limit" },
		{ id: "lookup", source: "limit", target: "cache" },
		{ id: "check", source: "cache", target: "hit" },
		{ id: "hit-yes", source: "hit", target: "cached", label: "Yes" },
		{ id: "hit-no", source: "hit", target: "model", label: "No" },
		{ id: "keep", source: "model", target: "store" },
		{ id: "trace", source: "store", target: "log" },
		{ id: "reply", source: "log", target: "answer" },
	],
} as const;
