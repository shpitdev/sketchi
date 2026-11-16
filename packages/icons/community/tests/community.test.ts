import { type IconRecipe } from "@sketchi/drawing";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { takeClientRequest } from "../src/client-limit.js";
import { CommunityHttpHandlers, CommunityHttpRequest, type CommunityEnv } from "../src/http.js";
import { CommunityHttpApi } from "../src/http-api.js";
import { communityIconHash, communityIconStoreLayer, CommunityIconStore } from "../src/index.js";
import { openD1 } from "./d1.js";

const ORIGIN = "https://icons.sketchi.app";
const RING: IconRecipe = {
	parts: [
		{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 },
		{ kind: "text", cx: 12, cy: 12, text: "Q", size: 8 },
	],
};
const BOX: IconRecipe = {
	parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, stroke: "#2496ed", fill: "#2496ed" }],
};

const runtime = HttpRouter.toWebHandler(
	HttpApiBuilder.layer(CommunityHttpApi).pipe(
		Layer.provide(CommunityHttpHandlers),
		Layer.provide(HttpServer.layerServices),
	),
	{ disableLogger: true },
);
afterAll(() => runtime.dispose());

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function nativeDatabase() {
	const fixture = await openD1();
	cleanups.push(fixture.dispose);
	return fixture.database;
}

const handle = (request: Request, env: CommunityEnv) =>
	runtime.handler(request, Context.make(CommunityHttpRequest, { env, origin: ORIGIN }));
const get = (path: string, env: CommunityEnv) => handle(new Request(`${ORIGIN}${path}`), env);
const publish = (body: unknown, env: CommunityEnv, headers: HeadersInit = {}) =>
	handle(
		new Request(`${ORIGIN}/api/community`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
		env,
	);

/** A Workers AI binding whose moderation model scores every icon `unfit`, or fails. */
function moderationAi(unfit: number | Error | object = 0.1) {
	const calls: unknown[] = [];
	const AI = {
		run: async (_model: string, input: unknown) => {
			calls.push(input);
			if (unfit instanceof Error) throw unfit;
			return typeof unfit === "number"
				? { answers: { unfit: { type: "noul", noul: unfit } } }
				: unfit;
		},
	};
	return { AI, calls };
}

describe("community icon API", () => {
	it("publishes a moderated icon once, then finds it by slug and in search", async () => {
		const { AI, calls } = moderationAi();
		const env = { COMMUNITY_ICONS: await nativeDatabase(), AI };
		const created = await publish({ name: "Ring queue", recipe: RING }, env);
		expect(created.status).toBe(201);
		expect(await created.json()).toMatchObject({ slug: "community/ring-queue", recipe: RING });

		// The same drawing returns the stored icon without paying for moderation again.
		const again = await publish({ name: "Same drawing", recipe: RING }, env);
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ slug: "community/ring-queue", created: false });
		expect(calls).toHaveLength(1);

		for (const path of ["/api/community/ring-queue", "/api/community/community%2Fring-queue"]) {
			expect(await (await get(path, env)).json()).toMatchObject({ recipe: RING });
		}
		expect(await (await get("/api/community?q=ring", env)).json()).toMatchObject({
			count: 1,
			results: [{ slug: "community/ring-queue" }],
		});
		expect((await get("/api/community/missing", env)).status).toBe(404);
	});

	it("keeps out what moderation finds unfit, and refuses when it or the store is missing", async () => {
		const database = await nativeDatabase();
		const unfit = await publish(
			{ name: "Ring", recipe: RING },
			{ COMMUNITY_ICONS: database, AI: moderationAi(0.8).AI },
		);
		expect(unfit.status).toBe(422);
		expect(await unfit.json()).toMatchObject({ error: { code: "rejected" } });
		for (const answer of [new Error("AI down"), { answers: {} }, Number.NaN]) {
			const env = { COMMUNITY_ICONS: database, AI: moderationAi(answer).AI };
			expect((await publish({ name: "Ring", recipe: RING }, env)).status).toBe(503);
		}
		expect((await publish({ name: "Ring", recipe: RING }, { COMMUNITY_ICONS: database })).status).toBe(
			503,
		);
		expect((await publish({ name: "Ring", recipe: RING }, { AI: moderationAi().AI })).status).toBe(
			503,
		);
		expect(await (await get("/api/community", { COMMUNITY_ICONS: database })).json()).toMatchObject(
			{ count: 0 },
		);
	});

	it("answers bad bodies and recipes with their codes, and stops reading an oversized body", async () => {
		const env = { COMMUNITY_ICONS: await nativeDatabase(), AI: moderationAi().AI };
		for (const [body, status, code] of [
			["not json", 400, "invalid_request"],
			[{ name: "Ring" }, 400, "invalid_request"],
			[{ name: "Ring", recipe: { parts: [{ kind: "blob" }] } }, 400, "invalid_recipe"],
			[{ name: "x".repeat(9000), recipe: RING }, 413, "invalid_request"],
			[
				{ name: "Tiny", recipe: { parts: [{ kind: "text", cx: 12, cy: 9, text: "tinyhttp", size: 8.5 }] } },
				422,
				"recipe_clips",
			],
		] as const) {
			const response = await publish(body, env);
			expect(response.status, code).toBe(status);
			expect(await response.json()).toMatchObject({ error: { code } });
		}

		const chunk = new TextEncoder().encode("x".repeat(1024));
		let pulled = 0;
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				if (pulled > 1024) controller.close();
				else controller.enqueue(chunk);
			},
			cancel() {
				cancelled = true;
			},
		});
		const response = await handle(
			new Request(`${ORIGIN}/api/community`, {
				method: "POST",
				body: stream,
				duplex: "half",
			} as RequestInit),
			env,
		);
		expect(response.status).toBe(413);
		expect(cancelled).toBe(true);
		expect(pulled).toBeLessThan(16);
	});

	it("rate limits publishing per client address", async () => {
		const windows = new Map<string, Map<string, unknown>>();
		const COMMUNITY_CLIENT_LIMIT = {
			getByName: (name: string) => {
				const stored = windows.get(name) ?? new Map<string, unknown>();
				windows.set(name, stored);
				const storage = {
					get: <T>(key: string) => Promise.resolve(stored.get(key) as T | undefined),
					put: <T>(key: string, value: T) => Promise.resolve(void stored.set(key, value)),
				};
				return { take: (limit: number, windowMs: number) => takeClientRequest(storage, limit, windowMs, 0) };
			},
		};
		const env = { COMMUNITY_ICONS: await nativeDatabase(), AI: moderationAi().AI, COMMUNITY_CLIENT_LIMIT };
		const from = (address: string) =>
			publish({ name: "Ring", recipe: RING }, env, { "CF-Connecting-IP": address });
		for (let index = 0; index < 10; index += 1) {
			expect((await from("203.0.113.7")).status).toBeLessThan(300);
		}
		const limited = await from("203.0.113.7");
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect((await from("198.51.100.4")).status).toBeLessThan(300);
	});

	it("slides the client window: one request enters as the oldest ages out, refusals uncounted", async () => {
		const stored = new Map<string, unknown>();
		const storage = {
			get: <T>(key: string) => Promise.resolve(stored.get(key) as T | undefined),
			put: <T>(key: string, value: T) => Promise.resolve(void stored.set(key, value)),
		};
		for (const at of [0, 1000, 2000]) await takeClientRequest(storage, 3, 60_000, at);
		expect(await takeClientRequest(storage, 3, 60_000, 59_999)).toEqual({
			allowed: false,
			retryAfterSeconds: 1,
		});
		expect(await takeClientRequest(storage, 3, 60_000, 60_000)).toMatchObject({ allowed: true });
		expect(await takeClientRequest(storage, 3, 60_000, 60_001)).toMatchObject({ allowed: false });
	});

	it("hides an icon only with the admin token, until it is restored", async () => {
		const env = {
			COMMUNITY_ICONS: await nativeDatabase(),
			AI: moderationAi().AI,
			COMMUNITY_ADMIN_TOKEN: "owner-token",
		};
		await publish({ name: "Ring queue", recipe: RING }, env);
		const patch = (token: string | undefined, hidden: unknown, target = env) =>
			handle(
				new Request(`${ORIGIN}/api/community/ring-queue`, {
					method: "PATCH",
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					body: JSON.stringify({ hidden }),
				}),
				target,
			);
		expect((await patch(undefined, true)).status).toBe(401);
		expect((await patch("owner-tokeN", true)).status).toBe(401);
		expect(
			(await patch("owner-token", true, { ...env, COMMUNITY_ADMIN_TOKEN: "" })).status,
		).toBe(401);
		expect((await patch("owner-token", true)).status).toBe(200);
		expect((await get("/api/community/ring-queue", env)).status).toBe(404);
		expect(await (await get("/api/community", env)).json()).toMatchObject({ count: 0 });
		expect((await publish({ name: "Ring queue", recipe: RING }, env)).status).toBe(422);
		await patch("owner-token", false);
		expect((await get("/api/community/ring-queue", env)).status).toBe(200);
	});
});

describe("community icon store on native D1", () => {
	async function openStore(database: NonNullable<CommunityEnv["COMMUNITY_ICONS"]>) {
		const store = ManagedRuntime.make(communityIconStoreLayer(database));
		cleanups.push(() => store.dispose());
		return store.runPromise(CommunityIconStore);
	}

	it("keeps one slug per drawing and distinct slugs per name under overlapping writers", async () => {
		const database = await nativeDatabase();
		const [a, b] = [await openStore(database), await openStore(database)];
		const hash = await communityIconHash(RING);
		const same = await Promise.all([
			Effect.runPromise(a.insert({ name: "Ring", recipe: RING, hash })),
			Effect.runPromise(b.insert({ name: "Other ring", recipe: RING, hash })),
		]);
		expect(same.filter((result) => result.created)).toHaveLength(1);
		expect(new Set(same.map((result) => result.icon.slug)).size).toBe(1);
		const different = await Promise.all([
			Effect.runPromise(a.insert({ name: "Box", recipe: BOX, hash: await communityIconHash(BOX) })),
			Effect.runPromise(b.insert({ name: "Box", recipe: RING, hash: "deliberate-distinct-hash" })),
		]);
		expect(new Set(different.map((result) => result.icon.slug)).size).toBe(2);
	});

	it("pages equal timestamps without gaps and treats LIKE wildcards literally", async () => {
		const database = await nativeDatabase();
		const store = await openStore(database);
		for (const [index, name] of ["Kafka topic", "Queue", "Database", "Kafka broker"].entries()) {
			const recipe: IconRecipe = { parts: [{ kind: "rect", x: index, y: 4, width: 8, height: 8 }] };
			await Effect.runPromise(store.insert({ name, recipe, hash: await communityIconHash(recipe) }));
		}
		await database.prepare("UPDATE community_icons SET created_at='2026-11-08T12:00:00.000Z'").run();
		const first = await Effect.runPromise(store.search({ limit: 2 }));
		const second = await Effect.runPromise(
			store.search({ limit: 2, ...(first.nextCursor ? { cursor: first.nextCursor } : {}) }),
		);
		expect(new Set([...first.icons, ...second.icons].map((icon) => icon.slug)).size).toBe(4);
		expect((await Effect.runPromise(store.search({ query: "kafka%" }))).icons).toEqual([]);
		expect((await Effect.runPromise(store.search({ query: "kafka_" }))).icons).toEqual([]);
	});
});
