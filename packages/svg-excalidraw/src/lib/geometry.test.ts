// @vitest-environment node

import { describe, expect, it } from "vitest";

import { keyholeBridgeIsSafe } from "./geometry";

describe("keyhole bridge safety", () => {
  it("accepts a contained hole with an interior bridge", () => {
    expect(
      keyholeBridgeIsSafe({
        outer: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        holes: [
          [
            { x: 6, y: 6 },
            { x: 6, y: 14 },
            { x: 14, y: 14 },
            { x: 14, y: 6 },
          ],
        ],
      }),
    ).toBe(true);
  });

  it("rejects a bridge that leaves the filled outer region", () => {
    expect(
      keyholeBridgeIsSafe({
        outer: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        holes: [
          [
            { x: 12, y: 2 },
            { x: 12, y: 4 },
            { x: 14, y: 4 },
            { x: 14, y: 2 },
          ],
        ],
      }),
    ).toBe(false);
  });
});
