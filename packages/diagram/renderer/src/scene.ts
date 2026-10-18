import {
	CANVAS_NODE_ICON,
	CANVAS_SPEC_VERSION,
	AXIS_ALIGNED_EPSILON,
	canvasBoundTextBox,
	canvasNodeIconBand,
	type AxisAlignedSegment,
	CANVAS_FRAME_NAME,
	canvasFrameNameBox,
	canvasFrameNameWidth,
	GROUP_OUTLINE_CLEARANCE,
	segmentCrossesBoundsInterior,
	isSharedBoundStem,
	segmentOverlapLength,
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
	type DiagramGroup,
	type DiagramNode,
	estimateTextWidth,
	wrapTextToWidth,
	wrappedLabelWidth,
	type IntermediateDiagram,
	parseIntermediateDiagram,
	candidateRouteQuality,
	routingCorridorGap,
	routingQualityFindings,
	routingQualityScale,
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
/** Sketchi PNG export padding per side (browser-renderer EXPORT_PADDING). */
const EXPORT_PADDING = 20;
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
/** Grid-search expansions spent looking for a lane clear of a near-parallel neighbor. */
const CORRIDOR_SEARCH_STEPS = 5_000;

type ConnectionEdge = "top" | "right" | "bottom" | "left";

interface RoutedEdge {
	edge: DiagramEdge;
	index: number;
	/** A wrap continuation's lane between its bands, across the flow. */
	lane?: number;
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

/** Feedback edges by diagram, including the sub-diagrams a grouped layout places. */
const flowFeedbacks = new WeakMap<IntermediateDiagram, ReadonlySet<string>>();

/**
 * Edges that run against the flow as laid out. A grouped diagram lays each
 * group out as one block, so its edges run back where the blocks or a group's
 * own flow turn back; an ungrouped diagram breaks cycles from its start.
 */
function flowFeedback(diagram: IntermediateDiagram): ReadonlySet<string> {
	let feedback = flowFeedbacks.get(diagram);
	if (feedback) return feedback;
	groupStructure(diagram);
	feedback = flowFeedbacks.get(diagram);
	if (feedback) return feedback;
	const buckets = edgeBuckets(diagram.edges);
	feedback = feedbackEdgeIds(diagram, buckets.incoming, buckets.outgoing);
	flowFeedbacks.set(diagram, feedback);
	return feedback;
}

/** Inner padding of a group's frame around its members. */
const GROUP_PADDING = 40;
/** The band above each frame that keeps Excalidraw's frame name clear. */
const GROUP_LABEL_BAND = 28;
/** Thickness of the walls that keep a group's own edges inside its frame. */
const GROUP_WALL = 4;
const GROUP_UNIT_PREFIX = "\u0000group:";

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** One drawn group: its frame and the keep-out box of the frame's name. */
interface GroupFrame {
	readonly box: Box;
	readonly elementId: string;
	readonly id: string;
	readonly label: string;
	readonly labelBox: Box;
}

interface GroupLayout {
	readonly frames: readonly GroupFrame[];
	readonly groupOf: ReadonlyMap<string, string>;
}

/**
 * A grouped diagram as nested layouts: each group's members and internal edges,
 * and a top level where every group is one block among the ungrouped nodes.
 */
interface GroupStructure {
	/** The edges between top-level units, in the order of the top level's edges. */
	readonly crossEdges: readonly DiagramEdge[];
	readonly groupOf: ReadonlyMap<string, string>;
	readonly groups: readonly {
		/** The same members and edges, read across the diagram's flow. */
		readonly across: IntermediateDiagram;
		readonly diagram: IntermediateDiagram;
		readonly group: DiagramGroup;
	}[];
	readonly top: IntermediateDiagram;
}

const groupStructures = new WeakMap<IntermediateDiagram, GroupStructure | null>();

function groupUnitId(groupId: string): string {
	return `${GROUP_UNIT_PREFIX}${groupId}`;
}

/** The nested layouts of a diagram whose declared groups hold nodes; undefined otherwise. */
function groupStructure(diagram: IntermediateDiagram): GroupStructure | undefined {
	const cached = groupStructures.get(diagram);
	if (cached !== undefined) return cached ?? undefined;
	const groups = (diagram.groups ?? []).filter((group) =>
		diagram.nodes.some((node) => node.group === group.id),
	);
	if (groups.length === 0) {
		groupStructures.set(diagram, null);
		return undefined;
	}
	const declared = new Set(groups.map((group) => group.id));
	const groupOf = new Map(
		diagram.nodes.flatMap((node) =>
			node.group !== undefined && declared.has(node.group) ? [[node.id, node.group] as const] : [],
		),
	);
	const unitOf = (nodeId: string) => {
		const group = groupOf.get(nodeId);
		return group === undefined ? nodeId : groupUnitId(group);
	};
	// Inside a group, loops break where the whole flow breaks them, so a group
	// reads in the same direction as the diagram around it.
	const buckets = edgeBuckets(diagram.edges);
	const global = feedbackEdgeIds(diagram, buckets.incoming, buckets.outgoing);
	const feedback = new Set<string>();
	const nested = groups.map((group) => {
		const edges = diagram.edges.filter(
			(edge) => groupOf.get(edge.source) === group.id && groupOf.get(edge.target) === group.id,
		);
		const inner = {
			...diagram,
			groups: [],
			nodes: diagram.nodes.filter((node) => groupOf.get(node.id) === group.id),
			edges,
		} as IntermediateDiagram;
		const across = {
			...inner,
			layout: { ...diagram.layout, direction: ACROSS_DIRECTION[diagram.layout.direction] },
		} as IntermediateDiagram;
		const innerFeedback = new Set(edges.flatMap((edge) => (global.has(edge.id) ? [edge.id] : [])));
		flowFeedbacks.set(inner, innerFeedback);
		flowFeedbacks.set(across, innerFeedback);
		for (const id of innerFeedback) feedback.add(id);
		return { across, diagram: inner, group };
	});
	const units: DiagramNode[] = [];
	const placed = new Set<string>();
	for (const node of diagram.nodes) {
		const unit = unitOf(node.id);
		if (placed.has(unit)) continue;
		placed.add(unit);
		const group = groupOf.get(node.id);
		units.push(
			group === undefined
				? node
				: {
						id: unit,
						label: groups.find((candidate) => candidate.id === group)!.label,
						kind: "process",
						metadata: {},
					},
		);
	}
	const crossEdges = diagram.edges.filter((edge) => unitOf(edge.source) !== unitOf(edge.target));
	const top = {
		...diagram,
		groups: [],
		nodes: units,
		edges: crossEdges.map((edge) => ({
			...edge,
			source: unitOf(edge.source),
			target: unitOf(edge.target),
		})),
	} as IntermediateDiagram;
	const topBuckets = edgeBuckets(top.edges);
	const topFeedback = feedbackEdgeIds(top, topBuckets.incoming, topBuckets.outgoing);
	flowFeedbacks.set(top, topFeedback);
	for (const id of topFeedback) feedback.add(id);
	flowFeedbacks.set(diagram, feedback);
	const structure = { crossEdges, groupOf, groups: nested, top };
	groupStructures.set(diagram, structure);
	return structure;
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
	reorder = false,
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

	return reorder
		? reduceRankCrossings(rankedShapes, diagram, rankByNodeId, feedbackEdges)
		: rankedShapes;
}

/** Sweeps of barycentric reordering and adjacent swaps between rank layers. */
const CROSSING_SWEEPS = 8;
/**
 * Crossing repairs (reordered ranks, moved arrivals) each route the diagram once
 * more; denser diagrams keep a single routing pass.
 */
const CROSSING_REPAIR_MAX_EDGES = 24;
/** Reduced rank orders by diagram; they depend on the graph, not on node sizes. */
const reducedOrders = new WeakMap<IntermediateDiagram, ReadonlyMap<number, readonly string[]>>();

/**
 * Reorder ranks where that removes crossings the barycenter pass leaves: loops
 * count as forward edges, and an edge that skips ranks counts at every rank it
 * passes. A layout changes only when the layered crossings strictly drop.
 */
function reduceRankCrossings(
	rankedShapes: Map<number, NodeSceneElement[]>,
	diagram: IntermediateDiagram,
	rankByNodeId: ReadonlyMap<string, number>,
	feedbackEdges: ReadonlySet<string>,
): Map<number, NodeSceneElement[]> {
	let reduced = reducedOrders.get(diagram);
	if (!reduced) {
		reduced = reducedRankOrder(
			new Map(
				[...rankedShapes].map(([rank, shapes]) => [rank, shapes.map((shape) => shape.nodeId)]),
			),
			diagram,
			rankByNodeId,
			feedbackEdges,
		);
		reducedOrders.set(diagram, reduced);
	}
	const shapes = new Map([...rankedShapes.values()].flat().map((shape) => [shape.nodeId, shape]));
	return new Map(
		[...rankedShapes.keys()].map((rank) => [
			rank,
			(reduced.get(rank) ?? []).flatMap((id) => (shapes.has(id) ? [shapes.get(id)!] : [])),
		]),
	);
}

function reducedRankOrder(
	order: Map<number, string[]>,
	diagram: IntermediateDiagram,
	rankByNodeId: ReadonlyMap<string, number>,
	feedbackEdges: ReadonlySet<string>,
): ReadonlyMap<number, readonly string[]> {
	// Links between consecutive ranks, keyed by the upper rank. Virtual nodes carry
	// skipping edges through the ranks between their ends.
	const links = new Map<number, (readonly [string, string])[]>();
	const virtual = new Set<string>();
	const link = (upper: string, lower: string, rank: number) =>
		links.set(rank, [...(links.get(rank) ?? []), [upper, lower]]);
	for (const edge of diagram.edges) {
		const [from, to] = feedbackEdges.has(edge.id)
			? [edge.target, edge.source]
			: [edge.source, edge.target];
		const [upper, lower] =
			(rankByNodeId.get(from) ?? 0) <= (rankByNodeId.get(to) ?? 0) ? [from, to] : [to, from];
		const top = rankByNodeId.get(upper) ?? 0;
		const bottom = rankByNodeId.get(lower) ?? 0;
		if (top === bottom) continue;
		let previous = upper;
		for (let rank = top + 1; rank < bottom; rank += 1) {
			// A virtual node starts under its upper neighbor's relative position.
			const id = `\u0000${edge.id}\u0000${rank}`;
			virtual.add(id);
			const above = order.get(rank - 1)!;
			const ids = order.get(rank)!;
			ids.splice(Math.round(((above.indexOf(previous) + 0.5) / above.length) * ids.length), 0, id);
			link(previous, id, rank - 1);
			previous = id;
		}
		link(previous, lower, bottom - 1);
	}
	const position = new Map<string, number>();
	const place = (rank: number) => order.get(rank)?.forEach((id, index) => position.set(id, index));
	const ranks = [...order.keys()].sort((a, b) => a - b);
	ranks.forEach(place);
	const between = (rank: number) => {
		const pairs = links.get(rank) ?? [];
		let crossings = 0;
		for (const [index, [upper, lower]] of pairs.entries())
			for (const [otherUpper, otherLower] of pairs.slice(index + 1))
				if (
					(position.get(upper)! - position.get(otherUpper)!) *
						(position.get(lower)! - position.get(otherLower)!) <
					0
				)
					crossings += 1;
		return crossings;
	};
	const total = () => ranks.reduce((sum, rank) => sum + between(rank), 0);
	const initial = total();
	const real = () =>
		new Map([...order].map(([rank, ids]) => [rank, ids.filter((id) => !virtual.has(id))]));
	const plain = real();
	if (initial === 0) return plain;

	const neighbors = new Map<string, { above: string[]; below: string[] }>();
	for (const pairs of links.values())
		for (const [upper, lower] of pairs) {
			const up = neighbors.get(upper) ?? { above: [], below: [] };
			up.below.push(lower);
			neighbors.set(upper, up);
			const down = neighbors.get(lower) ?? { above: [], below: [] };
			down.above.push(upper);
			neighbors.set(lower, down);
		}
	let best = { crossings: initial, order: plain };
	for (let sweep = 0; sweep < CROSSING_SWEEPS && best.crossings > 0; sweep += 1) {
		const downward = sweep % 2 === 0;
		for (const rank of downward ? ranks.slice(1) : ranks.slice(0, -1).reverse()) {
			const ids = order.get(rank)!;
			const key = new Map(
				ids.map((id, index) => {
					const around = (downward ? neighbors.get(id)?.above : neighbors.get(id)?.below) ?? [];
					return [
						id,
						around.length > 0
							? around.reduce((sum, other) => sum + position.get(other)!, 0) / around.length
							: index,
					];
				}),
			);
			ids.sort((a, b) => key.get(a)! - key.get(b)!);
			place(rank);
		}
		// Swap neighbors in a rank while that removes crossings with the ranks beside it.
		for (let improved = true; improved;) {
			improved = false;
			for (const rank of ranks) {
				const ids = order.get(rank)!;
				for (let index = 0; index + 1 < ids.length; index += 1) {
					const before = between(rank - 1) + between(rank);
					[ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
					place(rank);
					if (between(rank - 1) + between(rank) < before) improved = true;
					else {
						[ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
						place(rank);
					}
				}
			}
		}
		const crossings = total();
		if (crossings < best.crossings) best = { crossings, order: real() };
	}
	return best.order;
}

interface RankMetric {
	readonly breadth: number;
	readonly depth: number;
	readonly rank: number;
	readonly shapes: readonly NodeSceneElement[];
}

const FORWARD_SIDE: Readonly<Record<IntermediateDiagram["layout"]["direction"], ConnectionEdge>> = {
	TB: "bottom",
	BT: "top",
	LR: "right",
	RL: "left",
};

/**
 * Ranks in flow order, each with its nodes ordered across the rank, its breadth
 * across the flow, its depth along it and the gap that follows it.
 */
function rankLayout(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	stubReach: ReadonlyMap<string, number>,
	reorder = false,
) {
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	// Neighbors in a rank keep room for the stubs on their facing sides, so a long
	// labeled stub never reaches the next node or meets its stub head-on.
	const [lowSide, highSide]: readonly [ConnectionEdge, ConnectionEdge] = vertical
		? ["left", "right"]
		: ["top", "bottom"];
	const gapBetween = (left: NodeSceneElement, right: NodeSceneElement) =>
		Math.max(
			HORIZONTAL_GAP,
			(stubReach.get(portKey(left.nodeId, highSide)) ?? 0) +
				(stubReach.get(portKey(right.nodeId, lowSide)) ?? 0) +
				PORT_SPACING,
		);
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
	const feedbackEdges = flowFeedback(diagram);
	const rankByNodeId = rankNodes(diagram, buckets, feedbackEdges);
	const rankedShapes = orderedRankShapes(
		diagram,
		shapesByNodeId,
		rankByNodeId,
		buckets,
		feedbackEdges,
		reorder,
	);
	const ranks = Array.from(rankedShapes.entries()).sort(([left], [right]) => left - right);
	const rankMetrics: RankMetric[] = ranks.map(([rank, shapes]) => {
		const breadth = shapes.reduce(
			(sum, shape, index) =>
				sum +
				(vertical ? shape.width : shape.height) +
				(index > 0 ? gapBetween(shapes[index - 1]!, shape) : 0),
			0,
		);
		const depth = Math.max(...shapes.map((shape) => (vertical ? shape.height : shape.width)));

		return { breadth, depth, rank, shapes };
	});

	// Consecutive ranks keep room for the stubs on the sides that face each other.
	const forwardSide = FORWARD_SIDE[diagram.layout.direction];
	const reachOf = (shapes: readonly NodeSceneElement[], side: ConnectionEdge) =>
		Math.max(0, ...shapes.map((shape) => stubReach.get(portKey(shape.nodeId, side)) ?? 0));
	const gapAfter = rankMetrics.map((metric, rankIndex) => {
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
									shapesByNodeId.get(edge.source)?.kind === "decision",
								).width +
								16 +
								ROUTE_STUB_LENGTH * 2,
						),
				);
		const next = rankMetrics[rankIndex + 1];
		const stubGap =
			next && stubReach.size > 0
				? reachOf(metric.shapes, forwardSide) +
					reachOf(next.shapes, OPPOSITE_EDGE[forwardSide]) +
					PORT_SPACING
				: 0;
		return Math.max(VERTICAL_GAP, labelGap, stubGap);
	});

	return {
		feedbackEdges,
		gapAfter,
		gapBetween,
		highSide,
		lowSide,
		rankByNodeId,
		rankMetrics,
		reachOf,
		vertical,
	};
}

/**
 * Where a long flow wraps into further rows (LR and RL) or columns (TB and BT).
 * Bands are runs of whole ranks; each reads in the requested direction, and one
 * continuation edge carries the flow from a band's last rank to the next band.
 */
interface Wrap {
	readonly bandOf: ReadonlyMap<string, number>;
	readonly continuations: ReadonlySet<string>;
}

const NO_WRAP: Wrap = { bandOf: new Map(), continuations: new Set() };
/** Shorter flows never wrap; each band keeps at least two ranks. */
const WRAP_MIN_RANKS = 5;
/** A flow wraps when it runs at least this many times longer than it is broad... */
const WRAP_EXTREME_ASPECT = 4;
/**
 * ...or about 2.5 times once fitting it to a 2000 px screen would shrink its
 * text: a row below about 24 px. A column reads naturally top to bottom, so it
 * wraps short of 4:1 only once its text would fall below 14 px...
 */
const WRAP_ASPECT = 2.45;
const WRAP_MIN_LENGTH = 1200;
const FITTED_LONG_SIDE = 2000;
const WRAP_MIN_COLUMN_TEXT = 14;
/** ...into the fewest bands that bring it within this, if any do. */
const WRAP_TARGET_ASPECT = 2;
const MAX_BANDS = 6;
/** Bands sit farther apart than ranks so each reads as its own row or column. */
const BAND_GAP = 144;

/**
 * Whole-layout choices, each kept only if it routes no worse than the layout
 * without it. With all of them off, the layout is the polished router's alone.
 */
interface Arrangement {
	/**
	 * Order arrivals on a side by where each route leaves its source, and move an
	 * arrival crossed on its final approach to the side it comes from.
	 */
	readonly crossingRepair: boolean;
	/**
	 * Lay each group's members out across the flow, so a long grouped flow reads
	 * as a row of columns (or a column of rows) instead of one long strip.
	 */
	readonly groupsAcross?: boolean;
	/** Reorder ranks to remove the layered crossings the barycenter pass leaves. */
	readonly reorder: boolean;
	readonly wrap: Wrap;
}

const PLAIN_ARRANGEMENT: Arrangement = { crossingRepair: false, reorder: false, wrap: NO_WRAP };

type LayoutDirection = IntermediateDiagram["layout"]["direction"];
/** The direction a group reads in when it lies across the flow. */
const ACROSS_DIRECTION: Readonly<Record<LayoutDirection, LayoutDirection>> = {
	TB: "LR",
	BT: "LR",
	LR: "TB",
	RL: "TB",
};

/** Whether reordering ranks for fewer layered crossings changes this diagram's order. */
function reordersRanks(diagram: IntermediateDiagram): boolean {
	const structure = groupStructure(diagram);
	// A grouped diagram reorders its top level and each group's own ranks.
	const layouts = structure
		? [structure.top, ...structure.groups.map((group) => group.diagram)]
		: [diagram];
	return layouts.some((layout) => {
		const [plain, reordered] = [false, true].map((reorder) =>
			rankLayout(layout, new Map(), new Map(), reorder)
				.rankMetrics.map((metric) => metric.shapes.map((shape) => shape.nodeId).join("\n"))
				.join("\n\n"),
		);
		return plain !== reordered;
	});
}

/** Width over height, either way up, of content this size in a padded export. */
function exportAspect(along: number, across: number): number {
	const [long, short] = along > across ? [along, across] : [across, along];
	return (long + 2 * EXPORT_PADDING) / (short + 2 * EXPORT_PADDING);
}

/**
 * Bands for a flow whose single row or column is too long for its breadth,
 * cutting only where exactly one forward edge joins a rank to the next. No loop
 * or skipping edge spans a cut, so each band holds whole branches and the next
 * band starts at a single node. Orthogonal routing only: a straight continuation
 * would cut through the band it skips back across.
 */
function planWrap(diagram: IntermediateDiagram, reorder: boolean): Wrap {
	// A band cut must not split a group; grouped flows stay in one band.
	if (diagram.layout.edgeRouting !== "orthogonal" || groupStructure(diagram)) return NO_WRAP;
	const { feedbackEdges, gapAfter, rankByNodeId, rankMetrics } = rankLayout(
		diagram,
		new Map(),
		new Map(),
		reorder,
	);
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const flow = (from: number, to: number) =>
		rankMetrics.slice(from, to + 1).reduce((sum, metric) => sum + metric.depth, 0) +
		gapAfter.slice(from, to).reduce((sum, gap) => sum + gap, 0);
	const breadth = (from: number, to: number) =>
		Math.max(...rankMetrics.slice(from, to + 1).map((metric) => metric.breadth));
	const last = rankMetrics.length - 1;
	const natural = exportAspect(flow(0, last), breadth(0, last));
	if (rankMetrics.length < WRAP_MIN_RANKS || flow(0, last) <= breadth(0, last)) return NO_WRAP;

	const nodeKinds = new Map(diagram.nodes.map((node) => [node.id, node.kind]));
	const rankOf = (nodeId: string) => rankByNodeId.get(nodeId) ?? 0;
	const continuationAfter = new Map<number, string>();
	for (const [index, metric] of rankMetrics.entries()) {
		const spanning = diagram.edges.filter(
			(edge) =>
				Math.min(rankOf(edge.source), rankOf(edge.target)) <= metric.rank &&
				Math.max(rankOf(edge.source), rankOf(edge.target)) > metric.rank,
		);
		const [edge] = spanning;
		if (
			spanning.length === 1 &&
			edge &&
			!feedbackEdges.has(edge.id) &&
			rankOf(edge.source) === metric.rank &&
			rankOf(edge.target) === metric.rank + 1 &&
			nodeKinds.get(edge.source) !== "decision"
		)
			continuationAfter.set(index, edge.id);
	}

	// A band also holds the stubs of the continuations into and out of it.
	const edgeLabels = new Map(diagram.edges.map((edge) => [edge.id, edge.label]));
	const bandLength = (from: number, to: number) => {
		const label = edgeLabels.get(continuationAfter.get(to) ?? "");
		const metrics = label ? branchLabelMetrics(label) : undefined;
		const departure =
			to === last
				? 0
				: Math.max(
						ROUTE_STUB_LENGTH,
						metrics ? (vertical ? Math.max(40, metrics.height + 24) : metrics.width + 16) : 0,
					);
		return flow(from, to) + (from > 0 ? ROUTE_STUB_LENGTH : 0) + departure;
	};

	// Band ends: a clean cut or the last rank. Each band keeps at least two ranks.
	const ends = [...continuationAfter.keys(), last].sort((a, b) => a - b);
	let chosen: { aspect: number; ends: readonly number[] } | undefined;
	for (let bands = 2; bands <= Math.min(MAX_BANDS, ends.length); bands += 1) {
		// Balance band lengths: the shortest longest band, then the least sum of squares.
		type Partition = { ends: number[]; longest: number; squares: number };
		let partitions = new Map<number, Partition>();
		for (const end of ends)
			if (end >= 1 && end < last)
				partitions.set(end, {
					ends: [end],
					longest: bandLength(0, end),
					squares: bandLength(0, end) ** 2,
				});
		for (let band = 2; band <= bands; band += 1) {
			const next = new Map<number, Partition>();
			for (const end of ends) {
				if (band === bands ? end !== last : end === last) continue;
				for (const [previous, partition] of [...partitions].reverse()) {
					if (end < previous + 2) continue;
					const length = bandLength(previous + 1, end);
					const candidate = {
						ends: [...partition.ends, end],
						longest: Math.max(partition.longest, length),
						squares: partition.squares + length ** 2,
					};
					const best = next.get(end);
					if (
						!best ||
						candidate.longest < best.longest ||
						(candidate.longest === best.longest && candidate.squares < best.squares)
					)
						next.set(end, candidate);
				}
			}
			partitions = next;
		}
		const partition = partitions.get(last);
		if (!partition) continue;
		const starts = [0, ...partition.ends.slice(0, -1).map((end) => end + 1)];
		const across =
			starts.reduce((sum, start, band) => sum + breadth(start, partition.ends[band]!), 0) +
			(bands - 1) * BAND_GAP;
		const aspect = exportAspect(partition.longest, across);
		if (!chosen || aspect < chosen.aspect) chosen = { aspect, ends: partition.ends };
		if (aspect <= WRAP_TARGET_ASPECT) break;
	}
	if (!chosen || chosen.aspect >= natural) return NO_WRAP;

	const bandOf = new Map<string, number>();
	let band = 0;
	for (const [index, metric] of rankMetrics.entries()) {
		for (const shape of metric.shapes) bandOf.set(shape.nodeId, band);
		if (chosen.ends.includes(index) && index !== last) band += 1;
	}
	return {
		bandOf,
		continuations: new Set(
			chosen.ends.filter((end) => end !== last).map((end) => continuationAfter.get(end)!),
		),
	};
}

function positionNodes(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
	stubReach: ReadonlyMap<string, number> = new Map(),
	{ reorder, wrap }: Arrangement = PLAIN_ARRANGEMENT,
): NodeSceneElement[] {
	const { gapAfter, gapBetween, highSide, lowSide, rankMetrics, reachOf, vertical } = rankLayout(
		diagram,
		minimumSizes,
		stubReach,
		reorder,
	);
	const bands: { index: number; metric: RankMetric }[][] = [];
	for (const [index, metric] of rankMetrics.entries()) {
		const band = wrap.bandOf.get(metric.shapes[0]!.nodeId) ?? 0;
		(bands[band] ??= []).push({ index, metric });
	}
	const positioned: NodeSceneElement[] = [];
	let bandOffset = PADDING;
	for (const [bandIndex, band] of bands.entries()) {
		const bandBreadth = Math.max(...band.map(({ metric }) => metric.breadth));
		let rankOffset = PADDING;
		for (const { index, metric } of band) {
			let breadthOffset = bandOffset + Math.max(0, bandBreadth - metric.breadth) / 2;

			for (const [shapeIndex, shape] of metric.shapes.entries()) {
				const next = metric.shapes[shapeIndex + 1];
				if (vertical) {
					positioned.push({
						...shape,
						x: breadthOffset,
						y: rankOffset + Math.max(0, metric.depth - shape.height) / 2,
					});
					breadthOffset += shape.width;
				} else {
					positioned.push({
						...shape,
						x: rankOffset + Math.max(0, metric.depth - shape.width) / 2,
						y: breadthOffset,
					});
					breadthOffset += shape.height;
				}
				if (next) breadthOffset += gapBetween(shape, next);
			}
			rankOffset += metric.depth + gapAfter[index]!;
		}
		// The next band leaves a lane for the continuation clear of both bands' stubs.
		const next = bands[bandIndex + 1];
		if (next)
			bandOffset +=
				bandBreadth +
				Math.max(
					BAND_GAP,
					reachOf(
						band.flatMap(({ metric }) => metric.shapes),
						highSide,
					) +
						reachOf(
							next.flatMap(({ metric }) => metric.shapes),
							lowSide,
						) +
						2 * ROUTE_STUB_LENGTH,
				);
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

/** Node positions and, for a grouped diagram, where each group's frame is drawn. */
interface PositionedLayout {
	readonly groups?: GroupLayout;
	readonly nodes: NodeSceneElement[];
}

function positionLayout(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
	stubReach: ReadonlyMap<string, number> = new Map(),
	arrangement: Arrangement = PLAIN_ARRANGEMENT,
	slack: ReadonlyMap<string, number> = new Map(),
): PositionedLayout {
	const structure = groupStructure(diagram);
	return structure
		? positionGroupedNodes(diagram, structure, minimumSizes, stubReach, arrangement, slack)
		: { nodes: positionNodes(diagram, minimumSizes, stubReach, arrangement) };
}

function boundsOf(shapes: readonly Box[]): Box {
	const x = Math.min(...shapes.map((shape) => shape.x));
	const y = Math.min(...shapes.map((shape) => shape.y));
	return {
		x,
		y,
		width: Math.max(...shapes.map((shape) => shape.x + shape.width)) - x,
		height: Math.max(...shapes.map((shape) => shape.y + shape.height)) - y,
	};
}

/**
 * Lay out each group's members as a flow of their own, then the top level with
 * every group as one block among the ungrouped nodes, so a group's members stay
 * together and no two groups, or a group and an outside node, overlap. Each
 * block keeps a band above its frame for the frame's name. Vertical flows enter
 * and leave a group through its top, so there the frame widens until the top
 * row's ports clear its name.
 */
function positionGroupedNodes(
	diagram: IntermediateDiagram,
	structure: GroupStructure,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	stubReach: ReadonlyMap<string, number>,
	arrangement: Arrangement,
	slack: ReadonlyMap<string, number>,
): PositionedLayout {
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	// Members whose edges leave the group cross its frame.
	const crossing = new Set(structure.crossEdges.flatMap((edge) => [edge.source, edge.target]));
	const blocks = structure.groups.map(({ across, diagram: along, group }) => {
		const inner = arrangement.groupsAcross ? across : along;
		const nodes = positionNodes(inner, minimumSizes, stubReach, {
			...PLAIN_ARRANGEMENT,
			reorder: arrangement.reorder,
		});
		const content = boundsOf(nodes);
		// How far a member's stubs reach past the content on each side.
		const inset = (node: NodeSceneElement, side: ConnectionEdge) =>
			side === "top"
				? node.y - content.y
				: side === "bottom"
					? content.y + content.height - node.y - node.height
					: side === "left"
						? node.x - content.x
						: content.x + content.width - node.x - node.width;
		// The frame holds its members' stubs with a lane to spare, so a group's own
		// edges can turn inside it.
		const pad = (side: ConnectionEdge) =>
			Math.max(
				GROUP_PADDING,
				...nodes.map(
					(node) =>
						(stubReach.get(portKey(node.nodeId, side)) ?? 0) - inset(node, side) + PORT_SPACING,
				),
			) + (slack.get(group.id) ?? 0);
		const labelWidth = canvasFrameNameWidth(group.label);
		const ports = nodes
			.filter((node) => crossing.has(node.nodeId) && inset(node, "top") <= AXIS_ALIGNED_EPSILON)
			.map((node) => node.x - content.x + node.width / 2 - 2 * PORT_SPACING);
		const padding = {
			top: pad("top"),
			bottom: pad("bottom"),
			right: pad("right"),
			left:
				vertical && ports.length > 0
					? Math.max(
							pad("left"),
							labelWidth + 2 * CANVAS_FRAME_NAME.clearance + PORT_SPACING - Math.min(...ports),
						)
					: pad("left"),
		};
		return {
			content,
			group,
			height: content.height + padding.top + padding.bottom,
			nodes,
			padding,
			width: Math.max(
				content.width + padding.left + padding.right,
				labelWidth + 2 * CANVAS_FRAME_NAME.clearance + 16,
			),
		};
	});
	const sizes = new Map(minimumSizes);
	const reach = new Map(stubReach);
	for (const block of blocks) {
		const unit = groupUnitId(block.group.id);
		sizes.set(unit, { width: block.width, height: block.height + GROUP_LABEL_BAND });
		// A member's stub reaches past the block only by what its frame's padding leaves.
		const slack =
			(block.width - block.content.width - block.padding.left - block.padding.right) / 2;
		const margin = (node: NodeSceneElement, side: ConnectionEdge) =>
			side === "top"
				? node.y - block.content.y + block.padding.top + GROUP_LABEL_BAND
				: side === "bottom"
					? block.content.y + block.content.height - node.y - node.height + block.padding.bottom
					: side === "left"
						? node.x - block.content.x + block.padding.left + slack
						: block.content.x +
							block.content.width -
							node.x -
							node.width +
							block.padding.right +
							slack;
		for (const side of ["top", "right", "bottom", "left"] as const) {
			const beyond = Math.max(
				0,
				...block.nodes.map(
					(node) => (stubReach.get(portKey(node.nodeId, side)) ?? 0) - margin(node, side),
				),
			);
			if (beyond > 0) reach.set(portKey(unit, side), beyond);
		}
	}
	const top = positionNodes(structure.top, sizes, reach, { ...arrangement, wrap: NO_WRAP });
	// Each top-level unit: an ungrouped node, or a group's members and frame.
	const units = new Map<string, { frame?: Box; nodes: NodeSceneElement[] }>();
	for (const shape of top) {
		if (!shape.nodeId.startsWith(GROUP_UNIT_PREFIX)) units.set(shape.nodeId, { nodes: [shape] });
	}
	for (const block of blocks) {
		const unitId = groupUnitId(block.group.id);
		const unit = top.find((shape) => shape.nodeId === unitId)!;
		const frame = {
			x: unit.x,
			y: unit.y + GROUP_LABEL_BAND,
			width: unit.width,
			height: unit.height - GROUP_LABEL_BAND,
		};
		// A block the top level widened for ports keeps its padding and centers the rest.
		const dx =
			frame.x +
			block.padding.left +
			(frame.width - block.content.width - block.padding.left - block.padding.right) / 2 -
			block.content.x;
		const dy =
			frame.y +
			block.padding.top +
			(frame.height - block.content.height - block.padding.top - block.padding.bottom) / 2 -
			block.content.y;
		units.set(unitId, {
			frame,
			nodes: block.nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })),
		});
	}
	alignUnits(structure, units, vertical);
	const nodes = [...units.values()].flatMap((unit) => unit.nodes);
	const order = nodeOrderMap(diagram.nodes);
	nodes.sort((left, right) => order.get(left.nodeId)! - order.get(right.nodeId)!);
	const frames = blocks.map(({ group }): GroupFrame => {
		const box = units.get(groupUnitId(group.id))!.frame!;
		return {
			box,
			elementId: `group:${group.id}`,
			id: group.id,
			label: group.label,
			labelBox: canvasFrameNameBox({ ...box, name: group.label }),
		};
	});
	return { groups: { frames, groupOf: structure.groupOf }, nodes };
}

/**
 * Line a group's flow up with its neighbors: a member sits off its block's
 * center, so a centered block would make the edge between them jog. Starting
 * from the broadest rank, each unit alone in its rank moves across the flow
 * until the edge from the rank before it (or, before the broadest rank, to the
 * rank after it) runs straight. A unit alone in its rank cannot meet another.
 */
function alignUnits(
	structure: GroupStructure,
	units: Map<string, { frame?: Box; nodes: NodeSceneElement[] }>,
	vertical: boolean,
): void {
	const { crossEdges, top } = structure;
	const feedback = flowFeedback(top);
	const rankOf = rankNodes(top, edgeBuckets(top.edges), feedback);
	const ranks = new Map<number, string[]>();
	for (const node of top.nodes) {
		const rank = rankOf.get(node.id) ?? 0;
		ranks.set(rank, [...(ranks.get(rank) ?? []), node.id]);
	}
	const across = vertical ? "x" : "y";
	const size = vertical ? "width" : "height";
	const breadth = (rank: number) =>
		(ranks.get(rank) ?? []).reduce((sum, id) => {
			const unit = units.get(id)!;
			return sum + (unit.frame ?? unit.nodes[0]!)[size];
		}, 0);
	const order = [...ranks.keys()].sort((a, b) => a - b);
	const anchor = order.reduce((best, rank) => (breadth(rank) > breadth(best) ? rank : best));
	const nodeById = (id: string) =>
		[...units.values()].flatMap((unit) => unit.nodes).find((node) => node.nodeId === id)!;
	const middle = (node: NodeSceneElement) => node[across] + node[size] / 2;
	const shift = (id: string, delta: number) => {
		const unit = units.get(id)!;
		unit.nodes = unit.nodes.map((node) => ({ ...node, [across]: node[across] + delta }));
		if (unit.frame) unit.frame = { ...unit.frame, [across]: unit.frame[across] + delta };
	};
	const align = (rank: number, neighbor: number, forward: boolean) => {
		const [id] = ranks.get(rank) ?? [];
		if (!id || ranks.get(rank)!.length !== 1) return;
		const edge = top.edges.find(
			(candidate) =>
				!feedback.has(candidate.id) &&
				(forward ? candidate.target : candidate.source) === id &&
				rankOf.get(forward ? candidate.source : candidate.target) === neighbor,
		);
		if (!edge) return;
		// The real edge joins members, not their blocks.
		const real = crossEdges[top.edges.indexOf(edge)]!;
		const [mine, theirs] = forward ? [real.target, real.source] : [real.source, real.target];
		shift(id, middle(nodeById(theirs)) - middle(nodeById(mine)));
	};
	for (const rank of order.filter((rank) => rank > anchor)) align(rank, rank - 1, true);
	for (const rank of order.filter((rank) => rank < anchor).reverse()) align(rank, rank + 1, false);
}

/** A rectangle the router treats like a node it must not cross. */
function obstacleBox(id: string, box: Box): NodeSceneElement {
	return {
		type: "node",
		id,
		nodeId: id,
		shape: "rectangle",
		label: "",
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height,
	};
}

/** Each frame with the band above it, for sizing what is drawn. */
function groupBlocks(groups: GroupLayout | undefined): NodeSceneElement[] {
	return (groups?.frames ?? []).map((frame) =>
		obstacleBox(frame.elementId, {
			...frame.box,
			y: frame.box.y - GROUP_LABEL_BAND,
			height: frame.box.height + GROUP_LABEL_BAND,
		}),
	);
}

/**
 * What a route must not cross besides nodes and branch labels: every group's
 * name, every group neither end belongs to, and, for a group's own edge, walls
 * around its frame so the edge stays inside.
 */
function groupObstacles(groups: GroupLayout | undefined, route: RoutedEdge): NodeSceneElement[] {
	if (!groups) return [];
	const source = groups.groupOf.get(route.source.nodeId);
	const target = groups.groupOf.get(route.target.nodeId);
	return groups.frames.flatMap((frame) => {
		const label = obstacleBox(`group-label:${frame.id}`, frame.labelBox);
		if (frame.id === source && frame.id === target) {
			const { x, y, width, height } = frame.box;
			const wall = GROUP_WALL;
			return [
				label,
				obstacleBox(`group-wall:${frame.id}:top`, {
					x: x - wall,
					y: y - wall,
					width: width + 2 * wall,
					height: wall,
				}),
				obstacleBox(`group-wall:${frame.id}:bottom`, {
					x: x - wall,
					y: y + height,
					width: width + 2 * wall,
					height: wall,
				}),
				obstacleBox(`group-wall:${frame.id}:left`, {
					x: x - wall,
					y: y - wall,
					width: wall,
					height: height + 2 * wall,
				}),
				obstacleBox(`group-wall:${frame.id}:right`, {
					x: x + width,
					y: y - wall,
					width: wall,
					height: height + 2 * wall,
				}),
			];
		}
		return frame.id === source || frame.id === target
			? [label]
			: [label, obstacleBox(frame.elementId, frame.box)];
	});
}

const GROUP_OUTLINE = "group-outline:";

/** Each frame's outline as an unbound, headless line for routes to keep apart from. */
function groupOutlineLines(groups: GroupLayout | undefined): ArrowSceneElement[] {
	return (groups?.frames ?? []).map((frame) => {
		const { x, y, width, height } = frame.box;
		return {
			type: "arrow",
			id: `${GROUP_OUTLINE}${frame.id}`,
			edgeId: `${GROUP_OUTLINE}${frame.id}`,
			sourceNodeId: "",
			targetNodeId: "",
			endArrowhead: null,
			points: [
				{ x, y },
				{ x: x + width, y },
				{ x: x + width, y: y + height },
				{ x, y: y + height },
				{ x, y },
			],
		};
	});
}

/** A frame's outline as four axis-aligned segments. */
function frameOutline(box: Box): AxisAlignedSegment[] {
	return segmentsFromPoints([
		{ x: box.x, y: box.y },
		{ x: box.x + box.width, y: box.y },
		{ x: box.x + box.width, y: box.y + box.height },
		{ x: box.x, y: box.y + box.height },
		{ x: box.x, y: box.y },
	]);
}

function insideBox(point: ScenePoint, box: Box): boolean {
	return (
		point.x >= box.x - AXIS_ALIGNED_EPSILON &&
		point.x <= box.x + box.width + AXIS_ALIGNED_EPSILON &&
		point.y >= box.y - AXIS_ALIGNED_EPSILON &&
		point.y <= box.y + box.height + AXIS_ALIGNED_EPSILON
	);
}

/**
 * Routes that misread a group: through a group neither end belongs to, along or
 * hard beside a frame's outline, across a group's name, or a group's own edge
 * leaving it.
 */
function groupRouteDefects(
	arrows: readonly ArrowSceneElement[],
	groups: GroupLayout,
): (readonly [string])[] {
	const defects: (readonly [string])[] = [];
	const outlines = groups.frames.map((frame) => frameOutline(frame.box));
	for (const arrow of arrows) {
		const segments = segmentsFromPoints(arrow.points);
		const source = groups.groupOf.get(arrow.sourceNodeId);
		const target = groups.groupOf.get(arrow.targetNodeId);
		for (const [index, frame] of groups.frames.entries()) {
			const own = frame.id === source || frame.id === target;
			if (
				segments.some(
					(segment) =>
						segmentCrossesBoundsInterior(segment, frame.labelBox) ||
						(!own && segmentCrossesBoundsInterior(segment, frame.box)) ||
						outlines[index]!.some(
							(edge) =>
								edge.orientation === segment.orientation &&
								Math.abs(edge.staticCoordinate - segment.staticCoordinate) <
									GROUP_OUTLINE_CLEARANCE &&
								segmentOverlapLength(edge, segment) > GROUP_OUTLINE_CLEARANCE,
						),
				) ||
				(frame.id === source &&
					frame.id === target &&
					arrow.points.some((point) => !insideBox(point, frame.box)))
			)
				defects.push([arrow.id]);
		}
	}
	return defects;
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

function portOffsetsForRoutes(
	routes: readonly RoutedEdge[],
	sharedDecisionPitch = false,
): Map<string, number> {
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
		// Decision branches usually get a vertex each; two labeled ones sharing a side need room.
		const pitch =
			departures.length > 1 &&
			labeled.length > 0 &&
			(labeled[0]!.source.kind !== "decision" || (sharedDecisionPitch && labeled.length > 1))
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

/** Arrowheads are about 17 units wide; this keeps a visible gap beside an arrival. */
const ARRIVAL_SPACING = 36;
const OPPOSITE_EDGE: Readonly<Record<ConnectionEdge, ConnectionEdge>> = {
	top: "bottom",
	right: "left",
	bottom: "top",
	left: "right",
};
const EDGE_NORMAL: Readonly<Record<ConnectionEdge, ScenePoint>> = {
	top: { x: 0, y: -1 },
	right: { x: 1, y: 0 },
	bottom: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
};

interface PortSlot {
	readonly endpoint: "source" | "target";
	readonly key: string;
	readonly route: RoutedEdge;
}

function slotSide(slot: PortSlot): ConnectionEdge {
	return slot.endpoint === "source" ? slot.route.sourceEdge : slot.route.targetEdge;
}

function slotAxis(side: ConnectionEdge): "x" | "y" {
	return side === "top" || side === "bottom" ? "x" : "y";
}

function portLimit(node: NodeSceneElement, side: ConnectionEdge): number {
	return (slotAxis(side) === "x" ? node.width : node.height) / 2 - PORT_PADDING;
}

function slotStubLength(slot: PortSlot, point: ScenePoint): number {
	return slot.endpoint === "source"
		? sourceStubLength(slot.route, point, ROUTE_STUB_LENGTH)
		: endpointClearance(slot.route.target, point, slot.route.targetEdge, ROUTE_STUB_LENGTH);
}

/**
 * Pool adjacent violators with each block held inside its bounds: the closest
 * nondecreasing sequence that respects nondecreasing lower and upper bounds.
 */
function boundedNondecreasingFit(
	values: readonly number[],
	low: readonly number[],
	high: readonly number[],
): number[] {
	const blocks: { count: number; high: number; low: number; sum: number; value: number }[] = [];
	for (const [index, value] of values.entries()) {
		blocks.push({
			count: 1,
			high: high[index]!,
			low: low[index]!,
			sum: value,
			value: clamp(value, low[index]!, Math.max(low[index]!, high[index]!)),
		});
		while (blocks.length > 1 && blocks.at(-2)!.value > blocks.at(-1)!.value) {
			const last = blocks.pop()!;
			const block = blocks.at(-1)!;
			block.count += last.count;
			block.sum += last.sum;
			block.low = Math.max(block.low, last.low);
			block.high = Math.min(block.high, last.high);
			block.value = clamp(block.sum / block.count, block.low, Math.max(block.low, block.high));
		}
	}
	return blocks.flatMap((block) => Array<number>(block.count).fill(block.value));
}

interface PortPreference {
	/** Offset to stay near when nothing pins the port. */
	readonly desired: number;
	readonly high: number;
	readonly low: number;
	/** Straight anchors and pinned vertices (2) win over L-route bounds (1). */
	readonly priority: number;
	/** For an L-shaped route: travel direction along the side times its distance ahead. */
	readonly lane?: number;
}

const FREE_PORT: PortPreference = { desired: 0, high: Infinity, low: -Infinity, priority: 0 };

/**
 * Ordered offsets on one side, at least `gaps` apart and near their desired
 * offsets. Bounds are kept by priority while they stay jointly satisfiable. A
 * side that cannot hold every gap is centered and widened by the capacity pass.
 */
function spreadPorts(
	preferences: readonly PortPreference[],
	gaps: readonly number[],
	limit: number,
): number[] {
	const before = preferences.map((_, index) =>
		gaps.slice(0, index).reduce((sum, gap) => sum + gap, 0),
	);
	const total = before.at(-1) ?? 0;
	if (total > 2 * limit) return before.map((offset) => offset - total / 2);
	// Work in gap-free coordinates, where ordered ports with gaps become nondecreasing.
	const low = preferences.map(() => -Infinity);
	const high = preferences.map(() => Infinity);
	const envelope = () => {
		const lows = low.map((value, index) => Math.max(value - before[index]!, -limit));
		const highs = high.map((value, index) => Math.min(value - before[index]!, limit - total));
		for (let index = 1; index < lows.length; index += 1)
			lows[index] = Math.max(lows[index]!, lows[index - 1]!);
		for (let index = highs.length - 2; index >= 0; index -= 1)
			highs[index] = Math.min(highs[index]!, highs[index + 1]!);
		return { highs, lows };
	};
	const constrained = preferences
		.map((preference, index) => ({ index, priority: preference.priority }))
		.filter(({ priority }) => priority > 0)
		.sort((a, b) => b.priority - a.priority || a.index - b.index);
	for (const { index } of constrained) {
		low[index] = preferences[index]!.low;
		high[index] = preferences[index]!.high;
		const { highs, lows } = envelope();
		if (lows.some((value, at) => value > highs[at]! + AXIS_ALIGNED_EPSILON)) {
			low[index] = -Infinity;
			high[index] = Infinity;
		}
	}
	const { highs, lows } = envelope();
	return boundedNondecreasingFit(
		preferences.map((preference, index) => preference.desired - before[index]!),
		lows,
		highs,
	).map((value, index) => value + before[index]!);
}

/**
 * Where a port lets its edge leave or arrive without a jog: past the other end's
 * stub for an L-shaped route, or straight across from a facing port. A lone port
 * on a diamond or ellipse keeps its vertex unless it faces another lone one.
 */
function slotPreference(
	slot: PortSlot,
	offsets: ReadonlyMap<string, number>,
	slotsBySide: ReadonlyMap<string, readonly PortSlot[]>,
): PortPreference {
	const other: PortSlot = {
		endpoint: slot.endpoint === "source" ? "target" : "source",
		key: connectionKey({
			edgeId: slot.route.edge.id,
			endpoint: slot.endpoint === "source" ? "target" : "source",
		}),
		route: slot.route,
	};
	const node = slot.route[slot.endpoint];
	const side = slotSide(slot);
	const otherSide = slotSide(other);
	const axis = slotAxis(side);
	const normal = EDGE_NORMAL[side];
	const here = pointOnEdge(node, side, offsets.get(slot.key) ?? 0);
	const there = pointOnEdge(slot.route[other.endpoint], otherSide, offsets.get(other.key) ?? 0);
	const ahead = (there.x - here.x) * normal.x + (there.y - here.y) * normal.y;
	if (slotAxis(otherSide) !== axis && ahead >= slotStubLength(slot, here)) {
		const reach = pointAwayFromEdge(there, otherSide, slotStubLength(other, there));
		const toward = EDGE_NORMAL[otherSide][axis];
		const bound = reach[axis] - center(node)[axis];
		return {
			desired: 0,
			high: toward < 0 ? bound : Infinity,
			lane: toward * ahead,
			low: toward > 0 ? bound : -Infinity,
			priority: 1,
		};
	}
	const lone = (target: PortSlot, sideOfTarget: ConnectionEdge) =>
		target.route[target.endpoint].shape !== "rectangle" &&
		slotsBySide.get(portKey(target.route[target.endpoint].nodeId, sideOfTarget))?.length === 1;
	const facing = otherSide === OPPOSITE_EDGE[side] && ahead > 0;
	if (lone(slot, side) && !(facing && slot.endpoint === "target" && lone(other, otherSide)))
		return { desired: 0, high: 0, low: 0, priority: 2 };
	const straight = there[axis] - center(node)[axis];
	return facing && Math.abs(straight) <= portLimit(node, side)
		? { desired: straight, high: straight, low: straight, priority: 2 }
		: FREE_PORT;
}

/**
 * Side order that avoids crossings: by the far node along the side or, `byApproach`,
 * by where each route leaves the far node past its stub, so a decision branch
 * leaving a vertex beside a node in line with this one lands on the side it
 * approaches from. L-shaped arrivals travelling the same way nest, the farthest
 * cross run outermost.
 */
function orderedSlots(
	slots: readonly PortSlot[],
	preferences: ReadonlyMap<PortSlot, PortPreference>,
	offsets: ReadonlyMap<string, number>,
	byApproach: boolean,
): PortSlot[] {
	const far = (slot: PortSlot) => {
		const endpoint = slot.endpoint === "source" ? "target" : "source";
		if (!byApproach) return center(slot.route[endpoint])[slotAxis(slotSide(slot))];
		const node = slot.route[endpoint];
		const side = endpoint === "source" ? slot.route.sourceEdge : slot.route.targetEdge;
		const key = connectionKey({ edgeId: slot.route.edge.id, endpoint });
		const departure = pointAwayFromEdge(
			pointOnEdge(node, side, offsets.get(key) ?? 0),
			side,
			ROUTE_STUB_LENGTH,
		);
		return departure[slotAxis(slotSide(slot))];
	};
	const ordered = [...slots].sort((a, b) => far(a) - far(b));
	for (const toward of [1, -1]) {
		const lanes = ordered
			.map((slot, index) => ({ index, lane: preferences.get(slot)!.lane, slot }))
			.filter(({ lane }) => lane !== undefined && Math.sign(lane) === toward);
		const nested = [...lanes].sort((a, b) => a.lane! - b.lane!);
		lanes.forEach(({ index }, at) => {
			ordered[index] = nested[at]!.slot;
		});
	}
	return ordered;
}

/**
 * Orthogonal port offsets that keep edges straight into their arrowheads. Sides
 * are revisited a few times so facing ports settle on one shared coordinate.
 */
function alignedPortOffsets(
	routes: readonly RoutedEdge[],
	sharedDecisionPitch: boolean,
	byApproach = false,
): Map<string, number> {
	const offsets = portOffsetsForRoutes(routes, sharedDecisionPitch);
	const slotsBySide = new Map<string, PortSlot[]>();
	for (const route of routes)
		for (const endpoint of ["source", "target"] as const) {
			const key = portKey(
				route[endpoint].nodeId,
				endpoint === "source" ? route.sourceEdge : route.targetEdge,
			);
			slotsBySide.set(key, [
				...(slotsBySide.get(key) ?? []),
				{ endpoint, key: connectionKey({ edgeId: route.edge.id, endpoint }), route },
			]);
		}
	// Crowded sides settle first; lone ports then line up with them.
	const sides = [...slotsBySide.values()].sort((a, b) => b.length - a.length);
	for (let sweep = 0; sweep < 3; sweep += 1)
		for (const unordered of sides) {
			const side = slotSide(unordered[0]!);
			const node = unordered[0]!.route[unordered[0]!.endpoint];
			const preferences = new Map(
				unordered.map((slot) => [slot, slotPreference(slot, offsets, slotsBySide)]),
			);
			const slots = orderedSlots(unordered, preferences, offsets, byApproach);
			const departures = slots.filter((slot) => slot.endpoint === "source");
			const labeled = departures.filter((slot) => slot.route.edge.label);
			const labelPitch =
				departures.length > 1 &&
				labeled.length > 0 &&
				(labeled[0]!.route.source.kind !== "decision" ||
					(sharedDecisionPitch && labeled.length > 1))
					? Math.max(
							...labeled.map((slot) => {
								const metrics = branchLabelMetrics(slot.route.edge.label!);
								return (slotAxis(side) === "x" ? metrics.width : metrics.height) + 24;
							}),
						)
					: 0;
			const positions = spreadPorts(
				slots.map((slot) => preferences.get(slot)!),
				slots
					.slice(1)
					.map((slot, index) =>
						Math.max(
							labelPitch,
							slot.endpoint === "target" || slots[index]!.endpoint === "target"
								? ARRIVAL_SPACING
								: PORT_SPACING,
						),
					),
				portLimit(node, side),
			);
			slots.forEach((slot, index) => offsets.set(slot.key, positions[index]!));
		}
	return offsets;
}

function routeForEdge(
	edge: DiagramEdge,
	index: number,
	shapesByNodeId: ReadonlyMap<string, NodeSceneElement>,
	direction: IntermediateDiagram["layout"]["direction"],
	continuation = false,
): RoutedEdge {
	const source = shapesByNodeId.get(edge.source);
	const target = shapesByNodeId.get(edge.target);

	if (!source || !target) {
		throw new Error(`Cannot render edge "${edge.id}" with unresolved nodes.`);
	}

	// A continuation leaves forward and arrives forward, like the line break it is.
	const { sourceEdge, targetEdge } = continuation
		? { sourceEdge: FORWARD_SIDE[direction], targetEdge: OPPOSITE_EDGE[FORWARD_SIDE[direction]] }
		: connectionEdges(source, target, direction);

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
	repairForward = false,
): { offsets: Map<string, number>; minimumSizes: Map<string, { width: number; height: number }> } {
	const minimumSizes = new Map<string, { width: number; height: number }>();
	const feedback = flowFeedback(diagram);
	const sides: ConnectionEdge[] =
		diagram.layout.direction === "TB" || diagram.layout.direction === "BT"
			? ["right", "left", "top", "bottom"]
			: ["bottom", "top", "left", "right"];
	// Reserve forward endpoints too: later feedback side changes must not move defaults
	// onto endpoints that an earlier candidate already checked and selected.
	const chosenOffsets = portOffsetsForRoutes(routes);
	// With repair on, a forward line that crosses a node or turns back into its own
	// node gets the same obstacle-safe port search as feedback.
	const blocked = (route: RoutedEdge) => {
		const { start, end } = routeEndpoints(route, chosenOffsets);
		return (
			!directEndpointFacesOut(route.source, route.sourceEdge, start, end) ||
			!directEndpointFacesOut(route.target, route.targetEdge, end, start) ||
			nodes.some(
				(n) => n !== route.source && n !== route.target && directSegmentCrossesNode(start, end, n),
			)
		);
	};
	for (const route of routes.filter(
		(r) => feedback.has(r.edge.id) || (repairForward && blocked(r)),
	)) {
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
		if (!found && !feedback.has(route.edge.id)) {
			Object.assign(route, fallback?.sides ?? original);
			if (fallback) {
				chosenOffsets.set(sourceKey, fallback.sourceOffset);
				chosenOffsets.set(targetKey, fallback.targetOffset);
			}
		} else if (!found) {
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

/** How far the reserved endpoint stubs reach past each node side's bounding box. */
function stubReachForRoutes(
	routes: readonly RoutedEdge[],
	portOffsets: ReadonlyMap<string, number>,
): Map<string, number> {
	const reach = new Map<string, number>();
	for (const route of routes) {
		const { start, end } = routeEndpoints(route, portOffsets);
		for (const [node, side, length] of [
			[route.source, route.sourceEdge, sourceStubLength(route, start, ROUTE_STUB_LENGTH)],
			[
				route.target,
				route.targetEdge,
				endpointClearance(route.target, end, route.targetEdge, ROUTE_STUB_LENGTH),
			],
		] as const) {
			const point = node === route.source ? start : end;
			const tip = pointAwayFromEdge(point, side, length);
			const beyond =
				side === "left"
					? node.x - tip.x
					: side === "right"
						? tip.x - node.x - node.width
						: side === "top"
							? node.y - tip.y
							: tip.y - node.y - node.height;
			const key = portKey(node.nodeId, side);
			reach.set(key, Math.max(reach.get(key) ?? 0, beyond));
		}
	}
	return reach;
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
				endArrowhead: null,
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
	options: RouteOptions,
): ArrowSceneElement {
	const { edge } = route;
	const { start: portedStart, end: portedEnd } = routeEndpoints(route, portOffsets);
	const points =
		edgeRouting === "orthogonal"
			? exteriorLaneRoute(route, portedStart, portedEnd, shapes, existingArrows, options)
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

/** Segment the routed arrows once per search; candidates and grid steps reuse the result. */
function existingRouteSegments(existingArrows: readonly ArrowSceneElement[]): RouteSegment[] {
	return existingArrows.flatMap((arrow) =>
		routeSegments({
			arrowId: arrow.id,
			points: arrow.points,
			sourceNodeId: arrow.sourceNodeId,
			targetNodeId: arrow.targetNodeId,
		}),
	);
}

function routeArrowOverlapCount(
	points: readonly ScenePoint[],
	existingSegments: readonly RouteSegment[],
	route: RoutedEdge,
): number {
	const candidateSegments = routeSegments({
		arrowId: `edge:${route.edge.id}`,
		points,
		sourceNodeId: route.edge.source,
		targetNodeId: route.edge.target,
	});
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

/** Optional routing passes for one layout attempt. */
interface RouteOptions {
	/** Reader scale for jog, corridor and arrowhead scoring; absent for the plain router. */
	readonly readerScale?: number;
	/** Guide the grid search toward the arrival with an admissible distance bound. */
	readonly guided: boolean;
	/** Band of each node in a wrapped layout; exterior lanes stay beside their own band. */
	readonly bandOf?: ReadonlyMap<string, number>;
	/** Group frames a grouped layout draws; routes keep clear of the ones they do not belong to. */
	readonly groups?: GroupLayout;
}

/**
 * Arrows routed so far (with reserved stubs), prepared once per edge for scoring
 * candidates. Without a reader scale, candidates are scored as the plain router.
 */
interface RoutedSoFar {
	/** Group frame outlines, which routes cross but never run along. */
	readonly outlines: readonly RouteSegment[];
	readonly quality?: ReturnType<typeof candidateRouteQuality>;
	readonly segments: readonly RouteSegment[];
}

function routedSoFar(
	arrows: readonly ArrowSceneElement[],
	readerScale: number | undefined,
): RoutedSoFar {
	return {
		...(readerScale === undefined
			? {}
			: {
					quality: candidateRouteQuality(
						arrows.map((arrow) => ({
							id: arrow.id,
							points: arrow.points,
							sourceId: arrow.sourceNodeId,
							targetId: arrow.targetNodeId,
							endArrowhead: arrow.endArrowhead !== null,
						})),
						readerScale,
					),
				}),
		outlines: existingRouteSegments(arrows.filter((arrow) => arrow.id.startsWith(GROUP_OUTLINE))),
		segments: existingRouteSegments(arrows),
	};
}

/** Runs of a route parallel to a frame outline and closer to it than its clearance. */
function routeOutlineBesideCount(
	points: readonly ScenePoint[],
	outlines: readonly AxisAlignedSegment[],
): number {
	if (outlines.length === 0) return 0;
	return segmentsFromPoints(points).filter((segment) =>
		outlines.some(
			(edge) =>
				edge.orientation === segment.orientation &&
				Math.abs(edge.staticCoordinate - segment.staticCoordinate) < GROUP_OUTLINE_CLEARANCE &&
				segmentOverlapLength(edge, segment) > GROUP_OUTLINE_CLEARANCE,
		),
	).length;
}

function routeBendCount(points: readonly ScenePoint[]): number {
	return segmentsFromPoints(points).filter(
		(segment, index, segments) =>
			index > 0 && segment.orientation !== segments[index - 1]!.orientation,
	).length;
}

function chooseBestRoute(
	candidates: readonly [ScenePoint, ...ScenePoint[]][],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
	route: RoutedEdge,
	routed: RoutedSoFar,
): [ScenePoint, ...ScenePoint[]] {
	const first = candidates[0];
	if (!first) {
		return [{ x: 0, y: 0 }];
	}

	const routeScore = (candidate: [ScenePoint, ...ScenePoint[]]): readonly number[] => {
		const quality = routed.quality?.({
			id: `edge:${route.edge.id}`,
			points: candidate,
			sourceId: route.edge.source,
			targetId: route.edge.target,
		}) ?? { arrowheadsCrossed: 0, corridors: 0, jogs: 0 };
		return [
			-endpointStubScore(candidate, route),
			routeNodeCrossingCount(candidate, shapes, ignoredNodeIds),
			routeSelfOverlapCount(candidate, route),
			routeArrowOverlapCount(candidate, routed.segments, route),
			routeOutlineBesideCount(candidate, routed.outlines),
			quality.corridors,
			quality.arrowheadsCrossed,
			routeBacktrackDistance(candidate),
			routeTargetOvershootDistance(candidate),
			quality.jogs,
			routeLength(candidate),
			routed.quality ? routeBendCount(candidate) : 0,
		];
	};
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
			? branchLabelMetrics(route.edge.label, route.source.kind === "decision").width + 16
			: Math.max(
					40,
					branchLabelMetrics(route.edge.label, route.source.kind === "decision").height + 24,
				)
		: 0;
	return endpointClearance(route.source, point, route.sourceEdge, Math.max(distance, labelSpace));
}

/**
 * Decision branches take distinct vertices: the two lateral vertices for the
 * outer branches and the forward vertex for an aligned or middle branch. LR and
 * RL mirror TB and BT only when `mirrored`: orthogonal stubs carry a branch out
 * of its vertex before turning, but a direct line from a top or bottom vertex
 * could cut back through the diamond.
 */
function assignDecisionSides(
	routes: RoutedEdge[],
	direction: IntermediateDiagram["layout"]["direction"],
	mirrored = false,
): void {
	const vertical = direction === "TB" || direction === "BT";
	if (!vertical && !mirrored) return;
	const across = vertical ? "x" : "y";
	const along = vertical ? "y" : "x";
	const [low, high]: readonly [ConnectionEdge, ConnectionEdge] = vertical
		? ["left", "right"]
		: ["top", "bottom"];
	const forward: ConnectionEdge =
		direction === "TB"
			? "bottom"
			: direction === "BT"
				? "top"
				: direction === "LR"
					? "right"
					: "left";
	for (const source of new Set(
		routes.filter((r) => r.source.kind === "decision").map((r) => r.source),
	)) {
		const branches = routes
			.filter((r) => r.source === source)
			.sort(
				(a, b) =>
					center(a.target)[across] - center(b.target)[across] ||
					center(a.target)[along] - center(b.target)[along] ||
					a.index - b.index,
			);
		if (branches.length < 2) continue;
		branches.forEach((route, index) => {
			const alignedBranch = branches
				.filter((r) => Math.abs(center(r.target)[across] - center(source)[across]) < 1)
				.sort(
					(a, b) =>
						Math.abs(center(a.target)[along] - center(source)[along]) -
						Math.abs(center(b.target)[along] - center(source)[along]),
				)[0];
			const aligned = branches.length === 2 && route === alignedBranch;
			const otherAligned = branches.length === 2 && alignedBranch !== undefined && !aligned;
			route.sourceEdge = aligned
				? forward
				: otherAligned
					? center(route.target)[across] < center(source)[across]
						? low
						: high
					: index === 0
						? low
						: index === branches.length - 1
							? high
							: forward;
		});
	}
}

/** Feedback uses a lateral lane, not the forward departure/arrival side. */
function assignFeedbackSides(
	routes: RoutedEdge[],
	diagram: IntermediateDiagram,
	directionOf: (route: RoutedEdge) => LayoutDirection = () => diagram.layout.direction,
): void {
	const feedback = flowFeedback(diagram);
	for (const route of routes.filter((r) => feedback.has(r.edge.id))) {
		const direction = directionOf(route);
		const horizontal = direction === "LR" || direction === "RL";
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

function freeLabelSize(label: string, maxWidth: number): { width: number; height: number } {
	const text = wrapTextToWidth(label, maxWidth, 13);
	return {
		width: wrappedLabelWidth(text, 13, maxWidth),
		height: Math.ceil(text.split("\n").length * 13 * 1.35),
	};
}

/** Decision branch labels wrap narrow to stay compact beside their vertex. */
function branchLabelMaxWidth(fromDecision: boolean | undefined): number {
	return fromDecision ? 80 : 160;
}

function branchLabelMetrics(
	label: string,
	fromDecision = false,
): { width: number; height: number } {
	return freeLabelSize(label, branchLabelMaxWidth(fromDecision));
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
				: branchLabelMetrics(route.edge.label ?? "", route.source.kind === "decision").width / 2 +
					8),
		y:
			(start.y + stub.y) / 2 -
			(horizontal
				? branchLabelMetrics(route.edge.label ?? "", route.source.kind === "decision").height / 2 +
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
			const metrics = branchLabelMetrics(route.edge.label!, route.source.kind === "decision");
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

/** Clearance a label box keeps from its own line, and the wider one from other lines. */
const LABEL_LINE_CLEARANCE = 3;
const LABEL_OTHER_LINE_CLEARANCE = 8;
/** Route length from the source within which a label may slide to stay clear. */
const LABEL_SLIDE_LENGTH = 240;
const LABEL_SLIDE_STEP = 12;

interface LabelBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

function labelBox(position: ScenePoint, size: { width: number; height: number }): LabelBox {
	return {
		x: position.x - size.width / 2,
		y: position.y - size.height / 2,
		width: size.width,
		height: size.height,
	};
}

/** The box point nearest a shape's center decides overlap with its true outline. */
function boxOverlapsShape(box: LabelBox, shape: NodeSceneElement): boolean {
	const [cx, cy] = [shape.x + shape.width / 2, shape.y + shape.height / 2];
	const dx = Math.max(box.x, Math.min(cx, box.x + box.width)) - cx;
	const dy = Math.max(box.y, Math.min(cy, box.y + box.height)) - cy;
	const [u, v] = [Math.abs(dx) / (shape.width / 2), Math.abs(dy) / (shape.height / 2)];
	if (shape.shape === "diamond") return u + v < 1;
	if (shape.shape === "ellipse" || shape.shape === "circle") return u * u + v * v < 1;
	return u < 1 && v < 1;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function padBox(box: LabelBox, padding: number): LabelBox {
	return {
		x: box.x - padding,
		y: box.y - padding,
		width: box.width + 2 * padding,
		height: box.height + 2 * padding,
	};
}

/**
 * Lines, nodes and other labels a label box touches. Other edges keep a wider
 * berth, so a label never reads as belonging to the line beside it.
 */
function labelConflicts(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
	segments: readonly AxisAlignedSegment[],
	nodes: readonly NodeSceneElement[],
	others: readonly LabelBox[],
): number {
	const near = padBox(box, LABEL_LINE_CLEARANCE);
	const far = padBox(box, LABEL_OTHER_LINE_CLEARANCE);
	return (
		own.filter((segment) => segmentCrossesBoundsInterior(segment, near)).length +
		segments.filter((segment) => segmentCrossesBoundsInterior(segment, far)).length +
		nodes.filter((node) => boxOverlapsShape(box, node)).length +
		others.filter((other) => boxesOverlap(near, other)).length
	);
}

/**
 * Positions beside the final route, nearest the source first: each axis-aligned
 * run within `LABEL_SLIDE_LENGTH` of the source, on either side, as the stub
 * label sits beside its stub.
 */
function labelSlidePositions(
	points: readonly ScenePoint[],
	size: { width: number; height: number },
): ScenePoint[] {
	const positions: ScenePoint[] = [];
	let travelled = 0;
	for (const segment of segmentsFromPoints(points)) {
		if (travelled > LABEL_SLIDE_LENGTH) break;
		const start = points[segment.segmentIndex]!;
		const end = points[segment.segmentIndex + 1]!;
		const length = segment.max - segment.min;
		const horizontal = segment.orientation === "horizontal";
		const along = horizontal ? size.width / 2 + 4 : size.height / 2 + 4;
		for (
			let offset = Math.min(along, length / 2);
			offset <= length - Math.min(along, length / 2);
			offset += LABEL_SLIDE_STEP
		) {
			if (travelled + offset > LABEL_SLIDE_LENGTH) break;
			const t = offset / length;
			const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
			for (const side of [1, -1])
				positions.push(
					horizontal
						? { x: point.x, y: point.y - side * (size.height / 2 + 5) }
						: { x: point.x + side * (size.width / 2 + 8), y: point.y },
				);
		}
		travelled += length;
	}
	return positions;
}

/**
 * Unbound, grouped text keeps its authored position through Excalidraw export.
 * Each label starts beside its source stub, where routing reserved room for it;
 * one that the final routes, a node or another label still touch slides along
 * its own route, nearest its source first, to the first clear spot.
 */
function branchLabels(
	arrows: ArrowSceneElement[],
	routes: readonly RoutedEdge[],
	shapes: readonly NodeSceneElement[],
	groups?: GroupLayout,
): TextSceneElement[] {
	const labels: TextSceneElement[] = [];
	const segments = arrows.map((arrow) => segmentsFromPoints(arrow.points));
	// Group names are obstacles and frame outlines are lines a label keeps clear of.
	const nodes = [
		...shapes,
		...(groups?.frames ?? []).map((frame) =>
			obstacleBox(`group-label:${frame.id}`, frame.labelBox),
		),
	];
	const outlines = (groups?.frames ?? []).flatMap((frame) => frameOutline(frame.box));
	const placed: { box: LabelBox; index: number }[] = [];
	const sizes = arrows.map((arrow, index) =>
		arrow.label
			? branchLabelMetrics(arrow.label, routes[index]?.source.kind === "decision")
			: undefined,
	);
	const positions = arrows.map((arrow, index) =>
		arrow.label ? branchLabelPosition(routes[index]!, arrow.points[0]) : undefined,
	);
	for (const [index, arrow] of arrows.entries()) {
		const size = sizes[index];
		const stub = positions[index];
		if (!size || !stub) continue;
		const others = positions.flatMap((position, other) =>
			position && other !== index && !placed.some((label) => label.index === other)
				? [labelBox(position, sizes[other]!)]
				: [],
		);
		const conflicts = (position: ScenePoint) =>
			labelConflicts(
				labelBox(position, size),
				segments[index]!,
				[...segments.flatMap((other, at) => (at === index ? [] : other)), ...outlines],
				nodes,
				[...others, ...placed.map((label) => label.box)],
			);
		let position = stub;
		if (conflicts(stub) > 0) {
			let fewest = conflicts(stub);
			for (const candidate of labelSlidePositions(arrow.points, size)) {
				const count = conflicts(candidate);
				if (count < fewest) [position, fewest] = [candidate, count];
				if (fewest === 0) break;
			}
		}
		positions[index] = position;
		placed.push({ box: labelBox(position, size), index });
	}
	for (const [index, arrow] of arrows.entries()) {
		const position = positions[index];
		if (!arrow.label || !position) continue;
		const groupIds = [`branch:${arrow.edgeId}`];
		labels.push({
			type: "text",
			id: `${arrow.id}:label`,
			text: arrow.label,
			fontSize: 13,
			x: position.x,
			y: position.y,
			maxWidth: branchLabelMaxWidth(routes[index]?.source.kind === "decision"),
			groupIds,
		});
		arrows[index] = { ...arrow, groupIds };
	}
	return labels;
}

/**
 * Count, for one grid step, the routed segments it overlaps and those it runs
 * beside closer than `gap`, without scanning every segment: only segments near
 * the step's fixed coordinate qualify.
 */
function segmentOverlapLookup(segments: readonly RouteSegment[], gap: number) {
	const byOrientation = new Map<AxisAlignedSegment["orientation"], RouteSegment[]>([
		["horizontal", []],
		["vertical", []],
	]);
	for (const segment of segments) byOrientation.get(segment.orientation)!.push(segment);
	for (const list of byOrientation.values())
		list.sort((a, b) => a.staticCoordinate - b.staticCoordinate);
	return (candidate: AxisAlignedSegment, arrowId: string): { beside: number; overlaps: number } => {
		const list = byOrientation.get(candidate.orientation)!;
		// Widen the window past the overlap tolerance; segmentsOverlapInterior decides.
		const reach = Math.max(gap, 2 * AXIS_ALIGNED_EPSILON);
		let low = 0;
		let high = list.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (list[middle]!.staticCoordinate < candidate.staticCoordinate - reach) low = middle + 1;
			else high = middle;
		}
		let overlaps = 0;
		let beside = 0;
		for (
			let index = low;
			index < list.length && list[index]!.staticCoordinate <= candidate.staticCoordinate + reach;
			index += 1
		) {
			const segment = list[index]!;
			if (segment.arrowId === arrowId) continue;
			if (segmentsOverlapInterior(candidate, segment)) overlaps += 1;
			else if (
				Math.abs(segment.staticCoordinate - candidate.staticCoordinate) < gap &&
				segmentOverlapLength(candidate, segment) > AXIS_ALIGNED_EPSILON
			)
				beside += 1;
		}
		return { beside, overlaps };
	};
}

/**
 * Binary-heap open list for the grid search. It pops the lowest estimate and,
 * among equal estimates, the most recently queued step.
 */
function stepQueue<T extends { readonly estimate: number }>() {
	const heap: { item: T; order: number }[] = [];
	let queued = 0;
	const before = (a: { item: T; order: number }, b: { item: T; order: number }) =>
		a.item.estimate < b.item.estimate || (a.item.estimate === b.item.estimate && a.order > b.order);
	const swap = (i: number, j: number) => {
		[heap[i], heap[j]] = [heap[j]!, heap[i]!];
	};
	return {
		get size() {
			return heap.length;
		},
		push(item: T) {
			heap.push({ item, order: queued++ });
			for (let i = heap.length - 1; i > 0;) {
				const parent = (i - 1) >> 1;
				if (!before(heap[i]!, heap[parent]!)) break;
				swap(i, parent);
				i = parent;
			}
		},
		pop(): T {
			const top = heap[0]!;
			const last = heap.pop()!;
			if (heap.length > 0) {
				heap[0] = last;
				for (let i = 0; ;) {
					const left = 2 * i + 1;
					const right = left + 1;
					let next = i;
					if (left < heap.length && before(heap[left]!, heap[next]!)) next = left;
					if (right < heap.length && before(heap[right]!, heap[next]!)) next = right;
					if (next === i) break;
					swap(i, next);
					i = next;
				}
			}
			return top.item;
		},
	};
}

/**
 * Variants of a route whose middle runs move just clear of a parallel neighbor
 * they would otherwise read as one line with. The endpoint stubs stay fixed.
 */
function lanesClearOfNeighbors(
	points: readonly [ScenePoint, ...ScenePoint[]],
	segments: readonly RouteSegment[],
	route: RoutedEdge,
	gap: number,
): [ScenePoint, ...ScenePoint[]][] {
	const arrowId = `edge:${route.edge.id}`;
	const variants: [ScenePoint, ...ScenePoint[]][] = [];
	for (const run of segmentsFromPoints(points)) {
		if (run.isFirstSegment || run.isLastSegment) continue;
		for (const other of segments) {
			if (
				other.arrowId === arrowId ||
				other.orientation !== run.orientation ||
				Math.abs(other.staticCoordinate - run.staticCoordinate) >= gap ||
				segmentOverlapLength(run, other) <= AXIS_ALIGNED_EPSILON
			)
				continue;
			for (const lane of [other.staticCoordinate - gap - 1, other.staticCoordinate + gap + 1]) {
				const moved = points.map((point, index) =>
					index === run.segmentIndex || index === run.segmentIndex + 1
						? run.orientation === "horizontal"
							? { x: point.x, y: lane }
							: { x: lane, y: point.y }
						: point,
				);
				variants.push(compactPoints(moved));
			}
		}
	}
	return variants;
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
	arrowSegments: readonly RouteSegment[],
	outlineSegments: readonly RouteSegment[],
	corridorGap = 0,
	maxSteps = Infinity,
	guided = true,
): [ScenePoint, ...ScenePoint[]] | undefined {
	// With a corridor gap, also offer lanes far enough from each routed point to read apart.
	const lanes = (coordinate: number) =>
		[...new Set([PORT_SPACING, Math.max(PORT_SPACING, corridorGap + 1)])].flatMap((offset) => [
			coordinate - offset,
			coordinate + offset,
		]);
	const xs = [
		...new Set([
			startStub.x,
			endStub.x,
			...shapes.flatMap((s) => [s.x - PORT_SPACING, s.x + s.width + PORT_SPACING]),
			...arrows.flatMap((a) => a.points.flatMap((p) => lanes(p.x))),
		]),
	].sort((a, b) => a - b);
	const ys = [
		...new Set([
			startStub.y,
			endStub.y,
			...shapes.flatMap((s) => [s.y - PORT_SPACING, s.y + s.height + PORT_SPACING]),
			...arrows.flatMap((a) => a.points.flatMap((p) => lanes(p.y))),
		]),
	].sort((a, b) => a - b);
	const key = (x: number, y: number, axis: number) => (x * ys.length + y) * 2 + axis;
	const arrowId = `edge:${route.edge.id}`;
	const nearby = segmentOverlapLookup(arrowSegments, corridorGap);
	const nearOutline =
		outlineSegments.length > 0
			? segmentOverlapLookup(outlineSegments, GROUP_OUTLINE_CLEARANCE)
			: undefined;
	const stubs = [...segmentsFromPoints([start, startStub]), ...segmentsFromPoints([endStub, end])];
	type Step = {
		x: number;
		y: number;
		axis: number;
		cost: number;
		estimate: number;
		previous?: Step;
	};
	// Every step costs at least its length, so the Manhattan distance to the arrival
	// stub never overestimates: A* finds the same lowest cost while expanding less.
	// Unguided, the search expands in pure cost order like the plain router.
	const remaining = (x: number, y: number) =>
		guided ? Math.abs(xs[x]! - endStub.x) + Math.abs(ys[y]! - endStub.y) : 0;
	const initialX = xs.indexOf(startStub.x);
	const initialY = ys.indexOf(startStub.y);
	const initial: Step = {
		x: initialX,
		y: initialY,
		axis: start.x === startStub.x ? 1 : 0,
		cost: 0,
		estimate: remaining(initialX, initialY),
	};
	const pending = stepQueue<Step>();
	pending.push(initial);
	const costs = new Map<number, number>([[key(initial.x, initial.y, initial.axis), 0]]);
	// Each grid edge's obstacle test and length, computed once however often it is relaxed.
	const edgeCosts = new Map<number, number | undefined>();
	for (let steps = 0; pending.size && steps < maxSteps; steps += 1) {
		const current = pending.pop();
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
			const gridEdge = (Math.min(x, current.x) * ys.length + Math.min(y, current.y)) * 2 + axis;
			if (!edgeCosts.has(gridEdge)) {
				const segment = segmentsFromPoints([point, next], 0)[0]!;
				const step = segmentsFromPoints([point, next])[0];
				const { beside, overlaps } = step ? nearby(step, arrowId) : { beside: 0, overlaps: 0 };
				const outline = step && nearOutline ? nearOutline(step, arrowId) : undefined;
				edgeCosts.set(
					gridEdge,
					shapes.some((shape) => segmentCrossesBoundsInterior(segment, shape)) ||
						// Neither the departure nor the arrival may double back over its port stub.
						stubs.some((stub) => segmentsOverlapInterior(segment, stub))
						? undefined
						: Math.abs(next.x - point.x) +
								Math.abs(next.y - point.y) +
								overlaps * 10000 +
								beside * 1000 +
								(outline ? (outline.beside + outline.overlaps) * 1000 : 0),
				);
			}
			const edgeCost = edgeCosts.get(gridEdge);
			if (edgeCost === undefined) continue;
			const cost = current.cost + edgeCost + (axis === current.axis ? 0 : 24);
			const id = key(x, y, axis);
			if (cost >= (costs.get(id) ?? Infinity)) continue;
			costs.set(id, cost);
			pending.push({ x, y, axis, cost, estimate: cost + remaining(x, y), previous: current });
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
	{ readerScale, guided, bandOf }: RouteOptions,
): [ScenePoint, ...ScenePoint[]] {
	const horizontalDominant = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
	const ignoredNodeIds = new Set([route.source.nodeId, route.target.nodeId]);
	const band = bandOf?.get(route.source.nodeId);
	const extent =
		band === undefined ? shapes : shapes.filter((shape) => bandOf!.get(shape.nodeId) === band);
	const minX = Math.min(...extent.map((shape) => shape.x));
	const maxX = Math.max(...extent.map((shape) => shape.x + shape.width));
	const minY = Math.min(...extent.map((shape) => shape.y));
	const maxY = Math.max(...extent.map((shape) => shape.y + shape.height));
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
	// Staggered stubs separate parallel lanes; the plain stub can turn clear of nearby arrowheads.
	const stubDistances =
		readerScale === undefined
			? [localStubDistance]
			: [...new Set([localStubDistance, ROUTE_STUB_LENGTH])];
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
	const continuation =
		route.lane === undefined
			? []
			: stubDistances.map((distance) =>
					route.sourceEdge === "top" || route.sourceEdge === "bottom"
						? routeForVerticalLane(route.lane!, distance)
						: routeForHorizontalLane(route.lane!, distance),
				);
	const candidates = [
		...continuation,
		compactPoints([start, end]),
		compactPoints([start, startStub, { x: startStub.x, y: endStub.y }, endStub, end]),
		compactPoints([start, startStub, { x: endStub.x, y: startStub.y }, endStub, end]),
		...lanes.flatMap(([lane, generator]) =>
			stubDistances.map((distance) => generator(lane, distance)),
		),
	];

	const routed = routedSoFar(existingArrows, readerScale);
	const first = chooseBestRoute(candidates, shapes, ignoredNodeIds, route, routed);
	const gap = readerScale === undefined ? 0 : routingCorridorGap(readerScale);
	const best = gap
		? chooseBestRoute(
				[first, ...lanesClearOfNeighbors(first, routed.segments, route, gap)],
				shapes,
				ignoredNodeIds,
				route,
				routed,
			)
		: first;
	const corridors = (points: [ScenePoint, ...ScenePoint[]]) =>
		routed.quality?.({
			id: `edge:${route.edge.id}`,
			points,
			sourceId: route.edge.source,
			targetId: route.edge.target,
		}).corridors ?? 0;
	const hard =
		routeNodeCrossingCount(best, shapes, ignoredNodeIds) ||
		routeSelfOverlapCount(best, route) ||
		routeArrowOverlapCount(best, routed.segments, route) ||
		routeOutlineBesideCount(best, routed.outlines);
	if (hard || corridors(best)) {
		// Search lanes that read apart only when a corridor is what remains to fix.
		const detour = obstacleRoute(
			start,
			end,
			startStub,
			endStub,
			shapes,
			route,
			existingArrows,
			routed.segments,
			routed.outlines,
			hard ? 0 : gap,
			// A corridor is polish: search a bounded neighborhood, never the whole grid.
			hard ? Infinity : CORRIDOR_SEARCH_STEPS,
			guided,
		);
		if (detour) return chooseBestRoute([best, detour], shapes, ignoredNodeIds, route, routed);
	}
	return best;
}

/** Route every edge in order; each avoids earlier routes and every reserved endpoint stub. */
function routeAllEdges(
	routes: readonly RoutedEdge[],
	edgeRouting: IntermediateDiagram["layout"]["edgeRouting"],
	portOffsets: ReadonlyMap<string, number>,
	nodeShapes: readonly NodeSceneElement[],
	options: RouteOptions,
	order: readonly number[] = routes.map((_, index) => index),
): ArrowSceneElement[] {
	const labelObstacles = branchLabelObstacles(routes, portOffsets);
	const endpointStubs =
		edgeRouting === "orthogonal" ? endpointStubsForRoutes(routes, portOffsets) : [];
	// Frame outlines are lines routes keep apart from, as from each other.
	const outlines = groupOutlineLines(options.groups);
	const edgeArrows: ArrowSceneElement[] = [];
	for (const route of order.map((index) => routes[index]!)) {
		edgeArrows.push(
			arrowForRoute(
				route,
				edgeRouting,
				portOffsets,
				[
					...nodeShapes,
					...labelObstacles.filter((label) => label.nodeId !== `branch-label:${route.edge.id}`),
					...groupObstacles(options.groups, route),
				],
				[...outlines, ...endpointStubs, ...edgeArrows],
				options,
			),
		);
	}
	// Hand arrows back in edge order so labels and z-order follow the diagram.
	return routes.map((route) => edgeArrows.find((arrow) => arrow.edgeId === route.edge.id)!);
}

/** Reroutes allowed after a layout still has an export defect. */
const MAX_REROUTES = 4;

/**
 * Rip up and reroute: when routes still overlap or cross a node, route the later
 * edge of the first defect before the earlier one (or first, for a node crossing)
 * and keep the order only if the export defects drop.
 */
function rerouteDefects(
	arrows: ArrowSceneElement[],
	routes: readonly RoutedEdge[],
	portOffsets: ReadonlyMap<string, number>,
	nodeShapes: readonly NodeSceneElement[],
	options: RouteOptions,
): ArrowSceneElement[] {
	let defects = exportRouteDefects(arrows, nodeShapes, options.groups);
	let order = routes.map((_, index) => index);
	for (let attempt = 0; attempt < MAX_REROUTES && defects.length > 0; attempt += 1) {
		const position = (arrowId: string) =>
			order.findIndex((index) => `edge:${routes[index]!.edge.id}` === arrowId);
		const [first, second] = defects[0]!;
		const [earlier, later] =
			second === undefined
				? [0, position(first)]
				: [
						Math.min(position(first), position(second)),
						Math.max(position(first), position(second)),
					];
		if (later <= earlier) break;
		const next = [...order];
		next.splice(earlier, 0, ...next.splice(later, 1));
		const retry = routeAllEdges(routes, "orthogonal", portOffsets, nodeShapes, options, next);
		const retryDefects = exportRouteDefects(retry, nodeShapes, options.groups);
		if (retryDefects.length >= defects.length) break;
		[arrows, defects, order] = [retry, retryDefects, next];
	}
	return arrows;
}

/**
 * A forward edge that hooks sideways just before its arrowhead, or crosses
 * another arrow on its final approach, reads better entering the free side its
 * last run already approaches. Returns the routes it moved with their previous sides.
 */
function resideArrivals(
	routes: readonly RoutedEdge[],
	arrows: readonly ArrowSceneElement[],
	diagram: IntermediateDiagram,
	scale: number,
	trigger: "hooked" | "crossed",
): { route: RoutedEdge; side: ConnectionEdge }[] {
	const feedback = flowFeedback(diagram);
	const used = new Set(
		routes.flatMap((route) => [
			portKey(route.source.nodeId, route.sourceEdge),
			portKey(route.target.nodeId, route.targetEdge),
		]),
	);
	const resided: { route: RoutedEdge; side: ConnectionEdge }[] = [];
	for (const [index, arrow] of arrows.entries()) {
		const route = routes[index]!;
		if (feedback.has(route.edge.id)) continue;
		const moves =
			trigger === "hooked"
				? routingQualityFindings([{ id: arrow.id, points: arrow.points }], scale).some(
						(finding) => finding.kind === "endpoint-jog" && finding.endpoint === "end",
					)
				: arrows.some(
						(other) =>
							other !== arrow &&
							pathCrossings(arrow.points, other.points, arrow.points.length - 3) > 0,
					);
		if (!moves) continue;
		const segments = segmentsFromPoints(arrow.points);
		const last = segments.at(-1);
		const step = segments.findLast((segment) => segment.orientation !== last?.orientation);
		if (!last || !step) continue;
		const from = arrow.points[step.segmentIndex]!;
		const to = arrow.points[step.segmentIndex + 1]!;
		const side: ConnectionEdge =
			step.orientation === "horizontal"
				? to.x > from.x
					? "left"
					: "right"
				: to.y > from.y
					? "top"
					: "bottom";
		if (side === route.targetEdge || used.has(portKey(route.target.nodeId, side))) continue;
		resided.push({ route, side: route.targetEdge });
		used.add(portKey(route.target.nodeId, side));
		route.targetEdge = side;
	}
	return resided;
}

/**
 * Overlapping segments and segments through unbound nodes, counted as
 * validateExcalidrawScene counts them on the export: bound stems that leave or
 * reach one node at one point in one direction may coincide.
 */
function exportRouteDefects(
	arrows: readonly ArrowSceneElement[],
	nodes: readonly NodeSceneElement[],
	groups?: GroupLayout,
): (readonly [string] | readonly [string, string])[] {
	const segments = arrows.flatMap((arrow) =>
		segmentsFromPoints(arrow.points).map((segment) => {
			const from = arrow.points[segment.segmentIndex]!;
			const to = arrow.points[segment.segmentIndex + 1]!;
			return {
				...segment,
				arrowId: arrow.id,
				startBindingId: arrow.sourceNodeId,
				endBindingId: arrow.targetNodeId,
				from: segment.orientation === "horizontal" ? from.x : from.y,
				to: segment.orientation === "horizontal" ? to.x : to.y,
			};
		}),
	);
	const defects: (readonly [string] | readonly [string, string])[] = [];
	for (const [index, left] of segments.entries()) {
		for (const right of segments.slice(index + 1)) {
			if (left.arrowId === right.arrowId || !segmentsOverlapInterior(left, right)) continue;
			const departure =
				left.isFirstSegment && right.isFirstSegment && left.startBindingId === right.startBindingId;
			const shared =
				isSharedBoundStem(left, right) &&
				Math.abs((departure ? left.from : left.to) - (departure ? right.from : right.to)) <=
					AXIS_ALIGNED_EPSILON &&
				Math.sign(left.to - left.from) === Math.sign(right.to - right.from);
			if (!shared) defects.push([left.arrowId, right.arrowId]);
		}
		for (const node of nodes)
			if (
				node.nodeId !== left.startBindingId &&
				node.nodeId !== left.endBindingId &&
				segmentCrossesBoundsInterior(left, node)
			)
				defects.push([left.arrowId]);
	}
	return groups ? [...defects, ...groupRouteDefects(arrows, groups)] : defects;
}

/** Endpoints whose first step heads into their own node instead of away from it. */
function inwardEndpoints(
	arrows: readonly ArrowSceneElement[],
	nodes: readonly NodeSceneElement[],
): number {
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	let inward = 0;
	for (const arrow of arrows)
		for (const [nodeId, point, next] of [
			[arrow.sourceNodeId, arrow.points[0], arrow.points[1]],
			[arrow.targetNodeId, arrow.points.at(-1), arrow.points.at(-2)],
		] as const) {
			const node = byId.get(nodeId);
			if (!node || !point || !next) continue;
			const step = 0.0001;
			const x = (point.x + (next.x - point.x) * step - center(node).x) / (node.width / 2);
			const y = (point.y + (next.y - point.y) * step - center(node).y) / (node.height / 2);
			const extent =
				node.shape === "diamond"
					? Math.abs(x) + Math.abs(y)
					: node.shape === "ellipse" || node.shape === "circle"
						? Math.hypot(x, y)
						: Math.max(Math.abs(x), Math.abs(y));
			if (extent < 1 - 1e-6) inward += 1;
		}
	return inward;
}

/** Export defects that must not grow, and reader-scale findings to reduce. */
function routingDefects(
	arrows: readonly ArrowSceneElement[],
	nodes: readonly NodeSceneElement[],
	scale: number,
	groups?: GroupLayout,
): { hard: number; reader: number } {
	const reader = routingQualityFindings(
		arrows.map((arrow) => ({
			id: arrow.id,
			points: arrow.points,
			sourceId: arrow.sourceNodeId,
			targetId: arrow.targetNodeId,
		})),
		scale,
	).length;
	return { hard: exportRouteDefects(arrows, nodes, groups).length, reader };
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

/** Optional layout and routing passes; the plain router (as of #405) has all of them off. */
interface RoutingPolish {
	/** Aligned orthogonal ports and mirrored LR/RL decision vertices. */
	readonly ports: boolean;
	/** Reader-scale scoring of jogs, corridors and arrowheads, with lane variants. */
	readonly reader: boolean;
	/** Moving hooked arrivals to the side their last run approaches. */
	readonly sides: boolean;
	/**
	 * Repairs: room for facing stubs within and between ranks, label room on shared
	 * decision sides, rip-up and reroute, and a guided grid search.
	 */
	readonly repair: boolean;
}

const PLAIN: RoutingPolish = { ports: false, reader: false, sides: false, repair: false };

/**
 * Most polished first; each later level drops a pass. The last is the plain
 * router, so a layout never has more export defects or inward endpoints than
 * #405 would draw. Straight and curved routing only repair their port choices.
 */
function polishLevels(edgeRouting: IntermediateDiagram["layout"]["edgeRouting"]) {
	return edgeRouting === "orthogonal"
		? [
				{ ports: true, reader: true, sides: true, repair: true },
				{ ports: true, reader: true, sides: false, repair: true },
				{ ports: true, reader: false, sides: false, repair: true },
				{ ports: false, reader: false, sides: false, repair: true },
				PLAIN,
			]
		: [{ ...PLAIN, repair: true }, PLAIN];
}

/** Each continuation runs midway between the bands it joins. */
function assignContinuationLanes(
	routes: readonly RoutedEdge[],
	nodes: readonly NodeSceneElement[],
	wrap: Wrap,
): void {
	for (const route of routes) {
		if (!wrap.continuations.has(route.edge.id)) continue;
		const band = wrap.bandOf.get(route.source.nodeId) ?? 0;
		const across = route.sourceEdge === "top" || route.sourceEdge === "bottom" ? "x" : "y";
		const size = across === "x" ? "width" : "height";
		const inBand = (index: number) =>
			nodes.filter((node) => (wrap.bandOf.get(node.nodeId) ?? 0) === index);
		const end = Math.max(...inBand(band).map((node) => node[across] + node[size]));
		const start = Math.min(...inBand(band + 1).map((node) => node[across]));
		route.lane = (end + start) / 2;
	}
}

interface DiagramLayout {
	edgeArrows: ArrowSceneElement[];
	groups?: GroupLayout;
	nodeShapes: NodeSceneElement[];
	routedEdges: RoutedEdge[];
}

/** Extra padding a crowded group gains per repair, and how many repairs it may take. */
const GROUP_SLACK = 2 * PORT_SPACING;
const GROUP_SLACK_ROUNDS = 3;

/**
 * Groups too tight for their own edges: an edge with an end inside the group
 * has an export or group defect, or a branch label leaving one of its members
 * touches a frame or a group's name.
 */
function crowdedGroups(layout: DiagramLayout): Set<string> {
	const { edgeArrows, groups, nodeShapes, routedEdges } = layout;
	const crowded = new Set<string>();
	if (!groups) return crowded;
	const arrows = new Map(edgeArrows.map((arrow) => [arrow.id, arrow]));
	for (const defect of exportRouteDefects(edgeArrows, nodeShapes, groups))
		for (const id of defect) {
			const arrow = arrows.get(id);
			for (const nodeId of arrow ? [arrow.sourceNodeId, arrow.targetNodeId] : []) {
				const group = groups.groupOf.get(nodeId);
				if (group !== undefined) crowded.add(group);
			}
		}
	const labels = branchLabels([...edgeArrows], routedEdges, nodeShapes, groups);
	const outlines = groups.frames.flatMap((frame) => frameOutline(frame.box));
	for (const label of labels) {
		const arrow = arrows.get(label.id.slice(0, -":label".length));
		const group = arrow ? groups.groupOf.get(arrow.sourceNodeId) : undefined;
		if (group === undefined) continue;
		const box = labelBox(label, freeLabelSize(label.text, label.maxWidth ?? 160));
		if (
			outlines.some((edge) => segmentCrossesBoundsInterior(edge, box)) ||
			groups.frames.some((frame) => boxesOverlap(box, frame.labelBox))
		)
			crowded.add(group);
	}
	return crowded;
}

/**
 * Lay out and route, then give each crowded group more room and try again,
 * keeping a retry only when it draws fewer export and group defects.
 */
function layoutDiagram(
	diagram: IntermediateDiagram,
	polish: RoutingPolish,
	arrangement: Arrangement = PLAIN_ARRANGEMENT,
): DiagramLayout {
	let layout = layoutDiagramOnce(diagram, polish, arrangement, new Map());
	if (!layout.groups) return layout;
	const defects = (attempt: DiagramLayout) =>
		exportRouteDefects(attempt.edgeArrows, attempt.nodeShapes, attempt.groups).length +
		crowdedGroups(attempt).size;
	let slack = new Map<string, number>();
	let score = defects(layout);
	for (let round = 0; round < GROUP_SLACK_ROUNDS && score > 0; round += 1) {
		const crowded = crowdedGroups(layout);
		if (crowded.size === 0) break;
		slack = new Map([
			...slack,
			...[...crowded].map((id) => [id, (slack.get(id) ?? 0) + GROUP_SLACK] as const),
		]);
		const retry = layoutDiagramOnce(diagram, polish, arrangement, slack);
		const retryScore = defects(retry);
		if (retryScore < score) [layout, score] = [retry, retryScore];
	}
	return layout;
}

function layoutDiagramOnce(
	diagram: IntermediateDiagram,
	polish: RoutingPolish,
	arrangement: Arrangement,
	slack: ReadonlyMap<string, number>,
): DiagramLayout {
	const orthogonal = diagram.layout.edgeRouting === "orthogonal";
	const offsetsFor = (routes: readonly RoutedEdge[]) =>
		polish.ports
			? alignedPortOffsets(routes, polish.repair, arrangement.crossingRepair)
			: portOffsetsForRoutes(routes, polish.repair);
	const { wrap } = arrangement;
	let { groups, nodes: nodeShapes } = positionLayout(
		diagram,
		new Map(),
		new Map(),
		arrangement,
		slack,
	);
	// Groups laid out across the flow read in their own direction inside.
	const { direction } = diagram.layout;
	const acrossOf = (nodeId: string) =>
		arrangement.groupsAcross ? groups?.groupOf.get(nodeId) : undefined;
	const nodeDirection = (nodeId: string) =>
		acrossOf(nodeId) === undefined ? direction : ACROSS_DIRECTION[direction];
	const edgeDirection = (edge: DiagramEdge) =>
		acrossOf(edge.source) !== undefined && acrossOf(edge.source) === acrossOf(edge.target)
			? ACROSS_DIRECTION[direction]
			: direction;
	const assignSides = (routes: RoutedEdge[], mirror: boolean) => {
		for (const sourceDirection of new Set(routes.map((r) => nodeDirection(r.source.nodeId))))
			assignDecisionSides(
				routes.filter((r) => nodeDirection(r.source.nodeId) === sourceDirection),
				sourceDirection,
				mirror,
			);
	};
	const shapesByNodeId = new Map(nodeShapes.map((shape) => [shape.nodeId, shape]));
	const routedEdges = diagram.edges.map((edge, index) =>
		routeForEdge(edge, index, shapesByNodeId, edgeDirection(edge), wrap.continuations.has(edge.id)),
	);
	const mirrored = orthogonal && polish.ports;
	assignSides(routedEdges, mirrored);
	let portOffsets: Map<string, number>;
	let capacity: Map<string, { width: number; height: number }>;
	if (orthogonal) {
		assignFeedbackSides(routedEdges, diagram, (route) => edgeDirection(route.edge));
		portOffsets = offsetsFor(routedEdges);
		capacity = portCapacityForRoutes(routedEdges, portOffsets);
	} else {
		const direct = assignDirectFeedbackPorts(routedEdges, diagram, nodeShapes, polish.repair);
		portOffsets = direct.offsets;
		capacity = direct.minimumSizes;
	}
	// A grouped layout always sizes its frames to hold their members' stubs.
	const reach =
		orthogonal && (polish.repair || groups)
			? stubReachForRoutes(routedEdges, portOffsets)
			: new Map<string, number>();
	if (capacity.size > 0 || reach.size > 0) {
		({ groups, nodes: nodeShapes } = positionLayout(diagram, capacity, reach, arrangement, slack));
		const resized = new Map(nodeShapes.map((node) => [node.nodeId, node]));
		for (const route of routedEdges) {
			route.source = resized.get(route.source.nodeId)!;
			route.target = resized.get(route.target.nodeId)!;
			if (!orthogonal)
				Object.assign(route, connectionEdges(route.source, route.target, diagram.layout.direction));
		}
		if (orthogonal) portOffsets = offsetsFor(routedEdges);
		else {
			assignDecisionSides(routedEdges, diagram.layout.direction, mirrored);
			portOffsets = assignDirectFeedbackPorts(
				routedEdges,
				diagram,
				nodeShapes,
				polish.repair,
			).offsets;
		}
	}
	assignContinuationLanes(routedEdges, nodeShapes, wrap);
	// Judge jogs and corridors at the size a reader sees the exported diagram.
	const drawn = [...nodeShapes, ...groupBlocks(groups)];
	const scale = routingQualityScale({
		width:
			Math.max(...drawn.map((node) => node.x + node.width)) -
			Math.min(...drawn.map((node) => node.x)),
		height:
			Math.max(...drawn.map((node) => node.y + node.height)) -
			Math.min(...drawn.map((node) => node.y)),
	});
	const options: RouteOptions = {
		guided: polish.repair,
		...(polish.reader ? { readerScale: scale } : {}),
		...(wrap.continuations.size > 0 ? { bandOf: wrap.bandOf } : {}),
		...(groups ? { groups } : {}),
	};
	let edgeArrows = routeAllEdges(
		routedEdges,
		diagram.layout.edgeRouting,
		portOffsets,
		nodeShapes,
		options,
	);
	if (orthogonal && polish.sides) {
		const resided = resideArrivals(routedEdges, edgeArrows, diagram, scale, "hooked");
		if (resided.length > 0) {
			const offsets = offsetsFor(routedEdges);
			const retry = routeAllEdges(routedEdges, "orthogonal", offsets, nodeShapes, options);
			const [before, after] = [edgeArrows, retry].map((arrows) =>
				routingDefects(arrows, nodeShapes, scale, groups),
			);
			if (after!.hard <= before!.hard && after!.reader < before!.reader)
				[edgeArrows, portOffsets] = [retry, offsets];
			else for (const { route, side } of resided) route.targetEdge = side;
		}
		// Then arrivals crossed on their final approach, kept only if crossings drop
		// and nothing else grows.
		const crossed = arrangement.crossingRepair
			? resideArrivals(routedEdges, edgeArrows, diagram, scale, "crossed")
			: [];
		if (crossed.length > 0) {
			const offsets = offsetsFor(routedEdges);
			const retry = routeAllEdges(routedEdges, "orthogonal", offsets, nodeShapes, options);
			if (
				exportRouteDefects(retry, nodeShapes, groups).length <=
					exportRouteDefects(edgeArrows, nodeShapes, groups).length &&
				routesNoWorse(
					{ edgeArrows: retry, ...(groups ? { groups } : {}), nodeShapes },
					{ edgeArrows, ...(groups ? { groups } : {}), nodeShapes },
					true,
				)
			)
				[edgeArrows, portOffsets] = [retry, offsets];
			else for (const { route, side } of crossed) route.targetEdge = side;
		}
	}
	if (orthogonal && polish.repair)
		edgeArrows = rerouteDefects(edgeArrows, routedEdges, portOffsets, nodeShapes, options);
	return { edgeArrows, ...(groups ? { groups } : {}), nodeShapes, routedEdges };
}

/** Size of the nodes, arrows and any free labels drawn. */
function drawnSize(
	nodes: readonly NodeSceneElement[],
	arrows: readonly ArrowSceneElement[],
	labels: readonly TextSceneElement[] = [],
): { width: number; height: number } {
	const points = [
		...nodes.flatMap((node) => [
			{ x: node.x, y: node.y },
			{ x: node.x + node.width, y: node.y + node.height },
		]),
		...arrows.flatMap((arrow) => arrow.points),
		...labels.flatMap((label) => {
			const { width, height } = freeLabelSize(label.text, label.maxWidth ?? 160);
			return [
				{ x: label.x - width / 2, y: label.y - height / 2 },
				{ x: label.x + width / 2, y: label.y + height / 2 },
			];
		}),
	];
	return {
		width:
			Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
		height:
			Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
	};
}

/** Interior crossings of the axis-aligned segments of `a`, from segment `from` on, with those of `b`. */
function pathCrossings(a: readonly ScenePoint[], b: readonly ScenePoint[], from = 0): number {
	const between = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + AXIS_ALIGNED_EPSILON && value < Math.max(p, q) - AXIS_ALIGNED_EPSILON;
	const horizontal = (p: ScenePoint, q: ScenePoint) =>
		Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON && Math.abs(p.x - q.x) > AXIS_ALIGNED_EPSILON;
	const vertical = (p: ScenePoint, q: ScenePoint) =>
		Math.abs(p.x - q.x) <= AXIS_ALIGNED_EPSILON && Math.abs(p.y - q.y) > AXIS_ALIGNED_EPSILON;
	let crossings = 0;
	for (let i = Math.max(0, from); i < a.length - 1; i += 1)
		for (let j = 0; j < b.length - 1; j += 1) {
			const [p, q, r, u] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
			const [across, along] =
				horizontal(p, q) && vertical(r, u)
					? [
							[p, q],
							[r, u],
						]
					: vertical(p, q) && horizontal(r, u)
						? [
								[r, u],
								[p, q],
							]
						: [];
			if (
				across &&
				along &&
				between(along[0]!.x, across[0]!.x, across[1]!.x) &&
				between(across[0]!.y, along[0]!.y, along[1]!.y)
			)
				crossings += 1;
		}
	return crossings;
}

/** Interior crossings between different arrows. */
function arrowCrossings(arrows: readonly ArrowSceneElement[]): number {
	return arrows.reduce(
		(sum, arrow, index) =>
			sum +
			arrows
				.slice(index + 1)
				.reduce((pair, other) => pair + pathCrossings(arrow.points, other.points), 0),
		0,
	);
}

/**
 * Reader-scale findings as the routing tests count them: jogs, near-coincident
 * corridors, touching arrowheads and lines through another arrowhead, at the
 * export size of everything drawn.
 */
function readerFindingCount(
	arrows: readonly ArrowSceneElement[],
	nodes: readonly NodeSceneElement[],
): number {
	const scale = routingQualityScale(drawnSize(nodes, arrows));
	const routes = arrows.map((arrow) => ({
		id: arrow.id,
		points: arrow.points,
		sourceId: arrow.sourceNodeId,
		targetId: arrow.targetNodeId,
	}));
	const quality = candidateRouteQuality(routes, scale);
	return (
		routingQualityFindings(routes, scale).length +
		routes.filter((route) => quality(route).arrowheadsCrossed > 0).length
	);
}

/**
 * Neither more crossings (or, when `fewerCrossings`, strictly fewer) nor more
 * reader-scale findings, each judged at its own export size, and no newly
 * extreme or longer aspect.
 */
function routesNoWorse(
	candidate: Pick<DiagramLayout, "edgeArrows" | "groups" | "nodeShapes">,
	current: Pick<DiagramLayout, "edgeArrows" | "groups" | "nodeShapes">,
	fewerCrossings = false,
): boolean {
	const [crossings, currentCrossings] = [candidate, current].map((layout) =>
		arrowCrossings(layout.edgeArrows),
	);
	const [aspect, currentAspect] = [candidate, current].map((layout) => {
		const { width, height } = drawnSize(
			[...layout.nodeShapes, ...groupBlocks(layout.groups)],
			layout.edgeArrows,
		);
		return exportAspect(width, height);
	});
	return (
		(fewerCrossings ? crossings! < currentCrossings! : crossings! <= currentCrossings!) &&
		(aspect! < WRAP_ASPECT || aspect! <= currentAspect! + AXIS_ALIGNED_EPSILON) &&
		readerFindingCount(candidate.edgeArrows, [
			...candidate.nodeShapes,
			...groupBlocks(candidate.groups),
		]) <=
			readerFindingCount(current.edgeArrows, [
				...current.nodeShapes,
				...groupBlocks(current.groups),
			])
	);
}

/**
 * Draw each group as an Excalidraw frame named by its label, and make every
 * member a child of it: nodes and their labels always, and a group's own edges
 * with their labels when they lie wholly inside, since a frame clips its
 * children. Moving the frame in the editor then moves the whole group.
 */
function withGroupFrames(
	groups: GroupLayout,
	drawn: {
		readonly arrows: readonly ArrowSceneElement[];
		readonly labels: readonly TextSceneElement[];
		readonly nodes: readonly NodeSceneElement[];
	},
): {
	arrows: ArrowSceneElement[];
	frames: FrameSceneElement[];
	labels: TextSceneElement[];
	nodes: NodeSceneElement[];
} {
	const frames = new Map(groups.frames.map((frame) => [frame.id, frame]));
	const frameOf = (nodeId: string) => {
		const group = groups.groupOf.get(nodeId);
		return group === undefined ? undefined : frames.get(group);
	};
	const branchLabelsById = new Map(drawn.labels.map((label) => [label.id, label]));
	const arrowFrames = new Map<string, string>();
	for (const arrow of drawn.arrows) {
		const frame = frameOf(arrow.sourceNodeId);
		if (!frame || frame !== frameOf(arrow.targetNodeId)) continue;
		const label = branchLabelsById.get(`${arrow.id}:label`);
		const size = label ? freeLabelSize(label.text, label.maxWidth ?? 160) : undefined;
		const labelInside =
			!label ||
			!size ||
			[
				{ x: label.x - size.width / 2, y: label.y - size.height / 2 },
				{ x: label.x + size.width / 2, y: label.y + size.height / 2 },
			].every((point) => insideBox(point, frame.box));
		if (labelInside && arrow.points.every((point) => insideBox(point, frame.box)))
			arrowFrames.set(arrow.id, frame.elementId);
	}
	const nodeFrames = new Map(
		drawn.nodes.flatMap((node) => {
			const frame = frameOf(node.nodeId);
			return frame ? [[node.id, frame.elementId] as const] : [];
		}),
	);
	return {
		arrows: drawn.arrows.map((arrow) => {
			const frameId = arrowFrames.get(arrow.id);
			return frameId ? { ...arrow, frameId } : arrow;
		}),
		frames: groups.frames.map((frame) => ({
			type: "frame",
			id: frame.elementId,
			name: frame.label,
			...frame.box,
		})),
		labels: drawn.labels.map((label) => {
			const frameId = label.containerId
				? nodeFrames.get(label.containerId)
				: arrowFrames.get(label.id.slice(0, -":label".length));
			return frameId ? { ...label, frameId } : label;
		}),
		nodes: drawn.nodes.map((node) => {
			const frameId = nodeFrames.get(node.id);
			return frameId ? { ...node, frameId } : node;
		}),
	};
}

export function renderIntermediateDiagram(input: unknown): RenderedDiagramScene {
	const diagram = parseIntermediateDiagram(input);
	// Export defects come first; inward endpoints only break ties.
	const defectsOf = (attempt: DiagramLayout) =>
		[
			exportRouteDefects(attempt.edgeArrows, attempt.nodeShapes, attempt.groups).length,
			inwardEndpoints(attempt.edgeArrows, attempt.nodeShapes),
		] as const;
	const fewer = (a: readonly [number, number], b: readonly [number, number]) =>
		a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
	// Polish must never cost a valid export: drop passes until the export defects and
	// inward endpoints are as few as the plain router's, preferring more polish on a tie.
	const levels = polishLevels(diagram.layout.edgeRouting);
	const settle = (arrangement: Arrangement) => {
		const [first, ...fallbacks] = levels;
		let layout = layoutDiagram(diagram, first!, arrangement);
		let defects = defectsOf(layout);
		for (const polish of fallbacks) {
			if (defects[0] === 0 && defects[1] === 0) break;
			const candidate = layoutDiagram(diagram, polish, arrangement);
			const candidateDefects = defectsOf(candidate);
			if (fewer(candidateDefects, defects)) [layout, defects] = [candidate, candidateDefects];
		}
		return { arrangement, defects, layout };
	};
	let best = settle(PLAIN_ARRANGEMENT);
	// Another arrangement is tried at full polish only, and kept when it has no more
	// defects and routes no worse (or, `fewerCrossings`, with strictly fewer crossings).
	const consider = (arrangement: Arrangement, fewerCrossings: boolean) => {
		const layout = layoutDiagram(diagram, levels[0]!, arrangement);
		const defects = defectsOf(layout);
		if (!fewer(best.defects, defects) && routesNoWorse(layout, best.layout, fewerCrossings))
			best = { arrangement, defects, layout };
	};
	const orthogonal = diagram.layout.edgeRouting === "orthogonal";
	// Crossing repairs are tried only where the polished router crossed: arrival
	// order and moved arrivals stay when they route no worse, and reordered ranks
	// only when they route with fewer crossings.
	const repairable = orthogonal && diagram.edges.length <= CROSSING_REPAIR_MAX_EDGES;
	if (repairable && arrowCrossings(best.layout.edgeArrows) > 0)
		consider({ ...best.arrangement, crossingRepair: true }, false);
	if (repairable && arrowCrossings(best.layout.edgeArrows) > 0 && reordersRanks(diagram))
		consider({ ...best.arrangement, reorder: true }, true);
	// A flow too long for its breadth wraps when the wrapped layout routes no worse.
	// Its size includes the branch labels, as the exported PNG does.
	const size = drawnSize(
		[...best.layout.nodeShapes, ...groupBlocks(best.layout.groups)],
		best.layout.edgeArrows,
		[
			...branchLabels(
				[...best.layout.edgeArrows],
				best.layout.routedEdges,
				best.layout.nodeShapes,
				best.layout.groups,
			),
		],
	);
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const [along, across] = vertical ? [size.height, size.width] : [size.width, size.height];
	const aspect = (along + 2 * EXPORT_PADDING) / (across + 2 * EXPORT_PADDING);
	const fittedText =
		(NODE_LABEL_FONT_SIZE * FITTED_LONG_SIDE) / (Math.max(along, across) + 2 * EXPORT_PADDING);
	const tooLong =
		aspect >= WRAP_EXTREME_ASPECT ||
		(aspect >= WRAP_ASPECT &&
			(vertical ? fittedText < WRAP_MIN_COLUMN_TEXT : along >= WRAP_MIN_LENGTH));
	const wrap = orthogonal && tooLong ? planWrap(diagram, best.arrangement.reorder) : NO_WRAP;
	// A wrapped layout may need crossing repairs of its own; it tries them first.
	for (const crossingRepair of repairable && !best.arrangement.crossingRepair
		? [true, false]
		: [best.arrangement.crossingRepair]) {
		if (wrap.continuations.size === 0 || best.arrangement.wrap === wrap) break;
		consider({ ...best.arrangement, crossingRepair, wrap }, false);
	}
	// A grouped flow never wraps, since a band cut would split a group; a long one
	// lays its groups across the flow instead, when that routes no worse.
	const groupsAcross = orthogonal && tooLong && groupStructure(diagram) !== undefined;
	for (const crossingRepair of repairable && !best.arrangement.crossingRepair
		? [true, false]
		: [best.arrangement.crossingRepair]) {
		if (!groupsAcross || best.arrangement.groupsAcross) break;
		consider({ ...best.arrangement, crossingRepair, groupsAcross: true }, false);
	}
	const { layout } = best;
	const { groups, routedEdges } = layout;
	const routedArrows = [...layout.edgeArrows];
	const drawn = {
		arrows: routedArrows,
		frames: [] as FrameSceneElement[],
		labels: [
			...layout.nodeShapes.map(textForNode),
			...branchLabels(routedArrows, routedEdges, layout.nodeShapes, groups),
		],
		nodes: layout.nodeShapes,
	};
	const {
		arrows: edgeArrows,
		frames,
		labels,
		nodes: nodeShapes,
	} = groups ? withGroupFrames(groups, drawn) : drawn;
	const elements = normalizeSceneOrigin([...frames, ...edgeArrows, ...nodeShapes, ...labels]);
	const bounds = sceneBounds(elements);
	const zOrder = [
		...frames.map((element) => element.id),
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
