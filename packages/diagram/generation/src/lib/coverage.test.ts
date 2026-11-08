import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { candidateFromText, type DiagramGenerationRequest } from "./candidates.js";
import { checkRequestCoverage } from "./coverage.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";

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
});

describe("the coverage repair", () => {
	const flowchart = (edges: { source: string; target: string }[]) =>
		JSON.stringify({
			title: "Deploy",
			diagram: {
				id: "deploy",
				type: "flowchart",
				nodes: { push: "Push", build: "Build", test: "Test", ship: "Ship" },
				edges: edges.map((edge) => [edge.source, edge.target]),
			},
		});
	const complete = flowchart([
		{ source: "push", target: "build" },
		{ source: "build", target: "test" },
		{ source: "test", target: "ship" },
	]);
	// Test ends the flow instead of leading on to Ship.
	const skipsTest = flowchart([
		{ source: "push", target: "build" },
		{ source: "build", target: "test" },
		{ source: "build", target: "ship" },
	]);
	const policy = {
		concurrency: 1,
		maxRepairAttempts: 2,
		maxRetries: 0,
		requestTimeoutMs: 1_000,
		retryDelayMs: 1,
		totalTimeoutMs: 10_000,
	};
	const run = (texts: string[], request = "flowchart: push → build → test → ship") => {
		const seen: DiagramGenerationRequest[] = [];
		return runDiagramGenerationWithPolicy(
			(attempt) => {
				const text = texts[seen.length];
				seen.push(attempt);
				return text === undefined
					? Effect.die(new Error("Unexpected call."))
					: Effect.succeed(
							candidateFromText({
								model: "m",
								provider: "fixture",
								text,
							}),
						);
			},
			{ model: "m", prompt: { id: "x", request } },
			"fixture",
			policy,
		).pipe(Effect.map((candidate) => ({ candidate, seen })));
	};

	it.effect(
		"repairs a stated before continuation that otherwise leaves a valid terminal node",
		() =>
			Effect.gen(function* () {
				const { candidate, seen } = yield* run(
					[skipsTest, complete],
					"flowchart: Push, then Build, then Test before Ship.",
				);
				expect(seen).toHaveLength(2);
				expect(candidate.diagram).toMatchObject({
					type: "flowchart",
					edges: expect.arrayContaining([
						expect.objectContaining({ source: "test", target: "ship" }),
					]),
				});
				expect(candidate.diagnostics.at(-1)).toMatch(/^coverage_repair_succeeded/u);
			}),
	);

	it.effect("does not spend a repair call on a harmless unsupported group kind", () =>
		Effect.gen(function* () {
			const source = JSON.parse(complete);
			source.diagram.groups = {
				release: {
					label: "Release team",
					kind: "team",
					contains: ["push", "build", "test", "ship"],
				},
			};
			const { candidate, seen } = yield* run(
				[JSON.stringify(source)],
				"Flowchart in Release team: Push → Build → Test → Ship.",
			);
			expect(seen).toHaveLength(1);
			expect(candidate.error).toBeUndefined();
			expect(candidate.diagnostics.some((note) => note.startsWith("group_kind_dropped:"))).toBe(
				true,
			);
		}),
	);

	it.effect("makes no further call when the diagram covers the request", () =>
		Effect.gen(function* () {
			const { candidate, seen } = yield* run([complete]);
			expect(seen).toHaveLength(1);
			expect(candidate.attempts).toBe(1);
		}),
	);

	it.effect("repairs once with the specific miss and keeps a repair that fixes it", () =>
		Effect.gen(function* () {
			const { candidate, seen } = yield* run([skipsTest, complete]);
			expect(seen).toHaveLength(2);
			expect(seen[1]?.prompt.request).toContain('"test → ship"');
			expect(seen[1]?.prompt.request).toContain(skipsTest);
			expect(candidate.text).toBe(complete);
			expect(candidate.attempts).toBe(2);
			expect(candidate.diagnostics.at(-1)).toMatch(/^coverage_repair_succeeded/u);
		}),
	);

	it.effect("keeps the original when the repair fixes nothing", () =>
		Effect.gen(function* () {
			const { candidate, seen } = yield* run([skipsTest, skipsTest]);
			expect(seen).toHaveLength(2);
			expect(candidate.text).toBe(skipsTest);
			expect(candidate.diagnostics.at(-1)).toMatch(/^coverage_repair_kept_original/u);
		}),
	);

	it.effect("keeps the original when the repair is not a valid diagram", () =>
		Effect.gen(function* () {
			const { candidate } = yield* run([skipsTest, "not json"]);
			expect(candidate.diagram).toBeDefined();
			expect(candidate.text).toBe(skipsTest);
		}),
	);
});

describe("a coverage repair in another family", () => {
	it.effect("keeps the original diagram", () =>
		Effect.gen(function* () {
			const request = "flowchart: push → build → test → ship";
			const flowchart = JSON.stringify({
				title: "Deploy",
				diagram: {
					id: "deploy",
					type: "flowchart",
					nodes: { push: "Push", build: "Build", test: "Test", ship: "Ship" },
					edges: [
						["push", "build"],
						["build", "test"],
						["build", "ship"],
					],
				},
			});
			const timeline = JSON.stringify({
				title: "Deploy",
				diagram: {
					id: "deploy",
					type: "timeline",
					events: [
						{ id: "push", label: "Push build test ship", order: 1 },
						{ id: "ship", label: "Push build test ship again", order: 2 },
					],
				},
			});
			const texts = [flowchart, timeline];
			let calls = 0;
			const candidate = yield* runDiagramGenerationWithPolicy(
				() =>
					Effect.succeed(
						candidateFromText({ model: "m", provider: "fixture", text: texts[calls++] ?? "" }),
					),
				{ model: "m", prompt: { id: "x", request } },
				"fixture",
				{
					concurrency: 1,
					maxRepairAttempts: 2,
					maxRetries: 0,
					requestTimeoutMs: 1_000,
					retryDelayMs: 1,
					totalTimeoutMs: 10_000,
				},
			);
			expect(calls).toBe(2);
			expect(candidate.diagram?.type).toBe("flowchart");
		}),
	);
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

describe("review: the coverage repair keeps what the request names, within the repair budget", () => {
	const request = "flowchart: push code → build image → test → ship to production";
	const answer = (nodes: [string, string][], edges: [string, string][]) =>
		JSON.stringify({
			title: "Deploy",
			diagram: {
				id: "deploy",
				type: "flowchart",
				nodes: Object.fromEntries(nodes),
				edges,
			},
		});
	const nodes: [string, string][] = [
		["push", "Push code to the main branch of the repository"],
		["build", "Build the container image for every service"],
		["test", "Test"],
		["ship", "Ship to production across every region"],
	];
	// Test leads nowhere: the request's test → ship is missing.
	const missesTestToShip = answer(nodes, [
		["push", "build"],
		["build", "test"],
		["build", "ship"],
	]);
	const dropsTest = answer(
		nodes.filter(([id]) => id !== "test"),
		[
			["push", "build"],
			["build", "ship"],
		],
	);
	const run = (texts: string[], maxRepairAttempts: number) => {
		let calls = 0;
		return runDiagramGenerationWithPolicy(
			() =>
				Effect.succeed(
					candidateFromText({ model: "m", provider: "fixture", text: texts[calls++] ?? "" }),
				),
			{ model: "m", prompt: { id: "x", request } },
			"fixture",
			{
				concurrency: 1,
				maxRepairAttempts,
				maxRetries: 0,
				requestTimeoutMs: 1_000,
				retryDelayMs: 1,
				totalTimeoutMs: 10_000,
			},
		).pipe(Effect.map((candidate) => ({ candidate, calls })));
	};

	it.effect("keeps the original when the repair deletes a step the request names", () =>
		Effect.gen(function* () {
			const { candidate, calls } = yield* run([missesTestToShip, dropsTest], 2);
			expect(calls).toBe(2);
			expect(candidate.text).toBe(missesTestToShip);
			expect(candidate.diagnostics.at(-1)).toMatch(/^coverage_repair_kept_original/u);
		}),
	);

	it.effect("makes no coverage repair when the caller allows none", () =>
		Effect.gen(function* () {
			const { candidate, calls } = yield* run([missesTestToShip, dropsTest], 0);
			expect(calls).toBe(1);
			expect(candidate.text).toBe(missesTestToShip);
		}),
	);
});

describe("a coverage repair that removes what nothing states", () => {
	it.effect("is kept: the guard spares only the relationship the check found unstated", () =>
		Effect.gen(function* () {
			const request =
				"class diagram\n\nclass Zoo { private Keeper keeper; }\nclass Keeper {}\nclass Ticket {}";
			const answer = (relationships: object[]) =>
				JSON.stringify({
					title: "Zoo",
					diagram: {
						id: "zoo",
						type: "class",
						classes: [
							{ id: "Zoo", attributes: ["- keeper: Keeper"] },
							{ id: "Keeper", attributes: [] },
							{ id: "Ticket", attributes: [] },
						],
						relationships,
					},
				});
			const keeper = { id: "k", kind: "association", from: "Zoo", to: "Keeper", toRole: "keeper" };
			const invented = { id: "t", kind: "composition", from: "Zoo", to: "Ticket" };
			const texts = [answer([keeper, invented]), answer([keeper])];
			let calls = 0;
			const candidate = yield* runDiagramGenerationWithPolicy(
				() =>
					Effect.succeed(
						candidateFromText({ model: "m", provider: "fixture", text: texts[calls++] ?? "" }),
					),
				{ model: "m", prompt: { id: "x", request } },
				"fixture",
				{
					concurrency: 1,
					maxRepairAttempts: 2,
					maxRetries: 0,
					requestTimeoutMs: 1_000,
					retryDelayMs: 1,
					totalTimeoutMs: 10_000,
				},
			);
			expect(calls).toBe(2);
			expect(candidate.text).toBe(texts[1]);
			expect(candidate.diagnostics.at(-1)).toMatch(/^coverage_repair_succeeded/u);
		}),
	);
});

describe("a composition the request never states", () => {
	const request = (prose: string) =>
		`class diagram. ${prose}\n\nclass Member {\n\tprivate List<Loan> loans;\n}\nclass Loan {}`;
	const diagram = (kind: string) => ({
		type: "class",
		classes: [
			{ id: "Member", attributes: [{ name: "loans", type: "List<Loan>" }] },
			{ id: "Loan", attributes: [] },
		],
		relationships: [{ id: "r", kind, from: "Member", to: "Loan", toRole: "loans" }],
	});

	it("is an association: a collection field alone states no ownership", () => {
		expect(codes(request("members borrow books."), diagram("composition"))).toEqual([
			"class_whole_part_unstated",
		]);
		expect(codes(request("members borrow books."), diagram("association"))).toEqual([]);
	});

	it("stays a composition when a sentence makes the pair whole and part", () => {
		expect(codes(request("a member is composed of its loans."), diagram("composition"))).toEqual(
			[],
		);
	});

	it.effect("may change kind in a repair that keeps everything else", () =>
		Effect.gen(function* () {
			const answer = (kind: string) =>
				JSON.stringify({ title: "Members", diagram: { id: "m", ...diagram(kind) } });
			const texts = [answer("composition"), answer("association")];
			let calls = 0;
			const candidate = yield* runDiagramGenerationWithPolicy(
				() =>
					Effect.succeed(
						candidateFromText({ model: "m", provider: "fixture", text: texts[calls++] ?? "" }),
					),
				{ model: "m", prompt: { id: "x", request: request("members borrow books.") } },
				"fixture",
				{
					concurrency: 1,
					maxRepairAttempts: 2,
					maxRetries: 0,
					requestTimeoutMs: 1_000,
					retryDelayMs: 1,
					totalTimeoutMs: 10_000,
				},
			);
			expect(calls).toBe(2);
			expect(candidate.text).toBe(texts[1]);
		}),
	);
});
