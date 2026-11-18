import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { priceLogs } from "../src/gateway";

const account = { accountId: "acct", token: "token" };

it.effect("waits for a late gateway log and prices every call, including zero-cost calls", () =>
	Effect.gen(function* () {
		let reads = 0;
		const fetch: typeof globalThis.fetch = async (input) => {
			if (++reads === 1) return new Response(null, { status: 404 });
			const url = input instanceof Request ? input.url : input.toString();
			return Response.json({ result: { cost: url.endsWith("/a") ? 0.03 : 0 } });
		};
		const priced = yield* priceLogs({ ...account, fetch }, ["a", "b"]).pipe(Effect.forkChild);
		yield* TestClock.adjust("2 seconds");
		expect(priced.pollUnsafe()).toEqual(Exit.succeed(0.03));
		expect(reads).toBe(3);
	}),
);

for (const stall of ["headers", "body"] as const) {
	it.effect(`bounds and aborts every GET when the ${stall} stall`, () =>
		Effect.gen(function* () {
			const requests: Array<{
				method: string | undefined;
				signal: AbortSignal | null | undefined;
			}> = [];
			const fetch: typeof globalThis.fetch = async (_input, init) => {
				requests.push({ method: init?.method, signal: init?.signal });
				// @effect-diagnostics-next-line newPromise:off -- The fake gateway stalls its body until the request AbortSignal fires.
				if (stall === "headers") return new Promise<Response>(() => undefined);
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('{"result":'));
							init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), {
								once: true,
							});
						},
					}),
					{ status: 200 },
				);
			};
			const priced = yield* priceLogs({ ...account, fetch }, ["stalled"]).pipe(Effect.forkChild);
			yield* TestClock.adjust("60 seconds");
			expect(priced.pollUnsafe()).toEqual(Exit.succeed(undefined));
			expect(requests.map(({ method, signal }) => [method, signal?.aborted])).toEqual(
				Array.from({ length: 6 }, () => ["GET", true]),
			);
		}),
	);
}
