import {
	CANVAS_NODE_ICON,
	CANVAS_SPEC_VERSION,
	AXIS_ALIGNED_EPSILON,
	canvasBoundTextBox,
	canvasNodeIconBand,
	type AxisAlignedSegment,
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
	wrapTextToWidth,
	boundLabelWidth,
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

function positionNodes(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
): NodeSceneElement[] {
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const buckets = edgeBuckets(diagram.edges);
	const shapesByNodeId = new Map(
		diagram.nodes.map((node) => {
			const originalShape = createNodeShape(node);
			const minimum = minimumSizes.get(node.id);
			const shape = {
				...originalShape,
				width: Math.max(originalShape.width, minimum?.width ?? 0),
				height: Math.max(originalShape.height, minimum?.height ?? 0),
			};
			// Allocate enough port capacity before ranking; clamping must never merge endpoints.
			const connections =
				(buckets.incoming.get(node.id)?.length ?? 0) + (buckets.outgoing.get(node.id)?.length ?? 0);
			const outgoing = buckets.outgoing.get(node.id) ?? [];
			const pitch =
				node.kind !== "decision" && outgoing.length > 1 && outgoing.some((e) => e.label)
					? Math.max(
							PORT_SPACING,
							...outgoing.map((e) => {
								const metrics = branchLabelMetrics(e.label ?? "");
								return (vertical ? metrics.width : metrics.height) + 24;
							}),
						)
					: PORT_SPACING;
			const portBreadth = PORT_PADDING * 2 + Math.max(0, connections - 1) * pitch;
			return [
				node.id,
				{
					...shape,
					...(vertical
						? { width: Math.max(shape.width, portBreadth) }
						: { height: Math.max(shape.height, portBreadth) }),
				},
			];
		}),
	);
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

		// Horizontal labels lengthen the departure stub. Reserve room for the
		// opposing arrival stub and a routing lane instead of forcing them to overlap.
		const labelGap = vertical
			? 0
			: Math.max(
					0,
					...diagram.edges
						.filter(
							(edge) => metric.shapes.some((shape) => shape.nodeId === edge.source) && edge.label,
						)
						.map(
							(edge) =>
								branchLabelMetrics(
									edge.label!,
									shapesByNodeId.get(edge.source)?.kind === "decision" ? 80 : 160,
								).width +
								16 +
								ROUTE_STUB_LENGTH * 2,
						),
				);
		rankOffset += metric.depth + Math.max(VERTICAL_GAP, labelGap);
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

function portOffsetsForRoutes(routes: readonly RoutedEdge[]): Map<string, number> {
	const connectionsByPort = new Map<
		string,
		Array<{ edgeId: string; endpoint: "source" | "target"; coordinate: number }>
	>();

	for (const route of routes) {
		const sourcePortKey = portKey(route.source.nodeId, route.sourceEdge);
		const targetPortKey = portKey(route.target.nodeId, route.targetEdge);

		connectionsByPort.set(sourcePortKey, [
			...(connectionsByPort.get(sourcePortKey) ?? []),
			{
				edgeId: route.edge.id,
				endpoint: "source",
				coordinate:
					route.sourceEdge === "top" || route.sourceEdge === "bottom"
						? center(route.target).x
						: center(route.target).y,
			},
		]);
		connectionsByPort.set(targetPortKey, [
			...(connectionsByPort.get(targetPortKey) ?? []),
			{
				edgeId: route.edge.id,
				endpoint: "target",
				coordinate:
					route.targetEdge === "top" || route.targetEdge === "bottom"
						? center(route.source).x
						: center(route.source).y,
			},
		]);
	}

	const offsets = new Map<string, number>();
	for (const connections of connectionsByPort.values()) {
		const departures = connections.filter((c) => c.endpoint === "source");
		const labeled = departures
			.map((c) => routes.find((r) => r.edge.id === c.edgeId)!)
			.filter((r) => r.edge.label);
		const pitch =
			departures.length > 1 && labeled.length > 0 && labeled[0]!.source.kind !== "decision"
				? Math.max(
						PORT_SPACING,
						...labeled.map((r) => {
							const metrics = branchLabelMetrics(r.edge.label!);
							return (
								(r.sourceEdge === "top" || r.sourceEdge === "bottom"
									? metrics.width
									: metrics.height) + 24
							);
						}),
					)
				: PORT_SPACING;
		connections
			.sort((a, b) => a.coordinate - b.coordinate)
			.forEach((connection, index) => {
				offsets.set(
					connectionKey(connection),
					(portOffset(index, connections.length) * pitch) / PORT_SPACING,
				);
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

function routeEndpoints(
	route: RoutedEdge,
	portOffsets: ReadonlyMap<string, number>,
): { start: ScenePoint; end: ScenePoint } {
	const { edge, source, sourceEdge, target, targetEdge } = route;
	return {
		start: pointOnEdge(
			source,
			sourceEdge,
			portOffsets.get(connectionKey({ edgeId: edge.id, endpoint: "source" })) ?? 0,
		),
		end: pointOnEdge(
			target,
			targetEdge,
			portOffsets.get(connectionKey({ edgeId: edge.id, endpoint: "target" })) ?? 0,
		),
	};
}

/** Size the dimension along each assigned side before offsets can be clamped. */
function portCapacityForRoutes(
	routes: readonly RoutedEdge[],
	offsets: ReadonlyMap<string, number>,
): Map<string, { width: number; height: number }> {
	const sizes = new Map<string, { width: number; height: number }>();
	for (const route of routes) {
		for (const endpoint of ["source", "target"] as const) {
			const node = route[endpoint];
			const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
			const dimension = side === "top" || side === "bottom" ? "width" : "height";
			const required =
				2 *
				(PORT_PADDING +
					Math.abs(offsets.get(connectionKey({ edgeId: route.edge.id, endpoint })) ?? 0));
			if (required <= (sizes.get(node.nodeId)?.[dimension] ?? node[dimension])) continue;
			const size = sizes.get(node.nodeId) ?? { width: node.width, height: node.height };
			size[dimension] = required;
			sizes.set(node.nodeId, size);
		}
	}
	return sizes;
}

/** A direct segment has no intermediate bends; test diagonals as well as axis-aligned lines. */
function directSegmentCrossesNode(
	start: ScenePoint,
	end: ScenePoint,
	node: NodeSceneElement,
): boolean {
	let enter = 0,
		leave = 1;
	for (const [coordinate, size] of [
		["x", "width"],
		["y", "height"],
	] as const) {
		const minimum = node[coordinate] + AXIS_ALIGNED_EPSILON;
		const maximum = node[coordinate] + node[size] - AXIS_ALIGNED_EPSILON;
		const delta = end[coordinate] - start[coordinate];
		if (Math.abs(delta) <= AXIS_ALIGNED_EPSILON) {
			if (start[coordinate] <= minimum || start[coordinate] >= maximum) return false;
		} else {
			const a = (minimum - start[coordinate]) / delta;
			const b = (maximum - start[coordinate]) / delta;
			enter = Math.max(enter, Math.min(a, b));
			leave = Math.min(leave, Math.max(a, b));
		}
	}
	return enter < leave;
}

function directEndpointFacesOut(
	node: NodeSceneElement,
	side: ConnectionEdge,
	point: ScenePoint,
	other: ScenePoint,
): boolean {
	const x = (point.x - center(node).x) / (node.width / 2);
	const y = (point.y - center(node).y) / (node.height / 2);
	const normal =
		node.shape === "ellipse" || node.shape === "circle"
			? { x: x / node.width, y: y / node.height }
			: node.shape === "diamond"
				? { x: Math.sign(x) / node.width, y: Math.sign(y) / node.height }
				: {
						x: side === "left" ? -1 : side === "right" ? 1 : 0,
						y: side === "top" ? -1 : side === "bottom" ? 1 : 0,
					};
	return (
		(normal.x * (other.x - point.x) + normal.y * (other.y - point.y)) /
			Math.hypot(normal.x, normal.y) >=
		-AXIS_ALIGNED_EPSILON
	);
}

/** Collinear overlap also matters for diagonal direct edges, not just orthogonal segments. */
function directSegmentsOverlap(
	start: ScenePoint,
	end: ScenePoint,
	a: ScenePoint,
	b: ScenePoint,
): boolean {
	const dx = end.x - start.x,
		dy = end.y - start.y,
		length = Math.hypot(dx, dy);
	if (length <= AXIS_ALIGNED_EPSILON) return false;
	const distance = (p: ScenePoint) =>
		Math.abs(dx * (p.y - start.y) - dy * (p.x - start.x)) / length;
	if (distance(a) > AXIS_ALIGNED_EPSILON || distance(b) > AXIS_ALIGNED_EPSILON) return false;
	const projection = (p: ScenePoint) => ((p.x - start.x) * dx + (p.y - start.y) * dy) / length;
	const from = projection(a),
		to = projection(b);
	return (
		Math.min(length, Math.max(from, to)) - Math.max(0, Math.min(from, to)) > AXIS_ALIGNED_EPSILON
	);
}

/** Keep facing ports unless a direct feedback segment needs an obstacle-safe boundary pair. */
function assignDirectFeedbackPorts(
	routes: RoutedEdge[],
	diagram: IntermediateDiagram,
	nodes: readonly NodeSceneElement[],
): { offsets: Map<string, number>; minimumSizes: Map<string, { width: number; height: number }> } {
	const minimumSizes = new Map<string, { width: number; height: number }>();
	const buckets = edgeBuckets(diagram.edges);
	const feedback = feedbackEdgeIds(diagram, buckets.incoming, buckets.outgoing);
	const sides: ConnectionEdge[] =
		diagram.layout.direction === "TB" || diagram.layout.direction === "BT"
			? ["right", "left", "top", "bottom"]
			: ["bottom", "top", "left", "right"];
	// Reserve forward endpoints too: later feedback side changes must not move defaults
	// onto endpoints that an earlier candidate already checked and selected.
	const chosenOffsets = portOffsetsForRoutes(routes);
	for (const route of routes.filter((r) => feedback.has(r.edge.id))) {
		const original = { sourceEdge: route.sourceEdge, targetEdge: route.targetEdge };
		const sourceKey = connectionKey({ edgeId: route.edge.id, endpoint: "source" });
		const targetKey = connectionKey({ edgeId: route.edge.id, endpoint: "target" });
		let fallback:
			| { sides: typeof original; sourceOffset: number; targetOffset: number }
			| undefined;
		const sidePairs = [
			original,
			...sides.map((side) => ({ sourceEdge: side, targetEdge: side })),
			...sides.flatMap((sourceEdge) => sides.map((targetEdge) => ({ sourceEdge, targetEdge }))),
		];
		// Try every ordinary port pair before using inset boundary extremes.
		const candidates = [false, true].flatMap((spread) =>
			sidePairs.map((pair) => ({ ...pair, spread })),
		);
		let found = false;
		for (const candidate of candidates) {
			Object.assign(route, { sourceEdge: candidate.sourceEdge, targetEdge: candidate.targetEdge });
			const offsets = new Map(chosenOffsets);
			const alternatives = (node: NodeSceneElement, side: ConnectionEdge, key: string) => {
				const limit =
					(side === "top" || side === "bottom" ? node.width : node.height) / 2 - PORT_PADDING;
				return candidate.spread ? [offsets.get(key) ?? 0, -limit, limit] : [offsets.get(key) ?? 0];
			};
			const sourceOffsets = alternatives(route.source, route.sourceEdge, sourceKey);
			const targetOffsets = alternatives(route.target, route.targetEdge, targetKey);
			for (const sourceOffset of sourceOffsets) {
				for (const targetOffset of targetOffsets) {
					offsets.set(sourceKey, sourceOffset);
					offsets.set(targetKey, targetOffset);
					const { start, end } = routeEndpoints(route, offsets);
					if (
						!directEndpointFacesOut(route.source, route.sourceEdge, start, end) ||
						!directEndpointFacesOut(route.target, route.targetEdge, end, start)
					)
						continue;
					if (
						nodes.some(
							(n) =>
								n !== route.source && n !== route.target && directSegmentCrossesNode(start, end, n),
						)
					)
						continue;
					if (
						routes.some((other) => {
							if (other === route) return false;
							const { start: a, end: b } = routeEndpoints(other, offsets);
							const sharedPoint = [
								[route.source, start, other.source, a],
								[route.source, start, other.target, b],
								[route.target, end, other.source, a],
								[route.target, end, other.target, b],
							] as const;
							return (
								sharedPoint.some(
									([node, p, otherNode, q]) =>
										node === otherNode && Math.hypot(p.x - q.x, p.y - q.y) <= AXIS_ALIGNED_EPSILON,
								) || directSegmentsOverlap(start, end, a, b)
							);
						})
					)
						continue;
					const labelObstacles = branchLabelObstacles(routes, offsets);
					const ownLabel = labelObstacles.find(
						(label) => label.nodeId === `branch-label:${route.edge.id}`,
					);
					if (ownLabel && directSegmentCrossesNode(start, end, ownLabel)) continue;
					fallback ??= { sides: candidate, sourceOffset, targetOffset };
					if (
						labelObstacles.some(
							(label) =>
								label.nodeId !== `branch-label:${route.edge.id}` &&
								directSegmentCrossesNode(start, end, label),
						)
					)
						continue;
					chosenOffsets.set(sourceKey, sourceOffset);
					chosenOffsets.set(targetKey, targetOffset);
					found = true;
					break;
				}
				if (found) break;
			}
			if (found) break;
		}
		if (!found) {
			Object.assign(route, fallback?.sides ?? original);
			if (fallback) {
				chosenOffsets.set(sourceKey, fallback.sourceOffset);
				chosenOffsets.set(targetKey, fallback.targetOffset);
			} else {
				const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
				const coordinate = vertical ? "x" : "y",
					dimension = vertical ? "width" : "height";
				const origin = center(route.source)[coordinate];
				const extent = Math.max(
					...nodes.flatMap((n) => [
						Math.abs(n[coordinate] - origin),
						Math.abs(n[coordinate] + n[dimension] - origin),
					]),
				);
				minimumSizes.set(route.source.nodeId, {
					width: route.source.width,
					height: route.source.height,
					[dimension]: 2 * (extent + PORT_PADDING + PORT_SPACING),
				});
			}
		}
	}
	return { offsets: chosenOffsets, minimumSizes };
}

/** Reserve fixed endpoint approaches before any route can occupy a later route's stub. */
function endpointStubsForRoutes(
	routes: readonly RoutedEdge[],
	portOffsets: ReadonlyMap<string, number>,
): ArrowSceneElement[] {
	return routes.flatMap((route): ArrowSceneElement[] => {
		const { start, end } = routeEndpoints(route, portOffsets);
		const arrow = {
			type: "arrow" as const,
			id: `edge:${route.edge.id}`,
			edgeId: route.edge.id,
			sourceNodeId: route.edge.source,
			targetNodeId: route.edge.target,
		};
		return [
			{
				...arrow,
				points: [
					start,
					pointAwayFromEdge(
						start,
						route.sourceEdge,
						sourceStubLength(route, start, ROUTE_STUB_LENGTH),
					),
				],
			},
			{
				...arrow,
				points: [
					pointAwayFromEdge(
						end,
						route.targetEdge,
						endpointClearance(route.target, end, route.targetEdge, ROUTE_STUB_LENGTH),
					),
					end,
				],
			},
		];
	});
}

function arrowForRoute(
	route: RoutedEdge,
	edgeRouting: IntermediateDiagram["layout"]["edgeRouting"],
	portOffsets: ReadonlyMap<string, number>,
	shapes: readonly NodeSceneElement[],
	existingArrows: readonly ArrowSceneElement[],
): ArrowSceneElement {
	const { edge } = route;
	const { start: portedStart, end: portedEnd } = routeEndpoints(route, portOffsets);
	const points =
		edgeRouting === "orthogonal"
			? exteriorLaneRoute(route, portedStart, portedEnd, shapes, existingArrows)
			: compactPoints([portedStart, portedEnd]);

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

function pointInsideBounds(point: ScenePoint, shape: NodeSceneElement): boolean {
	return (
		point.x >= shape.x &&
		point.x <= shape.x + shape.width &&
		point.y >= shape.y &&
		point.y <= shape.y + shape.height
	);
}

function routeNodeCrossingCount(
	points: readonly ScenePoint[],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
): number {
	let crossingCount = 0;

	for (const [index, segment] of segmentsFromPoints(points).entries()) {
		for (const shape of shapes) {
			const endpointStub =
				ignoredNodeIds.has(shape.nodeId) &&
				((index === 0 && pointInsideBounds(points[0]!, shape)) ||
					(index === points.length - 2 && pointInsideBounds(points.at(-1)!, shape)));
			if (!endpointStub && segmentCrossesBoundsInterior(segment, shape)) {
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
			if (candidate.arrowId === existing.arrowId || !segmentsOverlapInterior(candidate, existing)) {
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
			return candidate.x === edgePoint.x && edgePoint.y - candidate.y >= ROUTE_STUB_LENGTH;
		case "right":
			return candidate.y === edgePoint.y && candidate.x - edgePoint.x >= ROUTE_STUB_LENGTH;
		case "bottom":
			return candidate.x === edgePoint.x && candidate.y - edgePoint.y >= ROUTE_STUB_LENGTH;
		case "left":
			return candidate.y === edgePoint.y && edgePoint.x - candidate.x >= ROUTE_STUB_LENGTH;
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
		-endpointStubScore(candidate, route),
		routeNodeCrossingCount(candidate, shapes, ignoredNodeIds),
		routeSelfOverlapCount(candidate, route),
		routeArrowOverlapCount(candidate, existingArrows, route),
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

/** Clear the bounding box even when the port is inset on a diamond or ellipse. */
function endpointClearance(
	shape: NodeSceneElement,
	point: ScenePoint,
	side: ConnectionEdge,
	distance: number,
): number {
	switch (side) {
		case "left":
			return distance + point.x - shape.x;
		case "right":
			return distance + shape.x + shape.width - point.x;
		case "top":
			return distance + point.y - shape.y;
		case "bottom":
			return distance + shape.y + shape.height - point.y;
	}
}

function sourceStubLength(route: RoutedEdge, point: ScenePoint, distance: number): number {
	const labelSpace = route.edge.label
		? route.sourceEdge === "left" || route.sourceEdge === "right"
			? branchLabelMetrics(route.edge.label, route.source.kind === "decision" ? 80 : 160).width + 16
			: Math.max(
					40,
					branchLabelMetrics(route.edge.label, route.source.kind === "decision" ? 80 : 160).height +
						24,
				)
		: 0;
	return endpointClearance(route.source, point, route.sourceEdge, Math.max(distance, labelSpace));
}

function assignDecisionSides(
	routes: RoutedEdge[],
	direction: IntermediateDiagram["layout"]["direction"],
): void {
	if (direction !== "TB" && direction !== "BT") return;
	for (const source of new Set(
		routes.filter((r) => r.source.kind === "decision").map((r) => r.source),
	)) {
		const branches = routes
			.filter((r) => r.source === source)
			.sort(
				(a, b) =>
					center(a.target).x - center(b.target).x ||
					center(a.target).y - center(b.target).y ||
					a.index - b.index,
			);
		if (branches.length < 2) continue;
		branches.forEach((route, index) => {
			const alignedBranch = branches
				.filter((r) => Math.abs(center(r.target).x - center(source).x) < 1)
				.sort(
					(a, b) =>
						Math.abs(center(a.target).y - center(source).y) -
						Math.abs(center(b.target).y - center(source).y),
				)[0];
			const aligned = branches.length === 2 && route === alignedBranch;
			const otherAligned = branches.length === 2 && alignedBranch !== undefined && !aligned;
			route.sourceEdge = aligned
				? direction === "TB"
					? "bottom"
					: "top"
				: otherAligned
					? center(route.target).x < center(source).x
						? "left"
						: "right"
					: index === 0
						? "left"
						: index === branches.length - 1
							? "right"
							: direction === "TB"
								? "bottom"
								: "top";
		});
	}
}

/** Feedback uses a lateral lane, not the forward departure/arrival side. */
function assignFeedbackSides(routes: RoutedEdge[], diagram: IntermediateDiagram): void {
	const buckets = edgeBuckets(diagram.edges);
	const feedback = feedbackEdgeIds(diagram, buckets.incoming, buckets.outgoing);
	const horizontal = diagram.layout.direction === "LR" || diagram.layout.direction === "RL";
	for (const route of routes.filter((r) => feedback.has(r.edge.id))) {
		const before = horizontal
			? center(route.source).y < center(route.target).y
			: center(route.source).x < center(route.target).x;
		const lateral: ConnectionEdge[] = horizontal
			? before
				? ["top", "bottom"]
				: ["bottom", "top"]
			: before
				? ["left", "right"]
				: ["right", "left"];
		const candidates: ConnectionEdge[] = [
			...lateral,
			...(horizontal ? (["left", "right"] as const) : (["top", "bottom"] as const)),
		];
		const departures = new Set(
			routes.filter((r) => r !== route && r.source === route.target).map((r) => r.sourceEdge),
		);
		const arrivals = new Set(
			routes.filter((r) => r !== route && r.target === route.source).map((r) => r.targetEdge),
		);
		const targetArrivals = new Set(
			routes.filter((r) => r !== route && r.target === route.target).map((r) => r.targetEdge),
		);
		const siblingDepartures = new Set(
			routes.filter((r) => r !== route && r.source === route.source).map((r) => r.sourceEdge),
		);
		const sourceCandidates =
			route.source.kind === "decision" ? [route.sourceEdge, ...candidates] : candidates;
		route.targetEdge =
			candidates.find((side) => !departures.has(side) && !targetArrivals.has(side)) ??
			candidates.find((side) => !departures.has(side)) ??
			route.targetEdge;
		route.sourceEdge =
			sourceCandidates.find(
				(side) =>
					!arrivals.has(side) &&
					(route.source.kind !== "decision" || !siblingDepartures.has(side)) &&
					(route.source !== route.target || side !== route.targetEdge),
			) ?? route.sourceEdge;
	}
}

function branchLabelMetrics(label: string, maxWidth = 160): { width: number; height: number } {
	const text = wrapTextToWidth(label, maxWidth, 13);
	return {
		width: boundLabelWidth(text, 13, maxWidth),
		height: Math.ceil(text.split("\n").length * 13 * 1.35),
	};
}

function branchLabelPosition(route: RoutedEdge, start: ScenePoint): ScenePoint {
	const stub = pointAwayFromEdge(
		start,
		route.sourceEdge,
		sourceStubLength(route, start, ROUTE_STUB_LENGTH),
	);
	const horizontal = route.sourceEdge === "left" || route.sourceEdge === "right";
	return {
		x:
			(start.x + stub.x) / 2 +
			(horizontal
				? 0
				: branchLabelMetrics(route.edge.label ?? "", route.source.kind === "decision" ? 80 : 160)
						.width /
						2 +
					8),
		y:
			(start.y + stub.y) / 2 -
			(horizontal
				? branchLabelMetrics(route.edge.label ?? "", route.source.kind === "decision" ? 80 : 160)
						.height /
						2 +
					5
				: 0),
	};
}

function branchLabelObstacles(
	routes: readonly RoutedEdge[],
	offsets: ReadonlyMap<string, number>,
): NodeSceneElement[] {
	return routes
		.filter((route) => route.edge.label)
		.map((route) => {
			const start = pointOnEdge(
				route.source,
				route.sourceEdge,
				offsets.get(connectionKey({ edgeId: route.edge.id, endpoint: "source" })) ?? 0,
			);
			const position = branchLabelPosition(route, start);
			const metrics = branchLabelMetrics(
				route.edge.label!,
				route.source.kind === "decision" ? 80 : 160,
			);
			const width = metrics.width + 12;
			return {
				...route.source,
				id: `branch-label:${route.edge.id}`,
				nodeId: `branch-label:${route.edge.id}`,
				x: position.x - width / 2,
				y: position.y - metrics.height / 2 - 4,
				width,
				height: metrics.height + 8,
				shape: "rectangle",
			};
		});
}

/** Unbound, grouped text keeps its authored stub position through Excalidraw export. */
function branchLabels(
	arrows: ArrowSceneElement[],
	routes: readonly RoutedEdge[],
): TextSceneElement[] {
	const labels: TextSceneElement[] = [];
	for (const [index, arrow] of arrows.entries()) {
		if (!arrow.label) continue;
		const position = branchLabelPosition(routes[index]!, arrow.points[0]);
		const groupIds = [`branch:${arrow.edgeId}`];
		labels.push({
			type: "text",
			id: `${arrow.id}:label`,
			text: arrow.label,
			fontSize: 13,
			x: position.x,
			y: position.y,
			maxWidth: routes[index]?.source.kind === "decision" ? 80 : 160,
			groupIds,
		});
		arrows[index] = { ...arrow, groupIds };
	}
	return labels;
}

/** A visibility grid is the fallback when one exterior lane cannot clear every obstacle. */
function obstacleRoute(
	start: ScenePoint,
	end: ScenePoint,
	startStub: ScenePoint,
	endStub: ScenePoint,
	shapes: readonly NodeSceneElement[],
	route: RoutedEdge,
	arrows: readonly ArrowSceneElement[],
): [ScenePoint, ...ScenePoint[]] | undefined {
	const xs = [
		...new Set([
			startStub.x,
			endStub.x,
			...shapes.flatMap((s) => [s.x - PORT_SPACING, s.x + s.width + PORT_SPACING]),
			...arrows.flatMap((a) => a.points.flatMap((p) => [p.x - PORT_SPACING, p.x + PORT_SPACING])),
		]),
	].sort((a, b) => a - b);
	const ys = [
		...new Set([
			startStub.y,
			endStub.y,
			...shapes.flatMap((s) => [s.y - PORT_SPACING, s.y + s.height + PORT_SPACING]),
			...arrows.flatMap((a) => a.points.flatMap((p) => [p.y - PORT_SPACING, p.y + PORT_SPACING])),
		]),
	].sort((a, b) => a - b);
	const key = (x: number, y: number, axis: number) => `${x}:${y}:${axis}`;
	type Step = { x: number; y: number; axis: number; cost: number; previous?: Step };
	const initial: Step = {
		x: xs.indexOf(startStub.x),
		y: ys.indexOf(startStub.y),
		axis: start.x === startStub.x ? 1 : 0,
		cost: 0,
	};
	const pending = [initial];
	const costs = new Map<string, number>([[key(initial.x, initial.y, initial.axis), 0]]);
	while (pending.length) {
		pending.sort((a, b) => b.cost - a.cost);
		const current = pending.pop()!;
		if (current.cost !== costs.get(key(current.x, current.y, current.axis))) continue;
		const point = { x: xs[current.x]!, y: ys[current.y]! };
		if (point.x === endStub.x && point.y === endStub.y) {
			const path: ScenePoint[] = [];
			for (let step: Step | undefined = current; step; step = step.previous)
				path.unshift({ x: xs[step.x]!, y: ys[step.y]! });
			const corners = path.filter(
				(p, i) =>
					i === 0 ||
					i === path.length - 1 ||
					!(
						(path[i - 1]!.x === p.x && p.x === path[i + 1]!.x) ||
						(path[i - 1]!.y === p.y && p.y === path[i + 1]!.y)
					),
			);
			return compactPoints([start, ...corners, end]);
		}
		for (const [dx, dy, axis] of [
			[-1, 0, 0],
			[1, 0, 0],
			[0, -1, 1],
			[0, 1, 1],
		] as const) {
			const x = current.x + dx,
				y = current.y + dy;
			if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
			const next = { x: xs[x]!, y: ys[y]! };
			const segment = segmentsFromPoints([point, next], 0)[0]!;
			if (shapes.some((shape) => segmentCrossesBoundsInterior(segment, shape))) continue;
			// Neither the departure nor the arrival may double back over its port stub.
			if (
				[...segmentsFromPoints([start, startStub]), ...segmentsFromPoints([endStub, end])].some(
					(stub) => segmentsOverlapInterior(segment, stub),
				)
			)
				continue;
			const cost =
				current.cost +
				Math.abs(next.x - point.x) +
				Math.abs(next.y - point.y) +
				(axis === current.axis ? 0 : 24) +
				routeArrowOverlapCount([point, next], arrows, route) * 10000;
			const id = key(x, y, axis);
			if (cost >= (costs.get(id) ?? Infinity)) continue;
			costs.set(id, cost);
			pending.push({ x, y, axis, cost, previous: current });
		}
	}
	return undefined;
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
	const useUpperLane = center(route.target).y < center(route.source).y;
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
	const stubDistances = [localStubDistance];
	const routeForVerticalLane = (laneX: number, stubDistance: number) => {
		const startStub =
			stubDistance > 0
				? pointAwayFromEdge(
						start,
						route.sourceEdge,
						sourceStubLength(route, start, ROUTE_STUB_LENGTH),
					)
				: start;
		const endStub =
			stubDistance > 0
				? pointAwayFromEdge(
						end,
						route.targetEdge,
						endpointClearance(route.target, end, route.targetEdge, stubDistance),
					)
				: end;

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
			stubDistance > 0
				? pointAwayFromEdge(
						start,
						route.sourceEdge,
						sourceStubLength(route, start, ROUTE_STUB_LENGTH),
					)
				: start;
		const endStub =
			stubDistance > 0
				? pointAwayFromEdge(
						end,
						route.targetEdge,
						endpointClearance(route.target, end, route.targetEdge, stubDistance),
					)
				: end;

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
	const startStub = pointAwayFromEdge(
		start,
		route.sourceEdge,
		sourceStubLength(route, start, ROUTE_STUB_LENGTH),
	);
	const endStub = pointAwayFromEdge(
		end,
		route.targetEdge,
		endpointClearance(route.target, end, route.targetEdge, ROUTE_STUB_LENGTH),
	);
	const candidates = [
		compactPoints([start, end]),
		compactPoints([start, startStub, { x: startStub.x, y: endStub.y }, endStub, end]),
		compactPoints([start, startStub, { x: endStub.x, y: startStub.y }, endStub, end]),
		...lanes.flatMap(([lane, generator]) =>
			stubDistances.map((distance) => generator(lane, distance)),
		),
	];

	const best = chooseBestRoute(candidates, shapes, ignoredNodeIds, route, existingArrows);
	if (
		routeNodeCrossingCount(best, shapes, ignoredNodeIds) ||
		routeSelfOverlapCount(best, route) ||
		routeArrowOverlapCount(best, existingArrows, route)
	) {
		const detour = obstacleRoute(start, end, startStub, endStub, shapes, route, existingArrows);
		if (detour)
			return chooseBestRoute([best, detour], shapes, ignoredNodeIds, route, existingArrows);
	}
	return best;
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
	let nodeShapes = positionNodes(diagram);
	const shapesByNodeId = new Map(nodeShapes.map((shape) => [shape.nodeId, shape]));
	const routedEdges = diagram.edges.map((edge, index) =>
		routeForEdge(edge, index, shapesByNodeId, diagram.layout.direction),
	);
	assignDecisionSides(routedEdges, diagram.layout.direction);
	let portOffsets: Map<string, number>;
	let capacity: Map<string, { width: number; height: number }>;
	if (diagram.layout.edgeRouting === "orthogonal") {
		assignFeedbackSides(routedEdges, diagram);
		portOffsets = portOffsetsForRoutes(routedEdges);
		capacity = portCapacityForRoutes(routedEdges, portOffsets);
	} else {
		const direct = assignDirectFeedbackPorts(routedEdges, diagram, nodeShapes);
		portOffsets = direct.offsets;
		capacity = direct.minimumSizes;
	}
	if (capacity.size > 0) {
		nodeShapes = positionNodes(diagram, capacity);
		const resized = new Map(nodeShapes.map((node) => [node.nodeId, node]));
		for (const route of routedEdges) {
			route.source = resized.get(route.source.nodeId)!;
			route.target = resized.get(route.target.nodeId)!;
			if (diagram.layout.edgeRouting !== "orthogonal")
				Object.assign(route, connectionEdges(route.source, route.target, diagram.layout.direction));
		}
		if (diagram.layout.edgeRouting === "orthogonal")
			portOffsets = portOffsetsForRoutes(routedEdges);
		else {
			assignDecisionSides(routedEdges, diagram.layout.direction);
			portOffsets = assignDirectFeedbackPorts(routedEdges, diagram, nodeShapes).offsets;
		}
	}
	const labelObstacles = branchLabelObstacles(routedEdges, portOffsets);
	const endpointStubs =
		diagram.layout.edgeRouting === "orthogonal"
			? endpointStubsForRoutes(routedEdges, portOffsets)
			: [];
	const edgeArrows: ArrowSceneElement[] = [];
	for (const route of routedEdges) {
		edgeArrows.push(
			arrowForRoute(
				route,
				diagram.layout.edgeRouting,
				portOffsets,
				[
					...nodeShapes,
					...labelObstacles.filter((label) => label.nodeId !== `branch-label:${route.edge.id}`),
				],
				[...endpointStubs, ...edgeArrows],
			),
		);
	}
	const labels = [...nodeShapes.map(textForNode), ...branchLabels(edgeArrows, routedEdges)];
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
