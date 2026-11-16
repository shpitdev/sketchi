// Preview commands at their real boundaries: the effect/cli command line, GITHUB_OUTPUT, and
// fixture Cloudflare and GitHub APIs standing in for the network.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { unstable_readConfig } from "wrangler";
import { describe, expect } from "vitest";

import { workerProjectConfig, workerProjectIds } from "../src/workers";
import { command, failure, type Recorded } from "./command";
import { repoRoot, scratch } from "./harness";

const ACCOUNT = "acct";
const CREDENTIALS = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: "cf-token" };
const SUBDOMAIN = "dimethyl";

/**
 * A Cloudflare account where several owners have Previews: two Workers, each with this PR's
 * Preview and another PR's. A deleted Preview's hostname keeps serving for `lingers` checks.
 */
function cloudflare(
	options: {
		lingers?: number;
		suffixFor?: (worker: string) => string;
		deleteStatus?: number;
		hang?: boolean;
	} = {},
) {
	const previews = new Map<string, Set<string>>([
		["sketchi-icons", new Set(["pr-42", "pr-43"])],
		["sketchi-web", new Set(["pr-42", "pr-43"])],
	]);
	let lingers = options.lingers ?? 0;
	const api = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/workers/`;
	const fixture = command((request: Recorded) => {
		const url = new URL(request.url);
		if (request.url.startsWith(api)) {
			const [worker, collection, name] = request.url.slice(api.length).split("/");
			const owned = previews.get(worker ?? "");
			if (!owned) return Response.json({ success: false }, { status: 404 });
			if (request.method === "GET" && !collection) {
				const suffix = options.suffixFor?.(worker ?? "") ?? `-${worker}.${SUBDOMAIN}.workers.dev`;
				return Response.json({ result: { subdomain: { preview_url_suffix: suffix } } });
			}
			if (request.method === "DELETE" && collection === "previews") {
				if (options.deleteStatus) return new Response("boom", { status: options.deleteStatus });
				return owned.delete(name ?? "")
					? Response.json({ success: true })
					: Response.json({ success: false }, { status: 404 });
			}
		}
		const host = url.hostname.match(/^(pr-\d+)-(sketchi-[a-z]+)\.dimethyl\.workers\.dev$/);
		if (request.method === "GET" && host) {
			if (options.hang) return new Promise<Response>(() => {});
			if (previews.get(host[2] ?? "")?.has(host[1] ?? "") || lingers-- > 0)
				return new Response("app");
			return new Response("gone", { status: 404, headers: { "x-preview-user-error": "true" } });
		}
		return new Response("unexpected request", { status: 599 });
	});
	return { ...fixture, previews };
}

const deleteArgs = (project: string, pr: string) => [
	"preview",
	"delete",
	"--project",
	project,
	"--pr-number",
	pr,
];

describe("preview delete", () => {
	it.effect("deletes only this PR's Preview of this project's Worker", () =>
		Effect.gen(function* () {
			const account = cloudflare();
			const exit = yield* account.run(deleteArgs("icons", "42"), CREDENTIALS);
			expect(failure(exit)).toBeUndefined();
			const deletes = account.requests.filter(({ method }) => method === "DELETE");
			expect(deletes.map(({ url }) => url)).toEqual([
				`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/workers/sketchi-icons/previews/pr-42`,
			]);
			expect([...account.previews.get("sketchi-icons")!]).toEqual(["pr-43"]);
			expect([...account.previews.get("sketchi-web")!]).toEqual(["pr-42", "pr-43"]);
			// The API token goes to the Cloudflare API only, never to the Preview hostname.
			for (const request of account.requests) {
				expect(request.authorization !== null).toBe(
					request.url.startsWith("https://api.cloudflare.com/"),
				);
			}
			expect(account.outputs()).toEqual({
				comment_status: "deleted",
				preview_name: "pr-42",
				preview_url: `https://pr-42-sketchi-icons.${SUBDOMAIN}.workers.dev`,
			});
		}),
	);

	it.effect(
		"refuses a PR number or project that could name another resource, before any request",
		() =>
			Effect.gen(function* () {
				for (const [project, pr] of [
					["icons", "42/../../sketchi-web/previews/pr-42"],
					["icons", "42%2F..%2Fpr-43"],
					["icons", "4e2"],
					["icons", "+42"],
					["icons", "0"],
					["icons", " 42"],
					["sketchi-web", "42"],
					["../web", "42"],
				] as const) {
					const account = cloudflare();
					const exit = yield* account.run(deleteArgs(project, pr), CREDENTIALS);
					expect(Exit.isFailure(exit), `${project} ${pr}`).toBe(true);
					expect(account.requests).toEqual([]);
				}
			}),
	);

	it.effect(
		"refuses a Preview URL that does not belong to the project's Worker on workers.dev",
		() =>
			Effect.gen(function* () {
				for (const suffix of ["-sketchi-web.dimethyl.workers.dev", "-sketchi-icons.evil.example"]) {
					const account = cloudflare({ suffixFor: () => suffix });
					const exit = yield* account.run(deleteArgs("icons", "42"), CREDENTIALS);
					expect(failure(exit)).toMatch(/Cannot resolve the Preview URL of sketchi-icons/);
					expect(account.requests.filter(({ method }) => method === "DELETE")).toEqual([]);
					expect(account.previews.get("sketchi-icons")!.size).toBe(2);
				}
			}),
	);

	it.effect("reports deletion-pending and fails when a deleted Preview keeps serving", () =>
		Effect.gen(function* () {
			const account = cloudflare({ lingers: 100 });
			const run = yield* Effect.forkChild(account.run(deleteArgs("icons", "42"), CREDENTIALS));
			yield* TestClock.adjust("5 minutes");
			const exit = yield* Fiber.join(run);
			expect(failure(exit)).toMatch(/still serves after 12 checks/);
			expect(account.requests.filter(({ url }) => url.includes(".workers.dev/"))).toHaveLength(12);
			expect(account.outputs()["comment_status"]).toBe("deletion-pending");
		}),
	);

	it.effect("bounds a hung URL check instead of holding the job", () =>
		Effect.gen(function* () {
			const account = cloudflare({ hang: true });
			const run = yield* Effect.forkChild(account.run(deleteArgs("icons", "42"), CREDENTIALS));
			yield* TestClock.adjust("10 minutes");
			const exit = yield* Fiber.join(run);
			expect(failure(exit)).toMatch(/still serves after 12 checks/);
			expect(account.outputs()["comment_status"]).toBe("deletion-pending");
		}),
	);

	it.effect("waits for a lingering hostname to retire before reporting deletion", () =>
		Effect.gen(function* () {
			const account = cloudflare({ lingers: 2 });
			const run = yield* Effect.forkChild(account.run(deleteArgs("icons", "42"), CREDENTIALS));
			yield* TestClock.adjust("1 minute");
			expect(failure(yield* Fiber.join(run))).toBeUndefined();
			expect(account.requests.filter(({ url }) => url.includes(".workers.dev/"))).toHaveLength(3);
			expect(account.outputs()["comment_status"]).toBe("deleted");
		}),
	);

	it.effect("treats an already-deleted Preview as deleted once its URL is retired", () =>
		Effect.gen(function* () {
			const account = cloudflare();
			account.previews.get("sketchi-icons")!.delete("pr-42");
			expect(failure(yield* account.run(deleteArgs("icons", "42"), CREDENTIALS))).toBeUndefined();
			expect(account.outputs()["comment_status"]).toBe("deleted");
		}),
	);

	it.effect("surfaces a failed delete without checking or reporting the URL", () =>
		Effect.gen(function* () {
			const account = cloudflare({ deleteStatus: 500 });
			const exit = yield* account.run(deleteArgs("icons", "42"), CREDENTIALS);
			expect(failure(exit)).toMatch(/delete failed with HTTP 500/);
			expect(account.requests.some(({ url }) => url.includes(".workers.dev/"))).toBe(false);
			expect(account.outputs()).toEqual({});
		}),
	);

	it.effect("deletes nothing without Cloudflare credentials", () =>
		Effect.gen(function* () {
			const account = cloudflare();
			expect(failure(yield* account.run(deleteArgs("icons", "42")))).toBeUndefined();
			expect(account.requests).toEqual([]);
		}),
	);
});

const marker = "<!-- sketchi-web-preview -->";
const commentsUrl = "https://api.github.com/repos/shpitdev/sketchi/issues/42/comments?per_page=100";
const pageTwoUrl = `${commentsUrl}&page=2`;
const botComment = {
	id: 200,
	body: `${marker}\nPreview`,
	user: { login: "github-actions[bot]", type: "Bot" },
};
const GITHUB = {
	GITHUB_TOKEN: "gh-token",
	GITHUB_REPOSITORY: "shpitdev/sketchi",
	PREVIEW_PROJECT_ID: "web",
	PR_NUMBER: "42",
};

function github(pages: Array<{ data?: unknown; link?: string }>) {
	return command((request) => {
		if (request.method !== "GET") return Response.json({});
		const page = pages.shift();
		if (!page) return new Response("unexpected request", { status: 599 });
		return Response.json(page.data ?? [], { headers: page.link ? { link: page.link } : {} });
	});
}

describe("preview comment", () => {
	it.effect("edits only the configured bot's comment that starts with this project's marker", () =>
		Effect.gen(function* () {
			for (const [bot, expected] of [
				[undefined, 200],
				["preview-app[bot]", 300],
			] as const) {
				const api = github([
					{
						data: [
							{
								id: 100,
								body: `Quoted preview:\n${marker}`,
								user: { login: "reviewer", type: "User" },
							},
							{
								id: 101,
								body: `${marker}\nCopied preview`,
								user: { login: "reviewer", type: "User" },
							},
							{ ...botComment, id: 102, body: `Quote:\n${marker}` },
							{ ...botComment, id: 103, body: `${marker} not a marker line` },
							{ ...botComment, id: 104, body: "<!-- sketchi-icons-preview -->\nIcons" },
							{ ...botComment, id: 105, user: { login: "other-app[bot]", type: "Bot" } },
							botComment,
							{ ...botComment, id: 300, user: { login: "preview-app[bot]", type: "Bot" } },
						],
					},
				]);
				const exit = yield* api.run(["preview", "comment"], {
					...GITHUB,
					...(bot ? { PREVIEW_COMMENT_BOT_LOGIN: bot } : {}),
				});
				expect(failure(exit)).toBeUndefined();
				const [, edit] = api.requests;
				expect([edit?.method, edit?.url]).toEqual([
					"PATCH",
					`https://api.github.com/repos/shpitdev/sketchi/issues/comments/${expected}`,
				]);
				expect(
					(JSON.parse(edit?.body ?? "{}") as { body: string }).body.startsWith(`${marker}\n`),
				).toBe(true);
				expect(api.requests).toHaveLength(2);
			}
		}),
	);

	it.effect("follows Link next and creates one comment only after every page lacks one", () =>
		Effect.gen(function* () {
			const found = github([
				{
					data: Array.from({ length: 100 }, (_, id) => ({ id, body: "Discussion" })),
					link: `<${pageTwoUrl}>; rel="next"`,
				},
				{ data: [botComment] },
			]);
			expect(failure(yield* found.run(["preview", "comment"], GITHUB))).toBeUndefined();
			expect(found.requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
				`GET ${commentsUrl}`,
				`GET ${pageTwoUrl}`,
				"PATCH https://api.github.com/repos/shpitdev/sketchi/issues/comments/200",
			]);
			const missing = github([{ data: [], link: `<${pageTwoUrl}>; rel="next"` }, { data: [] }]);
			expect(failure(yield* missing.run(["preview", "comment"], GITHUB))).toBeUndefined();
			expect(missing.requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
				`GET ${commentsUrl}`,
				`GET ${pageTwoUrl}`,
				`POST ${commentsUrl.split("?")[0]}`,
			]);
		}),
	);

	it.effect("never sends the token outside the GitHub API origin", () =>
		Effect.gen(function* () {
			const api = github([{ data: [], link: '<https://other.example/comments>; rel="next"' }]);
			const exit = yield* api.run(["preview", "comment"], GITHUB);
			expect(failure(exit)).toMatch(/must remain on api.github.com/);
			expect(api.requests.map(({ url }) => new URL(url).origin)).toEqual([
				"https://api.github.com",
			]);
		}),
	);
});

// oxlint-disable-next-line typescript/no-explicit-any -- mutated Wrangler config fixtures
type Fixture = Record<string, any>;

const readConfig = (projectId: string) =>
	Effect.sync(() =>
		unstable_readConfig({
			config: join(repoRoot, workerProjectConfig(projectId).wranglerInputConfigPath),
		}),
	).pipe(Effect.map((config) => structuredClone(config) as unknown as Fixture));

function settings(projectId: string, config: unknown) {
	const file = join(scratch("ops-preview-settings-"), "wrangler.json");
	writeFileSync(file, JSON.stringify(config));
	const run = command();
	return run
		.run(["preview", "settings", "--project", projectId, "--pr-number", "42", "--config", file])
		.pipe(Effect.map((exit) => ({ exit, outputs: run.outputs() })));
}

describe("preview settings", () => {
	it.effect(
		"every checked-in Preview keeps its runtime bindings and binds no production data",
		() =>
			Effect.gen(function* () {
				for (const projectId of workerProjectIds) {
					const { exit, outputs } = yield* settings(projectId, yield* readConfig(projectId));
					expect(failure(exit), projectId).toBeUndefined();
					expect(outputs["preview_name"]).toBe("pr-42");
				}
			}),
	);

	it.effect("rejects production targets, missing bindings and unreviewed resources", () =>
		Effect.gen(function* () {
			const playground = yield* readConfig("playground");
			const icons = yield* readConfig("icons");
			const mutations: Array<[string, Fixture, (config: Fixture) => void]> = [
				["no previews", playground, (c) => delete c["previews"]],
				["another Worker", playground, (c) => (c["name"] = "sketchi-playground")],
				["production buckets", playground, (c) => (c["previews"].r2_buckets = c["r2_buckets"])],
				["production pipelines", playground, (c) => (c["previews"].pipelines = c["pipelines"])],
				["missing pipeline", playground, (c) => c["previews"].pipelines.pop()],
				[
					"duplicate pipeline",
					playground,
					(c) => (c["previews"].pipelines[1] = c["previews"].pipelines[0]),
				],
				[
					"undeclared bucket",
					playground,
					(c) => (c["previews"].r2_buckets[0].bucket_name = "unreviewed-bucket"),
				],
				[
					"declared production bucket",
					playground,
					(c) => (c["previews"].r2_buckets[0].preview_bucket_name = c["r2_buckets"][0].bucket_name),
				],
				[
					"production stream",
					playground,
					(c) => (c["previews"].pipelines[0].stream = c["pipelines"][0].stream),
				],
				[
					"legacy pipeline key",
					playground,
					(c) =>
						(c["previews"].pipelines[0] = {
							binding: c["previews"].pipelines[0].binding,
							pipeline: c["previews"].pipelines[0].stream,
						}),
				],
				["no ai", playground, (c) => delete c["previews"].ai],
				["no durable objects", playground, (c) => delete c["previews"].durable_objects],
				[
					"services",
					playground,
					(c) => (c["previews"].services = [{ binding: "AUTH", service: "production-auth" }]),
				],
				[
					"production database",
					playground,
					(c) => (c["previews"].d1_databases[0].database_id = c["d1_databases"][0].database_id),
				],
				[
					"undeclared database",
					playground,
					(c) => (c["previews"].d1_databases[0].database_id = "unreviewed-database"),
				],
				["no databases", playground, (c) => delete c["previews"].d1_databases],
				["icons publish limiter", icons, (c) => delete c["previews"].durable_objects],
				[
					"icons production database",
					icons,
					(c) => (c["previews"].d1_databases = c["d1_databases"]),
				],
			];
			for (const [label, original, mutate] of mutations) {
				const config = structuredClone(original);
				mutate(config);
				const projectId = original === icons ? "icons" : "playground";
				const { exit, outputs } = yield* settings(projectId, config);
				expect(Exit.isFailure(exit), label).toBe(true);
				expect(outputs, label).toEqual({});
			}
		}),
	);
});

describe("deploy URLs", () => {
	it.effect("the Preview URL comes only from Wrangler's matching preview entry", () =>
		Effect.gen(function* () {
			const dir = scratch("ops-preview-url-");
			const entry = {
				type: "preview",
				worker_name: "sketchi-web",
				preview_name: "pr-42",
				preview_slug: "pr-42",
				preview_id: "p",
				deployment_id: "d",
				preview_urls: [
					"https://0123abcd-sketchi-web.dimethyl.workers.dev/",
					"https://pr-42-sketchi-web.dimethyl.workers.dev/",
				],
			};
			const url = (preview: Record<string, unknown>, worker = "sketchi-web") =>
				Effect.gen(function* () {
					const file = join(dir, "out.ndjson");
					writeFileSync(file, `${JSON.stringify(preview)}\n`);
					const run = command();
					const exit = yield* run.run([
						"preview",
						"url",
						file,
						"--worker-name",
						worker,
						"--preview-name",
						"pr-42",
					]);
					return { exit, outputs: run.outputs() };
				});
			expect((yield* url(entry)).outputs).toEqual({
				preview_url: "https://pr-42-sketchi-web.dimethyl.workers.dev/",
			});
			for (const [preview, worker] of [
				[{ ...entry, preview_name: "pr-43", preview_slug: "pr-43" }, "sketchi-web"],
				[entry, "sketchi-icons"],
				[{ ...entry, preview_urls: ["https://sketchi-web.dimethyl.workers.dev/"] }, "sketchi-web"],
				[{ ...entry, preview_urls: [] }, "sketchi-web"],
			] as const) {
				const result = yield* url(preview, worker);
				expect(Exit.isFailure(result.exit)).toBe(true);
				expect(result.outputs).toEqual({});
			}
		}),
	);

	it.effect("a production log without the requested Worker's URL writes no output", () =>
		Effect.gen(function* () {
			const file = join(scratch("ops-production-url-"), "deploy.log");
			writeFileSync(file, "https://other-worker.account.workers.dev\n");
			const run = command();
			const exit = yield* run.run(["production", "url", file, "--worker-name", "sketchi-web"]);
			expect(failure(exit)).toMatch(/Failed to parse the workers.dev URL/);
			expect(run.outputs()).toEqual({});
			expect(readFileSync(file, "utf8")).toContain("other-worker");
		}),
	);
});
