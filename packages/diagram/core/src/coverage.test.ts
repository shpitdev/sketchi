import { describe, expect, it } from "vitest";

import { checkRequestCoverage, keepsStatedStructure } from "./coverage.js";

const codes = (request: string, diagram: unknown) =>
	checkRequestCoverage(request, diagram).map((issue) => issue.code);

describe("classes declared as code", () => {
	const request = `class diagram of a zoo. a zoo is made of its enclosures.

class Zoo {
	private String name;
	private List<Enclosure> enclosures;
}
class Enclosure {
	private int size;
	private Keeper keeper;
}
class Keeper {
	private String name;
	public void feed(Animal animal) { }
}
class Animal { }
class Lion extends Animal { }`;
	const classes = [
		{ id: "Zoo", attributes: [{ name: "name" }, { name: "enclosures" }] },
		{ id: "Enclosure", attributes: [{ name: "size" }, { name: "keeper" }] },
		{ id: "Keeper", attributes: [{ name: "name" }] },
		{ id: "Animal", attributes: [] },
		{ id: "Lion", attributes: [] },
	];
	const relationships = [
		{ id: "a", kind: "composition", from: "Zoo", to: "Enclosure" },
		{ id: "b", kind: "association", from: "Enclosure", to: "Keeper" },
		{ id: "c", kind: "dependency", from: "Keeper", to: "Animal" },
		{ id: "d", kind: "inheritance", from: "Lion", to: "Animal" },
	];

	it("passes a diagram that draws what the code declares", () => {
		expect(codes(request, { type: "class", classes, relationships })).toEqual([]);
	});

	it("reports a missing class, a dropped field and an unlinked typed field", () => {
		const diagram = {
			type: "class",
			classes: [{ id: "Zoo", attributes: [{ name: "name" }] }, ...classes.slice(1, 4)],
			relationships: relationships.filter((relationship) => relationship.id !== "b"),
		};
		expect(codes(request, diagram)).toEqual([
			"class_missing",
			"class_field_missing",
			"class_link_missing",
		]);
	});

	it("reports a missing generalization and a relationship nothing states", () => {
		const diagram = {
			type: "class",
			classes,
			relationships: [
				...relationships.filter((relationship) => relationship.id !== "d"),
				{ id: "e", kind: "composition", from: "Zoo", to: "Keeper" },
			],
		};
		expect(codes(request, diagram)).toEqual([
			"class_generalization_missing",
			"class_relationship_unstated",
		]);
	});

	it("reads a relationship the prose states as supported", () => {
		const prose = request.replace(
			"its enclosures.",
			"its enclosures, and every zoo employs keepers.",
		);
		const diagram = {
			type: "class",
			classes,
			relationships: [
				...relationships,
				{ id: "e", kind: "aggregation", from: "Zoo", to: "Keeper" },
			],
		};
		expect(codes(prose, diagram)).toEqual([]);
	});

	it("checks nothing in a class diagram described only in prose", () => {
		expect(
			codes("UML class diagram of a parking lot with levels and spots", {
				type: "class",
				classes: [{ id: "Lot", attributes: [] }],
				relationships: [],
			}),
		).toEqual([]);
	});
});

describe("tables declared as SQL", () => {
	const request = `ER diagram please
create table authors (id int primary key, name text not null);
create table books (id int primary key, title text, author_id int not null references authors(id));`;

	it("reports a missing column and a missing reference", () => {
		const diagram = {
			type: "er",
			entities: [
				{ id: "authors", fields: ["id int PK", "name text"] },
				{ id: "books", fields: ["id int PK", "author_id int FK"] },
			],
			relationships: [],
		};
		expect(codes(request, diagram)).toEqual(["er_column_missing", "er_reference_missing"]);
	});
});

describe("flowchart connections and containers", () => {
	const request =
		"draw our setup L→R: users → load balancer (edge subnet) → app + worker (app subnet) → database. both subnets are in the production VPC";
	const nodes = [
		{ id: "users", label: "Users" },
		{ id: "lb", label: "Load balancer", group: "edge" },
		{ id: "app", label: "App server", group: "apps" },
		{ id: "worker", label: "Background worker", group: "apps" },
		{ id: "db", label: "Database" },
	];
	const edges = [
		{ id: "1", source: "users", target: "lb" },
		{ id: "2", source: "lb", target: "app" },
		{ id: "3", source: "lb", target: "worker" },
		{ id: "4", source: "app", target: "db" },
		{ id: "5", source: "worker", target: "db" },
	];
	const groups = [
		{ id: "vpc", label: "Production VPC" },
		{ id: "edge", label: "Edge subnet", parent: "vpc" },
		{ id: "apps", label: "App subnet", parent: "vpc" },
	];

	it("passes a diagram with every arrow and every named zone", () => {
		expect(codes(request, { type: "flowchart", nodes, edges, groups })).toEqual([]);
	});

	it("reads a + b → c as two edges, and reports the missing one", () => {
		const diagram = { type: "flowchart", nodes, edges: edges.slice(0, 4), groups };
		const issues = checkRequestCoverage(request, diagram);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_connection_missing"]);
		expect(issues[0]?.message).toContain('"worker → database"');
	});

	it("catches a conditional prerequisite ending before the shared continuation", () => {
		const request =
			"Sensitive releases require Legal review before Publish note. Routine releases go straight to Publish note.";
		const diagram = {
			type: "flowchart",
			nodes: [
				{ id: "route", label: "Sensitive release?" },
				{ id: "review", label: "Legal review" },
				{ id: "publish", label: "Publish note" },
			],
			edges: [
				{ source: "route", target: "review" },
				{ source: "route", target: "publish" },
			],
		};
		expect(codes(request, diagram)).toEqual(["flowchart_connection_missing"]);
		expect(
			codes(request, {
				...diagram,
				edges: [...diagram.edges, { source: "review", target: "publish" }],
			}),
		).toEqual([]);
	});

	it("checks then-chains without requiring a direct edge for a stated before relationship", () => {
		const nodes = [
			{ id: "copy", label: "Copy text" },
			{ id: "format", label: "Format text" },
			{ id: "publish", label: "Publish text" },
		];
		const diagram = { type: "flowchart", nodes, edges: [{ source: "copy", target: "format" }] };
		expect(codes("Copy text, then Format text, then Publish text.", diagram)).toEqual([
			"flowchart_connection_missing",
		]);
		const complete = {
			...diagram,
			edges: [...diagram.edges, { source: "format", target: "publish" }],
		};
		expect(codes("Copy text before Publish text.", complete)).toEqual([]);
		expect(codes("Do not Publish text before Copy text.", complete)).toEqual([]);
		expect(codes("Copy text, then Format document.", diagram)).toEqual([]);
	});

	it.each([
		"If approved then publish, if rejected then archive.",
		"If valid then save, otherwise then reject.",
	])("does not infer connections across conditional alternatives: %s", (request) => {
		expect(
			codes(request, {
				type: "flowchart",
				nodes: ["Approved?", "Publish", "Rejected?", "Archive", "Valid?", "Save", "Reject"].map(
					(label) => ({ id: label, label }),
				),
				edges: [],
			}),
		).toEqual([]);
	});

	it.each([
		"Deploying before running tests is forbidden.",
		"cannot ship before payment succeeds.",
		"can't ship before payment succeeds.",
		"must not ship before payment succeeds.",
		"Never ship before payment succeeds.",
	])("does not enforce negated ordering in the whole sentence: %s", (request) => {
		expect(
			codes(request, {
				type: "flowchart",
				nodes: ["Deploy", "Run tests", "Ship", "Payment succeeds"].map((label) => ({
					id: label,
					label,
				})),
				edges: [],
			}),
		).toEqual([]);
	});

	it("checks action names such as Remove item rather than treating them as exclusions", () => {
		const nodes = [
			{ id: "remove", label: "Remove item" },
			{ id: "checkout", label: "Checkout" },
		];
		expect(codes("Remove item, then Checkout.", { type: "flowchart", nodes, edges: [] })).toEqual([
			"flowchart_connection_missing",
		]);
		expect(
			codes("Remove item, then Checkout.", {
				type: "flowchart",
				nodes,
				edges: [{ source: "remove", target: "checkout" }],
			}),
		).toEqual([]);
	});

	it("reads a branch nested in parentheses as its own chain", () => {
		const request =
			"Order received → Validate order → Details complete? (no → Ask for details → Validate order; yes → Check credit → Credit ok? (yes → Ship; no → Cancel))";
		const nodes = [
			"Order received",
			"Validate order",
			"Details complete?",
			"Ask for details",
			"Check credit",
			"Credit ok?",
			"Ship",
			"Cancel",
		].map((label) => ({ id: label, label }));
		const edges = [
			["Order received", "Validate order"],
			["Validate order", "Details complete?"],
			["Details complete?", "Ask for details"],
			["Ask for details", "Validate order"],
			["Details complete?", "Check credit"],
			["Check credit", "Credit ok?"],
			["Credit ok?", "Ship"],
			["Credit ok?", "Cancel"],
		].map(([source, target]) => ({ source, target }));
		expect(codes(request, { type: "flowchart", nodes, edges })).toEqual([]);
		const issues = checkRequestCoverage(request, {
			type: "flowchart",
			nodes,
			edges: edges.filter((edge) => edge.source !== "Check credit"),
		});
		expect(issues[0]?.message).toContain('"Check credit → Credit ok"');
	});

	it("reports a named zone that no group carries", () => {
		const diagram = { type: "flowchart", nodes, edges, groups: groups.slice(1) };
		const issues = checkRequestCoverage(request, diagram);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_container_missing"]);
		expect(issues[0]?.message).toContain('"production VPC"');
	});

	it("does not invent nodes for unmatched prose or names for generic zone counts", () => {
		expect(
			codes("flowchart across our 3 network zones: request → check cache, then answer", {
				type: "flowchart",
				nodes: [
					{ id: "a", label: "Request" },
					{ id: "b", label: "Check cache" },
				],
				edges: [{ id: "1", source: "a", target: "b" }],
			}),
		).toEqual([]);
	});
});

describe("the words that name a zone", () => {
	const diagram = (labels: readonly string[]) => ({
		type: "flowchart",
		nodes: [
			{ id: "alb", label: "ALB" },
			{ id: "ecs", label: "ECS" },
		],
		edges: [{ source: "alb", target: "ecs" }],
		groups: labels.map((label, index) => ({ id: `g${index}`, label })),
	});
	const missing = (request: string, labels: readonly string[]) =>
		checkRequestCoverage(request, diagram(labels))
			.filter((issue) => issue.code === "flowchart_container_missing")
			.map((issue) => issue.message);

	it("reads no preposition, determiner or word before them as part of a zone's name", () => {
		const vpc = ["VPC", "Public subnet", "Private subnet"];
		for (const request of [
			"Inside one VPC, the ALB in the public subnet sends traffic to ECS in the private subnet.",
			"Within our VPC, the ALB in the public subnet sends traffic to ECS in the private subnet.",
			"The ALB in VPC sends traffic to ECS throughout the private subnet.",
			"Users reach the VPC, where the ALB behind the public subnet calls ECS.",
		])
			expect(missing(request, vpc), request).toEqual([]);
		expect(missing("ECS sits outside the DMZ.", ["DMZ"])).toEqual([]);
	});

	it("keeps a capitalized name that starts with a preposition", () => {
		expect(missing("Our Inside Sales network calls ECS.", ["Network"])[0]).toContain(
			'"Inside Sales network"',
		);
		expect(missing("Our Inside Sales network calls ECS.", ["Inside Sales network"])).toEqual([]);
		expect(missing("The ALB sits in the Edge Network.", ["Network"])[0]).toContain(
			'"Edge Network"',
		);
		expect(missing("Inside the production VPC, the ALB calls ECS.", ["VPC"])[0]).toContain(
			'"production VPC"',
		);
	});
});

describe("key markers and nullable columns in SQL", () => {
	it("reports a unique, key or nullable column the entity marks otherwise", () => {
		const request = `ER diagram
create table users (id int primary key, email text not null unique, bio text);
create table posts (id int, user_id int not null, primary key (id), foreign key (user_id) references users(id));`;
		const diagram = (users: unknown[], posts: unknown[]) => ({
			type: "er",
			entities: [
				{ id: "users", fields: users },
				{ id: "posts", fields: posts },
			],
			relationships: [{ id: "r", from: "posts.user_id", to: "users.id" }],
		});
		expect(
			codes(
				request,
				diagram(["id int PK", "email text UK", "bio text?"], ["id int PK", "user_id int FK"]),
			),
		).toEqual([]);
		const issues = checkRequestCoverage(
			request,
			diagram(
				[{ name: "id", type: "int", pk: true }, { name: "email", type: "text" }, { name: "bio" }],
				["id int PK", "user_id int? FK"],
			),
		);
		expect(issues.map((issue) => issue.code)).toEqual(["er_marker_mismatch", "er_marker_mismatch"]);
		expect(issues[0]?.message).toContain("email UK and bio nullable (?)");
		expect(issues[1]?.message).toContain("user_id not nullable (no ?)");
	});
});

describe("what the request puts inside a zone", () => {
	const request =
		"aws setup: users → ALB (public subnet) → app (private subnet) → S3. the subnets are in the VPC, VPC + S3 are in us-east-1";
	const nodes = [
		{ id: "users", label: "Users" },
		{ id: "alb", label: "ALB", group: "public" },
		{ id: "app", label: "App", group: "private" },
		{ id: "s3", label: "S3", group: "region" },
	];
	const edges = [
		{ id: "1", source: "users", target: "alb" },
		{ id: "2", source: "alb", target: "app" },
		{ id: "3", source: "app", target: "s3" },
	];
	const groups = [
		{ id: "region", label: "us-east-1" },
		{ id: "vpc", label: "VPC", parent: "region" },
		{ id: "public", label: "Public subnet", parent: "vpc" },
		{ id: "private", label: "Private subnet", parent: "vpc" },
	];

	it("passes nodes and zones nested as stated", () => {
		expect(codes(request, { type: "flowchart", nodes, edges, groups })).toEqual([]);
	});

	it("reports a node or a zone drawn outside the zone that holds it", () => {
		const issues = checkRequestCoverage(request, {
			type: "flowchart",
			nodes: nodes.map((node) => (node.id === "s3" ? { id: "s3", label: "S3" } : node)),
			edges,
			groups: groups.map((group) => (group.id === "vpc" ? { id: "vpc", label: "VPC" } : group)),
		});
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_containment_wrong"]);
		expect(issues[0]?.message).toContain('"VPC in us-east-1" and "S3 in us-east-1"');
	});
});

describe("messages listed one per line", () => {
	const request = `sequence diagram, --> is a reply
1. Browser -> API: Get profile
2. API -> Database: Load user
3. Database --> API: User row
4. API --> Browser: Profile`;
	const participants = [
		{ id: "browser", label: "Browser" },
		{ id: "api", label: "API" },
		{ id: "db", label: "Database" },
	];
	const messages = [
		{ id: "1", source: "browser", target: "api", label: "Get profile" },
		{ id: "2", source: "api", target: "db", label: "Load user" },
		{ id: "3", source: "db", target: "api", label: "User row" },
		{ id: "4", source: "api", target: "browser", label: "Profile" },
	];

	it("passes every listed message in order", () => {
		expect(codes(request, { type: "sequence", participants, messages })).toEqual([]);
	});

	it("reports a missing message and a changed order", () => {
		const reordered = [messages[1], messages[0], messages[2]];
		expect(codes(request, { type: "sequence", participants, messages: reordered })).toEqual([
			"sequence_message_missing",
			"sequence_order_changed",
		]);
	});
});

describe("quoted text", () => {
	it("reports quoted text the diagram does not show, and ignores quoted symbols", () => {
		const request =
			'mobile wireframe: the heading "Welcome back" and a "Sign in" button; "1" o-- "*"';
		const diagram = {
			type: "wireframe",
			screens: [{ id: "s", name: "Login", children: [{ type: "heading", text: "Welcome back" }] }],
		};
		const issues = checkRequestCoverage(request, diagram);
		expect(issues.map((issue) => issue.code)).toEqual(["quoted_text_missing"]);
		expect(issues[0]?.message).toContain('"Sign in"');
	});

	it("asks an edit that replaces quoted text only for the new text", () => {
		const flowchart = (label: string) => ({
			type: "flowchart",
			nodes: [
				{ id: "a", label: "Open release" },
				{ id: "b", label },
			],
			edges: [{ source: "a", target: "b" }],
		});
		const quoted = (request: string, label: string) =>
			checkRequestCoverage(request, flowchart(label)).map((issue) => issue.message);
		for (const request of [
			'Rename "Release live" to "Release shipped".',
			'Please change the last step from "Release live" to "Release shipped".',
			'Replace "Release live" with "Release shipped".',
		]) {
			expect(quoted(request, "Release shipped"), request).toEqual([]);
			expect(quoted(request, "Release live"), request).toEqual([
				'The request quotes "Release shipped", but the diagram does not show it. Use each quoted text exactly, on the element it belongs to.',
			]);
		}
		// Every pair an edit lists is replaced.
		expect(
			quoted(
				'Rename "Open release" to "Start release" and "Release live" to "Release shipped".',
				"Release shipped",
			),
		).toEqual([
			'The request quotes "Start release", but the diagram does not show it. Use each quoted text exactly, on the element it belongs to.',
		]);
		// A described change of state is no edit: both states stay required.
		expect(
			quoted('The status changes from "Release live" to "Release shipped".', "Release shipped"),
		).toEqual([
			'The request quotes "Release live", but the diagram does not show it. Use each quoted text exactly, on the element it belongs to.',
		]);
	});
});

describe("review: what the check must not ask for or remove", () => {
	it("does not require quoted text the request says to leave out", () => {
		const request = 'A login wireframe with a "Log in" button. Do not show a "Sign up" button.';
		const diagram = {
			type: "wireframe",
			screens: [{ id: "s", name: "Login", children: [{ type: "button", text: "Log in" }] }],
		};
		expect(codes(request, diagram)).toEqual([]);
	});

	it("reads a relationship the prose states after the code", () => {
		const request = "class diagram\n\nclass Zoo {}\nclass Keeper {}\n\nZoo employs Keeper.";
		const diagram = {
			type: "class",
			classes: [
				{ id: "Zoo", attributes: [] },
				{ id: "Keeper", attributes: [] },
			],
			relationships: [{ id: "r", kind: "association", from: "Zoo", to: "Keeper" }],
		};
		expect(codes(request, diagram)).toEqual([]);
	});
});

describe("an action stated on the way back to an earlier step", () => {
	const request =
		"Create a support flowchart. An agent opens the ticket and asks whether the customer replied. A reply closes the ticket; no reply keeps polling and asks whether they replied again.";
	const nodes = [
		{ id: "open", label: "Open ticket", kind: "start" },
		{ id: "ask", label: "Poll interval set", kind: "process" },
		{ id: "replied", label: "Customer replied?", kind: "decision" },
		{ id: "close", label: "Close ticket", kind: "end" },
		{ id: "poll", label: "Keep polling", kind: "process" },
	];
	const diagram = (edges: [string, string][], drawn = nodes) => ({
		type: "flowchart",
		nodes: drawn,
		edges: edges.map(([source, target]) => ({ source, target })),
	});
	const loop: [string, string][] = [
		["open", "ask"],
		["ask", "replied"],
		["replied", "close"],
		["replied", "poll"],
		["poll", "replied"],
	];

	it("passes a loop that passes through a node for the action", () => {
		expect(codes(request, diagram(loop))).toEqual([]);
	});

	it("reports a return arrow with no node for the action, even when another step shares its word", () => {
		const issues = checkRequestCoverage(
			request,
			diagram(
				[
					["open", "ask"],
					["ask", "replied"],
					["replied", "close"],
					["replied", "replied"],
				],
				nodes.filter((node) => node.id !== "poll"),
			),
		);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_return_step_missing"]);
		expect(issues[0]?.message).toContain('"no reply keeps polling"');
	});

	it("accepts an unrolled repeat, the action just before a node for the repeated step", () => {
		const request = "Send a reminder, wait three days and send a reminder again.";
		expect(
			codes(request, {
				type: "flowchart",
				nodes: [
					{ id: "a", label: "Send reminder", kind: "start" },
					{ id: "b", label: "Wait three days", kind: "process" },
					{ id: "c", label: "Send reminder again", kind: "end" },
					{ id: "d", label: "Retry upload", kind: "process" },
					{ id: "e", label: "Upload ok?", kind: "decision" },
				],
				edges: [
					{ source: "a", target: "b" },
					{ source: "b", target: "c" },
					{ source: "d", target: "e" },
					{ source: "e", target: "d" },
				],
			}),
		).toEqual([]);
	});

	it.each([
		"If the upload fails, retry the upload again.",
		"Log in, then log in again with the code.",
		"failed → back to Validate input",
	])("reads no action from a condition, the repeated step or an arrow chain: %s", (request) => {
		expect(
			codes(request, {
				type: "flowchart",
				nodes: [
					{ id: "a", label: "Validate input", kind: "start" },
					{ id: "b", label: "Valid?", kind: "decision" },
					{ id: "c", label: "Done", kind: "end" },
				],
				edges: [
					{ source: "a", target: "b" },
					{ source: "b", target: "c" },
					{ source: "b", target: "a" },
				],
			}),
		).toEqual([]);
	});
});

describe("zones the request nests", () => {
	const groups = [
		{ id: "cloud", label: "Azure cloud" },
		{ id: "region", label: "ap-southeast-2", parent: "cloud" },
		{ id: "vnet", label: "Hub VNet", parent: "region" },
		{ id: "app", label: "App subnet", parent: "vnet" },
		{ id: "site", label: "Branch data center" },
		{ id: "lan", label: "Store network", parent: "site" },
	];
	const nodes = [
		{ id: "clerk", label: "Store clerk", group: "lan" },
		{ id: "pos", label: "Point of sale", group: "lan" },
		{ id: "files", label: "File server", group: "site" },
		{ id: "gw", label: "VPN gateway", group: "vnet" },
		{ id: "api", label: "Sales API", group: "app" },
		{ id: "blob", label: "Blob storage", group: "region" },
	];
	const request = [
		"draw our setup.",
		"branch data center: the store clerk rings up sales on the point of sale, both on the store network. the point of sale saves files to a file server in the data center.",
		"point of sale → VPN gateway in our hub VNet → sales API in the VNet's app subnet → blob storage.",
		"the VNet and blob storage are all in ap-southeast-2, in our Azure cloud",
	].join("\n");
	const check = (changes: { groups?: typeof groups; nodes?: typeof nodes }) =>
		checkRequestCoverage(request, {
			type: "flowchart",
			nodes: changes.nodes ?? nodes,
			edges: [],
			groups: changes.groups ?? groups,
		});

	it("passes every zone nested as stated", () => {
		expect(check({})).toEqual([]);
	});

	it("reads a listed subject, a zone heading, a pair placed together, and zones inline", () => {
		const issues = check({
			groups: groups.map((group) =>
				group.id === "lan"
					? { id: "lan", label: "Store network" }
					: group.id === "vnet"
						? { id: "vnet", label: "Hub VNet", parent: "cloud" }
						: group.id === "app"
							? { id: "app", label: "App subnet", parent: "region" }
							: group,
			),
			nodes: nodes.map((node) => (node.id === "clerk" ? { ...node, group: "site" } : node)),
		});
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_containment_wrong"]);
		for (const statement of [
			"the store network in branch data center",
			"Store clerk in the store network",
			"app subnet in the VNet",
			"The VNet in ap-southeast-2",
		])
			expect(issues[0]?.message.toLowerCase()).toContain(`"${statement.toLowerCase()}"`);
	});

	it("reports a node drawn in an inner zone the request gives only other members", () => {
		const issues = check({
			nodes: nodes.map((node) =>
				node.id === "files"
					? { ...node, group: "lan" }
					: node.id === "blob"
						? { ...node, group: "vnet" }
						: node,
			),
		});
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_containment_unstated"]);
		expect(issues[0]?.message).toContain('"File server in the data center, not in Store network"');
		expect(issues[0]?.message).toContain('"Blob storage in ap-southeast-2, not in Hub VNet"');
	});

	it("reports one group drawn for two zones the request nests", () => {
		const issues = check({
			groups: [
				{ id: "cloud", label: "Azure cloud (ap-southeast-2)" },
				{ id: "vnet", label: "Hub VNet", parent: "cloud" },
				{ id: "app", label: "App subnet", parent: "vnet" },
				groups[4]!,
				groups[5]!,
			],
			nodes: nodes.map((node) => (node.id === "blob" ? { ...node, group: "cloud" } : node)),
		});
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_zone_merged"]);
		expect(issues[0]?.message).toContain('"ap-southeast-2 in our Azure cloud"');
	});

	it("reads db as database in a zone's name", () => {
		expect(
			codes("users → API (app subnet) → postgres (db subnet)", {
				type: "flowchart",
				nodes: [
					{ id: "u", label: "Users" },
					{ id: "a", label: "API", group: "app" },
					{ id: "p", label: "Postgres", group: "data" },
				],
				edges: [
					{ source: "u", target: "a" },
					{ source: "a", target: "p" },
				],
				groups: [
					{ id: "app", label: "App subnet" },
					{ id: "data", label: "Database subnet" },
				],
			}),
		).toEqual([]);
	});
});

describe("review: negation and loop conditions are not demands", () => {
	it("reads no placement from a clause that forbids it", () => {
		expect(
			codes(
				"draw our setup: users → ALB (public subnet) → API (private subnet). Do not put API in the public subnet.",
				{
					type: "flowchart",
					nodes: [
						{ id: "users", label: "Users" },
						{ id: "alb", label: "ALB", group: "public" },
						{ id: "api", label: "API", group: "private" },
					],
					edges: [
						{ source: "users", target: "alb" },
						{ source: "alb", target: "api" },
					],
					groups: [
						{ id: "public", label: "Public subnet" },
						{ id: "private", label: "Private subnet" },
					],
				},
			),
		).toEqual([]);
	});

	const loop = (labels: [string, string][], edges: [string, string][]) => ({
		type: "flowchart",
		nodes: labels.map(([id, label]) => ({
			id,
			label,
			kind: label.endsWith("?") ? "decision" : "process",
		})),
		edges: edges.map(([source, target]) => ({ source, target })),
	});

	it("asks for no step the request forbids on the way back", () => {
		expect(
			codes(
				"Open the ticket and check for a reply. Do not send a reminder, and check again.",
				loop(
					[
						["open", "Open ticket"],
						["check", "Check for reply"],
						["replied", "Replied?"],
						["close", "Close ticket"],
					],
					[
						["open", "check"],
						["check", "replied"],
						["replied", "close"],
						["replied", "check"],
					],
				),
			),
		).toEqual([]);
	});

	it("reads the repeated step without the condition that ends it", () => {
		expect(
			codes(
				"Start build, then repeat Check status until done.",
				loop(
					[
						["start", "Start build"],
						["check", "Check status"],
						["done", "Done?"],
						["finish", "Finish"],
					],
					[
						["start", "check"],
						["check", "done"],
						["done", "finish"],
						["done", "check"],
					],
				),
			),
		).toEqual([]);
	});
});

/** A flowchart from [id, label] pairs and [source, target, label?] edges; "?" makes a decision. */
const chart = (labels: [string, string][], edges: [string, string, string?][]) => ({
	type: "flowchart",
	nodes: labels.map(([id, label]) => ({
		id,
		label,
		kind: label.endsWith("?") ? "decision" : "process",
	})),
	edges: edges.map(([source, target, label]) => ({ source, target, ...(label ? { label } : {}) })),
});

describe("a stated check folded into its decision", () => {
	const request =
		"Create a building access flowchart. A visitor arrives and the badge is verified. A rejected badge calls security. An accepted badge opens the door.";
	const ends: [string, string][] = [
		["security", "Call security"],
		["door", "Open door"],
	];

	it("reports a verification drawn only as the decision", () => {
		const issues = checkRequestCoverage(
			request,
			chart(
				[["arrive", "Visitor arrives"], ["badge", "Verify badge?"], ...ends],
				[
					["arrive", "badge"],
					["badge", "security", "no"],
					["badge", "door", "yes"],
				],
			),
		);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_check_step_missing"]);
		expect(issues[0]?.message).toContain('"the badge is verified"');
	});

	it("passes the check as its own step before the decision", () => {
		expect(
			codes(
				request,
				chart(
					[
						["arrive", "Visitor arrives"],
						["verify", "Verify badge"],
						["badge", "Badge accepted?"],
						...ends,
					],
					[
						["arrive", "verify"],
						["verify", "badge"],
						["badge", "security", "no"],
						["badge", "door", "yes"],
					],
				),
			),
		).toEqual([]);
	});

	it.each([
		"A visitor arrives. If the badge is verified, open the door; otherwise call security.",
		"A visitor arrives. Once the badge is verified, open the door. A rejected badge calls security.",
		"A visitor arrives and the guard checks whether the badge is valid. A rejected badge calls security. An accepted badge opens the door.",
		"A visitor arrives and the guard verifies that the badge is valid. A rejected badge calls security. An accepted badge opens the door.",
		"A visitor arrives and the guard checks the badge. A rejected badge calls security. An accepted badge opens the door.",
	])("asks for no step when the check is only the decision: %s", (prompt) => {
		expect(
			codes(
				prompt,
				chart(
					[["arrive", "Visitor arrives"], ["badge", "Badge valid?"], ...ends],
					[
						["arrive", "badge"],
						["badge", "security", "no"],
						["badge", "door", "yes"],
					],
				),
			),
		).toEqual([]);
	});

	it("reads a word of the checked thing's family in the decision", () => {
		expect(
			codes(
				"Inspect seat availability, then book or waitlist the guest.",
				chart(
					[
						["start", "Guest asks"],
						["seats", "Seats available?"],
						["book", "Book guest"],
						["wait", "Waitlist guest"],
					],
					[
						["start", "seats"],
						["seats", "book", "yes"],
						["seats", "wait", "no"],
					],
				),
			),
		).toEqual(["flowchart_check_step_missing"]);
	});
});

describe("a step the request gives to some branches", () => {
	const request =
		"Create a release flowchart. Pick the target. Staging, canary and production deploys follow. Staging and canary paths both run smoke tests. Passing smoke tests finish; failing ones page the on-call engineer.";
	const labels: [string, string][] = [
		["pick", "Pick target"],
		["target", "Target?"],
		["staging", "Staging deploy"],
		["canary", "Canary deploy"],
		["production", "Production deploy"],
		["smoke", "Run smoke tests"],
		["passed", "Smoke tests pass?"],
		["finish", "Finish"],
		["page", "Page on-call engineer"],
	];
	const edges: [string, string, string?][] = [
		["pick", "target"],
		["target", "staging", "staging"],
		["target", "canary", "canary"],
		["target", "production", "production"],
		["staging", "smoke"],
		["canary", "smoke"],
		["smoke", "passed"],
		["passed", "finish", "yes"],
		["passed", "page", "no"],
	];

	it("passes the step on the listed branches only", () => {
		expect(codes(request, chart(labels, edges))).toEqual([]);
	});

	it("passes a sibling branch another sentence gives the step too", () => {
		expect(
			codes(
				`${request} Production also runs smoke tests.`,
				chart(labels, [...edges, ["production", "smoke"]]),
			),
		).toEqual([]);
	});

	it("keeps a repair that removes only the borrowing arrow", () => {
		const borrowed = chart(labels, [...edges, ["production", "smoke"]]);
		expect(keepsStatedStructure(request, borrowed, chart(labels, edges))).toBe(true);
		// Deleting a listed branch's arrow too is no fix.
		const stripped = chart(
			labels,
			edges.filter(([source, target]) => !(source === "canary" && target === "smoke")),
		);
		expect(keepsStatedStructure(request, borrowed, stripped)).toBe(false);
	});

	it("reports a sibling branch led into the shared step, even through a copy of it", () => {
		const issues = checkRequestCoverage(
			request,
			chart(
				[...labels, ["smoke-2", "Run smoke tests"]],
				[...edges, ["production", "smoke-2"], ["smoke-2", "passed"]],
			),
		);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_step_borrowed"]);
		expect(issues[0]?.message).toContain('"Production deploy"');
	});

	it("leaves a sibling that merges into the listed branches' path before the step", () => {
		const merged = chart(
			[...labels, ["prepare", "Prepare test runner"]],
			[
				...edges.filter(([source]) => source !== "staging" && source !== "canary"),
				["staging", "prepare"],
				["canary", "prepare"],
				["production", "prepare"],
				["prepare", "smoke"],
			],
		);
		expect(codes(request, merged)).toEqual([]);
		// Cutting the shared arrow would cut the listed branches off too: no repair may do it.
		const cut = chart(
			[...labels, ["prepare", "Prepare test runner"]],
			[
				...edges.filter(([source]) => source !== "staging" && source !== "canary"),
				["staging", "prepare"],
				["canary", "prepare"],
				["production", "prepare"],
			],
		);
		expect(keepsStatedStructure(request, merged, cut)).toBe(false);
	});

	it("passes a sibling another sentence gives the step, through its own plain steps", () => {
		const waited = chart(
			[...labels, ["wait", "Wait for rollout"]],
			[...edges, ["production", "wait"], ["wait", "smoke"]],
		);
		expect(codes(`${request} Production also runs smoke tests.`, waited)).toEqual([]);
		expect(codes(request, waited)).toEqual(["flowchart_step_borrowed"]);
	});

	it("reads a choice drawn as a chain of decisions", () => {
		// "Target?" becomes "Test environment?", then "Gradual rollout?" for the rest.
		const chained: [string, string][] = [
			...labels.filter(([id]) => id !== "target"),
			["environment", "Test environment?"],
			["rollout", "Gradual rollout?"],
		];
		const chainedEdges: [string, string, string?][] = [
			["pick", "environment"],
			["environment", "staging", "yes"],
			["environment", "rollout", "no"],
			["rollout", "canary", "yes"],
			["rollout", "production", "no"],
			...edges.filter(([source]) => source !== "pick" && source !== "target"),
		];
		expect(codes(request, chart(chained, chainedEdges))).toEqual([]);
		const borrowed = chart(chained, [...chainedEdges, ["production", "smoke"]]);
		const issues = checkRequestCoverage(request, borrowed);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_step_borrowed"]);
		expect(issues[0]?.message).toContain('"Production deploy"');
		expect(keepsStatedStructure(request, borrowed, chart(chained, chainedEdges))).toBe(true);
		expect(codes(`${request} Production also runs smoke tests.`, borrowed)).toEqual([]);
	});
});

describe("a step given to branches that start a step before the listed ones", () => {
	const request =
		"Sort each ticket as billing, bug or question. Billing tickets get a refund, bug tickets get a fix. Refund and fix paths both notify the customer. Questions get an answer.";
	const labels: [string, string][] = [
		["sort", "Sort ticket"],
		["billing", "Billing ticket"],
		["bug", "Bug ticket"],
		["question", "Question ticket"],
		["refund", "Issue refund"],
		["fix", "Ship fix"],
		["answer", "Send answer"],
		["notify", "Notify customer"],
	];
	const edges: [string, string, string?][] = [
		["sort", "billing"],
		["sort", "bug"],
		["sort", "question"],
		["billing", "refund"],
		["bug", "fix"],
		["question", "answer"],
		["refund", "notify"],
		["fix", "notify"],
	];

	it("passes the step on the listed branches only", () => {
		expect(codes(request, chart(labels, edges))).toEqual([]);
	});

	it("reports a sibling branch that reaches the step through its own plain steps", () => {
		const issues = checkRequestCoverage(request, chart(labels, [...edges, ["answer", "notify"]]));
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_step_borrowed"]);
		expect(issues[0]?.message).toContain('leads "Send answer" into it');
	});
});

describe("a step drawn twice where one copy ends", () => {
	const request =
		"Create a returns flowchart. Intact items restock the shelf and refund the customer. Items with missing parts are repaired before restocking the shelf.";
	const labels: [string, string][] = [
		["arrive", "Return arrives"],
		["intact", "Item intact?"],
		["restock", "Restock shelf"],
		["refund", "Refund customer"],
		["repair", "Repair item"],
	];

	it("reports a branch that ends at its own copy of a step that continues elsewhere", () => {
		const issues = checkRequestCoverage(
			request,
			chart(
				[...labels, ["restock-2", "Restock shelf"]],
				[
					["arrive", "intact"],
					["intact", "restock", "yes"],
					["restock", "refund"],
					["intact", "repair", "no"],
					["repair", "restock-2"],
				],
			),
		);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_step_split"]);
		expect(issues[0]?.message).toContain('"Refund customer"');
	});

	it("passes one node for the step, and copies that end alike", () => {
		const rejoined: [string, string, string?][] = [
			["arrive", "intact"],
			["intact", "restock", "yes"],
			["restock", "refund"],
			["intact", "repair", "no"],
			["repair", "restock"],
		];
		expect(codes(request, chart(labels, rejoined))).toEqual([]);
		expect(
			codes(
				"If rejected, notify the requester. If approved, notify the requester.",
				chart(
					[
						["review", "Approved?"],
						["a", "Notify requester"],
						["b", "Notify requester"],
					],
					[
						["review", "a", "no"],
						["review", "b", "yes"],
					],
				),
			),
		).toEqual([]);
	});
});

describe("a named zone the diagram lacks", () => {
	it("names the zone that holds it and the steps the request puts in it", () => {
		const issues = checkRequestCoverage(
			"draw our branch office.\nbranch office: tellers enter deposits in the core banking app, both on the teller network. the app posts to a ledger database in the branch office.",
			{
				type: "flowchart",
				nodes: [
					{ id: "tellers", label: "Tellers", kind: "start", group: "branch" },
					{ id: "app", label: "Core banking app", kind: "process", group: "branch" },
					{ id: "ledger", label: "Ledger database", kind: "end", group: "branch" },
				],
				edges: [
					{ source: "tellers", target: "app" },
					{ source: "app", target: "ledger" },
				],
				groups: [{ id: "branch", label: "Branch office", kind: "datacenter" }],
			},
		);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_container_missing"]);
		expect(issues[0]?.message).toContain(
			'"teller network" (holding "Tellers" and "Core banking app")',
		);
	});

	it("reads a bare mention of a zone as the one named zone of its kind", () => {
		const request =
			"bastion host in our staging VPC → app server in the VPC's public subnet → session cache. the VPC and cache are in us-east-1.";
		const flat = {
			type: "flowchart",
			nodes: [
				{ id: "bastion", label: "Bastion host", kind: "start" },
				{ id: "app", label: "App server", kind: "process" },
				{ id: "cache", label: "Session cache", kind: "end" },
			],
			edges: [
				{ source: "bastion", target: "app" },
				{ source: "app", target: "cache" },
			],
		};
		const issues = checkRequestCoverage(request, flat);
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_container_missing"]);
		// "the VPC" is the staging VPC, not a second VPC to draw.
		expect(issues[0]?.message).toContain(
			'"staging VPC" (inside "us-east-1", holding "Bastion host"), "public subnet" (inside "staging VPC", holding "App server") and "us-east-1" (holding "Session cache")',
		);
		expect(issues[0]?.message).not.toContain('"VPC"');
		// With two VPCs named, a bare "the VPC" stays a zone of its own.
		const two = checkRequestCoverage(
			"bastion host in our staging VPC, app server in our production VPC. the VPC is in us-east-1.",
			flat,
		);
		expect(two[0]?.message).toContain('"VPC" (inside "us-east-1"');
	});
});
