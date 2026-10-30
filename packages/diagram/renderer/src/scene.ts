import {
	CANVAS_NODE_ICON,
	CANVAS_SPEC_VERSION,
	AXIS_ALIGNED_EPSILON,
	canvasBoundTextBox,
	canvasCornerRadius,
	canvasNodeIconBand,
	type AxisAlignedSegment,
	CANVAS_FRAME_NAME,
	CANVAS_GROUP_ICON,
	CANVAS_SHAPE_CURVE,
	CANVAS_ZONE_HEADER,
	canvasGroupIconBox,
	canvasGroupIconRun,
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
	type GraphNode,
	boundLabelWidth,
	estimateTextWidth,
	wrapTextToWidth,
	wrappedLabelWidth,
	type IntermediateDiagram,
	parseIntermediateDiagram,
	arrowheadsNear,
	candidateRouteQuality,
	routingCorridorGap,
	routingJogReach,
	routingQualityFindings,
	routingQualityScale,
	routingWideBend,
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
/** Excalidraw draws an arrowhead this long, at most half its final run. */
const ARROWHEAD_LENGTH = 25;
/** Its wings fan 20 degrees off its line. */
const ARROWHEAD_WING = (20 * Math.PI) / 180;
/** Grid-search expansions spent looking for a lane clear of a near-parallel neighbor. */
const CORRIDOR_SEARCH_STEPS = 5_000;
/** Grid-search cost of crossing another arrow: a detour this much longer reads better. */
const CROSSING_COST = 320;

type ConnectionEdge = "top" | "right" | "bottom" | "left";

interface RoutedEdge {
	edge: DiagramEdge;
	index: number;
	/**
	 * A wrap continuation's lane between its bands: a line along the flow at `at`
	 * across it, `vertical` when the flow runs down the page.
	 */
	lane?: { readonly at: number; readonly vertical: boolean };
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
 * Smallest container whose Excalidraw bound-text box holds text of this size:
 * a label and any logo band, or a label centered between its description and
 * logo bands. Excalidraw re-wraps an edited label to this box (half the width
 * of a diamond, the inscribed rectangle of an ellipse), so sizing to it keeps
 * the stored wrap and the logo clear after editing.
 */
function boundTextContainerSize(
	shape: NodeSceneShape,
	textWidth: number,
	textHeight: number,
): { readonly height: number; readonly width: number } {
	const padding = CANVAS_NODE_ICON.boundTextPadding * 2;
	const scale =
		shape === "diamond" ? 2 : shape === "ellipse" || shape === "circle" ? Math.SQRT2 : 1;
	let width = Math.ceil((textWidth + padding) * scale);
	let height = Math.ceil((textHeight + padding) * scale);
	// Excalidraw rounds its text box, which can land just under the closed-form
	// size; grow until the rounded box itself holds the text.
	while (canvasBoundTextBox({ height, shape, width }).width < textWidth) {
		width += 1;
	}
	while (canvasBoundTextBox({ height, shape, width }).height < textHeight) {
		height += 1;
	}
	return { width, height };
}

/**
 * A node's description draws as a smaller, muted subtitle under its label. The
 * label stays centered, as Excalidraw keeps a bound label, so the node holds a
 * band as deep as the description's (or its logo's, if deeper) on both sides.
 */
const NODE_DESCRIPTION_FONT_SIZE = 12;
const NODE_DESCRIPTION_LINE_HEIGHT = 1.25;
const NODE_DESCRIPTION_COLOR = "#5f574c";
/** Space between a label and its description, and under the description. */
const NODE_DESCRIPTION_GAP = 2;
const NODE_DESCRIPTION_CLEARANCE = 4;
/**
 * Lines a description wraps in before its node widens, up to its shape's
 * limit: two in a box, one in a diamond or an ellipse, which pay for a line in
 * width as well as height.
 */
function descriptionLines(shape: NodeSceneShape): number {
	return shape === "diamond" || shape === "ellipse" || shape === "circle" ? 1 : 2;
}
/** At the widest a description may run to this many lines before its build warns. */
export const NODE_DESCRIPTION_MAX_LINES = 3;
/**
 * Widest description text per shape: a box keeps its node within 300 px. A
 * diamond holds its text in half its width and height, and an ellipse in its
 * inscribed box, so every extra line costs them two or three times its height;
 * they widen further, to about 500 and 380 px, before wrapping another line.
 */
const NODE_DESCRIPTION_MAX_WIDTH: Readonly<Record<NodeSceneShape, number>> = {
	bucket: 220,
	circle: 260,
	cylinder: 264,
	diamond: 240,
	document: 264,
	ellipse: 260,
	pipe: 240,
	polygon: 264,
	rectangle: 264,
};

interface DescriptionMetrics {
	readonly text: string;
	readonly lines: number;
	readonly width: number;
	readonly height: number;
}

function descriptionUnits(width: number): number {
	return Math.floor((width * 100) / NODE_DESCRIPTION_FONT_SIZE);
}

/**
 * Wrap a description at whole words to its node's label width, or wider, up to
 * its shape's limit, when that keeps it to its shape's lines. It depends only on the
 * text and the shape, so layout and drawing wrap it alike.
 */
function measureDescription(description: string, shape: NodeSceneShape): DescriptionMetrics {
	const labelUnits = shape === "diamond" ? MAX_DIAMOND_LABEL_LINE_UNITS : MAX_LABEL_LINE_UNITS;
	const base = descriptionUnits((labelUnits * NODE_LABEL_FONT_SIZE) / 100);
	const limit = descriptionUnits(NODE_DESCRIPTION_MAX_WIDTH[shape]);
	const lineCount = (text: string) => text.split("\n").length;
	let text = wrapTextToUnits(description, base);
	for (let units = base; lineCount(text) > descriptionLines(shape) && units < limit;) {
		units = Math.min(limit, units + DEFAULT_GLYPH_UNITS);
		text = wrapTextToUnits(description, units);
	}
	const lines = lineCount(text);
	return {
		text,
		lines,
		width: estimateTextWidth(text, NODE_DESCRIPTION_FONT_SIZE),
		height: Math.ceil(lines * NODE_DESCRIPTION_FONT_SIZE * NODE_DESCRIPTION_LINE_HEIGHT),
	};
}

/** Depth of the band on each side of a described node's centered label. */
function descriptionBand(description: DescriptionMetrics, icon: CanvasNodeIcon | undefined) {
	return Math.max(
		canvasNodeIconBand(icon),
		NODE_DESCRIPTION_GAP + description.height + NODE_DESCRIPTION_CLEARANCE,
	);
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
	node: GraphNode,
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
	const labelUnits = shape === "diamond" ? MAX_DIAMOND_LABEL_LINE_UNITS : lineUnits;
	const labelMetrics = measureLabel(node.label, labelUnits);
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
	const [minWidth, minHeight] =
		node.kind === "state" ? [STATE_MIN_WIDTH, STATE_MIN_HEIGHT] : [minimumWidth, MIN_NODE_HEIGHT];
	if (node.description) {
		// Every described node fits Excalidraw's edit-time text box: its centered
		// label between two bands, the lower holding the description.
		const description = measureDescription(node.description, shape);
		// The node is as wide as its description, so its label wraps no narrower.
		const label = measureLabel(
			node.label,
			Math.max(labelUnits, Math.floor((description.width * 100) / NODE_LABEL_FONT_SIZE)),
		);
		const textWidth = Math.max(label.textWidth, description.width);
		const boundText = boundTextContainerSize(
			shape,
			textWidth,
			label.textHeight + 2 * descriptionBand(description, icon),
		);
		return {
			type: "node",
			id: `node:${node.id}`,
			nodeId: node.id,
			...(node.kind ? { kind: node.kind } : {}),
			...(icon ? { icon } : {}),
			shape,
			x: 0,
			y: 0,
			width: Math.max(
				minWidth,
				Math.ceil(textWidth + NODE_LABEL_HORIZONTAL_PADDING) + shapeWidthPad,
				boundText.width,
			),
			height: Math.max(minHeight, boundText.height),
			label: label.text,
		};
	}
	// Logo nodes, diamonds and composed shapes must fit Excalidraw's edit-time
	// text box; other plain nodes keep their padded label box, which already
	// contains it.
	const boundText =
		icon || shape === "diamond" || curve > 0
			? boundTextContainerSize(
					shape,
					labelMetrics.textWidth,
					labelMetrics.textHeight + canvasNodeIconBand(icon),
				)
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
const ZONE_HEADER = CANVAS_ZONE_HEADER.height;
const ZONE_LABEL_INSET = CANVAS_ZONE_HEADER.labelInset;
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
	/** The logo drawn before its label. */
	readonly icon?: CanvasNodeIcon;
	readonly id: string;
	/** A zone's kind, which sets its outline and fill. */
	readonly kind?: DiagramZoneKind;
	readonly label: string;
	readonly labelBox: Box;
	/** A frame's logo inside its top-left corner, padded by the name's clearance. */
	readonly logoBox?: Box;
}

/** What routes and labels keep off for a group: its name, and a frame's logo. */
function groupKeepOuts(frame: GroupFrame): Box[] {
	return frame.logoBox ? [frame.labelBox, frame.logoBox] : [frame.labelBox];
}

/** The logo a group draws before its label. */
function groupIcon(group: DiagramGroup): CanvasNodeIcon | undefined {
	return group.icon ? { slug: group.icon.slug, size: CANVAS_GROUP_ICON.size } : undefined;
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
 * continuation edge carries the flow from a band's last rank to the next band,
 * through the gap between them (see assignGutterSides).
 */
interface Wrap {
	readonly bandOf: ReadonlyMap<string, number>;
	readonly continuations: ReadonlySet<string>;
	/**
	 * Continuations that leave forward, around the end of the band they leave,
	 * where a line reaching their source from the gap makes stepping through it
	 * route worse.
	 */
	readonly leaveForward?: ReadonlySet<string>;
	/** Every continuation leaves and arrives forward, around the ends of the bands like a line break. */
	readonly lineBreaks?: boolean;
	/**
	 * Each band ends along the flow under the rank that leads into it, as far as
	 * the longest band allows, so a short band hangs under the steps that reach
	 * it instead of back at the start (zoned levels).
	 */
	readonly under?: boolean;
	/**
	 * Each band of a grouped top level sits its gap clear of only the blocks
	 * before it that share its stretch of the flow, rather than of the broadest
	 * band before it, so a band hanging under a short block rises to that block.
	 */
	readonly rise?: boolean;
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
/** A column at least this tall for its breadth that cannot wrap tightens its rank gaps... */
const COMPACT_ASPECT = 2.3;
/**
 * ...those only straight lines cross to this, room for a label beside an
 * arrowhead, and those lines turn in to the stubs either side of each turn.
 */
const COMPACT_GAP = 56;

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
	/**
	 * Route each edge clear of other lines' arrowheads before anything but a node
	 * or an overlap: a line through a head reads as pointing into its target.
	 */
	readonly clearHeads?: boolean;
	/** In lanes, move a departure off a side that lines arrive by. */
	readonly separateRoles?: boolean;
	/**
	 * In lanes, a handoff to a lane further than the next may stay in its
	 * source's column, straight across the lanes between (laneColumns).
	 */
	readonly throughHandoffs?: boolean;
	/**
	 * Each lane of a laned diagram is at least this broad across the flow, so a
	 * row of lanes too long for its breadth reads squarer (laneBreadthFor).
	 */
	readonly laneBreadth?: number;
	/** Only these crossed return pairs may leave their parallel lanes. */
	readonly unpairedReturns?: ReadonlySet<string>;
	/** Sides edges leave or arrive by in place of the assigned ones, chosen to remove crossings. */
	readonly sides?: SideOverrides;
	/**
	 * Gaps after these ranks, or a laned diagram's columns, by index along the
	 * flow, shrink to at most these lengths.
	 */
	readonly compactGaps?: ReadonlyMap<number, number>;
	/**
	 * Gaps after these ranks, by index along the flow, grow by these lengths, so
	 * a line's sideways step across the gap can sit clear of both its ends.
	 */
	readonly widenGaps?: ReadonlyMap<number, number>;
	/**
	 * A line into a hanging zone band whose target stands behind another step of
	 * its rank, straight across the flow from the source, goes around that step.
	 */
	readonly aroundRanks?: boolean;
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
	// A band cut must not split a group: a grouped flow wraps by level instead
	// (planZoneWraps).
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
 * Bands for a grouped flow too long for its breadth, best first. Each level
 * (the top level or one zone's members) wraps as a plain flow does, in the
 * stated direction, its groups whole ranks of it (planWrap). A flat group's
 * members never wrap: its frame stays one block of the top level, which alone
 * wraps, a row or column of groups laid out in rows or columns of them.
 * Levels wrap one at a time:
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
		...(structure.zoned
			? structure.groups.map((level) => [level.group.id, level.diagram] as const)
			: []),
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
	{ compactGaps, reorder, widenGaps, wrap }: Arrangement = PLAIN_ARRANGEMENT,
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
			rankOffset +=
				metric.depth +
				Math.min(compactGaps?.get(index) ?? Infinity, gapAfter[index]!) +
				(widenGaps?.get(index) ?? 0);
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
	if (laned(diagram)) return positionLanedNodes(diagram, minimumSizes, stubReach, arrangement);
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
		// Where the name ends, measured from the frame's left side; a frame's logo
		// sits left of that side, a zone's before its label.
		const nameEnd = zoned
			? ZONE_LABEL_INSET +
				canvasGroupIconRun(groupIcon(group)) +
				labelWidth +
				CANVAS_FRAME_NAME.clearance
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
	alignUnits(structure, units, vertical, topWrap.bandOf, topWrap.rise);
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
		const icon = groupIcon(group);
		const logo = !zoned && icon ? canvasGroupIconBox({ type: "frame", ...box, icon }) : undefined;
		return {
			box,
			elementId: `group:${group.id}`,
			...(icon ? { icon } : {}),
			id: group.id,
			...(zoned && group.kind !== undefined ? { kind: group.kind } : {}),
			label: group.label,
			labelBox: zoned
				? zoneLabelBox(box, group.label, icon)
				: canvasFrameNameBox({ ...box, name: group.label }),
			...(logo ? { logoBox: padBox(logo, CANVAS_FRAME_NAME.clearance) } : {}),
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

/** Where a zone's label, and the logo before it, are painted in its header strip, padded by its clearance. */
function zoneLabelBox(box: Box, label: string, icon: CanvasNodeIcon | undefined): Box {
	const { clearance, height } = CANVAS_FRAME_NAME;
	return {
		x: box.x + ZONE_LABEL_INSET - clearance,
		y: box.y + (ZONE_HEADER - height) / 2 - clearance,
		width: canvasGroupIconRun(icon) + canvasFrameNameWidth(label) + 2 * clearance,
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
	rise = false,
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
	const boxesOf = (band: number) =>
		[...units]
			.filter(([id]) => (bandOf.get(id) ?? 0) === band)
			.map(([, unit]) => unit.frame ?? unit.nodes[0]!);
	const extent = (band: number) => {
		const boxes = boxesOf(band);
		return {
			start: Math.min(...boxes.map((box) => box[across])),
			end: Math.max(...boxes.map((box) => box[across] + box[size])),
		};
	};
	// Risen, a band clears only the blocks before it that share its stretch of
	// the flow: the skyline above it.
	const skyline = (band: number) => {
		const [along, length] = vertical ? (["y", "height"] as const) : (["x", "width"] as const);
		const own = boxesOf(band);
		const [low, high] = [
			Math.min(...own.map((box) => box[along])),
			Math.max(...own.map((box) => box[along] + box[length])),
		];
		const above = Array.from({ length: band }, (_, before) => boxesOf(before))
			.flat()
			.filter((box) => box[along] < high && box[along] + box[length] > low);
		return above.length > 0
			? Math.max(...above.map((box) => box[across] + box[size]))
			: extent(band - 1).end;
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
		const delta =
			(rise ? skyline(band) : extent(band - 1).end) + bandGaps[band]! - extent(band).start;
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
/**
 * A row of lanes still longer than this for its breadth once tightened, as the
 * PNG frames it, raises its thinnest lanes: past 2.5 a reader takes it for an
 * extreme strip.
 */
const LANE_ASPECT = 2.4;

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
 *
 * With `through`, a handoff to a lane further away may share its source's
 * column too, running straight across the lanes between, where none of their
 * steps stands in that column.
 */
function laneColumns(diagram: IntermediateDiagram, through = false): Map<string, number> {
	const lanes = diagram.lanes ?? [];
	const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
	const laneOf = new Map(
		diagram.nodes.map((node) => [node.id, laneIndex.get(node.lane ?? "") ?? 0]),
	);
	const feedback = flowFeedback(diagram);
	const forward = diagram.edges.filter(
		(edge) => !feedback.has(edge.id) && edge.source !== edge.target,
	);
	// A source's first forward edge into each neighboring lane may stay in its
	// column, and with `through` into each lane further away.
	const straight = new Set<string>();
	const far = new Set<string>();
	const handedOff = new Set<string>();
	for (const edge of forward) {
		const [from, to] = [laneOf.get(edge.source)!, laneOf.get(edge.target)!];
		const key = `${edge.source}\u0000${to}`;
		const skips = Math.abs(from - to) > 1;
		if (from === to || (skips && !through) || handedOff.has(key)) continue;
		handedOff.add(key);
		(skips ? far : straight).add(edge.id);
	}
	const incoming = new Map(diagram.nodes.map((node) => [node.id, [] as DiagramEdge[]]));
	const outgoing = new Map(diagram.nodes.map((node) => [node.id, [] as DiagramEdge[]]));
	for (const edge of forward) {
		incoming.get(edge.target)!.push(edge);
		outgoing.get(edge.source)!.push(edge);
	}
	// Steps in flow order, earliest declared first among those ready.
	const nodeOrder = nodeOrderMap(diagram.nodes);
	const place = (stay: ReadonlySet<string>) => {
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
				at = Math.max(at, column.get(edge.source)! + (stay.has(edge.id) ? 0 : 1));
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
	};
	// A far handoff that a step of a lane between would stand in the way of
	// moves on a column after all, until none does.
	const edges = new Map(forward.map((edge) => [edge.id, edge]));
	for (;;) {
		const column = place(new Set([...straight, ...far]));
		const blocked = [...far].filter((id) => {
			const { source, target } = edges.get(id)!;
			const at = column.get(source)!;
			if (column.get(target) !== at) return false;
			const [low, high] = [laneOf.get(source)!, laneOf.get(target)!].sort((a, b) => a - b);
			return diagram.nodes.some((node) => {
				const lane = laneOf.get(node.id)!;
				return lane > low! && lane < high! && column.get(node.id) === at;
			});
		});
		if (blocked.length === 0) return column;
		for (const id of blocked) far.delete(id);
	}
}

/**
 * A laned diagram's steps and lanes before they are placed: each step's column
 * and offset across its lane's content, each column's depth and the gap after
 * it, and each lane's breadth, padding and header. Steps that share a lane and
 * a column stack across the lane in the order that keeps their edges least
 * crossed. Lanes take the breadth their busiest column needs, at least
 * `minimumBreadth`, and columns hold their stubs and labels as ranks do.
 */
function laneGeometry(
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	stubReach: ReadonlyMap<string, number>,
	through = false,
	minimumBreadth = 0,
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
	const columns = laneColumns(diagram, through);
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
			minimumBreadth,
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
	arrangement: Arrangement = PLAIN_ARRANGEMENT,
): PositionedLayout {
	const { compactGaps, wrap } = arrangement;
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
	} = laneGeometry(
		diagram,
		minimumSizes,
		stubReach,
		arrangement.throughHandoffs,
		arrangement.laneBreadth,
	);
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
		if (index < columnCount - 1 && poolOf[index + 1] === poolOf[index])
			cursor += Math.min(compactGaps?.get(index) ?? Infinity, gapAfter[index]!);
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
		const logo = frame.logoBox ? [obstacleBox(`group-logo:${frame.id}`, frame.logoBox)] : [];
		if (frame.id === shared) {
			const { x, y, width, height } = frame.box;
			const wall = GROUP_WALL;
			return [
				label,
				...logo,
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
		return ends.has(frame.id) ? [label, ...logo] : [label, obstacleBox(frame.elementId, frame.box)];
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
						groupKeepOuts(frame).some((box) => segmentCrossesBoundsInterior(segment, box)) ||
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
		route.lane = {
			at: middle + (sharing.indexOf(route) - (sharing.length - 1) / 2) * PORT_SPACING,
			vertical: lanes.vertical,
		};
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

function textForNode(shape: NodeSceneElement, described = false): TextSceneElement {
	return {
		type: "text",
		id: `label:${shape.nodeId}`,
		containerId: shape.id,
		...(described && shape.groupIds ? { groupIds: [...shape.groupIds] } : {}),
		x: shape.x + shape.width / 2,
		y: shape.y + shape.height / 2,
		text: shape.label,
		fontSize: NODE_LABEL_FONT_SIZE,
		maxWidth: Math.max(1, shape.width - NODE_LABEL_HORIZONTAL_PADDING),
		// The logo sits at the top of the text box; the label stacks beneath it,
		// or stays centered above a description.
		...(shape.icon && !described ? { verticalAlign: "bottom" as const } : {}),
	};
}

/** Group that moves a described node, its label and its description together. */
function describedGroupId(shape: NodeSceneElement): string {
	return `${shape.id}:described`;
}

/** A node's description, under its centered label and grouped with it. */
function descriptionForNode(shape: NodeSceneElement, description: string): TextSceneElement {
	const metrics = measureDescription(description, shape.shape);
	const labelHeight = Math.ceil(
		shape.label.split("\n").length * NODE_LABEL_FONT_SIZE * NODE_LABEL_LINE_HEIGHT,
	);
	return {
		type: "text",
		id: `description:${shape.nodeId}`,
		...(shape.groupIds ? { groupIds: [...shape.groupIds] } : {}),
		textColor: NODE_DESCRIPTION_COLOR,
		x: shape.x + shape.width / 2,
		y: shape.y + shape.height / 2 + labelHeight / 2 + NODE_DESCRIPTION_GAP + metrics.height / 2,
		text: metrics.text,
		fontSize: NODE_DESCRIPTION_FONT_SIZE,
		lineHeight: NODE_DESCRIPTION_LINE_HEIGHT,
		maxWidth: Math.ceil(metrics.width),
	};
}

/** Labels and descriptions of drawn nodes; a described node joins a group with both. */
function nodeTexts(
	shapes: readonly NodeSceneElement[],
	descriptions: ReadonlyMap<string, string>,
): { nodes: NodeSceneElement[]; texts: TextSceneElement[] } {
	const nodes = shapes.map((shape) =>
		descriptions.has(shape.nodeId)
			? { ...shape, groupIds: [describedGroupId(shape), ...(shape.groupIds ?? [])] }
			: shape,
	);
	// Pseudostates draw no label.
	const texts = nodes
		.filter((shape) => shape.label)
		.flatMap((shape) => {
			const description = descriptions.get(shape.nodeId);
			return description
				? [textForNode(shape, true), descriptionForNode(shape, description)]
				: [textForNode(shape)];
		});
	return { nodes, texts };
}

/**
 * Nodes whose description runs past NODE_DESCRIPTION_MAX_LINES at its shape's
 * widest. They draw in full; a build warns so the author can shorten them.
 */
export function longNodeDescriptions(scene: RenderedDiagramScene): string[] {
	return scene.elements.flatMap((element) =>
		element.type === "text" &&
		element.id.startsWith("description:") &&
		element.text.split("\n").length > NODE_DESCRIPTION_MAX_LINES
			? [element.id.slice("description:".length)]
			: [],
	);
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

/** Arrival stubs reserved for lines not yet routed; their heads are drawn full size. */
const reservedArrivals = new WeakSet<ArrowSceneElement>();

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
		const arrival: ArrowSceneElement = {
			...arrow,
			points: [
				pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, ROUTE_STUB_LENGTH)),
				end,
			],
		};
		reservedArrivals.add(arrival);
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
			arrival,
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
	/** Keep clear of other lines' arrowheads first (see Arrangement.clearHeads). */
	readonly clearHeads?: boolean;
	/** Offer any line between facing sides a step midway, as the drawn layout's polish does. */
	readonly midway?: boolean;
}

/**
 * Arrows routed so far (with reserved stubs), prepared once per edge for scoring
 * candidates. Without a reader scale, candidates are scored as the plain router.
 */
interface RoutedSoFar {
	/** Lines of other arrows a route crosses, for reader-scale scoring. */
	readonly crossings?: CrossingLookup;
	/** Other arrows' heads one step passes through or touches, when routes keep clear of heads first. */
	readonly heads?: ReturnType<typeof arrowheadsNear>;
	/** Group frame outlines, which routes cross but never run along. */
	readonly outlines: readonly RouteSegment[];
	readonly quality?: ReturnType<typeof candidateRouteQuality>;
	readonly segments: readonly RouteSegment[];
}

function routedSoFar(
	routedArrows: readonly ArrowSceneElement[],
	readerScale: number | undefined,
	avoidCrossings = false,
	clearHeads = false,
): RoutedSoFar {
	const arrows = routedArrows.some((arrow) => arrow.id.startsWith(LANE_OUTLINE))
		? routedArrows.filter((arrow) => !arrow.id.startsWith(LANE_OUTLINE))
		: routedArrows;
	const scored = arrows.map((arrow) => ({
		id: arrow.id,
		points: arrow.points,
		sourceId: arrow.sourceNodeId,
		targetId: arrow.targetNodeId,
		endArrowhead: arrow.endArrowhead !== null,
		// A reserved arrival stub stands for a line whose head is drawn full size.
		...(clearHeads && reservedArrivals.has(arrow) ? { headRun: 2 * ARROWHEAD_LENGTH } : {}),
	}));
	return {
		...(readerScale === undefined
			? {}
			: {
					...(avoidCrossings ? { crossings: crossingLookup(arrows) } : {}),
					...(clearHeads ? { heads: arrowheadsNear(scored, readerScale) } : {}),
					quality: candidateRouteQuality(scored, readerScale),
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
			routed.heads ? quality.arrowheadsCrossed : 0,
			routeOutlineBesideCount(candidate, routed.outlines),
			quality.corridors,
			routed.heads ? 0 : quality.arrowheadsCrossed,
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
	unpaired: ReadonlySet<string> | undefined,
): void {
	for (const route of routes) {
		if (!feedback.has(route.edge.id) || isSelfLoop(route) || unpaired?.has(route.edge.id)) continue;
		const forward = routes.find(
			(other) =>
				other.pair === undefined &&
				!unpaired?.has(other.edge.id) &&
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

/**
 * Free labels measured, by wrap width and text: the router asks for a branch
 * label's size on every stub it tries, and wrapping segments the text anew.
 */
const freeLabelSizes = new Map<string, Readonly<{ width: number; height: number }>>();
/** Labels measured before the cache starts over, so a long-lived worker stays small. */
const FREE_LABEL_SIZES = 4_096;

function freeLabelSize(
	label: string,
	maxWidth: number,
): Readonly<{ width: number; height: number }> {
	const key = `${maxWidth}\u0000${label}`;
	let size = freeLabelSizes.get(key);
	if (!size) {
		const text = wrapTextToWidth(label, maxWidth, 13);
		size = {
			width: wrappedLabelWidth(text, 13, maxWidth),
			height: Math.ceil(text.split("\n").length * 13 * 1.35),
		};
		if (freeLabelSizes.size >= FREE_LABEL_SIZES) freeLabelSizes.clear();
		freeLabelSizes.set(key, size);
	}
	return size;
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

/** Whether a label box lies within a region. */
function boxWithin(box: LabelBox, region: Box): boolean {
	return (
		box.x >= region.x - AXIS_ALIGNED_EPSILON &&
		box.y >= region.y - AXIS_ALIGNED_EPSILON &&
		box.x + box.width <= region.x + region.width + AXIS_ALIGNED_EPSILON &&
		box.y + box.height <= region.y + region.height + AXIS_ALIGNED_EPSILON
	);
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

/** The box an arrow's head is drawn in, wings and stroke included. */
function arrowheadBox(arrow: ArrowSceneElement): NodeSceneElement | undefined {
	if (arrow.endArrowhead === null) return undefined;
	const [previous, tip] = [arrow.points.at(-2), arrow.points.at(-1)];
	if (!previous || !tip) return undefined;
	const length = Math.hypot(tip.x - previous.x, tip.y - previous.y);
	if (length <= 0) return undefined;
	const size = Math.min(ARROWHEAD_LENGTH, length / 2);
	const [back, across] = [size * Math.cos(ARROWHEAD_WING), size * Math.sin(ARROWHEAD_WING) + 1];
	const [ux, uy] = [(tip.x - previous.x) / length, (tip.y - previous.y) / length];
	const xs = [tip.x, tip.x - ux * back - uy * across, tip.x - ux * back + uy * across];
	const ys = [tip.y, tip.y - uy * back + ux * across, tip.y - uy * back - ux * across];
	return obstacleBox(`arrowhead:${arrow.id}`, {
		x: Math.min(...xs) - 1,
		y: Math.min(...ys) - 1,
		width: Math.max(...xs) - Math.min(...xs) + 2,
		height: Math.max(...ys) - Math.min(...ys) + 2,
	});
}

/** A label beside a straight line, pushed out across it past its own arrowhead's wing. */
function clearOfHead(
	stub: ScenePoint,
	arrow: ArrowSceneElement,
	head: NodeSceneElement | undefined,
): ScenePoint[] {
	const [start, next] = arrow.points;
	if (!head || !next || arrow.points.length !== 2) return [];
	const reach = (Math.abs(start.x - next.x) <= AXIS_ALIGNED_EPSILON ? head.width : head.height) / 2;
	return Math.abs(start.x - next.x) <= AXIS_ALIGNED_EPSILON
		? [{ x: stub.x + Math.sign(stub.x - start.x) * (reach + LABEL_LINE_CLEARANCE), y: stub.y }]
		: [{ x: stub.x, y: stub.y + Math.sign(stub.y - start.y) * (reach + LABEL_LINE_CLEARANCE) }];
}

/** Distance from a label box to the nearest of some lines. */
function nearestLine(box: LabelBox, lines: readonly AxisAlignedSegment[]): number {
	return Math.min(Infinity, ...lines.map((segment) => boxSegmentDistance(box, segment)));
}

/**
 * How much nearer a label box sits to another line than it may: a label reads
 * as its own line's only when every other line is further by the wider berth.
 */
function labelShortfall(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
	segments: readonly AxisAlignedSegment[],
): number {
	return Math.max(
		0,
		nearestLine(box, own) + LABEL_OTHER_LINE_CLEARANCE - nearestLine(box, segments),
	);
}

/** Whether a label box sits no clearer of another line than of its own: it could belong to either. */
function labelAmbiguous(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
	segments: readonly AxisAlignedSegment[],
): boolean {
	return labelShortfall(box, own, segments) > 0;
}

/**
 * Text beside a vertical run aligns toward it. Widths are estimated wide, so
 * centered text would paint further from its line than placement measured.
 */
function labelAlign(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
): TextSceneElement["textAlign"] | undefined {
	const [nearest] = own.toSorted((a, b) => boxSegmentDistance(box, a) - boxSegmentDistance(box, b));
	if (!nearest || nearest.orientation !== "vertical") return undefined;
	if (nearest.max <= box.y || nearest.min >= box.y + box.height) return undefined;
	if (box.x >= nearest.staticCoordinate) return "left";
	if (box.x + box.width <= nearest.staticCoordinate) return "right";
	return undefined;
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

/** A drawn label nearer another line than it may be, by `shortfall`. */
interface LabelShortfall {
	readonly box: LabelBox;
	/** Distance from the label to its own line. */
	readonly own: number;
	readonly index: number;
	readonly shortfall: number;
}

/**
 * Branch labels placed as drawn, how many lines, nodes or labels they still
 * touch, and those that sit nearer another line than they may.
 */
function placedBranchLabels(
	arrows: ArrowSceneElement[],
	routes: readonly RoutedEdge[],
	shapes: readonly NodeSceneElement[],
	groups?: GroupLayout,
	unambiguous = true,
	lanes?: LaneLayout,
): { labels: TextSceneElement[]; touches: number; shortfalls: LabelShortfall[] } {
	const labels: TextSceneElement[] = [];
	let touches = 0;
	const segments = arrows.map((arrow) => segmentsFromPoints(arrow.points));
	// Group names and lane headers are obstacles, and frame outlines and lane
	// boundaries are lines a label keeps clear of.
	const nodes = [
		...shapes,
		...(groups?.frames ?? []).flatMap((frame) => [
			obstacleBox(`group-label:${frame.id}`, frame.labelBox),
			...(frame.logoBox ? [obstacleBox(`group-logo:${frame.id}`, frame.logoBox)] : []),
		]),
		...(lanes?.frames ?? []).map((frame) =>
			obstacleBox(`lane-header:${laneElementId(frame)}`, frame.header),
		),
	];
	const outlines = [
		...(groups?.frames ?? []).flatMap((frame) => frameOutline(frame.box)),
		...(lanes ? laneBoundaries(lanes) : []),
	];
	// What the nodes, frames, lanes and lines span, without the labels.
	const drawing = boundsOf([
		...shapes,
		...groupBlocks(groups),
		...laneBlocks(lanes),
		...arrows.flatMap((arrow) => arrow.points.map((point) => ({ ...point, width: 0, height: 0 }))),
	]);
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
		// Its own line's arrowhead is an obstacle too: on a short line a wing
		// would reach its text.
		const head = arrowheadBox(arrow);
		const obstacles = head ? [...nodes, head] : nodes;
		const conflicts = (position: ScenePoint, margin = 0) =>
			labelConflicts(padBox(labelBox(position, size), margin), segments[index]!, lines, obstacles, [
				...others,
				...placed.map((label) => label.box),
			]);
		let position = stub;
		let fewest = conflicts(stub);
		if (fewest > 0)
			for (const candidate of [
				...labelSlidePositions(arrow.points, size, labelRuns(routes[index])),
				...clearOfHead(stub, arrow, head),
			]) {
				const count = conflicts(candidate);
				if (count < fewest) [position, fewest] = [candidate, count];
				if (fewest === 0) break;
			}
		else if (unambiguous && labelAmbiguous(labelBox(stub, size), segments[index]!, lines)) {
			// A clear label that could belong to another line moves to a spot that is
			// plainly its own and clear of everything with room to spare, or else to
			// the clear spot that sits least near another line. One that only a frame
			// or lane boundary crowds, no other arrow, stays within the drawing rather
			// than widen it.
			const shortfall = (candidate: ScenePoint) =>
				labelShortfall(labelBox(candidate, size), segments[index]!, lines);
			const detached = labelAmbiguous(
				labelBox(stub, size),
				segments[index]!,
				segments.flatMap((other, at) => (at === index ? [] : other)),
			);
			const slides = labelSlidePositions(arrow.points, size, labelRuns(routes[index])).filter(
				(candidate) => detached || boxWithin(labelBox(candidate, size), drawing),
			);
			position =
				slides.find(
					(candidate) =>
						conflicts(candidate, LABEL_MOVE_MARGIN) === 0 && shortfall(candidate) === 0,
				) ??
				slides
					.filter((candidate) => conflicts(candidate) === 0)
					.reduce(
						(best, candidate) => (shortfall(candidate) < shortfall(best) ? candidate : best),
						stub,
					);
		}
		touches += fewest;
		positions[index] = position;
		placed.push({ box: labelBox(position, size), index });
	}
	const shortfalls: LabelShortfall[] = [];
	for (const [index, arrow] of arrows.entries()) {
		const position = positions[index];
		if (!arrow.label || !position) continue;
		const box = labelBox(position, sizes[index]!);
		const own = segments[index]!;
		const shortfall = labelShortfall(box, own, [
			...segments.flatMap((other, at) => (at === index ? [] : other)),
			...outlines,
		]);
		if (shortfall > 0) shortfalls.push({ box, own: nearestLine(box, own), index, shortfall });
		const groupIds = [`branch:${arrow.edgeId}`];
		const textAlign = labelAlign(box, own);
		labels.push({
			type: "text",
			id: `${arrow.id}:label`,
			text: arrow.label,
			fontSize: 13,
			x: position.x,
			y: position.y,
			maxWidth: branchLabelMaxWidth(branches(routes[index]?.source.kind)),
			...(textAlign ? { textAlign } : {}),
			groupIds,
		});
		arrows[index] = { ...arrow, groupIds };
	}
	return { labels, touches, shortfalls };
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
	heads?: RoutedSoFar["heads"],
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
								// Through another line's head costs as much as overlapping it.
								(heads ? heads(point, next, arrowId) * 10000 : 0) +
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
	{
		avoidCrossings,
		clearHeads,
		readerScale,
		guided,
		bandOf,
		groups,
		lanes: laneLayout,
		midway,
	}: RouteOptions,
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
	const bandLane = route.lane;
	const continuation = bandLane
		? stubDistances.map((distance) =>
				bandLane.vertical
					? routeForVerticalLane(bandLane.at, distance)
					: routeForHorizontalLane(bandLane.at, distance),
			)
		: [];
	// A pinned line, a handoff straight across a lane boundary, or, in the
	// drawn layout's polish, any line between facing sides may step across
	// midway, a bend clear of both ports rather than a jog beside one, or on
	// a lane boundary.
	const facing =
		route.targetEdge === OPPOSITE_EDGE[route.sourceEdge] &&
		(route.pinned !== undefined ||
			(laneLayout !== undefined ? straightHandoff(route, laneLayout) : midway === true));
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

	const routed = routedSoFar(existingArrows, readerScale, avoidCrossings, clearHeads);
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
	const quality = (points: [ScenePoint, ...ScenePoint[]]) =>
		routed.quality?.({
			id: `edge:${route.edge.id}`,
			points,
			sourceId: route.edge.source,
			targetId: route.edge.target,
		}) ?? { arrowheadsCrossed: 0, corridors: 0, jogs: 0 };
	// A run along a node's border, like a corridor, is polish: a bounded search fixes it.
	const border = strict && routeBorderRunCount(best, shapes, ignoredNodeIds) > 0;
	const hard =
		routeNodeCrossingCount(best, shapes, ignoredNodeIds) ||
		routeSelfOverlapCount(best, route) ||
		routeArrowOverlapCount(best, routed.segments, route) ||
		(routed.heads !== undefined && quality(best).arrowheadsCrossed) ||
		routeOutlineBesideCount(best, routed.outlines);
	// A pinned line that runs out past its target, around everything between, may
	// find a way between the nodes instead.
	const wanders =
		route.pinned !== undefined &&
		routeBacktrackDistance(best) + routeTargetOvershootDistance(best) > 0;
	if (hard || border || quality(best).corridors || wanders) {
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
			routed.heads,
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

/** How many lines leave or arrive by each side of each node, by port key. */
function sideEnds(routes: readonly RoutedEdge[]): Map<string, number> {
	const ends = new Map<string, number>();
	for (const route of routes)
		for (const key of [
			portKey(route.source.nodeId, route.sourceEdge),
			portKey(route.target.nodeId, route.targetEdge),
		])
			ends.set(key, (ends.get(key) ?? 0) + 1);
	return ends;
}

/**
 * Whether a line turns over its target's corner into a side another line meets
 * the target by: its last run before a short stub starts beyond the target.
 */
function turnsCorner(
	route: RoutedEdge,
	arrow: ArrowSceneElement,
	ends: ReadonlyMap<string, number>,
): boolean {
	if ((ends.get(portKey(route.target.nodeId, route.targetEdge)) ?? 0) < 2) return false;
	const corners = straightRuns(arrow.points);
	if (corners.length < 3) return false;
	const [from, turn, end] = corners.slice(-3) as [ScenePoint, ScenePoint, ScenePoint];
	if (Math.abs(end.x - turn.x) + Math.abs(end.y - turn.y) >= 2 * ROUTE_STUB_LENGTH) return false;
	const { target } = route;
	const [at, low, size] =
		Math.abs(from.y - turn.y) <= AXIS_ALIGNED_EPSILON
			? [from.x, target.x, target.width]
			: [from.y, target.y, target.height];
	return at < low - AXIS_ALIGNED_EPSILON || at > low + size + AXIS_ALIGNED_EPSILON;
}

/**
 * A forward edge that hooks sideways just before its arrowhead, crosses
 * another arrow on its final approach, or, `cornered`, turns over its target's
 * corner from beyond it into a side another line meets the target by, reads
 * better entering the free side its last run already approaches. Returns the
 * routes it moved with their previous sides.
 */
function resideArrivals(
	routes: readonly RoutedEdge[],
	arrows: readonly ArrowSceneElement[],
	diagram: IntermediateDiagram,
	scale: number,
	trigger: "hooked" | "crossed" | "cornered",
): { route: RoutedEdge; side: ConnectionEdge }[] {
	const feedback = flowFeedback(diagram);
	const ends = sideEnds(routes);
	const used = new Set(ends.keys());
	const resided: { route: RoutedEdge; side: ConnectionEdge }[] = [];
	for (const [index, arrow] of arrows.entries()) {
		const route = routes[index]!;
		if (feedback.has(route.edge.id) || route.pinned?.target !== undefined) continue;
		const moves =
			trigger === "hooked"
				? routingQualityFindings([{ id: arrow.id, points: arrow.points }], scale).some(
						(finding) => finding.kind === "endpoint-jog" && finding.endpoint === "end",
					)
				: trigger === "cornered"
					? turnsCorner(route, arrow, ends)
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
					(!boxesOverlap(room, candidate.box) &&
						groupKeepOuts(candidate).every((box) => !boxesOverlap(room, box))),
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

/**
 * A continuation steps through the gap between its bands, as a line of text
 * wraps: it leaves its band's last step by the side facing the next band and
 * enters the next band's first step by the side facing back, never around the
 * outer margins. A decision it enters that way sends its two branches by its
 * forward vertex and the one facing the next band, when the second branch's
 * target lies that way. An end whose side another step of its rank covers, or
 * a branch still leaves by, keeps its forward side.
 */
function assignGutterSides(
	routes: readonly RoutedEdge[],
	nodes: readonly NodeSceneElement[],
	wrap: Wrap,
	direction: LayoutDirection,
): void {
	// Bands follow each other down the page (rows) or across it (columns).
	const toward = FORWARD_SIDE[ACROSS_DIRECTION[direction]];
	const back = OPPOSITE_EDGE[toward];
	const [along, length, across] =
		direction === "TB" || direction === "BT"
			? (["y", "height", "x"] as const)
			: (["x", "width", "y"] as const);
	const bandOf = (node: NodeSceneElement) => wrap.bandOf.get(node.nodeId) ?? 0;
	// Whether another step of the node's band shares its stretch of the flow,
	// further toward the next band (+1) or back toward the previous one (-1).
	const covered = (node: NodeSceneElement, sign: 1 | -1) =>
		nodes.some(
			(other) =>
				other.nodeId !== node.nodeId &&
				bandOf(other) === bandOf(node) &&
				Math.min(other[along] + other[length], node[along] + node[length]) -
					Math.max(other[along], node[along]) >
					AXIS_ALIGNED_EPSILON &&
				sign * (center(other)[across] - center(node)[across]) > 0,
		);
	for (const route of routes) {
		if (!wrap.continuations.has(route.edge.id)) continue;
		if (!covered(route.source, 1) && !wrap.leaveForward?.has(route.edge.id))
			route.sourceEdge = toward;
		const { target } = route;
		if (covered(target, -1)) continue;
		const departures = routes.filter((other) => other.source.nodeId === target.nodeId);
		if (departures.some((other) => other.sourceEdge === back) && branches(target.kind)) {
			const [low, high] = [...departures].sort(
				(a, b) => center(a.target)[across] - center(b.target)[across],
			);
			if (departures.length !== 2 || center(high!.target)[across] - center(target)[across] < 1)
				continue;
			low!.sourceEdge = FORWARD_SIDE[direction];
			high!.sourceEdge = toward;
		}
		if (departures.every((other) => other.sourceEdge !== back)) route.targetEdge = back;
	}
}

/**
 * Continuations leaving toward the next band from a source that another line
 * reaches from that side: one of its last runs passes beyond the source there.
 */
function contendedContinuations(
	layout: DiagramLayout,
	wrap: Wrap,
	direction: LayoutDirection,
): Set<string> {
	const toward = FORWARD_SIDE[ACROSS_DIRECTION[direction]];
	const [across, size] =
		direction === "TB" || direction === "BT"
			? (["x", "width"] as const)
			: (["y", "height"] as const);
	const contended = new Set<string>();
	for (const route of layout.routedEdges) {
		if (!wrap.continuations.has(route.edge.id) || route.sourceEdge !== toward) continue;
		const { source } = route;
		const side = source[across] + source[size];
		if (
			layout.edgeArrows.some(
				(arrow) =>
					arrow.targetNodeId === source.nodeId &&
					arrow.edgeId !== route.edge.id &&
					arrow.points.slice(-3).some((point) => point[across] > side + AXIS_ALIGNED_EPSILON),
			)
		)
			contended.add(route.edge.id);
	}
	return contended;
}

/** Each continuation runs midway between the bands it joins, along the flow. */
function assignContinuationLanes(
	routes: readonly RoutedEdge[],
	nodes: readonly NodeSceneElement[],
	wrap: Wrap,
	direction: LayoutDirection,
): void {
	const vertical = direction === "TB" || direction === "BT";
	const [across, size] = vertical ? (["x", "width"] as const) : (["y", "height"] as const);
	for (const route of routes) {
		if (!wrap.continuations.has(route.edge.id)) continue;
		const band = wrap.bandOf.get(route.source.nodeId) ?? 0;
		const inBand = (index: number) =>
			nodes.filter((node) => (wrap.bandOf.get(node.nodeId) ?? 0) === index);
		const end = Math.max(...inBand(band).map((node) => node[across] + node[size]));
		const start = Math.min(...inBand(band + 1).map((node) => node[across]));
		route.lane = { at: (end + start) / 2, vertical };
	}
}

/**
 * The line from one band of a wrapped row or column of frames to the next runs
 * across the gap midway between them, clear of both bands' frames and names,
 * as a continuation does (assignContinuationLanes); for a risen band, midway
 * below the blocks it lies under. A gap that more lines cross is left to the
 * router, which spaces them.
 */
function assignFrameGutterLanes(
	routes: readonly RoutedEdge[],
	nodes: readonly NodeSceneElement[],
	groups: GroupLayout,
	wrap: Wrap,
	direction: LayoutDirection,
): void {
	const vertical = direction === "TB" || direction === "BT";
	const [across, size] = vertical ? (["x", "width"] as const) : (["y", "height"] as const);
	const [along, length] = vertical ? (["y", "height"] as const) : (["x", "width"] as const);
	const unitOf = (nodeId: string) => {
		const group = groups.groupOf.get(nodeId);
		return group === undefined ? nodeId : groupUnitId(group);
	};
	const bandOf = (nodeId: string) => wrap.bandOf.get(unitOf(nodeId)) ?? 0;
	const blocks = [
		...groups.frames.map((frame) => ({
			band: wrap.bandOf.get(groupUnitId(frame.id)) ?? 0,
			box: boundsOf([frame.box, frame.labelBox]),
		})),
		...nodes.flatMap((node) =>
			groups.groupOf.has(node.nodeId) ? [] : [{ band: bandOf(node.nodeId), box: node }],
		),
	];
	const crossing = routes.filter(
		(route) => bandOf(route.target.nodeId) === bandOf(route.source.nodeId) + 1,
	);
	for (const route of crossing) {
		const band = bandOf(route.source.nodeId);
		if (crossing.some((other) => other !== route && bandOf(other.source.nodeId) === band)) continue;
		const next = blocks.filter(({ band: at }) => at === band + 1);
		const [low, high] = [
			Math.min(...next.map(({ box }) => box[along])),
			Math.max(...next.map(({ box }) => box[along] + box[length])),
		];
		// Risen, the band clears the blocks of every band before it above its stretch.
		const above = wrap.rise
			? blocks.filter(
					({ band: at, box }) => at <= band && box[along] < high && box[along] + box[length] > low,
				)
			: [];
		const end = Math.max(
			...(above.length > 0 ? above : blocks.filter(({ band: at }) => at === band)).map(
				({ box }) => box[across] + box[size],
			),
		);
		const start = Math.min(...next.map(({ box }) => box[across]));
		route.lane = { at: (end + start) / 2, vertical };
	}
}

interface DiagramLayout {
	/** Whether arrivals on a side are ordered by where their routes leave (Arrangement.crossingRepair). */
	byApproach?: boolean;
	edgeArrows: ArrowSceneElement[];
	groups?: GroupLayout;
	lanes?: LaneLayout;
	nodeShapes: NodeSceneElement[];
	/** The polish, port offsets and route options the arrows were last routed with. */
	polish?: RoutingPolish;
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
					groupKeepOuts(frame).some((keepOut) => boxesOverlap(box, keepOut))
				)
					crowded.add(frame.id);
		if (group === undefined) continue;
		if (
			outlines.some((edge) => segmentCrossesBoundsInterior(edge, box)) ||
			groups.frames.some((frame) =>
				groupKeepOuts(frame).some((keepOut) => boxesOverlap(box, keepOut)),
			)
		)
			crowded.add(group);
	}
	return crowded;
}

/**
 * How short each gap between consecutive ranks of a column, or columns of
 * lanes, can draw: one that lines only cross straight, COMPACT_GAP; one that
 * lines turn in, a stub either side of the turns, which keep a port's spacing
 * apart. With `straight`, only the gaps lines cross straight.
 */
function compactGaps(
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	arrangement: Arrangement,
	straight = false,
): Map<number, number> {
	const placed = new Map(layout.nodeShapes.map((shape) => [shape.nodeId, shape]));
	// Ranks or columns, each as the ids of its steps, in order along the flow.
	const columns = laned(diagram)
		? [...laneColumns(diagram, arrangement.throughHandoffs)].reduce<string[][]>(
				(list, [id, column]) => {
					(list[column] ??= []).push(id);
					return list;
				},
				[],
			)
		: rankLayout(diagram, new Map(), new Map(), arrangement.reorder).rankMetrics.map(({ shapes }) =>
				shapes.map((shape) => shape.nodeId),
			);
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const [along, size] = vertical ? (["y", "height"] as const) : (["x", "width"] as const);
	const spans = columns.map((ids) => {
		const boxes = ids.map((id) => placed.get(id)!);
		return {
			top: Math.min(...boxes.map((box) => box[along])),
			bottom: Math.max(...boxes.map((box) => box[along] + box[size])),
		};
	});
	// Where along the flow lines run across it.
	const across = vertical ? "x" : "y";
	const turns = layout.edgeArrows.flatMap((arrow) =>
		arrow.points.slice(1).flatMap((point, index) => {
			const previous = arrow.points[index]!;
			return Math.abs(point[along] - previous[along]) <= AXIS_ALIGNED_EPSILON &&
				Math.abs(point[across] - previous[across]) > AXIS_ALIGNED_EPSILON
				? [point[along]]
				: [];
		}),
	);
	const gaps = new Map<number, number>();
	for (let index = 0; index < spans.length - 1; index += 1) {
		const [upper, lower] = [spans[index]!, spans[index + 1]!];
		// Ranks run down the page in TB and up it in BT, columns right in LR and left in RL.
		const [from, to] =
			upper.bottom <= lower.top ? [upper.bottom, lower.top] : [lower.bottom, upper.top];
		const levels = new Set(
			turns.filter((at) => at > from + AXIS_ALIGNED_EPSILON && at < to - AXIS_ALIGNED_EPSILON),
		).size;
		if (levels === 0) gaps.set(index, COMPACT_GAP);
		else if (!straight) gaps.set(index, 2 * ROUTE_STUB_LENGTH + (levels - 1) * PORT_SPACING);
	}
	return gaps;
}

/**
 * The breadth the thinner lanes of a drawn row of lanes, unwrapped and longer
 * than LANE_ASPECT for its breadth, rise to so it reads no longer than that:
 * the thinnest first, level with each other, never past the broadest lane, so
 * no lane stands emptier than the broadest already does. Undefined when the
 * drawing is short enough, or when even level lanes would leave it longer: a
 * row that long needs more than broader lanes, and broadening it only adds
 * empty lane and canvas.
 */
function laneBreadthFor(
	{ lanes }: DiagramLayout,
	size: { readonly width: number; readonly height: number },
): number | undefined {
	if (!lanes) return undefined;
	const [along, across] = lanes.vertical ? [size.height, size.width] : [size.width, size.height];
	let short = (along + 2 * EXPORT_PADDING) / LANE_ASPECT - 2 * EXPORT_PADDING - across;
	if (short <= AXIS_ALIGNED_EPSILON) return undefined;
	const breadths = lanes.frames
		.filter((frame) => frame.pool === 0)
		.map((frame) => (lanes.vertical ? frame.box.width : frame.box.height))
		.sort((a, b) => a - b);
	for (const [index, level] of breadths.slice(0, -1).entries()) {
		const raise = (breadths[index + 1]! - level) * (index + 1);
		if (raise >= short) return Math.ceil(level + short / (index + 1));
		short -= raise;
	}
	return undefined;
}

/**
 * Rank gaps, by index along the flow, too narrow for a line's sideways step
 * across them to sit clear of both its ends, each with the length it grows by
 * so the step can sit midway, beyond a jog's reach of either end: a line
 * between steps of neighboring ranks that steps sideways once, a port jog
 * (portJogSteps), with its ends nearer along the flow than twice that reach.
 * Both are judged at the scale the grown drawing reads at, which reads more
 * steps as jogs and lengthens the reach, so the gaps grow until none is left.
 */
function narrowStepGaps(diagram: IntermediateDiagram, layout: DiagramLayout): Map<number, number> {
	const { edgeArrows, groups, nodeShapes } = layout;
	const { direction } = diagram.layout;
	const vertical = direction === "TB" || direction === "BT";
	const along = vertical ? "y" : "x";
	// A rank's steps share their middle along the flow; ranks count from the flow's start.
	const middles = nodeShapes.map((shape) => center(shape)[along]);
	const levels = [...new Set(middles.map(Math.round))].sort((a, b) =>
		direction === "BT" || direction === "RL" ? b - a : a - b,
	);
	const rankOf = new Map(
		nodeShapes.map((shape, index) => [
			shape.nodeId,
			levels.findIndex((level) => Math.abs(level - middles[index]!) <= 1),
		]),
	);
	const size = drawnSize([...nodeShapes, ...groupBlocks(groups)], edgeArrows);
	const scaleAt = (grown: number) =>
		routingQualityScale(
			vertical ? { ...size, height: size.height + grown } : { ...size, width: size.width + grown },
		);
	// Lines between neighboring ranks that step sideways once, by the gap they cross.
	const steps = edgeArrows.flatMap((arrow) => {
		const [from, to] = [rankOf.get(arrow.sourceNodeId), rankOf.get(arrow.targetNodeId)];
		const corners = straightRuns(arrow.points);
		return from === undefined ||
			to === undefined ||
			from < 0 ||
			to < 0 ||
			Math.abs(from - to) !== 1 ||
			corners.length !== 4
			? []
			: [{ corners, index: Math.min(from, to) }];
	});
	const gaps = new Map<number, number>();
	for (let round = 0; round < 4; round += 1) {
		const grown = [...gaps.values()].reduce((sum, length) => sum + length, 0);
		const scale = scaleAt(grown);
		const [reach, wide] = [routingJogReach(scale), routingWideBend(scale)];
		let changed = false;
		for (const { corners, index } of steps) {
			const span = Math.abs(corners[3]![along] - corners[0]![along]) + (gaps.get(index) ?? 0);
			// A step as wide as a deliberate bend needs no room; one in a gap that grows
			// must clear its ends too, wherever the router puts it.
			if (
				Math.hypot(corners[2]!.x - corners[1]!.x, corners[2]!.y - corners[1]!.y) >= wide ||
				(!gaps.has(index) && portJogSteps(corners, reach, wide).length === 0)
			)
				continue;
			const more = Math.ceil(2 * reach + PORT_SPACING - span);
			if (more > 0) {
				gaps.set(index, (gaps.get(index) ?? 0) + more);
				changed = true;
			}
		}
		if (!changed) break;
	}
	// Gaps grow only while the drawing stays short of tightening.
	const grown = [...gaps.values()].reduce((sum, length) => sum + length, 0);
	const [length, breadth] = vertical ? [size.height, size.width] : [size.width, size.height];
	return exportAspect(length + grown, breadth) < COMPACT_ASPECT ? gaps : new Map();
}

/** Sideways steps that read as port jogs (portJogSteps), at the scale the layout reads at. */
function portJogCount({ edgeArrows, groups, nodeShapes }: DiagramLayout): number {
	const scale = routingQualityScale(drawnSize([...nodeShapes, ...groupBlocks(groups)], edgeArrows));
	const [reach, wide] = [routingJogReach(scale), routingWideBend(scale)];
	return edgeArrows.reduce(
		(total, arrow) =>
			total +
			(arrow.sourceNodeId === arrow.targetNodeId
				? 0
				: portJogSteps(straightRuns(arrow.points), reach, wide).length),
		0,
	);
}

/**
 * Whether another step of the target's rank stands straight across the flow
 * between the source and the target, so a line between them must go around it.
 */
function behindRankStep(
	source: NodeSceneElement,
	target: NodeSceneElement,
	shapes: readonly NodeSceneElement[],
	direction: LayoutDirection,
): boolean {
	const vertical = direction === "TB" || direction === "BT";
	const across = (shape: NodeSceneElement) =>
		vertical
			? { low: shape.x, high: shape.x + shape.width }
			: { low: shape.y, high: shape.y + shape.height };
	const along = (shape: NodeSceneElement) =>
		vertical
			? { low: shape.y, high: shape.y + shape.height }
			: { low: shape.x, high: shape.x + shape.width };
	const [from, to, span, start] = [across(source), across(target), along(target), along(source)];
	return shapes.some((shape) => {
		if (shape.nodeId === source.nodeId || shape.nodeId === target.nodeId) return false;
		const rank = along(shape);
		const { low, high } = across(shape);
		return (
			rank.low < span.high &&
			span.low < rank.high &&
			rank.low < start.high &&
			start.low < rank.high &&
			low > Math.min(from.high, to.high) - AXIS_ALIGNED_EPSILON &&
			high < Math.max(from.low, to.low) + AXIS_ALIGNED_EPSILON
		);
	});
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

/** Port offsets at a polish: aligned, ordered by approach where `byApproach`, then pinned. */
function portOffsetsAt(
	routes: readonly RoutedEdge[],
	polish: RoutingPolish,
	byApproach: boolean,
	laned: boolean,
): Map<string, number> {
	return withPinnedOffsets(
		routes,
		polish.ports
			? alignedPortOffsets(
					routes,
					polish.repair,
					byApproach,
					laned ? LANE_ARRIVAL_SPACING : ARRIVAL_SPACING,
				)
			: portOffsetsForRoutes(routes, polish.repair),
	);
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
		portOffsetsAt(routes, polish, arrangement.crossingRepair, laned(diagram));
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
	// into it from the side it hangs from. Around ranks, a target behind another
	// step of its rank, which stands straight across the flow from the source, is
	// reached around that step instead: leaving forward and turning back into the
	// target's forward side.
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
			const behind =
				arrangement.aroundRanks === true &&
				!ahead &&
				behindRankStep(source, target, nodeShapes, direction);
			route.sourceEdge = ahead || behind ? FORWARD_SIDE[direction] : toward;
			route.targetEdge = behind ? FORWARD_SIDE[direction] : OPPOSITE_EDGE[toward];
		}
	if (endRun) for (const route of routedEdges) route.endRun = endRun;
	if (lanes) assignLaneSides(routedEdges, lanes);
	const mirrored = orthogonal && polish.ports;
	assignSides(routedEdges, mirrored);
	if (lanes && orthogonal) assignLaneBranchSides(routedEdges, lanes, direction);
	else if (orthogonal && !wrap.lineBreaks)
		assignGutterSides(routedEdges, nodeShapes, wrap, direction);
	let portOffsets: Map<string, number>;
	let capacity: Map<string, { width: number; height: number }>;
	if (orthogonal) {
		assignLoopSides(routedEdges, (route) => edgeDirection(route.edge));
		assignFeedbackSides(routedEdges, diagram, (route) => edgeDirection(route.edge));
		if (graphOptions.get(diagram)?.pairedReturns)
			assignPairedReturns(
				routedEdges,
				flowFeedback(diagram),
				nodeShapes,
				groups,
				arrangement.unpairedReturns,
			);
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
	else assignContinuationLanes(routedEdges, nodeShapes, wrap, direction);
	const frameWrap = groups?.zoned === false ? arrangement.zoneWraps?.get(TOP_LEVEL) : undefined;
	if (orthogonal && groups && frameWrap)
		assignFrameGutterLanes(routedEdges, nodeShapes, groups, frameWrap, direction);

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
		...(arrangement.clearHeads ? { clearHeads: true } : {}),
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
		byApproach: arrangement.crossingRepair,
		edgeArrows,
		...(groups ? { groups } : {}),
		...(lanes ? { lanes } : {}),
		nodeShapes,
		polish,
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
 * Lines that run more than twice the orthogonal distance between their ends,
 * plus a node and the padding either side of it: a reader takes them for detours.
 */
function detouredLines(arrows: readonly ArrowSceneElement[]): number {
	return arrows.filter((arrow) => {
		const [start, end] = [arrow.points[0], arrow.points.at(-1)!];
		const direct = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
		return routeLength(arrow.points) > 2 * direct + MIN_NODE_HEIGHT + 2 * PADDING;
	}).length;
}

/** Edges whose lines pass through or touch another line's arrowhead, judged at the export size. */
function headCrossers(layout: DiagramLayout): Set<string> {
	const nodes = [...layout.nodeShapes, ...groupBlocks(layout.groups), ...laneBlocks(layout.lanes)];
	const routes = layout.edgeArrows.map((arrow) => ({
		id: arrow.id,
		edgeId: arrow.edgeId,
		points: arrow.points,
		sourceId: arrow.sourceNodeId,
		targetId: arrow.targetNodeId,
		endArrowhead: arrow.endArrowhead !== null,
	}));
	const quality = candidateRouteQuality(
		routes,
		routingQualityScale(drawnSize(nodes, layout.edgeArrows)),
	);
	return new Set(
		routes.filter((route) => quality(route).arrowheadsCrossed > 0).map((route) => route.edgeId),
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
 * other route moves. In the `last` pass, after every choice, a line moves
 * again from where its last move left it until no run is near, and no move
 * may run a line through a head: no head repair follows.
 */
function clearOutlines(layout: DiagramLayout, last = false): DiagramLayout {
	const { groups, lanes, nodeShapes, routedEdges } = layout;
	let arrows = layout.edgeArrows;
	const drawn = [...nodeShapes, ...groupBlocks(groups), ...laneBlocks(lanes)];
	const score = (candidate: readonly ArrowSceneElement[]) => ({
		crossings: arrowCrossings(candidate),
		defects: exportRouteDefects(candidate, nodeShapes, groups, lanes).length,
		findings: readerFindingCount(candidate, drawn),
		heads: last ? headCrossers({ ...layout, edgeArrows: [...candidate] }).size : 0,
		inward: inwardEndpoints(candidate, nodeShapes),
		labels: placedBranchLabels([...candidate], routedEdges, nodeShapes, groups, true, lanes)
			.touches,
	});
	let current: ReturnType<typeof score> | undefined;
	for (const [index, arrow] of layout.edgeArrows.entries()) {
		const ends = new Set([arrow.sourceNodeId, arrow.targetNodeId]);
		let near = routeClearanceCount(arrow.points, nodeShapes, ends);
		// Each move clears at least one run, so a line stops once none is near.
		for (let moves = 0; near > 0 && (last || moves === 0); moves += 1) {
			current ??= score(arrows);
			let moved = false;
			for (const points of runsClearOfOutlines(arrows[index]!.points, nodeShapes, ends)) {
				const nearer = routeClearanceCount(points, nodeShapes, ends);
				if (!orthogonalRoute(points) || nearer >= near) continue;
				const candidate = arrows.map((other, at) => (at === index ? { ...other, points } : other));
				const next = score(candidate);
				if (
					next.defects <= current.defects &&
					next.crossings <= current.crossings &&
					next.findings <= current.findings &&
					next.heads <= current.heads &&
					next.inward <= current.inward &&
					next.labels <= current.labels
				) {
					[arrows, current, near, moved] = [candidate, next, nearer, true];
					break;
				}
			}
			if (!moved) break;
		}
	}
	return arrows === layout.edgeArrows ? layout : { ...layout, edgeArrows: arrows };
}

/** Passes over the drawn labels in which other routes move clear of them. */
const LABEL_CLEARING_ROUNDS = 3;

/**
 * Variants of a route whose middle runs that pass nearer a label than its own
 * line move clear of it by the wider berth, to either side of the label. A run
 * moves whole, from turn to turn, and the endpoint stubs stay as they were.
 */
function runsClearOfLabel(
	points: readonly [ScenePoint, ...ScenePoint[]],
	label: LabelShortfall,
): [ScenePoint, ...ScenePoint[]][] {
	const { box, own } = label;
	const corners = straightRuns(points);
	const variants: [ScenePoint, ...ScenePoint[]][] = [];
	// Past the berth by the room a moved label keeps first, so the label plainly
	// reads as its own line's, then by a pixel where that room is not free.
	for (const berth of [LABEL_MOVE_MARGIN, 1].map((past) => own + LABEL_OTHER_LINE_CLEARANCE + past))
		for (const run of segmentsFromPoints(corners)) {
			if (run.isFirstSegment || run.isLastSegment || boxSegmentDistance(box, run) >= berth)
				continue;
			const [low, size] =
				run.orientation === "horizontal" ? [box.y, box.height] : [box.x, box.width];
			for (const lane of [low - berth, low + size + berth]) {
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
	return variants;
}

/**
 * The drawn layout with other routes moved clear of each label that sits
 * nearer one of them than its own line, so no label reads as another line's.
 * A run moves just clear by the wider berth, kept only where the labels fall
 * short by less and the move draws no more export defects, crossings,
 * reader-scale findings, inward endpoints, runs beside an outline or labels
 * touching anything.
 */
function clearLabels(layout: DiagramLayout): DiagramLayout {
	const { groups, lanes, nodeShapes, routedEdges } = layout;
	let arrows = layout.edgeArrows;
	const placed = (candidate: readonly ArrowSceneElement[]) =>
		placedBranchLabels([...candidate], routedEdges, nodeShapes, groups, true, lanes);
	if (placed(arrows).shortfalls.length === 0) return layout;
	const drawn = [...nodeShapes, ...groupBlocks(groups), ...laneBlocks(lanes)];
	const near = (candidate: readonly ArrowSceneElement[]) =>
		candidate.reduce(
			(total, arrow) =>
				total +
				routeClearanceCount(
					arrow.points,
					nodeShapes,
					new Set([arrow.sourceNodeId, arrow.targetNodeId]),
				),
			0,
		);
	const score = (candidate: readonly ArrowSceneElement[]) => {
		const labels = placed(candidate);
		return {
			labels,
			shortfall: labels.shortfalls.reduce((total, label) => total + label.shortfall, 0),
			touches: labels.touches,
			crossings: arrowCrossings(candidate),
			defects: exportRouteDefects(candidate, nodeShapes, groups, lanes).length,
			findings: readerFindingCount(candidate, drawn),
			// Frames and lanes widen the reader scale; a move must read no worse without them either.
			nodeFindings: readerFindingCount(candidate, nodeShapes),
			inward: inwardEndpoints(candidate, nodeShapes),
			near: near(candidate),
		};
	};
	let current = score(arrows);
	for (let round = 0; round < LABEL_CLEARING_ROUNDS && current.shortfall > 0; round += 1) {
		let moved = false;
		for (const label of current.labels.shortfalls) {
			for (const [index, arrow] of arrows.entries()) {
				if (index === label.index) continue;
				for (const points of runsClearOfLabel(arrow.points, label)) {
					if (!orthogonalRoute(points)) continue;
					const candidate = arrows.map((other, at) =>
						at === index ? { ...other, points } : other,
					);
					const next = score(candidate);
					if (
						next.shortfall < current.shortfall &&
						next.defects <= current.defects &&
						next.crossings <= current.crossings &&
						next.findings <= current.findings &&
						next.nodeFindings <= current.nodeFindings &&
						next.inward <= current.inward &&
						next.near <= current.near &&
						next.touches <= current.touches
					) {
						[arrows, current, moved] = [candidate, next, true];
						break;
					}
				}
				if (moved) break;
			}
			if (moved) break;
		}
		if (!moved) break;
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
	groups: GroupLayout | undefined,
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
	// A decision's branches trade vertices among themselves, and, after every
	// other move, take its free vertex.
	const decisionMoves = (free: boolean) => {
		for (const source of new Set([first, second].map((route) => route.source))) {
			if (!branches(source.kind)) continue;
			const own = routes.filter(
				(route) => route.source === source && movable(route) && !feedback.has(route.edge.id),
			);
			if (own.length < 2 || own.length > 3) continue;
			const current = own.map((route) => route.sourceEdge);
			const taken = new Set(
				routes
					.filter((route) => route.source === source && !own.includes(route) && !isSelfLoop(route))
					.map((route) => route.sourceEdge),
			);
			const vertices = free
				? branchVertices(nodeFlow(diagram, groups, source.nodeId)).filter(
						(side) => !taken.has(side),
					)
				: current;
			for (const order of sideAssignments(vertices, own.length)) {
				if (free && order.every((side) => current.includes(side))) continue;
				const move: SideMove = new Map(
					own.flatMap((route, index) =>
						order[index] === route.sourceEdge
							? []
							: [[route.edge.id, { sourceEdge: order[index]! }]],
					),
				);
				if (move.size > 0) add(move);
			}
		}
	};
	decisionMoves(false);
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
	if (!laned(diagram)) decisionMoves(true);
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
	const offsets = portOffsetsAt(
		routes,
		polish,
		settled.arrangement.crossingRepair,
		layout.lanes !== undefined,
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
				best.layout.groups,
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

/** Whether the first score that differs is lower in `left`. */
function lowerScore(left: readonly number[], right: readonly number[]): boolean {
	const index = left.findIndex((value, at) => value !== right[at]);
	return index >= 0 && left[index]! < right[index]!;
}

/** The direction a node reads in: across the flow inside a group laid out across it. */
function nodeFlow(
	diagram: IntermediateDiagram,
	groups: GroupLayout | undefined,
	nodeId: string,
): LayoutDirection {
	const group = groups?.groupOf.get(nodeId);
	return group !== undefined && groups!.across.has(group)
		? ACROSS_DIRECTION[diagram.layout.direction]
		: diagram.layout.direction;
}

/** The vertices a decision's forward branches may leave by: across the flow either way, and forward. */
function branchVertices(direction: LayoutDirection): readonly ConnectionEdge[] {
	const [low, high]: readonly ConnectionEdge[] =
		direction === "TB" || direction === "BT" ? ["left", "right"] : ["top", "bottom"];
	return [low!, FORWARD_SIDE[direction], high!];
}

/** Whether a line leaving its source by this side starts away from its target. */
function leavesAway(route: RoutedEdge, side: ConnectionEdge): boolean {
	const normal = EDGE_NORMAL[side];
	const [axis, size] = normal.x === 0 ? (["y", "height"] as const) : (["x", "width"] as const);
	return (
		(center(route.target)[axis] - center(route.source)[axis]) * normal[axis] <
		-route.source[size] / 2
	);
}

/**
 * Lines that step back out from the side they arrive by just before turning
 * into it: past a run toward the target, a short run away from the side, one
 * along it and the stub, so the line dips beyond the side and hooks back in.
 */
function dippedArrivals(arrows: readonly ArrowSceneElement[]): Set<string> {
	return new Set(
		arrows.flatMap((arrow) => {
			const corners = straightRuns(arrow.points);
			if (corners.length < 5) return [];
			const [from, out, along, end] = corners.slice(-4) as [
				ScenePoint,
				ScenePoint,
				ScenePoint,
				ScenePoint,
			];
			const stub = { x: end.x - along.x, y: end.y - along.y };
			const away = { x: out.x - from.x, y: out.y - from.y };
			return stub.x * away.x + stub.y * away.y < 0 &&
				Math.abs(away.x) + Math.abs(away.y) < 2 * ROUTE_STUB_LENGTH
				? [arrow.edgeId]
				: [];
		}),
	);
}

/** Every injective assignment of `count` items to the given sides, in order. */
function sideAssignments(sides: readonly ConnectionEdge[], count: number): ConnectionEdge[][] {
	if (count === 0) return [[]];
	return sides.flatMap((side, index) =>
		sideAssignments([...sides.slice(0, index), ...sides.slice(index + 1)], count - 1).map(
			(rest) => [side, ...rest],
		),
	);
}

/** A settled layout carried through its repairs, finished as it is drawn. */
interface CompletedLayout {
	readonly layout: DiagramLayout;
	readonly settled: SettledLayout;
}

/** Branch-side assignments laid out per decision, and of those, completed. */
const BRANCH_SCREENS = 2;
const BRANCH_COMPLETIONS = 1;

/**
 * How far a branch leaving by this vertex runs at least: its stub, then
 * straight across and along to its target's middle.
 */
function branchReach(route: RoutedEdge, side: ConnectionEdge): number {
	const out = pointAwayFromEdge(pointOnEdge(route.source, side), side, ROUTE_STUB_LENGTH);
	const end = center(route.target);
	return ROUTE_STUB_LENGTH + Math.abs(end.x - out.x) + Math.abs(end.y - out.y);
}

/**
 * A decision's forward branches leave by whichever of its lateral and forward
 * vertices route them best together. Where one of them doubles back around
 * its decision, detours or dips into its target as drawn, or two of them
 * cross, the other assignments of the branches to those vertices that double
 * back no more and reach their targets most directly are laid out. The best
 * of those, arranged with no more crossings, detours and dips, is completed
 * like the drawn layout and kept when it has fewer crossings, then fewer
 * detours and dips, then shorter lines (a loop shows in the length it adds),
 * no more export defects, and draws no more reader findings, lines through a
 * head, hooks or crowded labels, and no longer a drawing.
 */
function chooseBranchSides(
	diagram: IntermediateDiagram,
	polish: RoutingPolish,
	arranged: SettledLayout,
	drawn: CompletedLayout,
	complete: (
		settled: SettledLayout,
		hopeless?: (layout: DiagramLayout) => boolean,
	) => CompletedLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): CompletedLayout {
	const feedback = flowFeedback(diagram);
	const { continuations } = arranged.arrangement.wrap;
	// A loop shows in the length it adds.
	const score = (layout: DiagramLayout) => [
		arrowCrossings(layout.edgeArrows),
		detouredLines(layout.edgeArrows) + dippedArrivals(layout.edgeArrows).size,
		layout.edgeArrows.reduce((sum, arrow) => sum + routeLength(arrow.points), 0),
	];
	const noWorse = (candidate: DiagramLayout, current: DiagramLayout) => {
		const [labels, currentLabels] = [candidate, current].map(labelCrowding);
		return (
			!fewer(defectsOf(current), defectsOf(candidate)) &&
			routesNoWorse(candidate, current, false, true) &&
			headCrossers(candidate).size <= headCrossers(current).size &&
			hookedRoutes(candidate) <= hookedRoutes(current) &&
			labels!.every((count, index) => count <= currentLabels![index]!) &&
			reads(candidate, current)
		);
	};
	// No longer a drawing, and no longer for its breadth unless shorter.
	const reads = (candidate: DiagramLayout, current: DiagramLayout) => {
		const [size, currentSize] = [candidate, current].map(drawnExtent);
		const [long, currentLong] = [size!, currentSize!].map(({ width, height }) =>
			Math.max(width, height),
		);
		return (
			long! <= currentLong! + AXIS_ALIGNED_EPSILON &&
			(long! < currentLong! - AXIS_ALIGNED_EPSILON ||
				exportAspect(size!.width, size!.height) <=
					exportAspect(currentSize!.width, currentSize!.height) + AXIS_ALIGNED_EPSILON)
		);
	};
	let [base, best] = [arranged, drawn];
	let bestScore = score(best.layout);
	const decisions = new Set(
		drawn.layout.routedEdges
			.filter((route) => branches(route.source.kind))
			.map((route) => route.source.nodeId),
	);
	for (const decision of decisions) {
		const { groups, routedEdges } = best.layout;
		const departures = routedEdges.filter(
			(route) => route.source.nodeId === decision && !isSelfLoop(route),
		);
		const own = departures.filter(
			(route) =>
				!feedback.has(route.edge.id) &&
				route.pinned === undefined &&
				route.pair === undefined &&
				!continuations.has(route.edge.id),
		);
		if (own.length < 2 || own.length > 3) continue;
		const ids = new Set(own.map((route) => route.edge.id));
		const arrangedScore = score(base.layout);
		const looping = (order: readonly ConnectionEdge[]) =>
			own.filter((route, index) => leavesAway(route, order[index]!)).length;
		// As drawn, or as arranged before a crossing repair moved them.
		const [loops, flawed] = [best.layout, base.layout]
			.map((layout) => {
				const lines = layout.edgeArrows.filter((arrow) => ids.has(arrow.edgeId));
				const count = layout.routedEdges.filter(
					(route) => ids.has(route.edge.id) && leavesAway(route, route.sourceEdge),
				).length;
				const flaw =
					count > 0 ||
					detouredLines(lines) > 0 ||
					dippedArrivals(lines).size > 0 ||
					arrowCrossings(lines) > 0;
				return [count, flaw] as const;
			})
			.reduce(([count, flaw], [next, nextFlaw]) => [Math.max(count, next), flaw || nextFlaw]);
		if (!flawed) continue;
		const taken = new Set(
			departures.filter((route) => !ids.has(route.edge.id)).map((route) => route.sourceEdge),
		);
		const vertices = branchVertices(nodeFlow(diagram, groups, decision)).filter(
			(side) => !taken.has(side),
		);
		// Only the assignments that reach their targets most directly are laid out.
		const reach = (order: readonly ConnectionEdge[]) =>
			own.reduce((sum, route, index) => sum + branchReach(route, order[index]!), 0);
		// Where a crossing repair moved the branches, the arranged layout's own
		// assignment is one of the others: it lays out as the arranged layout, and
		// completes to the drawn layout, so it is neither laid out nor completed again.
		const arrangedSides = own.map(
			(route) =>
				base.layout.routedEdges.find((other) => other.edge.id === route.edge.id)?.sourceEdge,
		);
		const arrangedCandidates = sideAssignments(vertices, own.length)
			.filter(
				(order) =>
					looping(order) <= loops && order.some((side, index) => side !== own[index]!.sourceEdge),
			)
			.sort((a, b) => reach(a) - reach(b))
			.slice(0, BRANCH_SCREENS)
			.map((order) => {
				if (order.every((side, index) => side === arrangedSides[index]))
					return { ...base, score: arrangedScore };
				const sides = new Map(base.arrangement.sides);
				own.forEach((route, index) =>
					sides.set(route.edge.id, { ...sides.get(route.edge.id), sourceEdge: order[index]! }),
				);
				const arrangement = { ...base.arrangement, sides };
				const layout = layoutDiagram(diagram, polish, arrangement);
				return { arrangement, defects: defectsOf(layout), layout, score: score(layout) };
			})
			// Before its repairs, it must cross and flaw no more than the arranged layout did.
			.filter((candidate) => !lowerScore(arrangedScore.slice(0, 2), candidate.score.slice(0, 2)))
			.sort((a, b) => (lowerScore(a.score, b.score) ? -1 : lowerScore(b.score, a.score) ? 1 : 0))
			.slice(0, BRANCH_COMPLETIONS);
		let chosen: { base: SettledLayout; drawn: CompletedLayout; score: number[] } | undefined;
		for (const { score: _, ...settled } of arrangedCandidates) {
			if (settled.layout === base.layout) continue;
			const candidate = complete(settled, (layout) =>
				lowerScore((chosen?.score ?? bestScore).slice(0, 2), score(layout).slice(0, 2)),
			);
			const candidateScore = score(candidate.layout);
			if (
				lowerScore(candidateScore, chosen?.score ?? bestScore) &&
				noWorse(candidate.layout, best.layout)
			)
				chosen = { base: settled, drawn: candidate, score: candidateScore };
		}
		if (chosen) [base, best, bestScore] = [chosen.base, chosen.drawn, chosen.score];
	}
	return best;
}

/**
 * The drawn layout with the forward lines that merge into one target nested.
 * Where such a line crosses another line into its target, or enters by the
 * side opposite one that faces its source and so winds round the target, it
 * moves into a side that faces its source and departs no line, alone or
 * trading sides with the merging lines already there. The target's merging
 * lines route again, with the lines whose ports shift, around the others as
 * they lie: the moved line first or last, and, where they share its side, in
 * either order along it. Which line runs inside depends on what stands beside
 * the corridor they share, so every order is tried. Of those that cross fewer
 * lines, or as few with fewer far sides and shorter merging lines, the one
 * with the fewest crossings, then far sides, then lines turning over a
 * corner, then the shortest merging lines is kept, where it turns no more
 * lines over a corner unless it crosses fewer, draws no worse, passes no
 * nearer a node and steps no more lines sideways beside a port. A family that places its own boxes keeps its lines, as does a
 * graph too large for the crossing repair.
 */
function nestSharedArrivals(
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { lanes, polish, routeOptions } = layout;
	if (
		!polish?.sides ||
		!layout.portOffsets ||
		!routeOptions ||
		lanes ||
		graphOptions.get(diagram)?.placement ||
		diagram.edges.length > CROSSING_REPAIR_MAX_EDGES
	)
		return layout;
	const feedback = flowFeedback(diagram);
	const sides: readonly ConnectionEdge[] = ["top", "right", "bottom", "left"];
	const merging = (route: RoutedEdge) =>
		!feedback.has(route.edge.id) &&
		!isSelfLoop(route) &&
		route.pinned === undefined &&
		route.pair === undefined;
	// How far the route's source's middle lies out past a side of its target:
	// positive where the side faces the source.
	const beyond = (route: RoutedEdge, side: ConnectionEdge) => {
		const [from, to, normal] = [center(route.source), center(route.target), EDGE_NORMAL[side]];
		const half = normal.x !== 0 ? route.target.width / 2 : route.target.height / 2;
		return (from.x - to.x) * normal.x + (from.y - to.y) * normal.y - half;
	};
	// A line into the side opposite one that faces its source winds round its target.
	const facesAway = (route: RoutedEdge) => beyond(route, OPPOSITE_EDGE[route.targetEdge]) > 0;
	const cornered = ({ edgeArrows, routedEdges }: DiagramLayout) => {
		const ends = sideEnds(routedEdges);
		return edgeArrows.filter((arrow, index) => turnsCorner(routedEdges[index]!, arrow, ends))
			.length;
	};
	let current = layout;
	const targets = new Set(layout.routedEdges.filter(merging).map((route) => route.target.nodeId));
	for (const targetId of targets) {
		const members = new Set(
			current.routedEdges.flatMap((route, index) =>
				route.target.nodeId === targetId && merging(route) ? [index] : [],
			),
		);
		if (members.size < 2) continue;
		const crossed = new Set(
			crossingPairs(current.edgeArrows).flatMap(({ first, second }) =>
				members.has(first) && members.has(second) ? [first, second] : [],
			),
		);
		const misplaced = [...members].filter(
			(index) => crossed.has(index) || facesAway(current.routedEdges[index]!),
		);
		if (misplaced.length === 0) continue;
		const target = current.routedEdges[misplaced[0]!]!.target;
		const departed = new Set(
			current.routedEdges.flatMap((route) => (route.source === target ? [route.sourceEdge] : [])),
		);
		// A side a merging line may take: free of departures, facing its source.
		const open = (index: number, side: ConnectionEdge) =>
			!departed.has(side) && beyond(current.routedEdges[index]!, side) > 0;
		// Crossings, then merging lines into far sides, then lines turning over a
		// corner, then the merging lines' length.
		const score = (settled: DiagramLayout) => [
			arrowCrossings(settled.edgeArrows),
			[...members].filter((index) => facesAway(settled.routedEdges[index]!)).length,
			cornered(settled),
			[...members].reduce((sum, index) => sum + routeLength(settled.edgeArrows[index]!.points), 0),
		];
		const [crossings, far, corners, length] = score(current);
		const improves = ([candidateCrossings, candidateFar, , candidateLength]: number[]) =>
			candidateCrossings! < crossings! ||
			(candidateCrossings === crossings &&
				candidateFar! < far! &&
				candidateLength! < length! - AXIS_ALIGNED_EPSILON);
		// Each misplaced line into each open side, alone, or trading sides with
		// the merging lines already there where its own side is open to them.
		const moves = misplaced.flatMap((index) =>
			sides.flatMap((side) => {
				if (!open(index, side)) return [];
				const alone = new Map([[index, side]]);
				const from = current.routedEdges[index]!.targetEdge;
				const there = [...members].filter(
					(at) => at !== index && current.routedEdges[at]!.targetEdge === side,
				);
				return there.length > 0 && there.every((at) => open(at, from))
					? [alone, new Map([...alone, ...there.map((at) => [at, from] as const)])]
					: [alone];
			}),
		);
		let kept: { layout: DiagramLayout; score: number[] } | undefined;
		for (const move of moves) {
			const routes = current.routedEdges.map((route, at) =>
				move.has(at) ? { ...route, targetEdge: move.get(at)! } : route,
			);
			const offsets = portOffsetsAt(routes, polish, current.byApproach ?? false, false);
			const [index] = move.keys();
			const side = move.get(index!)!;
			// The merging lines that share the moved line's side, in order along it,
			// and the same ports taken the other way along.
			const beside = [...members]
				.filter((at) => routes[at]!.targetEdge === side)
				.map((at) => connectionKey({ edgeId: routes[at]!.edge.id, endpoint: "target" }))
				.sort((a, b) => offsets.get(a)! - offsets.get(b)!);
			const reversed = new Map(offsets);
			for (const [at, key] of beside.entries())
				reversed.set(key, offsets.get(beside[beside.length - 1 - at]!)!);
			const others = [...members].filter((at) => at !== index);
			for (const ports of beside.length > 1 ? [offsets, reversed] : [offsets]) {
				const again = new Set(
					routes.flatMap((route, at) =>
						members.has(at) ||
						(["source", "target"] as const).some((endpoint) => {
							const key = connectionKey({ edgeId: route.edge.id, endpoint });
							return ports.get(key) !== current.portOffsets!.get(key);
						})
							? [at]
							: [],
					),
				);
				const indices = routes.map((_, at) => at);
				for (const merge of [
					[index!, ...others],
					[...others, index!],
				]) {
					// The lines kept as they lie come first, then the merging lines in
					// this order, then those whose ports shift.
					const order = [
						...indices.filter((at) => !again.has(at)),
						...merge,
						...indices.filter((at) => again.has(at) && !members.has(at)),
					];
					const drafted = {
						...current,
						edgeArrows: routeAllEdges(
							routes,
							"orthogonal",
							ports,
							current.nodeShapes,
							{ ...routeOptions, midway: true },
							order,
							new Map(
								current.edgeArrows
									.filter((_, at) => !again.has(at))
									.map((arrow) => [arrow.edgeId, arrow]),
							),
						),
						portOffsets: ports,
						routedEdges: routes,
					};
					// A first look as routed, before the clearance passes finish it.
					if (!improves(score(drafted))) continue;
					const candidate = finished(drafted);
					const candidateScore = score(candidate);
					if (
						improves(candidateScore) &&
						(candidateScore[2]! <= corners! || candidateScore[0]! < crossings!) &&
						(!kept || lowerScore(candidateScore, kept.score)) &&
						drawsNoWorse(candidate, current, defectsOf, fewer) &&
						nearOutlines(candidate) <= nearOutlines(current) &&
						portJogCount(candidate) <= portJogCount(current)
					)
						kept = { layout: candidate, score: candidateScore };
				}
			}
		}
		if (kept) current = kept.layout;
	}
	return current;
}

/**
 * The drawn layout with each return into a decision that lands farther from
 * its source than a vertex no other line uses moved into the nearest such
 * vertex, leaving its source as it does or by a side that faces the vertex: a
 * return that winds round to the decision's far side, or shares a vertex with
 * a branch, reads as a detour into the wrong face. One line at a time routes
 * again, with the lines whose ports shift, around the others as they lie. Of
 * the sides tried, the shortest line is kept that bends no more and is
 * shorter than before, where the layout crosses no more lines, draws no worse
 * and passes no nearer a node. A family that places its own boxes keeps its
 * lines.
 */
function returnsToNearVertices(
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { lanes, polish, routeOptions } = layout;
	if (
		!polish?.sides ||
		!layout.portOffsets ||
		!routeOptions ||
		lanes ||
		graphOptions.get(diagram)?.placement
	)
		return layout;
	const feedback = flowFeedback(diagram);
	const sides: readonly ConnectionEdge[] = ["top", "right", "bottom", "left"];
	let current = layout;
	for (const index of layout.routedEdges.keys()) {
		const route = current.routedEdges[index]!;
		const { source, target } = route;
		if (
			!feedback.has(route.edge.id) ||
			isSelfLoop(route) ||
			!branches(target.kind) ||
			route.pinned !== undefined ||
			route.pair !== undefined
		)
			continue;
		const line = current.edgeArrows[index]!;
		// How far a point lies from the source's box.
		const away = (point: ScenePoint) =>
			Math.hypot(
				Math.max(source.x - point.x, 0, point.x - source.x - source.width),
				Math.max(source.y - point.y, 0, point.y - source.y - source.height),
			);
		const [vertex] = sides
			.filter(
				(side) =>
					!current.routedEdges.some(
						(other) =>
							other !== route &&
							((other.target === target && other.targetEdge === side) ||
								(other.source === target && other.sourceEdge === side)),
					),
			)
			.map((side) => ({ point: pointOnEdge(target, side), side }))
			.filter(({ point }) => away(point) < away(line.points.at(-1)!) - PORT_SPACING)
			.sort((a, b) => away(a.point) - away(b.point));
		if (!vertex) continue;
		const facing = sides.filter((side) => {
			const [from, normal] = [pointOnEdge(source, side), EDGE_NORMAL[side]];
			return (vertex.point.x - from.x) * normal.x + (vertex.point.y - from.y) * normal.y > 0;
		});
		let kept: { layout: DiagramLayout; length: number } | undefined;
		for (const sourceEdge of new Set([route.sourceEdge, ...facing])) {
			const routes = current.routedEdges.map((other, at) =>
				at === index ? { ...other, sourceEdge, targetEdge: vertex.side } : other,
			);
			const offsets = portOffsetsAt(routes, polish, current.byApproach ?? false, false);
			const again = new Set(
				routes.flatMap((other, at) =>
					at === index ||
					(["source", "target"] as const).some((endpoint) => {
						const key = connectionKey({ edgeId: other.edge.id, endpoint });
						return offsets.get(key) !== current.portOffsets!.get(key);
					})
						? [other.edge.id]
						: [],
				),
			);
			// The lines kept as they lie come first; the others route around them in edge order.
			const order = routes
				.map((other, at) => ({ again: again.has(other.edge.id), at }))
				.sort((a, b) => Number(a.again) - Number(b.again))
				.map(({ at }) => at);
			const arrows = routeAllEdges(
				routes,
				"orthogonal",
				offsets,
				current.nodeShapes,
				{ ...routeOptions, midway: true },
				order,
				new Map(
					current.edgeArrows
						.filter((arrow) => !again.has(arrow.edgeId))
						.map((arrow) => [arrow.edgeId, arrow]),
				),
			);
			if (arrowCrossings(arrows) > arrowCrossings(current.edgeArrows)) continue;
			const candidate = finished({
				...current,
				edgeArrows: arrows,
				portOffsets: offsets,
				routedEdges: routes,
			});
			const points = candidate.edgeArrows[index]!.points;
			const length = routeLength(points);
			if (
				length < routeLength(line.points) - AXIS_ALIGNED_EPSILON &&
				routeBendCount(points) <= routeBendCount(line.points) &&
				(!kept || length < kept.length - AXIS_ALIGNED_EPSILON) &&
				drawsNoWorse(candidate, current, defectsOf, fewer) &&
				nearOutlines(candidate) <= nearOutlines(current)
			)
				kept = { layout: candidate, length };
		}
		if (kept) current = kept.layout;
	}
	return current;
}

/**
 * The drawn layout with its arrivals polished. An arrival that turns over its
 * target's corner, from beyond the target, into a side another line meets it
 * by, or that dips past its side and hooks back in, enters by the side its
 * approach faces instead, where that side is free or flat with only arrivals;
 * and every line between facing sides that jogs beside a port may step across
 * midway. Only those lines, and lines whose ports shift, route again around
 * the others as they lie. Kept when it draws fewer reader findings or dips,
 * or bends those lines less, without lengthening them, and has no more export
 * defects and draws no more crossings, reader findings, lines through a head,
 * hooks, detours, dips or crowded labels, and no longer a drawing.
 */
function polishArrivals(
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { edgeArrows, lanes, nodeShapes, polish, portOffsets, routeOptions } = layout;
	if (!polish?.sides || !portOffsets || !routeOptions?.readerScale || lanes) return layout;
	const routes = layout.routedEdges.map((route) => ({ ...route }));
	const drawn = [...nodeShapes, ...groupBlocks(layout.groups)];
	const scale = routingQualityScale(drawnSize(drawn, edgeArrows));
	const changed = new Set(
		resideArrivals(routes, edgeArrows, diagram, scale, "cornered").map(
			({ route }) => route.edge.id,
		),
	);
	const feedback = flowFeedback(diagram);
	const dipped = dippedArrivals(edgeArrows);
	for (const [index, arrow] of edgeArrows.entries()) {
		const route = routes[index]!;
		if (
			!dipped.has(arrow.edgeId) ||
			feedback.has(route.edge.id) ||
			route.pinned?.target !== undefined
		)
			continue;
		const [before, from] = straightRuns(arrow.points).slice(-5) as [ScenePoint, ScenePoint];
		const side: ConnectionEdge =
			Math.abs(before.y - from.y) <= AXIS_ALIGNED_EPSILON
				? from.x > before.x
					? "left"
					: "right"
				: from.y > before.y
					? "top"
					: "bottom";
		const others = routes.filter(
			(other) =>
				other !== route &&
				((other.source === route.target && other.sourceEdge === side) ||
					(other.target === route.target && other.targetEdge === side)),
		);
		if (
			side === route.targetEdge ||
			(others.length > 0 &&
				(curvedSide(route.target, side) || others.some((other) => other.source === route.target)))
		)
			continue;
		route.targetEdge = side;
		changed.add(route.edge.id);
	}
	// Where a line drops straight into the side of its target facing its own
	// side, nothing between: in line with where it starts, else from the nearest
	// port of the two sides' overlap, a port's spacing clear of the other lines
	// at its source's side and in the same order, its start moved there. Its
	// ends' offsets, and whether it starts in line.
	const straightAcross = (route: RoutedEdge, arrow: ArrowSceneElement) => {
		const side = OPPOSITE_EDGE[route.sourceEdge];
		const { source, target } = route;
		const axis = slotAxis(side);
		const [low, size] = axis === "x" ? [target.x, target.width] : [target.y, target.height];
		const drawnStart = arrow.points[0][axis];
		const inLine = drawnStart > low + PORT_PADDING && drawnStart < low + size - PORT_PADDING;
		const along = inLine
			? drawnStart
			: clamp(drawnStart, low + 2 * PORT_PADDING, low + size - 2 * PORT_PADDING);
		const from = center(source)[axis];
		// Where each other line meets the source's side.
		const besides = routes.flatMap((other, at) =>
			other !== route &&
			((other.source === source && other.sourceEdge === route.sourceEdge) ||
				(other.target === source && other.targetEdge === route.sourceEdge))
				? [
						(other.source === source ? edgeArrows[at]!.points[0] : edgeArrows[at]!.points.at(-1)!)[
							axis
						],
					]
				: [],
		);
		if (
			!inLine &&
			(route.pinned !== undefined ||
				size < 4 * PORT_PADDING ||
				Math.abs(along - from) > portLimit(source, route.sourceEdge) ||
				besides.some(
					(other) =>
						Math.abs(along - other) < PORT_SPACING ||
						Math.sign(along - other) !== Math.sign(drawnStart - other),
				))
		)
			return undefined;
		const start = inLine ? arrow.points[0] : pointOnEdge(source, route.sourceEdge, along - from);
		const end = pointOnEdge(target, side, along - low - size / 2);
		const across = axis === "x" ? "y" : "x";
		return EDGE_NORMAL[side][across] * (start[across] - end[across]) <= 0 ||
			nodeShapes.some(
				(node) =>
					node.nodeId !== source.nodeId &&
					node.nodeId !== target.nodeId &&
					directSegmentCrossesNode(start, end, node),
			)
			? undefined
			: { inLine, source: along - from, target: along - low - size / 2 };
	};
	const straightPorts = new Map<string, number>();
	// Lines that move onto the facing side only by moving their start, by their sides before.
	const slid = new Map<string, ConnectionEdge>();
	const runStraight = (route: RoutedEdge, ports: { source: number; target: number }) => {
		straightPorts.set(connectionKey({ edgeId: route.edge.id, endpoint: "source" }), ports.source);
		straightPorts.set(connectionKey({ edgeId: route.edge.id, endpoint: "target" }), ports.target);
	};
	// A line the dip moves onto the side facing its own side drops straight in
	// where it can.
	for (const [index, arrow] of edgeArrows.entries()) {
		const route = routes[index]!;
		if (!changed.has(route.edge.id) || route.targetEdge !== OPPOSITE_EDGE[route.sourceEdge])
			continue;
		const ports = straightAcross(route, arrow);
		if (ports) runStraight(route, ports);
	}
	// A line that starts in line with the free side of its target it faces,
	// nothing between, drops straight into it, and one that starts just past
	// that side's span from the overlap.
	for (const [index, arrow] of edgeArrows.entries()) {
		const route = routes[index]!;
		const side = OPPOSITE_EDGE[route.sourceEdge];
		const { target } = route;
		if (
			route.targetEdge === side ||
			changed.has(route.edge.id) ||
			feedback.has(route.edge.id) ||
			route.pinned?.target !== undefined ||
			isSelfLoop(route) ||
			routes.some(
				(other) =>
					(other.target === target && other.targetEdge === side) ||
					(other.source === target && other.sourceEdge === side),
			)
		)
			continue;
		const ports = straightAcross(route, arrow);
		if (!ports) continue;
		if (!ports.inLine) {
			slid.set(route.edge.id, route.targetEdge);
			runStraight(route, ports);
		}
		route.targetEdge = side;
		changed.add(route.edge.id);
	}
	for (const finding of routingQualityFindings(
		edgeArrows.map((arrow) => ({ id: arrow.edgeId, points: arrow.points })),
		scale,
	))
		if (finding.kind === "endpoint-jog") {
			const route = routes.find((candidate) => candidate.edge.id === finding.arrowIds[0])!;
			if (route.targetEdge === OPPOSITE_EDGE[route.sourceEdge]) changed.add(route.edge.id);
		}
	// The lines that move, and those whose ports shift, route again around the
	// others as they lie; kept when they read better and draw no worse.
	const attempt = (
		moved: RoutedEdge[],
		lines: ReadonlySet<string>,
		ports: ReadonlyMap<string, number>,
	): DiagramLayout | undefined => {
		if (lines.size === 0) return undefined;
		const offsets = portOffsetsAt(moved, polish, layout.byApproach ?? false, false);
		for (const [key, offset] of ports) offsets.set(key, offset);
		const again = new Set(
			moved.flatMap((route) =>
				lines.has(route.edge.id) ||
				(["source", "target"] as const).some((endpoint) => {
					const key = connectionKey({ edgeId: route.edge.id, endpoint });
					return offsets.get(key) !== portOffsets.get(key);
				})
					? [route.edge.id]
					: [],
			),
		);
		// The lines kept as they lie come first; the others route around them in edge order.
		const order = moved
			.map((route, index) => ({ again: again.has(route.edge.id), index }))
			.sort((a, b) => Number(a.again) - Number(b.again))
			.map(({ index }) => index);
		const candidate = finished({
			...layout,
			edgeArrows: routeAllEdges(
				moved,
				"orthogonal",
				offsets,
				nodeShapes,
				{ ...routeOptions, midway: true },
				order,
				new Map(edgeArrows.filter((arrow) => !again.has(arrow.edgeId)).map((a) => [a.edgeId, a])),
			),
			portOffsets: offsets,
			routedEdges: moved,
		});
		const measure = (arrows: readonly ArrowSceneElement[]) =>
			arrows
				.filter((arrow) => lines.has(arrow.edgeId))
				.reduce(
					(sum, arrow) => ({
						bends: sum.bends + routeBendCount(arrow.points),
						length: sum.length + routeLength(arrow.points),
					}),
					{ bends: 0, length: 0 },
				);
		const [before, after] = [measure(edgeArrows), measure(candidate.edgeArrows)];
		const [findings, currentFindings] = [candidate, layout].map((settled) =>
			readerFindingCount(settled.edgeArrows, [
				...settled.nodeShapes,
				...groupBlocks(settled.groups),
			]),
		);
		const [dips, currentDips] = [candidate, layout].map(
			(settled) => dippedArrivals(settled.edgeArrows).size,
		);
		return (findings! < currentFindings! || dips! < currentDips! || after.bends < before.bends) &&
			after.length <= before.length + AXIS_ALIGNED_EPSILON &&
			drawsNoWorse(candidate, layout, defectsOf, fewer)
			? candidate
			: undefined;
	};
	// Straight in first; failing that, as the moves go without moving any start.
	return (
		(straightPorts.size > 0 ? attempt(routes, changed, straightPorts) : undefined) ??
		attempt(
			routes.map((route) =>
				slid.has(route.edge.id) ? { ...route, targetEdge: slid.get(route.edge.id)! } : route,
			),
			new Set([...changed].filter((id) => !slid.has(id))),
			new Map(),
		) ??
		layout
	);
}

/**
 * Whether a route swings out past the box its two ends span, a stub's length
 * or more each way.
 */
function swingsOut(points: readonly ScenePoint[]): boolean {
	const [start, end] = [points[0]!, points.at(-1)!];
	const direct = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
	return (
		routeLength(points) >= direct + 2 * ROUTE_STUB_LENGTH &&
		points.some(
			(point) =>
				point.x < Math.min(start.x, end.x) - AXIS_ALIGNED_EPSILON ||
				point.x > Math.max(start.x, end.x) + AXIS_ALIGNED_EPSILON ||
				point.y < Math.min(start.y, end.y) - AXIS_ALIGNED_EPSILON ||
				point.y > Math.max(start.y, end.y) + AXIS_ALIGNED_EPSILON,
		)
	);
}

/** Arrival ports tried along a side, as fractions of its reach: the middle and either end. */
const ARRIVAL_PORT_STEPS = [0, -1, 1];

/**
 * The drawn layout with each line between facing sides that bends more than
 * twice, out past its ends, into a flat side it alone arrives by moved along
 * that side to the port from which it routes with the fewest bends, then the
 * shortest line: a port aligned with the line's start that a group's name or
 * another obstacle blocks sends the line around instead. Only that line routes again, around
 * the others as they lie, kept when it bends less without lengthening and
 * the layout draws no worse.
 */
function straightenArrivals(
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { lanes, nodeShapes, polish, routeOptions, routedEdges } = layout;
	if (!polish?.sides || !layout.portOffsets || !routeOptions?.readerScale || lanes) return layout;
	let current = layout;
	for (const [index, route] of routedEdges.entries()) {
		const line = current.edgeArrows[index]!;
		const { target, targetEdge } = route;
		if (
			targetEdge !== OPPOSITE_EDGE[route.sourceEdge] ||
			route.pinned?.target !== undefined ||
			routeBendCount(line.points) <= 2 ||
			// Only a line that swings out past its ends goes around its port.
			!swingsOut(line.points) ||
			curvedSide(target, targetEdge) ||
			routedEdges.some(
				(other) =>
					other !== route &&
					((other.target === target && other.targetEdge === targetEdge) ||
						(other.source === target && other.sourceEdge === targetEdge)),
			)
		)
			continue;
		const key = connectionKey({ edgeId: route.edge.id, endpoint: "target" });
		const reach = portLimit(target, targetEdge);
		const fixed = new Map(
			current.edgeArrows.filter((arrow) => arrow !== line).map((arrow) => [arrow.edgeId, arrow]),
		);
		const order = routedEdges
			.map((_, at) => at)
			.sort((a, b) => Number(a === index) - Number(b === index));
		const ports = ARRIVAL_PORT_STEPS.flatMap((step) => {
			const offset = step * reach;
			if (Math.abs(offset - (current.portOffsets!.get(key) ?? 0)) <= AXIS_ALIGNED_EPSILON)
				return [];
			const offsets = new Map(current.portOffsets).set(key, offset);
			const arrows = routeAllEdges(
				routedEdges,
				"orthogonal",
				offsets,
				nodeShapes,
				{ ...routeOptions, midway: true },
				order,
				fixed,
			);
			const points = arrows[index]!.points;
			const [bends, length] = [routeBendCount(points), routeLength(points)];
			return bends < routeBendCount(line.points) &&
				length <= routeLength(line.points) + AXIS_ALIGNED_EPSILON
				? [{ arrows, bends, length, offsets }]
				: [];
		});
		// The straightest port, where it crosses no more lines and draws no worse.
		const straightest = ports.sort((a, b) => a.bends - b.bends || a.length - b.length)[0];
		if (!straightest || arrowCrossings(straightest.arrows) > arrowCrossings(current.edgeArrows))
			continue;
		const candidate = finished({
			...current,
			edgeArrows: straightest.arrows,
			portOffsets: straightest.offsets,
		});
		if (drawsNoWorse(candidate, current, defectsOf, fewer)) current = candidate;
	}
	return current;
}

/**
 * The drawn layout with each line that meets a rounded node within a corner's
 * curve, nearer the corner along its side than the radius, moved along that
 * side onto its straight part: a line into the curve reads as aimed at the
 * corner. One line at a time routes again, around the others as they lie,
 * kept when the layout draws no worse. A family that draws its own boxes
 * (placed, square) keeps its lines.
 */
function endsOffCorners(
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { lanes, routeOptions, routedEdges } = layout;
	if (!layout.portOffsets || !routeOptions || lanes || graphOptions.get(diagram)?.placement)
		return layout;
	let current = layout;
	// Where each other line meets a node's side, along it from the node's middle.
	const besides = (node: NodeSceneElement, side: ConnectionEdge, except: string) =>
		routedEdges.flatMap((other, at) =>
			(["source", "target"] as const).flatMap((endpoint) => {
				const otherSide = endpoint === "source" ? other.sourceEdge : other.targetEdge;
				if (
					other.edge.id === except ||
					other[endpoint].nodeId !== node.nodeId ||
					otherSide !== side
				)
					return [];
				const points = current.edgeArrows[at]!.points;
				const point = endpoint === "source" ? points[0] : points.at(-1)!;
				return [point[slotAxis(side)] - center(node)[slotAxis(side)]];
			}),
		);
	for (const [index, route] of routedEdges.entries()) {
		const line = current.edgeArrows[index]!;
		const ends = (["source", "target"] as const).map((endpoint) => {
			const node = route[endpoint];
			const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
			const axis = slotAxis(side);
			const point = endpoint === "source" ? line.points[0] : line.points.at(-1)!;
			const radius = node.id.startsWith("node:") ? canvasCornerRadius(node) : 0;
			const half = (axis === "x" ? node.width : node.height) / 2;
			return {
				along: point[axis] - center(node)[axis],
				curved: radius > PORT_PADDING,
				key: connectionKey({ edgeId: route.edge.id, endpoint }),
				limit: Math.max(0, half - Math.max(PORT_PADDING, radius)),
				others: besides(node, side, route.edge.id),
			};
		});
		const cornered = ends.filter(
			(end) => end.curved && Math.abs(end.along) > end.limit + AXIS_ALIGNED_EPSILON,
		);
		// An end moves in only as far as it keeps a port's room from the other lines on its side.
		const roomy = (end: (typeof ends)[number], along: number) =>
			end.others.every(
				(other) =>
					Math.abs(along - other) >=
					Math.min(Math.abs(end.along - other), PORT_SPACING) - AXIS_ALIGNED_EPSILON,
			);
		if (
			cornered.length === 0 ||
			!cornered.every((end) => roomy(end, Math.sign(end.along) * end.limit))
		)
			continue;
		const offsets = new Map(current.portOffsets);
		for (const end of cornered) offsets.set(end.key, Math.sign(end.along) * end.limit);
		// A straight line moves both its ends, so it stays straight.
		if (line.points.length === 2 && cornered.length === 1) {
			const [moved] = cornered;
			const other = ends.find((end) => end !== moved)!;
			const along = other.along + Math.sign(moved!.along) * moved!.limit - moved!.along;
			if (Math.abs(along) <= other.limit + AXIS_ALIGNED_EPSILON && roomy(other, along))
				offsets.set(other.key, along);
		}
		const order = routedEdges
			.map((_, at) => at)
			.sort((a, b) => Number(a === index) - Number(b === index));
		const arrows = routeAllEdges(
			routedEdges,
			"orthogonal",
			offsets,
			current.nodeShapes,
			{ ...routeOptions, midway: true },
			order,
			new Map(
				current.edgeArrows.filter((arrow) => arrow !== line).map((arrow) => [arrow.edgeId, arrow]),
			),
		);
		// A line that crosses more is no better for its straight end: it is not finished.
		if (arrowCrossings(arrows) > arrowCrossings(current.edgeArrows)) continue;
		const candidate = finished({ ...current, edgeArrows: arrows, portOffsets: offsets });
		if (drawsNoWorse(candidate, current, defectsOf, fewer)) current = candidate;
	}
	return current;
}

/** Ports a lone arrival tries nearer its side's middle, nearest the middle first. */
const CENTERED_PORT_TRIES = 3;

/**
 * The drawn layout with each bent line that alone meets its target's flat
 * side, in the outer quarter of that side, moved along it to the port nearest
 * the middle from which it routes with no more bends and no longer than the
 * move: the middle, else just past what blocks its last run there, such as a
 * group's name, where nothing else does. A line that lands by a corner reads
 * as aimed at it. One line at a time routes again, around the others as they
 * lie, its step moved clear of its ends where the new port brings one near
 * (withStepMoved), kept when the layout draws no worse and passes no nearer a
 * node.
 */
function centerLoneArrivals(
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { groups, lanes, nodeShapes, polish, routeOptions, routedEdges } = layout;
	if (
		!polish?.sides ||
		!layout.portOffsets ||
		!routeOptions ||
		lanes ||
		graphOptions.get(diagram)?.placement
	)
		return layout;
	const scale = routingQualityScale(
		drawnSize([...nodeShapes, ...groupBlocks(groups)], layout.edgeArrows),
	);
	let current = layout;
	for (const [index, route] of routedEdges.entries()) {
		const line = current.edgeArrows[index]!;
		const { source, target, targetEdge: side } = route;
		if (
			isSelfLoop(route) ||
			route.pinned?.target !== undefined ||
			routeBendCount(line.points) === 0 ||
			curvedSide(target, side) ||
			routedEdges.some(
				(other) =>
					other !== route &&
					((other.target === target && other.targetEdge === side) ||
						(other.source === target && other.sourceEdge === side)),
			)
		)
			continue;
		const [axis, across] = slotAxis(side) === "x" ? (["x", "y"] as const) : (["y", "x"] as const);
		const middle = center(target)[axis];
		const half = (axis === "x" ? target.width : target.height) / 2;
		const end = line.points.at(-1)!;
		const along = end[axis] - middle;
		if (Math.abs(along) <= (3 / 4) * half) continue;
		const radius = target.id.startsWith("node:") ? canvasCornerRadius(target) : 0;
		const limit = Math.min(half - Math.max(PORT_PADDING, radius), (3 / 4) * half);
		// Just past each thing that stands across the last run's way into the side.
		const last = straightRuns(line.points).at(-2)!;
		const [near, far] = [Math.min(last[across], end[across]), Math.max(last[across], end[across])];
		const [size, depth] =
			axis === "x" ? (["width", "height"] as const) : (["height", "width"] as const);
		const blockers = [
			...current.nodeShapes.filter(
				(node) => node.nodeId !== target.nodeId && node.nodeId !== source.nodeId,
			),
			...groupObstacles(groups, route),
			...branchLabelObstacles(routedEdges, current.portOffsets!).filter(
				(label) => label.nodeId !== `branch-label:${route.edge.id}`,
			),
		].filter(
			(box) =>
				box[across] < far &&
				box[across] + box[depth] > near &&
				box[axis] < middle + half &&
				box[axis] + box[size] > middle - half,
		);
		const ports = [
			...new Set([
				0,
				...blockers.flatMap((box) => [
					box[axis] - PORT_SPACING - middle,
					box[axis] + box[size] + PORT_SPACING - middle,
				]),
			]),
		]
			.filter(
				(offset) =>
					Math.abs(offset) <= limit + AXIS_ALIGNED_EPSILON &&
					Math.abs(offset) < Math.abs(along) - AXIS_ALIGNED_EPSILON &&
					!blockers.some(
						(box) => box[axis] < middle + offset && box[axis] + box[size] > middle + offset,
					),
			)
			.sort((a, b) => Math.abs(a) - Math.abs(b))
			.slice(0, CENTERED_PORT_TRIES);
		const key = connectionKey({ edgeId: route.edge.id, endpoint: "target" });
		const fixed = new Map(
			current.edgeArrows.filter((arrow) => arrow !== line).map((arrow) => [arrow.edgeId, arrow]),
		);
		const order = routedEdges
			.map((_, at) => at)
			.sort((a, b) => Number(a === index) - Number(b === index));
		for (const offset of ports) {
			const offsets = new Map(current.portOffsets).set(key, offset);
			const arrows = routeAllEdges(
				routedEdges,
				"orthogonal",
				offsets,
				current.nodeShapes,
				{ ...routeOptions, midway: true },
				order,
				fixed,
			);
			const points = arrows[index]!.points;
			if (
				routeBendCount(points) > routeBendCount(line.points) ||
				routeLength(points) >
					routeLength(line.points) + Math.abs(offset - along) + AXIS_ALIGNED_EPSILON
			)
				continue;
			const kept = withStepMoved(
				{ ...current, edgeArrows: arrows, portOffsets: offsets },
				index,
				current,
				scale,
				defectsOf,
				fewer,
				finished,
			);
			if (kept) {
				current = kept;
				break;
			}
		}
	}
	return current;
}

/**
 * The sideways steps of a line's corners, by the index of the corner each
 * starts at, that read as port jogs: between two runs heading the same way,
 * narrower than a deliberate bend, with a turn within a jog's reach of either
 * end of the line, counted once per end.
 */
function portJogSteps(corners: readonly ScenePoint[], reach: number, wide: number): number[] {
	const [start, end] = [corners[0]!, corners.at(-1)!];
	const steps: number[] = [];
	for (let index = 1; index < corners.length - 2; index += 1) {
		const [before, from, to, after] = corners.slice(index - 1, index + 3) as [
			ScenePoint,
			ScenePoint,
			ScenePoint,
			ScenePoint,
		];
		const axis = Math.abs(before.y - from.y) <= AXIS_ALIGNED_EPSILON ? "x" : "y";
		const heading = Math.sign(from[axis] - before[axis]);
		if (
			heading !== 0 &&
			Math.sign(after[axis] - to[axis]) === heading &&
			Math.hypot(to.x - from.x, to.y - from.y) < wide
		) {
			if (Math.hypot(end.x - to.x, end.y - to.y) <= reach) steps.push(index);
			if (Math.hypot(from.x - start.x, from.y - start.y) <= reach) steps.push(index);
		}
	}
	return steps;
}

/**
 * A line's corners with its first sideways step that reads as a port jog
 * (portJogSteps) moved along the runs either side of it: midway between the
 * turns those runs start and end at, else just past the reach of the end it
 * sits within, away from that end, each a port's spacing or more from where
 * it was. Each keeps the line's stubs and jogs less as a whole.
 * A step beside an arrowhead or a port reads as a jog into it.
 */
function movedSteps(
	points: readonly ScenePoint[],
	reach: number,
	wide: number,
): [ScenePoint, ...ScenePoint[]][] {
	const corners = straightRuns(points);
	const jogs = portJogSteps(corners, reach, wide);
	const index = jogs[0];
	if (index === undefined) return [];
	const [before, from, to, after] = corners.slice(index - 1, index + 3) as [
		ScenePoint,
		ScenePoint,
		ScenePoint,
		ScenePoint,
	];
	const [axis, across] =
		Math.abs(before.y - from.y) <= AXIS_ALIGNED_EPSILON
			? (["x", "y"] as const)
			: (["y", "x"] as const);
	const heading = Math.sign(from[axis] - before[axis]);
	// Just past the reach of each end it sits within, away from that end.
	const [start, end] = [corners[0]!, corners.at(-1)!];
	const past = (point: ScenePoint, turn: ScenePoint, away: number) => {
		const room = reach ** 2 - (point[across] - turn[across]) ** 2;
		return Math.hypot(point.x - turn.x, point.y - turn.y) > reach || room < 0
			? []
			: [point[axis] + away * (Math.sqrt(room) + 1)];
	};
	const nearest = [...past(end, to, -heading), ...past(start, from, heading)].sort(
		(a, b) => Math.abs(a - from[axis]) - Math.abs(b - from[axis]),
	);
	return [...new Set([(before[axis] + after[axis]) / 2, ...nearest].map(Math.round))].flatMap(
		(at) => {
			// A step moved less than a port's spacing reads where it was.
			if (
				Math.abs(at - from[axis]) < PORT_SPACING ||
				Math.sign(at - before[axis]) !== heading ||
				Math.sign(after[axis] - at) !== heading
			)
				return [];
			const moved = corners.map((point, turn) =>
				turn === index || turn === index + 1 ? { ...point, [axis]: at } : point,
			);
			return keepsStubs(corners, moved) && portJogSteps(moved, reach, wide).length < jogs.length
				? [compactPoints(moved)]
				: [];
		},
	);
}

/**
 * The first of a layout's variants with one line's step moved clear of its
 * ends (movedSteps), then, when `finished` is given, the layout itself, each
 * finished, that crosses no more lines than `current`, draws no worse and
 * passes no nearer a node. A step moved within a finished layout keeps it
 * finished enough: the last clearance pass follows every polish.
 */
function withStepMoved(
	layout: DiagramLayout,
	index: number,
	current: DiagramLayout,
	scale: number,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
	finished?: (layout: DiagramLayout) => DiagramLayout,
): DiagramLayout | undefined {
	const { edgeArrows } = layout;
	const variants = [
		...movedSteps(edgeArrows[index]!.points, routingJogReach(scale), routingWideBend(scale)).map(
			(points) => edgeArrows.map((arrow, at) => (at === index ? { ...arrow, points } : arrow)),
		),
		...(finished ? [edgeArrows] : []),
	];
	for (const arrows of variants) {
		if (arrowCrossings(arrows) > arrowCrossings(current.edgeArrows)) continue;
		const candidate = finished
			? finished({ ...layout, edgeArrows: arrows })
			: { ...layout, edgeArrows: arrows };
		if (
			drawsNoWorse(candidate, current, defectsOf, fewer) &&
			nearOutlines(candidate) <= nearOutlines(current)
		)
			return candidate;
	}
	return undefined;
}

/**
 * The drawn layout with each line's sideways step that sits within a port
 * jog's reach of either end moved clear of both (withStepMoved), a line at a
 * time, its other runs and every other line as they lie. A family that
 * places its own boxes keeps its lines.
 */
function stepsClearOfEnds(
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { groups, lanes, nodeShapes, polish, routedEdges } = layout;
	if (!polish?.sides || lanes || graphOptions.get(diagram)?.placement) return layout;
	const scale = routingQualityScale(
		drawnSize([...nodeShapes, ...groupBlocks(groups)], layout.edgeArrows),
	);
	let current = layout;
	for (const [index, route] of routedEdges.entries())
		if (!isSelfLoop(route))
			current = withStepMoved(current, index, current, scale, defectsOf, fewer) ?? current;
	return current;
}

/** Runs that pass within the clearance of a node neither of their line's ends is. */
function nearOutlines({ edgeArrows, nodeShapes }: DiagramLayout): number {
	return edgeArrows.reduce(
		(total, arrow) =>
			total +
			routeClearanceCount(
				arrow.points,
				nodeShapes,
				new Set([arrow.sourceNodeId, arrow.targetNodeId]),
			),
		0,
	);
}

/**
 * No more export defects, and no more crossings, reader findings, lines
 * through a head, hooks, detours, dips or crowded labels, and no newly
 * extreme aspect or longer a drawing.
 */
function drawsNoWorse(
	candidate: DiagramLayout,
	current: DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): boolean {
	const [labels, currentLabels] = [candidate, current].map(labelCrowding);
	return (
		!fewer(defectsOf(current), defectsOf(candidate)) &&
		routesNoWorse(candidate, current, false, true) &&
		headCrossers(candidate).size <= headCrossers(current).size &&
		hookedRoutes(candidate) <= hookedRoutes(current) &&
		detouredLines(candidate.edgeArrows) <= detouredLines(current.edgeArrows) &&
		dippedArrivals(candidate.edgeArrows).size <= dippedArrivals(current.edgeArrows).size &&
		labels!.every((count, index) => count <= currentLabels![index]!) &&
		drawnLongSide(candidate) <= drawnLongSide(current) + AXIS_ALIGNED_EPSILON
	);
}

/** Branch labels touching anything, then how far the labels fall short of their room. */
function labelCrowding({
	edgeArrows,
	groups,
	lanes,
	nodeShapes,
	routedEdges,
}: DiagramLayout): [number, number] {
	const { shortfalls, touches } = placedBranchLabels(
		[...edgeArrows],
		routedEdges,
		nodeShapes,
		groups,
		true,
		lanes,
	);
	return [touches, shortfalls.reduce((total, label) => total + label.shortfall, 0)];
}

/** The drawing's width and height, labels included. */
function drawnExtent(settled: DiagramLayout): { width: number; height: number } {
	return drawnSize(
		[...settled.nodeShapes, ...groupBlocks(settled.groups), ...laneBlocks(settled.lanes)],
		settled.edgeArrows,
		branchLabels(
			[...settled.edgeArrows],
			settled.routedEdges,
			settled.nodeShapes,
			settled.groups,
			true,
			settled.lanes,
		),
	);
}

/** The drawing's long side, labels included: a longer one shrinks all its text. */
function drawnLongSide(settled: DiagramLayout): number {
	const { width, height } = drawnExtent(settled);
	return Math.max(width, height);
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
		const logo = canvasGroupIconRun(frame.icon);
		const maxWidth = Math.max(1, frame.box.width - 2 * ZONE_LABEL_INSET - logo);
		return [
			{
				type: "node",
				id: frame.elementId,
				nodeId: frame.elementId,
				kind: frame.kind ?? "zone",
				...(frame.icon ? { icon: frame.icon } : {}),
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
					logo +
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
			...(frame.icon ? { icon: frame.icon } : {}),
			// Edges into and out of a composite bind to its frame.
			...(groups.composites.has(frame.id) ? { nodeId: frame.id } : {}),
			...frame.box,
		})),
		labels: drawn.labels.map((label) => {
			const frameId = label.containerId
				? nodeFrames.get(label.containerId)
				: label.id.startsWith("description:")
					? nodeFrames.get(`node:${label.id.slice("description:".length)}`)
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
	// Crossings, then reader findings, as the layout guards count them.
	const routed = (layout: DiagramLayout, runs: boolean) => [
		arrowCrossings(layout.edgeArrows, runs),
		readerFindingCount(layout.edgeArrows, [
			...layout.nodeShapes,
			...groupBlocks(layout.groups),
			...laneBlocks(layout.lanes),
		]),
	];
	// Routes no worse, and with strictly fewer crossings or reader findings.
	const cleaner = (layout: DiagramLayout, current: DiagramLayout, runs: boolean) => {
		const [counts, currentCounts] = [layout, current].map((candidate) => routed(candidate, runs));
		return (
			routesNoWorse(layout, current, false, runs) &&
			counts!.some((count, index) => count < currentCounts![index]!)
		);
	};
	const consider = (arrangement: Arrangement, fewerCrossings: boolean, cleanerOnly = false) => {
		const layout = layoutDiagram(diagram, levels[0]!, arrangement);
		const defects = defectsOf(layout);
		if (
			!fewer(best.defects, defects) &&
			(cleanerOnly
				? cleaner(layout, best.layout, false)
				: routesNoWorse(layout, best.layout, fewerCrossings, false))
		)
			best = { arrangement, defects, layout };
		return layout;
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
	const considerWrap = (next: Wrap, cleanerOnly = false) => {
		let tried: DiagramLayout | undefined;
		for (const crossingRepair of repairable && !best.arrangement.crossingRepair
			? [true, false]
			: [best.arrangement.crossingRepair]) {
			if (next.continuations.size === 0 || best.arrangement.wrap === next) break;
			tried = consider({ ...best.arrangement, crossingRepair, wrap: next }, false, cleanerOnly);
		}
		return tried;
	};
	const tried = considerWrap(wrap);
	// Where continuations through the gap between bands route worse, or still
	// cross a line or draw a reader finding, those whose source a line reaches
	// from the gap may leave forward, around the end of their band, and failing
	// that all may run around the ends of the bands like line breaks. In place of
	// a kept gap route, either must route no worse and draw strictly fewer
	// crossings or reader findings.
	if (tried && !laned(diagram)) {
		const gap = best.arrangement.wrap === wrap;
		if (!gap || routed(best.layout, false).some((count) => count > 0)) {
			const leaveForward = contendedContinuations(tried, wrap, diagram.layout.direction);
			if (leaveForward.size > 0) considerWrap({ ...wrap, leaveForward }, gap);
			if (best.arrangement.wrap === wrap || best.arrangement.wrap.continuations.size === 0)
				considerWrap({ ...wrap, lineBreaks: true }, gap);
		}
	}
	// A long flow of groups first lays each group's members across the flow, when
	// that routes no worse. Zones never do: across the flow, a zone's members
	// would contradict the direction the diagram states.
	const structure = groupStructure(diagram);
	const groupsAcross =
		arranged && orthogonal && tooLong && structure !== undefined && !structure.zoned;
	for (const crossingRepair of repairable && !best.arrangement.crossingRepair
		? [true, false]
		: [best.arrangement.crossingRepair]) {
		if (!groupsAcross || best.arrangement.groupsAcross) break;
		consider({ ...best.arrangement, crossingRepair, groupsAcross: true }, false);
	}
	// A layout as drawn: its lines cleared of the nodes they pass too closely and
	// of its labels.
	const finished = (settled: DiagramLayout) =>
		orthogonal ? clearLabels(clearOutlines(settled)) : settled;
	// Returns that wind round to a decision's far side, lines that turn over a
	// corner into a crowded side, dip into their target, cross or wind round
	// another line into one end, jog beside a port, meet a rounded node within
	// its corner's curve, land alone by a side's corner or step sideways beside
	// an end are polished where that draws no worse: last, after every choice.
	// The ends' polish, from the straight runs on:
	const polishedEnds = (arrived: DiagramLayout) =>
		stepsClearOfEnds(
			diagram,
			centerLoneArrivals(
				diagram,
				endsOffCorners(
					diagram,
					straightenArrivals(arrived, finished, defectsOf, fewer),
					finished,
					defectsOf,
					fewer,
				),
				finished,
				defectsOf,
				fewer,
			),
			defectsOf,
			fewer,
		);
	const polished = (drawn: DiagramLayout) => {
		if (!orthogonal) return drawn;
		const arrived = polishArrivals(
			diagram,
			returnsToNearVertices(diagram, drawn, finished, defectsOf, fewer),
			finished,
			defectsOf,
			fewer,
		);
		const plain = polishedEnds(arrived);
		// Lines merging into one end nest (nestSharedArrivals) where, polished
		// to the end, that draws no worse than leaving them: a nesting that
		// removes one crossing must not bar a later polish that removes more.
		const nested = nestSharedArrivals(diagram, arrived, finished, defectsOf, fewer);
		if (nested === arrived) return plain;
		const candidate = polishedEnds(nested);
		return drawsNoWorse(candidate, plain, defectsOf, fewer) &&
			nearOutlines(candidate) <= nearOutlines(plain) &&
			portJogCount(candidate) <= portJogCount(plain)
			? candidate
			: plain;
	};
	// A line the finished layout moved clear of one node it passed too closely,
	// or by one run, moves clear of every other it still passes. Only last,
	// after every choice: a crossing it removes on the way would otherwise bar
	// the rivals that clear lines out of arrowheads.
	const clearedLast = (settled: DiagramLayout) => {
		if (!orthogonal) return settled;
		const cleared = clearOutlines(settled, true);
		return cleared === settled ? settled : clearLabels(cleared);
	};
	// A grouped flow still too long wraps level by level, each band reading in the
	// stated direction and each group a whole block of its level, since a band cut
	// would split a group (planZoneWraps). Of the plans that route no worse, the
	// first with no more crossings or reader findings than before is kept, else
	// the one with the fewest crossings, then findings, then the squarest; one
	// still too long plans again from the wrap it kept. A state machine's
	// composite states never wrap: with no direction stated, it reads in whichever
	// of two reads better instead (renderStateMachineDiagram).
	const zoneScore = (layout: DiagramLayout) => [
		arrowCrossings(layout.edgeArrows, false),
		readerFindingCount(layout.edgeArrows, [...layout.nodeShapes, ...groupBlocks(layout.groups)]),
		lengthOf(layout).aspect,
	];
	// As drawn, each line cleared at last of every node it still passes: no more
	// crossings, detours, hooks, lines through heads or lines near nodes than the
	// reference, and no line past twice its direct connection beyond its stubs.
	// Judging `findings`, also no more reader findings, port jogs included, as
	// drawn or, where the drawing has more, as both are polished at last: the
	// ends' polish removes jogs a line steps on the way.
	const findingsOf = (drawn: DiagramLayout) =>
		readerFindingCount(drawn.edgeArrows, [...drawn.nodeShapes, ...groupBlocks(drawn.groups)]);
	const drawnNoWorse = (candidate: DiagramLayout, reference: DiagramLayout, findings = false) => {
		const [drawnCandidate, drawnReference] = [candidate, reference].map((settled) =>
			clearedLast(finished(settled)),
		);
		return (
			[false, true].every(
				(runs) =>
					arrowCrossings(drawnCandidate!.edgeArrows, runs) <=
					arrowCrossings(drawnReference!.edgeArrows, runs),
			) &&
			detouredLines(drawnCandidate!.edgeArrows) <= detouredLines(drawnReference!.edgeArrows) &&
			hookedRoutes(drawnCandidate!) <= hookedRoutes(drawnReference!) &&
			headCrossers(drawnCandidate!).size <= headCrossers(drawnReference!).size &&
			nearOutlines(drawnCandidate!) <= nearOutlines(drawnReference!) &&
			drawnCandidate!.edgeArrows.every((arrow) => {
				const [start, end] = [arrow.points[0], arrow.points.at(-1)!];
				return (
					arrow.sourceNodeId === arrow.targetNodeId ||
					routeLength(arrow.points) <=
						2 * (Math.abs(end.x - start.x) + Math.abs(end.y - start.y)) + 2 * ROUTE_STUB_LENGTH
				);
			}) &&
			(!findings ||
				findingsOf(drawnCandidate!) <= findingsOf(drawnReference!) ||
				findingsOf(clearedLast(polished(finished(candidate)))) <=
					findingsOf(clearedLast(polished(finished(reference)))))
		);
	};
	for (
		let round = 0;
		round < ZONE_WRAP_ROUNDS &&
		arranged &&
		orthogonal &&
		structure !== undefined &&
		(structure.zoned || structure.composites.size === 0);
		round += 1
	) {
		const length = lengthOf(best.layout);
		if (!length.tooLong) break;
		const kept = best;
		let chosen: (typeof best & { score: number[] }) | undefined;
		let repairedChoice: (typeof best & { score: number[] }) | undefined;
		for (const zoneWraps of planZoneWraps(
			diagram,
			structure,
			kept.arrangement,
			length.balance,
			length.size,
		)) {
			const planned = {
				...kept.arrangement,
				crossingRepair: repairable || kept.arrangement.crossingRepair,
				zoneWraps,
			};
			const drawn = layoutDiagram(diagram, levels[0]!, planned);
			// A plan that crosses more than the layout it replaces routes each line
			// across the fewest lines before it, so a crossing the plain router draws
			// does not alone push sibling zones apart. One still refused that keeps
			// the top level in one band, left a single crossing more, is judged as
			// the crossing repairs leave it, as the kept plan is drawn, where they
			// leave it crossing, detouring, hooking and passing near nodes no more
			// than the layout it replaces, and no line in it runs more than twice
			// its direct connection, past its stubs: a crossing a line's side change
			// removes does not stack zones either. Such a plan never stacks them
			// itself. A row or column of frames wraps its top level alone, so each of
			// its plans may be judged so.
			const crossed =
				!planned.avoidCrossings &&
				arrowCrossings(drawn.edgeArrows, false) > arrowCrossings(kept.layout.edgeArrows, false);
			const rerouted = crossed
				? layoutDiagram(diagram, levels[0]!, { ...planned, avoidCrossings: true })
				: drawn;
			const unrepaired: SettledLayout = {
				arrangement: crossed ? { ...planned, avoidCrossings: true } : planned,
				defects: defectsOf(rerouted),
				layout: rerouted,
			};
			// No more defects than the layout it replaces, and routed no worse.
			const acceptable = ({ defects, layout }: SettledLayout) =>
				!fewer(kept.defects, defects) &&
				routesNoWorse(layout, kept.layout, false, false, false, false);
			const repair =
				!acceptable(unrepaired) &&
				repairable &&
				crossed &&
				(!structure.zoned || !zoneWraps.has(TOP_LEVEL)) &&
				arrowCrossings(rerouted.edgeArrows) === arrowCrossings(kept.layout.edgeArrows) + 1
					? repairCrossings(diagram, levels[0]!, unrepaired, defectsOf, fewer)
					: undefined;
			const repaired =
				repair !== undefined &&
				acceptable(repair) &&
				drawnNoWorse(repair.layout, kept.layout, !structure.zoned);
			const { arrangement, defects, layout } = repaired ? repair : unrepaired;
			if (!repaired && !acceptable(unrepaired)) continue;
			// A row of frames wraps only where, as drawn, it reads no worse than the
			// row in every way a repaired plan must, and draws no more reader
			// findings, port jogs included; failing that, the next plan is tried.
			if (!repaired && !structure.zoned && !drawnNoWorse(layout, kept.layout, true)) continue;
			const score = zoneScore(layout);
			// A plan with no more crossings or reader findings than before needs no
			// rival; a repaired one does among zones, where it is a fallback.
			const [crossings, findings] = zoneScore(kept.layout);
			const unrivaled = score[0]! <= crossings! && score[1]! <= findings!;
			if (repaired) {
				if (!repairedChoice || lowerScore(score, repairedChoice.score))
					repairedChoice = { arrangement, defects, layout, score };
				if (!structure.zoned && unrivaled) break;
				continue;
			}
			if (!chosen || lowerScore(score, chosen.score))
				chosen = { arrangement, defects, layout, score };
			if (unrivaled) break;
		}
		// A repaired plan only keeps sibling zones side by side: it replaces a
		// chosen plan that stacks them, or one still too long, which plans again
		// and may stack them, where it crosses and finds no more and is not too
		// long itself. Every plan for a row of frames wraps its top level, so there
		// it replaces any chosen plan it crosses and finds no more than.
		if (
			repairedChoice &&
			(!chosen ||
				((chosen.arrangement.zoneWraps?.has(TOP_LEVEL) ||
					(lengthOf(chosen.layout).tooLong && !lengthOf(repairedChoice.layout).tooLong)) &&
					repairedChoice.score[0]! <= chosen.score[0]! &&
					repairedChoice.score[1]! <= chosen.score[1]!))
		)
			chosen = repairedChoice;
		if (!chosen) break;
		// A band of frames rises to the blocks it lies under (Wrap.rise) where that
		// moves it at all, as planned, and routes and draws no worse than the plan
		// as laid out.
		const top = chosen.arrangement.zoneWraps?.get(TOP_LEVEL);
		const arrangement = top && {
			...chosen.arrangement,
			zoneWraps: new Map([...chosen.arrangement.zoneWraps!, [TOP_LEVEL, { ...top, rise: true }]]),
		};
		const planned = (option: Arrangement) =>
			positionLayout(diagram, new Map(), new Map(), option)
				.nodes.map((node) => `${node.x},${node.y}`)
				.join(" ");
		if (
			!structure.zoned &&
			top &&
			arrangement &&
			!top.rise &&
			planned(arrangement) !== planned(chosen.arrangement)
		) {
			const layout = layoutDiagram(diagram, levels[0]!, arrangement);
			const defects = defectsOf(layout);
			if (
				!fewer(chosen.defects, defects) &&
				routesNoWorse(layout, chosen.layout, false, false, false, false) &&
				drawnNoWorse(layout, chosen.layout, true)
			)
				chosen = { arrangement, defects, layout, score: zoneScore(layout) };
		}
		best = chosen;
	}
	// A line into a hanging band that runs around a step of the target's rank
	// to reach it is kept when that routes no worse, hooks or detours no line
	// more, and draws the lines shorter in total.
	const cuts = zoneCutEdges(diagram, best.arrangement.zoneWraps);
	if (
		best.arrangement.zoneWraps &&
		!best.arrangement.aroundRanks &&
		best.layout.routedEdges.some(
			({ edge, source, target }) =>
				cuts.has(edge.id) &&
				behindRankStep(source, target, best.layout.nodeShapes, diagram.layout.direction),
		)
	) {
		const arrangement = { ...best.arrangement, aroundRanks: true };
		const layout = layoutDiagram(diagram, levels[0]!, arrangement);
		const defects = defectsOf(layout);
		const total = ({ edgeArrows }: DiagramLayout) =>
			edgeArrows.reduce((sum, arrow) => sum + routeLength(arrow.points), 0);
		if (
			!fewer(best.defects, defects) &&
			routesNoWorse(layout, best.layout, false, false) &&
			hookedRoutes(layout) <= hookedRoutes(best.layout) &&
			detouredLines(layout.edgeArrows) <= detouredLines(best.layout.edgeArrows) &&
			total(layout) < total(best.layout) - AXIS_ALIGNED_EPSILON
		)
			best = { arrangement, defects, layout };
	}
	// In lanes a step takes lines in and sends them out by different sides, when
	// that routes no worse.
	if (arranged && orthogonal && laned(diagram))
		consider({ ...best.arrangement, separateRoles: true }, false);
	// Crossings the arrangements leave are repaired where few enough to untangle.
	const repaired = (settled: SettledLayout) => {
		const crossings = arrowCrossings(settled.layout.edgeArrows);
		return repairable && crossings > 0 && crossings <= CROSSING_REPAIR_MAX_CROSSINGS
			? repairCrossings(diagram, levels[0]!, settled, defectsOf, fewer)
			: settled;
	};
	let layout: DiagramLayout;
	// Repairs, then the finished layout, tightened where it runs long and with
	// its lines cleared of other lines' arrowheads.
	const complete = (
		unrepaired: SettledLayout,
		hopeless?: (layout: DiagramLayout) => boolean,
	): CompletedLayout => {
		best = unrepaired;
		best = repaired(best);
		// Continuations through the gap between bands that still cross after the
		// repairs give way to continuations around the ends of the bands, repaired
		// the same way, where those route no worse and end with strictly fewer
		// crossings or reader findings.
		const { wrap: gapWrap } = unrepaired.arrangement;
		if (
			repairable &&
			!laned(diagram) &&
			gapWrap.continuations.size > 0 &&
			!gapWrap.lineBreaks &&
			arrowCrossings(best.layout.edgeArrows) > 0
		) {
			const arrangement = { ...unrepaired.arrangement, wrap: { ...gapWrap, lineBreaks: true } };
			const layout = layoutDiagram(diagram, levels[0]!, arrangement);
			const around = repaired({ arrangement, defects: defectsOf(layout), layout });
			if (!fewer(best.defects, around.defects) && cleaner(around.layout, best.layout, true))
				best = around;
		}
		// Only pairs still crossing after the normal repairs may leave their lanes.
		// One extra ordinary-routing layout is screened by the same export/reader
		// admission as other candidates. Preserve every unrelated paired lane.
		if (options.pairedReturns && arrowCrossings(best.layout.edgeArrows) > 0) {
			const previous = best;
			const arrows = new Map(best.layout.edgeArrows.map((arrow) => [arrow.edgeId, arrow]));
			const unpairedReturns = new Set<string>();
			for (const route of best.layout.routedEdges) {
				const arrow = arrows.get(route.edge.id);
				if (
					route.pair === undefined ||
					!arrow ||
					!best.layout.edgeArrows.some(
						(other) => other !== arrow && arrowCrossings([arrow, other]) > 0,
					)
				)
					continue;
				for (const member of best.layout.routedEdges)
					if (
						member.pair !== undefined &&
						(member.edge.id === route.edge.id ||
							(member.edge.source === route.edge.target &&
								member.edge.target === route.edge.source))
					)
						unpairedReturns.add(member.edge.id);
			}
			if (unpairedReturns.size > 0) {
				consider({ ...best.arrangement, unpairedReturns }, true);
				const remaining = arrowCrossings(best.layout.edgeArrows);
				if (
					best !== previous &&
					repairable &&
					remaining > 0 &&
					remaining <= CROSSING_REPAIR_MAX_CROSSINGS
				)
					best = repairCrossings(diagram, levels[0]!, best, defectsOf, fewer);
				const keptPairs = new Set(
					best.layout.routedEdges
						.filter((route) => route.pair !== undefined)
						.map((route) => route.edge.id),
				);
				if (
					previous.layout.routedEdges.some(
						(route) =>
							route.pair !== undefined &&
							!unpairedReturns.has(route.edge.id) &&
							!keptPairs.has(route.edge.id),
					)
				)
					best = previous;
			}
		}
		layout = finished(best.layout);
		// A rival already beaten as repaired needs no tightening or head repair.
		if (hopeless?.(layout)) return { layout, settled: best };
		// A plain column, or a laned flow, still too long for its breadth, which no
		// wrap shortened, tightens along the flow. In lanes, a handoff to a lane
		// further than the next first stays in its source's column where the lanes
		// between are empty there (laneColumns). Then rank or column gaps draw as
		// short as the lines in them allow (compactGaps), or, failing that, only
		// those lines cross straight. Each is kept when it reads shorter, routes no
		// worse, lengthens, hooks or detours no line and crowds no label more. Lanes
		// tighten only while no line runs through an arrowhead, before or after: the
		// head repair below reroutes such a line, and closed-up lanes leave it less
		// room to.
		const tightenable = () =>
			arranged &&
			orthogonal &&
			(laned(diagram) || (vertical && !structure)) &&
			best.arrangement.wrap.continuations.size === 0 &&
			lengthOf(layout).aspect >= COMPACT_ASPECT &&
			(!laned(diagram) || headCrossers(layout).size === 0);
		const tighten = (arrangement: Arrangement) => {
			const attempt = layoutDiagram(diagram, levels[0]!, arrangement);
			const compact = repaired({ arrangement, defects: defectsOf(attempt), layout: attempt });
			const candidate = finished(compact.layout);
			const lengths = new Map(
				layout.edgeArrows.map((arrow) => [arrow.id, routeLength(arrow.points)]),
			);
			if (
				!fewer(best.defects, compact.defects) &&
				routesNoWorse(candidate, layout, false, true) &&
				candidate.edgeArrows.every(
					(arrow) => routeLength(arrow.points) <= lengths.get(arrow.id)! + AXIS_ALIGNED_EPSILON,
				) &&
				(!laned(diagram) || headCrossers(candidate).size === 0) &&
				hookedRoutes(candidate) <= hookedRoutes(layout) &&
				detouredLines(candidate.edgeArrows) <= detouredLines(layout.edgeArrows) &&
				labelCrowding(candidate).every((count, index) => count <= labelCrowding(layout)[index]!) &&
				lengthOf(candidate).aspect < lengthOf(layout).aspect
			) {
				best = compact;
				layout = candidate;
				return true;
			}
			return false;
		};
		if (laned(diagram) && tightenable()) {
			const through = laneColumns(diagram, true);
			if ([...laneColumns(diagram)].some(([id, column]) => through.get(id) !== column))
				tighten({ ...best.arrangement, throughHandoffs: true });
		}
		for (const straight of tightenable() ? [false, true] : []) {
			const gaps = compactGaps(diagram, layout, best.arrangement, straight);
			if (gaps.size > 0 && tighten({ ...best.arrangement, compactGaps: gaps })) break;
		}
		// A row of lanes still longer than LANE_ASPECT for its breadth raises its
		// thinnest lanes to one breadth (laneBreadthFor), its steps centered in
		// them. Kept when it reads shorter, routes no worse and hooks, detours or
		// crowds no more; its lines may lengthen across the broader lanes.
		const breadth =
			arranged &&
			orthogonal &&
			laned(diagram) &&
			best.arrangement.wrap.continuations.size === 0 &&
			headCrossers(layout).size === 0
				? laneBreadthFor(layout, lengthOf(layout).size)
				: undefined;
		if (breadth !== undefined) {
			const arrangement = { ...best.arrangement, laneBreadth: breadth };
			const attempt = layoutDiagram(diagram, levels[0]!, arrangement);
			const broad = repaired({ arrangement, defects: defectsOf(attempt), layout: attempt });
			const candidate = finished(broad.layout);
			if (
				!fewer(best.defects, broad.defects) &&
				routesNoWorse(candidate, layout, false, true) &&
				headCrossers(candidate).size === 0 &&
				hookedRoutes(candidate) <= hookedRoutes(layout) &&
				detouredLines(candidate.edgeArrows) <= detouredLines(layout.edgeArrows) &&
				labelCrowding(candidate).every((count, index) => count <= labelCrowding(layout)[index]!) &&
				lengthOf(candidate).aspect < lengthOf(layout).aspect
			) {
				best = broad;
				layout = candidate;
			}
		}
		// A line through another line's arrowhead reads as pointing into that head's
		// target. Where one is left, the lines through a head are routed again after
		// all the others, clear of heads first, and, in a graph few enough edges to
		// repair, every line is. Of these, the clearest is kept that draws fewer
		// lines through a head, no more export defects, crossings, reader findings,
		// detours or crowded labels, and no longer a drawing: a narrower one may read
		// past 2.45:1, but a longer one would shrink all its text.
		const clearer = (candidate: DiagramLayout) => {
			const [defects, current] = [candidate, layout].map(defectsOf);
			const [labels, currentLabels] = [candidate, layout].map(labelCrowding);
			return (
				!fewer(current!, defects!) &&
				headCrossers(candidate).size < headCrossers(layout).size &&
				routesNoWorse(candidate, layout, false, true, true) &&
				drawnLongSide(candidate) <= drawnLongSide(layout) + AXIS_ALIGNED_EPSILON &&
				detouredLines(candidate.edgeArrows) <= detouredLines(layout.edgeArrows) &&
				labels!.every((count, index) => count <= currentLabels![index]!)
			);
		};
		const crossers = orthogonal ? headCrossers(layout) : new Set<string>();
		const clearings: DiagramLayout[] = [];
		if (crossers.size > 0 && layout.portOffsets && layout.routeOptions) {
			const { edgeArrows, nodeShapes, portOffsets, routeOptions, routedEdges } = layout;
			const order = routedEdges.map((_, index) => index);
			const last = (index: number) => (crossers.has(routedEdges[index]!.edge.id) ? 1 : 0);
			clearings.push(
				finished({
					...layout,
					edgeArrows: routeAllEdges(
						routedEdges,
						"orthogonal",
						portOffsets,
						nodeShapes,
						{ ...routeOptions, clearHeads: true },
						order.sort((a, b) => last(a) - last(b)),
						new Map(
							edgeArrows.filter((arrow) => !crossers.has(arrow.edgeId)).map((a) => [a.edgeId, a]),
						),
					),
				}),
			);
		}
		if (repairable && crossers.size > 0) {
			const arrangement = { ...best.arrangement, clearHeads: true };
			const attempt = layoutDiagram(diagram, levels[0]!, arrangement);
			clearings.push(
				finished(repaired({ arrangement, defects: defectsOf(attempt), layout: attempt }).layout),
			);
		}
		// The clearest: fewest lines through a head, then crossings, then findings.
		const clearness = (candidate: DiagramLayout) => [
			headCrossers(candidate).size,
			...routed(candidate, true),
		];
		const kept = layout;
		for (const candidate of clearings.filter(clearer))
			if (layout === kept || lowerScore(clearness(candidate), clearness(layout)))
				layout = candidate;
		return { layout, settled: best };
	};
	const beforeRepairs = best;
	({ layout, settled: best } = complete(beforeRepairs));
	// A decision's branches leave by the vertices that route them best together.
	if (repairable && !laned(diagram))
		({ layout, settled: best } = chooseBranchSides(
			diagram,
			levels[0]!,
			beforeRepairs,
			{ layout, settled: best },
			complete,
			defectsOf,
			fewer,
		));
	// Last, the drawn layout's ends are polished.
	layout = polished(layout);
	// A plain flow, untightened and unwrapped, whose polished line still steps
	// sideways across a rank gap too narrow for the step to clear both its ends
	// grows that gap (narrowStepGaps), so the step can sit midway: a step within
	// a jog's reach of an arrowhead or a port reads as jogging into it. The
	// grown layout keeps the drawn one's sides, its crossing repairs among them,
	// and is finished and polished like it. Both are judged as they are drawn
	// at last, after the last clearance: the grown one is kept when it stays
	// short of tightening (COMPACT_ASPECT), draws fewer port jogs and no more
	// export defects, crossings, reader findings, lines through a head, hooks,
	// detours, dips or crowded labels, and passes no nearer a node. It draws
	// longer only by the gaps it grows.
	const narrow =
		arranged &&
		orthogonal &&
		!structure &&
		!laned(diagram) &&
		best.arrangement.wrap.continuations.size === 0 &&
		!best.arrangement.compactGaps
			? narrowStepGaps(diagram, layout)
			: new Map<number, number>();
	if (narrow.size > 0) {
		const drawn = { layout, settled: best };
		const arrangement = { ...best.arrangement, widenGaps: narrow };
		const attempt = layoutDiagram(diagram, levels[0]!, arrangement);
		const settled = { arrangement, defects: defectsOf(attempt), layout: attempt };
		const [candidate, current] = [polished(finished(attempt)), drawn.layout].map(clearedLast);
		const [labels, currentLabels] = [candidate!, current!].map(labelCrowding);
		const grows =
			!fewer(defectsOf(current!), defectsOf(candidate!)) &&
			lengthOf(candidate!).aspect < COMPACT_ASPECT &&
			portJogCount(candidate!) < portJogCount(current!) &&
			routesNoWorse(candidate!, current!, false, true) &&
			headCrossers(candidate!).size <= headCrossers(current!).size &&
			hookedRoutes(candidate!) <= hookedRoutes(current!) &&
			detouredLines(candidate!.edgeArrows) <= detouredLines(current!.edgeArrows) &&
			dippedArrivals(candidate!.edgeArrows).size <= dippedArrivals(current!.edgeArrows).size &&
			labels!.every((count, index) => count <= currentLabels![index]!) &&
			nearOutlines(candidate!) <= nearOutlines(current!);
		({ layout, settled: best } = grows
			? { layout: candidate!, settled }
			: { layout: current!, settled: drawn.settled });
	} else layout = clearedLast(layout);
	const { groups, lanes, routedEdges } = layout;
	const routedArrows = [...layout.edgeArrows];
	const descriptions = new Map(
		diagram.nodes.flatMap((node) =>
			node.description ? [[node.id, node.description] as const] : [],
		),
	);
	const drawnNodes = nodeTexts(layout.nodeShapes, descriptions);
	const drawn = {
		arrows: routedArrows,
		frames: [] as FrameSceneElement[],
		labels: [
			...drawnNodes.texts,
			...branchLabels(routedArrows, routedEdges, layout.nodeShapes, groups, true, lanes),
		],
		nodes: drawnNodes.nodes,
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
