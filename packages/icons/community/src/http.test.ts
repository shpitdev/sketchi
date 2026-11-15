import { openD1 } from "../tests/d1.js";

import { Context, Effect, Layer } from "effect";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiTest } from "effect/http-api";
import { CommunityHttpHandlers, CommunityHttpRequest, type CommunityEnv } from "./http.js";
import { CommunityHttpApi } from "./http-api.js";
import { CommunityIconModeration } from "./moderation.js";

const runtime = HttpRouter.toWebHandler(
	HttpApiBuilder.layer(CommunityHttpApi).pipe(
		Layer.provide(CommunityHttpHandlers),
		Layer.provide(HttpServer.layerServices),
	),
	{ disableLogger: true },
);
afterAll(() => runtime.dispose());
function handleCommunityPublish(
	request: Request,
	env: CommunityEnv,
	options: { readonly moderation?: Layer.Layer<CommunityIconModeration> } = {},
) {
	return runtime.handler(
		request,
		Context.make(CommunityHttpRequest, { env, origin: new URL(request.url).origin, ...options }),
	);
}
const handleCommunityList = handleCommunityPublish;
function handleCommunityDetail(request: Request, env: CommunityEnv, slug: string) {
	const url = new URL(request.url);
	url.pathname = `/api/community/${encodeURIComponent(slug)}`;
	return handleCommunityPublish(new Request(url, request), env);
}
const handleCommunityVisibility = handleCommunityDetail;

const fixtures: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const dispose of fixtures.splice(0)) await dispose();
});
async function nativeDatabase() {
	const fixture = await openD1();
	fixtures.push(fixture.dispose);
	return fixture.database;
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
	it("serves published recipes and typed missing outcomes through the generated client", async () => {
		const env = { COMMUNITY_ICONS: await nativeDatabase() };
		const requestLayer = Layer.succeed(CommunityHttpRequest, {
			env,
			origin: ORIGIN,
			moderation: allow,
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* HttpApiTest.groups(CommunityHttpApi, ["community"], {
					baseUrl: ORIGIN,
				});
				const created = yield* client.community.publish({
					payload: { name: "Ring queue", recipe: RING },
					responseMode: "decoded-and-response",
				});
				expect(created[1].status).toBe(201);
				expect(created[0].recipe).toEqual(RING);
				const page = yield* client.community.list({ query: { q: "  Ring " } });
				expect(page.query).toBe("Ring");
				expect(page.results.map((icon) => icon.slug)).toEqual(["community/ring-queue"]);
				const missing = yield* client.community
					.detail({ params: { slug: "missing" } })
					.pipe(Effect.result);
				expect(missing).toMatchObject({
					_tag: "Failure",
					failure: { error: { code: "not_found" } },
				});
			}).pipe(
				Effect.provide(
					CommunityHttpHandlers.pipe(
						Layer.provide(requestLayer),
						HttpRouter.provideRequest(requestLayer),
					),
				),
				Effect.provide(HttpServer.layerServices),
				Effect.scoped,
			),
		);
	});

	it("uses the first repeated query value and retains blank/default pagination behavior", async () => {
		const env = { COMMUNITY_ICONS: await nativeDatabase() };
		await publish({ name: "Ring queue", recipe: RING }, env);
		const page = await handleCommunityList(
			new Request(`${ORIGIN}/api/community?q=%20Ring%20&q=missing&limit=bad&limit=1`),
			env,
		);
		expect(page.status).toBe(200);
		expect(await page.json()).toMatchObject({
			query: "Ring",
			count: 1,
			results: [{ name: "Ring queue" }],
		});
	});

	it("publishes an icon, then finds it by slug and in search", async () => {
		const env = { COMMUNITY_ICONS: await nativeDatabase() };
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
		const env = { COMMUNITY_ICONS: await nativeDatabase() };
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
		const clipped = await publish(
			{
				name: "Tiny",
				recipe: { parts: [{ kind: "text", cx: 12, cy: 9, text: "tinyhttp", size: 8.5 }] },
			},
			env,
		);
		expect(clipped.status).toBe(422);
		expect(await clipped.json()).toMatchObject({
			error: { code: "recipe_clips", message: expect.stringContaining('"tinyhttp"') },
		});
	});

	it("rate limits by client address and refuses to publish without moderation or a store", async () => {
		const keys: string[] = [];
		const limited = await publish(
			{ name: "Ring", recipe: RING },
			{
				COMMUNITY_ICONS: await nativeDatabase(),
				COMMUNITY_CLIENT_LIMIT: {
					getByName: (name) => ({
						take: async (limit, windowMs) => (
							keys.push(`${name} ${limit}/${windowMs}`),
							{ allowed: false, retryAfterSeconds: 42 }
						),
					}),
				},
			},
			allow,
			{ "CF-Connecting-IP": "203.0.113.7" },
		);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("42");
		expect(keys).toEqual(["client:203.0.113.7 10/60000"]);

		const unmoderated = await handleCommunityPublish(
			new Request(`${ORIGIN}/api/community`, {
				method: "POST",
				body: JSON.stringify({ name: "Ring", recipe: RING }),
			}),
			{ COMMUNITY_ICONS: await nativeDatabase() },
		);
		expect(unmoderated.status).toBe(503);

		expect((await publish({ name: "Ring", recipe: RING }, {})).status).toBe(503);
	});

	it("hides an icon only with the admin token", async () => {
		const env = { COMMUNITY_ICONS: await nativeDatabase(), COMMUNITY_ADMIN_TOKEN: "owner-token" };
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

	it("recovers native D1 initialization after a failed request without caching failure", async () => {
		const database = await nativeDatabase();
		await database.exec("CREATE VIEW community_icons AS SELECT 1;");
		const env = { COMMUNITY_ICONS: database };
		expect((await handleCommunityList(new Request(`${ORIGIN}/api/community`), env)).status).toBe(
			503,
		);
		await database.exec("DROP VIEW community_icons;");
		expect((await handleCommunityList(new Request(`${ORIGIN}/api/community`), env)).status).toBe(
			200,
		);
		expect((await publish({ name: "Recovered ring", recipe: RING }, env)).status).toBe(201);
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
			{ COMMUNITY_ICONS: await nativeDatabase() },
			{ moderation: allow },
		);
		expect(response.status).toBe(413);
		expect(cancelled).toBe(true);
		expect(pulled).toBeLessThan(16);
	});
});
