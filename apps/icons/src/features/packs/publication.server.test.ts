// @vitest-environment node

import { openD1 } from "../../test-support/d1.js";
import { Effect } from "effect";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { parseXHandle } from "./publication";
import {
	EXCALIDRAW_LIBRARY_BACKEND,
	type ExcalidrawPublishEnv,
	handlePackPublish,
	installLinkFromPullRequest,
	loadPackExcalidrawStates,
	mergedInstallUrl,
	packExcalidrawStates,
	PULL_REQUEST_RECHECK_MS,
	type SubmissionRow,
} from "./publication.server";
import { packVersion } from "../../lib/packs";

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
) {
	return handlePackPublish(
		new Request(`https://icons.sketchi.app/api/packs/${pack}/excalidraw`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
		env,
	);
}

/** Excalidraw's backend and GitHub's API, as the Worker sees them. */
function backend(
	options: { submit?: () => Response; pull?: () => Response } = {},
): ReturnType<typeof vi.fn> {
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
	it("is off unless the Worker turns it on, and never reaches the backend then", async () => {
		const fetchMock = backend();
		const { EXCALIDRAW_LIBRARY_SUBMIT: _on, ...off } = await environment();
		const response = await publish(off);
		expect(response.status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("only publishes a pack with a listing", async () => {
		const fetchMock = backend();
		expect((await publish(await environment(), { authorName: "Jane" }, "all")).status).toBe(404);
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

	it("keeps the pull request when GitHub cannot be read, without offering the version again", async () => {
		const env = await environment();
		backend({ pull: () => new Response("rate limited", { status: 403 }) });
		const response = await publish(env);
		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ pullRequestUrl: PR });
		const fetchMock = backend();
		expect((await publish(env)).status).toBe(409);
		expect(fetchMock).not.toHaveBeenCalled();
		const stored = await env
			.COMMUNITY_ICONS!.prepare(
				"SELECT status, pull_request_url, install_url, pull_request FROM excalidraw_library_submissions",
			)
			.first<Record<string, string | null>>();
		expect(stored).toMatchObject({ status: "submitted", pull_request_url: PR, install_url: null });
		expect(stored?.["pull_request"]).toContain("HTTP 403");
	});

	it("stores the pull request's text when its install link cannot be read from it", async () => {
		const env = await environment();
		backend({ pull: () => Response.json({ head: { ref: "jane-x-1" }, body: "edited by hand" }) });
		await expect((await publish(env)).json()).resolves.toEqual({ pullRequestUrl: PR });
		const stored = await env
			.COMMUNITY_ICONS!.prepare("SELECT pull_request FROM excalidraw_library_submissions")
			.first<{ pull_request: string }>();
		expect(JSON.parse(stored!.pull_request)).toEqual({
			branch: "jane-x-1",
			body: "edited by hand",
		});
	});

	it.each(["reported refusal with an existing PR", { detail: "non-string backend metadata" }])(
		"retains trusted PR evidence on a contradictory refusal without a second send: %j",
		async (message) => {
			const env = await environment();
			const fetchMock = backend({
				submit: () => Response.json({ url: PR, message }, { status: 422 }),
			});
			const first = await publish(env);
			expect(first.status).toBe(201);
			expect(await first.json()).toMatchObject({ pullRequestUrl: PR });
			expect((await publish(env)).status).toBe(409);
			expect(
				fetchMock.mock.calls.filter(([input]) => requestHref(input).endsWith("/submit")),
			).toHaveLength(1);
			expect(await submissionRows(env)).toMatchObject([
				{ status: "submitted", pull_request_url: PR },
			]);
		},
	);
	it("returns the confirmed PR when actual D1 refuses completion and still prevents replay", async () => {
		const env = await environment();
		await env.COMMUNITY_ICONS!.exec(
			"CREATE TRIGGER completion_refusal BEFORE UPDATE ON excalidraw_library_submissions BEGIN SELECT RAISE(ABORT, 'local completion write refused'); END;",
		);
		backend();
		const first = await publish(env);
		expect(first.status).toBe(201);
		expect(await first.json()).toMatchObject({ pullRequestUrl: PR });
		expect((await publish(env)).status).toBe(409);
		expect(await submissionRows(env)).toMatchObject([{ status: "pending" }]);
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

function row(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
	return {
		pack_id: "palantir",
		version: "old",
		status: "submitted",
		pull_request_url: PR,
		install_url: INSTALL,
		created_at: 1,
		pull_request_state: null,
		pull_request_checked_at: null,
		...overrides,
	};
}

const MAIN_INSTALL =
	"https://excalidraw.com/?addLibrary=https%3A%2F%2Fraw.githubusercontent.com%2Fexcalidraw%2Fexcalidraw-libraries%2Fmain%2Flibraries%2Fjane%2Fpalantir-platform-icons.excalidrawlib%3Fraw%3Dtrue";

describe("pack states", () => {
	it("keeps an earlier version's install link and opens the new version to publish", () => {
		const states = packExcalidrawStates(
			[
				{ id: "palantir", version: "new" },
				{ id: "all", version: "a" },
			],
			[row()],
			{ enabled: true },
		);
		expect(states).toEqual({
			palantir: { installUrl: INSTALL, pullRequest: { url: PR }, publishable: true },
			all: { publishable: false },
		});
		expect(
			packExcalidrawStates([{ id: "palantir", version: "new" }], [], { enabled: false }),
		).toEqual({ palantir: { publishable: false } });
	});

	it("shows the newest pull request, and adds a merged library from main", () => {
		const newer = "https://github.com/excalidraw/excalidraw-libraries/pull/4300";
		const states = packExcalidrawStates(
			[{ id: "palantir", version: "new" }],
			[
				// Unconfirmed: no pull request, no install link.
				row({
					version: "newest",
					status: "unconfirmed",
					pull_request_url: null,
					install_url: null,
					created_at: 3,
				}),
				row({
					version: "new",
					pull_request_url: newer,
					install_url: null,
					pull_request_state: "open",
					created_at: 2,
				}),
				row({ pull_request_state: "merged" }),
			],
			{ enabled: true },
		);
		expect(states["palantir"]).toEqual({
			installUrl: MAIN_INSTALL,
			pullRequest: { url: newer, state: "open" },
			publishable: false,
		});
	});

	it("stops adding a library whose pull request closed, since its branch may be gone", () => {
		const states = packExcalidrawStates(
			[{ id: "palantir", version: "old" }],
			[row({ pull_request_state: "closed" })],
			{ enabled: true },
		);
		expect(states["palantir"]).toEqual({
			pullRequest: { url: PR, state: "closed" },
			publishable: false,
		});
	});

	it("reads a merged library from main, and refuses a link of another form", () => {
		expect(mergedInstallUrl(INSTALL)).toBe(MAIN_INSTALL);
		expect(
			mergedInstallUrl("https://excalidraw.com/?addLibrary=https%3A%2F%2Fexample.com%2Fx"),
		).toBeUndefined();
	});
});

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

	const MAIN_LIBRARY =
		"https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/jane/palantir-platform-icons.excalidrawlib?raw=true";

	/** GitHub's API refuses; `main` holds the given library text. */
	function refusingApi(mainLibrary: string) {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url === MAIN_LIBRARY) return new Response(mainLibrary);
			return new Response("rate limited", { status: 403 });
		});
		setFetch(fetchMock);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		return fetchMock;
	}

	it("sees a merge on the collection's main when GitHub's API refuses", async () => {
		const env = await seeded(await packVersion(LIBRARY));
		// The collection commits the library pretty-printed.
		refusingApi(JSON.stringify(JSON.parse(LIBRARY), null, 2));
		await load(env, 1_000);
		const after = await load(env, 2_000);
		expect(after.states["palantir"]).toMatchObject({
			installUrl: MAIN_INSTALL,
			pullRequest: { url: PR, state: "merged" },
		});
		// Without an install link there is no file to look for; the state stays unread.
		expect(after.states["databricks"]?.pullRequest).toEqual({ url: OTHER });
	});

	it("never takes another version of the pack on main for this pull request's merge", async () => {
		const env = await seeded(await packVersion(LIBRARY));
		const earlier = JSON.parse(LIBRARY) as { libraryItems: unknown[] };
		earlier.libraryItems = [];
		refusingApi(JSON.stringify(earlier, null, 2));
		await load(env, 1_000);
		const after = await load(env, 1_000 + PULL_REQUEST_RECHECK_MS.unread);
		// Still unread, and still adding this version from its own branch.
		expect(after.states["palantir"]?.pullRequest).toEqual({ url: PR });
		expect(after.states["palantir"]?.installUrl).toBe(INSTALL);
	});

	it("checks the longest unchecked pull requests first, so every one is reached", async () => {
		const env = await environment();
		const numbers = Array.from({ length: 11 }, (_, index) => String(5000 + index));
		for (const [index, number] of numbers.entries()) {
			await claim(env.COMMUNITY_ICONS!, `pack-${index}`, "v1", "Jane", index);
			await recordSubmission(env.COMMUNITY_ICONS!, `pack-${index}`, "v1", {
				pullRequestUrl: `https://github.com/excalidraw/excalidraw-libraries/pull/${number}`,
				pullRequest: "{}",
			});
		}
		const read: string[] = [];
		setFetch(
			vi.fn(async (input: RequestInfo | URL) => {
				const url =
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
				read.push(url.replace(/.*\/pulls\//u, ""));
				return Response.json({ state: "open", merged_at: null });
			}),
		);
		const visit = async (now: number) => {
			const later: Promise<unknown>[] = [];
			await Effect.runPromise(
				loadPackExcalidrawStates(env, [], { now, waitUntil: (promise) => later.push(promise) }),
			);
			await Promise.all(later);
		};
		// Ten a visit: the first takes the ten newest, the next the one left unread first.
		await visit(1_000);
		expect(read).toHaveLength(10);
		expect(read).not.toContain("5000");
		await visit(1_000 + PULL_REQUEST_RECHECK_MS.open);
		expect(read).toHaveLength(20);
		expect(new Set(read)).toEqual(new Set(numbers));
	});
});

describe("author fields", () => {
	it("reads an X handle however it is pasted", () => {
		for (const input of [
			"dimethylpant",
			" @dimethylpant ",
			"https://x.com/dimethylpant",
			"http://twitter.com/dimethylpant/",
			"x.com/dimethylpant",
			"www.x.com/dimethylpant",
			"https://mobile.twitter.com/dimethylpant?s=21&t=abc",
			"https://X.com/dimethylpant#top",
		]) {
			expect(parseXHandle(input), input).toEqual({ ok: true, handle: "dimethylpant" });
		}
		expect(parseXHandle("  ")).toEqual({ ok: true, handle: "" });
	});

	it("refuses what is not an X handle or profile link, and says which", () => {
		const message = (input: string) => {
			const parsed = parseXHandle(input);
			return parsed.ok ? undefined : parsed.message;
		};
		for (const input of ["not a handle", "@", "sixteen_letters_", "jane-doe", "@@jane"]) {
			expect(message(input), input).toBe("An X handle is 1 to 15 letters, digits or underscores.");
		}
		for (const input of [
			"https://github.com/jane",
			"jane.dev",
			"ftp://x.com/jane",
			"javascript:alert(1)",
			"https://x.com.evil.dev/jane",
		]) {
			expect(message(input), input).toBe("Enter an X handle or a link to an X profile.");
		}
		for (const input of [
			"https://x.com",
			"https://x.com/",
			"https://x.com/jane/status/123",
			"https://x.com/home",
			"https://twitter.com/i/lists/1",
			"https://x.com/Explore",
			"https://x.com/search?q=sketchi",
			"x.com/sixteen_letters_",
		]) {
			expect(message(input), input).toBe(
				"That X link is not a profile; use one like x.com/yourname.",
			);
		}
	});

	it("only trusts an install link of the collection's form", () => {
		expect(installLinkFromPullRequest(`[Installation link](${INSTALL})`)).toBe(INSTALL);
		expect(
			installLinkFromPullRequest(
				"[Installation link](https://excalidraw.com/#url=https://x.dev/a)",
			),
		).toBeUndefined();
	});
});
