import { afterEach, describe, expect, it, vi } from "vitest";

import { IconDrawBudget } from "./budget-object.server";

function budget() {
	const stored = new Map<string, unknown>();
	const storage = {
		get: (key: string) => Promise.resolve(stored.get(key)),
		put: (key: string, value: unknown) => {
			stored.set(key, value);
			return Promise.resolve();
		},
		list: ({ prefix = "" }: { prefix?: string } = {}) =>
			Promise.resolve(new Map([...stored].filter(([key]) => key.startsWith(prefix)))),
		delete: (keys: string[]) => {
			for (const key of keys) stored.delete(key);
			return Promise.resolve(keys.length);
		},
	};
	return { object: new IconDrawBudget({ storage, waitUntil: () => undefined }, {}), stored };
}

const at = (iso: string) => vi.setSystemTime(new Date(iso));

afterEach(() => {
	vi.useRealTimers();
});

describe("IconDrawBudget", () => {
	it("admits draws up to the day's cap, then refuses", async () => {
		vi.useFakeTimers();
		at("2026-11-09T12:00:00Z");
		const { object } = budget();
		expect(await object.admit(2)).toEqual({ admitted: true, used: 1 });
		expect(await object.admit(2)).toEqual({ admitted: true, used: 2 });
		expect(await object.admit(2)).toEqual({ admitted: false, used: 2 });
	});

	it("starts each UTC day from zero and forgets the days before", async () => {
		vi.useFakeTimers();
		const { object, stored } = budget();
		at("2026-11-09T23:59:59Z");
		expect(await object.admit(1)).toEqual({ admitted: true, used: 1 });
		at("2026-11-10T00:00:01Z");
		expect(await object.admit(1)).toEqual({ admitted: true, used: 1 });
		expect([...stored.keys()]).toEqual(["draws:2026-11-10"]);
	});

	it("never lets an earlier day reopen a later one's count", async () => {
		// The review's sequence with a cap of 1: Nov 10, then a moment dated Nov 9, then Nov 10.
		vi.useFakeTimers();
		const { object, stored } = budget();
		at("2026-11-10T00:00:05Z");
		expect(await object.admit(1)).toEqual({ admitted: true, used: 1 });
		at("2026-11-09T23:59:58Z");
		expect(await object.admit(1)).toEqual({ admitted: false, used: 1 });
		at("2026-11-10T00:00:09Z");
		expect(await object.admit(1)).toEqual({ admitted: false, used: 1 });
		expect([...stored]).toEqual([["draws:2026-11-10", 1]]);
	});

	it("refuses everything with a cap of zero", async () => {
		vi.useFakeTimers();
		at("2026-11-09T12:00:00Z");
		expect(await budget().object.admit(0)).toEqual({ admitted: false, used: 0 });
	});
});
