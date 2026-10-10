import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { it as test } from "@effect/vitest";
import { TestClock } from "effect/testing";
import { Clock, Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import {
	ToolProcessSpawner,
	type ToolProcessSpec,
	type ToolProcessTerminal,
} from "@sketchi/diagram-scenarios/internal/tool-process";
import { R2SqlQueryError, retryAfterDelayMs } from "./r2-sql.ts";

import {
	aggregateQuery,
	assertAggregateMatches,
	runCatalogSmoke,
	resolveAccountId,
	verifyQueries,
	runR2SqlQuery,
	pollTransient,
	type CatalogSmokeContext,
	type PollPolicy,
	catalogSmokeNames,
	cloudflareErrorSummary,
	isR2SqlSuccess,
	normalizePipelineNamePart,
	parseWranglerJsonOutput,
	pipelineStatusFrom,
	r2SqlApiUrl,
	r2SqlErrorSummary,
	redactSecrets,
	requireToken,
	sqlStringLiteral,
	streamEndpointFrom,
} from "./r2-catalog-smoke.ts";

test("normalizePipelineNamePart keeps Cloudflare Pipeline-safe names", () => {
	assert.equal(
		normalizePipelineNamePart("Sketchi R2 SQL Fresh 2026-06-28"),
		"sketchi_r2_sql_fresh_2026_06_28",
	);
});

test("normalizePipelineNamePart rejects empty names", () => {
	assert.throws(() => normalizePipelineNamePart("---"), /Invalid Pipeline/);
});

test("catalogSmokeNames derives consistent bucket and pipeline names", () => {
	assert.deepEqual(
		catalogSmokeNames({
			accountId: "abc123",
			suffix: "20260628233000",
		}),
		{
			base: "sketchi_r2sql_20260628233000",
			bucket: "sketchi-r2sql-20260628233000",
			namespace: "smoke",
			pipeline: "sketchi_r2sql_20260628233000_pipeline",
			sink: "sketchi_r2sql_20260628233000_sink",
			stream: "sketchi_r2sql_20260628233000_stream",
			table: "events",
			warehouse: "abc123_sketchi-r2sql-20260628233000",
		},
	);
});

test("catalogSmokeNames rejects invalid explicit bucket names", () => {
	assert.throws(
		() => catalogSmokeNames({ bucket: "Not_A_Bucket", suffix: "ok" }),
		/Invalid R2 bucket/,
	);
});

test("sqlStringLiteral escapes single quotes", () => {
	assert.equal(sqlStringLiteral("row's value"), "'row''s value'");
});

test("aggregateQuery filters to the ingested value", () => {
	assert.equal(
		aggregateQuery({ namespace: "sketchi_codemode", table: "usage_events" }, "row's value"),
		[
			"SELECT",
			"  COUNT(*) AS total_rows,",
			"  MIN(value) AS min_value,",
			"  MAX(value) AS max_value",
			"FROM sketchi_codemode.usage_events",
			"WHERE value = 'row''s value'",
		].join("\n"),
	);
});

test("r2SqlApiUrl targets the direct R2 SQL endpoint", () => {
	assert.equal(
		r2SqlApiUrl("account-id", "bucket-name"),
		"https://api.sql.cloudflarestorage.com/api/v1/accounts/account-id/r2-sql/query/bucket-name",
	);
});

test("isR2SqlSuccess only accepts explicit successful query responses", () => {
	assert.equal(isR2SqlSuccess({ success: true }), true);
	assert.equal(isR2SqlSuccess({ success: false }), false);
	assert.equal(isR2SqlSuccess({}), false);
});

test("r2SqlErrorSummary preserves R2 SQL error code and message", () => {
	assert.equal(
		r2SqlErrorSummary({
			errors: [{ code: 50408, message: "Corrupted Catalog" }],
		}),
		"50408: Corrupted Catalog",
	);
});

test("cloudflareErrorSummary preserves Cloudflare API error code and message", () => {
	assert.equal(
		cloudflareErrorSummary({
			errors: [{ code: 9109, message: "Unauthorized to access requested resource" }],
		}),
		"9109: Unauthorized to access requested resource",
	);
});

test("redactSecrets removes token values from logs", () => {
	assert.equal(
		redactSecrets("wrangler --catalog-token secret-token", ["secret-token"]),
		"wrangler --catalog-token [redacted]",
	);
});

test("streamEndpointFrom extracts the HTTP ingest endpoint", () => {
	assert.equal(
		streamEndpointFrom(
			"Endpoint:        https://b6755dc0c97f4fc4b088f53fd9ab5a4d.ingest.cloudflare.com",
		),
		"https://b6755dc0c97f4fc4b088f53fd9ab5a4d.ingest.cloudflare.com",
	);
});

test("requireToken explains the credential boundary", () => {
	assert.throws(
		() => requireToken({}, "WRANGLER_R2_SQL_AUTH_TOKEN"),
		/Wrangler OAuth tokens can list catalog metadata/,
	);
});

test("requireToken returns the configured token", () => {
	assert.equal(requireToken({ WRANGLER_R2_SQL_AUTH_TOKEN: "  token-value  " }), "token-value");
});

test("parseWranglerJsonOutput extracts JSON from wrangler output", () => {
	assert.deepEqual(
		parseWranglerJsonOutput(
			[
				"wrangler pipelines get example --json",
				'{ "result": { "status": "running" } }',
				"warning: beta command",
			].join("\n"),
		),
		{ result: { status: "running" } },
	);
});

test("pipelineStatusFrom normalizes details responses", () => {
	assert.equal(pipelineStatusFrom({ result: { status: "Running" } }), "running");
	assert.equal(pipelineStatusFrom({ status: "ACTIVE" }), "active");
});

test("assertAggregateMatches accepts the ingested row", () => {
	assert.doesNotThrow(() =>
		assertAggregateMatches(
			{
				result: {
					rows: [{ total_rows: 1, min_value: "expected", max_value: "expected" }],
				},
			},
			"expected",
		),
	);
});

test("assertAggregateMatches rejects metadata-only tables", () => {
	assert.throws(
		() =>
			assertAggregateMatches(
				{
					result: {
						rows: [{ total_rows: 0, min_value: null, max_value: null }],
					},
				},
				"expected",
			),
		/did not return the ingested value/,
	);
});

const offlineEnv = {
	WRANGLER_R2_SQL_AUTH_TOKEN: "offline-token",
	CLOUDFLARE_ACCOUNT_ID: "offline-account",
	SENTINEL: "injected-env",
};
const noDelayPolicy: PollPolicy = {
	attempts: 3,
	initialDelayMs: 0,
	delayMs: 0,
	attemptTimeoutMs: 1000,
};
const terminal: ToolProcessTerminal = { exitCode: 0, signal: null };
function commandName(spec: ToolProcessSpec): string {
	const args = spec.args.slice(2);
	return args
		.slice(0, args[0] === "r2" || ["streams", "sinks"].includes(args[1] ?? "") ? 3 : 2)
		.join(" ");
}
function fakeSpawner(
	calls: ToolProcessSpec[],
	failCommand?: string,
	onSpawn?: (spec: ToolProcessSpec) => Effect.Effect<void>,
	pipelineStatus = "failed",
) {
	return Layer.succeed(ToolProcessSpawner, {
		spawn: (spec) =>
			Effect.gen(function* () {
				calls.push(spec);
				if (onSpawn) yield* onSpawn(spec);
				const name = commandName(spec);
				const result = { ...terminal, exitCode: name === failCommand ? 1 : 0 };
				return {
					awaitExit: Effect.succeed(result),
					awaitClose: Effect.succeed(result),
					kill: () => Effect.succeed(true),
					output: Effect.succeed({
						stdout:
							name === "pipelines get"
								? JSON.stringify({ result: { status: pipelineStatus } })
								: name === "pipelines streams create"
									? "https://abcdef.ingest.cloudflare.com"
									: "",
						stderr: name === failCommand ? "already exists" : "",
					}),
				};
			}),
	});
}
function withFixture<A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) {
	return Effect.scoped(
		Effect.gen(function* () {
			yield* Effect.tryPromise(() => mkdir(".memory", { recursive: true }));
			const directory = yield* Effect.acquireRelease(
				Effect.tryPromise(() => mkdtemp(join(".memory", "r2-catalog-test-"))),
				(directory) =>
					Effect.tryPromise(() => rm(directory, { recursive: true, force: true })).pipe(
						Effect.ignore,
					),
			);
			return yield* use(directory);
		}),
	);
}
function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	return input instanceof URL ? input.href : input.url;
}

function requestJson(options: RequestInit | undefined): unknown {
	const body = options?.body;
	if (typeof body !== "string") {
		throw new TypeError("Expected a JSON string request body.");
	}
	return JSON.parse(body);
}

function withFetch<A, E, R>(fetchFn: typeof fetch, use: Effect.Effect<A, E, R>) {
	return Effect.scoped(
		Effect.gen(function* () {
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					const previous = globalThis.fetch;
					globalThis.fetch = fetchFn;
					return previous;
				}),
				(previous) =>
					Effect.sync(() => {
						globalThis.fetch = previous;
					}),
			);
			return yield* use;
		}),
	);
}
function queryContext(directory: string): CatalogSmokeContext {
	return {
		accountId: "offline-account",
		cleanup: true,
		created: new Set(),
		env: offlineEnv,
		names: catalogSmokeNames({ accountId: "offline-account", suffix: "test" }),
		outputDir: directory,
		secrets: ["offline-token"],
		token: "offline-token",
	};
}
function queryResponse() {
	return new Response(
		JSON.stringify({
			success: true,
			result: {
				rows: [{ total_rows: 1, min_value: "expected", max_value: "expected" }],
			},
		}),
	);
}

for (const [failure, expectedDeletes] of [
	["r2 bucket create", []],
	["r2 bucket catalog", ["r2 bucket delete"]],
	["pipelines streams create", ["r2 bucket catalog", "r2 bucket delete"]],
	["pipelines sinks create", ["pipelines streams delete", "r2 bucket catalog", "r2 bucket delete"]],
	[
		"pipelines create",
		["pipelines sinks delete", "pipelines streams delete", "r2 bucket catalog", "r2 bucket delete"],
	],
	[
		"pipelines get",
		[
			"pipelines delete",
			"pipelines sinks delete",
			"pipelines streams delete",
			"r2 bucket catalog",
			"r2 bucket delete",
		],
	],
] satisfies readonly (readonly [string, readonly string[]])[]) {
	test.effect(`a failed ${failure} only releases previously created resources in LIFO order`, () =>
		withFixture((directory) =>
			Effect.gen(function* () {
				const calls: ToolProcessSpec[] = [];
				const apiUrls: string[] = [];
				const exit = yield* withFetch(
					async (url) => {
						apiUrls.push(requestUrl(url));
						return new Response(JSON.stringify({ success: true, result: [] }));
					},
					runCatalogSmoke(["--suffix", "test", "--output-dir", directory], offlineEnv).pipe(
						Effect.provide(fakeSpawner(calls, failure)),
						Effect.exit,
					),
				);
				assert.equal(Exit.isFailure(exit), true);
				const failedIndex = calls.findIndex((call) => commandName(call) === failure);
				assert.deepEqual(calls.slice(failedIndex + 1).map(commandName), expectedDeletes);
				if (failure === "r2 bucket create") assert.deepEqual(apiUrls, []);
				for (const call of calls) {
					assert.equal(call.env.CLOUDFLARE_ACCOUNT_ID, "offline-account");
					assert.equal(call.env.CF_ACCOUNT_ID, "offline-account");
					assert.equal(call.env.SENTINEL, "injected-env");
				}
				assert.equal(
					apiUrls.every((url) =>
						url.includes("/accounts/offline-account/r2/buckets/sketchi-r2sql-test/objects"),
					),
					true,
				);
			}),
		),
	);
}

test.effect("account conflicts reject before commands, API calls, or output mutation", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			const calls: ToolProcessSpec[] = [];
			let requests = 0;
			const exit = yield* withFetch(
				async () => {
					requests++;
					throw new Error("Unexpected request");
				},
				runCatalogSmoke(
					["--account-id", "other-account", "--output-dir", directory],
					offlineEnv,
				).pipe(Effect.provide(fakeSpawner(calls)), Effect.exit),
			);
			assert.equal(Exit.isFailure(exit), true);
			assert.deepEqual(calls, []);
			assert.equal(requests, 0);
		}),
	),
);

test("account selection accepts explicit, injected, default, and agreeing legacy identities", () => {
	assert.equal(resolveAccountId("explicit", {}), "explicit");
	assert.equal(resolveAccountId(undefined, { CLOUDFLARE_ACCOUNT_ID: "injected" }), "injected");
	assert.equal(resolveAccountId(undefined, {}), "75f9660f39e4dafe8b95980b87e7399a");
	assert.equal(resolveAccountId("a", { CLOUDFLARE_ACCOUNT_ID: "a", CF_ACCOUNT_ID: "a" }), "a");
	assert.throws(
		() =>
			resolveAccountId(undefined, {
				CLOUDFLARE_ACCOUNT_ID: "a",
				CF_ACCOUNT_ID: "b",
			}),
		/Conflicting/,
	);
});

test.effect("a failed log write after successful creation still releases the owned bucket", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			const calls: ToolProcessSpec[] = [];
			const exit = yield* withFetch(
				async () => new Response(JSON.stringify({ success: true, result: [] })),
				runCatalogSmoke(["--suffix", "test", "--output-dir", directory], offlineEnv).pipe(
					Effect.provide(
						fakeSpawner(calls, undefined, (spec) =>
							commandName(spec) === "r2 bucket create"
								? Effect.tryPromise(() =>
										rm(join(directory, "sketchi_r2sql_test"), {
											recursive: true,
										}),
									).pipe(Effect.orDie)
								: Effect.void,
						),
					),
					Effect.exit,
				),
			);
			assert.equal(Exit.isFailure(exit), true);
			assert.deepEqual(calls.map(commandName), ["r2 bucket create", "r2 bucket delete"]);
		}),
	),
);

test.effect("cleanup continues after a failed delete", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			const calls: ToolProcessSpec[] = [];
			yield* withFetch(
				async () => new Response(JSON.stringify({ success: true, result: [] })),
				runCatalogSmoke(["--suffix", "test", "--output-dir", directory], offlineEnv).pipe(
					Effect.provide(fakeSpawner(calls, "pipelines delete")),
					Effect.exit,
				),
			);
			assert.deepEqual(calls.slice(-5).map(commandName), [
				"pipelines delete",
				"pipelines sinks delete",
				"pipelines streams delete",
				"r2 bucket catalog",
				"r2 bucket delete",
			]);
		}),
	),
);

for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
	test.effect(`HTTP ${status} is classified before JSON decode`, () =>
		withFixture((directory) =>
			Effect.gen(function* () {
				let requests = 0;
				const exit = yield* withFetch(
					async () => {
						requests++;
						return requests === 1
							? new Response("<html>error</html>", { status })
							: queryResponse();
					},
					verifyQueries(queryContext(directory), "expected", noDelayPolicy).pipe(Effect.exit),
				);
				const transient = status === 404 || status === 409 || status === 429 || status >= 500;
				assert.equal(Exit.isSuccess(exit), transient);
				assert.equal(requests, transient ? 4 : 1);
			}),
		),
	);
}

test.effect("network failures retry and malformed success JSON fails immediately", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			let requests = 0;
			yield* withFetch(
				async () => {
					requests++;
					if (requests === 1) throw new TypeError("offline network failure");
					return queryResponse();
				},
				verifyQueries(queryContext(directory), "expected", noDelayPolicy),
			);
			assert.equal(requests, 4);
			requests = 0;
			const exit = yield* withFetch(
				async () => {
					requests++;
					return new Response("not JSON");
				},
				verifyQueries(queryContext(directory), "expected", noDelayPolicy).pipe(Effect.exit),
			);
			assert.equal(Exit.isFailure(exit), true);
			assert.equal(requests, 1);
		}),
	),
);

test.effect("not-yet-visible rows retry within the bounded schedule", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			let requests = 0;
			yield* withFetch(
				async () => {
					requests++;
					return requests <= 3
						? new Response(JSON.stringify({ success: true, result: { rows: [] } }))
						: queryResponse();
				},
				verifyQueries(queryContext(directory), "expected", noDelayPolicy),
			);
			assert.equal(requests, 6);
		}),
	),
);

test.effect("per-attempt timeout aborts a stalled body and exhausts the schedule", () =>
	withFixture((directory) => {
		let bodyAborts = 0;
		return withFetch(
			async (_url, options) => {
				const signal = options?.signal;
				return new Response(
					new ReadableStream({
						start(controller) {
							signal?.addEventListener(
								"abort",
								() => {
									bodyAborts++;
									controller.error(signal.reason);
								},
								{ once: true },
							);
						},
					}),
				);
			},
			Effect.gen(function* () {
				const fiber = yield* verifyQueries(queryContext(directory), "expected", {
					...noDelayPolicy,
					attempts: 2,
					attemptTimeoutMs: 100,
				}).pipe(Effect.forkChild);
				yield* TestClock.adjust(200);
				const exit = yield* Fiber.await(fiber);
				assert.equal(Exit.isFailure(exit), true);
				assert.equal(bodyAborts, 2);
			}),
		);
	}),
);

test.effect("interruption aborts the body without retrying or becoming a domain error", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			let requests = 0;
			let aborted = false;
			yield* withFetch(
				async (_url, options) => {
					requests++;
					const signal = options?.signal;
					return new Response(
						new ReadableStream({
							start(controller) {
								signal?.addEventListener(
									"abort",
									() => {
										aborted = true;
										controller.error(signal.reason);
									},
									{ once: true },
								);
								Deferred.doneUnsafe(started, Exit.void);
							},
						}),
					);
				},
				Effect.gen(function* () {
					const fiber = yield* verifyQueries(
						queryContext(directory),
						"expected",
						noDelayPolicy,
					).pipe(Effect.forkChild);
					yield* Deferred.await(started);
					yield* Fiber.interrupt(fiber);
					const exit = yield* Fiber.await(fiber);
					assert.equal(Exit.isFailure(exit), true);
					if (Exit.isFailure(exit)) assert.equal(Cause.hasInterrupts(exit.cause), true);
					assert.equal(requests, 1);
					assert.equal(aborted, true);
				}),
			);
		}),
	),
);

test.effect("poll schedule is bounded and waits only between transient failures", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const fiber = yield* pollTransient(
			Effect.sync(() => {
				attempts++;
			}).pipe(
				Effect.andThen(Effect.fail(R2SqlQueryError.make({ message: "warming", retryable: true }))),
			),
			{ attempts: 3, initialDelayMs: 10, delayMs: 20, attemptTimeoutMs: 100 },
		).pipe(Effect.forkChild);
		yield* TestClock.adjust(50);
		const exit = yield* Fiber.await(fiber);
		assert.equal(Exit.isFailure(exit), true);
		assert.equal(attempts, 3);
	}),
);

test.effect("successful smoke uses one explicit account for all commands and API requests", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			const calls: ToolProcessSpec[] = [];
			const urls: string[] = [];
			const events: string[] = [];
			yield* withFetch(
				async (url, options) => {
					const value = requestUrl(url);
					urls.push(value);
					if (value.includes("/objects")) {
						events.push(options?.method === "DELETE" ? "purge-objects" : "list-objects");
						if (options?.method === "DELETE") {
							assert.deepEqual(requestJson(options), ["owned-object"]);
							return new Response(JSON.stringify({ success: true }));
						}
						return new Response(
							JSON.stringify({
								success: true,
								result: [{ key: "owned-object" }],
							}),
						);
					}
					if (value.includes("/r2-sql/")) {
						assert.ok(value.includes("/accounts/explicit-account/"));
						assert.equal(
							(requestJson(options) as { readonly warehouse?: unknown }).warehouse,
							"explicit-account_sketchi-r2sql-test",
						);
						return queryResponse();
					}
					return new Response("{}");
				},
				Effect.gen(function* () {
					yield* runCatalogSmoke(
						[
							"--account-id",
							"explicit-account",
							"--suffix",
							"test",
							"--value",
							"expected",
							"--output-dir",
							directory,
						],
						{
							WRANGLER_R2_SQL_AUTH_TOKEN: "offline-token",
							SENTINEL: "injected-env",
						},
						noDelayPolicy,
					).pipe(
						Effect.provide(
							fakeSpawner(
								calls,
								undefined,
								(spec) =>
									Effect.sync(() => {
										if (spec.args.includes("disable")) events.push("disable-catalog");
										if (commandName(spec) === "r2 bucket delete") events.push("delete-bucket");
									}),
								"running",
							),
						),
					);
				}),
			);
			assert.equal(calls.length, 11);
			const configPath = join(directory, "sketchi_r2sql_test", "wrangler.json");
			const config = yield* Effect.tryPromise(() => readFile(configPath, "utf8"));
			assert.deepEqual(JSON.parse(config), {
				account_id: "explicit-account",
			});
			assert.equal(
				calls.every((spec) => spec.args[spec.args.indexOf("--config") + 1] === configPath),
				true,
			);

			assert.equal(
				calls.every(
					(spec) =>
						spec.env.CLOUDFLARE_ACCOUNT_ID === "explicit-account" &&
						spec.env.CF_ACCOUNT_ID === "explicit-account" &&
						spec.env.SENTINEL === "injected-env",
				),
				true,
			);
			assert.equal(
				urls
					.filter((url) => url.includes("/objects"))
					.every((url) => url.includes("/accounts/explicit-account/")),
				true,
			);
			assert.deepEqual(events, [
				"list-objects",
				"purge-objects",
				"disable-catalog",
				"delete-bucket",
			]);
		}),
	),
);

test.effect("interruption releases created resources but not a pending stream create", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			const calls: ToolProcessSpec[] = [];
			const started = yield* Deferred.make<void>();
			const normal = fakeSpawner(calls);
			const hanging = Layer.succeed(ToolProcessSpawner, {
				spawn: (spec) =>
					Effect.gen(function* () {
						if (commandName(spec) !== "pipelines streams create") {
							const spawner = yield* ToolProcessSpawner;
							return yield* spawner.spawn(spec);
						}
						calls.push(spec);
						yield* Deferred.succeed(started, undefined);
						return {
							awaitExit: Effect.never,
							awaitClose: Effect.never,
							kill: () => Effect.succeed(true),
							output: Effect.succeed({ stdout: "", stderr: "" }),
						};
					}).pipe(Effect.provide(normal)),
			});
			yield* withFetch(
				async () => new Response(JSON.stringify({ success: true, result: [] })),
				Effect.gen(function* () {
					const fiber = yield* runCatalogSmoke(
						["--suffix", "test", "--output-dir", directory],
						offlineEnv,
					).pipe(Effect.provide(hanging), Effect.forkChild);
					yield* Deferred.await(started);
					const interrupt = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild);
					yield* TestClock.adjust(3_000);
					yield* Fiber.join(interrupt);
					const exit = yield* Fiber.await(fiber);
					assert.equal(Exit.isFailure(exit), true);
					if (Exit.isFailure(exit)) assert.equal(Cause.hasInterrupts(exit.cause), true);
					assert.deepEqual(calls.slice(-2).map(commandName), [
						"r2 bucket catalog",
						"r2 bucket delete",
					]);
					assert.equal(
						calls.some((spec) => commandName(spec) === "pipelines streams delete"),
						false,
					);
				}),
			);
		}),
	),
);

test.effect("cleanup false does not release even successfully created resources", () =>
	withFixture((directory) =>
		Effect.gen(function* () {
			const calls: ToolProcessSpec[] = [];
			let requests = 0;
			const exit = yield* withFetch(
				async () => {
					requests++;
					throw new Error("Unexpected cleanup API call");
				},
				runCatalogSmoke(
					["--suffix", "test", "--output-dir", directory, "--cleanup", "false"],
					offlineEnv,
				).pipe(Effect.provide(fakeSpawner(calls)), Effect.exit),
			);
			assert.equal(Exit.isFailure(exit), true);
			assert.equal(calls.length, 6);
			assert.equal(
				calls.some((spec) => spec.args.includes("delete") || spec.args.includes("disable")),
				false,
			);
			assert.equal(requests, 0);
		}),
	),
);

test("Retry-After parses seconds and HTTP dates without extending expired dates", () => {
	const now = Date.parse("2026-10-08T19:00:00Z");
	assert.equal(retryAfterDelayMs("2", now), 2000);
	assert.equal(retryAfterDelayMs(" Thu, 08 Oct 2026 19:00:03 GMT ", now), 3000);
	assert.equal(retryAfterDelayMs("Thu, 08 Oct 2026 18:59:00 GMT", now), 0);
	assert.equal(retryAfterDelayMs(null, now), undefined);
	assert.equal(retryAfterDelayMs("invalid", now), undefined);
});

for (const [header, expectedDelay, attemptTimeoutMs] of [
	["2", 2000, 5000],
	["600", 500, 500],
	["http-date", 3000, 5000],
	["invalid", 100, 5000],
] satisfies readonly (readonly [string, number, number])[]) {
	test.effect(`smoke HTTP 429 Retry-After ${header} waits ${expectedDelay}ms before retrying`, () =>
		withFixture((directory) =>
			Effect.gen(function* () {
				const failed = yield* Deferred.make<void>();
				const now = yield* Clock.currentTimeMillis;
				const retryAfter =
					header === "http-date" ? new Date(now + expectedDelay).toUTCString() : header;
				let requests = 0;
				yield* withFetch(
					async () => {
						requests++;
						return requests === 1
							? new Response("<html>rate limited</html>", {
									status: 429,
									headers: { "retry-after": retryAfter },
								})
							: queryResponse();
					},
					Effect.gen(function* () {
						const attempt = runR2SqlQuery(queryContext(directory), "rate-limit", "SELECT 1").pipe(
							Effect.tapError(() => Deferred.succeed(failed, undefined)),
						);
						const fiber = yield* pollTransient(attempt, {
							attempts: 2,
							initialDelayMs: 0,
							delayMs: 100,
							attemptTimeoutMs,
						}).pipe(Effect.forkChild);
						yield* Deferred.await(failed);
						yield* TestClock.adjust(expectedDelay - 1);
						assert.equal(requests, 1);
						yield* TestClock.adjust(1);
						yield* Fiber.join(fiber);
						assert.equal(requests, 2);
					}),
				);
			}),
		),
	);
}
