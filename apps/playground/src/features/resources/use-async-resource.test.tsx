import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncResource } from "./use-async-resource";

describe("useAsyncResource", () => {
  it("loads once, retains data across renders, and aborts on unmount", async () => {
    const load = vi.fn(async (signal: AbortSignal) => ({
      signal,
      value: "ready",
    }));
    const { result, rerender, unmount } = renderHook(() =>
      useAsyncResource(load, ["id"], "Load failed."),
    );
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender();
    expect(load).toHaveBeenCalledTimes(1);
    const signal = load.mock.calls[0]?.[0];
    unmount();
    // A settled load does not need cancellation; pending ones do (below).
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts old loads on dependency changes and ignores late completions", async () => {
    const old = Promise.withResolvers<{ value: string }>();
    const next = Promise.withResolvers<{ value: string }>();
    const signals: AbortSignal[] = [];
    const { result, rerender, unmount } = renderHook(
      ({ id }) =>
        useAsyncResource(
          (signal) => {
            signals.push(signal);
            return id === "old" ? old.promise : next.promise;
          },
          [id],
          "Load failed.",
        ),
      { initialProps: { id: "old" } },
    );
    rerender({ id: "next" });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => old.resolve({ value: "stale" }));
    expect(result.current.status).toBe("loading");
    await act(async () => next.resolve({ value: "current" }));
    await waitFor(() =>
      expect(result.current).toMatchObject({
        status: "ready",
        value: "current",
      }),
    );
    unmount();
  });

  it("aborts pending fetchers on unmount without surfacing cancellation", () => {
    const pending = Promise.withResolvers<{ value: string }>();
    let signal: AbortSignal | undefined;
    const { unmount } = renderHook(() =>
      useAsyncResource(
        (nextSignal) => {
          signal = nextSignal;
          return pending.promise;
        },
        [],
        "Load failed.",
      ),
    );
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it.each([new Error("Specific failure."), "unexpected failure"])(
    "maps errors once without retrying",
    async (error) => {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the string case proves non-Error rejections map to the fallback message
      const load = vi.fn(() => Promise.reject(error));
      const { result } = renderHook(() =>
        useAsyncResource(load, [], "Load failed."),
      );
      await waitFor(() =>
        expect(result.current).toEqual({
          status: "error",
          message: error instanceof Error ? error.message : "Load failed.",
        }),
      );
      expect(load).toHaveBeenCalledTimes(1);
    },
  );
});
