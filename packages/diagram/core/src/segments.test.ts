import { describe, expect, it } from "vitest";

import {
  AXIS_ALIGNED_EPSILON,
  isSharedBoundStem,
  segmentCrossesBoundsInterior,
  segmentsFromPoints,
  segmentsOverlapInterior,
} from "./segments";

function horizontal(min: number, max: number, y = 5) {
  const segment = segmentsFromPoints([
    { x: min, y },
    { x: max, y },
  ])[0];
  if (!segment) throw new Error("Expected a segment");
  return segment;
}

describe("shared axis-aligned geometry", () => {
  it("extracts reversed segments without losing endpoint positions around skipped segments", () => {
    expect(
      segmentsFromPoints([
        { x: 10, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 20 },
      ]),
    ).toEqual([
      {
        min: 0,
        max: 10,
        orientation: "horizontal",
        staticCoordinate: 0,
        segmentIndex: 0,
        isFirstSegment: true,
        isLastSegment: false,
      },
      {
        min: 0,
        max: 10,
        orientation: "vertical",
        staticCoordinate: 0,
        segmentIndex: 2,
        isFirstSegment: false,
        isLastSegment: false,
      },
    ]);
  });

  it("uses one tolerance for alignment, length, and interior overlap", () => {
    expect(AXIS_ALIGNED_EPSILON).toBe(0.01);
    expect(
      segmentsFromPoints([
        { x: 0, y: 0 },
        { x: 10, y: 0.005 },
      ]),
    ).toHaveLength(1);
    expect(
      segmentsFromPoints([
        { x: 0, y: 0 },
        { x: 10, y: 0.02 },
      ]),
    ).toEqual([]);
    expect(
      segmentsFromPoints([
        { x: 0, y: 0 },
        { x: 0.005, y: 0 },
      ]),
    ).toEqual([]);
    expect(
      segmentsOverlapInterior(horizontal(0, 10), horizontal(9.995, 20)),
    ).toBe(false);
    expect(
      segmentsOverlapInterior(horizontal(0, 10), horizontal(9.98, 20)),
    ).toBe(true);
    expect(
      segmentsOverlapInterior(horizontal(0, 10), horizontal(0, 10, 5.02)),
    ).toBe(false);
    expect(
      segmentsFromPoints(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0.005 },
        ],
        0.001,
      ),
    ).toEqual([]);
    expect(
      segmentsOverlapInterior(horizontal(0, 10), horizontal(9.995, 20), 0.001),
    ).toBe(true);
  });

  it("crosses only bounds interiors, not boundary contact or tiny overlaps", () => {
    const bounds = { x: 0, y: 0, width: 10, height: 10 };
    expect(segmentCrossesBoundsInterior(horizontal(-5, 15), bounds)).toBe(true);
    expect(segmentCrossesBoundsInterior(horizontal(-5, 0), bounds)).toBe(false);
    expect(
      segmentCrossesBoundsInterior(horizontal(-5, 15, 0.005), bounds),
    ).toBe(false);
    expect(segmentCrossesBoundsInterior(horizontal(-5, 0.005), bounds)).toBe(
      false,
    );
    expect(
      segmentCrossesBoundsInterior(horizontal(-5, 0.005), bounds, 0.001),
    ).toBe(true);
    const vertical = segmentsFromPoints([
      { x: 5, y: -5 },
      { x: 5, y: 15 },
    ])[0];
    if (!vertical) throw new Error("Expected vertical segment");
    expect(segmentCrossesBoundsInterior(vertical, bounds)).toBe(true);
  });

  it("excludes shared bound first/last stems but never unbound or mixed endpoints", () => {
    const first = {
      isFirstSegment: true,
      isLastSegment: false,
      startBindingId: "a",
      endBindingId: "b",
    };
    const last = { ...first, isFirstSegment: false, isLastSegment: true };
    expect(isSharedBoundStem(first, { ...first, endBindingId: "c" })).toBe(
      true,
    );
    expect(isSharedBoundStem(last, { ...last, startBindingId: "c" })).toBe(
      true,
    );
    expect(isSharedBoundStem(first, last)).toBe(false);
    expect(isSharedBoundStem(first, { ...first, startBindingId: "c" })).toBe(
      false,
    );
    expect(
      isSharedBoundStem(
        { ...first, startBindingId: null },
        { ...first, startBindingId: null },
      ),
    ).toBe(false);
  });
});
