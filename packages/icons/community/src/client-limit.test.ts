import { describe, expect, it } from "vitest";

import { clientAddress, limitClient, takeClientRequest } from "./client-limit.js";

function memory() {
	const stored = new Map<string, unknown>();
	return {
		stored,
		storage: {
			get: <T>(key: string) => Promise.resolve(stored.get(key) as T | undefined),
			put: <T>(key: string, value: T) => {
				stored.set(key, value);
				return Promise.resolve();
			},
		},
	};
}

describe("takeClientRequest", () => {
	it("allows the limit within a window and refuses the next, counting every request", async () => {
		const { storage } = memory();
		const decisions = [];
		for (let second = 0; second < 10; second += 1) {
			decisions.push(await takeClientRequest(storage, 6, 60_000, second * 1000));
		}
		expect(decisions.map(({ allowed }) => allowed)).toEqual([
			true,
			true,
			true,
			true,
			true,
			true,
			false,
			false,
			false,
			false,
		]);
		// The seventh, at 6 s, waits until the first leaves the window at 60 s.
		expect(decisions[6]).toEqual({ allowed: false, retryAfterSeconds: 54 });
	});

	it("slides: a request is let in as soon as the oldest one ages out, and refusals are not counted", async () => {
		const { storage, stored } = memory();
		for (const at of [0, 1000, 2000]) await takeClientRequest(storage, 3, 60_000, at);
		expect(await takeClientRequest(storage, 3, 60_000, 59_999)).toMatchObject({ allowed: false });
		expect(await takeClientRequest(storage, 3, 60_000, 60_000)).toEqual({
			allowed: true,
			retryAfterSeconds: 0,
		});
		expect(stored.get("requests")).toEqual([1000, 2000, 60_000]);
	});
});

describe("limitClient", () => {
	it("asks the requesting address's own limit object", async () => {
		const asked: string[] = [];
		const namespace = {
			getByName: (name: string) => ({
				take: (limit: number, windowMs: number) => {
					asked.push(`${name} ${limit} ${windowMs}`);
					return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
				},
			}),
		};
		const request = new Request("https://example.test", {
			headers: { "CF-Connecting-IP": "198.51.100.4" },
		});
		await limitClient(namespace, request, 6, 60_000);
		expect(asked).toEqual(["client:198.51.100.4 6 60000"]);
		expect(clientAddress(new Request("https://example.test"))).toBe("unknown");
	});
});
