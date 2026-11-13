import {
	type ClientLimitNamespace,
	clientAddress,
	type CommunityIconDatabase,
} from "@sketchi/community-icons";

import {
	checkPublishRequest,
	type PackExcalidrawState,
	PUBLISH_MAX_BODY_BYTES,
	type PublishResult,
	type PullRequestState,
} from "./excalidraw-publish.js";
import {
	findPack,
	isExcalidrawInstallUrl,
	packLibraryPath,
	packPreviewImagePath,
	packVersion,
	type PackSummary,
} from "./packs.js";

/** Excalidraw's library backend; the dialog posts to `/submit` under it. */
export const EXCALIDRAW_LIBRARY_BACKEND =
	"https://us-central1-excalidraw-room-persistence.cloudfunctions.net/libraries";
const GITHUB_API = "https://api.github.com";
const PULL_REQUEST_URL =
	/^https:\/\/github\.com\/excalidraw\/excalidraw-libraries\/pull\/(?<number>[1-9]\d{0,9})$/u;

/** Submissions one client address may send an hour. */
export const PUBLISHES_PER_CLIENT_HOUR = 3;
const SUBMIT_TIMEOUT_MS = 30_000;
const LOOKUP_TIMEOUT_MS = 8_000;
const STATE_TIMEOUT_MS = 5_000;
/** How long a pull request's state stands before a page load reads GitHub again; a merge is final. */
export const PULL_REQUEST_RECHECK_MS: Readonly<Record<PullRequestState | "unread", number>> = {
	unread: 10 * 60_000,
	open: 10 * 60_000,
	closed: 6 * 3_600_000,
	merged: Number.POSITIVE_INFINITY,
};
/** Pull requests one page load may refresh. */
const PULL_REQUESTS_PER_REFRESH = 10;

export interface ExcalidrawPublishEnv {
	readonly ASSETS: { fetch(request: Request | URL | string): Promise<Response> };
	/** Shared with community icons; this feature keeps its own table. */
	readonly COMMUNITY_ICONS?: CommunityIconDatabase;
	readonly COMMUNITY_CLIENT_LIMIT?: ClientLimitNamespace;
	/** `on` lets visitors submit packs. Unset in production and previews. */
	readonly EXCALIDRAW_LIBRARY_SUBMIT?: string;
	/** Where submissions go instead of Excalidraw's backend: a local stand-in. */
	readonly EXCALIDRAW_LIBRARY_BACKEND?: string;
	/** Where pull requests are read instead of GitHub's API: a local stand-in. */
	readonly EXCALIDRAW_LIBRARY_GITHUB_API?: string;
}

export function publishingEnabled(env: ExcalidrawPublishEnv): boolean {
	return env.EXCALIDRAW_LIBRARY_SUBMIT === "on" && env.COMMUNITY_ICONS !== undefined;
}

/**
 * One row per pack version, so a version opens at most one pull request:
 *
 * - `pending`: claimed before the send. A row left pending means the Worker
 *   stopped mid-send, and the pull request may exist.
 * - `unconfirmed`: the send timed out, lost its connection, or got an answer
 *   other than a pull request or a refusal, so the pull request may exist.
 *   `pull_request` holds what came back.
 * - `submitted`: the collection answered with its pull request.
 *
 * Only a refusal (a 4xx answer without a pull request) deletes the claim.
 * Every other row keeps its version from being sent again until someone
 * reconciles it by hand (see the README). Created on first use.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS excalidraw_library_submissions (
	pack_id TEXT NOT NULL,
	version TEXT NOT NULL,
	status TEXT NOT NULL,
	author_name TEXT NOT NULL,
	pull_request_url TEXT,
	install_url TEXT,
	pull_request TEXT,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (pack_id, version)
)`;

/**
 * Each submitted pull request's state as GitHub last gave it, with the ETag
 * that makes an unchanged answer free of GitHub's rate limit. A missing
 * `state` means GitHub has not been read yet.
 */
const PULL_REQUEST_SCHEMA = `CREATE TABLE IF NOT EXISTS excalidraw_library_pull_requests (
	url TEXT PRIMARY KEY,
	state TEXT,
	etag TEXT,
	checked_at INTEGER NOT NULL
)`;

export interface SubmissionRow {
	readonly pack_id: string;
	readonly version: string;
	readonly status: "pending" | "unconfirmed" | "submitted";
	readonly pull_request_url: string | null;
	readonly install_url: string | null;
	readonly created_at: number;
	readonly pull_request_state: PullRequestState | null;
	readonly pull_request_checked_at: number | null;
}

export class ExcalidrawSubmissionStore {
	private ready: Promise<unknown> | undefined;

	constructor(private readonly db: CommunityIconDatabase) {}

	private schema() {
		this.ready ??= Promise.all([
			this.db.prepare(SCHEMA).run(),
			this.db.prepare(PULL_REQUEST_SCHEMA).run(),
		]);
		return this.ready;
	}

	/** Take the version for one send; false when any row already holds it. */
	async claim(packId: string, version: string, authorName: string, now: number) {
		await this.schema();
		const { meta } = await this.db
			.prepare(
				`INSERT INTO excalidraw_library_submissions (pack_id, version, status, author_name, created_at)
				VALUES (?, ?, 'pending', ?, ?)
				ON CONFLICT (pack_id, version) DO NOTHING`,
			)
			.bind(packId, version, authorName, now)
			.run();
		return meta.changes === 1;
	}

	/** Hold a version whose send may have opened a pull request, with what came back. */
	async hold(packId: string, version: string, detail: string) {
		await this.db
			.prepare(
				`UPDATE excalidraw_library_submissions SET status = 'unconfirmed', pull_request = ?
				WHERE pack_id = ? AND version = ? AND status = 'pending'`,
			)
			.bind(detail, packId, version)
			.run();
	}

	/** Free a claim the collection refused, so the next visitor can try. */
	async release(packId: string, version: string) {
		await this.db
			.prepare(
				"DELETE FROM excalidraw_library_submissions WHERE pack_id = ? AND version = ? AND status = 'pending'",
			)
			.bind(packId, version)
			.run();
	}

	/** Record the pull request, with its install link when one was read. */
	async complete(
		packId: string,
		version: string,
		submitted: { pullRequestUrl: string; installUrl?: string; pullRequest: string },
	) {
		await this.db
			.prepare(
				`UPDATE excalidraw_library_submissions
				SET status = 'submitted', pull_request_url = ?, install_url = ?, pull_request = ?
				WHERE pack_id = ? AND version = ?`,
			)
			.bind(
				submitted.pullRequestUrl,
				submitted.installUrl ?? null,
				submitted.pullRequest,
				packId,
				version,
			)
			.run();
	}

	async rows(): Promise<readonly SubmissionRow[]> {
		await this.schema();
		const { results } = await this.db
			.prepare(
				`SELECT s.pack_id, s.version, s.status, s.pull_request_url, s.install_url, s.created_at,
					p.state AS pull_request_state, p.checked_at AS pull_request_checked_at
				FROM excalidraw_library_submissions s
				LEFT JOIN excalidraw_library_pull_requests p ON p.url = s.pull_request_url
				ORDER BY s.created_at DESC`,
			)
			.all<SubmissionRow>();
		return results;
	}

	/**
	 * Take a pull request's next read: true, with the ETag of its last answer,
	 * for one caller once its state is due, so concurrent page loads read
	 * GitHub once between them.
	 */
	async claimCheck(url: string, now: number) {
		await this.schema();
		const current = await this.db
			.prepare("SELECT state, etag, checked_at FROM excalidraw_library_pull_requests WHERE url = ?")
			.bind(url)
			.first<{ state: PullRequestState | null; etag: string | null; checked_at: number }>();
		const wait = PULL_REQUEST_RECHECK_MS[current?.state ?? "unread"];
		if (current && now - current.checked_at < wait) return undefined;
		const { meta } = await this.db
			.prepare(
				`INSERT INTO excalidraw_library_pull_requests (url, checked_at) VALUES (?, ?)
				ON CONFLICT (url) DO UPDATE SET checked_at = excluded.checked_at
				WHERE checked_at = ?`,
			)
			// A new row conflicts only with another reader's claim, which no checked_at matches.
			.bind(url, now, current?.checked_at ?? -1)
			.run();
		return meta.changes === 1 ? { etag: current?.etag ?? undefined } : undefined;
	}

	async recordState(url: string, state: PullRequestState, etag: string | undefined) {
		await this.db
			.prepare("UPDATE excalidraw_library_pull_requests SET state = ?, etag = ? WHERE url = ?")
			.bind(state, etag ?? null, url)
			.run();
	}
}

/**
 * A merged library's install link: the collection deletes a pull request's
 * branch when it merges, so the link reads the library from `main` instead.
 */
export function mergedInstallUrl(installUrl: string): string | undefined {
	const url = URL.parse(installUrl);
	const library = mergedLibraryUrl(installUrl);
	if (!url || !library) return undefined;
	url.searchParams.set("addLibrary", library);
	return isExcalidrawInstallUrl(url.href) ? url.href : undefined;
}

/** Where the library an install link adds sits on `main` once it merges. */
function mergedLibraryUrl(installUrl: string): string | undefined {
	const library = URL.parse(URL.parse(installUrl)?.searchParams.get("addLibrary") ?? "");
	if (!library) return undefined;
	const path = library.pathname.split("/");
	// ["", "excalidraw", "excalidraw-libraries", branch, "libraries", author, file]
	if (path.length < 5 || path[4] !== "libraries") return undefined;
	path[3] = "main";
	library.pathname = path.join("/");
	return library.href;
}

/** What a submission's install link adds now: a closed pull request's branch may be gone. */
function reachableInstallUrl(row: SubmissionRow): string | undefined {
	if (!row.install_url || row.pull_request_state === "closed") return undefined;
	return row.pull_request_state === "merged" ? mergedInstallUrl(row.install_url) : row.install_url;
}

/**
 * Each pack's state for the pages: the newest install link still in reach,
 * the newest submission's pull request, and whether its current version is
 * still open to submit.
 */
export function packExcalidrawStates(
	packs: readonly Pick<PackSummary, "id" | "version">[],
	rows: readonly SubmissionRow[],
	options: { readonly enabled: boolean },
): Record<string, PackExcalidrawState> {
	return Object.fromEntries(
		packs.map((pack) => {
			const mine = rows.filter((row) => row.pack_id === pack.id);
			const installUrl = mine.map(reachableInstallUrl).find(Boolean);
			const latest = mine.find((row) => row.pull_request_url);
			const pullRequest = latest?.pull_request_url
				? {
						url: latest.pull_request_url,
						...(latest.pull_request_state ? { state: latest.pull_request_state } : {}),
					}
				: undefined;
			const taken = mine.some((row) => row.version === pack.version);
			const publishable =
				options.enabled && findPack(pack.id)?.excalidrawListing !== undefined && !taken;
			const state: PackExcalidrawState = {
				...(installUrl ? { installUrl } : {}),
				...(pullRequest ? { pullRequest } : {}),
				publishable,
			};
			return [pack.id, state];
		}),
	);
}

/**
 * The states the pages render; without the table every pack only downloads.
 * Pull requests whose state is due are read from GitHub after the response,
 * through `waitUntil`, so a page never waits on GitHub and shows the state
 * the last read stored.
 */
export async function loadPackExcalidrawStates(
	env: ExcalidrawPublishEnv,
	packs: readonly Pick<PackSummary, "id" | "version">[],
	options: { readonly waitUntil?: (promise: Promise<unknown>) => void; readonly now?: number } = {},
): Promise<Record<string, PackExcalidrawState>> {
	if (!env.COMMUNITY_ICONS) return {};
	const store = new ExcalidrawSubmissionStore(env.COMMUNITY_ICONS);
	const rows = await store.rows().catch(() => []);
	const now = options.now ?? Date.now();
	const due = new Map<string, string | undefined>();
	for (const row of rows) {
		if (
			row.pull_request_url &&
			(row.pull_request_checked_at === null ||
				now - row.pull_request_checked_at >=
					PULL_REQUEST_RECHECK_MS[row.pull_request_state ?? "unread"])
		) {
			due.set(row.pull_request_url, due.get(row.pull_request_url) ?? row.install_url ?? undefined);
		}
	}
	if (due.size && options.waitUntil) {
		const pulls = [...due].map(([url, installUrl]) => ({ url, installUrl }));
		options.waitUntil(
			refreshPullRequests(env, store, pulls.slice(0, PULL_REQUESTS_PER_REFRESH), now),
		);
	}
	return packExcalidrawStates(packs, rows, { enabled: publishingEnabled(env) });
}

/**
 * Read each due pull request's state from GitHub. GitHub's unauthenticated
 * API limits each address, and a Worker shares its address, so when the API
 * refuses, a library file on the collection's `main` still shows the merge.
 * A failed read keeps the last state.
 */
export async function refreshPullRequests(
	env: ExcalidrawPublishEnv,
	store: ExcalidrawSubmissionStore,
	pulls: readonly { readonly url: string; readonly installUrl?: string | undefined }[],
	now: number,
) {
	await Promise.all(
		pulls.map(async ({ url, installUrl }) => {
			const number = PULL_REQUEST_URL.exec(url)?.groups?.["number"];
			if (!number) return;
			try {
				const claim = await store.claimCheck(url, now);
				if (!claim) return;
				let read: { state: PullRequestState; etag?: string | undefined } | undefined;
				try {
					read = await readPullRequestState(env, number, claim.etag);
				} catch (error) {
					const library = installUrl ? mergedLibraryUrl(installUrl) : undefined;
					if (!library || !(await onMain(library))) throw error;
					read = { state: "merged" };
				}
				if (read) await store.recordState(url, read.state, read.etag);
			} catch (error) {
				console.warn("Excalidraw pull request state not read", { url, error: String(error) });
			}
		}),
	);
}

/** Whether a library file is on the collection's `main`, read past GitHub's API. */
async function onMain(library: string) {
	const response = await fetch(library, {
		method: "HEAD",
		headers: { "User-Agent": "sketchi-icons" },
		signal: AbortSignal.timeout(STATE_TIMEOUT_MS),
	}).catch(() => undefined);
	return response?.ok === true;
}

/**
 * The pull request's state from GitHub's public API, or nothing when GitHub
 * answers 304 to the ETag: the stored state still stands.
 */
async function readPullRequestState(env: ExcalidrawPublishEnv, number: string, etag?: string) {
	const response = await fetch(
		`${env.EXCALIDRAW_LIBRARY_GITHUB_API ?? GITHUB_API}/repos/excalidraw/excalidraw-libraries/pulls/${number}`,
		{
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "sketchi-icons",
				...(etag ? { "If-None-Match": etag } : {}),
			},
			signal: AbortSignal.timeout(STATE_TIMEOUT_MS),
		},
	);
	if (response.status === 304) return undefined;
	if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}.`);
	const pull = (await response.json()) as { state?: unknown; merged_at?: unknown };
	const state: PullRequestState =
		typeof pull.merged_at === "string" ? "merged" : pull.state === "closed" ? "closed" : "open";
	return { state, etag: response.headers.get("ETag") ?? undefined };
}

function errorJson(status: number, code: string, message: string) {
	return Response.json({ error: { code, message } }, { status });
}

function unconfirmed() {
	return errorJson(
		502,
		"upstream_unconfirmed",
		"Excalidraw's library service did not confirm it. This version is held until it is checked.",
	);
}

function parseAnswer(text: string): { url?: unknown; message?: unknown } {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null ? value : {};
	} catch {
		return {};
	}
}

async function readJson(request: Request): Promise<unknown> {
	if (Number(request.headers.get("Content-Length") ?? "0") > PUBLISH_MAX_BODY_BYTES) {
		throw new RangeError("too large");
	}
	const reader = request.body?.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (reader) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > PUBLISH_MAX_BODY_BYTES) {
			await reader.cancel();
			throw new RangeError("too large");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}

async function asset(env: ExcalidrawPublishEnv, origin: string, path: string) {
	const response = await env.ASSETS.fetch(new URL(path, origin));
	if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
	return response;
}

/** The pull request's description and branch, read from GitHub's public API. */
async function readPullRequest(env: ExcalidrawPublishEnv, number: string) {
	const response = await fetch(
		`${env.EXCALIDRAW_LIBRARY_GITHUB_API ?? GITHUB_API}/repos/excalidraw/excalidraw-libraries/pulls/${number}`,
		{
			headers: { Accept: "application/vnd.github+json", "User-Agent": "sketchi-icons" },
			signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
		},
	);
	if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}.`);
	const pull = (await response.json()) as { body?: unknown; head?: { ref?: unknown } };
	return {
		body: typeof pull.body === "string" ? pull.body : "",
		branch: typeof pull.head?.ref === "string" ? pull.head.ref : undefined,
	};
}

/** The "Installation link" the collection's bot writes into the pull request. */
export function installLinkFromPullRequest(body: string): string | undefined {
	const link = /\[Installation link\]\((?<href>[^)\s]+)\)/u.exec(body)?.groups?.["href"];
	return link && isExcalidrawInstallUrl(link) ? link : undefined;
}

/**
 * `POST /api/packs/:id/excalidraw` with `{ authorName, xHandle?, website? }`:
 * send the pack's current version to Excalidraw's library collection, once.
 */
export async function handlePackPublish(
	request: Request,
	env: ExcalidrawPublishEnv,
	packId: string,
): Promise<Response> {
	const listing = findPack(packId)?.excalidrawListing;
	if (!publishingEnabled(env) || !env.COMMUNITY_ICONS) {
		return errorJson(404, "not_found", "Publishing to Excalidraw is off.");
	}
	if (!listing) return errorJson(404, "not_found", "This pack cannot be published.");
	if (env.COMMUNITY_CLIENT_LIMIT) {
		const decision = await env.COMMUNITY_CLIENT_LIMIT.getByName(
			`excalidraw-publish:${clientAddress(request)}`,
		)
			.take(PUBLISHES_PER_CLIENT_HOUR, 3_600_000)
			// The pack-version claim still stops duplicates when the limit cannot answer.
			.catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
		if (!decision.allowed) {
			const response = errorJson(429, "rate_limited", "Too many submissions; try again later.");
			response.headers.set("Retry-After", String(decision.retryAfterSeconds));
			return response;
		}
	}
	let body: unknown;
	try {
		body = await readJson(request);
	} catch (error) {
		return error instanceof RangeError
			? errorJson(
					413,
					"invalid_request",
					`The body must be at most ${PUBLISH_MAX_BODY_BYTES} bytes.`,
				)
			: errorJson(400, "invalid_request", "The body must be JSON.");
	}
	const checked = checkPublishRequest(body, `https://icons.sketchi.app/packs/${packId}`);
	if (!checked.ok) return errorJson(400, "invalid_request", checked.message);
	const { author } = checked;

	const origin = new URL(request.url).origin;
	const library = await (await asset(env, origin, packLibraryPath(packId))).text();
	const version = await packVersion(library);
	const preview = await (await asset(env, origin, packPreviewImagePath(packId))).blob();

	const store = new ExcalidrawSubmissionStore(env.COMMUNITY_ICONS);
	if (!(await store.claim(packId, version, author.authorName, Date.now()))) {
		return errorJson(
			409,
			"already_submitted",
			"This version of the pack has already been sent to Excalidraw.",
		);
	}

	// The dialog's form, part for part; the backend requires every field, empty or not.
	const form = new FormData();
	form.append(
		"excalidrawLib",
		new Blob([JSON.stringify(JSON.parse(library), null, 2)], { type: "application/json" }),
	);
	form.append("previewImage", new File([preview], "preview", { type: "image/jpeg" }));
	form.append("previewImageType", "image/jpeg");
	form.append("title", listing.name);
	form.append("authorName", author.authorName);
	form.append("githubHandle", "");
	form.append("name", listing.name);
	form.append("description", listing.description);
	// The collection still names the field for Twitter.
	form.append("twitterHandle", author.xHandle);
	form.append("website", author.website);

	let status: number;
	let text: string;
	try {
		const response = await fetch(
			`${env.EXCALIDRAW_LIBRARY_BACKEND ?? EXCALIDRAW_LIBRARY_BACKEND}/submit`,
			{ method: "POST", body: form, signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) },
		);
		status = response.status;
		text = await response.text();
	} catch (error) {
		// A timeout or lost connection says nothing about whether the pull request was opened.
		const detail = JSON.stringify({ error: String(error) });
		await store.hold(packId, version, detail);
		console.warn("Excalidraw library submission unconfirmed", { packId, version, detail });
		return unconfirmed();
	}
	const answer = parseAnswer(text);
	const pullRequestUrl =
		status >= 200 &&
		status < 300 &&
		typeof answer.url === "string" &&
		PULL_REQUEST_URL.test(answer.url)
			? answer.url
			: undefined;
	if (!pullRequestUrl) {
		const detail = JSON.stringify({ status, body: text.slice(0, 2000) });
		if (status >= 400 && status < 500) {
			// A refusal: the collection opened nothing, so the version is free again.
			await store.release(packId, version);
			console.warn("Excalidraw library submission refused", { packId, version, detail });
			return errorJson(
				502,
				"upstream_refused",
				typeof answer.message === "string"
					? `Excalidraw's library service refused it: ${answer.message}`
					: "Excalidraw's library service refused it.",
			);
		}
		await store.hold(packId, version, detail);
		console.warn("Excalidraw library submission unconfirmed", { packId, version, detail });
		return unconfirmed();
	}

	// The pull request exists now, so the version stays taken whatever the lookup finds.
	const number = PULL_REQUEST_URL.exec(pullRequestUrl)?.groups?.["number"] ?? "";
	let pullRequest: string;
	let installUrl: string | undefined;
	try {
		const pull = await readPullRequest(env, number);
		installUrl = installLinkFromPullRequest(pull.body);
		pullRequest = JSON.stringify({ branch: pull.branch, body: pull.body.slice(0, 4000) });
	} catch (error) {
		pullRequest = JSON.stringify({ error: String(error) });
	}
	const submitted = { pullRequestUrl, pullRequest, ...(installUrl ? { installUrl } : {}) };
	// The pull request exists either way; a lost write is logged with it so it can be recorded by hand.
	await store.complete(packId, version, submitted).catch((error: unknown) =>
		console.error("Excalidraw library submission not recorded", {
			packId,
			version,
			...submitted,
			error: String(error),
		}),
	);
	const result: PublishResult = { pullRequestUrl, ...(installUrl ? { installUrl } : {}) };
	return Response.json(result, { status: 201 });
}
