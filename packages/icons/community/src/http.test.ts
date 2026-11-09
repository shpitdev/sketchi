import { DatabaseSync } from "node:sqlite";

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
	handleCommunityDetail,
	handleCommunityList,
	handleCommunityPublish,
	handleCommunityVisibility,
	type CommunityEnv,
} from "./http.js";
import { CommunityIconModeration } from "./moderation.js";
import type { CommunityIconDatabase, CommunityIconStatement } from "./store.js";

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

const allow = Layer.succeed(
	CommunityIconModeration,
	CommunityIconModeration.of({ review: () => Effect.succeed({ allowed: true }) }),
);
const reject = Layer.succeed(
	CommunityIconModeration,
	CommunityIconModeration.of({ review: () => Effect.succeed({ allowed: false }) }),
);

const RING = {
	parts: [
		{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 },
		{ kind: "text", cx: 12, cy: 12, text: "Q", size: 8 },
	],
};

const ORIGIN = "https://icons.sketchi.app";

function publish(body: unknown, env: CommunityEnv, moderation = allow, headers: HeadersInit = {}) {
	return handleCommunityPublish(
		new Request(`${ORIGIN}/api/community`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
		env,
		{ moderation },
	);
}

describe("community icon API", () => {
	it("publishes an icon, then finds it by slug and in search", async () => {
		const env = { COMMUNITY_ICONS: sqliteDatabase() };
		const created = await publish({ name: "Ring queue", recipe: RING }, env);
		expect(created.status).toBe(201);
		expect(await created.json()).toEqual({
			slug: "community/ring-queue",
			name: "Ring queue",
			recipe: RING,
			colors: [],
			createdAt: expect.any(String),
			url: `${ORIGIN}/community/ring-queue`,
			api: `${ORIGIN}/api/community/ring-queue`,
			created: true,
		});

		const again = await publish({ name: "Same drawing", recipe: RING }, env);
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ slug: "community/ring-queue", created: false });

		for (const slug of ["ring-queue", "community/ring-queue"]) {
			const detail = await handleCommunityDetail(
				new Request(`${ORIGIN}/api/community/${slug}`),
				env,
				slug,
			);
			expect(detail.status).toBe(200);
			expect(await detail.json()).toMatchObject({ name: "Ring queue", recipe: RING });
		}

		const list = await handleCommunityList(new Request(`${ORIGIN}/api/community?q=ring`), env);
		expect(await list.json()).toMatchObject({
			query: "ring",
			count: 1,
			results: [{ slug: "community/ring-queue" }],
		});
		const none = await handleCommunityList(new Request(`${ORIGIN}/api/community?q=kafka`), env);
		expect(await none.json()).toMatchObject({ count: 0, results: [] });
	});

	it("answers bad bodies, bad recipes and rejected names with their codes", async () => {
		const env = { COMMUNITY_ICONS: sqliteDatabase() };
		const cases: [unknown, number, string][] = [
			["not json", 400, "invalid_request"],
			[{ name: "Ring" }, 400, "invalid_request"],
			[{ recipe: RING }, 400, "invalid_request"],
			[{ name: "Ring", recipe: { parts: [{ kind: "blob" }] } }, 400, "invalid_recipe"],
			[{ name: "x".repeat(9000), recipe: RING }, 413, "invalid_request"],
		];
		for (const [body, status, code] of cases) {
			const response = await publish(body, env);
			expect(response.status, JSON.stringify(body).slice(0, 40)).toBe(status);
			expect(await response.json()).toMatchObject({ error: { code } });
		}
		const invalid = await publish({ name: "Ring", recipe: { parts: [] } }, env);
		expect(await invalid.json()).toMatchObject({
			error: { code: "invalid_recipe", issues: ["recipe.parts must hold 1-8 parts."] },
		});
		const rejected = await publish({ name: "Ring", recipe: RING }, env, reject);
		expect(rejected.status).toBe(422);
		expect(await rejected.json()).toMatchObject({ error: { code: "rejected" } });
	});

	it("rate limits by client address and refuses to publish without moderation or a store", async () => {
		const keys: string[] = [];
		const limited = await publish(
			{ name: "Ring", recipe: RING },
			{
				COMMUNITY_ICONS: sqliteDatabase(),
				COMMUNITY_PUBLISH_LIMIT: {
					limit: async ({ key }) => (keys.push(key), { success: false }),
				},
			},
			allow,
			{ "CF-Connecting-IP": "203.0.113.7" },
		);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect(keys).toEqual(["203.0.113.7"]);

		const unmoderated = await handleCommunityPublish(
			new Request(`${ORIGIN}/api/community`, {
				method: "POST",
				body: JSON.stringify({ name: "Ring", recipe: RING }),
			}),
			{ COMMUNITY_ICONS: sqliteDatabase() },
		);
		expect(unmoderated.status).toBe(503);

		expect((await publish({ name: "Ring", recipe: RING }, {})).status).toBe(503);
	});

	it("hides an icon only with the admin token", async () => {
		const env = { COMMUNITY_ICONS: sqliteDatabase(), COMMUNITY_ADMIN_TOKEN: "owner-token" };
		await publish({ name: "Ring queue", recipe: RING }, env);
		const patch = (token: string | undefined, body: unknown, slug = "ring-queue") =>
			handleCommunityVisibility(
				new Request(`${ORIGIN}/api/community/${slug}`, {
					method: "PATCH",
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					body: JSON.stringify(body),
				}),
				env,
				slug,
			);
		expect((await patch(undefined, { hidden: true })).status).toBe(401);
		expect((await patch("owner-tokeN", { hidden: true })).status).toBe(401);
		expect((await patch("owner-token", { hidden: "yes" })).status).toBe(400);
		expect((await patch("owner-token", { hidden: true }, "missing")).status).toBe(404);
		const hidden = await patch("owner-token", { hidden: true });
		expect(await hidden.json()).toEqual({ slug: "community/ring-queue", hidden: true });

		const detail = await handleCommunityDetail(
			new Request(`${ORIGIN}/api/community/ring-queue`),
			env,
			"ring-queue",
		);
		expect(detail.status).toBe(404);
		const list = await handleCommunityList(new Request(`${ORIGIN}/api/community`), env);
		expect(await list.json()).toMatchObject({ count: 0 });
		const republished = await publish({ name: "Ring queue", recipe: RING }, env);
		expect(republished.status).toBe(422);

		await patch("owner-token", { hidden: false });
		expect(
			(
				await handleCommunityDetail(
					new Request(`${ORIGIN}/api/community/ring-queue`),
					env,
					"ring-queue",
				)
			).status,
		).toBe(200);

		const noToken = await handleCommunityVisibility(
			new Request(`${ORIGIN}/api/community/ring-queue`, { method: "PATCH", body: "{}" }),
			{ COMMUNITY_ICONS: env.COMMUNITY_ICONS },
			"ring-queue",
		);
		expect(noToken.status).toBe(401);
	});

	it("stops reading a body without Content-Length once it passes the limit", async () => {
		const chunk = new TextEncoder().encode("x".repeat(1024));
		let pulled = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				if (pulled > 1024) controller.close();
				else controller.enqueue(chunk);
			},
			cancel() {
				cancelled = true;
			},
		});
		const request = new Request(`${ORIGIN}/api/community`, {
			method: "POST",
			body,
			duplex: "half",
		} as RequestInit);
		expect(request.headers.get("Content-Length")).toBeNull();
		const response = await handleCommunityPublish(
			request,
			{ COMMUNITY_ICONS: sqliteDatabase() },
			{ moderation: allow },
		);
		expect(response.status).toBe(413);
		expect(cancelled).toBe(true);
		expect(pulled).toBeLessThan(16);
	});
});
