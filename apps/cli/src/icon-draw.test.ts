import { strict as assert } from "node:assert";

import { afterEach, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { publishIcon, reserveStems } from "./icon-draw.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const icon: Parameters<typeof publishIcon>[1] = {
	ok: true,
	name: "acme",
	recipe: { parts: [] },
	previews: { png28: "", png112: "" },
	excalidrawlib: {
		type: "excalidrawlib",
		version: 2,
		source: "https://sketchi.app",
		libraryItems: [],
	},
	judge: { recognizable: true, model: "gemini-3.8-flash" },
	author: { model: "anthropic/claude-sonnet-5-5", rounds: 1 },
	usage: { calls: 3, ms: 9000 },
};

const published = () =>
	new Response(
		JSON.stringify({ slug: "community/acme", url: "https://icons.example/acme", created: true }),
		{ status: 201, headers: { "content-type": "application/json" } },
	);

/** Let pending promises settle between clock steps. */
const settle = Effect.promise(() => new Promise<void>((done) => setImmediate(done)));

describe("reserveStems", () => {
	it("keeps the pack's name and numbers a repeated stem", () => {
		assert.deepEqual(reserveStems(["acme", "Acme", "logos", "acme 2"], "logos"), [
			"acme",
			"acme-2",
			"logos-2",
			"acme-2-2",
		]);
		assert.deepEqual(reserveStems(["acme"], undefined), ["acme"]);
	});
});

describe("publishIcon", () => {
	it.effect("waits out a 60 s Retry-After without counting it against the attempt", () =>
		Effect.gen(function* () {
			const calls: number[] = [];
			globalThis.fetch = () => {
				calls.push(calls.length);
				return Promise.resolve(
					calls.length === 1
						? new Response('{"error":{"code":"rate_limited","message":"Slow down."}}', {
								status: 429,
								headers: { "retry-after": "60" },
							})
						: published(),
				);
			};
			const fiber = yield* publishIcon("https://icons.example/api/community", icon).pipe(
				Effect.forkChild,
			);
			for (let second = 0; second < 90 && fiber.pollUnsafe() === undefined; second += 1) {
				yield* settle;
				yield* TestClock.adjust("1 second");
			}
			assert.equal(calls.length, 2);
			assert.equal((yield* Fiber.join(fiber)).slug, "community/acme");
		}),
	);

	it.effect("times out one stalled attempt and aborts its request", () =>
		Effect.gen(function* () {
			let signal: AbortSignal | null | undefined;
			globalThis.fetch = (_input, init) => {
				signal = init?.signal;
				return new Promise<Response>(() => undefined);
			};
			const fiber = yield* Effect.flip(
				publishIcon("https://icons.example/api/community", icon),
			).pipe(Effect.forkChild);
			yield* settle;
			yield* TestClock.adjust("30 seconds");
			const failure = yield* Fiber.join(fiber);
			assert.equal(failure.code, "publish_failed");
			assert.match(failure.message, /did not answer in time/);
			assert.equal(signal?.aborted, true);
		}),
	);

	it.effect("keeps the store's reason for a refusal", () =>
		Effect.gen(function* () {
			globalThis.fetch = () =>
				Promise.resolve(
					new Response('{"error":{"code":"rejected","message":"Not allowed."}}', { status: 422 }),
				);
			const failure = yield* Effect.flip(publishIcon("https://icons.example/api/community", icon));
			assert.equal(failure.message, "Not allowed.");
			assert.deepEqual(failure.details, ["http_status:422", "rejected"]);
		}),
	);
});
