import {
	CANVAS_NODE_ICON,
	CANVAS_SPEC_VERSION,
	AXIS_ALIGNED_EPSILON,
	canvasBoundTextBox,
	canvasNodeIconBand,
	type AxisAlignedSegment,
	CANVAS_FRAME_NAME,
	CANVAS_SHAPE_CURVE,
	canvasComposedOutlinePoint,
	canvasFrameNameBox,
	type CanvasComposedShapeKind,
	isCanvasComposedShape,
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
	type DiagramZoneKind,
	boundLabelWidth,
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
	bucket: 28,
	cylinder: 28,
	diamond: 20,
	document: 28,
	ellipse: 24,
	pipe: 28,
	polygon: 28,
	rectangle: 28,
};
/** The canvas shape each infrastructure node shape draws as. */
const COMPOSED_SHAPES: Readonly<
	Record<NonNullable<DiagramNode["shape"]>, CanvasComposedShapeKind>
> = { database: "cylinder", queue: "pipe", document: "document", storage: "bucket" };
const PORT_SPACING = 18;
const PORT_PADDING = 16;
const RANK_SWEEP_COUNT = 4;
const ROUTE_STUB_LENGTH = 36;
/** Grid-search expansions spent looking for a lane clear of a near-parallel neighbor. */
const CORRIDOR_SEARCH_STEPS = 5_000;
/** Grid-search cost of crossing another arrow: a detour this much longer reads better. */
const CROSSING_COST = 320;

type ConnectionEdge = "top" | "right" | "bottom" | "left";

interface RoutedEdge {
	edge: DiagramEdge;
	index: number;
	/** A wrap continuation's lane between its bands, across the flow. */
	lane?: number;
	/**
	 * One line of a paired transition and its return: -1 runs on the low side of
	 * the pair (left or above) and +1 on the high side, its label beside it there.
	 */
	pair?: -1 | 1;
	/** The side of its line a label sits on, when not the default: -1 left or above, +1 right or below. */
	labelSide?: -1 | 1;
	/** Ends a family pinned, with their offsets along their sides; nothing moves them. */
	pinned?: { source?: number; target?: number };
	/** Straight run kept at each end before the line turns or carries its label. */
	endRun?: number;
	/** A pinned end's own straight run, in place of the end run. */
	runs?: { source?: number; target?: number };
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
	/** Where the segment starts and ends along its orientation, in route order. */
	from: number;
	to: number;
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

/**
 * Edge of the round markers state machines draw: an initial pseudostate's dot
 * and a final state's bullseye. Each carries exactly one transition, so it
 * keeps one port per side and never widens for more.
 */
const MARKER_SIZE: Readonly<Record<string, number>> = { initial: 20, final: 28 };
/** A state is a compact rounded box; an unlabeled choice is a small diamond. */
const STATE_MIN_WIDTH = 136;
const STATE_MIN_HEIGHT = 56;
const CHOICE_SIZE = 44;

/** An unlabeled choice stays a square diamond as it grows for its ports. */
function squareChoice<T extends { width: number; height: number }>(shape: T, breadth: number): T {
	const edge = Math.max(shape.width, shape.height, breadth);
	return { ...shape, width: edge, height: edge };
}

function markerSize(node: { readonly kind?: string | undefined }): number | undefined {
	return node.kind === undefined ? undefined : MARKER_SIZE[node.kind];
}

/** Nodes that branch on labeled outgoing edges: flowchart decisions and state-machine choices. */
function branches(kind: string | undefined): boolean {
	return kind === "decision" || kind === "choice";
}

function shapeForNode(node: DiagramNode): NodeSceneShape {
	if (node.shape !== undefined) return COMPOSED_SHAPES[node.shape];
	const kind = node.kind?.toLowerCase();
	if (kind === "start" || kind === "end") {
		return "ellipse";
	}
	if (kind === "initial" || kind === "final") {
		return "circle";
	}
	if (branches(kind)) {
		return "diamond";
	}
	return "rectangle";
}

function createNodeShape(
	node: DiagramNode,
	minimumWidth = MIN_NODE_WIDTH,
	lineUnits = MAX_LABEL_LINE_UNITS,
): NodeSceneElement {
	const shape = shapeForNode(node);
	const marker = markerSize(node);
	if (marker !== undefined || (node.kind === "choice" && !node.label)) {
		const size = marker ?? CHOICE_SIZE;
		return {
			type: "node",
			id: `node:${node.id}`,
			nodeId: node.id,
			...(node.kind ? { kind: node.kind } : {}),
			shape,
			x: 0,
			y: 0,
			width: size,
			height: size,
			label: "",
		};
	}
	const labelMetrics = measureLabel(
		node.label,
		shape === "diamond" ? MAX_DIAMOND_LABEL_LINE_UNITS : lineUnits,
	);
	const icon = node.icon ? { slug: node.icon.slug, size: NODE_ICON_SIZE[shape] } : undefined;
	// A composed shape keeps its label's padding clear of the curves at its ends.
	const curve = isCanvasComposedShape(shape) ? CANVAS_SHAPE_CURVE[shape] : 0;
	const shapeWidthPad =
		shape === "diamond" ? 32 : shape === "ellipse" ? 20 : shape === "pipe" ? 4 * curve : 0;
	const shapeHeightPad =
		shape === "diamond"
			? 32
			: shape === "cylinder" || shape === "document" || shape === "bucket"
				? 3 * curve
				: 0;
	// Logo nodes, diamonds and composed shapes must fit Excalidraw's edit-time
	// text box; other plain nodes keep their padded label box, which already
	// contains it.
	const boundText =
		icon || shape === "diamond" || curve > 0
			? boundTextContainerSize(shape, labelMetrics, icon)
			: { height: 0, width: 0 };
	const [minWidth, minHeight] =
		node.kind === "state" ? [STATE_MIN_WIDTH, STATE_MIN_HEIGHT] : [minimumWidth, MIN_NODE_HEIGHT];

	return {
		type: "node",
		id: `node:${node.id}`,
		nodeId: node.id,
		...(node.kind ? { kind: node.kind } : {}),
		...(icon ? { icon } : {}),
		shape,
		x: 0,
		y: 0,
		width: Math.max(minWidth, labelMetrics.width + shapeWidthPad, boundText.width),
		height: icon
			? Math.max(minHeight, boundText.height)
			: Math.max(minHeight, labelMetrics.height + shapeHeightPad, boundText.height),
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

/**
 * Member pairs a zone's level ranks in order though no edge of its own joins
 * them: one that leaves the zone, then one reached back from outside it, as
 * workers fed by a queue the zone's API publishes to. The later member ranks
 * no earlier, so it sits beside the other, near where the loop leaves.
 */
const levelPrecedence = new WeakMap<IntermediateDiagram, readonly (readonly [string, string])[]>();

/** Ranks lifted so each level pair's later member ranks no earlier than the first. */
function liftRanks(
	diagram: IntermediateDiagram,
	ranks: Map<string, number>,
	feedback: ReadonlySet<string>,
): Map<string, number> {
	const pairs = levelPrecedence.get(diagram);
	if (!pairs) return ranks;
	for (let changed = true, round = 0; changed && round <= diagram.nodes.length; round += 1) {
		changed = false;
		for (const [before, after] of pairs)
			if (ranks.get(after)! < ranks.get(before)!) {
				ranks.set(after, ranks.get(before)!);
				changed = true;
			}
		for (const edge of diagram.edges)
			if (
				!feedback.has(edge.id) &&
				edge.source !== edge.target &&
				ranks.get(edge.target)! < ranks.get(edge.source)! + 1
			) {
				ranks.set(edge.target, ranks.get(edge.source)! + 1);
				changed = true;
			}
	}
	return ranks;
}

/** Inner padding of a group's frame around its members. */
const GROUP_PADDING = 40;
/** The band above each frame that keeps Excalidraw's frame name clear. */
const GROUP_LABEL_BAND = 28;
/** Thickness of the walls that keep a group's own edges inside its frame. */
const GROUP_WALL = 4;
const GROUP_UNIT_PREFIX = "\u0000group:";
/**
 * A zone's inner padding, slimmer than a frame's so nested zones stay compact,
 * and the header strip across its top that holds its label, which sits this
 * far in from the zone's left side.
 */
const ZONE_PADDING = 24;
const ZONE_HEADER = 36;
const ZONE_LABEL_INSET = 12;
const ZONE_LABEL_FONT_SIZE = CANVAS_FRAME_NAME.fontSize;

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
	/** A zone's kind, which sets its outline and fill. */
	readonly kind?: DiagramZoneKind;
	readonly label: string;
	readonly labelBox: Box;
}

interface GroupLayout {
	/** Groups whose members read across the diagram's flow. */
	readonly across: ReadonlySet<string>;
	/** Groups that edges start or end at, such as a composite state's transitions. */
	readonly composites: ReadonlySet<string>;
	/** Groups outermost first, so each draws over the zone around it. */
	readonly frames: readonly GroupFrame[];
	readonly groupOf: ReadonlyMap<string, string>;
	/** The group each nested zone sits inside, by group id. */
	readonly parentOf: ReadonlyMap<string, string>;
	/** Groups draw as zones, each label in a header strip inside it, instead of frames. */
	readonly zoned: boolean;
}

/** A group and every group around it, innermost first. */
function groupChain(groups: GroupLayout, groupId: string | undefined): string[] {
	const chain: string[] = [];
	for (let id = groupId; id !== undefined; id = groups.parentOf.get(id)) chain.push(id);
	return chain;
}

/** The innermost group holding both nodes, if any. */
function sharedGroup(groups: GroupLayout, left: string, right: string): string | undefined {
	const outer = new Set(groupChain(groups, groups.groupOf.get(right)));
	return groupChain(groups, groups.groupOf.get(left)).find((id) => outer.has(id));
}

/** One group's level of a grouped layout: its members, its nested groups and the edges between them. */
interface GroupLevel {
	/** The same members and edges, read across the diagram's flow. */
	readonly across: IntermediateDiagram;
	/** Nested groups, laid out as blocks among the members. */
	readonly children: readonly string[];
	/** Members, or nested groups, with an edge leaving the group. */
	readonly crossing: ReadonlySet<string>;
	readonly diagram: IntermediateDiagram;
	readonly group: DiagramGroup;
}

/**
 * A grouped diagram as nested layouts: each group's members, nested groups and
 * internal edges, and a top level where every outermost group is one block
 * among the ungrouped nodes.
 */
interface GroupStructure {
	/**
	 * Groups an edge starts or ends at by naming the group's id where a node id
	 * would be. Such an edge joins the group's frame, as a transition into or out
	 * of a composite state does.
	 */
	readonly composites: ReadonlySet<string>;
	/** The edges between top-level units, in the order of the top level's edges. */
	readonly crossEdges: readonly DiagramEdge[];
	readonly groupOf: ReadonlyMap<string, string>;
	/** Each group's level, in declared order. */
	readonly groups: readonly GroupLevel[];
	readonly parentOf: ReadonlyMap<string, string>;
	readonly top: IntermediateDiagram;
	readonly zoned: boolean;
}

const groupStructures = new WeakMap<IntermediateDiagram, GroupStructure | null>();

function groupUnitId(groupId: string): string {
	return `${GROUP_UNIT_PREFIX}${groupId}`;
}

/** The nested layouts of a diagram whose declared groups hold nodes; undefined otherwise. */
function groupStructure(diagram: IntermediateDiagram): GroupStructure | undefined {
	const cached = groupStructures.get(diagram);
	if (cached !== undefined) return cached ?? undefined;
	const declaredParent = new Map(
		(diagram.groups ?? []).flatMap((group) =>
			group.parent === undefined ? [] : [[group.id, group.parent] as const],
		),
	);
	// A group holds nodes itself or through the groups nested in it.
	const holding = new Set<string>();
	for (const node of diagram.nodes)
		for (let id = node.group; id !== undefined && !holding.has(id); id = declaredParent.get(id))
			holding.add(id);
	const groups = (diagram.groups ?? []).filter((group) => holding.has(group.id));
	if (groups.length === 0) {
		groupStructures.set(diagram, null);
		return undefined;
	}
	const declared = new Set(groups.map((group) => group.id));
	const parentOf = new Map(
		[...declaredParent].filter(([id, parent]) => declared.has(id) && declared.has(parent)),
	);
	const zoned = groups.some((group) => group.parent !== undefined || group.kind !== undefined);
	const groupOf = new Map(
		diagram.nodes.flatMap((node) =>
			node.group !== undefined && declared.has(node.group) ? [[node.id, node.group] as const] : [],
		),
	);
	const nodeIds = new Set(diagram.nodes.map((node) => node.id));
	const composites = new Set(
		diagram.edges.flatMap((edge) =>
			[edge.source, edge.target].filter((id) => !nodeIds.has(id) && declared.has(id)),
		),
	);
	// The groups around a node or composite, innermost first.
	const chainOf = (id: string) => {
		const chain: string[] = [];
		for (
			let group = composites.has(id) ? id : groupOf.get(id);
			group !== undefined;
			group = parentOf.get(group)
		)
			chain.push(group);
		return chain;
	};
	// What a node is at a level (a group's, or the top level's when undefined):
	// itself when it is a direct member, else the block of the nested group that
	// holds it; undefined when the level does not hold it. A composite is a block
	// around its group's level, never inside it.
	const unitAt = (level: string | undefined, id: string) => {
		const chain = chainOf(id);
		const index = level === undefined ? chain.length : chain.indexOf(level);
		if (index < 0 || (index === 0 && composites.has(id))) return undefined;
		return index === 0 ? id : groupUnitId(chain[index - 1]!);
	};
	const unitNode = (group: DiagramGroup, unit: string): DiagramNode => ({
		id: unit,
		label: group.label,
		kind: "process",
		metadata: {},
	});
	// Inside a group, loops break where the whole flow breaks them, so a group
	// reads in the same direction as the diagram around it.
	const buckets = edgeBuckets(diagram.edges);
	const global = feedbackEdgeIds(diagram, buckets.incoming, buckets.outgoing);
	// A self-loop runs against the flow wherever it is.
	const feedback = new Set(
		diagram.edges.flatMap((edge) => (edge.source === edge.target ? [edge.id] : [])),
	);
	const nested = groups.map((group): GroupLevel => {
		const children = groups.filter((child) => parentOf.get(child.id) === group.id);
		const edges = diagram.edges.flatMap((edge) => {
			const [source, target] = [unitAt(group.id, edge.source), unitAt(group.id, edge.target)];
			if (source === undefined || target === undefined) return [];
			// An edge inside one nested group belongs to that group's level.
			if (source === target && source !== edge.source) return [];
			return [
				source === edge.source && target === edge.target ? edge : { ...edge, source, target },
			];
		});
		const units: DiagramNode[] = [];
		for (const node of diagram.nodes) {
			const unit = unitAt(group.id, node.id);
			if (unit === undefined || units.some((placed) => placed.id === unit)) continue;
			const child = children.find((candidate) => groupUnitId(candidate.id) === unit);
			units.push(child ? unitNode(child, unit) : node);
		}
		const inner = {
			...diagram,
			groups: [],
			nodes: units,
			edges,
		} as IntermediateDiagram;
		const across = {
			...inner,
			layout: { ...diagram.layout, direction: ACROSS_DIRECTION[diagram.layout.direction] },
		} as IntermediateDiagram;
		const innerFeedback = new Set(edges.flatMap((edge) => (global.has(edge.id) ? [edge.id] : [])));
		// Folding nested groups into blocks can close loops of its own; they break
		// where a walk of the level does.
		if (children.length > 0) {
			const rest = { ...inner, edges: edges.filter((edge) => !innerFeedback.has(edge.id)) };
			const restBuckets = edgeBuckets(rest.edges);
			for (const id of feedbackEdgeIds(rest, restBuckets.incoming, restBuckets.outgoing))
				innerFeedback.add(id);
		}
		flowFeedbacks.set(inner, innerFeedback);
		flowFeedbacks.set(across, innerFeedback);
		for (const id of innerFeedback) feedback.add(id);
		if (zoned) {
			const pairs = loopsThroughOutside(diagram, inner, innerFeedback, (id) =>
				unitAt(group.id, id),
			);
			if (pairs.length > 0) {
				levelPrecedence.set(inner, pairs);
				levelPrecedence.set(across, pairs);
			}
		}
		const crossing = new Set(
			diagram.edges.flatMap((edge) => {
				const [source, target] = [unitAt(group.id, edge.source), unitAt(group.id, edge.target)];
				return source === undefined && target !== undefined
					? [target]
					: target === undefined && source !== undefined
						? [source]
						: [];
			}),
		);
		return { across, children: children.map((child) => child.id), crossing, diagram: inner, group };
	});
	const units: DiagramNode[] = [];
	const placed = new Set<string>();
	for (const node of diagram.nodes) {
		const unit = unitAt(undefined, node.id)!;
		if (placed.has(unit)) continue;
		placed.add(unit);
		const outermost = chainOf(node.id).at(-1);
		units.push(
			outermost === undefined
				? node
				: unitNode(
						groups.find((candidate) => candidate.id === outermost)!,
						unit,
					),
		);
	}
	const topUnit = (id: string) => unitAt(undefined, id) ?? id;
	const crossEdges = diagram.edges.filter((edge) => topUnit(edge.source) !== topUnit(edge.target));
	const top = {
		...diagram,
		groups: [],
		nodes: units,
		edges: crossEdges.map((edge) => ({
			...edge,
			source: topUnit(edge.source),
			target: topUnit(edge.target),
		})),
	} as IntermediateDiagram;
	const topBuckets = edgeBuckets(top.edges);
	const topFeedback = feedbackEdgeIds(top, topBuckets.incoming, topBuckets.outgoing);
	flowFeedbacks.set(top, topFeedback);
	for (const id of topFeedback) feedback.add(id);
	flowFeedbacks.set(diagram, feedback);
	const structure = {
		composites,
		crossEdges,
		groupOf,
		groups: nested,
		parentOf,
		top,
		zoned,
	};
	groupStructures.set(diagram, structure);
	return structure;
}

/**
 * A level's member pairs that leave it and come back: an edge out of the level
 * whose path, through nodes outside it alone, reaches an edge back in. Each
 * pair stays only while its later member does not already lead to the first,
 * so the level's ranks keep no loop.
 */
function loopsThroughOutside(
	diagram: IntermediateDiagram,
	level: IntermediateDiagram,
	feedback: ReadonlySet<string>,
	unitOf: (id: string) => string | undefined,
): (readonly [string, string])[] {
	const inside = (id: string) => unitOf(id) !== undefined;
	const outgoing = new Map<string, string[]>();
	for (const edge of diagram.edges)
		if (!inside(edge.source) && !inside(edge.target))
			outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
	const reachedFrom = (start: string) => {
		const reached = new Set([start]);
		for (const id of reached) for (const next of outgoing.get(id) ?? []) reached.add(next);
		return reached;
	};
	const after = new Map<string, string[]>();
	for (const edge of level.edges)
		if (!feedback.has(edge.id))
			after.set(edge.source, [...(after.get(edge.source) ?? []), edge.target]);
	const leads = (from: string, to: string) => {
		const reached = new Set([from]);
		for (const id of reached) for (const next of after.get(id) ?? []) reached.add(next);
		return reached.has(to);
	};
	const pairs: (readonly [string, string])[] = [];
	for (const out of diagram.edges) {
		if (!inside(out.source) || inside(out.target)) continue;
		const reached = reachedFrom(out.target);
		for (const back of diagram.edges) {
			if (inside(back.source) || !inside(back.target) || !reached.has(back.source)) continue;
			const [first, later] = [unitOf(out.source)!, unitOf(back.target)!];
			if (first === later || pairs.some(([a, b]) => a === first && b === later)) continue;
			if (leads(later, first)) continue;
			pairs.push([first, later]);
			after.set(first, [...(after.get(first) ?? []), later]);
		}
	}
	return pairs;
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
 * Each node's shape, at least its minimum size and wide enough across the flow
 * for a port per connection, sized before ranking so clamping never merges
 * endpoints.
 */
function sizedShapes(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	buckets: EdgeBuckets,
	vertical: boolean,
	minimumWidth = MIN_NODE_WIDTH,
	lineUnits = MAX_LABEL_LINE_UNITS,
): Map<string, NodeSceneElement> {
	return new Map(
		diagram.nodes.map((node) => {
			const originalShape = createNodeShape(node, minimumWidth, lineUnits);
			const minimum = minimumSizes.get(node.id);
			const shape = {
				...originalShape,
				width: Math.max(originalShape.width, minimum?.width ?? 0),
				height: Math.max(originalShape.height, minimum?.height ?? 0),
			};
			// Allocate enough port capacity before ranking; clamping must never merge endpoints.
			// A self-loop takes a corner of its own, and a marker keeps one port per side.
			const outgoing = (buckets.outgoing.get(node.id) ?? []).filter((e) => e.target !== node.id);
			const connections =
				(buckets.incoming.get(node.id) ?? []).filter((e) => e.source !== node.id).length +
				outgoing.length;
			const pitch =
				!branches(node.kind) && outgoing.length > 1 && outgoing.some((e) => e.label)
					? Math.max(
							PORT_SPACING,
							...outgoing.map((e) => {
								const metrics = branchLabelMetrics(e.label ?? "");
								return (vertical ? metrics.width : metrics.height) + 24;
							}),
						)
					: PORT_SPACING;
			// A state keeps room beside each labeled departure for its label alone.
			const labeled = outgoing.filter((e) => e.label);
			const portBreadth =
				markerSize(node) !== undefined
					? 0
					: node.kind === "state"
						? PORT_PADDING * 2 +
							labeled.reduce((sum, e) => {
								const metrics = branchLabelMetrics(e.label!);
								return sum + (vertical ? metrics.width : metrics.height) + 24;
							}, 0) +
							Math.max(0, connections - labeled.length - 1) * ARRIVAL_SPACING
						: PORT_PADDING * 2 + Math.max(0, connections - 1) * pitch;
			return [
				node.id,
				node.kind === "choice" && !node.label
					? squareChoice(shape, portBreadth)
					: {
							...shape,
							...(vertical
								? { width: Math.max(shape.width, portBreadth) }
								: { height: Math.max(shape.height, portBreadth) }),
						},
			];
		}),
	);
}

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
	const shapesByNodeId = sizedShapes(diagram, minimumSizes, buckets, vertical);
	const feedbackEdges = flowFeedback(diagram);
	const rankByNodeId = liftRanks(
		diagram,
		rankNodes(diagram, buckets, feedbackEdges),
		feedbackEdges,
	);
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
							(edge) =>
								metric.shapes.some((shape) => shape.nodeId === edge.source) &&
								edge.label &&
								edge.source !== edge.target,
						)
						.map(
							(edge) =>
								branchLabelMetrics(edge.label!, branches(shapesByNodeId.get(edge.source)?.kind))
									.width +
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
	/**
	 * Each band ends along the flow under the rank that leads into it, as far as
	 * the longest band allows, so a short band hangs under the steps that reach
	 * it instead of back at the start (zoned levels).
	 */
	readonly under?: boolean;
}

const NO_WRAP: Wrap = { bandOf: new Map(), continuations: new Set() };
/** Shorter flows never wrap; each band keeps at least two ranks. */
const WRAP_MIN_RANKS = 5;
/** A flow wraps when it runs at least this many times longer than it is broad... */
const WRAP_EXTREME_ASPECT = 4;
/**
 * ...or about 2.5 times: a column always, since a tall export shrinks to fit
 * a screen's height, and a row once fitting it to a 2000 px screen would
 * shrink its text below about 24 px...
 */
const WRAP_ASPECT = 2.45;
const WRAP_MIN_LENGTH = 1200;
const FITTED_LONG_SIDE = 2000;
/**
 * A column short of 4:1 whose text fits a screen at 14 px or more wraps only
 * when each new column is at least this much of the longest, so no short
 * column sits beside a long one, reached by a connector across empty space.
 */
const WRAP_MIN_COLUMN_TEXT = 14;
const WRAP_COLUMN_BALANCE = 0.6;
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
	 * as a row of columns (or a column of rows) instead of one long strip. Zones
	 * never turn: they keep the diagram's direction.
	 */
	readonly groupsAcross?: boolean;
	/** Reorder ranks to remove the layered crossings the barycenter pass leaves. */
	readonly reorder: boolean;
	/** Route each edge, among otherwise equal lanes, across the fewest arrows routed before it. */
	readonly avoidCrossings?: boolean;
	/** In lanes, move a departure off a side that lines arrive by. */
	readonly separateRoles?: boolean;
	/** Sides edges leave or arrive by in place of the assigned ones, chosen to remove crossings. */
	readonly sides?: SideOverrides;
	readonly wrap: Wrap;
	/** Bands of a zoned flow's levels, by group id or TOP_LEVEL (see planZoneWraps). */
	readonly zoneWraps?: ReadonlyMap<string, Wrap>;
}

/** The top level of a zoned flow among its levels' wraps; no group id is empty. */
const TOP_LEVEL = "";

/** Each overridden edge's departure and arrival sides, by edge id. */
type SideOverrides = ReadonlyMap<
	string,
	{ readonly sourceEdge?: ConnectionEdge; readonly targetEdge?: ConnectionEdge }
>;

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
	// A laned diagram orders each lane's cells as it lays them out.
	if (laned(diagram)) return false;
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

/** How one level of a zoned flow wraps (see planZoneWraps). */
interface ZoneWrapOptions {
	/** Exactly this many bands. */
	readonly bands: number;
	/** Each block's size, by unit id. */
	readonly sizes: ReadonlyMap<string, { width: number; height: number }>;
	/** How many ranks of the whole flow a unit stands for: a zone, those it holds. */
	readonly weights: ReadonlyMap<string, number>;
}

/**
 * Bands for a flow whose single row or column is too long for its breadth,
 * cutting only where exactly one forward edge joins a rank to the next. No loop
 * or skipping edge spans a cut, so each band holds whole branches and the next
 * band starts at a single node. Orthogonal routing only: a straight continuation
 * would cut through the band it skips back across.
 *
 * One level of a zoned flow wraps the same way, its zones whole ranks of it.
 * There a cut may carry several edges, each joining the two ranks it separates,
 * since zoned routes are searched around every zone rather than run in one lane.
 */
function planWrap(
	diagram: IntermediateDiagram,
	reorder: boolean,
	balance = 0,
	zone?: ZoneWrapOptions,
): Wrap {
	// A band cut must not split a group; grouped flows stay in one band.
	if (diagram.layout.edgeRouting !== "orthogonal" || groupStructure(diagram) || laned(diagram))
		return NO_WRAP;
	const { feedbackEdges, gapAfter, rankByNodeId, rankMetrics } = rankLayout(
		diagram,
		zone?.sizes ?? new Map(),
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
	// Ranks of the whole flow from one rank to another: a zone counts those it holds.
	const weight = (index: number) =>
		Math.max(...rankMetrics[index]!.shapes.map((shape) => zone?.weights.get(shape.nodeId) ?? 1));
	const ranks = (from: number, to: number) => {
		let sum = 0;
		for (let index = from; index <= to; index += 1) sum += weight(index);
		return sum;
	};
	if (ranks(0, last) < WRAP_MIN_RANKS || flow(0, last) <= breadth(0, last)) return NO_WRAP;

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
			(zone ? spanning.length >= 1 : spanning.length === 1) &&
			edge &&
			spanning.every(
				(candidate) =>
					!feedbackEdges.has(candidate.id) &&
					rankOf(candidate.source) === metric.rank &&
					rankOf(candidate.target) === metric.rank + 1 &&
					!branches(nodeKinds.get(candidate.source)),
			)
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

	// Band ends: a clean cut or the last rank. Each band keeps at least two ranks;
	// a zoned band hangs under the steps that reach it, so it may hold one.
	const ends = [...continuationAfter.keys(), last].sort((a, b) => a - b);
	const minimum = zone ? 1 : 2;
	// An even wrap keeps every band at least `balance` of the longest, so no band
	// stands short beside a long one with empty space past its end.
	const evenPartition = (bands: number) => {
		let best: { ends: number[]; longest: number; squares: number } | undefined;
		const visit = (cuts: number[], previous: number) => {
			if (cuts.length === bands - 1) {
				if (ranks(previous + 1, last) < minimum) return;
				const bounds = [...cuts, last];
				const lengths = bounds.map((end, band) =>
					bandLength(band === 0 ? 0 : bounds[band - 1]! + 1, end),
				);
				const longest = Math.max(...lengths);
				if (Math.min(...lengths) < balance * longest) return;
				const squares = lengths.reduce((sum, length) => sum + length ** 2, 0);
				if (!best || longest < best.longest || (longest === best.longest && squares < best.squares))
					best = { ends: bounds, longest, squares };
				return;
			}
			for (const end of ends)
				if (end !== last && end > previous && ranks(previous + 1, end) >= minimum)
					visit([...cuts, end], end);
		};
		visit([], -1);
		return best;
	};
	let chosen: { aspect: number; ends: readonly number[] } | undefined;
	const [fewest, most] = zone
		? [zone.bands, Math.min(zone.bands, ends.length)]
		: [2, Math.min(MAX_BANDS, ends.length)];
	for (let bands = fewest; bands <= most; bands += 1) {
		// Balance band lengths: the shortest longest band, then the least sum of squares.
		type Partition = { ends: number[]; longest: number; squares: number };
		let partitions = new Map<number, Partition>();
		for (const end of ends)
			if (ranks(0, end) >= minimum && end < last)
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
					if (end <= previous || ranks(previous + 1, end) < minimum) continue;
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
		const partition = balance > 0 ? evenPartition(bands) : partitions.get(last);
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
		...(zone ? { under: true } : {}),
	};
}

/**
 * How many ranks of the whole flow each zone's block stands for: the ranks of
 * its own flow, a nested zone counting its own, and never fewer than two, since
 * a zone with its header reads as a block of its own rather than a stray step.
 */
function zoneFlowRanks(structure: GroupStructure): Map<string, number> {
	const levels = new Map(structure.groups.map((level) => [level.group.id, level]));
	const weights = new Map<string, number>();
	const weigh = (level: GroupLevel): number => {
		for (const child of level.children) weigh(levels.get(child)!);
		const { rankMetrics } = rankLayout(level.diagram, new Map(), new Map());
		const ranks = rankMetrics.reduce(
			(sum, metric) =>
				sum + Math.max(...metric.shapes.map((shape) => weights.get(shape.nodeId) ?? 1)),
			0,
		);
		weights.set(groupUnitId(level.group.id), Math.max(2, ranks));
		return ranks;
	};
	for (const level of structure.groups) if (!structure.parentOf.has(level.group.id)) weigh(level);
	return weights;
}

/** Single-level zoned wrap plans laid out beside the first, since a plan may route worse. */
const ZONE_WRAP_ALTERNATIVES = 2;
/** Times a zoned flow still too long after a wrap plans again from it. */
const ZONE_WRAP_ROUNDS = 2;

/**
 * Bands for a zoned flow too long for its breadth, best first. Each level (the
 * top level or one zone's members) wraps as a plain flow does, in the stated
 * direction, its zones whole ranks of it (planWrap). Levels wrap one at a time:
 * each time the level and band count that bring the whole diagram within
 * WRAP_TARGET_ASPECT with the fewest bands or, if none does, nearest it, while
 * that keeps helping. The single-level plans that come next are alternatives,
 * since a plan may route worse than the layout it replaces. Planning routes
 * nothing: it measures the unrouted layout, scaled by how far the routed one
 * (`drawn`) outgrows it, since routes widen zones for their stubs.
 */
function planZoneWraps(
	diagram: IntermediateDiagram,
	structure: GroupStructure,
	arrangement: Arrangement,
	balance: number,
	drawn: { readonly width: number; readonly height: number },
): ReadonlyMap<string, Wrap>[] {
	const levels = new Map<string, IntermediateDiagram>([
		[TOP_LEVEL, structure.top],
		...structure.groups.map((level) => [level.group.id, level.diagram] as const),
	]);
	const weights = zoneFlowRanks(structure);
	const unrouted = (zoneWraps: ReadonlyMap<string, Wrap>) => {
		const placed = positionLayout(diagram, new Map(), new Map(), { ...arrangement, zoneWraps });
		return { bounds: boundsOf([...placed.nodes, ...groupBlocks(placed.groups)]), placed };
	};
	let wraps = new Map(arrangement.zoneWraps ?? []);
	const start = unrouted(wraps);
	const [growX, growY] = [drawn.width / start.bounds.width, drawn.height / start.bounds.height];
	const predict = (zoneWraps: ReadonlyMap<string, Wrap>) => {
		const { bounds, placed } = unrouted(zoneWraps);
		return { aspect: exportAspect(bounds.width * growX, bounds.height * growY), placed };
	};
	type Plan = { aspect: number; bands: number; next: Map<string, Wrap>; placed: PositionedLayout };
	// Plans within the target first, fewest bands then squarest; then the squarest.
	const rank = (left: Plan, right: Plan) => {
		const [inLeft, inRight] = [left, right].map((plan) => plan.aspect <= WRAP_TARGET_ASPECT);
		if (inLeft !== inRight) return inLeft ? -1 : 1;
		return inLeft
			? left.bands - right.bands || left.aspect - right.aspect
			: left.aspect - right.aspect;
	};
	const planned = wraps.size;
	let current = predict(wraps);
	const alternatives: Map<string, Wrap>[] = [];
	while (current.aspect > WRAP_TARGET_ASPECT) {
		const sizes = new Map<string, { width: number; height: number }>([
			...current.placed.nodes.map((node) => [node.nodeId, node] as const),
			...(current.placed.groups?.frames ?? []).map(
				(frame) => [groupUnitId(frame.id), frame.box] as const,
			),
		]);
		const plans: Plan[] = [];
		for (const [id, level] of levels) {
			if (wraps.has(id)) continue;
			for (let bands = 2; bands <= MAX_BANDS; bands += 1) {
				const wrap = planWrap(level, arrangement.reorder, balance, { bands, sizes, weights });
				if (wrap.bandOf.size === 0) continue;
				const next = new Map([...wraps, [id, wrap]]);
				plans.push({ ...predict(next), bands, next });
				if (plans.at(-1)!.aspect <= WRAP_TARGET_ASPECT) break;
			}
		}
		const helping = plans.filter((plan) => plan.aspect < current.aspect).sort(rank);
		const [chosen] = helping;
		if (!chosen) break;
		if (wraps.size === planned)
			alternatives.push(...helping.slice(1, 1 + ZONE_WRAP_ALTERNATIVES).map((plan) => plan.next));
		wraps = chosen.next;
		current = chosen;
	}
	return wraps.size > planned ? [wraps, ...alternatives] : [];
}

/** How far along the flow each band starts, for a wrap whose bands hang under their entries. */
function bandsUnder(
	diagram: IntermediateDiagram,
	bands: readonly (readonly { index: number; metric: RankMetric }[])[],
	gapAfter: readonly number[],
	bandOf: ReadonlyMap<string, number>,
): number[] {
	// Where each rank ends along the flow, within its band.
	const end = new Map<string, number>();
	const lengths = bands.map((band) => {
		let offset = 0;
		for (const { index, metric } of band) {
			for (const shape of metric.shapes) end.set(shape.nodeId, offset + metric.depth);
			offset += metric.depth + gapAfter[index]!;
		}
		return offset - gapAfter[band.at(-1)!.index]!;
	});
	const longest = Math.max(...lengths);
	// A band ends under the last rank that leads into it, within the longest band.
	const shifts = [0];
	for (let band = 1; band < bands.length; band += 1) {
		const entries = diagram.edges.flatMap((edge) =>
			bandOf.get(edge.source) === band - 1 && bandOf.get(edge.target) === band
				? [end.get(edge.source)! + shifts[band - 1]! - lengths[band]!]
				: [],
		);
		shifts.push(Math.max(0, Math.min(Math.max(0, ...entries), longest - lengths[band]!)));
	}
	return shifts;
}

/**
 * `centers` holds, by unit id, how far a zone block's members sit across the
 * flow from the block's middle, where its header strip (or a side widened for
 * its name) pushes them. A block alone in its rank is placed by its members, so
 * a flow running through nested zones stays straight.
 */
function positionNodes(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
	stubReach: ReadonlyMap<string, number> = new Map(),
	{ reorder, wrap }: Arrangement = PLAIN_ARRANGEMENT,
	centers: ReadonlyMap<string, number> = new Map(),
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
	const bandShift = wrap.under ? bandsUnder(diagram, bands, gapAfter, wrap.bandOf) : [];
	let bandOffset = PADDING;
	for (const [bandIndex, band] of bands.entries()) {
		const bandBreadth = Math.max(...band.map(({ metric }) => metric.breadth));
		let rankOffset = PADDING + (bandShift[bandIndex] ?? 0);
		for (const { index, metric } of band) {
			const [alone] = metric.shapes.length === 1 ? metric.shapes : [];
			let breadthOffset =
				bandOffset +
				Math.max(0, bandBreadth - metric.breadth) / 2 -
				(alone ? (centers.get(alone.nodeId) ?? 0) : 0);

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
	readonly lanes?: LaneLayout;
	readonly nodes: NodeSceneElement[];
}

function positionLayout(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
	stubReach: ReadonlyMap<string, number> = new Map(),
	arrangement: Arrangement = PLAIN_ARRANGEMENT,
	slack: ReadonlyMap<string, number> = new Map(),
): PositionedLayout {
	if (laned(diagram)) return positionLanedNodes(diagram, minimumSizes, stubReach, arrangement.wrap);
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
 * together and no two groups, or a group and an outside node, overlap. A nested
 * group is one block in its parent's flow the same way, laid out first. Each
 * frame keeps a band above it for its name, and each zone a header strip
 * inside its top for its label. Vertical flows enter and leave a group through
 * its top, so there the group widens until the top row's ports clear its name.
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
	const { zoned } = structure;
	// A frame's name sits in a band above it; a zone's label in a strip inside it.
	const band = zoned ? 0 : GROUP_LABEL_BAND;
	const sizes = new Map(minimumSizes);
	const reach = new Map(stubReach);
	const levels = new Map(structure.groups.map((level) => [level.group.id, level]));
	const blocks = new Map<string, GroupBlock>();
	// How far each zone block's members sit across the flow from its middle.
	const centers = new Map<string, number>();
	// Zones keep the diagram's direction at every level; flat groups may turn.
	const turned: ReadonlySet<string> =
		arrangement.groupsAcross && !zoned
			? new Set(structure.groups.map((level) => level.group.id))
			: new Set();
	const layOut = ({ across, children, crossing, diagram: along, group }: GroupLevel) => {
		for (const child of children) layOut(levels.get(child)!);
		const inner = turned.has(group.id) ? across : along;
		const nodes = positionNodes(
			inner,
			sizes,
			reach,
			{
				...PLAIN_ARRANGEMENT,
				reorder: arrangement.reorder,
				wrap: arrangement.zoneWraps?.get(group.id) ?? NO_WRAP,
			},
			centers,
		);
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
				zoned ? ZONE_PADDING : GROUP_PADDING,
				...nodes.map(
					(node) => (reach.get(portKey(node.nodeId, side)) ?? 0) - inset(node, side) + PORT_SPACING,
				),
			) + (slack.get(group.id) ?? 0);
		const labelWidth = canvasFrameNameWidth(group.label);
		// Where the name ends, measured from the frame's left side.
		const nameEnd = zoned
			? ZONE_LABEL_INSET + labelWidth + CANVAS_FRAME_NAME.clearance
			: labelWidth + 2 * CANVAS_FRAME_NAME.clearance;
		const ports = nodes
			.filter((node) => crossing.has(node.nodeId) && inset(node, "top") <= AXIS_ALIGNED_EPSILON)
			.map((node) => node.x - content.x + node.width / 2 - 2 * PORT_SPACING);
		const padding = {
			top: pad("top") + (zoned ? ZONE_HEADER : 0),
			bottom: pad("bottom"),
			right: pad("right"),
			left:
				vertical && ports.length > 0
					? Math.max(pad("left"), nameEnd + PORT_SPACING - Math.min(...ports))
					: pad("left"),
		};
		const block: GroupBlock = {
			content,
			group,
			height: content.height + padding.top + padding.bottom,
			nodes,
			padding,
			width: Math.max(
				content.width + padding.left + padding.right,
				zoned ? nameEnd + ZONE_LABEL_INSET : labelWidth + 2 * CANVAS_FRAME_NAME.clearance + 16,
				// A composite's own ports on its top sit right of its name.
				(stubReach.get(portKey(group.id, "top")) ?? 0) > 0 && structure.composites.has(group.id)
					? labelWidth +
							2 * CANVAS_FRAME_NAME.clearance +
							2 * PORT_SPACING +
							PORT_PADDING +
							structure.crossEdges.filter(
								(edge) => edge.source === group.id || edge.target === group.id,
							).length *
								ARRIVAL_SPACING
					: 0,
			),
		};
		blocks.set(group.id, block);
		const unit = groupUnitId(group.id);
		sizes.set(unit, { width: block.width, height: block.height + band });
		if (zoned)
			centers.set(
				unit,
				vertical
					? (block.padding.left - block.padding.right) / 2
					: (block.padding.top - block.padding.bottom) / 2,
			);
		// A member's stub reaches past the block only by what its frame's padding leaves.
		const spare =
			(block.width - block.content.width - block.padding.left - block.padding.right) / 2;
		const margin = (node: NodeSceneElement, side: ConnectionEdge) =>
			side === "top"
				? node.y - block.content.y + block.padding.top + band
				: side === "bottom"
					? block.content.y + block.content.height - node.y - node.height + block.padding.bottom
					: side === "left"
						? node.x - block.content.x + block.padding.left + spare
						: block.content.x +
							block.content.width -
							node.x -
							node.width +
							block.padding.right +
							spare;
		for (const side of ["top", "right", "bottom", "left"] as const) {
			// A composite's own stubs start at its frame, under the band for its name.
			const own = structure.composites.has(group.id)
				? (stubReach.get(portKey(group.id, side)) ?? 0) - (side === "top" ? band : 0)
				: 0;
			const beyond = Math.max(
				0,
				own,
				...nodes.map((node) => (reach.get(portKey(node.nodeId, side)) ?? 0) - margin(node, side)),
			);
			if (beyond > 0) reach.set(portKey(unit, side), beyond);
		}
	};
	for (const level of structure.groups) if (!structure.parentOf.has(level.group.id)) layOut(level);
	const topWrap = arrangement.zoneWraps?.get(TOP_LEVEL) ?? NO_WRAP;
	const top = positionNodes(
		structure.top,
		sizes,
		reach,
		{ ...arrangement, wrap: topWrap },
		centers,
	);
	// Each top-level unit: an ungrouped node, or a group's members and frames.
	const units = new Map<string, PlacedUnit>();
	for (const shape of top) {
		if (!shape.nodeId.startsWith(GROUP_UNIT_PREFIX)) units.set(shape.nodeId, { nodes: [shape] });
	}
	const boxes = new Map<string, Box>();
	// Place a block in its unit's box, then each nested block in its own.
	const place = (groupId: string, unit: Box, placed: NodeSceneElement[]) => {
		const block = blocks.get(groupId)!;
		const frame = {
			x: unit.x,
			y: unit.y + band,
			width: unit.width,
			height: unit.height - band,
		};
		boxes.set(groupId, frame);
		// A block the level around it widened for ports keeps its padding and centers the rest.
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
		for (const node of block.nodes) {
			const moved = { ...node, x: node.x + dx, y: node.y + dy };
			if (node.nodeId.startsWith(GROUP_UNIT_PREFIX))
				place(node.nodeId.slice(GROUP_UNIT_PREFIX.length), moved, placed);
			else placed.push(moved);
		}
		return frame;
	};
	for (const level of structure.groups) {
		if (structure.parentOf.has(level.group.id)) continue;
		const unitId = groupUnitId(level.group.id);
		const unit = top.find((shape) => shape.nodeId === unitId)!;
		const nodes: NodeSceneElement[] = [];
		const frame = place(level.group.id, unit, nodes);
		const nested = structure.groups.flatMap(({ group }) =>
			group.id !== level.group.id && groupRoot(structure, group.id) === level.group.id
				? [group.id]
				: [],
		);
		units.set(unitId, {
			frame,
			...(nested.length > 0
				? { nested: new Map(nested.map((id) => [id, boxes.get(id)!] as const)) }
				: {}),
			nodes,
		});
	}
	alignUnits(structure, units, vertical, topWrap.bandOf);
	for (const [unitId, unit] of units) {
		if (unit.frame) boxes.set(unitId.slice(GROUP_UNIT_PREFIX.length), unit.frame);
		for (const [id, box] of unit.nested ?? []) boxes.set(id, box);
	}
	const nodes = [...units.values()].flatMap((unit) => unit.nodes);
	const order = nodeOrderMap(diagram.nodes);
	nodes.sort((left, right) => order.get(left.nodeId)! - order.get(right.nodeId)!);
	const depth = (id: string) => groupRoots(structure, id).length;
	const frames = (
		zoned
			? [...structure.groups].sort((left, right) => depth(left.group.id) - depth(right.group.id))
			: structure.groups
	).map(({ group }): GroupFrame => {
		const box = boxes.get(group.id)!;
		return {
			box,
			elementId: `group:${group.id}`,
			id: group.id,
			...(zoned && group.kind !== undefined ? { kind: group.kind } : {}),
			label: group.label,
			labelBox: zoned
				? zoneLabelBox(box, group.label)
				: canvasFrameNameBox({ ...box, name: group.label }),
		};
	});
	return {
		groups: {
			across: turned,
			composites: structure.composites,
			frames,
			groupOf: structure.groupOf,
			parentOf: structure.parentOf,
			zoned,
		},
		nodes,
	};
}

/** A group laid out on its own, before the level around it places it. */
interface GroupBlock {
	readonly content: Box;
	readonly group: DiagramGroup;
	readonly height: number;
	readonly nodes: readonly NodeSceneElement[];
	readonly padding: {
		readonly top: number;
		readonly right: number;
		readonly bottom: number;
		readonly left: number;
	};
	readonly width: number;
}

/** A top-level unit as placed: an ungrouped node, or a group's members, frame and nested frames. */
interface PlacedUnit {
	frame?: Box;
	nested?: Map<string, Box>;
	nodes: NodeSceneElement[];
}

/** A group and every group around it, innermost first. */
function groupRoots(structure: GroupStructure, groupId: string): string[] {
	const chain: string[] = [];
	for (let id: string | undefined = groupId; id !== undefined; id = structure.parentOf.get(id))
		chain.push(id);
	return chain;
}

/** The outermost group around a group. */
function groupRoot(structure: GroupStructure, groupId: string): string {
	return groupRoots(structure, groupId).at(-1)!;
}

/** Where a zone's label is painted in its header strip, padded by its clearance. */
function zoneLabelBox(box: Box, label: string): Box {
	const { clearance, height } = CANVAS_FRAME_NAME;
	return {
		x: box.x + ZONE_LABEL_INSET - clearance,
		y: box.y + (ZONE_HEADER - height) / 2 - clearance,
		width: canvasFrameNameWidth(label) + 2 * clearance,
		height: height + 2 * clearance,
	};
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
	units: Map<string, PlacedUnit>,
	vertical: boolean,
	bandOf: ReadonlyMap<string, number> = new Map(),
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
	// Each band's reach across the flow, so bands keep the gaps they were laid out with.
	const bandCount = Math.max(0, ...bandOf.values()) + 1;
	const extent = (band: number) => {
		const boxes = [...units]
			.filter(([id]) => (bandOf.get(id) ?? 0) === band)
			.map(([, unit]) => unit.frame ?? unit.nodes[0]!);
		return {
			start: Math.min(...boxes.map((box) => box[across])),
			end: Math.max(...boxes.map((box) => box[across] + box[size])),
		};
	};
	const bandGaps = Array.from({ length: bandCount }, (_, band) =>
		band === 0 ? 0 : extent(band).start - extent(band - 1).end,
	);
	const breadth = (rank: number) =>
		(ranks.get(rank) ?? []).reduce((sum, id) => {
			const unit = units.get(id)!;
			return sum + (unit.frame ?? unit.nodes[0]!)[size];
		}, 0);
	const order = [...ranks.keys()].sort((a, b) => a - b);
	const anchor = order.reduce((best, rank) => (breadth(rank) > breadth(best) ? rank : best));
	// An edge ends at a member or, for a composite, at the group's frame.
	const middle = (id: string) => {
		const box = structure.composites.has(id)
			? units.get(groupUnitId(id))!.frame!
			: [...units.values()].flatMap((unit) => unit.nodes).find((node) => node.nodeId === id)!;
		return box[across] + box[size] / 2;
	};
	const shift = (id: string, delta: number) => {
		const unit = units.get(id)!;
		unit.nodes = unit.nodes.map((node) => ({ ...node, [across]: node[across] + delta }));
		if (unit.frame) unit.frame = { ...unit.frame, [across]: unit.frame[across] + delta };
		for (const [nested, box] of unit.nested ?? [])
			unit.nested!.set(nested, { ...box, [across]: box[across] + delta });
	};
	const bandOfRank = (rank: number) => bandOf.get(ranks.get(rank)?.[0] ?? "") ?? 0;
	const align = (rank: number, neighbor: number, forward: boolean) => {
		const [id] = ranks.get(rank) ?? [];
		if (!id || ranks.get(rank)!.length !== 1) return;
		// A wrapped rank lines up only with ranks in its own band.
		if (bandOfRank(rank) !== bandOfRank(neighbor)) return;
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
		shift(id, middle(theirs) - middle(mine));
	};
	// Zones gather a rank of several units under the members they join: each
	// unit in order of where its edges land, a loop back into a zone pulling
	// twice as hard so it stays short, and the rank centered on them all.
	const gather = (rank: number) => {
		const ids = ranks.get(rank)!;
		if (!structure.zoned || ids.length < 2) return;
		const box = (id: string) => units.get(id)!.frame ?? units.get(id)!.nodes[0]!;
		const pulls = new Map(
			ids.map((id) => [
				id,
				top.edges.flatMap((edge, index) => {
					const real = crossEdges[index]!;
					const [mine, theirs] =
						edge.source === id ? [real.source, real.target] : [real.target, real.source];
					if (
						(edge.source !== id && edge.target !== id) ||
						ids.includes(edge.source === id ? edge.target : edge.source)
					)
						return [];
					void mine;
					const at = middle(theirs);
					return feedback.has(edge.id) && edge.source === id ? [at, at] : [at];
				}),
			]),
		);
		const placed = [...ids].sort((a, b) => box(a)[across] - box(b)[across]);
		const mean = (values: readonly number[]) =>
			values.reduce((sum, value) => sum + value, 0) / values.length;
		const keyOf = (id: string) =>
			pulls.get(id)!.length > 0 ? mean(pulls.get(id)!) : box(id)[across] + box(id)[size] / 2;
		const wanted = [...placed].sort((a, b) => keyOf(a) - keyOf(b));
		const gaps = placed.slice(1).map((id, index) => {
			const previous = box(placed[index]!);
			return box(id)[across] - previous[across] - previous[size];
		});
		const all = ids.flatMap((id) => pulls.get(id)!);
		const span =
			wanted.reduce((sum, id) => sum + box(id)[size], 0) + gaps.reduce((sum, gap) => sum + gap, 0);
		let at = all.length > 0 ? mean(all) - span / 2 : box(placed[0]!)[across];
		for (const [index, id] of wanted.entries()) {
			shift(id, at - box(id)[across]);
			at += box(id)[size] + (gaps[index] ?? 0);
		}
	};
	for (const rank of order.filter((rank) => rank > anchor)) {
		align(rank, rank - 1, true);
		gather(rank);
	}
	for (const rank of order.filter((rank) => rank < anchor).reverse()) {
		align(rank, rank + 1, false);
		gather(rank);
	}
	for (let band = 1; band < bandCount; band += 1) {
		const delta = extent(band - 1).end + bandGaps[band]! - extent(band).start;
		for (const [id] of units) if ((bandOf.get(id) ?? 0) === band) shift(id, delta);
	}
}

/** Inner padding of a lane across the flow, around its steps. */
const LANE_PADDING = 32;
/** Room along the flow before a lane's first steps and after its last. */
const LANE_END_PADDING = 48;
/**
 * Columns of lanes sit at least two stubs apart, closer than ranks: the stubs
 * and labels between two columns widen the gap as they need.
 */
const LANE_COLUMN_GAP = 2 * ROUTE_STUB_LENGTH;
/** A step in a row of lanes is at least this wide, narrower than elsewhere. */
const LANE_MIN_NODE_WIDTH = 144;
/** Room a lane keeps between its boundary and where its steps' lines turn. */
const LANE_ROOM = 2 * PORT_SPACING;
const LANE_LABEL_FONT_SIZE = 16;
/** A horizontal lane's header wraps its name at about fourteen average glyphs. */
const LANE_LABEL_LINE_UNITS = 14 * DEFAULT_GLYPH_UNITS;
const LANE_HEADER_PADDING = 16;
/** A vertical lane's header is at least this tall. */
const LANE_HEADER_MIN_HEIGHT = 44;

/** One drawn lane: its band from header to far end, and its header strip. */
interface LaneFrame {
	readonly box: Box;
	/** The id the band draws under; its header and name add `:header` and `:label`. */
	readonly elementId: string;
	readonly header: Box;
	readonly id: string;
	readonly label: string;
	/** The pool the band belongs to: 0, or a later one of a wrapped diagram. */
	readonly pool: number;
	/** The name as the header wraps it. */
	readonly text: string;
}

/**
 * Lanes drawn as full-length bands across the flow, in declared order: rows
 * stacked top to bottom for LR and RL, columns left to right for TB and BT.
 * Each starts with a header strip holding its name, on the left of a row or
 * on top of a column.
 */
interface LaneLayout {
	/** Edges that carry a wrapped flow from one pool to the next. */
	readonly continuations: ReadonlySet<string>;
	/** Every lane of every pool, pool by pool in declared order. */
	readonly frames: readonly LaneFrame[];
	readonly laneOf: ReadonlyMap<string, string>;
	/** Every pool together, with the gaps between them. */
	readonly pool: Box;
	/** Each full set of lanes; a wrapped diagram draws one per stretch of columns. */
	readonly pools: readonly Box[];
	/** Lanes are columns: the flow runs top to bottom or bottom to top. */
	readonly vertical: boolean;
}

/** Whether a diagram declares lanes; a laned diagram puts every node in one. */
function laned(diagram: IntermediateDiagram): boolean {
	return (diagram.lanes ?? []).length > 0;
}

/**
 * The column along the flow each step of a laned diagram takes. A step comes
 * after every step before it in its own lane and every step that leads to it
 * from a lane further than the next one. A step reached from the neighboring
 * lane may share that step's column, so the handoff runs straight across the
 * boundary between them; a source hands off straight to one step per lane.
 */
function laneColumns(diagram: IntermediateDiagram): Map<string, number> {
	const lanes = diagram.lanes ?? [];
	const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
	const laneOf = new Map(
		diagram.nodes.map((node) => [node.id, laneIndex.get(node.lane ?? "") ?? 0]),
	);
	const feedback = flowFeedback(diagram);
	const forward = diagram.edges.filter(
		(edge) => !feedback.has(edge.id) && edge.source !== edge.target,
	);
	// A source's first forward edge into each neighboring lane may stay in its column.
	const straight = new Set<string>();
	const handedOff = new Set<string>();
	for (const edge of forward) {
		const [from, to] = [laneOf.get(edge.source)!, laneOf.get(edge.target)!];
		const key = `${edge.source}\u0000${to}`;
		if (Math.abs(from - to) !== 1 || handedOff.has(key)) continue;
		handedOff.add(key);
		straight.add(edge.id);
	}
	const incoming = new Map(diagram.nodes.map((node) => [node.id, [] as DiagramEdge[]]));
	const outgoing = new Map(diagram.nodes.map((node) => [node.id, [] as DiagramEdge[]]));
	for (const edge of forward) {
		incoming.get(edge.target)!.push(edge);
		outgoing.get(edge.source)!.push(edge);
	}
	// Steps in flow order, earliest declared first among those ready.
	const nodeOrder = nodeOrderMap(diagram.nodes);
	const waiting = new Map(diagram.nodes.map((node) => [node.id, incoming.get(node.id)!.length]));
	const ready = diagram.nodes.filter((node) => waiting.get(node.id) === 0).map((node) => node.id);
	const column = new Map<string, number>();
	// The latest column each lane reaches on the way to each step, the step's own included.
	const reached = new Map<string, number[]>();
	while (ready.length > 0) {
		ready.sort((a, b) => nodeOrder.get(a)! - nodeOrder.get(b)!);
		const id = ready.shift()!;
		const lane = laneOf.get(id)!;
		const before = lanes.map((_, index) =>
			Math.max(-1, ...incoming.get(id)!.map((edge) => reached.get(edge.source)![index]!)),
		);
		let at = before[lane]! + 1;
		for (const edge of incoming.get(id)!)
			at = Math.max(at, column.get(edge.source)! + (straight.has(edge.id) ? 0 : 1));
		column.set(id, at);
		before[lane] = at;
		reached.set(id, before);
		for (const edge of outgoing.get(id)!) {
			const left = waiting.get(edge.target)! - 1;
			waiting.set(edge.target, left);
			if (left === 0) ready.push(edge.target);
		}
	}
	return column;
}

/**
 * A laned diagram's steps and lanes before they are placed: each step's column
 * and offset across its lane's content, each column's depth and the gap after
 * it, and each lane's breadth, padding and header. Steps that share a lane and
 * a column stack across the lane in the order that keeps their edges least
 * crossed. Lanes take the breadth their busiest column needs, and columns hold
 * their stubs and labels as ranks do.
 */
function laneGeometry(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	stubReach: ReadonlyMap<string, number>,
) {
	const lanes = diagram.lanes!;
	const { direction } = diagram.layout;
	const vertical = direction === "TB" || direction === "BT";
	const [along, across] = vertical ? (["y", "x"] as const) : (["x", "y"] as const);
	const [depthOf, breadthOf] = vertical
		? (["height", "width"] as const)
		: (["width", "height"] as const);
	const [lowSide, highSide]: readonly [ConnectionEdge, ConnectionEdge] = vertical
		? ["left", "right"]
		: ["top", "bottom"];
	const forwardSide = FORWARD_SIDE[direction];
	const backSide = OPPOSITE_EDGE[forwardSide];
	const reachOf = (nodeId: string, side: ConnectionEdge) =>
		stubReach.get(portKey(nodeId, side)) ?? 0;
	const buckets = edgeBuckets(diagram.edges);
	// Rows of lanes run long, so their steps wrap sooner and keep only the width
	// their labels need.
	const shapes = vertical
		? sizedShapes(diagram, minimumSizes, buckets, vertical)
		: sizedShapes(
				diagram,
				minimumSizes,
				buckets,
				vertical,
				LANE_MIN_NODE_WIDTH,
				MAX_DIAMOND_LABEL_LINE_UNITS,
			);
	const columns = laneColumns(diagram);
	const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
	const laneOf = new Map(diagram.nodes.map((node) => [node.id, node.lane!]));
	const columnCount = Math.max(0, ...columns.values()) + 1;

	// Cells of one lane and one column, stacked across in barycentric order.
	const cells = lanes.map(() => Array.from({ length: columnCount }, () => [] as string[]));
	for (const node of diagram.nodes)
		cells[laneIndex.get(node.lane!)!]![columns.get(node.id)!]!.push(node.id);
	const feedback = flowFeedback(diagram);
	const neighbors = new Map(diagram.nodes.map((node) => [node.id, [] as string[]]));
	for (const edge of diagram.edges) {
		if (feedback.has(edge.id) || edge.source === edge.target) continue;
		neighbors.get(edge.source)!.push(edge.target);
		neighbors.get(edge.target)!.push(edge.source);
	}
	const nodeOrder = nodeOrderMap(diagram.nodes);
	const key = (id: string) => {
		const cell = cells[laneIndex.get(laneOf.get(id)!)!]![columns.get(id)!]!;
		return laneIndex.get(laneOf.get(id)!)! + (cell.indexOf(id) + 0.5) / cell.length;
	};
	for (let sweep = 0; sweep < RANK_SWEEP_COUNT; sweep += 1)
		for (const lane of cells)
			for (const cell of lane) {
				if (cell.length < 2) continue;
				const score = new Map(
					cell.map((id) => {
						const around = neighbors.get(id)!;
						return [
							id,
							around.length > 0
								? around.reduce((sum, other) => sum + key(other), 0) / around.length
								: key(id),
						];
					}),
				);
				cell.sort((a, b) => score.get(a)! - score.get(b)! || nodeOrder.get(a)! - nodeOrder.get(b)!);
			}

	// Along the flow: each column's depth and the gap after it, as between ranks.
	const columnOf = Array.from({ length: columnCount }, (_, index) =>
		diagram.nodes
			.filter((node) => columns.get(node.id) === index)
			.map((node) => shapes.get(node.id)!),
	);
	const depth = columnOf.map((column) => Math.max(0, ...column.map((shape) => shape[depthOf])));
	const reach = (column: readonly NodeSceneElement[], side: ConnectionEdge) =>
		Math.max(0, ...column.map((shape) => reachOf(shape.nodeId, side)));
	const gapAfter = columnOf.map((column, index) => {
		const ids = new Set(column.map((shape) => shape.nodeId));
		// A label on a line that leaves for a later column lengthens its stub.
		const labelGap = vertical
			? 0
			: Math.max(
					0,
					...diagram.edges
						.filter(
							(edge) =>
								ids.has(edge.source) && edge.label && (columns.get(edge.target) ?? 0) > index,
						)
						.map(
							(edge) =>
								branchLabelMetrics(edge.label!, branches(shapes.get(edge.source)?.kind)).width +
								16 +
								ROUTE_STUB_LENGTH * 2,
						),
				);
		const next = columnOf[index + 1];
		const stubGap =
			next && stubReach.size > 0
				? reach(column, forwardSide) + reach(next, backSide) + PORT_SPACING
				: 0;
		return Math.max(LANE_COLUMN_GAP, labelGap, stubGap);
	});
	// Across the flow: each lane's stacked content, centered cell by cell.
	const gapBetween = (low: string, high: string) =>
		Math.max(HORIZONTAL_GAP, reachOf(low, highSide) + reachOf(high, lowSide) + PORT_SPACING);
	const stackBreadth = (cell: readonly string[]) =>
		cell.reduce(
			(sum, id, index) =>
				sum + shapes.get(id)![breadthOf] + (index > 0 ? gapBetween(cell[index - 1]!, id) : 0),
			0,
		);
	const content = cells.map((lane) => Math.max(0, ...lane.map(stackBreadth)));
	// Local offsets across each lane's content.
	const offset = new Map<string, number>();
	for (const [lane, laneCells] of cells.entries())
		for (const cell of laneCells) {
			let at = (content[lane]! - stackBreadth(cell)) / 2;
			for (const [index, id] of cell.entries()) {
				if (index > 0) at += gapBetween(cell[index - 1]!, id);
				offset.set(id, at);
				at += shapes.get(id)![breadthOf];
			}
		}
	// A lane's padding holds its steps' stubs on the sides that face its edges, with a lane to spare.
	const padding = cells.map((laneCells, lane) => {
		const ids = laneCells.flat();
		const pad = (side: ConnectionEdge) =>
			Math.max(
				LANE_PADDING,
				...ids.map((id) => {
					const inset =
						side === lowSide
							? offset.get(id)!
							: content[lane]! - offset.get(id)! - shapes.get(id)![breadthOf];
					return reachOf(id, side) - inset + LANE_ROOM;
				}),
			);
		return { low: pad(lowSide), high: pad(highSide) };
	});

	// Headers: a row's header is as wide as the widest name; a column's as tall as the tallest.
	const names = lanes.map((lane) => measureLaneLabel(lane.label));
	const headerDepth = vertical
		? 0
		: Math.max(...names.map((name) => name.textWidth)) + 2 * LANE_HEADER_PADDING;
	const breadth = cells.map((_, lane) =>
		Math.max(
			padding[lane]!.low + content[lane]! + padding[lane]!.high,
			vertical
				? measureLaneLabel(lanes[lane]!.label).longestWord + 2 * LANE_HEADER_PADDING
				: names[lane]!.textHeight + 2 * LANE_HEADER_PADDING,
		),
	);
	const wrapped = lanes.map((lane, index) =>
		vertical
			? measureLaneLabel(lane.label, breadth[index]! - 2 * LANE_HEADER_PADDING)
			: names[index]!,
	);
	const headerSize = vertical
		? Math.max(
				LANE_HEADER_MIN_HEIGHT,
				...wrapped.map((name) => name.textHeight + 2 * LANE_HEADER_PADDING),
			)
		: Math.ceil(headerDepth);

	const poolBreadth = breadth.reduce((sum, laneBreadth) => sum + laneBreadth, 0);
	return {
		along,
		across,
		backSide,
		breadth,
		columnCount,
		columnOf,
		columns,
		content,
		depth,
		depthOf,
		forwardSide,
		gapAfter,
		headerSize,
		laneIndex,
		laneOf,
		offset,
		padding,
		poolBreadth,
		reach,
		shapes,
		vertical,
		wrapped,
	};
}

/** Forward edges a pool cut may carry from one pool to the next. */
const MAX_LANE_CONTINUATIONS = 2;

/**
 * Pools for a laned flow too long for its breadth: runs of whole columns, each
 * drawn as a full set of lanes, stacked across the flow. A cut falls between
 * two columns that no loop spans and at most two forward edges cross, which
 * then continue from one pool into the next. Pools stay at least two columns
 * long and as even as the cuts allow, and the fewest pools that bring the
 * drawing within the target aspect win.
 */
function planLaneWrap(diagram: IntermediateDiagram): Wrap {
	const { columnCount, columns, depth, gapAfter, headerSize, poolBreadth } = laneGeometry(
		diagram,
		new Map(),
		new Map(),
	);
	if (columnCount < 2 * 2) return NO_WRAP;
	const feedback = flowFeedback(diagram);
	const span = (edge: DiagramEdge) => {
		const [from, to] = [columns.get(edge.source)!, columns.get(edge.target)!];
		return [Math.min(from, to), Math.max(from, to)] as const;
	};
	// Forward edges crossing the cut after each column, or undefined where a loop spans it.
	const crossing = Array.from({ length: columnCount - 1 }, (_, cut) => {
		const spanning = diagram.edges.filter((edge) => {
			const [low, high] = span(edge);
			return low <= cut && high > cut;
		});
		return spanning.some((edge) => feedback.has(edge.id)) ||
			spanning.length > MAX_LANE_CONTINUATIONS
			? undefined
			: spanning.map((edge) => edge.id);
	});
	const length = (from: number, to: number) =>
		headerSize +
		2 * LANE_END_PADDING +
		depth.slice(from, to + 1).reduce((sum, value) => sum + value, 0) +
		gapAfter.slice(from, to).reduce((sum, value) => sum + value, 0);
	const last = columnCount - 1;
	const natural = exportAspect(length(0, last), poolBreadth);
	type Partition = { cuts: number[]; longest: number; carried: number; squares: number };
	const better = (a: Partition, b: Partition | undefined) =>
		!b ||
		a.longest < b.longest - AXIS_ALIGNED_EPSILON ||
		(Math.abs(a.longest - b.longest) <= AXIS_ALIGNED_EPSILON &&
			(a.carried < b.carried || (a.carried === b.carried && a.squares < b.squares)));
	let chosen: { aspect: number; cuts: readonly number[] } | undefined;
	for (let pools = 2; pools <= MAX_BANDS; pools += 1) {
		// Best partitions of the columns up to each end into a number of pools.
		let partitions = new Map<number, Partition>();
		for (let end = 1; end < last; end += 1)
			if (crossing[end] !== undefined)
				partitions.set(end, {
					cuts: [end],
					longest: length(0, end),
					carried: crossing[end]!.length,
					squares: length(0, end) ** 2,
				});
		for (let pool = 2; pool < pools; pool += 1) {
			const next = new Map<number, Partition>();
			for (const [previous, partition] of partitions)
				for (let end = previous + 2; end < last; end += 1) {
					if (crossing[end] === undefined) continue;
					const size = length(previous + 1, end);
					const candidate = {
						cuts: [...partition.cuts, end],
						longest: Math.max(partition.longest, size),
						carried: partition.carried + crossing[end]!.length,
						squares: partition.squares + size ** 2,
					};
					if (better(candidate, next.get(end))) next.set(end, candidate);
				}
			partitions = next;
		}
		let best: Partition | undefined;
		for (const [previous, partition] of partitions) {
			if (last < previous + 2) continue;
			const size = length(previous + 1, last);
			const candidate = {
				...partition,
				longest: Math.max(partition.longest, size),
				squares: partition.squares + size ** 2,
			};
			if (better(candidate, best)) best = candidate;
		}
		if (!best) continue;
		const across = pools * poolBreadth + (pools - 1) * lanePoolGap(MAX_LANE_CONTINUATIONS);
		const aspect = exportAspect(best.longest, across);
		if (!chosen || aspect < chosen.aspect) chosen = { aspect, cuts: best.cuts };
		if (aspect <= WRAP_TARGET_ASPECT) break;
	}
	if (!chosen || chosen.aspect >= natural) return NO_WRAP;
	const poolOf = (column: number) => chosen.cuts.filter((cut) => cut < column).length;
	return {
		bandOf: new Map(diagram.nodes.map((node) => [node.id, poolOf(columns.get(node.id)!)])),
		continuations: new Set(chosen.cuts.flatMap((cut) => crossing[cut]!)),
	};
}

/** The room between two pools of a wrapped laned diagram, for the continuations between them. */
function lanePoolGap(continuations: number): number {
	return Math.max(BAND_GAP, 2 * ROUTE_STUB_LENGTH + (continuations + 1) * PORT_SPACING);
}

/**
 * Lay a laned diagram out: each step in its lane's band at its column. A
 * wrapped one cuts its columns into pools, each a full set of lanes with their
 * headers, stacked across the flow; every pool runs one length. RL and BT read
 * their columns backward; headers stay on the left or top.
 */
function positionLanedNodes(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	stubReach: ReadonlyMap<string, number>,
	wrap: Wrap = NO_WRAP,
): PositionedLayout {
	const lanes = diagram.lanes!;
	const { direction } = diagram.layout;
	const {
		along,
		across,
		backSide,
		breadth,
		columnCount,
		columnOf,
		columns,
		content,
		depth,
		depthOf,
		forwardSide,
		gapAfter,
		headerSize,
		laneIndex,
		laneOf,
		offset,
		padding,
		poolBreadth,
		reach,
		shapes,
		vertical,
		wrapped,
	} = laneGeometry(diagram, minimumSizes, stubReach);
	// Each column's pool; a wrap cuts between whole columns.
	const poolOf = columnOf.map((column) => wrap.bandOf.get(column[0]?.nodeId ?? "") ?? 0);
	const poolCount = Math.max(0, ...poolOf) + 1;
	const firstOf = (pool: number) => poolOf.indexOf(pool);
	const lastOf = (pool: number) => poolOf.lastIndexOf(pool);
	const pools = Array.from({ length: poolCount }, (_, pool) => pool);
	// Room before each pool's first column and after its last; reading backward,
	// the last column sits next to the header.
	const before = Math.max(
		LANE_END_PADDING,
		...pools.map((pool) => reach(columnOf[firstOf(pool)] ?? [], backSide) + LANE_ROOM),
	);
	const after = Math.max(
		LANE_END_PADDING,
		...pools.map((pool) => reach(columnOf[lastOf(pool)] ?? [], forwardSide) + LANE_ROOM),
	);
	const backward = direction === "RL" || direction === "BT";
	const [leading, trailing] = backward ? [after, before] : [before, after];
	const poolAlong = PADDING;
	const bodyStart = poolAlong + headerSize + leading;
	const columnStart: number[] = [];
	let cursor = bodyStart;
	let bodyLength = 0;
	for (const [index, columnDepth] of depth.entries()) {
		if (index > 0 && poolOf[index] !== poolOf[index - 1]) cursor = bodyStart;
		columnStart.push(cursor);
		cursor += columnDepth;
		bodyLength = Math.max(bodyLength, cursor - bodyStart);
		if (index < columnCount - 1 && poolOf[index + 1] === poolOf[index]) cursor += gapAfter[index]!;
	}
	const bodyEnd = bodyStart + bodyLength;
	const poolEnd = bodyEnd + trailing;
	// Pools stack across the flow, each gap holding the continuations that cross it.
	const crossing = pools.map((pool) =>
		[...wrap.continuations].filter((id) => {
			const edge = diagram.edges.find((candidate) => candidate.id === id);
			return edge !== undefined && wrap.bandOf.get(edge.source) === pool;
		}),
	);
	const poolStart: number[] = [];
	cursor = PADDING;
	for (const pool of pools) {
		poolStart.push(cursor);
		cursor += poolBreadth + lanePoolGap(crossing[pool]!.length);
	}
	const laneStart = (pool: number, lane: number) =>
		poolStart[pool]! + breadth.slice(0, lane).reduce((sum, laneBreadth) => sum + laneBreadth, 0);
	const nodes = diagram.nodes.map((node) => {
		const shape = shapes.get(node.id)!;
		const lane = laneIndex.get(node.lane!)!;
		const column = columns.get(node.id)!;
		const forwardAlong = columnStart[column]! + (depth[column]! - shape[depthOf]) / 2;
		const alongAt = backward ? bodyStart + bodyEnd - forwardAlong - shape[depthOf] : forwardAlong;
		const acrossAt =
			laneStart(poolOf[column]!, lane) +
			padding[lane]!.low +
			(breadth[lane]! - padding[lane]!.low - padding[lane]!.high - content[lane]!) / 2 +
			offset.get(node.id)!;
		const placed: NodeSceneElement = { ...shape, [along]: alongAt, [across]: acrossAt };
		return placed;
	});
	const box = (
		alongFrom: number,
		alongSize: number,
		acrossFrom: number,
		acrossSize: number,
	): Box =>
		vertical
			? { x: acrossFrom, y: alongFrom, width: acrossSize, height: alongSize }
			: { x: alongFrom, y: acrossFrom, width: alongSize, height: acrossSize };
	const bases = laneElementBases(lanes, poolCount, new Set(diagram.nodes.map((node) => node.id)));
	const frames = pools.flatMap((pool) =>
		lanes.map((lane, index): LaneFrame => ({
			box: box(poolAlong, poolEnd - poolAlong, laneStart(pool, index), breadth[index]!),
			elementId: pool === 0 ? bases.get(lane.id)! : `${bases.get(lane.id)!}:${pool + 1}`,
			header: box(poolAlong, headerSize, laneStart(pool, index), breadth[index]!),
			id: lane.id,
			label: lane.label,
			pool,
			text: wrapped[index]!.text,
		})),
	);
	const poolBoxes = pools.map((pool) =>
		box(poolAlong, poolEnd - poolAlong, poolStart[pool]!, poolBreadth),
	);
	return {
		lanes: {
			continuations: wrap.continuations,
			frames,
			laneOf,
			pool: boundsOf(poolBoxes),
			pools: poolBoxes,
			vertical,
		},
		nodes,
	};
}

/** A lane name wrapped for its header, at a width or the header's usual line length. */
function measureLaneLabel(
	label: string,
	maxWidth?: number,
): { longestWord: number; text: string; textHeight: number; textWidth: number } {
	const text =
		maxWidth === undefined
			? wrapTextToUnits(label, LANE_LABEL_LINE_UNITS)
			: wrapTextToWidth(label, maxWidth, LANE_LABEL_FONT_SIZE);
	const lines = text.split("\n");
	return {
		longestWord: Math.max(
			...label.split(/\s+/u).map((word) => estimateTextWidth(word, LANE_LABEL_FONT_SIZE)),
		),
		text,
		textHeight: Math.ceil(lines.length * LANE_LABEL_FONT_SIZE * NODE_LABEL_LINE_HEIGHT),
		textWidth: Math.ceil(estimateTextWidth(text, LANE_LABEL_FONT_SIZE)),
	};
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

/** The frames edges start or end at, as shapes routes leave and arrive at. */
function compositeShapes(groups: GroupLayout | undefined): NodeSceneElement[] {
	return (groups?.frames ?? []).flatMap((frame) =>
		groups!.composites.has(frame.id)
			? [
					{
						...obstacleBox(frame.elementId, frame.box),
						kind: "composite",
						label: frame.label,
						nodeId: frame.id,
					},
				]
			: [],
	);
}

/** Each frame with the band above it, or each zone, for sizing what is drawn. */
function groupBlocks(groups: GroupLayout | undefined): NodeSceneElement[] {
	const band = groups?.zoned ? 0 : GROUP_LABEL_BAND;
	return (groups?.frames ?? []).map((frame) =>
		obstacleBox(frame.elementId, {
			...frame.box,
			y: frame.box.y - band,
			height: frame.box.height + band,
		}),
	);
}

/**
 * What a route must not cross besides nodes and branch labels: every group's
 * name, every group neither end sits in, and, for an edge inside a group, walls
 * around the innermost group holding both ends so the edge stays inside.
 */
function groupObstacles(groups: GroupLayout | undefined, route: RoutedEdge): NodeSceneElement[] {
	if (!groups) return [];
	const ends = new Set([
		...groupChain(groups, groups.groupOf.get(route.source.nodeId)),
		...groupChain(groups, groups.groupOf.get(route.target.nodeId)),
	]);
	const shared = sharedGroup(groups, route.source.nodeId, route.target.nodeId);
	return groups.frames.flatMap((frame) => {
		const label = obstacleBox(`group-label:${frame.id}`, frame.labelBox);
		if (frame.id === shared) {
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
		return ends.has(frame.id) ? [label] : [label, obstacleBox(frame.elementId, frame.box)];
	});
}

const GROUP_OUTLINE = "group-outline:";
/**
 * Lane boundaries are outlines too, but only the outline clearance holds a
 * route off them: thin and crisp, a boundary never reads as another arrow.
 */
const LANE_OUTLINE = `${GROUP_OUTLINE}lane:`;
/**
 * A route keeps this far from a lane boundary it runs along wherever it can;
 * closer than the outline clearance is a defect.
 */
const LANE_OUTLINE_CLEARANCE = 24;

/**
 * Each frame's outline as an unbound, headless line for routes to keep apart
 * from. A zone's outline is crisp and thin like a lane's boundary, so routes
 * keep a lane's room from it wherever they can.
 */
function groupOutlineLines(groups: GroupLayout | undefined): ArrowSceneElement[] {
	return (groups?.frames ?? []).map((frame) => {
		const { x, y, width, height } = frame.box;
		const id = `${GROUP_OUTLINE}${frame.id}`;
		return {
			type: "arrow",
			id,
			edgeId: id,
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
 * Routes that misread a group: through a group neither end sits in, along or
 * hard beside a frame's outline, across a group's name, or an edge leaving a
 * group that holds both its ends.
 */
function groupRouteDefects(
	arrows: readonly ArrowSceneElement[],
	groups: GroupLayout,
): (readonly [string])[] {
	const defects: (readonly [string])[] = [];
	const outlines = groups.frames.map((frame) => frameOutline(frame.box));
	for (const arrow of arrows) {
		const segments = segmentsFromPoints(arrow.points);
		const ends = new Set([
			...groupChain(groups, groups.groupOf.get(arrow.sourceNodeId)),
			...groupChain(groups, groups.groupOf.get(arrow.targetNodeId)),
		]);
		const holding = new Set(
			groupChain(groups, sharedGroup(groups, arrow.sourceNodeId, arrow.targetNodeId)),
		);
		for (const [index, frame] of groups.frames.entries()) {
			const own = ends.has(frame.id);
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
				(holding.has(frame.id) && arrow.points.some((point) => !insideBox(point, frame.box)))
			)
				defects.push([arrow.id]);
		}
	}
	return defects;
}

/** The id a lane's band draws under. */
function laneElementId(frame: LaneFrame): string {
	return frame.elementId;
}

/**
 * The id each lane's band draws under, by lane id: `lane:` and the lane's id
 * escaped, so no lane's ids extend another's, then a later pool's number. A
 * base a diagram node's id already uses takes `@1`, `@2` and so on; escaping
 * leaves no `:` or `@` in a lane's id, so these never meet another lane's.
 */
function laneElementBases(
	lanes: readonly { readonly id: string }[],
	pools: number,
	nodeIds: ReadonlySet<string>,
): Map<string, string> {
	const bases = new Map<string, string>();
	for (const lane of lanes) {
		const escaped = `lane:${encodeURIComponent(lane.id)}`;
		const uses = (base: string) =>
			Array.from({ length: pools }, (_, pool) => (pool === 0 ? base : `${base}:${pool + 1}`)).some(
				(band) => nodeIds.has(band) || nodeIds.has(`${band}:header`),
			);
		let base = escaped;
		for (let suffix = 1; uses(base); suffix += 1) base = `${escaped}@${suffix}`;
		bases.set(lane.id, base);
	}
	return bases;
}

/**
 * What a route must not cross in a laned diagram: every lane's header, and
 * walls around each pool of lanes, so every line stays inside its pool. Only
 * a continuation passes between pools.
 */
function laneObstacles(lanes: LaneLayout | undefined, continuation = false): NodeSceneElement[] {
	if (!lanes) return [];
	const wall = GROUP_WALL;
	return [
		...lanes.frames.map((frame) =>
			obstacleBox(`lane-header:${laneElementId(frame)}`, frame.header),
		),
		...(continuation ? [] : lanes.pools).flatMap(({ x, y, width, height }, pool) => [
			obstacleBox(`lane-wall:${pool}:top`, {
				x: x - wall,
				y: y - wall,
				width: width + 2 * wall,
				height: wall,
			}),
			obstacleBox(`lane-wall:${pool}:bottom`, {
				x: x - wall,
				y: y + height,
				width: width + 2 * wall,
				height: wall,
			}),
			obstacleBox(`lane-wall:${pool}:left`, {
				x: x - wall,
				y: y - wall,
				width: wall,
				height: height + 2 * wall,
			}),
			obstacleBox(`lane-wall:${pool}:right`, {
				x: x + width,
				y: y - wall,
				width: wall,
				height: height + 2 * wall,
			}),
		]),
	];
}

/**
 * Every line a laned diagram draws besides its routes: the boundary between
 * each two lanes and the lanes' outline across the flow, and the line between
 * the headers and the lanes' bodies and the outline along it.
 */
function laneBoundaries(lanes: LaneLayout): AxisAlignedSegment[] {
	return lanes.pools.flatMap((pool, index) =>
		poolBoundaries(
			pool,
			lanes.frames.filter((frame) => frame.pool === index),
			lanes.vertical,
		),
	);
}

function poolBoundaries(
	pool: Box,
	frames: readonly LaneFrame[],
	vertical: boolean,
): AxisAlignedSegment[] {
	const header = frames[0]!.header;
	const acrossLines = [
		...frames.map((frame) => (vertical ? frame.box.x : frame.box.y)),
		vertical ? pool.x + pool.width : pool.y + pool.height,
	];
	const alongLines = vertical
		? [pool.y, header.y + header.height, pool.y + pool.height]
		: [pool.x, header.x + header.width, pool.x + pool.width];
	return [
		...acrossLines.flatMap((at) =>
			segmentsFromPoints(
				vertical
					? [
							{ x: at, y: pool.y },
							{ x: at, y: pool.y + pool.height },
						]
					: [
							{ x: pool.x, y: at },
							{ x: pool.x + pool.width, y: at },
						],
			),
		),
		...alongLines.flatMap((at) =>
			segmentsFromPoints(
				vertical
					? [
							{ x: pool.x, y: at },
							{ x: pool.x + pool.width, y: at },
						]
					: [
							{ x: at, y: pool.y },
							{ x: at, y: pool.y + pool.height },
						],
			),
		),
	];
}

/** Each lane boundary as an unbound, headless line for routes to keep apart from. */
function laneOutlineLines(lanes: LaneLayout | undefined): ArrowSceneElement[] {
	if (!lanes) return [];
	return laneBoundaries(lanes).map((segment, index) => {
		const id = `${LANE_OUTLINE}${index}`;
		const [from, to] =
			segment.orientation === "horizontal"
				? [
						{ x: segment.min, y: segment.staticCoordinate },
						{ x: segment.max, y: segment.staticCoordinate },
					]
				: [
						{ x: segment.staticCoordinate, y: segment.min },
						{ x: segment.staticCoordinate, y: segment.max },
					];
		return {
			type: "arrow",
			id,
			edgeId: id,
			sourceNodeId: "",
			targetNodeId: "",
			endArrowhead: null,
			points: [from, to],
		};
	});
}

/** Routes that misread lanes: across a lane's header, along or hard beside a lane boundary, or out of the lanes. */
function laneRouteDefects(
	arrows: readonly ArrowSceneElement[],
	lanes: LaneLayout,
): (readonly [string])[] {
	const boundaries = laneBoundaries(lanes);
	return arrows.flatMap((arrow) => {
		const segments = segmentsFromPoints(arrow.points);
		return segments.some(
			(segment) =>
				lanes.frames.some((frame) => segmentCrossesBoundsInterior(segment, frame.header)) ||
				boundaries.some(
					(edge) =>
						edge.orientation === segment.orientation &&
						Math.abs(edge.staticCoordinate - segment.staticCoordinate) < GROUP_OUTLINE_CLEARANCE &&
						segmentOverlapLength(edge, segment) > GROUP_OUTLINE_CLEARANCE,
				),
		) || arrow.points.some((point) => !insideBox(point, lanes.pool))
			? [[arrow.id] as const]
			: [];
	});
}

/**
 * Each branch of a decision in lanes leaves by the vertex that faces its
 * target: the vertex across the flow toward a target in another lane, or the
 * forward vertex for one in the decision's own lane. Lanes hold targets where
 * their actors are, so two may lie on one side. A straight handoff keeps that
 * vertex first, then the branch furthest back along the flow; of the others,
 * one running ahead leaves forward, and one looping back leaves by the other
 * vertex across the flow, to run around rather than double back.
 */
function assignLaneBranchSides(
	routes: readonly RoutedEdge[],
	lanes: LaneLayout,
	direction: LayoutDirection,
): void {
	const [across, along] = lanes.vertical ? (["x", "y"] as const) : (["y", "x"] as const);
	const forward = FORWARD_SIDE[direction];
	const ahead = EDGE_NORMAL[forward][along];
	const lateral = (sign: number): ConnectionEdge =>
		lanes.vertical ? (sign < 0 ? "left" : "right") : sign < 0 ? "top" : "bottom";
	for (const source of new Set(
		routes.filter((r) => branches(r.source.kind)).map((r) => r.source),
	)) {
		const own = routes.filter((route) => route.source === source && !isSelfLoop(route));
		if (own.length > 3) continue;
		const sideOf = (route: RoutedEdge) =>
			lanes.laneOf.get(route.target.nodeId) === lanes.laneOf.get(source.nodeId)
				? 0
				: Math.sign(center(route.target)[across] - center(source)[across]);
		const progress = (route: RoutedEdge) =>
			(center(route.target)[along] - center(source)[along]) * ahead;
		const size = lanes.vertical ? "height" : "width";
		const straight = (route: RoutedEdge) =>
			Math.min(source[along] + source[size], route.target[along] + route.target[size]) -
				Math.max(source[along], route.target[along]) >
			AXIS_ALIGNED_EPSILON;
		const taken = new Set<ConnectionEdge>();
		const pending: RoutedEdge[] = [];
		for (const sign of [-1, 1]) {
			const wanting = own
				.filter((route) => sideOf(route) === sign)
				.sort((a, b) => Number(straight(b)) - Number(straight(a)) || progress(a) - progress(b));
			if (wanting[0]) {
				wanting[0].sourceEdge = lateral(sign);
				taken.add(lateral(sign));
			}
			pending.push(...wanting.slice(1));
		}
		pending.push(...own.filter((route) => sideOf(route) === 0));
		for (const route of pending.sort((a, b) => progress(a) - progress(b))) {
			const sides =
				progress(route) < 0
					? [lateral(1), lateral(-1), forward]
					: [forward, lateral(-1), lateral(1)];
			route.sourceEdge = sides.find((side) => !taken.has(side)) ?? forward;
			taken.add(route.sourceEdge);
		}
	}
}

/**
 * In lanes no step takes lines in and sends lines out by one side: a
 * departure sharing a side with an arrival moves forward, or else to a side
 * across the flow, preferring one no other line leaves by.
 */
function separateLaneRoles(routes: readonly RoutedEdge[], direction: LayoutDirection): void {
	const forward = FORWARD_SIDE[direction];
	const across: readonly ConnectionEdge[] =
		direction === "TB" || direction === "BT" ? ["left", "right"] : ["top", "bottom"];
	for (const route of routes) {
		if (isSelfLoop(route) || route.pinned !== undefined) continue;
		const node = route.source;
		const arrives = (side: ConnectionEdge) =>
			routes.some((other) => other.target === node && other.targetEdge === side);
		const leaves = (side: ConnectionEdge) =>
			routes.some((other) => other !== route && other.source === node && other.sourceEdge === side);
		if (!arrives(route.sourceEdge)) continue;
		const sides = [forward, ...across].filter((side) => !arrives(side));
		route.sourceEdge = sides.find((side) => !leaves(side)) ?? sides[0] ?? route.sourceEdge;
	}
}

/**
 * Each continuation of a wrapped laned diagram runs through the gap after its
 * source's pool, the gap's continuations side by side in edge order.
 */
function assignLaneContinuations(
	routes: readonly RoutedEdge[],
	lanes: LaneLayout,
	wrap: Wrap,
): void {
	const across = lanes.vertical ? "x" : "y";
	const size = lanes.vertical ? "width" : "height";
	const continuations = routes.filter((route) => wrap.continuations.has(route.edge.id));
	for (const route of continuations) {
		const pool = wrap.bandOf.get(route.source.nodeId) ?? 0;
		const [before, after] = [lanes.pools[pool]!, lanes.pools[pool + 1]];
		if (!after) continue;
		const sharing = continuations.filter(
			(other) => (wrap.bandOf.get(other.source.nodeId) ?? 0) === pool,
		);
		const middle = (before[across] + before[size] + after[across]) / 2;
		route.lane = middle + (sharing.indexOf(route) - (sharing.length - 1) / 2) * PORT_SPACING;
	}
}

/** The lanes as one block, for sizing what is drawn. */
function laneBlocks(lanes: LaneLayout | undefined): NodeSceneElement[] {
	return lanes ? [obstacleBox("lanes", lanes.pool)] : [];
}

/**
 * Whether a route hands off straight across a lane boundary: between steps of
 * two lanes that share their extent along the flow, by the sides that face
 * each other across it.
 */
function straightHandoff(route: RoutedEdge, lanes: LaneLayout): boolean {
	const { source, target } = route;
	const [along, size] = lanes.vertical ? (["y", "height"] as const) : (["x", "width"] as const);
	return (
		lanes.laneOf.get(source.nodeId) !== lanes.laneOf.get(target.nodeId) &&
		slotAxis(route.sourceEdge) === along &&
		route.targetEdge === OPPOSITE_EDGE[route.sourceEdge] &&
		Math.min(source[along] + source[size], target[along] + target[size]) -
			Math.max(source[along], target[along]) >
			AXIS_ALIGNED_EPSILON
	);
}

/**
 * A handoff to a step in the same column of another lane runs straight across
 * the lane boundary: it leaves and arrives by the sides that face each other
 * across the flow.
 */
function assignLaneSides(routes: readonly RoutedEdge[], lanes: LaneLayout): void {
	const [along, size] = lanes.vertical ? (["y", "height"] as const) : (["x", "width"] as const);
	for (const route of routes) {
		const { source, target } = route;
		if (
			isSelfLoop(route) ||
			lanes.continuations.has(route.edge.id) ||
			lanes.laneOf.get(source.nodeId) === lanes.laneOf.get(target.nodeId)
		)
			continue;
		const shared =
			Math.min(source[along] + source[size], target[along] + target[size]) -
			Math.max(source[along], target[along]);
		if (shared <= AXIS_ALIGNED_EPSILON) continue;
		const ahead = lanes.vertical
			? center(target).x > center(source).x
			: center(target).y > center(source).y;
		route.sourceEdge = lanes.vertical ? (ahead ? "right" : "left") : ahead ? "bottom" : "top";
		route.targetEdge = OPPOSITE_EDGE[route.sourceEdge];
	}
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

	const longDownwardDecisionBranch = branches(sourceKind) && dy > source.height + VERTICAL_GAP;

	if (branches(sourceKind) && dy > 0 && (dx !== 0 || longDownwardDecisionBranch)) {
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

/**
 * Whether a side curves, so a lone line meets it at its middle: every side of a
 * diamond or ellipse, a cylinder's lid and foot, a pipe's ends, a document's foot.
 */
function curvedSide(shape: NodeSceneElement, side: ConnectionEdge): boolean {
	switch (shape.shape) {
		case "rectangle":
			return false;
		case "cylinder":
			return side === "top" || side === "bottom";
		case "pipe":
			return side === "left" || side === "right";
		case "document":
			return side === "bottom";
		default:
			return true;
	}
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
	// A composed shape's sides curve or taper in from its box: lines end on them.
	if (isCanvasComposedShape(shape.shape))
		return canvasComposedOutlinePoint(
			{ ...shape, shape: shape.shape },
			edge,
			pointOnEdge({ ...shape, shape: "rectangle" }, edge, portOffset),
		);
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

function isSelfLoop(route: RoutedEdge): boolean {
	return route.edge.source === route.edge.target;
}

/** A self-loop's ports sit toward the corner between its two sides. */
function loopCorner(route: RoutedEdge, endpoint: "source" | "target"): number {
	const [side, other] =
		endpoint === "source"
			? [route.sourceEdge, route.targetEdge]
			: [route.targetEdge, route.sourceEdge];
	return EDGE_NORMAL[other][slotAxis(side)];
}

/**
 * Where an endpoint's far end lies along its side, which orders the ports on
 * that side: past the corner a self-loop turns around.
 */
function farCoordinate(route: RoutedEdge, endpoint: "source" | "target"): number {
	const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
	if (isSelfLoop(route)) return loopCorner(route, endpoint) * 1e9;
	return center(endpoint === "source" ? route.target : route.source)[slotAxis(side)];
}

/** Lines of a pair side by side in pair order; every other line ranks 0. */
function pairRank(routes: readonly RoutedEdge[], edgeId: string): number {
	return routes.find((route) => route.edge.id === edgeId)?.pair ?? 0;
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
				coordinate: farCoordinate(route, "source"),
			},
		]);
		connectionsByPort.set(targetPortKey, [
			...(connectionsByPort.get(targetPortKey) ?? []),
			{
				edgeId: route.edge.id,
				endpoint: "target",
				coordinate: farCoordinate(route, "target"),
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
			(!branches(labeled[0]!.source.kind) || (sharedDecisionPitch && labeled.length > 1))
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
			.sort(
				(a, b) =>
					a.coordinate - b.coordinate || pairRank(routes, a.edgeId) - pairRank(routes, b.edgeId),
			)
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
/** In lanes, where handoffs and loops often meet one step, arrivals on a side sit farther apart. */
const LANE_ARRIVAL_SPACING = 1.5 * ARRIVAL_SPACING;
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
		: targetStubLength(slot.route, point, ROUTE_STUB_LENGTH);
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
	const preference = lineSlotPreference(slot, offsets, slotsBySide);
	const node = slot.route[slot.endpoint];
	if (node.kind !== "composite" || slotSide(slot) !== "top") return preference;
	// A composite's frame carries its name above its top-left corner; ports on
	// its top keep right of the name.
	const name = canvasFrameNameBox({ ...node, name: node.label });
	const low = name.x + name.width + PORT_SPACING - center(node).x;
	return {
		...preference,
		desired: Math.max(low, preference.desired),
		low: Math.max(low, preference.low),
		high: Math.max(low, preference.high),
		priority: 3,
	};
}

function lineSlotPreference(
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
	if (isSelfLoop(slot.route)) {
		const corner = loopCorner(slot.route, slot.endpoint) * Math.max(0, portLimit(node, side));
		return { desired: corner, high: corner, low: corner, priority: 2 };
	}
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
		curvedSide(target.route[target.endpoint], sideOfTarget) &&
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
		if (!byApproach || isSelfLoop(slot.route)) return farCoordinate(slot.route, slot.endpoint);
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
	const ordered = [...slots].sort(
		(a, b) => far(a) - far(b) || (a.route.pair ?? 0) - (b.route.pair ?? 0),
	);
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
	arrivalSpacing = ARRIVAL_SPACING,
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
				(!branches(labeled[0]!.route.source.kind) || (sharedDecisionPitch && labeled.length > 1))
					? Math.max(
							...labeled.map((slot) => {
								const metrics = branchLabelMetrics(slot.route.edge.label!);
								return (slotAxis(side) === "x" ? metrics.width : metrics.height) + 24;
							}),
						)
					: 0;
			if (node.kind === "state") outerLabelSides(slots);
			const positions = spreadPorts(
				slots.map((slot) => preferences.get(slot)!),
				slots
					.slice(1)
					.map((slot, index) =>
						Math.max(
							node.kind === "state" ? stateLabelGap(slots[index]!, slot, side) : labelPitch,
							slot.endpoint === "target" || slots[index]!.endpoint === "target"
								? arrivalSpacing
								: PORT_SPACING,
						),
					),
				portLimit(node, side),
			);
			slots.forEach((slot, index) => offsets.set(slot.key, positions[index]!));
		}
	return offsets;
}

/**
 * A state's outermost departures on a side carry their labels outside the
 * others: the lowest toward the low end (left or above), the highest toward the
 * high end, so neighboring lines need no room for a label between them.
 */
function outerLabelSides(slots: readonly PortSlot[]): void {
	for (const [index, slot] of slots.entries()) {
		const { route } = slot;
		if (slot.endpoint !== "source" || route.pair !== undefined || isSelfLoop(route)) continue;
		const outer = index === 0 ? -1 : index === slots.length - 1 ? 1 : undefined;
		if (slots.length > 1 && outer !== undefined) route.labelSide = outer;
		else delete route.labelSide;
	}
}

/** The side of its line a route's label sits on: right of a vertical stub, above a horizontal one. */
function labelSideOf(route: RoutedEdge): -1 | 1 {
	const horizontal = route.sourceEdge === "left" || route.sourceEdge === "right";
	return route.labelSide ?? route.pair ?? (horizontal ? -1 : 1);
}

/**
 * Room a state keeps between two neighboring ports on one side for the labels
 * that sit between them: a departure's label lies right of a vertical stub and
 * above a horizontal one, or on its own side of a pair.
 */
function stateLabelGap(low: PortSlot, high: PortSlot, side: ConnectionEdge): number {
	const reach = (slot: PortSlot, toward: -1 | 1) => {
		const { route } = slot;
		const vertical = slotAxis(side) === "x";
		if (slot.endpoint !== "source" || !route.edge.label || isSelfLoop(route)) return 0;
		if (labelSideOf(route) !== toward) return 0;
		const metrics = branchLabelMetrics(route.edge.label, branches(route.source.kind));
		return (vertical ? metrics.width : metrics.height) + 24;
	};
	return Math.max(reach(low, 1), reach(high, -1));
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
			// A marker keeps its size; its one transition takes the middle of a side.
			if (markerSize(node) !== undefined) continue;
			const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
			const dimension = side === "top" || side === "bottom" ? "width" : "height";
			const required =
				2 *
				(PORT_PADDING +
					Math.abs(offsets.get(connectionKey({ edgeId: route.edge.id, endpoint })) ?? 0));
			if (required <= (sizes.get(node.nodeId)?.[dimension] ?? node[dimension])) continue;
			const size = sizes.get(node.nodeId) ?? { width: node.width, height: node.height };
			size[dimension] = required;
			sizes.set(node.nodeId, node.kind === "choice" && !node.label ? squareChoice(size, 0) : size);
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

/**
 * How far the reserved endpoint stubs reach past each node side's bounding
 * box, and a self-loop's label, or with `labels` every branch label, beside
 * its stub.
 */
function stubReachForRoutes(
	routes: readonly RoutedEdge[],
	portOffsets: ReadonlyMap<string, number>,
	labels = false,
): Map<string, number> {
	const reach = new Map<string, number>();
	for (const route of routes) {
		const { start, end } = routeEndpoints(route, portOffsets);
		for (const [node, side, length] of [
			[route.source, route.sourceEdge, sourceStubLength(route, start, ROUTE_STUB_LENGTH)],
			[route.target, route.targetEdge, targetStubLength(route, end, ROUTE_STUB_LENGTH)],
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
		// A self-loop's label sits outside its loop.
		if (route.edge.label && (labels || isSelfLoop(route))) {
			const node = route.source;
			const box = labelBox(
				branchLabelPosition(route, start),
				branchLabelMetrics(route.edge.label, branches(node.kind)),
			);
			for (const [side, beyond] of [
				["left", node.x - box.x],
				["right", box.x + box.width - node.x - node.width],
				["top", node.y - box.y],
				["bottom", box.y + box.height - node.y - node.height],
			] as const) {
				const key = portKey(node.nodeId, side);
				if (beyond > 0) reach.set(key, Math.max(reach.get(key) ?? 0, beyond));
			}
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
					pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, ROUTE_STUB_LENGTH)),
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
	const routed =
		edgeRouting === "orthogonal"
			? exteriorLaneRoute(route, portedStart, portedEnd, shapes, existingArrows, options)
			: compactPoints([portedStart, portedEnd]);
	// A pinned line keeps only its corners, so a stem it shares with another line
	// stays one run from the shared port, as the export validator reads it.
	const points = route.pinned ? compactPoints(straightRuns(routed)) : routed;

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

/** Room a route keeps from the drawn outline of every node it neither leaves nor enters. */
const NODE_CLEARANCE = 12;

/**
 * Whether an axis-aligned segment passes within `clearance` of a shape's drawn
 * outline: its rectangle, or its ellipse or diamond grown by `clearance`, so a
 * line never runs tangent to a rounded or pointed node it passes.
 */
function segmentNearOutline(
	segment: AxisAlignedSegment,
	shape: NodeSceneElement,
	clearance: number,
): boolean {
	const horizontal = segment.orientation === "horizontal";
	const [halfAlong, halfAcross] = horizontal
		? [shape.width / 2, shape.height / 2]
		: [shape.height / 2, shape.width / 2];
	const middle = horizontal ? shape.x + halfAlong : shape.y + halfAlong;
	const offset = Math.abs(
		segment.staticCoordinate - (horizontal ? shape.y + halfAcross : shape.x + halfAcross),
	);
	let reach: number;
	if (shape.shape === "ellipse" || shape.shape === "circle") {
		const [along, across] = [halfAlong + clearance, halfAcross + clearance];
		if (offset >= across) return false;
		reach = along * Math.sqrt(1 - (offset / across) ** 2);
	} else if (shape.shape === "diamond") {
		// Each side moves out by the clearance along its normal.
		const grown = 1 + clearance * Math.hypot(1 / halfAlong, 1 / halfAcross);
		if (offset >= halfAcross * grown) return false;
		reach = halfAlong * (grown - offset / halfAcross);
	} else {
		if (offset >= halfAcross + clearance) return false;
		reach = halfAlong + clearance;
	}
	return (
		segment.min < middle + reach - AXIS_ALIGNED_EPSILON &&
		segment.max > middle - reach + AXIS_ALIGNED_EPSILON
	);
}

/** A drawn node a route must keep its clearance from: neither of its own ends, nor a label or frame. */
function keepsClearOf(shape: NodeSceneElement, ignoredNodeIds: ReadonlySet<string>): boolean {
	return shape.id.startsWith("node:") && !ignoredNodeIds.has(shape.nodeId);
}

/** Runs that lie along a drawn node's border, other than its own ends' nodes. */
function routeBorderRunCount(
	points: readonly ScenePoint[],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
): number {
	return segmentsFromPoints(points).filter((segment) =>
		shapes.some(
			(shape) => keepsClearOf(shape, ignoredNodeIds) && segmentAlongBorder(segment, shape),
		),
	).length;
}

/** Whether a run lies on one of a box's sides, overlapping it. */
function segmentAlongBorder(segment: AxisAlignedSegment, box: Box): boolean {
	const horizontal = segment.orientation === "horizontal";
	const [low, size, along, length] = horizontal
		? [box.y, box.height, box.x, box.width]
		: [box.x, box.width, box.y, box.height];
	return (
		(Math.abs(segment.staticCoordinate - low) <= AXIS_ALIGNED_EPSILON ||
			Math.abs(segment.staticCoordinate - low - size) <= AXIS_ALIGNED_EPSILON) &&
		Math.min(segment.max, along + length) - Math.max(segment.min, along) > AXIS_ALIGNED_EPSILON
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

/** Runs of a route that pass within the clearance of a node's outline without crossing it. */
function routeClearanceCount(
	points: readonly ScenePoint[],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
): number {
	let near = 0;
	for (const segment of segmentsFromPoints(points))
		for (const shape of shapes)
			if (
				keepsClearOf(shape, ignoredNodeIds) &&
				!segmentCrossesBoundsInterior(segment, shape) &&
				segmentNearOutline(segment, shape, NODE_CLEARANCE)
			)
				near += 1;
	return near;
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
	return segmentsFromPoints(input.points).map((segment) => {
		const [from, to] = [
			input.points[segment.segmentIndex]!,
			input.points[segment.segmentIndex + 1]!,
		];
		return {
			...segment,
			arrowId: input.arrowId,
			startBindingId: input.sourceNodeId,
			endBindingId: input.targetNodeId,
			from: segment.orientation === "horizontal" ? from.x : from.y,
			to: segment.orientation === "horizontal" ? to.x : to.y,
		};
	});
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
			if (
				candidate.arrowId === existing.arrowId ||
				!segmentsOverlapInterior(candidate, existing) ||
				(route.pinned !== undefined && sharedPinnedStem(candidate, existing))
			) {
				continue;
			}

			overlapCount += 1;
		}
	}

	return overlapCount;
}

/**
 * Stems that leave or reach one node at one point in one direction, as lines
 * pinned to the same port do: the export validator lets them coincide.
 */
function sharedPinnedStem(left: RouteSegment, right: RouteSegment): boolean {
	const departure =
		left.isFirstSegment && right.isFirstSegment && left.startBindingId === right.startBindingId;
	return (
		isSharedBoundStem(left, right) &&
		Math.abs((departure ? left.from : left.to) - (departure ? right.from : right.to)) <=
			AXIS_ALIGNED_EPSILON &&
		Math.sign(left.to - left.from) === Math.sign(right.to - right.from)
	);
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
	/** Lanes a laned layout draws; routes stay inside them, off their headers and boundaries. */
	readonly lanes?: LaneLayout;
	/** Prefer, among otherwise equal routes, one that crosses fewer routed arrows. */
	readonly avoidCrossings?: boolean;
}

/**
 * Arrows routed so far (with reserved stubs), prepared once per edge for scoring
 * candidates. Without a reader scale, candidates are scored as the plain router.
 */
interface RoutedSoFar {
	/** Lines of other arrows a route crosses, for reader-scale scoring. */
	readonly crossings?: CrossingLookup;
	/** Group frame outlines, which routes cross but never run along. */
	readonly outlines: readonly RouteSegment[];
	readonly quality?: ReturnType<typeof candidateRouteQuality>;
	readonly segments: readonly RouteSegment[];
}

function routedSoFar(
	routedArrows: readonly ArrowSceneElement[],
	readerScale: number | undefined,
	avoidCrossings = false,
): RoutedSoFar {
	const arrows = routedArrows.some((arrow) => arrow.id.startsWith(LANE_OUTLINE))
		? routedArrows.filter((arrow) => !arrow.id.startsWith(LANE_OUTLINE))
		: routedArrows;
	return {
		...(readerScale === undefined
			? {}
			: {
					...(avoidCrossings ? { crossings: crossingLookup(arrows) } : {}),
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
		outlines: existingRouteSegments(
			routedArrows.filter((arrow) => arrow.id.startsWith(GROUP_OUTLINE)),
		),
		segments: existingRouteSegments(arrows),
	};
}

/** A straight run of a routed arrow, across which another line would cross it. */
interface CrossingRun {
	readonly arrowId: string;
	/** The coordinate the run keeps: y for a horizontal run, x for a vertical one. */
	readonly at: number;
	readonly max: number;
	readonly min: number;
}

interface CrossingLookup {
	/**
	 * Lines of other arrows that one axis-aligned step crosses. A line exactly at
	 * the step's higher end counts and one at its lower end does not, so a path
	 * of steps counts each line it passes once, whichever way it walks.
	 */
	readonly step: (
		orientation: AxisAlignedSegment["orientation"],
		at: number,
		from: number,
		to: number,
		arrowId: string,
	) => number;
	/** Interior crossings of a whole route with the lines of other arrows. */
	readonly route: (points: readonly ScenePoint[], arrowId: string) => number;
}

/** Crossing counts against routed arrows, sorted once per route so each query reads only nearby runs. */
function crossingLookup(arrows: readonly ArrowSceneElement[]): CrossingLookup {
	const runs: Record<AxisAlignedSegment["orientation"], CrossingRun[]> = {
		horizontal: [],
		vertical: [],
	};
	for (const arrow of arrows) {
		if (arrow.id.startsWith(GROUP_OUTLINE)) continue;
		const points = straightRuns(arrow.points);
		for (let index = 0; index + 1 < points.length; index += 1) {
			const [p, q] = [points[index]!, points[index + 1]!];
			const horizontal = Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON;
			if (!horizontal && Math.abs(p.x - q.x) > AXIS_ALIGNED_EPSILON) continue;
			const [low, high] = horizontal ? [p.x, q.x] : [p.y, q.y];
			if (Math.abs(high - low) <= AXIS_ALIGNED_EPSILON) continue;
			runs[horizontal ? "horizontal" : "vertical"].push({
				arrowId: arrow.id,
				at: horizontal ? p.y : p.x,
				min: Math.min(low, high),
				max: Math.max(low, high),
			});
		}
	}
	for (const list of Object.values(runs)) list.sort((a, b) => a.at - b.at);
	const count = (
		orientation: AxisAlignedSegment["orientation"],
		at: number,
		low: number,
		high: number,
		arrowId: string,
		includeHigh: boolean,
	) => {
		// A step crosses the runs across it whose fixed coordinate it passes.
		const list = runs[orientation === "horizontal" ? "vertical" : "horizontal"];
		let start = 0;
		let end = list.length;
		while (start < end) {
			const middle = (start + end) >> 1;
			if (list[middle]!.at <= low + AXIS_ALIGNED_EPSILON) start = middle + 1;
			else end = middle;
		}
		let crossings = 0;
		for (let index = start; index < list.length; index += 1) {
			const run = list[index]!;
			if (
				includeHigh ? run.at > high + AXIS_ALIGNED_EPSILON : run.at >= high - AXIS_ALIGNED_EPSILON
			)
				break;
			if (
				run.arrowId !== arrowId &&
				at > run.min + AXIS_ALIGNED_EPSILON &&
				at < run.max - AXIS_ALIGNED_EPSILON
			)
				crossings += 1;
		}
		return crossings;
	};
	return {
		step: (orientation, at, from, to, arrowId) =>
			count(orientation, at, Math.min(from, to), Math.max(from, to), arrowId, true),
		route: (points, arrowId) => {
			const corners = straightRuns(points);
			let crossings = 0;
			for (let index = 0; index + 1 < corners.length; index += 1) {
				const [p, q] = [corners[index]!, corners[index + 1]!];
				const horizontal = Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON;
				if (!horizontal && Math.abs(p.x - q.x) > AXIS_ALIGNED_EPSILON) continue;
				const [low, high] = horizontal
					? [Math.min(p.x, q.x), Math.max(p.x, q.x)]
					: [Math.min(p.y, q.y), Math.max(p.y, q.y)];
				crossings += count(
					horizontal ? "horizontal" : "vertical",
					horizontal ? p.y : p.x,
					low,
					high,
					arrowId,
					false,
				);
			}
			return crossings;
		},
	};
}

/** Runs of a route parallel to a frame outline and closer to it than its clearance. */
function routeOutlineBesideCount(
	points: readonly ScenePoint[],
	outlines: readonly RouteSegment[],
): number {
	if (outlines.length === 0) return 0;
	return segmentsFromPoints(points).filter((segment) =>
		outlines.some(
			(edge) =>
				edge.orientation === segment.orientation &&
				Math.abs(edge.staticCoordinate - segment.staticCoordinate) < outlineClearance(edge) &&
				segmentOverlapLength(edge, segment) > GROUP_OUTLINE_CLEARANCE,
		),
	).length;
}

/** How far a route keeps from an outline it runs along: a lane boundary asks for more room. */
function outlineClearance(outline: RouteSegment): number {
	return outline.arrowId.startsWith(LANE_OUTLINE)
		? LANE_OUTLINE_CLEARANCE
		: GROUP_OUTLINE_CLEARANCE;
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
	borders = false,
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
			...(borders ? [routeBorderRunCount(candidate, shapes, ignoredNodeIds)] : []),
			routeSelfOverlapCount(candidate, route),
			routeArrowOverlapCount(candidate, routed.segments, route),
			routeOutlineBesideCount(candidate, routed.outlines),
			quality.corridors,
			quality.arrowheadsCrossed,
			routed.crossings?.route(candidate, `edge:${route.edge.id}`) ?? 0,
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

/** The straight run a line keeps at one end: the end's own when pinned with one. */
function endRunOf(route: RoutedEdge, endpoint: "source" | "target"): number {
	return route.runs?.[endpoint] ?? route.endRun ?? 0;
}

/** An arrival's stub: at least `distance`, and the end run its line keeps. */
function targetStubLength(route: RoutedEdge, point: ScenePoint, distance: number): number {
	return endpointClearance(
		route.target,
		point,
		route.targetEdge,
		Math.max(distance, endRunOf(route, "target")),
	);
}

function sourceStubLength(route: RoutedEdge, point: ScenePoint, distance: number): number {
	// A self-loop's label sits outside its loop, not beside its stub.
	const labelSpace =
		route.edge.label && !isSelfLoop(route)
			? route.sourceEdge === "left" || route.sourceEdge === "right"
				? branchLabelMetrics(route.edge.label, branches(route.source.kind)).width + 16
				: Math.max(
						40,
						branchLabelMetrics(route.edge.label, branches(route.source.kind)).height + 24,
					)
			: 0;
	// A label sits past the end run.
	return endpointClearance(
		route.source,
		point,
		route.sourceEdge,
		Math.max(
			distance,
			endRunOf(route, "source") + Math.min(labelSpace, choiceStubRoom(route, point)),
		),
	);
}

/**
 * How far a choice's departure stub may run before it passes the
 * stub its target arrives by from the facing side, which would force the line
 * to double back. A label longer than that slides along the line instead.
 */
function choiceStubRoom(route: RoutedEdge, point: ScenePoint): number {
	if (route.source.kind !== "choice" || route.targetEdge !== OPPOSITE_EDGE[route.sourceEdge])
		return Infinity;
	const normal = EDGE_NORMAL[route.sourceEdge];
	const axis = normal.x === 0 ? "y" : "x";
	const size = axis === "x" ? "width" : "height";
	const sign = normal[axis];
	// A line that can run straight into its target never doubles back.
	const [across, breadth] = axis === "x" ? (["y", "height"] as const) : (["x", "width"] as const);
	if (
		point[across] >= route.target[across] &&
		point[across] <= route.target[across] + route.target[breadth]
	)
		return Infinity;
	const near = sign > 0 ? route.target[axis] : route.target[axis] + route.target[size];
	const ahead = (near - point[axis]) * sign - ROUTE_STUB_LENGTH - PORT_SPACING;
	return ahead > ROUTE_STUB_LENGTH ? ahead : Infinity;
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
		routes.filter((r) => branches(r.source.kind)).map((r) => r.source),
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
	for (const route of routes.filter((r) => feedback.has(r.edge.id) && !isSelfLoop(r))) {
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
		const sourceCandidates = branches(route.source.kind)
			? [route.sourceEdge, ...candidates]
			: candidates;

		route.targetEdge =
			candidates.find((side) => !departures.has(side) && !targetArrivals.has(side)) ??
			candidates.find((side) => !departures.has(side)) ??
			route.targetEdge;
		route.sourceEdge =
			sourceCandidates.find(
				(side) =>
					!arrivals.has(side) &&
					(!branches(route.source.kind) || !siblingDepartures.has(side)) &&
					(route.source !== route.target || side !== route.targetEdge),
			) ?? route.sourceEdge;
	}
}

/**
 * A self-loop leaves a side across the flow and returns into the side the flow
 * enters by, drawn as a loop around the corner between them: clear of the
 * departures and their labels on the side the flow leaves by. It takes the
 * side across the flow with fewer other ends, and a node's next loop the next
 * free corner.
 */
function assignLoopSides(
	routes: RoutedEdge[],
	directionOf: (route: RoutedEdge) => LayoutDirection,
): void {
	const taken = new Map<string, Set<string>>();
	for (const route of routes.filter(isSelfLoop)) {
		const direction = directionOf(route);
		const entry = OPPOSITE_EDGE[FORWARD_SIDE[direction]];
		const across: readonly ConnectionEdge[] =
			direction === "TB" || direction === "BT" ? ["right", "left"] : ["bottom", "top"];
		const ends = (side: ConnectionEdge) =>
			routes.filter(
				(other) =>
					!isSelfLoop(other) &&
					((other.source === route.source && other.sourceEdge === side) ||
						(other.target === route.source && other.targetEdge === side)),
			).length;
		const lateral = [...across].sort((a, b) => ends(a) - ends(b));
		const corners = [
			...lateral.map((side) => [side, entry] as const),
			...lateral.map((side) => [side, FORWARD_SIDE[direction]] as const),
		];
		const used = taken.get(route.source.nodeId) ?? new Set<string>();
		const [sourceEdge, targetEdge] =
			corners.find(([side, other]) => !used.has(`${side}:${other}`)) ?? corners[0]!;
		used.add(`${sourceEdge}:${targetEdge}`);
		taken.set(route.source.nodeId, used);
		route.sourceEdge = sourceEdge;
		route.targetEdge = targetEdge;
	}
}

/**
 * A return whose transition runs the other way between the same two nodes, with
 * nothing between them, runs back alongside it between the sides they face
 * each other with, so the pair reads as one two-way link. The transition runs
 * on the low side (left or above) and the return on the high side, each label
 * outside the pair.
 */
function assignPairedReturns(
	routes: RoutedEdge[],
	feedback: ReadonlySet<string>,
	nodes: readonly NodeSceneElement[],
	groups: GroupLayout | undefined,
): void {
	for (const route of routes) {
		if (!feedback.has(route.edge.id) || isSelfLoop(route)) continue;
		const forward = routes.find(
			(other) =>
				other.pair === undefined &&
				!feedback.has(other.edge.id) &&
				other.source === route.target &&
				other.target === route.source &&
				other.targetEdge === OPPOSITE_EDGE[other.sourceEdge],
		);
		if (!forward) continue;
		const [from, to] = [center(route.source), center(route.target)];
		const ends = new Set([route.source.nodeId, route.target.nodeId]);
		const owners = new Set(
			[...ends].flatMap((id) => (groups ? groupChain(groups, groups.groupOf.get(id) ?? id) : [id])),
		);
		const between = [
			...nodes.filter((node) => !ends.has(node.nodeId)),
			...(groups?.frames ?? [])
				.filter((frame) => !owners.has(frame.id))
				.map((frame) => obstacleBox(frame.elementId, frame.box)),
		];
		if (between.some((node) => directSegmentCrossesNode(from, to, node))) continue;
		route.sourceEdge = forward.targetEdge;
		route.targetEdge = forward.sourceEdge;
		forward.pair = -1;
		route.pair = 1;
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
	const size = branchLabelMetrics(route.edge.label ?? "", branches(route.source.kind));
	const stub = pointAwayFromEdge(
		start,
		route.sourceEdge,
		sourceStubLength(route, start, ROUTE_STUB_LENGTH),
	);
	const horizontal = route.sourceEdge === "left" || route.sourceEdge === "right";
	if (isSelfLoop(route)) {
		// Outside the loop, beside its outer run: from the stub's tip to the stub
		// of the side it returns into.
		const entry = pointAwayFromEdge(
			pointOnEdge(route.target, route.targetEdge),
			route.targetEdge,
			ROUTE_STUB_LENGTH,
		);
		const outward = EDGE_NORMAL[route.sourceEdge];
		return horizontal
			? { x: stub.x + outward.x * (size.width / 2 + 8), y: (stub.y + entry.y) / 2 }
			: { x: (stub.x + entry.x) / 2, y: stub.y + outward.y * (size.height / 2 + 5) };
	}
	// A label sits above a horizontal stub and right of a vertical one, unless its
	// line is one of a pair, which keeps its label on its own side. It starts past
	// the end run, clear of any end marker.
	const side = labelSideOf(route);
	const from = pointAwayFromEdge(start, route.sourceEdge, endRunOf(route, "source"));
	return {
		x: (from.x + stub.x) / 2 + (horizontal ? 0 : side * (size.width / 2 + 8)),
		y: (from.y + stub.y) / 2 + (horizontal ? side * (size.height / 2 + 5) : 0),
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
			const metrics = branchLabelMetrics(route.edge.label!, branches(route.source.kind));
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

/**
 * The corner each self-loop turns around, from its two ports out past its
 * stubs, as a box every other route keeps out of, so no line runs through the
 * loop or between it and its label.
 */
function loopObstacles(
	routes: readonly RoutedEdge[],
	offsets: ReadonlyMap<string, number>,
): NodeSceneElement[] {
	return routes.filter(isSelfLoop).map((route) => {
		const { start, end } = routeEndpoints(route, offsets);
		const points = [
			start,
			end,
			pointAwayFromEdge(start, route.sourceEdge, sourceStubLength(route, start, ROUTE_STUB_LENGTH)),
			pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, ROUTE_STUB_LENGTH)),
		];
		const box = boundsOf(points.map((point) => ({ ...point, width: 0, height: 0 })));
		return obstacleBox(`loop:${route.edge.id}`, padBox(box, PORT_SPACING / 2));
	});
}

/** Clearance a label box keeps from its own line, and the wider one from other lines. */
const LABEL_LINE_CLEARANCE = 3;
const LABEL_OTHER_LINE_CLEARANCE = 8;
/** Room a label moved off an ambiguous spot keeps from everything, past the usual clearances. */
const LABEL_MOVE_MARGIN = 6;
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

/** Distance from a label box to an axis-aligned segment. */
function boxSegmentDistance(box: LabelBox, segment: AxisAlignedSegment): number {
	const [x0, x1, y0, y1] =
		segment.orientation === "horizontal"
			? [segment.min, segment.max, segment.staticCoordinate, segment.staticCoordinate]
			: [segment.staticCoordinate, segment.staticCoordinate, segment.min, segment.max];
	return Math.hypot(
		Math.max(0, box.x - x1, x0 - box.x - box.width),
		Math.max(0, box.y - y1, y0 - box.y - box.height),
	);
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

/** Whether a label box sits no clearer of another line than of its own: it could belong to either. */
function labelAmbiguous(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
	segments: readonly AxisAlignedSegment[],
): boolean {
	const nearest = (lines: readonly AxisAlignedSegment[]) =>
		Math.min(Infinity, ...lines.map((segment) => boxSegmentDistance(box, segment)));
	return nearest(segments) < nearest(own) + LABEL_OTHER_LINE_CLEARANCE;
}

/**
 * Positions beside the final route, nearest the source first: each axis-aligned
 * run within `LABEL_SLIDE_LENGTH` of the source, on either side, as the stub
 * label sits beside its stub.
 */
function labelSlidePositions(
	points: readonly ScenePoint[],
	size: { width: number; height: number },
	runs: { readonly start: number; readonly end: number } = { start: 0, end: 0 },
): ScenePoint[] {
	const positions: ScenePoint[] = [];
	const total = routeLength(points);
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
			// A label beside a run keeps clear of the end runs and their markers.
			if (
				(runs.start > 0 && travelled + offset - along < runs.start) ||
				(runs.end > 0 && travelled + offset + along > total - runs.end)
			)
				continue;
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

/** The end runs a label keeps clear of, from its line's start and end. */
function labelRuns(route: RoutedEdge | undefined): { start: number; end: number } {
	return route
		? { start: endRunOf(route, "source"), end: endRunOf(route, "target") }
		: { start: 0, end: 0 };
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
	unambiguous = true,
	lanes?: LaneLayout,
): TextSceneElement[] {
	return placedBranchLabels(arrows, routes, shapes, groups, unambiguous, lanes).labels;
}

/** Branch labels placed as drawn, and how many lines, nodes or labels they still touch. */
function placedBranchLabels(
	arrows: ArrowSceneElement[],
	routes: readonly RoutedEdge[],
	shapes: readonly NodeSceneElement[],
	groups?: GroupLayout,
	unambiguous = true,
	lanes?: LaneLayout,
): { labels: TextSceneElement[]; touches: number } {
	const labels: TextSceneElement[] = [];
	let touches = 0;
	const segments = arrows.map((arrow) => segmentsFromPoints(arrow.points));
	// Group names and lane headers are obstacles, and frame outlines and lane
	// boundaries are lines a label keeps clear of.
	const nodes = [
		...shapes,
		...(groups?.frames ?? []).map((frame) =>
			obstacleBox(`group-label:${frame.id}`, frame.labelBox),
		),
		...(lanes?.frames ?? []).map((frame) =>
			obstacleBox(`lane-header:${laneElementId(frame)}`, frame.header),
		),
	];
	const outlines = [
		...(groups?.frames ?? []).flatMap((frame) => frameOutline(frame.box)),
		...(lanes ? laneBoundaries(lanes) : []),
	];
	const placed: { box: LabelBox; index: number }[] = [];
	const sizes = arrows.map((arrow, index) =>
		arrow.label ? branchLabelMetrics(arrow.label, branches(routes[index]?.source.kind)) : undefined,
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
		const lines = [...segments.flatMap((other, at) => (at === index ? [] : other)), ...outlines];
		const conflicts = (position: ScenePoint, margin = 0) =>
			labelConflicts(padBox(labelBox(position, size), margin), segments[index]!, lines, nodes, [
				...others,
				...placed.map((label) => label.box),
			]);
		let position = stub;
		let fewest = conflicts(stub);
		if (fewest > 0)
			for (const candidate of labelSlidePositions(arrow.points, size, labelRuns(routes[index]))) {
				const count = conflicts(candidate);
				if (count < fewest) [position, fewest] = [candidate, count];
				if (fewest === 0) break;
			}
		else if (unambiguous && labelAmbiguous(labelBox(stub, size), segments[index]!, lines))
			// A clear label that could belong to another line moves only to a spot
			// that is plainly its own and clear of everything with room to spare.
			position =
				labelSlidePositions(arrow.points, size, labelRuns(routes[index])).find(
					(candidate) =>
						conflicts(candidate, LABEL_MOVE_MARGIN) === 0 &&
						!labelAmbiguous(labelBox(candidate, size), segments[index]!, lines),
				) ?? stub;
		touches += fewest;
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
			maxWidth: branchLabelMaxWidth(branches(routes[index]?.source.kind)),
			groupIds,
		});
		arrows[index] = { ...arrow, groupIds };
	}
	return { labels, touches };
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

/**
 * Variants of a route whose middle runs that pass too close to a node's
 * outline move just clear of it, to either side of the node. A run moves whole,
 * from turn to turn, so the runs beside it stay straight, and a variant that
 * shortens either endpoint stub or turns it back is not offered.
 */
function runsClearOfOutlines(
	points: readonly [ScenePoint, ...ScenePoint[]],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
): [ScenePoint, ...ScenePoint[]][] {
	const corners = straightRuns(points);
	const variants: [ScenePoint, ...ScenePoint[]][] = [];
	for (const run of segmentsFromPoints(corners)) {
		if (run.isFirstSegment || run.isLastSegment) continue;
		for (const shape of shapes) {
			if (
				!keepsClearOf(shape, ignoredNodeIds) ||
				segmentCrossesBoundsInterior(run, shape) ||
				!segmentNearOutline(run, shape, NODE_CLEARANCE)
			)
				continue;
			const [low, size] =
				run.orientation === "horizontal" ? [shape.y, shape.height] : [shape.x, shape.width];
			for (const lane of [low - NODE_CLEARANCE - 1, low + size + NODE_CLEARANCE + 1]) {
				const moved = corners.map((point, index) =>
					index === run.segmentIndex || index === run.segmentIndex + 1
						? run.orientation === "horizontal"
							? { x: point.x, y: lane }
							: { x: lane, y: point.y }
						: point,
				);
				if (keepsStubs(corners, moved)) variants.push(compactPoints(moved));
			}
		}
	}
	return variants;
}

/** Whether every run of a route is axis-aligned. */
function orthogonalRoute(points: readonly ScenePoint[]): boolean {
	return points.every(
		(point, index) =>
			index === 0 ||
			Math.abs(point.x - points[index - 1]!.x) <= AXIS_ALIGNED_EPSILON ||
			Math.abs(point.y - points[index - 1]!.y) <= AXIS_ALIGNED_EPSILON,
	);
}

/**
 * Whether a moved route stays orthogonal and still leaves and arrives by its
 * stubs: its first and last runs keep their direction and at least the
 * length they had, up to a stub's.
 */
function keepsStubs(route: readonly ScenePoint[], moved: readonly ScenePoint[]): boolean {
	if (moved.length !== route.length || !orthogonalRoute(moved)) return false;
	const stub = (points: readonly ScenePoint[], from: number, to: number) => ({
		dx: points[to]!.x - points[from]!.x,
		dy: points[to]!.y - points[from]!.y,
	});
	const last = route.length - 1;
	return (
		[
			[0, 1],
			[last, last - 1],
		] as const
	).every(([from, to]) => {
		const [before, after] = [stub(route, from, to), stub(moved, from, to)];
		const length = Math.abs(before.dx) + Math.abs(before.dy);
		return (
			Math.sign(after.dx) === Math.sign(before.dx) &&
			Math.sign(after.dy) === Math.sign(before.dy) &&
			Math.abs(after.dx) + Math.abs(after.dy) >=
				Math.min(length, ROUTE_STUB_LENGTH) - AXIS_ALIGNED_EPSILON
		);
	});
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
	crossings?: CrossingLookup,
	borders = false,
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
	const [frameOutlines, laneOutlines] = [false, true].map((lane) =>
		outlineSegments.filter((segment) => segment.arrowId.startsWith(LANE_OUTLINE) === lane),
	);
	const nearOutline =
		frameOutlines!.length > 0
			? segmentOverlapLookup(frameOutlines!, GROUP_OUTLINE_CLEARANCE)
			: undefined;
	const nearLane =
		laneOutlines!.length > 0
			? segmentOverlapLookup(laneOutlines!, LANE_OUTLINE_CLEARANCE)
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
	// The shapes each grid line runs through the interior of, found on the line's
	// first step: a step along a line can cross only those, so it tests no other.
	const through = (lines: readonly number[], axis: "x" | "y") => {
		const size = axis === "x" ? "width" : "height";
		const found: (readonly NodeSceneElement[] | undefined)[] = [];
		// With borders held, a line on a node's side passes along it too.
		const margin = borders ? -AXIS_ALIGNED_EPSILON : AXIS_ALIGNED_EPSILON;
		return (index: number) =>
			(found[index] ??= shapes.filter(
				(shape) =>
					lines[index]! > shape[axis] + margin &&
					lines[index]! < shape[axis] + shape[size] - margin,
			));
	};
	const [throughX, throughY] = [through(xs, "x"), through(ys, "y")];
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
				const lane = step && nearLane ? nearLane(step, arrowId) : undefined;
				edgeCosts.set(
					gridEdge,
					(axis === 0 ? throughY(current.y) : throughX(current.x)).some(
						(shape) =>
							segmentCrossesBoundsInterior(segment, shape) ||
							(borders && shape.id.startsWith("node:") && segmentAlongBorder(segment, shape)),
					) ||
						// Neither the departure nor the arrival may double back over its port stub.
						stubs.some((stub) => segmentsOverlapInterior(segment, stub))
						? undefined
						: Math.abs(next.x - point.x) +
								Math.abs(next.y - point.y) +
								overlaps * 10000 +
								beside * 1000 +
								(outline ? (outline.beside + outline.overlaps) * 1000 : 0) +
								(lane ? (lane.beside + lane.overlaps) * 1000 : 0) +
								(crossings && step
									? crossings.step(
											step.orientation,
											step.staticCoordinate,
											step.min,
											step.max,
											arrowId,
										) * CROSSING_COST
									: 0),
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
	{ avoidCrossings, readerScale, guided, bandOf, groups, lanes: laneLayout }: RouteOptions,
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
				? pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, stubDistance))
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
				? pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, stubDistance))
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
		targetStubLength(route, end, ROUTE_STUB_LENGTH),
	);
	const continuation =
		route.lane === undefined
			? []
			: stubDistances.map((distance) =>
					route.sourceEdge === "top" || route.sourceEdge === "bottom"
						? routeForVerticalLane(route.lane!, distance)
						: routeForHorizontalLane(route.lane!, distance),
				);
	// A pinned line, or a handoff straight across a lane boundary, between facing
	// sides may step across midway, a bend clear of both ports rather than a jog
	// beside one, or on the boundary.
	const facing =
		(route.pinned !== undefined ||
			(laneLayout !== undefined && straightHandoff(route, laneLayout))) &&
		route.targetEdge === OPPOSITE_EDGE[route.sourceEdge];
	const middle =
		route.sourceEdge === "left" || route.sourceEdge === "right"
			? [
					{ x: (startStub.x + endStub.x) / 2, y: startStub.y },
					{ x: (startStub.x + endStub.x) / 2, y: endStub.y },
				]
			: [
					{ x: startStub.x, y: (startStub.y + endStub.y) / 2 },
					{ x: endStub.x, y: (startStub.y + endStub.y) / 2 },
				];
	const candidates = [
		...continuation,
		compactPoints([start, end]),
		compactPoints([start, startStub, { x: startStub.x, y: endStub.y }, endStub, end]),
		compactPoints([start, startStub, { x: endStub.x, y: startStub.y }, endStub, end]),
		...(facing ? [compactPoints([start, startStub, ...middle, endStub, end])] : []),
		...lanes.flatMap(([lane, generator]) =>
			stubDistances.map((distance) => generator(lane, distance)),
		),
	];

	const routed = routedSoFar(existingArrows, readerScale, avoidCrossings);
	// Among zones, a run along a node's border reads as part of the node.
	const strict = groups?.zoned === true;
	const first = chooseBestRoute(candidates, shapes, ignoredNodeIds, route, routed, strict);
	const gap = readerScale === undefined ? 0 : routingCorridorGap(readerScale);
	const best = gap
		? chooseBestRoute(
				[first, ...lanesClearOfNeighbors(first, routed.segments, route, gap)],
				shapes,
				ignoredNodeIds,
				route,
				routed,
				strict,
			)
		: first;
	const corridors = (points: [ScenePoint, ...ScenePoint[]]) =>
		routed.quality?.({
			id: `edge:${route.edge.id}`,
			points,
			sourceId: route.edge.source,
			targetId: route.edge.target,
		}).corridors ?? 0;
	// A run along a node's border, like a corridor, is polish: a bounded search fixes it.
	const border = strict && routeBorderRunCount(best, shapes, ignoredNodeIds) > 0;
	const hard =
		routeNodeCrossingCount(best, shapes, ignoredNodeIds) ||
		routeSelfOverlapCount(best, route) ||
		routeArrowOverlapCount(best, routed.segments, route) ||
		routeOutlineBesideCount(best, routed.outlines);
	// A pinned line that runs out past its target, around everything between, may
	// find a way between the nodes instead.
	const wanders =
		route.pinned !== undefined &&
		routeBacktrackDistance(best) + routeTargetOvershootDistance(best) > 0;
	if (hard || border || corridors(best) || wanders) {
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
			// A corridor or a crossing is polish: search a bounded neighborhood, never the whole grid.
			hard ? Infinity : CORRIDOR_SEARCH_STEPS,
			guided,
			routed.crossings,
			strict,
		);
		if (detour)
			return chooseBestRoute([best, detour], shapes, ignoredNodeIds, route, routed, strict);
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
	fixed: ReadonlyMap<string, ArrowSceneElement> = new Map(),
): ArrowSceneElement[] {
	const labelObstacles = [
		...branchLabelObstacles(routes, portOffsets),
		...loopObstacles(routes, portOffsets),
	];
	const endpointStubs =
		edgeRouting === "orthogonal" ? endpointStubsForRoutes(routes, portOffsets) : [];
	// Frame outlines and lane boundaries are lines routes keep apart from, as from each other.
	const outlines = [...groupOutlineLines(options.groups), ...laneOutlineLines(options.lanes)];
	const lanes = laneObstacles(options.lanes);
	const passage = laneObstacles(options.lanes, true);
	const edgeArrows: ArrowSceneElement[] = [];
	for (const route of order.map((index) => routes[index]!)) {
		const kept = fixed.get(route.edge.id);
		if (kept) {
			edgeArrows.push(kept);
			continue;
		}
		edgeArrows.push(
			arrowForRoute(
				route,
				edgeRouting,
				portOffsets,
				[
					...nodeShapes,
					...labelObstacles.filter(
						(label) =>
							label.nodeId !== `branch-label:${route.edge.id}` &&
							label.nodeId !== `loop:${route.edge.id}`,
					),
					...groupObstacles(options.groups, route),
					...(options.lanes?.continuations.has(route.edge.id) ? passage : lanes),
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
	let defects = exportRouteDefects(arrows, nodeShapes, options.groups, options.lanes);
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
		const retryDefects = exportRouteDefects(retry, nodeShapes, options.groups, options.lanes);
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
		if (feedback.has(route.edge.id) || route.pinned?.target !== undefined) continue;
		const moves =
			trigger === "hooked"
				? routingQualityFindings([{ id: arrow.id, points: arrow.points }], scale).some(
						(finding) => finding.kind === "endpoint-jog" && finding.endpoint === "end",
					)
				: arrows.some(
						(other) =>
							other !== arrow &&
							// Only a crossing between the turns of the final approach moves it.
							pathCrossings(arrow.points, other.points, arrow.points.length - 3, false) > 0,
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
	lanes?: LaneLayout,
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
	const grouped = groups ? [...defects, ...groupRouteDefects(arrows, groups)] : defects;
	return lanes ? [...grouped, ...laneRouteDefects(arrows, lanes)] : grouped;
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
			// A composed shape's end sits on its drawn outline, inside its box: its
			// first step heads in when it closes on the box's middle.
			if (isCanvasComposedShape(node.shape)) {
				const toward = (from: ScenePoint) =>
					Math.max(
						Math.abs(from.x - center(node).x) / (node.width / 2),
						Math.abs(from.y - center(node).y) / (node.height / 2),
					);
				const moved = {
					x: point.x + (next.x - point.x) * step,
					y: point.y + (next.y - point.y) * step,
				};
				if (toward(moved) < toward(point) - 1e-9) inward += 1;
				continue;
			}
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
	lanes?: LaneLayout,
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
	return { hard: exportRouteDefects(arrows, nodes, groups, lanes).length, reader };
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

/**
 * Slide each marker (an initial dot or a final bullseye) across the flow until
 * it lines up with the port its one transition uses at the other end, so the
 * transition runs straight, wherever that spot is clear of every other node
 * and group and inside the marker's own group.
 */
function alignMarkers(
	routes: RoutedEdge[],
	nodes: NodeSceneElement[],
	groups: GroupLayout | undefined,
	portOffsets: ReadonlyMap<string, number>,
): NodeSceneElement[] {
	const moved = new Map<string, NodeSceneElement>();
	for (const marker of nodes) {
		if (markerSize(marker) === undefined) continue;
		const own = routes.filter((route) => route.source === marker || route.target === marker);
		const route = own[0];
		if (own.length !== 1 || !route || isSelfLoop(route)) continue;
		const endpoint = route.source === marker ? "target" : "source";
		const other = route[endpoint];
		const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
		if ((endpoint === "source" ? route.targetEdge : route.sourceEdge) !== OPPOSITE_EDGE[side])
			continue;
		const axis = slotAxis(side);
		const size = axis === "x" ? "width" : "height";
		const port = pointOnEdge(
			other,
			side,
			portOffsets.get(connectionKey({ edgeId: route.edge.id, endpoint })) ?? 0,
		);
		const shifted = { ...marker, [axis]: port[axis] - marker[size] / 2 };
		const room = padBox(shifted, PORT_SPACING);
		const group = groups?.groupOf.get(marker.nodeId);
		const frame = groups?.frames.find((candidate) => candidate.id === group);
		const around = new Set(groups ? groupChain(groups, group) : []);
		const clear =
			nodes.every(
				(node) => node === marker || !boxesOverlap(room, moved.get(node.nodeId) ?? node),
			) &&
			(groups?.frames ?? []).every(
				(candidate) =>
					around.has(candidate.id) ||
					(!boxesOverlap(room, candidate.box) && !boxesOverlap(room, candidate.labelBox)),
			) &&
			(!frame ||
				(room.x >= frame.box.x &&
					room.y >= frame.box.y &&
					room.x + room.width <= frame.box.x + frame.box.width &&
					room.y + room.height <= frame.box.y + frame.box.height));
		if (clear) moved.set(marker.nodeId, shifted);
	}
	if (moved.size === 0) return nodes;
	for (const route of routes) {
		route.source = moved.get(route.source.nodeId) ?? route.source;
		route.target = moved.get(route.target.nodeId) ?? route.target;
	}
	return nodes.map((node) => moved.get(node.nodeId) ?? node);
}

/** The edges that cross a cut of a wrapped zoned level, by edge id. */
function zoneCutEdges(
	diagram: IntermediateDiagram,
	zoneWraps: ReadonlyMap<string, Wrap> | undefined,
): ReadonlySet<string> {
	const structure = zoneWraps ? groupStructure(diagram) : undefined;
	if (!structure || !zoneWraps) return new Set();
	const levels = new Map<string, IntermediateDiagram>([
		[TOP_LEVEL, structure.top],
		...structure.groups.map((level) => [level.group.id, level.diagram] as const),
	]);
	return new Set(
		[...zoneWraps].flatMap(([level, { bandOf }]) =>
			levels
				.get(level)!
				.edges.filter((edge) => (bandOf.get(edge.source) ?? 0) !== (bandOf.get(edge.target) ?? 0))
				.map((edge) => edge.id),
		),
	);
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
	lanes?: LaneLayout;
	nodeShapes: NodeSceneElement[];
	/** The port offsets and route options the arrows were last routed with. */
	portOffsets?: ReadonlyMap<string, number>;
	routeOptions?: RouteOptions;
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
	// Groups make room for labels as they always have; only the drawn labels avoid ambiguity.
	const labels = branchLabels([...edgeArrows], routedEdges, nodeShapes, groups, false);
	const outlines = groups.frames.flatMap((frame) => frameOutline(frame.box));
	for (const label of labels) {
		const arrow = arrows.get(label.id.slice(0, -":label".length));
		const group = arrow ? groups.groupOf.get(arrow.sourceNodeId) : undefined;
		const box = labelBox(label, freeLabelSize(label.text, label.maxWidth ?? 160));
		// A label touching a zone it does not start in crowds that zone too.
		if (groups.zoned)
			for (const frame of groups.frames)
				if (
					frameOutline(frame.box).some((edge) => segmentCrossesBoundsInterior(edge, box)) ||
					boxesOverlap(box, frame.labelBox)
				)
					crowded.add(frame.id);
		if (group === undefined) continue;
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

/** Each node at the box its family placed it in. */
function placedNodes(
	diagram: IntermediateDiagram,
	placement: NonNullable<GraphRenderOptions["placement"]>,
): NodeSceneElement[] {
	return diagram.nodes.map((node) => {
		const box = placement.get(node.id);
		if (!box) throw new Error(`Cannot render node "${node.id}" without a placement.`);
		return { ...createNodeShape(node), x: box.x, y: box.y, width: box.width, height: box.height };
	});
}

/** Pin each anchored end to its side; its offset then overrides any the router computes. */
function pinAnchors(
	routes: readonly RoutedEdge[],
	anchors: ReadonlyMap<string, GraphAnchor>,
): void {
	for (const route of routes)
		for (const endpoint of ["source", "target"] as const) {
			const anchor = anchors.get(connectionKey({ edgeId: route.edge.id, endpoint }));
			if (!anchor) continue;
			if (endpoint === "source") route.sourceEdge = anchor.side;
			else route.targetEdge = anchor.side;
			route.pinned = { ...route.pinned, [endpoint]: anchor.offset };
			if (anchor.run !== undefined) route.runs = { ...route.runs, [endpoint]: anchor.run };
		}
}

function withPinnedOffsets(
	routes: readonly RoutedEdge[],
	offsets: Map<string, number>,
): Map<string, number> {
	for (const route of routes)
		for (const endpoint of ["source", "target"] as const) {
			const offset = route.pinned?.[endpoint];
			if (offset !== undefined)
				offsets.set(connectionKey({ edgeId: route.edge.id, endpoint }), offset);
		}
	return offsets;
}

function layoutDiagramOnce(
	diagram: IntermediateDiagram,
	polish: RoutingPolish,
	arrangement: Arrangement,
	slack: ReadonlyMap<string, number>,
): DiagramLayout {
	const orthogonal = diagram.layout.edgeRouting === "orthogonal";
	const { anchors, endRun, placement } = graphOptions.get(diagram) ?? {};
	const offsetsFor = (routes: readonly RoutedEdge[]) =>
		withPinnedOffsets(
			routes,
			polish.ports
				? alignedPortOffsets(
						routes,
						polish.repair,
						arrangement.crossingRepair,
						laned(diagram) ? LANE_ARRIVAL_SPACING : ARRIVAL_SPACING,
					)
				: portOffsetsForRoutes(routes, polish.repair),
		);
	const { wrap } = arrangement;
	const zoneCuts = zoneCutEdges(diagram, arrangement.zoneWraps);
	let {
		groups,
		lanes,
		nodes: nodeShapes,
	}: PositionedLayout = placement
		? { nodes: placedNodes(diagram, placement) }
		: positionLayout(diagram, new Map(), new Map(), arrangement, slack);
	// Groups laid out across the flow read in their own direction inside.
	const { direction } = diagram.layout;
	// A node reads in its group's direction, and an edge in the direction of the
	// innermost group holding both its ends.
	const turned = (group: string | undefined) =>
		group !== undefined && groups !== undefined && groups.across.has(group);
	const nodeDirection = (nodeId: string) =>
		turned(groups?.groupOf.get(nodeId)) ? ACROSS_DIRECTION[direction] : direction;
	const edgeDirection = (edge: DiagramEdge) =>
		groups && turned(sharedGroup(groups, edge.source, edge.target))
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
	const shapesByNodeId = new Map(
		[...nodeShapes, ...compositeShapes(groups)].map((shape) => [shape.nodeId, shape]),
	);
	const routedEdges = diagram.edges.map((edge, index) =>
		routeForEdge(edge, index, shapesByNodeId, edgeDirection(edge), wrap.continuations.has(edge.id)),
	);
	// A zoned level's band hangs under the steps that reach it: an edge into it
	// leaves forward when its target lies ahead, else toward the band, and turns
	// into it from the side it hangs from.
	for (const route of routedEdges)
		if (zoneCuts.has(route.edge.id)) {
			const { source, target } = route;
			const ahead = {
				LR: target.x >= source.x + source.width,
				RL: target.x + target.width <= source.x,
				TB: target.y >= source.y + source.height,
				BT: target.y + target.height <= source.y,
			}[direction];
			const toward = FORWARD_SIDE[ACROSS_DIRECTION[direction]];
			route.sourceEdge = ahead ? FORWARD_SIDE[direction] : toward;
			route.targetEdge = OPPOSITE_EDGE[toward];
		}
	if (endRun) for (const route of routedEdges) route.endRun = endRun;
	if (lanes) assignLaneSides(routedEdges, lanes);
	const mirrored = orthogonal && polish.ports;
	assignSides(routedEdges, mirrored);
	if (lanes && orthogonal) assignLaneBranchSides(routedEdges, lanes, direction);
	let portOffsets: Map<string, number>;
	let capacity: Map<string, { width: number; height: number }>;
	if (orthogonal) {
		assignLoopSides(routedEdges, (route) => edgeDirection(route.edge));
		assignFeedbackSides(routedEdges, diagram, (route) => edgeDirection(route.edge));
		if (graphOptions.get(diagram)?.pairedReturns)
			assignPairedReturns(routedEdges, flowFeedback(diagram), nodeShapes, groups);
		for (const route of routedEdges) {
			const sides = arrangement.sides?.get(route.edge.id);
			if (sides?.sourceEdge) route.sourceEdge = sides.sourceEdge;
			if (sides?.targetEdge) route.targetEdge = sides.targetEdge;
		}
		if (lanes && arrangement.separateRoles) separateLaneRoles(routedEdges, direction);
		if (anchors) pinAnchors(routedEdges, anchors);
		portOffsets = offsetsFor(routedEdges);
		capacity = portCapacityForRoutes(routedEdges, portOffsets);
	} else {
		const direct = assignDirectFeedbackPorts(routedEdges, diagram, nodeShapes, polish.repair);
		portOffsets = direct.offsets;
		capacity = direct.minimumSizes;
	}
	// A grouped layout always sizes its frames to hold their members' stubs; a
	// placed one keeps the room its family left.
	// A lane keeps room for the lines that turn by its steps; an unlabeled handoff
	// straight across its boundary turns nowhere.
	const reach =
		orthogonal && !placement && (polish.repair || groups || lanes)
			? lanes
				? stubReachForRoutes(
						routedEdges.filter((route) => route.edge.label || !straightHandoff(route, lanes!)),
						portOffsets,
						true,
					)
				: stubReachForRoutes(routedEdges, portOffsets)
			: new Map<string, number>();
	if (!placement && (capacity.size > 0 || reach.size > 0)) {
		({
			groups,
			lanes,
			nodes: nodeShapes,
		} = positionLayout(diagram, capacity, reach, arrangement, slack));
		const resized = new Map(
			[...nodeShapes, ...compositeShapes(groups)].map((node) => [node.nodeId, node]),
		);
		for (const route of routedEdges) {
			route.source = resized.get(route.source.nodeId)!;
			route.target = resized.get(route.target.nodeId)!;
			if (!orthogonal)
				Object.assign(route, connectionEdges(route.source, route.target, diagram.layout.direction));
		}
		if (orthogonal) portOffsets = offsetsFor(routedEdges);
		else {
			if (lanes) assignLaneSides(routedEdges, lanes);
			assignDecisionSides(routedEdges, diagram.layout.direction, mirrored);
			portOffsets = assignDirectFeedbackPorts(
				routedEdges,
				diagram,
				nodeShapes,
				polish.repair,
			).offsets;
		}
	}
	nodeShapes = alignMarkers(routedEdges, nodeShapes, groups, portOffsets);
	if (lanes) assignLaneContinuations(routedEdges, lanes, wrap);
	else assignContinuationLanes(routedEdges, nodeShapes, wrap);

	// Judge jogs and corridors at the size a reader sees the exported diagram.
	const drawn = [...nodeShapes, ...groupBlocks(groups), ...laneBlocks(lanes)];
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
		...(lanes ? { lanes } : {}),
		...(arrangement.avoidCrossings ? { avoidCrossings: true } : {}),
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
				routingDefects(arrows, nodeShapes, scale, groups, lanes),
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
				exportRouteDefects(retry, nodeShapes, groups, lanes).length <=
					exportRouteDefects(edgeArrows, nodeShapes, groups, lanes).length &&
				routesNoWorse(
					{
						edgeArrows: retry,
						...(groups ? { groups } : {}),
						...(lanes ? { lanes } : {}),
						nodeShapes,
					},
					{ edgeArrows, ...(groups ? { groups } : {}), ...(lanes ? { lanes } : {}), nodeShapes },
					true,
					false,
				)
			)
				[edgeArrows, portOffsets] = [retry, offsets];
			else for (const { route, side } of crossed) route.targetEdge = side;
		}
	}
	if (orthogonal && polish.repair)
		edgeArrows = rerouteDefects(edgeArrows, routedEdges, portOffsets, nodeShapes, options);
	return {
		edgeArrows,
		...(groups ? { groups } : {}),
		...(lanes ? { lanes } : {}),
		nodeShapes,
		portOffsets,
		routeOptions: options,
		routedEdges,
	};
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

/**
 * A route's corners alone: a point that continues a straight run is dropped, so
 * a line crossing the route there crosses one run, not the end of two.
 */
function straightRuns(points: readonly ScenePoint[]): ScenePoint[] {
	return points.filter((point, index) => {
		const [before, after] = [points[index - 1], points[index + 1]];
		return (
			!before ||
			!after ||
			!(
				(Math.abs(before.x - point.x) <= AXIS_ALIGNED_EPSILON &&
					Math.abs(point.x - after.x) <= AXIS_ALIGNED_EPSILON) ||
				(Math.abs(before.y - point.y) <= AXIS_ALIGNED_EPSILON &&
					Math.abs(point.y - after.y) <= AXIS_ALIGNED_EPSILON)
			)
		);
	});
}

/**
 * Interior crossings of the axis-aligned segments of `a`, from point `from` on,
 * with those of `b`: of their straight runs, or of each segment as routed when
 * not `runs`, which misses a line crossing where a route runs straight on.
 */
function pathCrossings(
	route: readonly ScenePoint[],
	other: readonly ScenePoint[],
	from = 0,
	runs = true,
): number {
	const a = runs ? straightRuns(route.slice(Math.max(0, from))) : route.slice(Math.max(0, from));
	const b = runs ? straightRuns(other) : other;
	const between = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + AXIS_ALIGNED_EPSILON && value < Math.max(p, q) - AXIS_ALIGNED_EPSILON;
	const horizontal = (p: ScenePoint, q: ScenePoint) =>
		Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON && Math.abs(p.x - q.x) > AXIS_ALIGNED_EPSILON;
	const vertical = (p: ScenePoint, q: ScenePoint) =>
		Math.abs(p.x - q.x) <= AXIS_ALIGNED_EPSILON && Math.abs(p.y - q.y) > AXIS_ALIGNED_EPSILON;
	let crossings = 0;
	for (let i = 0; i < a.length - 1; i += 1)
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

/**
 * Interior crossings between different arrows. Not `runs`, it counts as the
 * arrangements always have, missing a line crossing where a route runs
 * straight on past a point it was routed through.
 */
export function arrowCrossings(arrows: readonly ArrowSceneElement[], runs = true): number {
	return arrows.reduce(
		(sum, arrow, index) =>
			sum +
			arrows
				.slice(index + 1)
				.reduce((pair, other) => pair + pathCrossings(arrow.points, other.points, 0, runs), 0),
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
	jogs = true,
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
		routingQualityFindings(routes, scale).filter(
			(finding) => jogs || finding.kind !== "endpoint-jog",
		).length + routes.filter((route) => quality(route).arrowheadsCrossed > 0).length
	);
}

/**
 * Neither more crossings (or, when `fewerCrossings`, strictly fewer) nor more
 * reader-scale findings, each judged at its own export size, and no newly
 * extreme or longer aspect, unless `narrower` and only narrower. Without
 * `jogs`, a jog beside a port does not count, being minor next to the extreme
 * aspect a zoned wrap removes.
 */
function routesNoWorse(
	candidate: Pick<DiagramLayout, "edgeArrows" | "groups" | "lanes" | "nodeShapes">,
	current: Pick<DiagramLayout, "edgeArrows" | "groups" | "lanes" | "nodeShapes">,
	fewerCrossings = false,
	runs = true,
	narrower = false,
	jogs = true,
): boolean {
	const [crossings, currentCrossings] = [candidate, current].map((layout) =>
		arrowCrossings(layout.edgeArrows, runs),
	);
	const [size, currentSize] = [candidate, current].map((layout) =>
		drawnSize(
			[...layout.nodeShapes, ...groupBlocks(layout.groups), ...laneBlocks(layout.lanes)],
			layout.edgeArrows,
		),
	);
	const [aspect, currentAspect] = [size!, currentSize!].map(({ width, height }) =>
		exportAspect(width, height),
	);
	const longSide = ({ width, height }: { width: number; height: number }) =>
		Math.max(width, height);
	return (
		(fewerCrossings ? crossings! < currentCrossings! : crossings! <= currentCrossings!) &&
		(aspect! < WRAP_ASPECT ||
			aspect! <= currentAspect! + AXIS_ALIGNED_EPSILON ||
			// Narrower without growing longer: its text fits no smaller.
			(narrower && longSide(size!) <= longSide(currentSize!) + AXIS_ALIGNED_EPSILON)) &&
		readerFindingCount(
			candidate.edgeArrows,
			[...candidate.nodeShapes, ...groupBlocks(candidate.groups), ...laneBlocks(candidate.lanes)],
			jogs,
		) <=
			readerFindingCount(
				current.edgeArrows,
				[...current.nodeShapes, ...groupBlocks(current.groups), ...laneBlocks(current.lanes)],
				jogs,
			)
	);
}

/**
 * The drawn layout with each run that passes too close to a node's outline
 * moved just clear of it, where the route stays orthogonal and the move draws
 * no more export defects, crossings, reader-scale findings, inward endpoints
 * or labels touching anything. Runs only after every other choice, so no
 * other route moves.
 */
function clearOutlines(layout: DiagramLayout): DiagramLayout {
	const { groups, lanes, nodeShapes, routedEdges } = layout;
	let arrows = layout.edgeArrows;
	const drawn = [...nodeShapes, ...groupBlocks(groups), ...laneBlocks(lanes)];
	const score = (candidate: readonly ArrowSceneElement[]) => ({
		crossings: arrowCrossings(candidate),
		defects: exportRouteDefects(candidate, nodeShapes, groups, lanes).length,
		findings: readerFindingCount(candidate, drawn),
		inward: inwardEndpoints(candidate, nodeShapes),
		labels: placedBranchLabels([...candidate], routedEdges, nodeShapes, groups, true, lanes)
			.touches,
	});
	let current: ReturnType<typeof score> | undefined;
	for (const [index, arrow] of layout.edgeArrows.entries()) {
		const ends = new Set([arrow.sourceNodeId, arrow.targetNodeId]);
		const near = routeClearanceCount(arrow.points, nodeShapes, ends);
		if (near === 0) continue;
		current ??= score(arrows);
		for (const points of runsClearOfOutlines(arrow.points, nodeShapes, ends)) {
			if (!orthogonalRoute(points) || routeClearanceCount(points, nodeShapes, ends) >= near)
				continue;
			const candidate = arrows.map((other, at) => (at === index ? { ...other, points } : other));
			const next = score(candidate);
			if (
				next.defects <= current.defects &&
				next.crossings <= current.crossings &&
				next.findings <= current.findings &&
				next.inward <= current.inward &&
				next.labels <= current.labels
			) {
				[arrows, current] = [candidate, next];
				break;
			}
		}
	}
	return arrows === layout.edgeArrows ? layout : { ...layout, edgeArrows: arrows };
}

/** Layouts the crossing repair may try beyond the arrangements, each with one side change. */
const CROSSING_MOVES = 6;
/**
 * A layout with more crossings than this is too tangled for side changes to
 * untangle within the moves; the repair leaves it as the arrangements drew it.
 */
const CROSSING_REPAIR_MAX_CROSSINGS = 6;
/** Moves tried around the remaining crossings before the repair gives up on them. */
const ROUND_MOVES = 3;
/** Side changes screened by routing only the edges they touch. */
const SCREENED_MOVES = 24;
/**
 * Routes that hook around one of their own ends: past its stubs, a run passes
 * close beside the node it leaves or enters, on a side other than the one it
 * leaves or enters by.
 */
function hookedRoutes(layout: DiagramLayout): number {
	return layout.edgeArrows.filter((arrow, index) => {
		const route = layout.routedEdges[index]!;
		const runs = segmentsFromPoints(straightRuns(arrow.points)).slice(1, -1);
		return (["source", "target"] as const).some((endpoint) => {
			const node = route[endpoint];
			const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
			return runs.some((run) => {
				const [low, size, alongLow, alongSize] =
					run.orientation === "horizontal"
						? [node.y, node.height, node.x, node.width]
						: [node.x, node.width, node.y, node.height];
				const beside =
					run.staticCoordinate < low
						? low - run.staticCoordinate
						: run.staticCoordinate - low - size;
				const passed: ConnectionEdge =
					run.orientation === "horizontal"
						? run.staticCoordinate < low
							? "top"
							: "bottom"
						: run.staticCoordinate < low
							? "left"
							: "right";
				return (
					passed !== side &&
					beside > 0 &&
					beside < 2 * ROUTE_STUB_LENGTH &&
					run.min < alongLow + alongSize &&
					run.max > alongLow
				);
			});
		});
	}).length;
}

interface SettledLayout {
	readonly arrangement: Arrangement;
	readonly defects: readonly [number, number];
	readonly layout: DiagramLayout;
}

/** Each crossing between two arrows, by arrow index, with where it lies. */
function crossingPairs(
	arrows: readonly ArrowSceneElement[],
): { first: number; second: number; at: ScenePoint }[] {
	const runs = arrows.map((arrow) => straightRuns(arrow.points));
	const pairs: { first: number; second: number; at: ScenePoint }[] = [];
	const between = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + AXIS_ALIGNED_EPSILON && value < Math.max(p, q) - AXIS_ALIGNED_EPSILON;
	for (const [first, a] of runs.entries())
		for (const [offset, b] of runs.slice(first + 1).entries())
			for (let i = 0; i + 1 < a.length; i += 1)
				for (let j = 0; j + 1 < b.length; j += 1) {
					const [p, q, r, u] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
					const [h, v] =
						Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON &&
						Math.abs(r.x - u.x) <= AXIS_ALIGNED_EPSILON
							? [
									[p, q],
									[r, u],
								]
							: Math.abs(p.x - q.x) <= AXIS_ALIGNED_EPSILON &&
								  Math.abs(r.y - u.y) <= AXIS_ALIGNED_EPSILON
								? [
										[r, u],
										[p, q],
									]
								: [];
					if (h && v && between(v[0]!.x, h[0]!.x, h[1]!.x) && between(h[0]!.y, v[0]!.y, v[1]!.y))
						pairs.push({ first, second: first + 1 + offset, at: { x: v[0]!.x, y: h[0]!.y } });
				}
	return pairs;
}

type SideMove = Map<string, { sourceEdge?: ConnectionEdge; targetEdge?: ConnectionEdge }>;

/**
 * Side changes that may remove a crossing between two routes: a loop moved to
 * one side of the flow with both its ends there, the two routes trading sides
 * at a node they share, a decision's branches trading vertices, and each end
 * moved to another side, the end nearest the crossing first. No line leaves or
 * arrives by a side along the flow that faces away from its other end, so none
 * leaves a node backward or arrives from beyond it.
 */
function crossingMoves(
	first: RoutedEdge,
	second: RoutedEdge,
	at: ScenePoint,
	diagram: IntermediateDiagram,
	portOffsets: ReadonlyMap<string, number>,
	routes: readonly RoutedEdge[],
): SideMove[] {
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const along = vertical ? "y" : "x";
	const lateral = (side: ConnectionEdge) => slotAxis(side) === along;
	const mirror = (side: ConnectionEdge) => (lateral(side) ? OPPOSITE_EDGE[side] : side);
	const feedback = flowFeedback(diagram);
	const movable = (route: RoutedEdge) =>
		!isSelfLoop(route) && route.pair === undefined && route.pinned === undefined;
	const sideKey = (endpoint: "source" | "target") =>
		endpoint === "source" ? ("sourceEdge" as const) : ("targetEdge" as const);
	// A side along the flow faces the other end; either side across it will do.
	const natural = (route: RoutedEdge, endpoint: "source" | "target", side: ConnectionEdge) => {
		if (lateral(side)) return true;
		const here = center(route[endpoint])[along];
		const there = center(route[endpoint === "source" ? "target" : "source"])[along];
		return EDGE_NORMAL[side][along] * (there - here) > AXIS_ALIGNED_EPSILON;
	};
	const moves: SideMove[] = [];
	// In lanes an arrival never shares a side with a departure, so a line into a
	// step never reads as leaving it.
	const sideOf = (route: RoutedEdge, endpoint: "source" | "target") =>
		move.get(route.edge.id)?.[sideKey(endpoint)] ?? route[sideKey(endpoint)];
	let move: SideMove = new Map();
	const mixesRoles = () =>
		[...move.keys()].some((id) => {
			const route = routes.find((candidate) => candidate.edge.id === id)!;
			return (["source", "target"] as const).some((endpoint) => {
				const other = endpoint === "source" ? "target" : "source";
				const node = route[endpoint];
				const side = sideOf(route, endpoint);
				return routes.some(
					(candidate) =>
						candidate !== route && candidate[other] === node && sideOf(candidate, other) === side,
				);
			});
		});
	const add = (candidate: SideMove) => {
		move = candidate;
		const valid =
			[...candidate].every(([id, change]) => {
				const route = routes.find((other) => other.edge.id === id)!;
				return (
					natural(route, "source", change.sourceEdge ?? route.sourceEdge) &&
					natural(route, "target", change.targetEdge ?? route.targetEdge)
				);
			}) && !(laned(diagram) && mixesRoles());
		if (valid) moves.push(candidate);
	};
	// A loop runs back along one side of the flow or the other, both ends on that side.
	const sidesAcross: readonly ConnectionEdge[] = vertical ? ["left", "right"] : ["top", "bottom"];
	for (const route of [first, second].filter(movable)) {
		if (!feedback.has(route.edge.id)) continue;
		for (const side of [...sidesAcross].sort((a, b) =>
			a === mirror(route.sourceEdge) ? -1 : b === mirror(route.sourceEdge) ? 1 : 0,
		))
			if (route.sourceEdge !== side || route.targetEdge !== side)
				add(new Map([[route.edge.id, { sourceEdge: side, targetEdge: side }]]));
	}
	if (movable(first) && movable(second))
		for (const a of ["source", "target"] as const)
			for (const b of ["source", "target"] as const) {
				const [sideA, sideB] = [first[sideKey(a)], second[sideKey(b)]];
				if (first[a].nodeId !== second[b].nodeId || sideA === sideB) continue;
				add(
					new Map([
						[first.edge.id, { [sideKey(a)]: sideB }],
						[second.edge.id, { [sideKey(b)]: sideA }],
					]),
				);
			}
	// A decision's branches trade vertices among themselves.
	for (const source of new Set([first, second].map((route) => route.source))) {
		if (!branches(source.kind)) continue;
		const own = routes.filter(
			(route) => route.source === source && movable(route) && !feedback.has(route.edge.id),
		);
		if (own.length < 2 || own.length > 3) continue;
		const permutations = (sides: readonly ConnectionEdge[]): ConnectionEdge[][] =>
			sides.length <= 1
				? [[...sides]]
				: sides.flatMap((side, index) =>
						permutations([...sides.slice(0, index), ...sides.slice(index + 1)]).map((rest) => [
							side,
							...rest,
						]),
					);
		for (const order of permutations(own.map((route) => route.sourceEdge))) {
			const move: SideMove = new Map(
				own.flatMap((route, index) =>
					order[index] === route.sourceEdge ? [] : [[route.edge.id, { sourceEdge: order[index]! }]],
				),
			);
			if (move.size > 0) add(move);
		}
	}
	const ends = [first, second]
		.filter(movable)
		.flatMap((route) =>
			(["source", "target"] as const).map((endpoint) => {
				const { start, end } = routeEndpoints(route, portOffsets);
				const port = endpoint === "source" ? start : end;
				return { endpoint, route, distance: Math.abs(port.x - at.x) + Math.abs(port.y - at.y) };
			}),
		)
		.sort((a, b) => a.distance - b.distance);
	for (const { endpoint, route } of ends) {
		const current = route[sideKey(endpoint)];
		// The side that faces the route's other end first, then its mirror.
		const here = center(route[endpoint]);
		const there = center(route[endpoint === "source" ? "target" : "source"]);
		const facing: ConnectionEdge =
			Math.abs(there.x - here.x) > Math.abs(there.y - here.y)
				? there.x > here.x
					? "right"
					: "left"
				: there.y > here.y
					? "bottom"
					: "top";
		for (const side of new Set([
			facing,
			mirror(current),
			"top",
			"right",
			"bottom",
			"left",
		] as const))
			if (side !== current) add(new Map([[route.edge.id, { [sideKey(endpoint)]: side }]]));
	}
	return moves;
}

/**
 * Crossings a side change would leave if only the routes it touches moved: the
 * moved edges and every edge whose port shifts route again around the others
 * as they lie, then the edges they now cross route again around them. A cheap
 * first look before a move is laid out in full.
 */
function screenedCrossings(settled: SettledLayout, move: SideMove, polish: RoutingPolish): number {
	const { layout } = settled;
	if (!layout.portOffsets || !layout.routeOptions) return 0;
	const routes = layout.routedEdges.map((route) => ({ ...route, ...move.get(route.edge.id) }));
	const offsets = withPinnedOffsets(
		routes,
		polish.ports
			? alignedPortOffsets(
					routes,
					polish.repair,
					settled.arrangement.crossingRepair,
					layout.lanes ? LANE_ARRIVAL_SPACING : ARRIVAL_SPACING,
				)
			: portOffsetsForRoutes(routes, polish.repair),
	);
	const moved = new Set(
		routes.flatMap((route) =>
			move.has(route.edge.id) ||
			(["source", "target"] as const).some((endpoint) => {
				const key = connectionKey({ edgeId: route.edge.id, endpoint });
				return offsets.get(key) !== layout.portOffsets!.get(key);
			})
				? [route.edge.id]
				: [],
		),
	);
	// The routes kept as they lie come first; the rerouted ones avoid them in edge order.
	const reroute = (arrows: readonly ArrowSceneElement[], again: ReadonlySet<string>) => {
		const fixed = new Map(
			arrows.flatMap((arrow) => (again.has(arrow.edgeId) ? [] : [[arrow.edgeId, arrow] as const])),
		);
		const order = routes
			.map((route, index) => ({ index, again: again.has(route.edge.id) }))
			.sort((a, b) => Number(a.again) - Number(b.again))
			.map(({ index }) => index);
		return routeAllEdges(
			routes,
			"orthogonal",
			offsets,
			layout.nodeShapes,
			{ ...layout.routeOptions!, avoidCrossings: true },
			order,
			fixed,
		);
	};
	const first = reroute(layout.edgeArrows, moved);
	const crossed = new Set(
		crossingPairs(first).flatMap(({ first: a, second: b }) => {
			const [left, right] = [routes[a]!.edge.id, routes[b]!.edge.id];
			return moved.has(left) === moved.has(right) ? [] : [moved.has(left) ? right : left];
		}),
	);
	if (crossed.size === 0) return arrowCrossings(first);
	return Math.min(arrowCrossings(first), arrowCrossings(reroute(first, crossed)));
}

/**
 * Crossings the arrangements leave: try side changes near each crossing and
 * keep one when the layout then routes with strictly fewer crossings and is
 * otherwise no worse, until no crossing is left or the moves run out.
 */
function repairCrossings(
	diagram: IntermediateDiagram,
	polish: RoutingPolish,
	settled: SettledLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): SettledLayout {
	let best = settled;
	const tried = new Set<string>();

	let [layouts, screens] = [CROSSING_MOVES, SCREENED_MOVES];
	for (let improved = true; improved && layouts > 0;) {
		improved = false;
		const crossings = arrowCrossings(best.layout.edgeArrows);
		const moves = crossingPairs(best.layout.edgeArrows).flatMap(({ first, second, at }) =>
			crossingMoves(
				best.layout.routedEdges[first]!,
				best.layout.routedEdges[second]!,
				at,
				diagram,
				best.layout.portOffsets ?? new Map(),
				best.layout.routedEdges,
			),
		);
		let round = ROUND_MOVES;
		for (const move of moves) {
			if (layouts === 0 || round === 0 || screens === 0) break;
			const sides = new Map(best.arrangement.sides);
			for (const [id, change] of move) sides.set(id, { ...sides.get(id), ...change });
			const key = JSON.stringify([...sides].sort(([a], [b]) => (a < b ? -1 : 1)));
			if (tried.has(key)) continue;
			tried.add(key);
			screens -= 1;
			if (screenedCrossings(best, move, polish) >= crossings) continue;
			[layouts, round] = [layouts - 1, round - 1];
			const arrangement = { ...best.arrangement, sides, avoidCrossings: true };
			const layout = layoutDiagram(diagram, polish, arrangement);
			const defects = defectsOf(layout);
			if (
				!fewer(best.defects, defects) &&
				routesNoWorse(layout, best.layout, true, true, true) &&
				hookedRoutes(layout) <= hookedRoutes(best.layout)
			) {
				best = { arrangement, defects, layout };
				improved = true;
				break;
			}
		}
	}
	return best;
}

/** Shapes each marker kind draws as: a final's core is the filled dot inside its ring. */
const MARKER_SHAPES: Readonly<Record<string, NodeSceneShape>> = {
	initial: "circle",
	final: "circle",
	"final-core": "circle",
	choice: "diamond",
};

/** What each marker is, for readers of the scene; markers never draw it. */
const MARKER_NAMES: Readonly<Record<string, string>> = {
	initial: "Initial state",
	final: "Final state",
	"final-core": "Final state",
	choice: "Choice",
};

/**
 * A state marker keeps its role while it still reads as one: a marker kind in
 * its own shape, without an icon. A choice grows with its branches, so its
 * size never decides.
 */
export function isStructurallyValidStateMarker(element: {
	readonly icon?: unknown;
	readonly kind?: string;
	readonly shape: string;
}): boolean {
	return (
		element.kind !== undefined &&
		MARKER_SHAPES[element.kind] === element.shape &&
		element.icon === undefined
	);
}

/** A final bullseye's filled core: a fifth of its ring's edge from the ring. */
const FINAL_CORE_INSET = 6;

/**
 * Draw a pseudostate as a marker: the initial dot filled, the final bullseye a
 * ring with a filled core grouped to it, a choice an empty diamond. A marker
 * draws no label; its name stays on the shape. Other nodes draw as laid out.
 */
function drawnMarker(shape: NodeSceneElement, accent: string): NodeSceneElement[] {
	if (shape.label) return [shape];
	const marker = {
		...shape,
		label: MARKER_NAMES[shape.kind ?? ""] ?? "Marker",
		rendererRole: "state-marker" as const,
	};
	if (shape.kind === "initial") return [{ ...marker, fillColor: accent, fillStyle: "solid" }];
	if (shape.kind !== "final") return [marker];
	const groupIds = [`marker:${shape.nodeId}`, ...(shape.groupIds ?? [])];
	return [
		{ ...marker, groupIds },
		{
			...marker,
			id: `${shape.id}:core`,
			nodeId: `${shape.nodeId}:core`,
			kind: "final-core",
			groupIds,
			x: shape.x + FINAL_CORE_INSET,
			y: shape.y + FINAL_CORE_INSET,
			width: shape.width - 2 * FINAL_CORE_INSET,
			height: shape.height - 2 * FINAL_CORE_INSET,
			fillColor: accent,
			fillStyle: "solid",
		},
	];
}

/** A lane header's fill: the Sketchi paper tone, so the strip reads apart from the lane. */
const LANE_HEADER_FILL = "#f6f1e7";

/**
 * Each lane as locked shapes under the diagram: its band, its header strip and
 * the header's name. Locked, they stay put while steps move across them in the
 * editor, and a click on a lane selects nothing.
 */
function laneElements(lanes: LaneLayout): (NodeSceneElement | TextSceneElement)[] {
	return lanes.frames.flatMap((frame): (NodeSceneElement | TextSceneElement)[] => {
		const id = laneElementId(frame);
		const header: NodeSceneElement = {
			type: "node",
			id: `${id}:header`,
			nodeId: `${id}:header`,
			kind: "lane-header",
			rendererRole: "swimlane-header",
			shape: "rectangle",
			...frame.header,
			label: frame.text,
			fillColor: LANE_HEADER_FILL,
			fillStyle: "solid",
			roughness: 0,
			strokeWidth: 1,
			locked: true,
		};
		return [
			{
				type: "node",
				id,
				nodeId: id,
				kind: "lane",
				rendererRole: "swimlane",
				shape: "rectangle",
				...frame.box,
				label: frame.label,
				// Crisp, thin lines: neighbors share one boundary, and the steps read first.
				roughness: 0,
				strokeWidth: 1,
				locked: true,
			},
			header,
			{
				type: "text",
				id: `${id}:label`,
				containerId: header.id,
				x: header.x + header.width / 2,
				y: header.y + header.height / 2,
				text: frame.text,
				fontSize: LANE_LABEL_FONT_SIZE,
				maxWidth: Math.max(1, header.width - 2 * LANE_HEADER_PADDING),
				locked: true,
			},
		];
	});
}

/** A zone label's ink: quieter than the steps, which read first. */
const ZONE_LABEL_COLOR = "#4c4639";
/** Fills that set a subnet or a namespace apart from the zone around it. */
const ZONE_FILL: Readonly<Partial<Record<DiagramZoneKind, string>>> = {
	subnet: "#f6f1e7",
	namespace: "#efe6ec",
};

/**
 * How each kind of zone draws: outer boundaries (a cloud or a data center) in
 * dark ink, a region dashed, an availability or network zone dotted, a VPC or
 * a cluster in a heavier line, and a subnet or a namespace filled.
 */
function zoneStyle(
	kind: DiagramZoneKind | undefined,
	accent: string,
): Pick<
	NodeSceneElement,
	"fillColor" | "fillStyle" | "strokeColor" | "strokeStyle" | "strokeWidth"
> {
	const fill = kind === undefined ? undefined : ZONE_FILL[kind];
	return {
		strokeColor: kind === "cloud" || kind === "datacenter" ? ZONE_LABEL_COLOR : accent,
		strokeStyle:
			kind === "cloud" || kind === "region" || kind === "namespace"
				? "dashed"
				: kind === "zone"
					? "dotted"
					: "solid",
		strokeWidth:
			kind === "cloud" || kind === "datacenter" || kind === "vpc" || kind === "cluster" ? 2 : 1,
		...(fill ? { fillColor: fill, fillStyle: "solid" as const } : {}),
	};
}

/**
 * Each zone as locked shapes under the diagram, outermost first: its outline,
 * styled by its kind, and its label at the left of the header strip across its
 * top. Locked, they stay put while steps move across them in the editor.
 */
function zoneElements(
	groups: GroupLayout,
	accent: string,
): (NodeSceneElement | TextSceneElement)[] {
	return groups.frames.flatMap((frame): (NodeSceneElement | TextSceneElement)[] => {
		const maxWidth = Math.max(1, frame.box.width - 2 * ZONE_LABEL_INSET);
		return [
			{
				type: "node",
				id: frame.elementId,
				nodeId: frame.elementId,
				kind: frame.kind ?? "zone",
				rendererRole: "zone",
				shape: "rectangle",
				...frame.box,
				label: frame.label,
				...zoneStyle(frame.kind, accent),
				roughness: 0,
				locked: true,
			},
			{
				type: "text",
				id: `zone-label:${frame.id}`,
				x:
					frame.box.x +
					ZONE_LABEL_INSET +
					boundLabelWidth(frame.label, ZONE_LABEL_FONT_SIZE, maxWidth) / 2,
				y: frame.box.y + ZONE_HEADER / 2,
				text: frame.label,
				fontSize: ZONE_LABEL_FONT_SIZE,
				maxWidth,
				textAlign: "left",
				textColor: ZONE_LABEL_COLOR,
				locked: true,
			},
		];
	});
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
			// Edges into and out of a composite bind to its frame.
			...(groups.composites.has(frame.id) ? { nodeId: frame.id } : {}),
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

/** A point on a node's side a line's end is pinned to: its offset from the middle of that side. */
export interface GraphAnchor {
	readonly side: "top" | "right" | "bottom" | "left";
	readonly offset: number;
	/**
	 * This end's straight run, in place of `endRun`. Lines that share a port take
	 * different runs, so each leaves the shared stem at a point of its own.
	 */
	readonly run?: number;
}

/** Choices a family's renderer makes for its graph; flowcharts and mindmaps make none. */
export interface GraphRenderOptions {
	/**
	 * Draw an edge and its return between the same two nodes as a parallel pair
	 * (orthogonal routing), as state machines draw a transition and its return.
	 */
	readonly pairedReturns?: boolean;
	/**
	 * The family's own placement, each node's box by node id, drawn as given: the
	 * router only routes. The family leaves room between nodes for the lines.
	 */
	readonly placement?: ReadonlyMap<
		string,
		{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }
	>;
	/**
	 * Line ends pinned to a point, by `<edgeId>:source` or `<edgeId>:target`
	 * (orthogonal routing). Ends pinned to the same point share their stub.
	 */
	readonly anchors?: ReadonlyMap<string, GraphAnchor>;
	/**
	 * Straight run every line keeps at each end before it turns or carries its
	 * label, so markers drawn at its ends (crow's feet) sit on a straight line.
	 */
	readonly endRun?: number;
}

const graphOptions = new WeakMap<IntermediateDiagram, GraphRenderOptions>();

export function renderIntermediateDiagram(input: unknown): RenderedDiagramScene {
	return renderGraphDiagram(parseIntermediateDiagram(input));
}

/**
 * Lay out and route an already validated graph. Families that build their own
 * graph call this directly: a state machine's graph has self-loops, edges that
 * start or end at a group (a composite state) and nodes without labels (its
 * pseudostates), which the graph contract alone does not accept.
 */
export function renderGraphDiagram(
	diagram: IntermediateDiagram,
	options: GraphRenderOptions = {},
): RenderedDiagramScene {
	graphOptions.set(diagram, options);
	// Export defects come first; inward endpoints only break ties.
	const defectsOf = (attempt: DiagramLayout) =>
		[
			exportRouteDefects(attempt.edgeArrows, attempt.nodeShapes, attempt.groups, attempt.lanes)
				.length,
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
	// A placed graph keeps its family's arrangement.
	const arranged = options.placement === undefined;
	// Another arrangement is tried at full polish only, and kept when it has no more
	// defects and routes no worse (or, `fewerCrossings`, with strictly fewer crossings).
	const consider = (arrangement: Arrangement, fewerCrossings: boolean) => {
		const layout = layoutDiagram(diagram, levels[0]!, arrangement);
		const defects = defectsOf(layout);
		if (!fewer(best.defects, defects) && routesNoWorse(layout, best.layout, fewerCrossings, false))
			best = { arrangement, defects, layout };
	};
	const orthogonal = diagram.layout.edgeRouting === "orthogonal";
	// Crossing repairs are tried only where the polished router crossed: arrival
	// order and moved arrivals stay when they route no worse, and reordered ranks
	// only when they route with fewer crossings.
	const repairable = arranged && orthogonal && diagram.edges.length <= CROSSING_REPAIR_MAX_EDGES;
	if (repairable && arrowCrossings(best.layout.edgeArrows, false) > 0)
		consider({ ...best.arrangement, crossingRepair: true }, false);
	if (repairable && arrowCrossings(best.layout.edgeArrows, false) > 0 && reordersRanks(diagram))
		consider({ ...best.arrangement, reorder: true }, true);
	// A flow too long for its breadth wraps when the wrapped layout routes no worse.
	// Its size includes the branch labels, as the exported PNG does.
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const lengthOf = (layout: DiagramLayout) => {
		const size = drawnSize(
			[...layout.nodeShapes, ...groupBlocks(layout.groups), ...laneBlocks(layout.lanes)],
			layout.edgeArrows,
			[
				...branchLabels(
					[...layout.edgeArrows],
					layout.routedEdges,
					layout.nodeShapes,
					layout.groups,
					false,
					layout.lanes,
				),
			],
		);
		const [along, across] = vertical ? [size.height, size.width] : [size.width, size.height];
		const aspect = (along + 2 * EXPORT_PADDING) / (across + 2 * EXPORT_PADDING);
		const fittedText =
			(NODE_LABEL_FONT_SIZE * FITTED_LONG_SIDE) / (Math.max(along, across) + 2 * EXPORT_PADDING);
		return {
			aspect,
			// A column short of 4:1 whose text stays readable wraps only into even columns.
			balance:
				vertical && aspect < WRAP_EXTREME_ASPECT && fittedText >= WRAP_MIN_COLUMN_TEXT
					? WRAP_COLUMN_BALANCE
					: 0,
			size,
			tooLong:
				aspect >= WRAP_EXTREME_ASPECT ||
				(aspect >= WRAP_ASPECT && (vertical || along >= WRAP_MIN_LENGTH)),
		};
	};
	const { aspect, balance, tooLong } = lengthOf(best.layout);
	// Lanes wrap into pools only past the extreme aspect: a pool split apart reads
	// worse than one long pool.
	const wrap =
		arranged && orthogonal && tooLong
			? laned(diagram)
				? aspect >= WRAP_EXTREME_ASPECT
					? planLaneWrap(diagram)
					: NO_WRAP
				: planWrap(diagram, best.arrangement.reorder, balance)
			: NO_WRAP;
	// A wrapped layout may need crossing repairs of its own; it tries them first.
	for (const crossingRepair of repairable && !best.arrangement.crossingRepair
		? [true, false]
		: [best.arrangement.crossingRepair]) {
		if (wrap.continuations.size === 0 || best.arrangement.wrap === wrap) break;
		consider({ ...best.arrangement, crossingRepair, wrap }, false);
	}
	// A grouped flow never wraps, since a band cut would split a group; a long one
	// lays its groups across the flow instead, when that routes no worse.
	// Zones never do: across the flow, a zone's members would contradict the
	// direction the diagram states.
	const structure = groupStructure(diagram);
	const groupsAcross =
		arranged && orthogonal && tooLong && structure !== undefined && !structure.zoned;
	for (const crossingRepair of repairable && !best.arrangement.crossingRepair
		? [true, false]
		: [best.arrangement.crossingRepair]) {
		if (!groupsAcross || best.arrangement.groupsAcross) break;
		consider({ ...best.arrangement, crossingRepair, groupsAcross: true }, false);
	}
	// A zoned flow wraps instead, level by level, each band reading in the stated
	// direction (planZoneWraps). Of the plans that route no worse, the first with
	// no more crossings or reader findings than before is kept, else the one with
	// the fewest crossings, then findings, then the squarest; one still too long
	// plans again from the wrap it kept.
	const zoneScore = (layout: DiagramLayout) => [
		arrowCrossings(layout.edgeArrows, false),
		readerFindingCount(layout.edgeArrows, [...layout.nodeShapes, ...groupBlocks(layout.groups)]),
		lengthOf(layout).aspect,
	];
	const lower = (left: readonly number[], right: readonly number[]) => {
		const index = left.findIndex((value, at) => value !== right[at]);
		return index >= 0 && left[index]! < right[index]!;
	};
	for (
		let round = 0;
		round < ZONE_WRAP_ROUNDS && arranged && orthogonal && structure?.zoned;
		round += 1
	) {
		const length = lengthOf(best.layout);
		if (!length.tooLong) break;
		const kept = best;
		let chosen: (typeof best & { score: number[] }) | undefined;
		for (const zoneWraps of planZoneWraps(
			diagram,
			structure,
			kept.arrangement,
			length.balance,
			length.size,
		)) {
			const arrangement = {
				...kept.arrangement,
				crossingRepair: repairable || kept.arrangement.crossingRepair,
				zoneWraps,
			};
			const layout = layoutDiagram(diagram, levels[0]!, arrangement);
			const defects = defectsOf(layout);
			if (
				fewer(kept.defects, defects) ||
				!routesNoWorse(layout, kept.layout, false, false, false, false)
			)
				continue;
			const score = zoneScore(layout);
			if (!chosen || lower(score, chosen.score)) chosen = { arrangement, defects, layout, score };
			// A plan with no more crossings or reader findings than before needs no rival.
			const [crossings, findings] = zoneScore(kept.layout);
			if (score[0]! <= crossings! && score[1]! <= findings!) break;
		}
		if (!chosen) break;
		best = chosen;
	}
	// In lanes a step takes lines in and sends them out by different sides, when
	// that routes no worse.
	if (arranged && orthogonal && laned(diagram))
		consider({ ...best.arrangement, separateRoles: true }, false);
	// Crossings the arrangements leave are repaired where few enough to untangle.
	const crossings = arrowCrossings(best.layout.edgeArrows);
	if (repairable && crossings > 0 && crossings <= CROSSING_REPAIR_MAX_CROSSINGS)
		best = repairCrossings(diagram, levels[0]!, best, defectsOf, fewer);
	const layout = orthogonal ? clearOutlines(best.layout) : best.layout;
	const { groups, lanes, routedEdges } = layout;
	const routedArrows = [...layout.edgeArrows];
	const drawn = {
		arrows: routedArrows,
		frames: [] as FrameSceneElement[],
		labels: [
			// Pseudostates draw no label.
			...layout.nodeShapes.filter((shape) => shape.label).map(textForNode),
			...branchLabels(routedArrows, routedEdges, layout.nodeShapes, groups, true, lanes),
		],
		nodes: layout.nodeShapes,
	};
	const framed = groups && !groups.zoned ? withGroupFrames(groups, drawn) : drawn;
	const { arrows: edgeArrows, frames, labels } = framed;
	const nodeShapes = framed.nodes.flatMap((shape) => drawnMarker(shape, diagram.style.accentColor));
	// Lanes sit under everything, each band, then its header and the header's name;
	// zones likewise, outermost first, each outline then its label.
	const lane = lanes
		? laneElements(lanes)
		: groups?.zoned
			? zoneElements(groups, diagram.style.accentColor)
			: [];
	const elements = normalizeSceneOrigin([
		...lane,
		...frames,
		...edgeArrows,
		...nodeShapes,
		...labels,
	]);
	const bounds = sceneBounds(elements);
	const zOrder = [
		...lane.map((element) => element.id),
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
