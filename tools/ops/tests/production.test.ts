// Production domain commands at their real boundaries: the command line, the files they write,
// and a fixture Cloudflare API.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { describe, expect, test } from "vitest";

import { workerProjectConfig, workerProjectIds } from "../src/workers";
import { command, failure } from "./command";
import { repoRoot, scratch } from "./harness";

const CREDENTIALS = { CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "cf-token" };
const DOMAINS = "https://api.cloudflare.com/client/v4/accounts/acct/workers/domains";

function account(domains: unknown[]) {
	return command((request) => {
		if (request.url === DOMAINS && request.method === "GET") {
			return Response.json({ success: true, result: domains });
		}
		if (request.url.startsWith(`${DOMAINS}/`) && request.method === "DELETE") {
			return Response.json({ success: true });
		}
		if (request.url.startsWith("https://api.cloudflare.com/client/v4/zones?")) {
			return Response.json({ success: true, result: [{ status: zoneStatus }] });
		}
		return new Response("unexpected request", { status: 599 });
	});
}
let zoneStatus = "active";

describe("production detach", () => {
	it.effect("detaches only the project's approved hostnames that point at its Worker", () =>
		Effect.gen(function* () {
			const api = account([
				{ hostname: "sketchi.app", id: "domain-1", service: "sketchi-web" },
				{ hostname: "www.sketchi.app", id: "domain-2", service: "sketchi-web" },
				{ hostname: "icons.sketchi.app", id: "domain-3", service: "sketchi-icons" },
				{ hostname: "docs.sketchi.app", id: "domain-4", service: "sketchi-web" },
			]);
			const exit = yield* api.run(
				["production", "detach", "--project", "web", "--apply"],
				CREDENTIALS,
			);
			expect(failure(exit)).toBeUndefined();
			expect(
				api.requests.filter(({ method }) => method === "DELETE").map(({ url }) => url),
			).toEqual([`${DOMAINS}/domain-1`, `${DOMAINS}/domain-2`]);
		}),
	);

	it.effect(
		"fails closed, detaching nothing, when an approved hostname points at another Worker",
		() =>
			Effect.gen(function* () {
				const api = account([
					{ hostname: "sketchi.app", id: "domain-1", service: "sketchi-web" },
					{ hostname: "www.sketchi.app", id: "domain-2", service: "unexpected-worker" },
				]);
				const exit = yield* api.run(
					["production", "detach", "--project", "web", "--apply"],
					CREDENTIALS,
				);
				expect(failure(exit)).toMatch(
					/Refusing to detach www.sketchi.app: project web expects Worker sketchi-web/,
				);
				expect(api.requests.filter(({ method }) => method === "DELETE")).toEqual([]);
			}),
	);

	it.effect("an internal project has no public domain and sends no request", () =>
		Effect.gen(function* () {
			const api = account([
				{ hostname: "excalidraw.sketchi.app", id: "d", service: "sketchi-excalidraw" },
			]);
			const exit = yield* api.run(
				["production", "detach", "--project", "excalidraw", "--apply"],
				CREDENTIALS,
			);
			expect(failure(exit)).toBeUndefined();
			expect(api.requests).toEqual([]);
		}),
	);

	it.effect("without --apply, it lists and detaches nothing", () =>
		Effect.gen(function* () {
			const api = account([
				{ hostname: "icons.sketchi.app", id: "domain-3", service: "sketchi-icons" },
			]);
			expect(
				failure(yield* api.run(["production", "detach", "--project", "icons"], CREDENTIALS)),
			).toBeUndefined();
			expect(api.requests.map(({ method }) => method)).toEqual(["GET"]);
		}),
	);
});

describe("production domains", () => {
	const source = {
		name: "sketchi-icons",
		route: "icons.sketchi.app/*",
		routes: ["icons.sketchi.app/*", "evil.example/*"],
		domains: [{ pattern: "icons.sketchi.app" }],
		custom_domain: true,
		vars: { SKETCHI_APP_SURFACE: "icons" },
		r2_buckets: [{ binding: "SKETCHI_ARTIFACTS", bucket_name: "artifacts" }],
	};

	function domains(project: string, config: unknown) {
		const dir = scratch("ops-domains-");
		const input = join(dir, "wrangler.json");
		const out = join(dir, "out", "wrangler.domains.json");
		writeFileSync(input, JSON.stringify(config));
		const api = account([]);
		return api
			.run(
				["production", "domains", "--project", project, "--config", input, "--out", out],
				CREDENTIALS,
			)
			.pipe(Effect.map((exit) => ({ exit, out, outputs: api.outputs() })));
	}

	it.effect("writes only the approved custom domains and keeps the runtime config", () =>
		Effect.gen(function* () {
			zoneStatus = "active";
			const { exit, out, outputs } = yield* domains("icons", source);
			expect(failure(exit)).toBeUndefined();
			const written = JSON.parse(readFileSync(out, "utf8"));
			expect(written).toEqual({
				name: "sketchi-icons",
				topLevelName: "sketchi-icons",
				workers_dev: true,
				routes: [{ pattern: "icons.sketchi.app", custom_domain: true }],
				vars: source.vars,
				r2_buckets: source.r2_buckets,
			});
			expect(outputs["domain_patterns"]).toBe("icons.sketchi.app");
		}),
	);

	it.effect("fails closed on another Worker's config or an inactive zone, writing nothing", () =>
		Effect.gen(function* () {
			zoneStatus = "active";
			const mismatch = yield* domains("playground", { ...source, name: "sketchi-playground" });
			expect(failure(mismatch.exit)).toMatch(/Wrangler name mismatch for project "playground"/);
			expect(existsSync(mismatch.out)).toBe(false);
			zoneStatus = "pending";
			const pending = yield* domains("icons", source);
			expect(failure(pending.exit)).toMatch(/one active Cloudflare zone/);
			expect(existsSync(pending.out)).toBe(false);
			zoneStatus = "active";
		}),
	);

	it.effect("an unknown production project is refused", () =>
		Effect.gen(function* () {
			const { exit } = yield* domains("studio", source);
			expect(Exit.isFailure(exit)).toBe(true);
		}),
	);
});

test("checked-in Wrangler configs never expose production custom domains", () => {
	for (const projectId of workerProjectIds) {
		const config = readFileSync(
			join(repoRoot, workerProjectConfig(projectId).wranglerInputConfigPath),
			"utf8",
		);
		expect(config).not.toMatch(/(?:excalidraw|icons|playground|studio|www)\.sketchi\.app/);
		expect(config).not.toMatch(/"(?:route|routes|custom_domain|domains)"\s*:/);
	}
});
