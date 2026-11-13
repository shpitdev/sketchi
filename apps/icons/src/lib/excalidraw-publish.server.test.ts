// @vitest-environment node

import { DatabaseSync } from "node:sqlite";

import type { CommunityIconDatabase, CommunityIconStatement } from "@sketchi/community-icons";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkPublishRequest, parseXHandle } from "./excalidraw-publish";
import {
	EXCALIDRAW_LIBRARY_BACKEND,
	type ExcalidrawPublishEnv,
	ExcalidrawSubmissionStore,
	handlePackPublish,
	installLinkFromPullRequest,
	packExcalidrawStates,
} from "./excalidraw-publish.server";
import { packVersion } from "./packs";

function sqliteDatabase(): CommunityIconDatabase {
	const sqlite = new DatabaseSync(":memory:");
	const statement = (query: string, values: unknown[] = []): CommunityIconStatement => {
		const params = values as (string | number | null)[];
		return {
			bind: (...next) => statement(query, next),
			first: async <T>() => (sqlite.prepare(query).get(...params) as T | undefined) ?? null,
			all: async <T>() => ({ results: sqlite.prepare(query).all(...params) as T[] }),
			run: async () => ({
				meta: { changes: Number(sqlite.prepare(query).run(...params).changes) },
			}),
		};
	};
	return { prepare: (query) => statement(query) };
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

function environment(overrides: Partial<ExcalidrawPublishEnv> = {}): ExcalidrawPublishEnv {
	return {
		ASSETS: {
			fetch: async (input) => {
				const { pathname } = new URL(input instanceof Request ? input.url : input);
				if (pathname === "/packs/palantir.excalidrawlib") return new Response(LIBRARY);
				if (pathname === "/packs/palantir.preview.jpg") return new Response(PREVIEW);
				return new Response("", { status: 404 });
			},
		},
		COMMUNITY_ICONS: sqliteDatabase(),
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
		pack,
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
	vi.stubGlobal("fetch", fetchMock);
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

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("publishing a pack to Excalidraw", () => {
	it("is off unless the Worker turns it on, and never reaches the backend then", async () => {
		const fetchMock = backend();
		const { EXCALIDRAW_LIBRARY_SUBMIT: _on, ...off } = environment();
		const response = await publish(off);
		expect(response.status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("only publishes a pack with a listing", async () => {
		const fetchMock = backend();
		expect((await publish(environment(), { authorName: "Jane" }, "all")).status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("sends the dialog's form once, records the pull request and its install link", async () => {
		const fetchMock = backend();
		const env = environment();
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
		const rows = await new ExcalidrawSubmissionStore(env.COMMUNITY_ICONS!).rows();
		expect(packExcalidrawStates([{ id: "palantir", version }], rows, { enabled: true })).toEqual({
			palantir: { installUrl: INSTALL, publishable: false },
		});
	});

	it("frees the version when the backend refuses, so the next visitor can try", async () => {
		const env = environment();
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
		const env = environment();
		const first = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url === `${EXCALIDRAW_LIBRARY_BACKEND}/submit`) return submit();
			throw new Error(`Unexpected fetch ${url}`);
		});
		vi.stubGlobal("fetch", first);
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
		const rows = await new ExcalidrawSubmissionStore(env.COMMUNITY_ICONS!).rows();
		expect(
			packExcalidrawStates([{ id: "palantir", version: await packVersion(LIBRARY) }], rows, {
				enabled: true,
			}).palantir,
		).toEqual({ publishable: false });
	});

	it("keeps the pull request when GitHub cannot be read, without offering the version again", async () => {
		const env = environment();
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
		const env = environment();
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

	it("never lets a claim lapse: a Worker that stopped mid-send may have opened a pull request", async () => {
		const env = environment();
		const store = new ExcalidrawSubmissionStore(env.COMMUNITY_ICONS!);
		const version = await packVersion(LIBRARY);
		const longAgo = Date.now() - 30 * 24 * 3_600_000;
		expect(await store.claim("palantir", version, "Someone", longAgo)).toBe(true);
		const fetchMock = backend();
		expect((await publish(env)).status).toBe(409);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await store.claim("palantir", version, "Jane", Date.now())).toBe(false);
		expect(
			packExcalidrawStates([{ id: "palantir", version }], await store.rows(), { enabled: true })
				.palantir,
		).toEqual({ publishable: false });
	});

	it("refuses a bad or oversized body and a client over its limit", async () => {
		backend();
		const env = environment();
		expect((await publish(env, { authorName: "" })).status).toBe(400);
		expect((await publish(env, "not json")).status).toBe(400);
		expect((await publish(env, { authorName: "x".repeat(4000) })).status).toBe(413);
		const take = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 1200 }));
		const limited = await publish(
			environment({ COMMUNITY_CLIENT_LIMIT: { getByName: () => ({ take }) } }),
		);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("1200");
		expect(take).toHaveBeenCalledWith(3, 3_600_000);
	});
});

describe("pack states", () => {
	it("keeps an earlier version's install link and opens the new version to publish", () => {
		const states = packExcalidrawStates(
			[
				{ id: "palantir", version: "new" },
				{ id: "all", version: "a" },
			],
			[
				{
					pack_id: "palantir",
					version: "old",
					status: "submitted",
					install_url: INSTALL,
					created_at: 1,
				},
			],
			{ enabled: true },
		);
		expect(states).toEqual({
			palantir: { installUrl: INSTALL, publishable: true },
			all: { publishable: false },
		});
		expect(
			packExcalidrawStates([{ id: "palantir", version: "new" }], [], { enabled: false }),
		).toEqual({ palantir: { publishable: false } });
	});
});

describe("author fields", () => {
	const site = "https://icons.sketchi.app/packs/data";

	it("takes a name, an optional handle and an https website", () => {
		expect(checkPublishRequest({ authorName: "Jane" }, site)).toEqual({
			ok: true,
			author: { authorName: "Jane", xHandle: "", website: site },
		});
		expect(
			checkPublishRequest({ authorName: "Jane", website: "https://jane.dev" }, site),
		).toMatchObject({ ok: true, author: { website: "https://jane.dev/" } });
	});

	it("refuses a long or multi-line name, a bad handle and a non-https website", () => {
		for (const body of [
			{ authorName: "x".repeat(61) },
			{ authorName: "Jane\nDoe" },
			{ authorName: "Jane", xHandle: "not a handle" },
			{ authorName: "Jane", xHandle: "https://x.com/jane/status/1" },
			{ authorName: "Jane", website: "http://jane.dev" },
			{ authorName: "Jane", website: "javascript:alert(1)" },
			[],
		]) {
			expect(checkPublishRequest(body, site).ok, JSON.stringify(body)).toBe(false);
		}
	});

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
