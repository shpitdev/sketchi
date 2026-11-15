/** Owns one arrangement attempt: placement, ports, routing and its polish passes.
 * Also computes lane tightening, zone cut edges and room for outline clearance. */
import {
	type RoutingPolish,
	type RoutedEdge,
	type GroupLayout,
	type Wrap,
	type LayoutDirection,
	type DiagramLayout,
	type Arrangement,
	type PortOrder,
	type PositionedLayout,
	type RouteOptions,
} from "./layout-types.js";
import { type GraphInput, type GraphEdge } from "./input.js";
import {
	markerSize,
	branches,
	branchLabelMetrics,
	EXPORT_PADDING,
	createNodeShape,
} from "./measure.js";
import {
	isSelfLoop,
	OPPOSITE_EDGE,
	slotAxis,
	pointOnEdge,
	connectionKey,
	PORT_SPACING,
	FORWARD_SIDE,
	center,
	ROUTE_STUB_LENGTH,
	portJogSteps,
	LANE_ARRIVAL_SPACING,
	ARRIVAL_SPACING,
	connectionEdges,
} from "./geometry.js";
import { padBox, boxesOverlap, labelBox } from "./label-geometry.js";
import {
	groupChain,
	groupKeepOuts,
	boundsOf,
	frameOutline,
	ZONE_HEADER,
	groupBlocks,
	sharedGroup,
	compositeShapes,
	laneBlocks,
} from "./containers.js";
import {
	type CanvasShapeElement as NodeSceneElement,
	AXIS_ALIGNED_EPSILON,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
	GROUP_OUTLINE_CLEARANCE,
	routingQualityScale,
	routingJogReach,
	routingWideBend,
} from "@sketchi/drawing";
import {
	TOP_LEVEL,
	ACROSS_DIRECTION,
	laned,
	laneColumns,
	rankLayout,
	COMPACT_GAP,
	LANE_ASPECT,
	COMPACT_ASPECT,
	PLAIN_ARRANGEMENT,
	positionLayout,
} from "./placement.js";
import { type GraphLayout, type RankedFlow, flowEdges, groupUnitId } from "./topology.js";
import { exportRouteDefects, exportAspect, routingDefects, routesNoWorse } from "./readability.js";
import { branchLabels } from "./labels.js";
import {
	alongsideReach,
	straightRuns,
	keepsClearOf,
	segmentAlongside,
	drawnSize,
} from "./route-geometry.js";
import { type GraphRenderOptions, type GraphAnchor } from "./options.js";
import {
	alignedPortOffsets,
	portOffsetsForRoutes,
	assignDecisionSides,
	routeForEdge,
	assignLaneSides,
	assignLaneBranchSides,
	assignLoopSides,
	assignFeedbackSides,
	assignPairedReturns,
	separateLaneRoles,
	portCapacityForRoutes,
	assignDirectFeedbackPorts,
	stubReachForRoutes,
	straightHandoff,
	assignLaneContinuations,
} from "./ports.js";
import { routeAllEdges, resideArrivals, rerouteDefects } from "./routing.js";

const PLAIN: RoutingPolish = { ports: false, reader: false, sides: false, repair: false };

/**
 * Most polished first; each later level drops a pass. The last is the plain
 * router, so a layout never has more export defects or inward endpoints than
 * #405 would draw. Straight and curved routing only repair their port choices.
 */
export function polishLevels(edgeRouting: GraphInput["layout"]["edgeRouting"]) {
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
export function zoneCutEdges(
	layoutGraph: GraphLayout,
	zoneWraps: ReadonlyMap<string, Wrap> | undefined,
): ReadonlySet<string> {
	const structure = zoneWraps ? layoutGraph.groups : undefined;
	if (!structure || !zoneWraps) return new Set();
	const levels = new Map<string, RankedFlow>([
		[TOP_LEVEL, structure.top],
		...structure.groups.map((level) => [level.group.id, level.flow] as const),
	]);
	return new Set(
		[...zoneWraps].flatMap(([level, { bandOf }]) =>
			flowEdges(levels.get(level)!)
				.filter((edge) => (bandOf.get(edge.source) ?? 0) !== (bandOf.get(edge.target) ?? 0))
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
export function contendedContinuations(
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

/** Extra padding a crowded group gains per repair, and how many repairs it may take. */
export const GROUP_SLACK = 2 * PORT_SPACING;

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
		const box = labelBox(
			label,
			branchLabelMetrics(
				routedEdges.find((route) => route.edge.id === arrow!.edgeId)!.edge,
				label.maxWidth === 80,
			),
		);
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
 * Zones where a line runs alongside a node they hold, nearer than the corridor
 * gap, and the zone's outline leaves no lane the gap from the node there for
 * clearOutlines to move it to.
 */
export function zonesWithoutAlongsideRoom(layout: DiagramLayout): Set<string> {
	const { edgeArrows, groups, nodeShapes } = layout;
	const roomless = new Set<string>();
	const alongside = alongsideReach(layout);
	if (!groups || !alongside) return roomless;
	for (const arrow of edgeArrows) {
		const ends = new Set([arrow.sourceNodeId, arrow.targetNodeId]);
		for (const run of segmentsFromPoints(straightRuns(arrow.points))) {
			if (run.isFirstSegment || run.isLastSegment) continue;
			for (const shape of nodeShapes) {
				if (!keepsClearOf(shape, ends) || !segmentAlongside(run, shape, alongside)) continue;
				const frame = groups.frames.find(
					(candidate) => candidate.id === groups.groupOf.get(shape.nodeId),
				);
				if (!frame) continue;
				const [low, size, start, end] =
					run.orientation === "horizontal"
						? [shape.y, shape.height, frame.box.y + ZONE_HEADER, frame.box.y + frame.box.height]
						: [shape.x, shape.width, frame.box.x, frame.box.x + frame.box.width];
				const lane =
					run.staticCoordinate < low ? low - alongside.gap - 1 : low + size + alongside.gap + 1;
				if (
					run.staticCoordinate > start &&
					run.staticCoordinate < end &&
					(lane < start + GROUP_OUTLINE_CLEARANCE || lane > end - GROUP_OUTLINE_CLEARANCE)
				)
					roomless.add(frame.id);
			}
		}
	}
	return roomless;
}

/**
 * How short each gap between consecutive ranks of a column, or columns of
 * lanes, can draw: one that lines only cross straight, COMPACT_GAP; one that
 * lines turn in, a stub either side of the turns, which keep a port's spacing
 * apart. With `straight`, only the gaps lines cross straight. In a wrapped
 * flow each band counts only its own lines' turns, since every band starts
 * at the top, and the gap at a band's end, where the next band starts again,
 * has no length to tighten.
 */
export function compactGaps(
	layoutGraph: GraphLayout,
	layout: DiagramLayout,
	arrangement: Arrangement,
	straight = false,
): Map<number, number> {
	const diagram = layoutGraph.input;

	const placed = new Map(layout.nodeShapes.map((shape) => [shape.nodeId, shape]));
	// Ranks or columns, each as the ids of its steps, in order along the flow.
	const columns = laned(diagram)
		? [...laneColumns(layoutGraph, arrangement.throughHandoffs)].reduce<string[][]>(
				(list, [id, column]) => {
					(list[column] ??= []).push(id);
					return list;
				},
				[],
			)
		: rankLayout(
				layoutGraph.ranks!,
				diagram.layout.direction,
				new Map(),
				new Map(),
				arrangement.reorder,
			).rankMetrics.map(({ shapes }) => shapes.map((shape) => shape.nodeId));
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const [along, size] = vertical ? (["y", "height"] as const) : (["x", "width"] as const);
	const spans = columns.map((ids) => {
		const boxes = ids.map((id) => placed.get(id)!);
		return {
			top: Math.min(...boxes.map((box) => box[along])),
			bottom: Math.max(...boxes.map((box) => box[along] + box[size])),
		};
	});
	// Where along the flow lines run across it, and the bands of their ends.
	const across = vertical ? "x" : "y";
	const { bandOf } = arrangement.wrap;
	const bandOfNode = (id: string) => bandOf.get(id) ?? 0;
	const turns = layout.edgeArrows.flatMap((arrow) =>
		arrow.points.slice(1).flatMap((point, index) => {
			const previous = arrow.points[index]!;
			return Math.abs(point[along] - previous[along]) <= AXIS_ALIGNED_EPSILON &&
				Math.abs(point[across] - previous[across]) > AXIS_ALIGNED_EPSILON
				? [
						{
							at: point[along],
							bands: [bandOfNode(arrow.sourceNodeId), bandOfNode(arrow.targetNodeId)],
						},
					]
				: [];
		}),
	);
	const gaps = new Map<number, number>();
	for (let index = 0; index < spans.length - 1; index += 1) {
		const band = bandOfNode(columns[index]![0]!);
		if (bandOfNode(columns[index + 1]![0]!) !== band) continue;
		const [upper, lower] = [spans[index]!, spans[index + 1]!];
		// Ranks run down the page in TB and up it in BT, columns right in LR and left in RL.
		const [from, to] =
			upper.bottom <= lower.top ? [upper.bottom, lower.top] : [lower.bottom, upper.top];
		const levels = new Set(
			turns
				.filter(
					({ at, bands }) =>
						bands.includes(band) &&
						at > from + AXIS_ALIGNED_EPSILON &&
						at < to - AXIS_ALIGNED_EPSILON,
				)
				.map(({ at }) => at),
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
export function laneBreadthFor(
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
export function narrowStepGaps(diagram: GraphInput, layout: DiagramLayout): Map<number, number> {
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
export function portJogCount({ edgeArrows, groups, nodeShapes }: DiagramLayout): number {
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
export function behindRankStep(
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
export function layoutDiagram(
	layoutGraph: GraphLayout,
	renderOptions: GraphRenderOptions,
	polish: RoutingPolish,
	arrangement: Arrangement = PLAIN_ARRANGEMENT,
): DiagramLayout {
	let slack = new Map(arrangement.zoneSlack ?? []);
	let layout = layoutDiagramOnce(layoutGraph, renderOptions, polish, arrangement, slack);
	if (!layout.groups) return layout;
	const defects = (attempt: DiagramLayout) =>
		exportRouteDefects(attempt.edgeArrows, attempt.nodeShapes, attempt.groups).length +
		crowdedGroups(attempt).size;
	let score = defects(layout);
	for (let round = 0; round < GROUP_SLACK_ROUNDS && score > 0; round += 1) {
		const crowded = crowdedGroups(layout);
		if (crowded.size === 0) break;
		slack = new Map([
			...slack,
			...[...crowded].map((id) => [id, (slack.get(id) ?? 0) + GROUP_SLACK] as const),
		]);
		const retry = layoutDiagramOnce(layoutGraph, renderOptions, polish, arrangement, slack);
		const retryScore = defects(retry);
		if (retryScore < score) [layout, score] = [retry, retryScore];
	}
	return layout;
}

/** Each node at the box its family placed it in. */
function placedNodes(
	diagram: GraphInput,
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

/** The port order an arrangement lays its sides out in. */
export function portOrderOf(arrangement: Arrangement): PortOrder {
	return arrangement.nestAround ? "nested" : arrangement.crossingRepair;
}

/** Port offsets at a polish: aligned, ordered by approach where `byApproach`, then pinned. */
export function portOffsetsAt(
	routes: readonly RoutedEdge[],
	polish: RoutingPolish,
	byApproach: PortOrder,
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
	layoutGraph: GraphLayout,
	renderOptions: GraphRenderOptions,
	polish: RoutingPolish,
	arrangement: Arrangement,
	slack: ReadonlyMap<string, number>,
): DiagramLayout {
	const diagram = layoutGraph.input;

	const orthogonal = diagram.layout.edgeRouting === "orthogonal";
	const { anchors, besideShared, endRun, placement } = renderOptions;
	const offsetsFor = (routes: readonly RoutedEdge[]) =>
		portOffsetsAt(routes, polish, portOrderOf(arrangement), laned(diagram));
	const { wrap } = arrangement;
	const zoneCuts = zoneCutEdges(layoutGraph, arrangement.zoneWraps);
	let {
		groups,
		lanes,
		nodes: nodeShapes,
		skipLaneAt,
	}: PositionedLayout = placement
		? { nodes: placedNodes(diagram, placement) }
		: positionLayout(layoutGraph, new Map(), new Map(), arrangement, slack);
	// Groups laid out across the flow read in their own direction inside.
	const { direction } = diagram.layout;
	// A node reads in its group's direction, and an edge in the direction of the
	// innermost group holding both its ends.
	const turned = (group: string | undefined) =>
		group !== undefined && groups !== undefined && groups.across.has(group);
	const nodeDirection = (nodeId: string) =>
		turned(groups?.groupOf.get(nodeId)) ? ACROSS_DIRECTION[direction] : direction;
	const edgeDirection = (edge: GraphEdge) =>
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
	const routedEdges = flowEdges(layoutGraph.flow).map((edge, index) =>
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
	if (besideShared !== undefined)
		for (const route of routedEdges) route.besideShared = besideShared;
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
		assignFeedbackSides(layoutGraph, routedEdges, (route) => edgeDirection(route.edge));
		if (renderOptions.pairedReturns)
			assignPairedReturns(
				routedEdges,
				layoutGraph.feedback,
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
		const direct = assignDirectFeedbackPorts(layoutGraph, routedEdges, nodeShapes, polish.repair);
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
			skipLaneAt,
		} = positionLayout(layoutGraph, capacity, reach, arrangement, slack));
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
				layoutGraph,
				routedEdges,
				nodeShapes,
				polish.repair,
			).offsets;
		}
	}
	nodeShapes = alignMarkers(routedEdges, nodeShapes, groups, portOffsets);
	if (orthogonal && skipLaneAt) {
		const vertical = direction === "TB" || direction === "BT";
		const [along, size] = vertical ? (["y", "height"] as const) : (["x", "width"] as const);
		const forward = direction === "TB" || direction === "LR" ? 1 : -1;
		// Midway across the gap beside a node's side facing `toward` along the flow.
		const gapMid = (node: NodeSceneElement, toward: 1 | -1) => {
			const side = toward * forward > 0 ? node[along] + node[size] : node[along];
			const beyond = nodeShapes
				.map((other) => (toward * forward > 0 ? other[along] : other[along] + other[size]))
				.filter((edge) => (edge - side) * toward * forward > AXIS_ALIGNED_EPSILON);
			const next =
				beyond.length > 0
					? toward * forward > 0
						? Math.min(...beyond)
						: Math.max(...beyond)
					: side + toward * forward * 2 * ROUTE_STUB_LENGTH;
			return (side + next) / 2;
		};
		for (const route of routedEdges) {
			const at = skipLaneAt.get(route.edge.id);
			if (at !== undefined)
				route.skipLane = {
					at,
					vertical,
					leave: gapMid(route.source, 1),
					enter: gapMid(route.target, -1),
				};
		}
	}
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
		...(arrangement.clearTouches ? { clearTouches: true } : {}),
	};
	let edgeArrows = routeAllEdges(
		routedEdges,
		diagram.layout.edgeRouting,
		portOffsets,
		nodeShapes,
		options,
	);
	if (orthogonal && polish.sides) {
		const resided = resideArrivals(layoutGraph, routedEdges, edgeArrows, scale, "hooked");
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
			? resideArrivals(layoutGraph, routedEdges, edgeArrows, scale, "crossed")
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
		byApproach: portOrderOf(arrangement),
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
