import {
	type DiagramEdge,
	type DiagramZoneKind,
	type IntermediateDiagram,
	type DiagramGroup,
} from "./intermediate.js";
import {
	type CanvasShapeElement as NodeSceneElement,
	type AxisAlignedSegment,
	type CanvasNodeIcon,
	type CanvasPoint as ScenePoint,
	arrowheadsNear,
	candidateRouteQuality,
	candidateTouches,
	type CanvasConnectorElement as ArrowSceneElement,
} from "@sketchi/drawing";

export type ConnectionEdge = "top" | "right" | "bottom" | "left";

export interface RoutedEdge {
	edge: DiagramEdge;
	index: number;
	/**
	 * A wrap continuation's lane between its bands: a line along the flow at `at`
	 * across it, `vertical` when the flow runs down the page.
	 */
	lane?: { readonly at: number; readonly vertical: boolean };
	/**
	 * The lane a line that skips ranks keeps in each rank it passes
	 * (Arrangement.skipLanes): a line along the flow at `at` across it, which
	 * the line runs in when that draws as cleanly as any other way.
	 */
	skipLane?: {
		readonly at: number;
		readonly vertical: boolean;
		/** Along the flow, midway across the gap after the source's rank and before the target's. */
		readonly leave: number;
		readonly enter: number;
	};
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
	/** How near this line may run beside another that shares one of its nodes (GraphRenderOptions.besideShared). */
	besideShared?: number;
	/** A pinned end's own straight run, in place of the end run. */
	runs?: { source?: number; target?: number };
	source: NodeSceneElement;
	sourceEdge: ConnectionEdge;
	target: NodeSceneElement;
	targetEdge: ConnectionEdge;
}

export interface RouteSegment extends AxisAlignedSegment {
	arrowId: string;
	startBindingId: string;
	endBindingId: string;
	/** Where the segment starts and ends along its orientation, in route order. */
	from: number;
	to: number;
}

export interface LabelMetrics {
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

export interface DescriptionMetrics {
	readonly text: string;
	readonly lines: number;
	readonly width: number;
	readonly height: number;
}

export interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** One drawn group: its frame and the keep-out box of the frame's name. */
export interface GroupFrame {
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

export interface GroupLayout {
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

export interface RankMetric {
	readonly breadth: number;
	readonly depth: number;
	readonly rank: number;
	readonly shapes: readonly NodeSceneElement[];
}

/**
 * Where a long flow wraps into further rows (LR and RL) or columns (TB and BT).
 * Bands are runs of whole ranks; each reads in the requested direction, and one
 * continuation edge carries the flow from a band's last rank to the next band,
 * through the gap between them (see assignGutterSides).
 */
export interface Wrap {
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
	/** A cut carries a forward edge that skips ranks, whose line may cross another (zoned levels). */
	readonly skips?: boolean;
}

/**
 * Whole-layout choices, each kept only if it routes no worse than the layout
 * without it. With all of them off, the layout is the polished router's alone.
 */
export interface Arrangement {
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
	/**
	 * In an ungrouped, unwrapped flow, each line that skips ranks, a return
	 * among them, keeps a lane in every rank it passes, in the layered order,
	 * and each node sits toward the nodes and lanes it links to (skipLaneCenters),
	 * so long lines run straight past the ranks they skip, on the side of each
	 * node the layered order found them crossing fewest lines.
	 */
	readonly skipLanes?: boolean;
	/**
	 * Ports on a side whose lines run around into the same side of a node
	 * beyond nest by how far each reaches (PortOrder "nested").
	 */
	readonly nestAround?: boolean;
	/**
	 * In a zoned flow, a node outside the zones that a zone's members reach
	 * from another outside node ranks after it (blockPrecedence).
	 */
	readonly throughBlocks?: boolean;
	/** Route each edge, among otherwise equal lanes, across the fewest arrows routed before it. */
	readonly avoidCrossings?: boolean;
	/**
	 * Route each edge clear of other lines' arrowheads before anything but a node
	 * or an overlap: a line through a head reads as pointing into its target.
	 */
	readonly clearHeads?: boolean;
	/**
	 * Route each edge so it bends and ends clear of other lines, and other lines'
	 * bends and ends clear of it, before anything but a node or an overlap: two
	 * lines that meet anywhere but a clean crossing read as one line that forks.
	 */
	readonly clearTouches?: boolean;
	/**
	 * Neighbors in a rank whose facing sides both send or take a line keep, past
	 * both stubs, room for a lane each (FACING_LANES): two lines turning into one
	 * narrow gap between neighbors, as branches converging on shared targets
	 * from neighboring decisions do, otherwise turn on or beside each other.
	 */
	readonly spreadFacing?: boolean;
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
	/**
	 * Zones grown by this much on every side, by group id, so a line alongside
	 * a node they hold has a lane the corridor gap from it (zonesWithoutAlongsideRoom).
	 */
	readonly zoneSlack?: ReadonlyMap<string, number>;
	readonly wrap: Wrap;
	/** Bands of a zoned flow's levels, by group id or TOP_LEVEL (see planZoneWraps). */
	readonly zoneWraps?: ReadonlyMap<string, Wrap>;
}

/** Each overridden edge's departure and arrival sides, by edge id. */
export type SideOverrides = ReadonlyMap<
	string,
	{ readonly sourceEdge?: ConnectionEdge; readonly targetEdge?: ConnectionEdge }
>;

export type LayoutDirection = IntermediateDiagram["layout"]["direction"];

/** How one level of a zoned flow wraps (see planZoneWraps). */
export interface ZoneWrapOptions {
	/** Exactly this many bands. */
	readonly bands: number;
	/** Each block's size, by unit id. */
	readonly sizes: ReadonlyMap<string, { width: number; height: number }>;
	/** How many ranks of the whole flow a unit stands for: a zone, those it holds. */
	readonly weights: ReadonlyMap<string, number>;
	/** Whether a cut may carry a forward edge that skips ranks. */
	readonly skips: boolean;
	/** Units that stay in the first band: a row's zones, which no cut may hang. */
	readonly firstBand?: ReadonlySet<string>;
}

/** Node positions and, for a grouped diagram, where each group's frame is drawn. */
export interface PositionedLayout {
	readonly groups?: GroupLayout;
	readonly lanes?: LaneLayout;
	readonly nodes: NodeSceneElement[];
	/** Each skipping line's lane across the flow (Arrangement.skipLanes), by edge id. */
	readonly skipLaneAt?: ReadonlyMap<string, number>;
}

/** A group laid out on its own, before the level around it places it. */
export interface GroupBlock {
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
export interface PlacedUnit {
	frame?: Box;
	nested?: Map<string, Box>;
	nodes: NodeSceneElement[];
}

/** One drawn lane: its band from header to far end, and its header strip. */
export interface LaneFrame {
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
export interface LaneLayout {
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

export interface PortSlot {
	readonly endpoint: "source" | "target";
	readonly key: string;
	readonly route: RoutedEdge;
}

export interface PortPreference {
	/** Offset to stay near when nothing pins the port. */
	readonly desired: number;
	readonly high: number;
	readonly low: number;
	/** Straight anchors and pinned vertices (2) win over L-route bounds (1). */
	readonly priority: number;
	/** For an L-shaped route: travel direction along the side times its distance ahead. */
	readonly lane?: number;
}

/**
 * In zones, how near a line may run alongside a node it neither leaves nor
 * enters: the reader's corridor gap, along more than a corner's length, so the
 * line never reads as touching the node where it squeezes past it inside a
 * zone. Outside zones only NODE_CLEARANCE holds.
 */
export interface Alongside {
	readonly gap: number;
	readonly run: number;
}

/**
 * Touches a grid search judges step by step: other lines' turns and ends
 * within the gap of a step, and other lines' runs within the gap of a turn.
 */
export interface TouchGrid {
	readonly gap: number;
	readonly step: (from: ScenePoint, to: ScenePoint, arrowId: string) => number;
	readonly turn: (point: ScenePoint, arrowId: string) => number;
}

/** Optional routing passes for one layout attempt. */
export interface RouteOptions {
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
	/** Bend and end clear of other lines first (see Arrangement.clearTouches). */
	readonly clearTouches?: boolean;
	/** Offer any line between facing sides a step midway, as the drawn layout's polish does. */
	readonly midway?: boolean;
}

/**
 * Arrows routed so far (with reserved stubs), prepared once per edge for scoring
 * candidates. Without a reader scale, candidates are scored as the plain router.
 */
export interface RoutedSoFar {
	/** Lines of other arrows a route crosses, for reader-scale scoring. */
	readonly crossings?: CrossingLookup;
	/** Other arrows' heads one step passes through or touches, when routes keep clear of heads first. */
	readonly heads?: ReturnType<typeof arrowheadsNear>;
	/** Group frame outlines, which routes cross but never run along. */
	readonly outlines: readonly RouteSegment[];
	readonly quality?: ReturnType<typeof candidateRouteQuality>;
	readonly segments: readonly RouteSegment[];
	/** Other lines a route meets anywhere but a clean crossing, when routes bend clear of lines first. */
	readonly touches?: ReturnType<typeof candidateTouches>;
	/** Turns and ends of other lines, and their runs, a grid search keeps a touch gap from then. */
	readonly touchGrid?: TouchGrid;
}

/** A straight run of a routed arrow, across which another line would cross it. */
export interface CrossingRun {
	readonly arrowId: string;
	/** The coordinate the run keeps: y for a horizontal run, x for a vertical one. */
	readonly at: number;
	readonly max: number;
	readonly min: number;
}

export interface CrossingLookup {
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

export interface LabelBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** A drawn label nearer another line than it may be, by `shortfall`. */
export interface LabelShortfall {
	readonly box: LabelBox;
	/** Distance from the label to its own line. */
	readonly own: number;
	readonly index: number;
	readonly shortfall: number;
}

/** Optional layout and routing passes; the plain router (as of #405) has all of them off. */
export interface RoutingPolish {
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

export interface DiagramLayout {
	/** How each side's ports are ordered (portOrderOf). */
	byApproach?: PortOrder;
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

/**
 * How a side's ports are ordered: by the far node along the side, by where
 * each line leaves the far node (`true`, with the crossing repairs), or so too
 * with lines that run around into the same side of a node beyond nested by
 * how far they reach ("nested", Arrangement.nestAround).
 */
export type PortOrder = boolean | "nested";

export interface SettledLayout {
	readonly arrangement: Arrangement;
	readonly defects: readonly [number, number];
	readonly layout: DiagramLayout;
}

export type SideMove = Map<string, { sourceEdge?: ConnectionEdge; targetEdge?: ConnectionEdge }>;

/** A settled layout carried through its repairs, finished as it is drawn. */
export interface CompletedLayout {
	readonly layout: DiagramLayout;
	readonly settled: SettledLayout;
}
