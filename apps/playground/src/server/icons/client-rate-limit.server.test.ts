import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientRateLimit } from "./client-rate-limit.server";

function object() {
	const stored = new Map<string, unknown>();
	const alarms: number[] = [];
	const storage = {
		get: (key: string) => Promise.resolve(stored.get(key)),
		put: (key: string, value: unknown) => {
			stored.set(key, value);
			return Promise.resolve();
		},
		setAlarm: (time: number) => {
			alarms.push(time);
			return Promise.resolve();
		},
		deleteAll: () => {
			stored.clear();
			return Promise.resolve();
		},
	};
	return {
		limit: new ClientRateLimit({ storage, waitUntil: () => undefined }, {}),
		stored,
		alarms,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("ClientRateLimit", () => {
	it("counts a client's requests exactly and forgets them once a window passes quietly", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
		const { limit, stored, alarms } = object();
		const decisions = [];
		for (let request = 0; request < 7; request += 1) decisions.push(await limit.take(6, 60_000));
		expect(decisions.map(({ allowed }) => allowed)).toEqual([
			true,
			true,
			true,
			true,
			true,
			true,
			false,
		]);
		expect(decisions[6]?.retryAfterSeconds).toBe(60);
		// Each allowed request moves the cleanup to a full window after it.
		expect(alarms).toHaveLength(6);
		expect(alarms.at(-1)).toBe(Date.parse("2026-11-09T12:01:00Z"));
		await limit.alarm();
		expect(stored.size).toBe(0);
		expect(await limit.take(6, 60_000)).toEqual({ allowed: true, retryAfterSeconds: 0 });
	});
});
