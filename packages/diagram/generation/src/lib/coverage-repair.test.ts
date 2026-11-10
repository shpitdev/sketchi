import { describe, expect, it } from "@effect/vitest";
import { checkRequestCoverage } from "@sketchi/diagram-core";
import { Effect } from "effect";

import { candidateFromText, type DiagramGenerationRequest } from "./candidates.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";

const codes = (request: string, diagram: unknown) =>
	checkRequestCoverage(request, diagram).map((issue) => issue.code);

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

	it.effect("does not repair a correct pair of exclusive conditional branches", () =>
		Effect.gen(function* () {
			const source = JSON.stringify({
				title: "Review",
				diagram: {
					type: "flowchart",
					nodes: { submit: "Submit", valid: "Valid?", save: "Save", reject: "Reject" },
					edges: [
						["submit", "valid"],
						["valid", "save", "yes"],
						["valid", "reject", "no"],
					],
				},
			});
			const { candidate, seen } = yield* run(
				[source],
				"If valid then save, otherwise then reject.",
			);
			expect(seen).toHaveLength(1);
			expect(candidate.error).toBeUndefined();
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

describe("a repair that adds the action a return path states", () => {
	it.effect("is kept, though it reroutes the arrow back", () =>
		Effect.gen(function* () {
			const request =
				"flowchart: a build starts, then the bot runs checks. Passing checks merge the change; failing checks keep retrying and run checks again.";
			const answer = (nodes: Record<string, string>, edges: string[][]) =>
				JSON.stringify({
					title: "Merge bot",
					diagram: { id: "bot", type: "flowchart", nodes, edges },
				});
			const nodes = {
				start: "Build starts",
				run: "Run checks",
				passed: "Checks pass?",
				merge: "Merge change",
			};
			const direct = answer(nodes, [
				["start", "run"],
				["run", "passed"],
				["passed", "merge", "yes"],
				["passed", "run", "no"],
			]);
			const throughRetry = answer({ ...nodes, retry: "Keep retrying" }, [
				["start", "run"],
				["run", "passed"],
				["passed", "merge", "yes"],
				["passed", "retry", "no"],
				["retry", "run"],
			]);
			const texts = [direct, throughRetry];
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
			expect(candidate.text).toBe(throughRetry);
			expect(candidate.diagnostics.at(-1)).toMatch(/^coverage_repair_succeeded/u);
		}),
	);
});

describe("a repair that moves a borrowed or split step", () => {
	const policy = {
		concurrency: 1,
		maxRepairAttempts: 2,
		maxRetries: 0,
		requestTimeoutMs: 1_000,
		retryDelayMs: 1,
		totalTimeoutMs: 10_000,
	};
	const answer = (nodes: Record<string, string>, edges: string[][]) =>
		JSON.stringify({
			title: "Release",
			diagram: { id: "release", type: "flowchart", nodes, edges },
		});
	const run = (request: string, texts: readonly string[]) =>
		Effect.gen(function* () {
			let calls = 0;
			const candidate = yield* runDiagramGenerationWithPolicy(
				() =>
					Effect.succeed(
						candidateFromText({ model: "m", provider: "fixture", text: texts[calls++] ?? "" }),
					),
				{ model: "m", prompt: { id: "x", request } },
				"fixture",
				policy,
			);
			return { calls, candidate };
		});

	it.effect("is kept when it takes a sibling branch off the shared step", () =>
		Effect.gen(function* () {
			const request =
				"Pick the target. Staging and canary paths both run smoke tests. Production deploys and ends. Passing smoke tests finish; failing ones page the on-call engineer.";
			const nodes = {
				target: "Target?",
				staging: "Staging deploy",
				canary: "Canary deploy",
				production: "Production deploy",
				smoke: "Run smoke tests",
				passed: "Smoke tests pass?",
				finish: "Finish",
				page: "Page on-call engineer",
			};
			const shared = [
				["target", "staging", "staging"],
				["target", "canary", "canary"],
				["target", "production", "production"],
				["staging", "smoke"],
				["canary", "smoke"],
				["smoke", "passed"],
				["passed", "finish", "yes"],
				["passed", "page", "no"],
			];
			const borrowed = answer(nodes, [...shared, ["production", "smoke"]]);
			const fixed = answer(nodes, shared);
			const { calls, candidate } = yield* run(request, [borrowed, fixed]);
			expect(calls).toBe(2);
			expect(candidate.text).toBe(fixed);
			expect(candidate.diagnostics.at(-1)).toMatch(/^coverage_repair_succeeded/u);
		}),
	);

	it.effect("is kept when it points a dead-end copy's branch at the step", () =>
		Effect.gen(function* () {
			const request =
				"Intact items restock the shelf and refund the customer. Items with missing parts are repaired before restocking the shelf.";
			const nodes = {
				intact: "Item intact?",
				restock: "Restock shelf",
				refund: "Refund customer",
				repair: "Repair item",
			};
			const split = answer({ ...nodes, again: "Restock shelf" }, [
				["intact", "restock", "yes"],
				["restock", "refund"],
				["intact", "repair", "no"],
				["repair", "again"],
			]);
			const rejoined = answer(nodes, [
				["intact", "restock", "yes"],
				["restock", "refund"],
				["intact", "repair", "no"],
				["repair", "restock"],
			]);
			const { calls, candidate } = yield* run(request, [split, rejoined]);
			expect(calls).toBe(2);
			expect(candidate.text).toBe(rejoined);
		}),
	);
});
