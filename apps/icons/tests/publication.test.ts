// @vitest-environment node

import { openD1 } from "./support/d1.js";
import { Effect } from "effect";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
	EXCALIDRAW_LIBRARY_BACKEND,
	type ExcalidrawPublishEnv,
	handlePackPublish,
	installLinkFromPullRequest,
	loadPackExcalidrawStates,
	packExcalidrawStates,
	PULL_REQUEST_RECHECK_MS,
	type SubmissionRow,
} from "../src/features/packs/publication.server";
import { packVersion } from "../src/lib/packs";

// Native Fetch references keep one transport identity; dispatch stays local to this suite.
let activeFetch: typeof fetch = async () => {
	throw new Error("Unexpected upstream call");
};
const dispatch: typeof fetch = (input, init) => activeFetch(input, init);
vi.stubGlobal("fetch", dispatch);
const setFetch = (fetch: typeof globalThis.fetch) => {
	activeFetch = fetch;
};
afterAll(() => vi.unstubAllGlobals());
const requestHref = (input: RequestInfo | URL | undefined) =>
	typeof input === "string" ? input : input instanceof URL ? input.href : (input?.url ?? "");
const cleanup: (() => Promise<void>)[] = [];
async function nativeDatabase() {
	const fixture = await openD1();
	cleanup.push(fixture.dispose);
	const db = fixture.database;
	await db.batch([
		db.prepare(
			"CREATE TABLE excalidraw_library_submissions(pack_id TEXT NOT NULL,version TEXT NOT NULL,status TEXT NOT NULL,author_name TEXT NOT NULL,pull_request_url TEXT,install_url TEXT,pull_request TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(pack_id,version))",
		),
		db.prepare(
			"CREATE TABLE excalidraw_library_pull_requests(url TEXT PRIMARY KEY,state TEXT,etag TEXT,checked_at INTEGER NOT NULL)",
		),
	]);
	return db;
}
type Database = NonNullable<ExcalidrawPublishEnv["COMMUNITY_ICONS"]>;
// Delay settlement only: every statement and result still comes from native D1.
function delaySettlement(
	database: Database,
	sqlPattern: RegExp,
	committed: PromiseWithResolvers<void>,
	settle: PromiseWithResolvers<void>,
): Database {
	const statement = (prepared: ReturnType<Database["prepare"]>, sql: string): typeof prepared =>
		new Proxy(prepared, {
			get(target, key) {
				if (key === "bind")
					return (...values: Parameters<typeof target.bind>) =>
						statement(target.bind(...values), sql);
				if (key === "all" && sqlPattern.test(sql))
					return async () => {
						const result = await target.all();
						committed.resolve();
						await settle.promise;
						return result;
					};
				const value = Reflect.get(target, key);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});

	return new Proxy(database, {
		get(target, key) {
			if (key === "prepare") return (sql: string) => statement(target.prepare(sql), sql);
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
async function claim(db: Database, packId: string, version: string, author: string, now: number) {
	const result = await db
		.prepare(
			"INSERT INTO excalidraw_library_submissions(pack_id,version,status,author_name,created_at) VALUES(?,?,'pending',?,?) ON CONFLICT DO NOTHING",
		)
		.bind(packId, version, author, now)
		.run();
	return result.meta.changes === 1;
}
async function recordSubmission(
	db: Database,
	packId: string,
	version: string,
	result: { pullRequestUrl: string; installUrl?: string; pullRequest: string },
) {
	await db
		.prepare(
			"UPDATE excalidraw_library_submissions SET status='submitted',pull_request_url=?,install_url=?,pull_request=? WHERE pack_id=? AND version=?",
		)
		.bind(result.pullRequestUrl, result.installUrl ?? null, result.pullRequest, packId, version)
		.run();
}
async function readSubmissionRows(db: Database) {
	return (
		await db
			.prepare(
				"SELECT s.pack_id,s.version,s.status,s.pull_request_url,s.install_url,s.created_at,p.state AS pull_request_state,p.checked_at AS pull_request_checked_at FROM excalidraw_library_submissions s LEFT JOIN excalidraw_library_pull_requests p ON p.url=s.pull_request_url ORDER BY s.created_at DESC",
			)
			.all<SubmissionRow>()
	).results;
}
const LIBRARY = JSON.stringify({
	type: "excalidrawlib",
	version: 2,
	source: "https://icons.sketchi.app",
	libraryItems: [{ id: "catalog-palantir", status: "published", name: "Palantir", elements: [] }],
});
const PREVIEW = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PR = "https://github.com/excalidraw/excalidraw-libraries/pull/4242";
const INSTALL =
	"https://excalidraw.com/?addLibrary=https%3A%2F%2Fraw.githubusercontent.com%2Fexcalidraw%2Fexcalidraw-libraries%2Fjane-palantir-platform-icons-1%2Flibraries%2Fjane%2Fpalantir-platform-icons.excalidrawlib%3Fraw%3Dtrue";

async function environment(
	overrides: Partial<ExcalidrawPublishEnv> = {},
): Promise<ExcalidrawPublishEnv> {
	return {
		ASSETS: {
			fetch: async (input) => {
				const { pathname } = new URL(input instanceof Request ? input.url : input);
				if (pathname === "/packs/palantir.excalidrawlib") return new Response(LIBRARY);
				if (pathname === "/packs/palantir.preview.jpg") return new Response(PREVIEW);
				return new Response("", { status: 404 });
			},
		},
		COMMUNITY_ICONS: await nativeDatabase(),
		EXCALIDRAW_LIBRARY_SUBMIT: "on",
		...overrides,
	};
}

function publish(
	env: ExcalidrawPublishEnv,
	body: unknown = { authorName: "Jane" },
	pack = "palantir",
	signal?: AbortSignal,
) {
	return handlePackPublish(
		new Request(`https://icons.sketchi.app/api/packs/${pack}/excalidraw`, {
			method: "POST",
			...(signal ? { signal } : {}),
			headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
		env,
	);
}

/** Excalidraw's backend and GitHub's API, as the Worker sees them. */
function backend(options: { submit?: () => Response; pull?: () => Response } = {}) {
	const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url === `${EXCALIDRAW_LIBRARY_BACKEND}/submit`) {
			return options.submit?.() ?? Response.json({ url: PR });
		}
		if (url === "https://api.github.com/repos/excalidraw/excalidraw-libraries/pulls/4242") {
			return (
				options.pull?.() ??
				Response.json({
					head: { ref: "jane-palantir-platform-icons-1" },
					body: `Hand-drawn icons.\n\nItems: Palantir\n\n[Installation link](${INSTALL})\n`,
				})
			);
		}
		throw new Error(`Unexpected fetch ${url}`);
	});
	setFetch(fetchMock);
	return fetchMock;
}

function submissionRows(env: ExcalidrawPublishEnv) {
	return env
		.COMMUNITY_ICONS!.prepare(
			"SELECT status, pull_request_url, install_url, pull_request FROM excalidraw_library_submissions",
		)
		.all<Record<string, string | null>>()
		.then(({ results }) => results);
}

afterEach(async () => {
	for (const dispose of cleanup.splice(0)) await dispose();
	activeFetch = async () => {
		throw new Error("Unexpected upstream call");
	};
	vi.useRealTimers();
});

describe("publishing a pack to Excalidraw", () => {
	it("does not hold a replacement claim when interrupted after a refusal DELETE commits", async () => {
		const env = await environment();
		const database = env.COMMUNITY_ICONS!;
		const deleted = Promise.withResolvers<void>();
		const settleDelete = Promise.withResolvers<void>();
		const replacementSent = Promise.withResolvers<void>();
		const refuseReplacement = Promise.withResolvers<void>();
		const delayed = delaySettlement(
			database,
			/^DELETE FROM excalidraw_library_submissions/u,
			deleted,
			settleDelete,
		);
		let submissions = 0;
		setFetch(async (input) => {
			if (!requestHref(input).endsWith("/submit")) return Response.json({ body: null });
			submissions++;
			if (submissions === 2) {
				replacementSent.resolve();
				await refuseReplacement.promise;
			}
			return submissions < 3
				? Response.json({ message: "Refused" }, { status: 422 })
				: Response.json({ url: PR });
		});
		const controller = new AbortController();
		const first = publish(
			{ ...env, COMMUNITY_ICONS: delayed },
			{ authorName: "A" },
			"palantir",
			controller.signal,
		).catch(() => undefined);
		await deleted.promise;
		controller.abort();
		const second = publish(env, { authorName: "B" });
		await replacementSent.promise;
		settleDelete.resolve();
		await first;
		const replacement = await submissionRows(env);
		refuseReplacement.resolve();
		const refusal = await second;
		const afterRefusal = await submissionRows(env);
		const retry = await publish(env, { authorName: "C" });
		console.info(
			"replacement-claim receipt",
			JSON.stringify({
				replacement,
				refusal: refusal.status,
				afterRefusal,
				retry: retry.status,
				submissions,
			}),
		);
		expect(replacement).toMatchObject([{ status: "pending" }]);
		expect(refusal.status).toBe(502);
		expect(afterRefusal).toEqual([]);
		expect(retry.status).toBe(201);
		expect(submissions).toBe(3);
	});

	it("keeps a committed claim closed if cancellation arrives before sending", async () => {
		const env = await environment();
		const committed = Promise.withResolvers<void>();
		const settle = Promise.withResolvers<void>();
		const delayed = delaySettlement(
			env.COMMUNITY_ICONS!,
			/^INSERT INTO excalidraw_library_submissions/u,
			committed,
			settle,
		);
		const fetchMock = backend();
		const controller = new AbortController();
		const first = publish(
			{ ...env, COMMUNITY_ICONS: delayed },
			undefined,
			"palantir",
			controller.signal,
		).catch(() => undefined);
		await committed.promise;
		controller.abort();
		settle.resolve();
		await first;
		expect(await submissionRows(env)).toMatchObject([{ status: "pending" }]);
		expect((await publish(env)).status).toBe(409);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([false, true])(
		"keeps interrupted sends closed, including a failed hold write: %s",
		async (failHold) => {
			const env = await environment();
			if (failHold)
				await env
					.COMMUNITY_ICONS!.prepare(
						"CREATE TRIGGER refuse_hold BEFORE UPDATE OF status ON excalidraw_library_submissions WHEN NEW.status='unconfirmed' BEGIN SELECT RAISE(ABORT, 'controlled hold failure'); END",
					)
					.run();
			const sent = Promise.withResolvers<void>();
			let submissions = 0;
			setFetch(async (_input, init) => {
				submissions++;
				sent.resolve();
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				});
			});
			const controller = new AbortController();
			const first = publish(env, undefined, "palantir", controller.signal).catch(() => undefined);
			await sent.promise;
			controller.abort();
			await first;
			expect(await submissionRows(env)).toMatchObject([
				{ status: failHold ? "pending" : "unconfirmed" },
			]);
			expect((await publish(env)).status).toBe(409);
			expect(submissions).toBe(1);
		},
	);

	it("retains its own claim if a definite refusal DELETE fails", async () => {
		const env = await environment();
		await env
			.COMMUNITY_ICONS!.prepare(
				"CREATE TRIGGER refuse_delete BEFORE DELETE ON excalidraw_library_submissions BEGIN SELECT RAISE(ABORT, 'controlled delete failure'); END",
			)
			.run();
		const fetchMock = backend({
			submit: () => Response.json({ message: "Refused" }, { status: 422 }),
		});
		expect((await publish(env)).status).toBe(500);
		expect(await submissionRows(env)).toMatchObject([{ status: "pending" }]);
		expect((await publish(env)).status).toBe(409);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("is off unless the Worker turns it on, and never reaches the backend then", async () => {
		const fetchMock = backend();
		const { EXCALIDRAW_LIBRARY_SUBMIT: _on, ...off } = await environment();
		const response = await publish(off);
		expect(response.status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("sends the dialog's form once, records the pull request and its install link", async () => {
		const fetchMock = backend();
		const env = await environment();
		const response = await publish(env, {
			authorName: "  Jane Doe ",
			xHandle: "https://x.com/jane_d",
			website: "",
		});
		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ pullRequestUrl: PR, installUrl: INSTALL });

		const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
		expect([...form.keys()]).toEqual([
			"excalidrawLib",
			"previewImage",
			"previewImageType",
			"title",
			"authorName",
			"githubHandle",
			"name",
			"description",
			"twitterHandle",
			"website",
		]);
		expect(await (form.get("excalidrawLib") as Blob).text()).toBe(
			JSON.stringify(JSON.parse(LIBRARY), null, 2),
		);
		const preview = form.get("previewImage") as File;
		expect([preview.type, new Uint8Array(await preview.arrayBuffer())]).toEqual([
			"image/jpeg",
			PREVIEW,
		]);
		expect(
			Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")),
		).toEqual({
			previewImageType: "image/jpeg",
			title: "Palantir Platform Icons",
			authorName: "Jane Doe",
			githubHandle: "",
			name: "Palantir Platform Icons",
			description: expect.stringMatching(/^Hand-drawn icons for Palantir's platforms/u),
			twitterHandle: "jane_d",
			website: "https://icons.sketchi.app/packs/palantir",
		});
		const pullLookup = fetchMock.mock.calls[1]?.[1] as RequestInit;
		expect(new Headers(pullLookup.headers).get("User-Agent")).toBe("sketchi-icons");
		expect(pullLookup.signal).toBeInstanceOf(AbortSignal);

		// The same version is never sent twice.
		expect((await publish(env)).status).toBe(409);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const version = await packVersion(LIBRARY);
		const rows = await readSubmissionRows(env.COMMUNITY_ICONS!);
		expect(packExcalidrawStates([{ id: "palantir", version }], rows, { enabled: true })).toEqual({
			palantir: { installUrl: INSTALL, pullRequest: { url: PR }, publishable: false },
		});
	});

	it("frees the version when the backend refuses, so the next visitor can try", async () => {
		const env = await environment();
		const refused = backend({
			submit: () =>
				Response.json({ message: "Library with this name already exists" }, { status: 422 }),
		});
		const response = await publish(env);
		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "upstream_refused", message: expect.stringContaining("already exists") },
		});
		expect(refused).toHaveBeenCalledTimes(1);
		expect(await submissionRows(env)).toEqual([]);
		backend();
		expect((await publish(env)).status).toBe(201);
	});

	// The collection's backend opens the pull request before it answers, on a fresh branch each
	// time, so any outcome short of an answer or a refusal may already have opened one.
	it.each([
		[
			"a timeout",
			() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
		],
		["a dropped connection", () => Promise.reject(new TypeError("Network connection lost."))],
		["a server error", () => Promise.resolve(new Response("upstream error", { status: 503 }))],
		[
			"an answer without a pull request of the collection",
			() => Promise.resolve(Response.json({ url: "https://example.com/pull/1" })),
		],
	])("holds the version after %s and never sends it again", async (_case, submit) => {
		const env = await environment();
		const first = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url === `${EXCALIDRAW_LIBRARY_BACKEND}/submit`) return submit();
			throw new Error(`Unexpected fetch ${url}`);
		});
		setFetch(first);
		const response = await publish(env);
		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "upstream_unconfirmed" },
		});
		const [held] = await submissionRows(env);
		expect(held).toMatchObject({ status: "unconfirmed", pull_request_url: null });
		expect(JSON.parse(String(held?.["pull_request"]))).toBeTypeOf("object");

		const retry = backend();
		expect((await publish(env)).status).toBe(409);
		expect(retry).not.toHaveBeenCalled();
		const rows = await readSubmissionRows(env.COMMUNITY_ICONS!);
		expect(
			packExcalidrawStates([{ id: "palantir", version: await packVersion(LIBRARY) }], rows, {
				enabled: true,
			}).palantir,
		).toEqual({ publishable: false });
	});

	it("lets one native D1 claimant send while an overlapping request observes the taken version", async () => {
		const env = await environment();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const fetchMock = backend();
		setFetch(async (input, init) => {
			if (requestHref(input).endsWith("/submit")) {
				started.resolve();
				await release.promise;
			}
			return Reflect.apply(fetchMock, undefined, [input, init]);
		});
		const first = publish(env);
		try {
			await started.promise;
			expect((await publish(env)).status).toBe(409);
		} finally {
			release.resolve();
		}
		expect((await first).status).toBe(201);
		expect(
			fetchMock.mock.calls.filter(([input]) => requestHref(input).endsWith("/submit")),
		).toHaveLength(1);
	});

	it("never lets a claim lapse: a Worker that stopped mid-send may have opened a pull request", async () => {
		const env = await environment();
		const version = await packVersion(LIBRARY);
		const longAgo = Date.now() - 30 * 24 * 3_600_000;
		expect(await claim(env.COMMUNITY_ICONS!, "palantir", version, "Someone", longAgo)).toBe(true);
		const fetchMock = backend();
		expect((await publish(env)).status).toBe(409);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await claim(env.COMMUNITY_ICONS!, "palantir", version, "Jane", Date.now())).toBe(false);
		expect(
			packExcalidrawStates(
				[{ id: "palantir", version }],
				await readSubmissionRows(env.COMMUNITY_ICONS!),
				{ enabled: true },
			).palantir,
		).toEqual({ publishable: false });
	});

	it("refuses a bad or oversized body and a client over its limit", async () => {
		backend();
		const env = await environment();
		for (const body of [
			{ authorName: "x".repeat(61) },
			{ authorName: "Jane\nDoe" },
			{ authorName: "Jane", xHandle: "not a handle" },
			{ authorName: "Jane", xHandle: "https://x.com/jane/status/1" },
			{ authorName: "Jane", website: "http://jane.dev" },
			{ authorName: "Jane", website: "javascript:alert(1)" },
			[],
		]) {
			const response = await publish(env, body);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				error: { code: "invalid_request", message: expect.any(String) },
			});
		}

		expect((await publish(env, { authorName: "" })).status).toBe(400);
		expect((await publish(env, "not json")).status).toBe(400);
		expect((await publish(env, { authorName: "x".repeat(4000) })).status).toBe(413);
		const take = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 1200 }));
		const limited = await publish(
			await environment({ COMMUNITY_CLIENT_LIMIT: { getByName: () => ({ take }) } }),
		);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("1200");
		expect(take).toHaveBeenCalledWith(3, 3_600_000);
		const accepted = backend();
		expect((await publish(env, { authorName: " Jane ", website: "https://jane.dev" })).status).toBe(
			201,
		);
		const form = accepted.mock.calls[0]?.[1]?.body as FormData;
		expect(form.get("authorName")).toBe("Jane");
		expect(form.get("website")).toBe("https://jane.dev/");
	});
});

const MAIN_INSTALL =
	"https://excalidraw.com/?addLibrary=https%3A%2F%2Fraw.githubusercontent.com%2Fexcalidraw%2Fexcalidraw-libraries%2Fmain%2Flibraries%2Fjane%2Fpalantir-platform-icons.excalidrawlib%3Fraw%3Dtrue";

describe("pull request states", () => {
	const OTHER = "https://github.com/excalidraw/excalidraw-libraries/pull/4243";

	async function seeded(version = "v1") {
		const env = await environment();
		await claim(env.COMMUNITY_ICONS!, "palantir", version, "Jane", 1);
		await recordSubmission(env.COMMUNITY_ICONS!, "palantir", version, {
			pullRequestUrl: PR,
			installUrl: INSTALL,
			pullRequest: "{}",
		});
		await claim(env.COMMUNITY_ICONS!, "databricks", "v1", "Jane", 2);
		await recordSubmission(env.COMMUNITY_ICONS!, "databricks", "v1", {
			pullRequestUrl: OTHER,
			pullRequest: "{}",
		});
		return env;
	}

	/** GitHub's answers by pull request number, with ETags; an `If-None-Match` hit answers 304. */
	function github(answers: Record<string, () => Response>) {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const number = /\/pulls\/(\d+)$/u.exec(url)?.[1] ?? "";
			const etag = new Headers(init?.headers).get("If-None-Match");
			if (etag === `"${number}"`) return new Response(null, { status: 304 });
			const answer = answers[number];
			if (!answer) throw new Error(`Unexpected fetch ${url}`);
			return answer();
		});
		setFetch(fetchMock);
		return fetchMock;
	}

	const pull = (number: string, body: object) =>
		Response.json(body, { headers: { ETag: `"${number}"` } });

	async function load(env: ExcalidrawPublishEnv, now: number) {
		const later: Promise<unknown>[] = [];
		const states = await Effect.runPromise(
			loadPackExcalidrawStates(
				env,
				[
					{ id: "palantir", version: "v1" },
					{ id: "databricks", version: "v1" },
				],
				{ now, waitUntil: (promise) => later.push(promise) },
			),
		);
		await Promise.all(later);
		return { states, refreshed: later.length > 0 };
	}

	it("reads GitHub after the page, once per interval, and shows what it read next time", async () => {
		const env = await seeded();
		const fetchMock = github({
			"4242": () => pull("4242", { state: "closed", merged_at: "2026-11-12T10:00:00Z" }),
			"4243": () => pull("4243", { state: "open", merged_at: null }),
		});
		const first = await load(env, 1_000);
		// The page renders what is stored; the read runs after it.
		expect(first.states["palantir"]?.pullRequest).toEqual({ url: PR });
		expect(first.refreshed).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const second = await load(env, 2_000);
		expect(second.states["palantir"]).toMatchObject({
			installUrl: MAIN_INSTALL,
			pullRequest: { url: PR, state: "merged" },
		});
		expect(second.states["databricks"]?.pullRequest).toEqual({ url: OTHER, state: "open" });
		// Neither is due yet.
		expect(second.refreshed).toBe(false);

		// An open pull request is read again after its interval, with its ETag; a merge is final.
		const third = await load(env, 1_000 + PULL_REQUEST_RECHECK_MS.open);
		expect(third.refreshed).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(requestHref(fetchMock.mock.calls[2]?.[0])).toContain("/pulls/4243");
		expect(third.states["databricks"]?.pullRequest?.state).toBe("open");
	});

	it("keeps the last state when GitHub fails, and one reader takes each due read", async () => {
		const env = await seeded();
		github({
			"4242": () => pull("4242", { state: "open", merged_at: null }),
			"4243": () => pull("4243", { state: "closed", merged_at: null }),
		});
		await load(env, 1_000);
		const fetchMock = github({
			"4242": () => new Response("rate limited", { status: 403 }),
			"4243": () => new Response("rate limited", { status: 403 }),
		});
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const due = 1_000 + PULL_REQUEST_RECHECK_MS.closed;
		const [a, b] = await Promise.all([load(env, due), load(env, due)]);
		expect(a.refreshed && b.refreshed).toBe(true);
		// Each pull request was read once between the two loads, and failed.
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const after = await load(env, due + 1);
		expect(after.states["palantir"]?.pullRequest?.state).toBe("open");
		expect(after.states["databricks"]?.pullRequest?.state).toBe("closed");
	});
});

describe("install links", () => {
	it("only trusts an install link of the collection's form", () => {
		expect(installLinkFromPullRequest(`[Installation link](${INSTALL})`)).toBe(INSTALL);
		expect(
			installLinkFromPullRequest(
				"[Installation link](https://excalidraw.com/#url=https://x.dev/a)",
			),
		).toBeUndefined();
	});
});
