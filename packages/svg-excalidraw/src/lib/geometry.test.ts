// @vitest-environment node

import { describe, expect, it } from "vitest";

import { decomposeNonzeroRings, keyholeBridgeIsSafe } from "./geometry";

describe("nonzero planar decomposition", () => {
  it("splits a self-intersecting contour into deterministic simple regions", () => {
    const rings = [
      [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
        { x: 20, y: 0 },
      ],
    ];

    const first = decomposeNonzeroRings(rings);
    const second = decomposeNonzeroRings(rings);

    expect(second).toEqual(first);
    expect(first).toEqual([
      {
        holes: [],
        outer: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      {
        holes: [],
        outer: [
          { x: 0, y: 20 },
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
      },
    ]);
  });

  it("fails closed when coordinates cannot be scaled to safe integers", () => {
    expect(
      decomposeNonzeroRings([
        [
          { x: 0, y: 0 },
          { x: 2_000_000_000_000, y: 2_000_000_000_000 },
          { x: 0, y: 2_000_000_000_000 },
          { x: 2_000_000_000_000, y: 0 },
        ],
      ]),
    ).toBeNull();
  });

  it("fills isolated rings in both orientations and cancels opposite winding", () => {
    const clockwise = [
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 0 },
    ];
    const counterClockwise = [...clockwise].reverse();

    expect(decomposeNonzeroRings([clockwise])).toHaveLength(1);
    expect(decomposeNonzeroRings([counterClockwise])).toHaveLength(1);
    expect(decomposeNonzeroRings([clockwise, clockwise])).toHaveLength(1);
    expect(decomposeNonzeroRings([clockwise, counterClockwise])).toEqual([]);
  });
});

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
