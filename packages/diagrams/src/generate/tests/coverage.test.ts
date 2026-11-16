import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { candidateFromText, type DiagramGenerationRequest } from "../candidates.js";
import { checkRequestCoverage } from "../coverage.js";
import { runDiagramGenerationWithPolicy } from "../policy.js";

describe("the coverage repair", () => {
	const request = "flowchart: push code → build image → test → ship to production";
	const answer = (nodes: [string, string][], edges: [string, string][]) =>
		JSON.stringify({
			title: "Deploy",
			diagram: { id: "deploy", type: "flowchart", nodes: Object.fromEntries(nodes), edges },
		});
	const nodes: [string, string][] = [
		["push", "Push code"],
		["build", "Build image"],
		["test", "Test"],
		["ship", "Ship to production"],
	];
	const complete = answer(nodes, [
		["push", "build"],
		["build", "test"],
		["test", "ship"],
	]);
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
	const run = (texts: string[], maxRepairAttempts = 2) => {
		const seen: DiagramGenerationRequest[] = [];
		return runDiagramGenerationWithPolicy(
			(attempt) => {
				const text = texts[seen.length];
				seen.push(attempt);
				return text === undefined
					? Effect.die(new Error("Unexpected call."))
					: Effect.succeed(candidateFromText({ model: "m", provider: "fixture", text }));
			},
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
		).pipe(Effect.map((candidate) => ({ candidate, seen })));
	};

	it.effect("makes no further call when the diagram covers the request", () =>
		Effect.gen(function* () {
			const { candidate, seen } = yield* run([complete]);
			expect(seen).toHaveLength(1);
			expect(candidate.text).toBe(complete);
		}),
	);

	it.effect("repairs once with the specific miss and keeps a repair that fixes it", () =>
		Effect.gen(function* () {
			const { candidate, seen } = yield* run([missesTestToShip, complete]);
			expect(seen).toHaveLength(2);
			expect(seen[1]?.prompt.request).toContain('"test → ship');
			expect(candidate.text).toBe(complete);
		}),
	);

	it.effect.each([
		["fixes nothing", missesTestToShip],
		["deletes a step the request names", dropsTest],
		["is not a valid diagram", "not json"],
	] as const)("keeps the original when the repair %s", ([_name, repair]) =>
		Effect.gen(function* () {
			const { candidate, seen } = yield* run([missesTestToShip, repair]);
			expect(seen).toHaveLength(2);
			expect(candidate.text).toBe(missesTestToShip);
		}),
	);

	it.effect("makes no coverage repair when the caller allows none", () =>
		Effect.gen(function* () {
			const { candidate, seen } = yield* run([missesTestToShip], 0);
			expect(seen).toHaveLength(1);
			expect(candidate.text).toBe(missesTestToShip);
		}),
	);
});

describe("the coverage check", () => {
	it.each([
		[
			"a class the code declares",
			`class diagram of a zoo.

class Zoo {
	private String name;
}
class Keeper { }`,
			{
				type: "class",
				classes: [{ id: "Zoo", attributes: [{ name: "name" }] }],
				relationships: [],
			},
			["class_missing"],
		],
		[
			"a column and a reference the SQL declares",
			`ER diagram please
create table authors (id int primary key, name text not null);
create table books (id int primary key, title text, author_id int not null references authors(id));`,
			{
				type: "er",
				entities: [
					{ id: "authors", fields: ["id int PK", "name text"] },
					{ id: "books", fields: ["id int PK", "author_id int FK"] },
				],
				relationships: [],
			},
			["er_column_missing", "er_reference_missing"],
		],
		[
			"an arrow and a zone the flow states",
			"draw our setup: users → load balancer (edge subnet) → app → database. the subnet is in the production VPC",
			{
				type: "flowchart",
				nodes: [
					{ id: "users", label: "Users" },
					{ id: "lb", label: "Load balancer", group: "edge" },
					{ id: "app", label: "App" },
					{ id: "db", label: "Database" },
				],
				edges: [
					{ id: "1", source: "users", target: "lb" },
					{ id: "2", source: "lb", target: "app" },
				],
				groups: [{ id: "edge", label: "Edge subnet" }],
			},
			["flowchart_connection_missing", "flowchart_container_missing"],
		],
		[
			"a listed message and their order",
			`sequence diagram, --> is a reply
1. Browser -> API: Get profile
2. API -> Database: Load user
3. Database --> API: User row`,
			{
				type: "sequence",
				participants: [
					{ id: "browser", label: "Browser" },
					{ id: "api", label: "API" },
					{ id: "db", label: "Database" },
				],
				messages: [
					{ id: "2", source: "api", target: "db", label: "Load user" },
					{ id: "1", source: "browser", target: "api", label: "Get profile" },
				],
			},
			["sequence_message_missing", "sequence_order_changed"],
		],
		[
			"quoted text",
			'mobile wireframe: the heading "Welcome back" and a "Sign in" button',
			{
				type: "wireframe",
				screens: [
					{ id: "s", name: "Login", children: [{ type: "heading", text: "Welcome back" }] },
				],
			},
			["quoted_text_missing"],
		],
	])("reports %s the diagram leaves out", (_name, request, diagram, codes) => {
		expect(checkRequestCoverage(request, diagram).map((issue) => issue.code)).toEqual(codes);
	});
});
