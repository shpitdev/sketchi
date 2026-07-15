import earcut from "earcut";
import ClipperLib from "clipper-lib";

import type { FilledRegion, Point } from "./types";

const EPSILON = 1e-7;
// clipper-lib uses JavaScript numbers for integer predicates. Local coordinates
// are nonnegative, so bounding 2 * coordinate^2 by MAX_SAFE_INTEGER keeps every
// two-product 2D determinant exact instead of trusting rounded orientation math.
const CLIPPER_MAX_COORDINATE = Math.floor(
  Math.sqrt(Number.MAX_SAFE_INTEGER / 2),
);
const CLIPPER_TARGET_SCALE = 1_000_000;

export function pointsEqual(left: Point, right: Point): boolean {
  return (
    Math.abs(left.x - right.x) <= EPSILON &&
    Math.abs(left.y - right.y) <= EPSILON
  );
}

export function withoutClosingPoint(
  points: readonly Point[],
): readonly Point[] {
  if (
    points.length > 1 &&
    pointsEqual(points[0] ?? { x: 0, y: 0 }, points.at(-1) ?? { x: 1, y: 1 })
  ) {
    return points.slice(0, -1);
  }
  return points;
}

export function closePoints(points: readonly Point[]): readonly Point[] {
  const open = withoutClosingPoint(points);
  const first = open[0];
  return first ? [...open, first] : [];
}

export function signedArea(points: readonly Point[]): number {
  const open = withoutClosingPoint(points);
  let area = 0;
  for (let index = 0; index < open.length; index += 1) {
    const current = open[index];
    const next = open[(index + 1) % open.length];
    if (current && next) {
      area += current.x * next.y - next.x * current.y;
    }
  }
  return area / 2;
}

export function pointInPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  const open = withoutClosingPoint(polygon);
  let inside = false;
  for (
    let index = 0, previousIndex = open.length - 1;
    index < open.length;
    previousIndex = index, index += 1
  ) {
    const current = open[index];
    const previous = open[previousIndex];
    if (!current || !previous) {
      continue;
    }
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function crossProduct(first: Point, second: Point, third: Point): number {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  return (
    Math.abs(crossProduct(start, end, point)) <= EPSILON &&
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  );
}

function segmentsIntersect(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): boolean {
  const firstSideStart = crossProduct(firstStart, firstEnd, secondStart);
  const firstSideEnd = crossProduct(firstStart, firstEnd, secondEnd);
  const secondSideStart = crossProduct(secondStart, secondEnd, firstStart);
  const secondSideEnd = crossProduct(secondStart, secondEnd, firstEnd);
  if (
    firstSideStart * firstSideEnd < -EPSILON &&
    secondSideStart * secondSideEnd < -EPSILON
  ) {
    return true;
  }
  return (
    pointOnSegment(secondStart, firstStart, firstEnd) ||
    pointOnSegment(secondEnd, firstStart, firstEnd) ||
    pointOnSegment(firstStart, secondStart, secondEnd) ||
    pointOnSegment(firstEnd, secondStart, secondEnd)
  );
}

interface RingSegment {
  readonly end: Point;
  readonly index: number;
  readonly ringIndex: number;
  readonly ringLength: number;
  readonly start: Point;
}

function ringSegments(
  ring: readonly Point[],
  ringIndex: number,
): readonly RingSegment[] {
  const open = withoutClosingPoint(ring);
  return open.flatMap((start, index) => {
    const end = open[(index + 1) % open.length];
    return end
      ? [{ start, end, index, ringIndex, ringLength: open.length }]
      : [];
  });
}

function segmentsAreAdjacent(left: RingSegment, right: RingSegment): boolean {
  if (left.ringIndex !== right.ringIndex) {
    return false;
  }
  const difference = Math.abs(left.index - right.index);
  return difference === 1 || difference === left.ringLength - 1;
}

/** Returns false for crossing, touching, or self-intersecting contours. */
export function contoursAreNestedOrDisjoint(
  rings: readonly (readonly Point[])[],
): boolean {
  const segments = rings.flatMap(ringSegments);
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex];
    if (!left) {
      continue;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segments.length;
      rightIndex += 1
    ) {
      const right = segments[rightIndex];
      if (
        right &&
        !segmentsAreAdjacent(left, right) &&
        segmentsIntersect(left.start, left.end, right.start, right.end)
      ) {
        return false;
      }
    }
  }
  return true;
}

function comparePoints(left: Point, right: Point): number {
  return left.x - right.x || left.y - right.y;
}

function canonicalRing(points: readonly Point[]): readonly Point[] {
  const open = withoutClosingPoint(points);
  if (open.length === 0) {
    return [];
  }
  let firstIndex = 0;
  for (let index = 1; index < open.length; index += 1) {
    const point = open[index];
    const first = open[firstIndex];
    if (point && first && comparePoints(point, first) < 0) {
      firstIndex = index;
    }
  }
  return cycleFrom(open, firstIndex);
}

function compareRings(left: readonly Point[], right: readonly Point[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftPoint = left[index];
    const rightPoint = right[index];
    if (leftPoint && rightPoint) {
      const comparison = comparePoints(leftPoint, rightPoint);
      if (comparison !== 0) {
        return comparison;
      }
    }
  }
  return left.length - right.length;
}

interface ClipperTransform {
  readonly maximumScale: number;
  readonly origin: Point;
  readonly scale: number;
}

function clipperTransform(
  rings: readonly (readonly Point[])[],
): ClipperTransform | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const point of ring) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return null;
      }
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (minX === Number.POSITIVE_INFINITY) {
    return {
      maximumScale: CLIPPER_TARGET_SCALE,
      origin: { x: 0, y: 0 },
      scale: CLIPPER_TARGET_SCALE,
    };
  }
  const maximumSpan = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(maximumSpan)) {
    return null;
  }
  if (maximumSpan === 0) {
    return {
      maximumScale: CLIPPER_TARGET_SCALE,
      origin: { x: minX, y: minY },
      scale: CLIPPER_TARGET_SCALE,
    };
  }
  const safeScale = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.floor(CLIPPER_MAX_COORDINATE / maximumSpan),
  );
  const scale = Math.min(CLIPPER_TARGET_SCALE, safeScale);
  return scale >= 1
    ? {
        maximumScale: safeScale,
        origin: { x: minX, y: minY },
        scale,
      }
    : null;
}

interface QuantizedRing {
  readonly local: readonly Point[];
  readonly path: ClipperLib.Path;
}

function quantizedRing(
  ring: readonly Point[],
  transform: ClipperTransform,
): QuantizedRing | null {
  const path: ClipperLib.Path = [];
  const local: Point[] = [];
  const sourceByIntegerPoint = new Map<string, Point>();
  for (const point of withoutClosingPoint(ring)) {
    const localPoint = {
      x: point.x - transform.origin.x,
      y: point.y - transform.origin.y,
    };
    const candidate = {
      X: Math.round(localPoint.x * transform.scale),
      Y: Math.round(localPoint.y * transform.scale),
    };
    const key = `${candidate.X},${candidate.Y}`;
    const priorSource = sourceByIntegerPoint.get(key);
    if (priorSource && !pointsEqual(priorSource, localPoint)) {
      return null;
    }
    sourceByIntegerPoint.set(key, localPoint);

    const previousSource = local.at(-1);
    if (previousSource && pointsEqual(previousSource, localPoint)) {
      continue;
    }
    path.push(candidate);
    local.push(localPoint);
  }
  const firstSource = local[0];
  const lastSource = local.at(-1);
  if (firstSource && lastSource && pointsEqual(firstSource, lastSource)) {
    path.pop();
    local.pop();
  }
  return { local, path };
}

type SegmentIntersectionKind = "none" | "proper" | "touch";

function pointOnSegmentWithTolerance(
  point: Point,
  start: Point,
  end: Point,
  coordinateScale: number,
): boolean {
  const coordinateTolerance = EPSILON * coordinateScale;
  const crossTolerance = EPSILON * coordinateScale * coordinateScale;
  return (
    Math.abs(crossProduct(start, end, point)) <= crossTolerance &&
    point.x >= Math.min(start.x, end.x) - coordinateTolerance &&
    point.x <= Math.max(start.x, end.x) + coordinateTolerance &&
    point.y >= Math.min(start.y, end.y) - coordinateTolerance &&
    point.y <= Math.max(start.y, end.y) + coordinateTolerance
  );
}

function segmentIntersectionKind(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
  coordinateScale: number,
): SegmentIntersectionKind {
  const productTolerance = EPSILON * coordinateScale ** 4;
  const firstSideStart = crossProduct(firstStart, firstEnd, secondStart);
  const firstSideEnd = crossProduct(firstStart, firstEnd, secondEnd);
  const secondSideStart = crossProduct(secondStart, secondEnd, firstStart);
  const secondSideEnd = crossProduct(secondStart, secondEnd, firstEnd);
  if (
    firstSideStart * firstSideEnd < -productTolerance &&
    secondSideStart * secondSideEnd < -productTolerance
  ) {
    return "proper";
  }
  return pointOnSegmentWithTolerance(
    secondStart,
    firstStart,
    firstEnd,
    coordinateScale,
  ) ||
    pointOnSegmentWithTolerance(
      secondEnd,
      firstStart,
      firstEnd,
      coordinateScale,
    ) ||
    pointOnSegmentWithTolerance(
      firstStart,
      secondStart,
      secondEnd,
      coordinateScale,
    ) ||
    pointOnSegmentWithTolerance(
      firstEnd,
      secondStart,
      secondEnd,
      coordinateScale,
    )
    ? "touch"
    : "none";
}

function ringIsSimple(points: readonly Point[]): boolean {
  const segments = ringSegments(points, 0);
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex];
    if (!left) {
      return false;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segments.length;
      rightIndex += 1
    ) {
      const right = segments[rightIndex];
      if (
        right &&
        !segmentsAreAdjacent(left, right) &&
        segmentIntersectionKind(
          left.start,
          left.end,
          right.start,
          right.end,
          1,
        ) !== "none"
      ) {
        return false;
      }
    }
  }
  return true;
}

function quantizationPreservesTopology(
  rings: readonly QuantizedRing[],
  scale: number,
): boolean {
  for (const ring of rings) {
    const quantizedPoints = ring.path.map(({ X, Y }) => ({ x: X, y: Y }));
    if (
      ringIsSimple(ring.local) &&
      Math.sign(signedArea(ring.local)) !==
        Math.sign(signedArea(quantizedPoints))
    ) {
      return false;
    }
  }
  const sourceSegments = rings.flatMap((ring, ringIndex) =>
    ringSegments(ring.local, ringIndex),
  );
  const quantizedSegments = rings.flatMap((ring, ringIndex) =>
    ringSegments(
      ring.path.map(({ X, Y }) => ({ x: X, y: Y })),
      ringIndex,
    ),
  );
  if (sourceSegments.length !== quantizedSegments.length) {
    return false;
  }
  for (let leftIndex = 0; leftIndex < sourceSegments.length; leftIndex += 1) {
    const sourceLeft = sourceSegments[leftIndex];
    const quantizedLeft = quantizedSegments[leftIndex];
    if (!sourceLeft || !quantizedLeft) {
      return false;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < sourceSegments.length;
      rightIndex += 1
    ) {
      const sourceRight = sourceSegments[rightIndex];
      const quantizedRight = quantizedSegments[rightIndex];
      if (
        !sourceRight ||
        !quantizedRight ||
        segmentsAreAdjacent(sourceLeft, sourceRight)
      ) {
        continue;
      }
      const sourceIntersectionKind = segmentIntersectionKind(
        sourceLeft.start,
        sourceLeft.end,
        sourceRight.start,
        sourceRight.end,
        1,
      );
      const quantizedIntersectionKind = segmentIntersectionKind(
        quantizedLeft.start,
        quantizedLeft.end,
        quantizedRight.start,
        quantizedRight.end,
        scale,
      );
      if (sourceIntersectionKind !== quantizedIntersectionKind) {
        return false;
      }
    }
  }
  return true;
}

interface SafeQuantization {
  readonly rings: readonly QuantizedRing[];
  readonly transform: ClipperTransform;
}

function safeQuantization(
  rings: readonly (readonly Point[])[],
  initialTransform: ClipperTransform,
): SafeQuantization | null {
  let scale = initialTransform.scale;
  while (true) {
    const transform = { ...initialTransform, scale };
    const quantized: QuantizedRing[] = [];
    let verticesPreserved = true;
    for (const ring of rings) {
      const result = quantizedRing(ring, transform);
      if (result === null) {
        verticesPreserved = false;
        break;
      }
      quantized.push(result);
    }
    if (
      verticesPreserved &&
      quantizationPreservesTopology(quantized, transform.scale)
    ) {
      return { rings: quantized, transform };
    }
    if (scale === initialTransform.maximumScale) {
      return null;
    }
    scale = Math.min(initialTransform.maximumScale, scale * 10);
  }
}

interface ValidationRegion {
  readonly holes: readonly (readonly Point[])[];
  readonly outer: readonly Point[];
}

function pointsInIntegerPath(path: ClipperLib.Path): readonly Point[] {
  return path.map(({ X, Y }) => ({ x: X, y: Y }));
}

function windingNumber(point: Point, ring: readonly Point[]): number {
  const open = withoutClosingPoint(ring);
  let winding = 0;
  for (let index = 0; index < open.length; index += 1) {
    const start = open[index];
    const end = open[(index + 1) % open.length];
    if (!start || !end) {
      continue;
    }
    if (
      start.y <= point.y &&
      end.y > point.y &&
      crossProduct(start, end, point) > 0
    ) {
      winding += 1;
    } else if (
      start.y > point.y &&
      end.y <= point.y &&
      crossProduct(start, end, point) < 0
    ) {
      winding -= 1;
    }
  }
  return winding;
}

function sourceWindingAtPoint(
  point: Point,
  rings: readonly (readonly Point[])[],
): number {
  return rings.reduce((sum, ring) => sum + windingNumber(point, ring), 0);
}

function outputContainsPoint(
  point: Point,
  regions: readonly ValidationRegion[],
): boolean {
  return regions.some(
    ({ holes, outer }) =>
      pointInPolygon(point, outer) &&
      holes.every((hole) => !pointInPolygon(point, hole)),
  );
}

function pointToSegmentDistance(point: Point, segment: RingSegment): number {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - segment.start.x, point.y - segment.start.y);
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (segment.start.x + projection * dx),
    point.y - (segment.start.y + projection * dy),
  );
}

function segmentIntersectionParameters(
  segment: RingSegment,
  candidate: RingSegment,
): readonly number[] {
  const segmentDx = segment.end.x - segment.start.x;
  const segmentDy = segment.end.y - segment.start.y;
  const candidateDx = candidate.end.x - candidate.start.x;
  const candidateDy = candidate.end.y - candidate.start.y;
  const offsetX = candidate.start.x - segment.start.x;
  const offsetY = candidate.start.y - segment.start.y;
  const determinant = segmentDx * candidateDy - segmentDy * candidateDx;
  if (determinant !== 0) {
    const segmentParameter =
      (offsetX * candidateDy - offsetY * candidateDx) / determinant;
    const candidateParameter =
      (offsetX * segmentDy - offsetY * segmentDx) / determinant;
    return segmentParameter >= 0 &&
      segmentParameter <= 1 &&
      candidateParameter >= 0 &&
      candidateParameter <= 1
      ? [segmentParameter]
      : [];
  }
  if (offsetX * segmentDy - offsetY * segmentDx !== 0) {
    return [];
  }

  const useX = Math.abs(segmentDx) >= Math.abs(segmentDy);
  const denominator = useX ? segmentDx : segmentDy;
  if (denominator === 0) {
    return [];
  }
  return [candidate.start, candidate.end].flatMap((point) => {
    const parameter =
      ((useX ? point.x : point.y) -
        (useX ? segment.start.x : segment.start.y)) /
      denominator;
    return parameter > 0 && parameter < 1 ? [parameter] : [];
  });
}

function uniqueSortedParameters(
  parameters: readonly number[],
): readonly number[] {
  const sorted = [...parameters].sort((left, right) => left - right);
  const unique: number[] = [];
  for (const parameter of sorted) {
    const previous = unique.at(-1);
    const tolerance =
      Number.EPSILON *
      8 *
      Math.max(1, Math.abs(parameter), Math.abs(previous ?? 0));
    if (previous === undefined || Math.abs(parameter - previous) > tolerance) {
      unique.push(parameter);
    }
  }
  return unique;
}

/**
 * Clipper can report success while silently omitting narrow nonzero regions.
 * Split every source boundary at its arrangement intersections and probe both
 * sides of every open span. Result coverage must agree independently at both
 * probes, including where the source winding is zero. A broad cell therefore
 * cannot provide evidence for a thin filled lobe or hole elsewhere in the same
 * contour. This catches missing contours, partial regions, and dropped holes
 * without trusting the library's success flag or a coordinate limit alone.
 */
function decompositionPreservesFill(
  rings: readonly QuantizedRing[],
  polygons: readonly ClipperLib.ExPolygon[],
): boolean {
  const sourceRings = rings.map(({ path }) => pointsInIntegerPath(path));
  const outputRegions = polygons.map(({ holes, outer }) => ({
    holes: holes.map(pointsInIntegerPath),
    outer: pointsInIntegerPath(outer),
  }));
  const sourceBoundaries = sourceRings.flatMap(ringSegments);
  const boundaries = sourceBoundaries.filter(
    ({ end, start }) => start.x !== end.x || start.y !== end.y,
  );

  for (const boundary of boundaries) {
    const parameters = uniqueSortedParameters([
      0,
      1,
      ...boundaries.flatMap((candidate) =>
        candidate === boundary
          ? []
          : segmentIntersectionParameters(boundary, candidate),
      ),
    ]);
    const dx = boundary.end.x - boundary.start.x;
    const dy = boundary.end.y - boundary.start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      continue;
    }
    for (let index = 0; index + 1 < parameters.length; index += 1) {
      const startParameter = parameters[index];
      const endParameter = parameters[index + 1];
      if (startParameter === undefined || endParameter === undefined) {
        return false;
      }
      const parameter = (startParameter + endParameter) / 2;
      const midpoint = {
        x: boundary.start.x + dx * parameter,
        y: boundary.start.y + dy * parameter,
      };
      const coordinateResolution =
        Number.EPSILON *
        16 *
        Math.max(1, Math.abs(midpoint.x), Math.abs(midpoint.y));
      let clearance = Number.POSITIVE_INFINITY;
      for (const candidate of boundaries) {
        const distance = pointToSegmentDistance(midpoint, candidate);
        if (distance > coordinateResolution) {
          clearance = Math.min(clearance, distance);
        }
      }
      // Clipper rounds calculated intersections to integer coordinates. Probe
      // one integer unit into each arrangement cell when there is room, while
      // narrow source cells retain a proportionally smaller survival probe.
      const offset = Math.min(
        1,
        Number.isFinite(clearance) ? clearance / 4 : 1,
      );
      if (offset <= coordinateResolution) {
        return false;
      }
      const normal = {
        x: (-dy / length) * offset,
        y: (dx / length) * offset,
      };
      for (const probe of [
        { x: midpoint.x + normal.x, y: midpoint.y + normal.y },
        { x: midpoint.x - normal.x, y: midpoint.y - normal.y },
      ]) {
        const sourceWinding = sourceWindingAtPoint(probe, sourceRings);
        if (
          (sourceWinding !== 0) !==
          outputContainsPoint(probe, outputRegions)
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

function pointsFromClipper(
  points: ClipperLib.Path,
  transform: ClipperTransform,
): readonly Point[] | null {
  const translated: Point[] = [];
  const seen = new Set<string>();
  for (const point of points) {
    const x = transform.origin.x + point.X / transform.scale;
    const y = transform.origin.y + point.Y / transform.scale;
    const key = `${x},${y}`;
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
    translated.push({
      x: Object.is(x, -0) ? 0 : x,
      y: Object.is(y, -0) ? 0 : y,
    });
  }
  return translated;
}

function regionFromClipper(
  polygon: ClipperLib.ExPolygon,
  transform: ClipperTransform,
): FilledRegion | null {
  const outer = pointsFromClipper(polygon.outer, transform);
  if (!outer || outer.length < 3) {
    return null;
  }
  const holes: (readonly Point[])[] = [];
  for (const hole of polygon.holes) {
    const translated = pointsFromClipper(hole, transform);
    if (!translated || translated.length < 3) {
      return null;
    }
    holes.push(canonicalRing(translated));
  }
  return {
    outer: canonicalRing(outer),
    holes: holes.sort(compareRings),
  };
}

/**
 * Resolves arbitrary nonzero winding into deterministic, nested-or-disjoint
 * filled regions. Clipper performs a planar union with the SVG nonzero fill
 * rule; the resulting PolyTree retains holes for the keyhole representation.
 * A null result means integer-safe decomposition was not possible.
 */
export function decomposeNonzeroRings(
  rings: readonly (readonly Point[])[],
): readonly FilledRegion[] | null {
  const transform = clipperTransform(rings);
  if (transform === null) {
    return null;
  }

  try {
    const quantization = safeQuantization(rings, transform);
    if (quantization === null) {
      return null;
    }

    const clipper = new ClipperLib.Clipper();
    clipper.StrictlySimple = true;
    clipper.PreserveCollinear = true;
    let pathsAdded = 0;
    for (const { path } of quantization.rings) {
      if (path.length < 3) {
        continue;
      }
      if (clipper.AddPath(path, ClipperLib.PolyType.ptSubject, true)) {
        pathsAdded += 1;
      }
      // For a closed path AddPath returns false only after its own duplicate,
      // collinear-spike, and flat-path cleanup proves that the ring encloses no
      // area. Ignoring that zero-area ring preserves SVG fill semantics; range
      // errors still throw into the fail-closed catch below.
    }
    const solution = new ClipperLib.PolyTree();
    if (pathsAdded > 0) {
      const succeeded = clipper.Execute(
        ClipperLib.ClipType.ctUnion,
        solution,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero,
      );
      if (!succeeded) {
        return null;
      }
    }

    const polygons = ClipperLib.JS.PolyTreeToExPolygons(solution);
    if (!decompositionPreservesFill(quantization.rings, polygons)) {
      return null;
    }

    const regions: FilledRegion[] = [];
    for (const polygon of polygons) {
      const region = regionFromClipper(polygon, quantization.transform);
      if (region === null) {
        return null;
      }
      regions.push(region);
    }
    return regions.sort((left, right) => compareRings(left.outer, right.outer));
  } catch {
    return null;
  }
}

export function regionsFromEvenOddRings(
  rings: readonly (readonly Point[])[],
): readonly FilledRegion[] {
  return regionsFromRings(rings, "evenodd");
}

interface RingNode {
  readonly area: number;
  readonly parentIndex: number | null;
  readonly ring: readonly Point[];
}

function ringNodes(rings: readonly (readonly Point[])[]): readonly RingNode[] {
  const validRings = rings
    .map(withoutClosingPoint)
    .filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > EPSILON);
  return validRings.map((ring, ringIndex) => {
    const area = signedArea(ring);
    const probe = ring[0];
    const parentIndex = probe
      ? (validRings
          .map((candidate, candidateIndex) => ({
            candidateIndex,
            area: Math.abs(signedArea(candidate)),
            contains:
              candidateIndex !== ringIndex &&
              Math.abs(signedArea(candidate)) > Math.abs(area) + EPSILON &&
              pointInPolygon(probe, candidate),
          }))
          .filter((candidate) => candidate.contains)
          .sort((left, right) => left.area - right.area)[0]?.candidateIndex ??
        null)
      : null;
    return { area, parentIndex, ring };
  });
}

function ancestorIndices(
  nodes: readonly RingNode[],
  nodeIndex: number,
): readonly number[] {
  const ancestors: number[] = [];
  let parentIndex = nodes[nodeIndex]?.parentIndex ?? null;
  while (parentIndex !== null) {
    ancestors.push(parentIndex);
    parentIndex = nodes[parentIndex]?.parentIndex ?? null;
  }
  return ancestors;
}

/**
 * Classifies non-intersecting, nested or disjoint SVG contours according to
 * the requested fill rule. Under nonzero, a nested contour is a hole only when
 * its winding changes the accumulated winding from nonzero to zero.
 */
export function regionsFromRings(
  rings: readonly (readonly Point[])[],
  fillRule: "evenodd" | "nonzero",
): readonly FilledRegion[] {
  const nodes = ringNodes(rings);
  const boundaries = nodes.map((node, nodeIndex) => {
    const ancestors = ancestorIndices(nodes, nodeIndex);
    const outsideWinding = ancestors.reduce(
      (winding, ancestorIndex) =>
        winding + Math.sign(nodes[ancestorIndex]?.area ?? 0),
      0,
    );
    const insideWinding = outsideWinding + Math.sign(node.area);
    const outsideFilled =
      fillRule === "evenodd"
        ? ancestors.length % 2 !== 0
        : outsideWinding !== 0;
    const insideFilled =
      fillRule === "evenodd"
        ? (ancestors.length + 1) % 2 !== 0
        : insideWinding !== 0;
    return {
      kind:
        outsideFilled === insideFilled
          ? "none"
          : insideFilled
            ? "outer"
            : "hole",
      nodeIndex,
    } as const;
  });

  return boundaries.flatMap((boundary) => {
    if (boundary.kind !== "outer") {
      return [];
    }
    const holes = boundaries.flatMap((candidate) => {
      if (candidate.kind !== "hole") {
        return [];
      }
      const nearestOuter = ancestorIndices(nodes, candidate.nodeIndex).find(
        (ancestorIndex) => boundaries[ancestorIndex]?.kind === "outer",
      );
      return nearestOuter === boundary.nodeIndex
        ? [nodes[candidate.nodeIndex]?.ring ?? []]
        : [];
    });
    const outer = nodes[boundary.nodeIndex]?.ring;
    return outer ? [{ outer, holes }] : [];
  });
}

function squaredDistance(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function cycleFrom(
  points: readonly Point[],
  startIndex: number,
): readonly Point[] {
  return points
    .map((_, offset) => points[(startIndex + offset) % points.length])
    .filter((point): point is Point => point !== undefined);
}

interface KeyholeBridgeResult {
  readonly bridges: readonly (readonly [Point, Point])[];
  readonly points: readonly Point[];
}

function constructKeyholeBridge(region: FilledRegion): KeyholeBridgeResult {
  let combined = [...withoutClosingPoint(region.outer)];
  const bridges: [Point, Point][] = [];
  const outerOrientation = Math.sign(signedArea(combined)) || 1;

  for (const rawHole of region.holes) {
    const openHole = [...withoutClosingPoint(rawHole)];
    const hole =
      (Math.sign(signedArea(openHole)) || -outerOrientation) ===
      outerOrientation
        ? openHole.reverse()
        : openHole;
    let combinedIndex = 0;
    let holeIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let leftIndex = 0; leftIndex < combined.length; leftIndex += 1) {
      const left = combined[leftIndex];
      if (!left) {
        continue;
      }
      for (let rightIndex = 0; rightIndex < hole.length; rightIndex += 1) {
        const right = hole[rightIndex];
        if (!right) {
          continue;
        }
        const distance = squaredDistance(left, right);
        if (distance < closestDistance) {
          combinedIndex = leftIndex;
          holeIndex = rightIndex;
          closestDistance = distance;
        }
      }
    }
    const outerBridge = combined[combinedIndex];
    const holeCycle = cycleFrom(hole, holeIndex);
    const holeBridge = holeCycle[0];
    if (!outerBridge || !holeBridge) {
      continue;
    }
    bridges.push([outerBridge, holeBridge]);
    combined = [
      ...combined.slice(0, combinedIndex + 1),
      holeBridge,
      ...holeCycle.slice(1),
      holeBridge,
      outerBridge,
      ...combined.slice(combinedIndex + 1),
    ];
  }
  return { bridges, points: closePoints(combined) };
}

/**
 * Verifies that every zero-width bridge stays in the filled region and crosses
 * neither source boundaries nor another bridge. This keeps keyholes fail-closed
 * for concave or multi-hole regions where nearest-vertex bridging is unsafe.
 */
export function keyholeBridgeIsSafe(region: FilledRegion): boolean {
  const result = constructKeyholeBridge(region);
  if (result.bridges.length !== region.holes.length) {
    return false;
  }
  const boundaries = [region.outer, ...region.holes].flatMap(ringSegments);
  for (
    let bridgeIndex = 0;
    bridgeIndex < result.bridges.length;
    bridgeIndex += 1
  ) {
    const bridge = result.bridges[bridgeIndex];
    if (!bridge) {
      return false;
    }
    const [start, end] = bridge;
    for (const fraction of [0.25, 0.5, 0.75]) {
      const sample = {
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      };
      if (
        !pointInPolygon(sample, region.outer) ||
        region.holes.some((hole) => pointInPolygon(sample, hole))
      ) {
        return false;
      }
    }
    for (const boundary of boundaries) {
      if (
        segmentsIntersect(start, end, boundary.start, boundary.end) &&
        !pointsEqual(start, boundary.start) &&
        !pointsEqual(start, boundary.end) &&
        !pointsEqual(end, boundary.start) &&
        !pointsEqual(end, boundary.end)
      ) {
        return false;
      }
    }
    for (const previous of result.bridges.slice(0, bridgeIndex)) {
      if (
        segmentsIntersect(start, end, previous[0], previous[1]) &&
        !pointsEqual(start, previous[0]) &&
        !pointsEqual(start, previous[1]) &&
        !pointsEqual(end, previous[0]) &&
        !pointsEqual(end, previous[1])
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Produces one self-touching polygon with zero-width bridge slits. The bridge
 * edges are intentionally traversed in both directions; no background-colored
 * overlay is involved. Callers must verify `keyholeBridgeIsSafe` first.
 */
export function keyholeBridge(region: FilledRegion): readonly Point[] {
  return constructKeyholeBridge(region).points;
}

/**
 * Eliminates interior rings by triangulating the filled region. Every returned
 * polygon is a simple closed triangle, so the hole does not depend on any
 * renderer fill rule.
 */
export function triangulateRegion(
  region: FilledRegion,
): readonly (readonly Point[])[] {
  const rings = [region.outer, ...region.holes].map(withoutClosingPoint);
  const vertices = rings.flat();
  const coordinates = vertices.flatMap((point) => [point.x, point.y]);
  const holeIndices: number[] = [];
  let cursor = rings[0]?.length ?? 0;
  for (const hole of rings.slice(1)) {
    holeIndices.push(cursor);
    cursor += hole.length;
  }
  const indices = earcut(coordinates, holeIndices, 2);
  const triangles: Point[][] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const first = vertices[indices[index] ?? -1];
    const second = vertices[indices[index + 1] ?? -1];
    const third = vertices[indices[index + 2] ?? -1];
    if (first && second && third) {
      triangles.push([first, second, third, first]);
    }
  }
  return triangles;
}

export function centroid(points: readonly Point[]): Point {
  const open = withoutClosingPoint(points);
  const total = open.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  const divisor = Math.max(1, open.length);
  return { x: total.x / divisor, y: total.y / divisor };
}
