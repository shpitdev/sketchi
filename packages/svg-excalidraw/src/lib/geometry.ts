import earcut from "earcut";

import type { FilledRegion, Point } from "./types";

const EPSILON = 1e-7;

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
