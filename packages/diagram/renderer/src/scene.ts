import {
	CANVAS_NODE_ICON,
	CANVAS_SPEC_VERSION,
	canvasBoundTextBox,
	canvasNodeIconBand,
	type AxisAlignedSegment,
	isSharedBoundStem,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
	segmentsOverlapInterior,
	type CanvasConnectorElement,
	type CanvasElement,
	type CanvasFrameElement,
	type CanvasLineElement,
	type CanvasNodeIcon,
	type CanvasPoint,
	type CanvasShapeElement,
	type CanvasShapeKind,
	type CanvasSpec,
	type CanvasTextElement,
	DEFAULT_GLYPH_UNITS,
	type DiagramEdge,
	type DiagramNode,
	estimateTextWidth,
	type IntermediateDiagram,
	parseIntermediateDiagram,
	wrapTextToUnits,
} from "@sketchi/diagram-core";

export type NodeSceneShape = CanvasShapeKind;
export type SceneElement = CanvasElement;
export type NodeSceneElement = CanvasShapeElement;
export type TextSceneElement = CanvasTextElement;
export type ArrowSceneElement = CanvasConnectorElement;
export type LineSceneElement = CanvasLineElement;
export type FrameSceneElement = CanvasFrameElement;
export type ScenePoint = CanvasPoint;
export type RenderedDiagramScene = CanvasSpec;

const MIN_NODE_WIDTH = 184;
const MIN_NODE_HEIGHT = 72;
const HORIZONTAL_GAP = 112;
const VERTICAL_GAP = 96;
const PADDING = 48;
const NODE_LABEL_FONT_SIZE = 14;
const NODE_LABEL_LINE_HEIGHT = 1.35;
const NODE_LABEL_HORIZONTAL_PADDING = 36;
const NODE_LABEL_VERTICAL_PADDING = 28;
/** Eighteen average glyphs per line before wrapping. */
const MAX_LABEL_LINE_UNITS = 18 * DEFAULT_GLYPH_UNITS;
/** A diamond's bound-text box is half its width, so decisions wrap sooner. */
const MAX_DIAMOND_LABEL_LINE_UNITS = 12 * DEFAULT_GLYPH_UNITS;
/** Logo edge per shape; smaller marks keep start/end and decision nodes compact. */
const NODE_ICON_SIZE: Readonly<Record<NodeSceneShape, number>> = {
	circle: 24,
	diamond: 20,
	ellipse: 24,
	polygon: 28,
	rectangle: 28,
};
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

interface RouteSegment extends AxisAlignedSegment {
	arrowId: string;
	startBindingId: string;
	endBindingId: string;
}

type VisitState = "visited" | "visiting";

interface LabelMetrics {
	/** Padded box height used by plain nodes. */
	readonly height: number;
	readonly text: string;
	/** Unpadded text height. */
	readonly textHeight: number;
	/** Unpadded width of the widest line (shared text-metrics estimate). */
	readonly textWidth: number;
	/** Padded box width used by plain nodes. */
	readonly width: number;
}

function measureLabel(label: string, maxLineUnits: number): LabelMetrics {
	const text = wrapTextToUnits(label, maxLineUnits);
	const lines = text.split("\n");
	const textWidth = estimateTextWidth(text, NODE_LABEL_FONT_SIZE);
	const textHeight = Math.ceil(lines.length * NODE_LABEL_FONT_SIZE * NODE_LABEL_LINE_HEIGHT);
	const width = Math.ceil(textWidth + NODE_LABEL_HORIZONTAL_PADDING);
	const height = Math.ceil(textHeight + NODE_LABEL_VERTICAL_PADDING);

	return { text, textHeight, textWidth, width, height };
}

/**
 * Smallest container whose Excalidraw bound-text box holds the label and any
 * logo band. Excalidraw re-wraps an edited label to this box (half the width of
 * a diamond, the inscribed rectangle of an ellipse), so sizing to it keeps the
 * stored wrap and the logo clear after editing.
 */
function boundTextContainerSize(
	shape: NodeSceneShape,
	label: LabelMetrics,
	icon: CanvasNodeIcon | undefined,
): { readonly height: number; readonly width: number } {
	const padding = CANVAS_NODE_ICON.boundTextPadding * 2;
	const textHeight = label.textHeight + canvasNodeIconBand(icon);
	const scale =
		shape === "diamond" ? 2 : shape === "ellipse" || shape === "circle" ? Math.SQRT2 : 1;
	let width = Math.ceil((label.textWidth + padding) * scale);
	let height = Math.ceil((textHeight + padding) * scale);
	// Excalidraw rounds its text box, which can land just under the closed-form
	// size; grow until the rounded box itself holds the text.
	while (canvasBoundTextBox({ height, shape, width }).width < label.textWidth) {
		width += 1;
	}
	while (canvasBoundTextBox({ height, shape, width }).height < textHeight) {
		height += 1;
	}
	return { width, height };
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
	const shape = shapeForNode(node);
	const labelMetrics = measureLabel(
		node.label,
		shape === "diamond" ? MAX_DIAMOND_LABEL_LINE_UNITS : MAX_LABEL_LINE_UNITS,
	);
	const icon = node.icon ? { slug: node.icon.slug, size: NODE_ICON_SIZE[shape] } : undefined;
	const shapeWidthPad = shape === "diamond" ? 32 : shape === "ellipse" ? 20 : 0;
	const shapeHeightPad = shape === "diamond" ? 32 : 0;
	// Logo nodes and diamonds must fit Excalidraw's edit-time text box; other
	// plain nodes keep their padded label box, which already contains it.
	const boundText =
		icon || shape === "diamond"
			? boundTextContainerSize(shape, labelMetrics, icon)
			: { height: 0, width: 0 };

	return {
		type: "node",
		id: `node:${node.id}`,
		nodeId: node.id,
		...(node.kind ? { kind: node.kind } : {}),
		...(icon ? { icon } : {}),
		shape,
		x: 0,
		y: 0,
		width: Math.max(MIN_NODE_WIDTH, labelMetrics.width + shapeWidthPad, boundText.width),
		height: icon
			? Math.max(MIN_NODE_HEIGHT, boundText.height)
			: Math.max(MIN_NODE_HEIGHT, labelMetrics.height + shapeHeightPad, boundText.height),
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
		diagram.nodes.find((node) => (incoming.get(node.id) ?? []).length === 0) ?? diagram.nodes[0];

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
	afterIndex: number,
): void {
	const order = nodeOrder.get(nodeId) ?? Number.MAX_SAFE_INTEGER;
	const insertionIndex = queue.findIndex(
		(queuedNodeId, index) =>
			index > afterIndex && (nodeOrder.get(queuedNodeId) ?? Number.MAX_SAFE_INTEGER) > order,
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

			rankByNodeId.set(edge.target, Math.max(rankByNodeId.get(edge.target) ?? 0, sourceRank + 1));
			const nextIncomingCount = (incomingCount.get(edge.target) ?? 0) - 1;
			incomingCount.set(edge.target, nextIncomingCount);

			if (nextIncomingCount === 0) {
				insertByNodeOrder(queue, edge.target, nodeOrder, index);
			}
		}
	}

	// Feedback edges have been removed, so visit remaining predecessors first.
	function rankRemaining(nodeId: string): number {
		if (processed.has(nodeId)) return rankByNodeId.get(nodeId) ?? 0;
		let rank = 0;
		for (const edge of buckets.incoming.get(nodeId) ?? []) {
			if (!feedbackEdges.has(edge.id)) {
				rank = Math.max(rank, rankRemaining(edge.source) + 1);
			}
		}
		processed.add(nodeId);
		rankByNodeId.set(nodeId, rank);
		return rank;
	}
	for (const node of diagram.nodes) {
		rankRemaining(node.id);
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
		const ranks = Array.from(rankedShapes.keys()).sort((left, right) => left - right);

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

				return neighborScores.reduce((sum, score) => sum + score, 0) / neighborScores.length;
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
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const shapesByNodeId = new Map(diagram.nodes.map((node) => [node.id, createNodeShape(node)]));
	const buckets = edgeBuckets(diagram.edges);
	const feedbackEdges = feedbackEdgeIds(diagram, buckets.incoming, buckets.outgoing);
	const rankByNodeId = rankNodes(diagram, buckets, feedbackEdges);
	const rankedShapes = orderedRankShapes(
		diagram,
		shapesByNodeId,
		rankByNodeId,
		buckets,
		feedbackEdges,
	);
	const ranks = Array.from(rankedShapes.entries()).sort(([left], [right]) => left - right);
	const rankMetrics = ranks.map(([rank, shapes]) => {
		const breadth = shapes.reduce(
			(sum, shape, index) =>
				sum + (vertical ? shape.width : shape.height) + (index > 0 ? HORIZONTAL_GAP : 0),
			0,
		);
		const depth = Math.max(...shapes.map((shape) => (vertical ? shape.height : shape.width)));

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
		const totalHeight = Math.max(...positioned.map((shape) => shape.y + shape.height));
		return positioned.map((shape) => ({
			...shape,
			y: PADDING + totalHeight - shape.y - shape.height,
		}));
	}

	if (diagram.layout.direction === "RL") {
		const totalWidth = Math.max(...positioned.map((shape) => shape.x + shape.width));
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
		// The logo sits at the top of the text box; the label stacks beneath it.
		...(shape.icon ? { verticalAlign: "bottom" as const } : {}),
	};
}

function center(shape: NodeSceneElement): ScenePoint {
	return {
		x: shape.x + shape.width / 2,
		y: shape.y + shape.height / 2,
	};
}

function horizontalRangesOverlap(source: NodeSceneElement, target: NodeSceneElement): boolean {
	return (
		Math.min(source.x + source.width, target.x + target.width) - Math.max(source.x, target.x) > 0.01
	);
}

function connectionEdges(
	source: NodeSceneElement,
	target: NodeSceneElement,
	direction: IntermediateDiagram["layout"]["direction"],
): {
	sourceEdge: ConnectionEdge;
	targetEdge: ConnectionEdge;
} {
	const sourceCenter = center(source);
	const targetCenter = center(target);
	const dx = targetCenter.x - sourceCenter.x;
	const dy = targetCenter.y - sourceCenter.y;
	const sourceKind = source.kind?.toLowerCase();

	if (direction === "LR" || direction === "RL") {
		return dx >= 0
			? { sourceEdge: "right", targetEdge: "left" }
			: { sourceEdge: "left", targetEdge: "right" };
	}

	if (dy < 0) {
		if (!horizontalRangesOverlap(source, target) && Math.abs(dx) > Math.abs(dy)) {
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

	const longDownwardDecisionBranch = sourceKind === "decision" && dy > source.height + VERTICAL_GAP;

	if (sourceKind === "decision" && dy > 0 && (dx !== 0 || longDownwardDecisionBranch)) {
		return {
			sourceEdge: dx < 0 ? "left" : "right",
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

	return { sourceEdge: "top", targetEdge: "bottom" };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function constrainedPortOffset(shape: NodeSceneElement, edge: ConnectionEdge, offset: number) {
	const limit =
		edge === "top" || edge === "bottom"
			? shape.width / 2 - PORT_PADDING
			: shape.height / 2 - PORT_PADDING;

	return limit > 0 ? clamp(offset, -limit, limit) : 0;
}

function pointOnEdge(shape: NodeSceneElement, edge: ConnectionEdge, portOffset = 0): ScenePoint {
	const offset = constrainedPortOffset(shape, edge, portOffset);
	const centerPoint = center(shape);
	const halfWidth = shape.width / 2;
	const halfHeight = shape.height / 2;

	if (shape.shape === "diamond" && halfWidth > 0 && halfHeight > 0) {
		if (edge === "top" || edge === "bottom") {
			const x = centerPoint.x + offset;
			const boundaryOffset = halfHeight * (1 - Math.abs(offset) / halfWidth);
			return {
				x,
				y: edge === "top" ? centerPoint.y - boundaryOffset : centerPoint.y + boundaryOffset,
			};
		}

		const y = centerPoint.y + offset;
		const boundaryOffset = halfWidth * (1 - Math.abs(offset) / halfHeight);
		return {
			x: edge === "left" ? centerPoint.x - boundaryOffset : centerPoint.x + boundaryOffset,
			y,
		};
	}

	if ((shape.shape === "ellipse" || shape.shape === "circle") && halfWidth > 0 && halfHeight > 0) {
		if (edge === "top" || edge === "bottom") {
			const x = centerPoint.x + offset;
			const boundaryOffset = halfHeight * Math.sqrt(Math.max(0, 1 - (offset / halfWidth) ** 2));
			return {
				x,
				y: edge === "top" ? centerPoint.y - boundaryOffset : centerPoint.y + boundaryOffset,
			};
		}

		const y = centerPoint.y + offset;
		const boundaryOffset = halfWidth * Math.sqrt(Math.max(0, 1 - (offset / halfHeight) ** 2));
		return {
			x: edge === "left" ? centerPoint.x - boundaryOffset : centerPoint.x + boundaryOffset,
			y,
		};
	}

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

function connectionKey(input: { endpoint: "source" | "target"; edgeId: string }): string {
	return `${input.edgeId}:${input.endpoint}`;
}

function portKey(nodeId: string, edge: ConnectionEdge): string {
	return `${nodeId}:${edge}`;
}

function portOffset(index: number, count: number): number {
	return (index - (count - 1) / 2) * PORT_SPACING;
}

function interiorLaneCoordinate(start: number, end: number, offset: number) {
	const middle = start + (end - start) / 2;
	const min = Math.min(start, end) + PORT_SPACING;
	const max = Math.max(start, end) - PORT_SPACING;

	return min < max ? clamp(middle + offset, min, max) : middle;
}

function portOffsetsForRoutes(routes: readonly RoutedEdge[]): Map<string, number> {
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
			offsets.set(connectionKey(connection), portOffset(index, connections.length));
		});
	}

	return offsets;
}

function routeForEdge(
	edge: DiagramEdge,
	index: number,
	shapesByNodeId: ReadonlyMap<string, NodeSceneElement>,
	direction: IntermediateDiagram["layout"]["direction"],
): RoutedEdge {
	const source = shapesByNodeId.get(edge.source);
	const target = shapesByNodeId.get(edge.target);

	if (!source || !target) {
		throw new Error(`Cannot render edge "${edge.id}" with unresolved nodes.`);
	}

	const { sourceEdge, targetEdge } = connectionEdges(source, target, direction);

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
	existingArrows: readonly ArrowSceneElement[],
	direction: IntermediateDiagram["layout"]["direction"],
): ArrowSceneElement {
	const { edge, source, sourceEdge, target, targetEdge } = route;
	const portedStart = pointOnEdge(
		source,
		sourceEdge,
		portOffsets.get(connectionKey({ edgeId: edge.id, endpoint: "source" })) ?? 0,
	);
	const portedEnd = pointOnEdge(
		target,
		targetEdge,
		portOffsets.get(connectionKey({ edgeId: edge.id, endpoint: "target" })) ?? 0,
	);
	let points = compactPoints([portedStart, portedEnd]);

	if (travelsAgainstLayout(source, target, direction)) {
		points = exteriorLaneRoute(route, portedStart, portedEnd, shapes, existingArrows);
	} else if (
		edgeRouting === "orthogonal" &&
		portedStart.x !== portedEnd.x &&
		portedStart.y !== portedEnd.y
	) {
		const sideStubOffset = (route.index % 4) * PORT_SPACING;
		const laneY = interiorLaneCoordinate(
			portedStart.y,
			portedEnd.y,
			portedEnd.y < portedStart.y ? -sideStubOffset : sideStubOffset,
		);
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
		const corners = [startStub, { x: startStub.x, y: laneY }, { x: endStub.x, y: laneY }, endStub];

		points = compactPoints([portedStart, ...corners, portedEnd]);
	}

	if (
		edgeRouting === "orthogonal" &&
		(routeCrossesNode(points, shapes, new Set([source.nodeId, target.nodeId])) ||
			routeSelfOverlapCount(points, route) > 0 ||
			routeArrowOverlapCount(points, existingArrows, route) > 0)
	) {
		points = exteriorLaneRoute(route, portedStart, portedEnd, shapes, existingArrows);
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

function travelsAgainstLayout(
	source: NodeSceneElement,
	target: NodeSceneElement,
	direction: IntermediateDiagram["layout"]["direction"],
): boolean {
	const sourceCenter = center(source);
	const targetCenter = center(target);
	switch (direction) {
		case "TB":
			return targetCenter.y < sourceCenter.y;
		case "BT":
			return targetCenter.y > sourceCenter.y;
		case "LR":
			return targetCenter.x < sourceCenter.x;
		case "RL":
			return targetCenter.x > sourceCenter.x;
	}
}

function compactPoints(points: readonly ScenePoint[]): [ScenePoint, ...ScenePoint[]] {
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

	for (const segment of segmentsFromPoints(points)) {
		for (const shape of shapes) {
			if (!ignoredNodeIds.has(shape.nodeId) && segmentCrossesBoundsInterior(segment, shape)) {
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

function routeSegments(input: {
	arrowId: string;
	points: readonly ScenePoint[];
	sourceNodeId: string;
	targetNodeId: string;
}): RouteSegment[] {
	return segmentsFromPoints(input.points).map((segment) => ({
		...segment,
		arrowId: input.arrowId,
		startBindingId: input.sourceNodeId,
		endBindingId: input.targetNodeId,
	}));
}

function routeArrowOverlapCount(
	points: readonly ScenePoint[],
	existingArrows: readonly ArrowSceneElement[],
	route: RoutedEdge,
): number {
	const candidateSegments = routeSegments({
		arrowId: `edge:${route.edge.id}`,
		points,
		sourceNodeId: route.edge.source,
		targetNodeId: route.edge.target,
	});
	const existingSegments = existingArrows.flatMap((arrow) =>
		routeSegments({
			arrowId: arrow.id,
			points: arrow.points,
			sourceNodeId: arrow.sourceNodeId,
			targetNodeId: arrow.targetNodeId,
		}),
	);
	let overlapCount = 0;

	for (const candidate of candidateSegments) {
		for (const existing of existingSegments) {
			if (
				candidate.arrowId === existing.arrowId ||
				isSharedBoundStem(candidate, existing) ||
				!segmentsOverlapInterior(candidate, existing)
			) {
				continue;
			}

			overlapCount += 1;
		}
	}

	return overlapCount;
}

function routeSelfOverlapCount(points: readonly ScenePoint[], route: RoutedEdge): number {
	const segments = routeSegments({
		arrowId: `edge:${route.edge.id}`,
		points,
		sourceNodeId: route.edge.source,
		targetNodeId: route.edge.target,
	});
	let overlapCount = 0;

	for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
		const left = segments[leftIndex];

		if (!left) {
			continue;
		}

		for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
			const right = segments[rightIndex];

			if (!right || !segmentsOverlapInterior(left, right)) {
				continue;
			}

			overlapCount += 1;
		}
	}

	return overlapCount;
}

function routeBacktrackDistance(points: readonly ScenePoint[]): number {
	const start = points[0];
	const end = points[points.length - 1];

	if (!start || !end) {
		return 0;
	}

	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	let distance = 0;

	if (end.x < start.x) {
		distance += Math.max(0, Math.max(...xs) - start.x);
	} else if (end.x > start.x) {
		distance += Math.max(0, start.x - Math.min(...xs));
	}

	if (end.y < start.y) {
		distance += Math.max(0, Math.max(...ys) - start.y);
	} else if (end.y > start.y) {
		distance += Math.max(0, start.y - Math.min(...ys));
	}

	return distance;
}

function routeTargetOvershootDistance(points: readonly ScenePoint[]): number {
	const start = points[0];
	const end = points[points.length - 1];

	if (!start || !end) {
		return 0;
	}

	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	let distance = 0;

	if (end.x < start.x) {
		distance += Math.max(0, end.x - Math.min(...xs));
	} else if (end.x > start.x) {
		distance += Math.max(0, Math.max(...xs) - end.x);
	}

	if (end.y < start.y) {
		distance += Math.max(0, end.y - Math.min(...ys));
	} else if (end.y > start.y) {
		distance += Math.max(0, Math.max(...ys) - end.y);
	}

	return distance;
}

function pointLeavesEdge(
	edgePoint: ScenePoint,
	candidate: ScenePoint,
	edge: ConnectionEdge,
): boolean {
	switch (edge) {
		case "top":
			return candidate.y < edgePoint.y;
		case "right":
			return candidate.x > edgePoint.x;
		case "bottom":
			return candidate.y > edgePoint.y;
		case "left":
			return candidate.x < edgePoint.x;
	}
}

function endpointStubScore(
	points: readonly [ScenePoint, ...ScenePoint[]],
	route: RoutedEdge,
): number {
	const start = points[0];
	const second = points[1];
	const end = points[points.length - 1];
	const pointBeforeEnd = points[points.length - 2];
	let score = 0;

	if (second && pointLeavesEdge(start, second, route.sourceEdge)) {
		score += 1;
	}

	if (pointBeforeEnd && end && pointLeavesEdge(end, pointBeforeEnd, route.targetEdge)) {
		score += 1;
	}

	return score;
}

function pointAwayFromEdge(point: ScenePoint, edge: ConnectionEdge, distance: number): ScenePoint {
	switch (edge) {
		case "top":
			return { x: point.x, y: point.y - distance };
		case "right":
			return { x: point.x + distance, y: point.y };
		case "bottom":
			return { x: point.x, y: point.y + distance };
		case "left":
			return { x: point.x - distance, y: point.y };
	}
}

function chooseBestRoute(
	candidates: readonly [ScenePoint, ...ScenePoint[]][],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
	route: RoutedEdge,
	existingArrows: readonly ArrowSceneElement[],
): [ScenePoint, ...ScenePoint[]] {
	const first = candidates[0];
	if (!first) {
		return [{ x: 0, y: 0 }];
	}

	const routeScore = (candidate: [ScenePoint, ...ScenePoint[]]): readonly number[] => [
		routeNodeCrossingCount(candidate, shapes, ignoredNodeIds),
		routeSelfOverlapCount(candidate, route),
		routeArrowOverlapCount(candidate, existingArrows, route),
		-endpointStubScore(candidate, route),
		routeBacktrackDistance(candidate),
		routeTargetOvershootDistance(candidate),
		routeLength(candidate),
	];
	const isLowerScore = (candidate: readonly number[], best: readonly number[]) => {
		for (let index = 0; index < candidate.length; index += 1) {
			const difference = (candidate[index] ?? 0) - (best[index] ?? 0);
			if (difference !== 0) return difference < 0;
		}
		return false;
	};
	let best = first;
	let bestScore = routeScore(first);
	for (const candidate of candidates.slice(1)) {
		const score = routeScore(candidate);
		if (isLowerScore(score, bestScore)) {
			best = candidate;
			bestScore = score;
		}
	}
	return best;
}

function exteriorLaneRoute(
	route: RoutedEdge,
	start: ScenePoint,
	end: ScenePoint,
	shapes: readonly NodeSceneElement[],
	existingArrows: readonly ArrowSceneElement[],
): [ScenePoint, ...ScenePoint[]] {
	const horizontalDominant = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
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
	const localLaneOffset = ((route.index % 4) * PORT_SPACING) / 2;
	const localLeftLaneX =
		Math.min(route.source.x, route.target.x) - HORIZONTAL_GAP / 2 - localLaneOffset;
	const localRightLaneX =
		Math.max(route.source.x + route.source.width, route.target.x + route.target.width) +
		HORIZONTAL_GAP / 2 +
		localLaneOffset;
	const localUpperLaneY =
		Math.min(route.source.y, route.target.y) - VERTICAL_GAP / 2 - localLaneOffset;
	const localLowerLaneY =
		Math.max(route.source.y + route.source.height, route.target.y + route.target.height) +
		VERTICAL_GAP / 2 +
		localLaneOffset;
	const preferredX = useLeftLane ? leftLaneX : rightLaneX;
	const alternateX = useLeftLane ? rightLaneX : leftLaneX;
	const preferredY = useUpperLane ? upperLaneY : lowerLaneY;
	const alternateY = useUpperLane ? lowerLaneY : upperLaneY;
	const preferredLocalX = useLeftLane ? localLeftLaneX : localRightLaneX;
	const alternateLocalX = useLeftLane ? localRightLaneX : localLeftLaneX;
	const preferredLocalY = useUpperLane ? localUpperLaneY : localLowerLaneY;
	const alternateLocalY = useUpperLane ? localLowerLaneY : localUpperLaneY;
	const localStubDistance = ROUTE_STUB_LENGTH + (route.index % 4) * PORT_SPACING;
	const stubDistances = [0, localStubDistance];
	const routeForVerticalLane = (laneX: number, stubDistance: number) => {
		const startStub =
			stubDistance > 0 ? pointAwayFromEdge(start, route.sourceEdge, stubDistance) : start;
		const endStub = stubDistance > 0 ? pointAwayFromEdge(end, route.targetEdge, stubDistance) : end;

		return compactPoints([
			start,
			startStub,
			{ x: laneX, y: startStub.y },
			{ x: laneX, y: endStub.y },
			endStub,
			end,
		]);
	};
	const routeForHorizontalLane = (laneY: number, stubDistance: number) => {
		const startStub =
			stubDistance > 0 ? pointAwayFromEdge(start, route.sourceEdge, stubDistance) : start;
		const endStub = stubDistance > 0 ? pointAwayFromEdge(end, route.targetEdge, stubDistance) : end;

		return compactPoints([
			start,
			startStub,
			{ x: startStub.x, y: laneY },
			{ x: endStub.x, y: laneY },
			endStub,
			end,
		]);
	};
	type LaneGenerator = (lane: number, stubDistance: number) => [ScenePoint, ...ScenePoint[]];
	const horizontalLanes: readonly (readonly [number, LaneGenerator])[] = [
		[preferredLocalY, routeForHorizontalLane],
		[alternateLocalY, routeForHorizontalLane],
		[preferredY, routeForHorizontalLane],
		[alternateY, routeForHorizontalLane],
	];
	const verticalLanes: readonly (readonly [number, LaneGenerator])[] = [
		[preferredLocalX, routeForVerticalLane],
		[alternateLocalX, routeForVerticalLane],
		[preferredX, routeForVerticalLane],
		[alternateX, routeForVerticalLane],
	];
	const [preferredLanes, alternateLanes] = horizontalDominant
		? [horizontalLanes, verticalLanes]
		: [verticalLanes, horizontalLanes];
	const lanes = [
		...preferredLanes.slice(0, 2),
		...alternateLanes.slice(0, 2),
		...preferredLanes.slice(2),
		...alternateLanes.slice(2),
	];
	const candidates = lanes.flatMap(([lane, generator]) =>
		stubDistances.map((distance) => generator(lane, distance)),
	);

	return chooseBestRoute(candidates, shapes, ignoredNodeIds, route, existingArrows);
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
		if (element.type === "arrow" || element.type === "line") {
			return [...element.points];
		}

		if (element.type === "text") {
			// Node labels are centered and contained by their already-counted shape.
			if (element.containerId) return [];
			const halfWidth = (element.maxWidth ?? element.text.length) / 2;
			const halfHeight = (element.text.split("\n").length * element.fontSize * 1.35) / 2;
			return [
				{ x: element.x - halfWidth, y: element.y - halfHeight },
				{
					x: element.x + halfWidth,
					y: element.y + halfHeight,
				},
			];
		}

		return [
			{ x: element.x, y: element.y },
			{
				x: element.x + element.width,
				y: element.y + element.height,
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
	return [translatePoint(first, dx, dy), ...rest.map((point) => translatePoint(point, dx, dy))];
}

function translateLinePoints(
	points: readonly [ScenePoint, ScenePoint, ...ScenePoint[]],
	dx: number,
	dy: number,
): [ScenePoint, ScenePoint, ...ScenePoint[]] {
	const [first, second, ...rest] = points;
	return [
		translatePoint(first, dx, dy),
		translatePoint(second, dx, dy),
		...rest.map((point) => translatePoint(point, dx, dy)),
	];
}

function translateElement(element: SceneElement, dx: number, dy: number): SceneElement {
	if (element.type === "arrow") {
		return {
			...element,
			points: translatePoints(element.points, dx, dy),
		};
	}

	if (element.type === "line") {
		return {
			...element,
			points: translateLinePoints(element.points, dx, dy),
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

export function renderIntermediateDiagram(input: unknown): RenderedDiagramScene {
	const diagram = parseIntermediateDiagram(input);
	const nodeShapes = positionNodes(diagram);
	const shapesByNodeId = new Map(nodeShapes.map((shape) => [shape.nodeId, shape]));
	const routedEdges = diagram.edges.map((edge, index) =>
		routeForEdge(edge, index, shapesByNodeId, diagram.layout.direction),
	);
	const portOffsets = portOffsetsForRoutes(routedEdges);
	const edgeArrows: ArrowSceneElement[] = [];
	for (const route of routedEdges) {
		edgeArrows.push(
			arrowForRoute(
				route,
				diagram.layout.edgeRouting,
				portOffsets,
				nodeShapes,
				edgeArrows,
				diagram.layout.direction,
			),
		);
	}
	const labels = nodeShapes.map(textForNode);
	const elements = normalizeSceneOrigin([...edgeArrows, ...nodeShapes, ...labels]);
	const bounds = sceneBounds(elements);
	const zOrder = [
		...nodeShapes.map((element) => element.id),
		...labels.map((element) => element.id),
		...edgeArrows.map((element) => element.id),
	];

	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: diagram.id,
		title: diagram.title,
		width: bounds.width,
		height: bounds.height,
		accentColor: diagram.style.accentColor,
		backgroundColor: diagram.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder,
	};
}
