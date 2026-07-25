import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./icon-actions";

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const results = await mapWithConcurrency([5, 1, 3], 3, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay;
    });
    expect(results).toEqual([5, 1, 3]);
  });

  it("never runs more than the limit at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 40 }, (_, index) => index),
      4,
      async (index) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return index;
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("stops claiming work after a failure and settles before rejecting", async () => {
    const started: number[] = [];
    let settled = 0;
    const task = mapWithConcurrency(
      Array.from({ length: 40 }, (_, index) => index),
      4,
      async (index) => {
        started.push(index);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (index === 0) throw new Error("boom");
        settled += 1;
        return index;
      },
    );
    await expect(task).rejects.toThrow("boom");

    // Nothing may still be in flight once the caller sees the rejection, so a
    // caller that resets its progress state is not racing leftover workers.
    const startedAtRejection = started.length;
    const settledAtRejection = settled;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started.length).toBe(startedAtRejection);
    expect(settled).toBe(settledAtRejection);
    expect(started.length).toBeLessThan(40);
  });

  it("handles an empty input", async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });
});
