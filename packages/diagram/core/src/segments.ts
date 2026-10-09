/**
 * Routing and export validation share a 0.01 canvas-unit tolerance. Segments
 * and interior overlaps at or below that length are ignored; coordinates
 * within that tolerance are axis-aligned. Callers can override it explicitly.
 */
export const AXIS_ALIGNED_EPSILON = 0.01;

export interface AxisAlignedSegment {
  readonly min: number;
  readonly max: number;
  readonly orientation: "horizontal" | "vertical";
  readonly staticCoordinate: number;
  readonly segmentIndex: number;
  readonly isFirstSegment: boolean;
  readonly isLastSegment: boolean;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function segmentsFromPoints(
  points: readonly Point[],
  epsilon = AXIS_ALIGNED_EPSILON,
): AxisAlignedSegment[] {
  const segments: AxisAlignedSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const horizontal = Math.abs(start.y - end.y) <= epsilon;
    const vertical = Math.abs(start.x - end.x) <= epsilon;
    if (!horizontal && !vertical) continue;
    const min = Math.min(
      horizontal ? start.x : start.y,
      horizontal ? end.x : end.y,
    );
    const max = Math.max(
      horizontal ? start.x : start.y,
      horizontal ? end.x : end.y,
    );
    if (max - min <= epsilon) continue;
    segments.push({
      min,
      max,
      orientation: horizontal ? "horizontal" : "vertical",
      staticCoordinate: horizontal ? start.y : start.x,
      segmentIndex: index,
      isFirstSegment: index === 0,
      isLastSegment: index === points.length - 2,
    });
  }
  return segments;
}

export function segmentOverlapLength(
  left: AxisAlignedSegment,
  right: AxisAlignedSegment,
): number {
  return Math.min(left.max, right.max) - Math.max(left.min, right.min);
}

export function segmentsOverlapInterior(
  left: AxisAlignedSegment,
  right: AxisAlignedSegment,
  epsilon = AXIS_ALIGNED_EPSILON,
): boolean {
  return (
    left.orientation === right.orientation &&
    Math.abs(left.staticCoordinate - right.staticCoordinate) <= epsilon &&
    segmentOverlapLength(left, right) > epsilon
  );
}

export function segmentCrossesBoundsInterior(
  segment: AxisAlignedSegment,
  bounds: Bounds,
  epsilon = AXIS_ALIGNED_EPSILON,
): boolean {
  const horizontal = segment.orientation === "horizontal";
  const staticMin = horizontal ? bounds.y : bounds.x;
  const staticMax = staticMin + (horizontal ? bounds.height : bounds.width);
  const min = horizontal ? bounds.x : bounds.y;
  const max = min + (horizontal ? bounds.width : bounds.height);
  return (
    segment.staticCoordinate > staticMin + epsilon &&
    segment.staticCoordinate < staticMax - epsilon &&
    Math.min(segment.max, max) - Math.max(segment.min, min) > epsilon
  );
}

interface BoundStem {
  readonly isFirstSegment: boolean;
  readonly isLastSegment: boolean;
  readonly startBindingId: string | null;
  readonly endBindingId: string | null;
}

/** Shared first/last bound stems may overlap; unbound stems may not. */
export function isSharedBoundStem(left: BoundStem, right: BoundStem): boolean {
  return (
    (left.isFirstSegment &&
      right.isFirstSegment &&
      left.startBindingId !== null &&
      left.startBindingId === right.startBindingId) ||
    (left.isLastSegment &&
      right.isLastSegment &&
      left.endBindingId !== null &&
      left.endBindingId === right.endBindingId)
  );
}
