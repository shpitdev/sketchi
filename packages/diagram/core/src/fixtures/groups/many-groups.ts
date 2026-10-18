/** Stress case: six small groups, fan-out and fan-in between them. */
export default {
	id: "many-groups",
	title: "Release train across teams",
	groups: [
		{ id: "product", label: "Product" },
		{ id: "web", label: "Web team" },
		{ id: "mobile", label: "Mobile team" },
		{ id: "qa", label: "QA" },
		{ id: "ops", label: "Ops" },
		{ id: "marketing", label: "Marketing" },
	],
	nodes: [
		{ id: "plan", label: "Plan the release", kind: "start", group: "product" },
		{ id: "web-build", label: "Build web app", kind: "process", group: "web" },
		{ id: "mobile-build", label: "Build mobile app", kind: "process", group: "mobile" },
		{ id: "store", label: "Submit to app stores", kind: "process", group: "mobile" },
		{ id: "test", label: "Regression tests", kind: "process", group: "qa" },
		{ id: "pass", label: "Tests pass?", kind: "decision", group: "qa" },
		{ id: "deploy", label: "Deploy to production", kind: "process", group: "ops" },
		{ id: "announce", label: "Announce the release", kind: "end", group: "marketing" },
	],
	edges: [
		{ id: "e1", source: "plan", target: "web-build" },
		{ id: "e2", source: "plan", target: "mobile-build" },
		{ id: "e3", source: "mobile-build", target: "store" },
		{ id: "e4", source: "web-build", target: "test" },
		{ id: "e5", source: "store", target: "test" },
		{ id: "e6", source: "test", target: "pass" },
		{ id: "e7", source: "pass", target: "deploy", label: "yes" },
		{ id: "e8", source: "pass", target: "web-build", label: "no" },
		{ id: "e9", source: "deploy", target: "announce" },
	],
} as const;
