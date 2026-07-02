import {
  type DiagramEdge,
  type DiagramNode,
  type IntermediateDiagram,
  parseIntermediateDiagram,
} from "@sketchi/diagram-core";

export type NodeSceneShape = "rectangle" | "ellipse" | "diamond" | "circle";

export type SceneElement =
  | NodeSceneElement
  | TextSceneElement
  | ArrowSceneElement;

export interface NodeSceneElement {
  type: "node";
  id: string;
  nodeId: string;
  kind?: string;
  shape: NodeSceneShape;
  fillColor?: string;
  strokeColor?: string;
  textColor?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface TextSceneElement {
  type: "text";
  id: string;
  containerId?: string;
  textColor?: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  maxWidth?: number;
}

export interface ArrowSceneElement {
  type: "arrow";
  id: string;
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  strokeColor?: string;
  textColor?: string;
  points: readonly [ScenePoint, ...ScenePoint[]];
  label?: string;
}

export interface ScenePoint {
  x: number;
  y: number;
}

export interface RenderedDiagramScene {
  diagramId: string;
  title: string;
  width: number;
  height: number;
  accentColor: string;
  backgroundColor: string;
  elements: SceneElement[];
}

const MIN_NODE_WIDTH = 184;
const MIN_NODE_HEIGHT = 72;
const HORIZONTAL_GAP = 112;
const VERTICAL_GAP = 96;
const PADDING = 48;
const NODE_LABEL_FONT_SIZE = 14;
const NODE_LABEL_WIDTH_FACTOR = 0.62;
const NODE_LABEL_LINE_HEIGHT = 1.35;
const NODE_LABEL_HORIZONTAL_PADDING = 36;
const NODE_LABEL_VERTICAL_PADDING = 28;
const MAX_LABEL_CHARS_PER_LINE = 18;
const PORT_SPACING = 18;
const PORT_PADDING = 16;
const RANK_SWEEP_COUNT = 4;
const ROUTE_STUB_LENGTH = 36;

type ConnectionEdge = "top" | "right" | "bottom" | "left";

interface RoutedEdge {
  edge: DiagramEdge;
  index: number;
  source: NodeSceneElement;
  sourceEdge: ConnectionEdge;
  target: NodeSceneElement;
  targetEdge: ConnectionEdge;
}

interface EdgeBuckets {
  incoming: Map<string, DiagramEdge[]>;
  outgoing: Map<string, DiagramEdge[]>;
}

type VisitState = "visited" | "visiting";

function splitLongWord(word: string, maxChars: number): string[] {
  if (word.length <= maxChars) {
    return [word];
  }

  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxChars) {
    chunks.push(word.slice(index, index + maxChars));
  }
  return chunks;
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) {
    return [line];
  }

  const wrapped: string[] = [];
  let current = "";

  for (const word of line.split(" ")) {
    if (word.length > maxChars) {
      if (current) {
        wrapped.push(current);
        current = "";
      }
      wrapped.push(...splitLongWord(word, maxChars));
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    wrapped.push(current);
    current = word;
  }

  if (current) {
    wrapped.push(current);
  }

  return wrapped;
}

function wrapLabel(label: string): string {
  return label
    .split("\n")
    .flatMap((line) => wrapLine(line, MAX_LABEL_CHARS_PER_LINE))
    .join("\n");
}

function measureLabel(label: string): {
  height: number;
  text: string;
  width: number;
} {
  const text = wrapLabel(label);
  const lines = text.split("\n");
  const longestLineLength = Math.max(...lines.map((line) => line.length));
  const width = Math.ceil(
    longestLineLength * NODE_LABEL_FONT_SIZE * NODE_LABEL_WIDTH_FACTOR +
      NODE_LABEL_HORIZONTAL_PADDING,
  );
  const height = Math.ceil(
    lines.length * NODE_LABEL_FONT_SIZE * NODE_LABEL_LINE_HEIGHT +
      NODE_LABEL_VERTICAL_PADDING,
  );

  return { text, width, height };
}

function shapeForNode(node: DiagramNode): NodeSceneShape {
  const kind = node.kind?.toLowerCase();
  if (kind === "start" || kind === "end") {
    return "ellipse";
  }
  if (kind === "decision") {
    return "diamond";
  }
  return "rectangle";
}

function createNodeShape(node: DiagramNode): NodeSceneElement {
  const labelMetrics = measureLabel(node.label);
  const shape = shapeForNode(node);
  const shapeWidthPad = shape === "diamond" ? 32 : shape === "ellipse" ? 20 : 0;
  const shapeHeightPad = shape === "diamond" ? 32 : 0;

  return {
    type: "node",
    id: `node:${node.id}`,
    nodeId: node.id,
    ...(node.kind ? { kind: node.kind } : {}),
    shape,
    x: 0,
    y: 0,
    width: Math.max(MIN_NODE_WIDTH, labelMetrics.width + shapeWidthPad),
    height: Math.max(MIN_NODE_HEIGHT, labelMetrics.height + shapeHeightPad),
    label: labelMetrics.text,
  };
}

function edgeBuckets(edges: readonly DiagramEdge[]): EdgeBuckets {
  const incoming = new Map<string, DiagramEdge[]>();
  const outgoing = new Map<string, DiagramEdge[]>();

  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }

  return { incoming, outgoing };
}

function nodeOrderMap(nodes: readonly DiagramNode[]): Map<string, number> {
  return new Map(nodes.map((node, index) => [node.id, index]));
}

function startNodeForDiagram(
  diagram: IntermediateDiagram,
  incoming: ReadonlyMap<string, readonly DiagramEdge[]>,
): DiagramNode | undefined {
  const startNode =
    diagram.nodes.find((node) => (incoming.get(node.id) ?? []).length === 0) ??
    diagram.nodes[0];

  return startNode;
}

function feedbackEdgeIds(
  diagram: IntermediateDiagram,
  incoming: ReadonlyMap<string, readonly DiagramEdge[]>,
  outgoing: ReadonlyMap<string, readonly DiagramEdge[]>,
): Set<string> {
  const states = new Map<string, VisitState>();
  const feedbackEdges = new Set<string>();

  function visit(nodeId: string): void {
    states.set(nodeId, "visiting");

    for (const edge of outgoing.get(nodeId) ?? []) {
      const state = states.get(edge.target);

      if (state === "visiting") {
        feedbackEdges.add(edge.id);
        continue;
      }

      if (!state) {
        visit(edge.target);
      }
    }

    states.set(nodeId, "visited");
  }

  const startNode = startNodeForDiagram(diagram, incoming);
  if (startNode) {
    visit(startNode.id);
  }

  for (const node of diagram.nodes) {
    if (!states.has(node.id)) {
      visit(node.id);
    }
  }

  return feedbackEdges;
}

function insertByNodeOrder(
  queue: string[],
  nodeId: string,
  nodeOrder: ReadonlyMap<string, number>,
): void {
  const order = nodeOrder.get(nodeId) ?? Number.MAX_SAFE_INTEGER;
  const insertionIndex = queue.findIndex(
    (queuedNodeId) =>
      (nodeOrder.get(queuedNodeId) ?? Number.MAX_SAFE_INTEGER) > order,
  );

  if (insertionIndex === -1) {
    queue.push(nodeId);
    return;
  }

  queue.splice(insertionIndex, 0, nodeId);
}

function rankNodes(
  diagram: IntermediateDiagram,
  buckets: EdgeBuckets,
  feedbackEdges: ReadonlySet<string>,
): Map<string, number> {
  const nodeOrder = nodeOrderMap(diagram.nodes);
  const incomingCount = new Map(diagram.nodes.map((node) => [node.id, 0]));
  const rankByNodeId = new Map(diagram.nodes.map((node) => [node.id, 0]));

  for (const edge of diagram.edges) {
    if (feedbackEdges.has(edge.id)) {
      continue;
    }

    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const node of diagram.nodes) {
    if ((incomingCount.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
    }
  }

  const processed = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    if (!nodeId || processed.has(nodeId)) {
      continue;
    }

    processed.add(nodeId);
    const sourceRank = rankByNodeId.get(nodeId) ?? 0;

    for (const edge of buckets.outgoing.get(nodeId) ?? []) {
      if (feedbackEdges.has(edge.id)) {
        continue;
      }

      rankByNodeId.set(
        edge.target,
        Math.max(rankByNodeId.get(edge.target) ?? 0, sourceRank + 1),
      );
      const nextIncomingCount = (incomingCount.get(edge.target) ?? 0) - 1;
      incomingCount.set(edge.target, nextIncomingCount);

      if (nextIncomingCount === 0) {
        insertByNodeOrder(queue, edge.target, nodeOrder);
      }
    }
  }

  for (const node of diagram.nodes) {
    if (processed.has(node.id)) {
      continue;
    }

    const predecessorRanks = (buckets.incoming.get(node.id) ?? [])
      .filter((edge) => !feedbackEdges.has(edge.id))
      .map((edge) => rankByNodeId.get(edge.source) ?? 0);
    rankByNodeId.set(
      node.id,
      predecessorRanks.length > 0 ? Math.max(...predecessorRanks) + 1 : 0,
    );
  }

  return rankByNodeId;
}

function orderedRankShapes(
  diagram: IntermediateDiagram,
  shapesByNodeId: ReadonlyMap<string, NodeSceneElement>,
  rankByNodeId: ReadonlyMap<string, number>,
  buckets: EdgeBuckets,
  feedbackEdges: ReadonlySet<string>,
): Map<number, NodeSceneElement[]> {
  const nodeOrder = nodeOrderMap(diagram.nodes);
  const rankedShapes = new Map<number, NodeSceneElement[]>();

  for (const node of diagram.nodes) {
    const rank = rankByNodeId.get(node.id) ?? 0;
    const shape = shapesByNodeId.get(node.id);
    if (shape) {
      rankedShapes.set(rank, [...(rankedShapes.get(rank) ?? []), shape]);
    }
  }

  for (let sweep = 0; sweep < RANK_SWEEP_COUNT; sweep += 1) {
    const ranks = Array.from(rankedShapes.keys()).sort(
      (left, right) => left - right,
    );

    for (const rank of ranks) {
      const shapes = rankedShapes.get(rank);
      if (!shapes || shapes.length < 2) {
        continue;
      }

      const previousOrder = new Map<string, number>();
      const previousRankShapes = rankedShapes.get(rank - 1) ?? [];
      previousRankShapes.forEach((shape, index) => {
        previousOrder.set(shape.nodeId, index);
      });

      const nextOrder = new Map<string, number>();
      const nextRankShapes = rankedShapes.get(rank + 1) ?? [];
      nextRankShapes.forEach((shape, index) => {
        nextOrder.set(shape.nodeId, index);
      });

      const scoreForShape = (shape: NodeSceneElement): number => {
        const neighborScores = [
          ...(buckets.incoming.get(shape.nodeId) ?? [])
            .filter((edge) => !feedbackEdges.has(edge.id))
            .map((edge) => previousOrder.get(edge.source))
            .filter((score): score is number => score !== undefined),
          ...(buckets.outgoing.get(shape.nodeId) ?? [])
            .filter((edge) => !feedbackEdges.has(edge.id))
            .map((edge) => nextOrder.get(edge.target))
            .filter((score): score is number => score !== undefined),
        ];

        if (neighborScores.length === 0) {
          return nodeOrder.get(shape.nodeId) ?? Number.MAX_SAFE_INTEGER;
        }

        return (
          neighborScores.reduce((sum, score) => sum + score, 0) /
          neighborScores.length
        );
      };

      rankedShapes.set(
        rank,
        [...shapes].sort((left, right) => {
          const scoreDelta = scoreForShape(left) - scoreForShape(right);

          if (Math.abs(scoreDelta) > 0.001) {
            return scoreDelta;
          }

          return (
            (nodeOrder.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) -
            (nodeOrder.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER)
          );
        }),
      );
    }
  }

  return rankedShapes;
}

function positionNodes(diagram: IntermediateDiagram): NodeSceneElement[] {
  const vertical =
    diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
  const shapesByNodeId = new Map(
    diagram.nodes.map((node) => [node.id, createNodeShape(node)]),
  );
  const buckets = edgeBuckets(diagram.edges);
  const feedbackEdges = feedbackEdgeIds(
    diagram,
    buckets.incoming,
    buckets.outgoing,
  );
  const rankByNodeId = rankNodes(diagram, buckets, feedbackEdges);
  const rankedShapes = orderedRankShapes(
    diagram,
    shapesByNodeId,
    rankByNodeId,
    buckets,
    feedbackEdges,
  );
  const ranks = Array.from(rankedShapes.entries()).sort(
    ([left], [right]) => left - right,
  );
  const rankMetrics = ranks.map(([rank, shapes]) => {
    const breadth = shapes.reduce(
      (sum, shape, index) =>
        sum +
        (vertical ? shape.width : shape.height) +
        (index > 0 ? HORIZONTAL_GAP : 0),
      0,
    );
    const depth = Math.max(
      ...shapes.map((shape) => (vertical ? shape.height : shape.width)),
    );

    return { breadth, depth, rank, shapes };
  });
  const maxBreadth = Math.max(...rankMetrics.map((metric) => metric.breadth));
  let rankOffset = PADDING;
  const positioned: NodeSceneElement[] = [];

  for (const metric of rankMetrics) {
    let breadthOffset = PADDING + Math.max(0, maxBreadth - metric.breadth) / 2;

    for (const shape of metric.shapes) {
      if (vertical) {
        positioned.push({
          ...shape,
          x: breadthOffset,
          y: rankOffset + Math.max(0, metric.depth - shape.height) / 2,
        });
        breadthOffset += shape.width + HORIZONTAL_GAP;
      } else {
        positioned.push({
          ...shape,
          x: rankOffset + Math.max(0, metric.depth - shape.width) / 2,
          y: breadthOffset,
        });
        breadthOffset += shape.height + HORIZONTAL_GAP;
      }
    }

    rankOffset += metric.depth + VERTICAL_GAP;
  }

  if (diagram.layout.direction === "BT") {
    const totalHeight = Math.max(
      ...positioned.map((shape) => shape.y + shape.height),
    );
    return positioned.map((shape) => ({
      ...shape,
      y: PADDING + totalHeight - shape.y - shape.height,
    }));
  }

  if (diagram.layout.direction === "RL") {
    const totalWidth = Math.max(
      ...positioned.map((shape) => shape.x + shape.width),
    );
    return positioned.map((shape) => ({
      ...shape,
      x: PADDING + totalWidth - shape.x - shape.width,
    }));
  }

  return positioned;
}

function textForNode(shape: NodeSceneElement): TextSceneElement {
  return {
    type: "text",
    id: `label:${shape.nodeId}`,
    containerId: shape.id,
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2,
    text: shape.label,
    fontSize: NODE_LABEL_FONT_SIZE,
    maxWidth: Math.max(1, shape.width - NODE_LABEL_HORIZONTAL_PADDING),
  };
}

function center(shape: NodeSceneElement): ScenePoint {
  return {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2,
  };
}

function connectionEdges(
  source: NodeSceneElement,
  target: NodeSceneElement,
): {
  sourceEdge: ConnectionEdge;
  targetEdge: ConnectionEdge;
} {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const sourceKind = source.kind?.toLowerCase();

  if (dy < 0) {
    if (dx !== 0) {
      return {
        sourceEdge: dx > 0 ? "right" : "left",
        targetEdge: "bottom",
      };
    }

    return {
      sourceEdge: "top",
      targetEdge: "bottom",
    };
  }

  if (sourceKind === "decision" && dx !== 0 && dy > 0) {
    return {
      sourceEdge: dx > 0 ? "right" : "left",
      targetEdge: "top",
    };
  }

  if (dy > 0) {
    return { sourceEdge: "bottom", targetEdge: "top" };
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { sourceEdge: "right", targetEdge: "left" }
      : { sourceEdge: "left", targetEdge: "right" };
  }

  return dy > 0
    ? { sourceEdge: "bottom", targetEdge: "top" }
    : { sourceEdge: "top", targetEdge: "bottom" };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function constrainedPortOffset(
  shape: NodeSceneElement,
  edge: ConnectionEdge,
  offset: number,
) {
  const limit =
    edge === "top" || edge === "bottom"
      ? shape.width / 2 - PORT_PADDING
      : shape.height / 2 - PORT_PADDING;

  return limit > 0 ? clamp(offset, -limit, limit) : 0;
}

function pointOnEdge(
  shape: NodeSceneElement,
  edge: ConnectionEdge,
  portOffset = 0,
): ScenePoint {
  const offset = constrainedPortOffset(shape, edge, portOffset);

  switch (edge) {
    case "top":
      return { x: shape.x + shape.width / 2 + offset, y: shape.y };
    case "right":
      return {
        x: shape.x + shape.width,
        y: shape.y + shape.height / 2 + offset,
      };
    case "bottom":
      return {
        x: shape.x + shape.width / 2 + offset,
        y: shape.y + shape.height,
      };
    case "left":
      return { x: shape.x, y: shape.y + shape.height / 2 + offset };
  }
}

function connectionKey(input: {
  endpoint: "source" | "target";
  edgeId: string;
}): string {
  return `${input.edgeId}:${input.endpoint}`;
}

function portKey(nodeId: string, edge: ConnectionEdge): string {
  return `${nodeId}:${edge}`;
}

function portOffset(index: number, count: number): number {
  return (index - (count - 1) / 2) * PORT_SPACING;
}

function portOffsetsForRoutes(
  routes: readonly RoutedEdge[],
): Map<string, number> {
  const connectionsByPort = new Map<
    string,
    Array<{ edgeId: string; endpoint: "source" | "target" }>
  >();

  for (const route of routes) {
    const sourcePortKey = portKey(route.source.nodeId, route.sourceEdge);
    const targetPortKey = portKey(route.target.nodeId, route.targetEdge);

    connectionsByPort.set(sourcePortKey, [
      ...(connectionsByPort.get(sourcePortKey) ?? []),
      { edgeId: route.edge.id, endpoint: "source" },
    ]);
    connectionsByPort.set(targetPortKey, [
      ...(connectionsByPort.get(targetPortKey) ?? []),
      { edgeId: route.edge.id, endpoint: "target" },
    ]);
  }

  const offsets = new Map<string, number>();
  for (const connections of connectionsByPort.values()) {
    connections.forEach((connection, index) => {
      offsets.set(
        connectionKey(connection),
        portOffset(index, connections.length),
      );
    });
  }

  return offsets;
}

function routeForEdge(
  edge: DiagramEdge,
  index: number,
  shapesByNodeId: ReadonlyMap<string, NodeSceneElement>,
): RoutedEdge {
  const source = shapesByNodeId.get(edge.source);
  const target = shapesByNodeId.get(edge.target);

  if (!source || !target) {
    throw new Error(`Cannot render edge "${edge.id}" with unresolved nodes.`);
  }

  const { sourceEdge, targetEdge } = connectionEdges(source, target);

  return {
    edge,
    index,
    source,
    sourceEdge,
    target,
    targetEdge,
  };
}

function arrowForRoute(
  route: RoutedEdge,
  edgeRouting: IntermediateDiagram["layout"]["edgeRouting"],
  portOffsets: ReadonlyMap<string, number>,
  shapes: readonly NodeSceneElement[],
): ArrowSceneElement {
  const { edge, source, sourceEdge, target, targetEdge } = route;
  const portedStart = pointOnEdge(
    source,
    sourceEdge,
    portOffsets.get(connectionKey({ edgeId: edge.id, endpoint: "source" })) ??
      0,
  );
  const portedEnd = pointOnEdge(
    target,
    targetEdge,
    portOffsets.get(connectionKey({ edgeId: edge.id, endpoint: "target" })) ??
      0,
  );
  let points = compactPoints([portedStart, portedEnd]);

  if (center(target).y < center(source).y) {
    points = exteriorLaneRoute(route, portedStart, portedEnd, shapes);
  } else if (
    edgeRouting === "orthogonal" &&
    portedStart.x !== portedEnd.x &&
    portedStart.y !== portedEnd.y
  ) {
    const laneY = portedStart.y + (portedEnd.y - portedStart.y) / 2;
    const sideStubOffset = (route.index % 4) * PORT_SPACING;
    const startStub =
      sourceEdge === "left"
        ? {
            x: portedStart.x - ROUTE_STUB_LENGTH - sideStubOffset,
            y: portedStart.y,
          }
        : sourceEdge === "right"
          ? {
              x: portedStart.x + ROUTE_STUB_LENGTH + sideStubOffset,
              y: portedStart.y,
            }
          : portedStart;
    const endStub =
      targetEdge === "left"
        ? {
            x: portedEnd.x - ROUTE_STUB_LENGTH - sideStubOffset,
            y: portedEnd.y,
          }
        : targetEdge === "right"
          ? {
              x: portedEnd.x + ROUTE_STUB_LENGTH + sideStubOffset,
              y: portedEnd.y,
            }
          : portedEnd;
    const corners = [
      startStub,
      { x: startStub.x, y: laneY },
      { x: endStub.x, y: laneY },
      endStub,
    ];

    points = compactPoints([portedStart, ...corners, portedEnd]);
  }

  if (
    edgeRouting === "orthogonal" &&
    routeCrossesNode(points, shapes, new Set([source.nodeId, target.nodeId]))
  ) {
    points = exteriorLaneRoute(route, portedStart, portedEnd, shapes);
  }

  return {
    type: "arrow",
    id: `edge:${edge.id}`,
    edgeId: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    points,
    ...(edge.label ? { label: edge.label } : {}),
  };
}

function compactPoints(
  points: readonly ScenePoint[],
): [ScenePoint, ...ScenePoint[]] {
  const compacted: ScenePoint[] = [];

  for (const point of points) {
    const previous = compacted[compacted.length - 1];

    if (previous && previous.x === point.x && previous.y === point.y) {
      continue;
    }

    compacted.push(point);
  }

  const first = compacted[0];
  if (!first) {
    return [{ x: 0, y: 0 }];
  }

  return [first, ...compacted.slice(1)];
}

function betweenInterior(value: number, min: number, max: number): boolean {
  return value > min + 0.01 && value < max - 0.01;
}

function rangesOverlapInterior(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number,
): boolean {
  return Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin) > 0.01;
}

function segmentCrossesNode(
  start: ScenePoint,
  end: ScenePoint,
  shape: NodeSceneElement,
): boolean {
  if (start.y === end.y) {
    return (
      betweenInterior(start.y, shape.y, shape.y + shape.height) &&
      rangesOverlapInterior(
        Math.min(start.x, end.x),
        Math.max(start.x, end.x),
        shape.x,
        shape.x + shape.width,
      )
    );
  }

  if (start.x === end.x) {
    return (
      betweenInterior(start.x, shape.x, shape.x + shape.width) &&
      rangesOverlapInterior(
        Math.min(start.y, end.y),
        Math.max(start.y, end.y),
        shape.y,
        shape.y + shape.height,
      )
    );
  }

  return false;
}

function routeCrossesNode(
  points: readonly ScenePoint[],
  shapes: readonly NodeSceneElement[],
  ignoredNodeIds: ReadonlySet<string>,
): boolean {
  return routeNodeCrossingCount(points, shapes, ignoredNodeIds) > 0;
}

function routeNodeCrossingCount(
  points: readonly ScenePoint[],
  shapes: readonly NodeSceneElement[],
  ignoredNodeIds: ReadonlySet<string>,
): number {
  let crossingCount = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];

    if (!start || !end) {
      continue;
    }

    for (const shape of shapes) {
      if (
        !ignoredNodeIds.has(shape.nodeId) &&
        segmentCrossesNode(start, end, shape)
      ) {
        crossingCount += 1;
      }
    }
  }

  return crossingCount;
}

function routeLength(points: readonly ScenePoint[]): number {
  let length = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];

    if (!start || !end) {
      continue;
    }

    length += Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  }

  return length;
}

function chooseBestRoute(
  candidates: readonly [ScenePoint, ...ScenePoint[]][],
  shapes: readonly NodeSceneElement[],
  ignoredNodeIds: ReadonlySet<string>,
): [ScenePoint, ...ScenePoint[]] {
  const first = candidates[0];
  if (!first) {
    return [{ x: 0, y: 0 }];
  }

  return candidates.slice(1).reduce((best, candidate) => {
    const bestCrossingCount = routeNodeCrossingCount(
      best,
      shapes,
      ignoredNodeIds,
    );
    const candidateCrossingCount = routeNodeCrossingCount(
      candidate,
      shapes,
      ignoredNodeIds,
    );

    if (candidateCrossingCount < bestCrossingCount) {
      return candidate;
    }

    if (bestCrossingCount < candidateCrossingCount) {
      return best;
    }

    return routeLength(candidate) < routeLength(best) ? candidate : best;
  }, first);
}

function exteriorLaneRoute(
  route: RoutedEdge,
  start: ScenePoint,
  end: ScenePoint,
  shapes: readonly NodeSceneElement[],
): [ScenePoint, ...ScenePoint[]] {
  const horizontalDominant =
    Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const ignoredNodeIds = new Set([route.source.nodeId, route.target.nodeId]);
  const minX = Math.min(...shapes.map((shape) => shape.x));
  const maxX = Math.max(...shapes.map((shape) => shape.x + shape.width));
  const minY = Math.min(...shapes.map((shape) => shape.y));
  const maxY = Math.max(...shapes.map((shape) => shape.y + shape.height));
  const useLeftLane =
    route.sourceEdge === "left" ||
    route.targetEdge === "left" ||
    center(route.target).x < center(route.source).x;
  const useUpperLane =
    route.sourceEdge === "top" ||
    route.targetEdge === "top" ||
    center(route.source).y <= center(route.target).y;
  const laneOffset = route.index * PORT_SPACING;
  const leftLaneX = minX - HORIZONTAL_GAP / 2 - laneOffset;
  const rightLaneX = maxX + HORIZONTAL_GAP / 2 + laneOffset;
  const upperLaneY = minY - VERTICAL_GAP / 2 - laneOffset;
  const lowerLaneY = maxY + VERTICAL_GAP / 2 + laneOffset;
  const preferredX = useLeftLane ? leftLaneX : rightLaneX;
  const alternateX = useLeftLane ? rightLaneX : leftLaneX;
  const preferredY = useUpperLane ? upperLaneY : lowerLaneY;
  const alternateY = useUpperLane ? lowerLaneY : upperLaneY;
  const routeForVerticalLane = (laneX: number) =>
    compactPoints([
      start,
      { x: laneX, y: start.y },
      { x: laneX, y: end.y },
      end,
    ]);
  const routeForHorizontalLane = (laneY: number) =>
    compactPoints([
      start,
      { x: start.x, y: laneY },
      { x: end.x, y: laneY },
      end,
    ]);
  const horizontalCandidates = [
    routeForHorizontalLane(preferredY),
    routeForHorizontalLane(alternateY),
    routeForVerticalLane(preferredX),
    routeForVerticalLane(alternateX),
  ];
  const verticalCandidates = [
    routeForVerticalLane(preferredX),
    routeForVerticalLane(alternateX),
    routeForHorizontalLane(preferredY),
    routeForHorizontalLane(alternateY),
  ];

  return chooseBestRoute(
    horizontalDominant ? horizontalCandidates : verticalCandidates,
    shapes,
    ignoredNodeIds,
  );
}

function sceneBounds(elements: readonly SceneElement[]): {
  width: number;
  height: number;
} {
  const points = scenePoints(elements);
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));

  return {
    width: maxX + PADDING,
    height: maxY + PADDING,
  };
}

function sceneMinimum(elements: readonly SceneElement[]): ScenePoint {
  const points = scenePoints(elements);
  return {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
  };
}

function scenePoints(elements: readonly SceneElement[]): ScenePoint[] {
  return elements.flatMap((element): ScenePoint[] => {
    if (element.type === "arrow") {
      return [...element.points];
    }

    return [
      { x: element.x, y: element.y },
      {
        x:
          element.x +
          (element.type === "node"
            ? element.width
            : (element.maxWidth ?? element.text.length)),
        y:
          element.y +
          (element.type === "node" ? element.height : element.fontSize),
      },
    ];
  });
}

function translatePoint(point: ScenePoint, dx: number, dy: number): ScenePoint {
  return { x: point.x + dx, y: point.y + dy };
}

function translatePoints(
  points: readonly [ScenePoint, ...ScenePoint[]],
  dx: number,
  dy: number,
): [ScenePoint, ...ScenePoint[]] {
  const [first, ...rest] = points;
  return [
    translatePoint(first, dx, dy),
    ...rest.map((point) => translatePoint(point, dx, dy)),
  ];
}

function translateElement(
  element: SceneElement,
  dx: number,
  dy: number,
): SceneElement {
  if (element.type === "arrow") {
    return {
      ...element,
      points: translatePoints(element.points, dx, dy),
    };
  }

  return {
    ...element,
    x: element.x + dx,
    y: element.y + dy,
  };
}

function normalizeSceneOrigin(elements: readonly SceneElement[]): SceneElement[] {
  const minimum = sceneMinimum(elements);
  const dx = Math.max(0, PADDING - minimum.x);
  const dy = Math.max(0, PADDING - minimum.y);

  if (dx === 0 && dy === 0) {
    return [...elements];
  }

  return elements.map((element) => translateElement(element, dx, dy));
}

export function renderIntermediateDiagram(
  input: IntermediateDiagram | unknown,
): RenderedDiagramScene {
  const diagram = parseIntermediateDiagram(input);
  const nodeShapes = positionNodes(diagram);
  const shapesByNodeId = new Map(
    nodeShapes.map((shape) => [shape.nodeId, shape]),
  );
  const routedEdges = diagram.edges.map((edge, index) =>
    routeForEdge(edge, index, shapesByNodeId),
  );
  const portOffsets = portOffsetsForRoutes(routedEdges);
  const edgeArrows = routedEdges.map((route) =>
    arrowForRoute(route, diagram.layout.edgeRouting, portOffsets, nodeShapes),
  );
  const labels = nodeShapes.map(textForNode);
  const elements = normalizeSceneOrigin([
    ...edgeArrows,
    ...nodeShapes,
    ...labels,
  ]);
  const bounds = sceneBounds(elements);

  return {
    diagramId: diagram.id,
    title: diagram.title,
    width: bounds.width,
    height: bounds.height,
    accentColor: diagram.style.accentColor,
    backgroundColor: diagram.style.backgroundColor,
    elements,
  };
}
