import { Graph } from "effect";
import { type DiagramGroup, type IntermediateDiagram, type DiagramEdge } from "./intermediate.js";
import {
	type CanvasNodeIcon,
	CANVAS_GROUP_ICON,
	type CanvasShapeElement as NodeSceneElement,
	canvasFrameNameWidth,
	canvasGroupIconRun,
	CANVAS_FRAME_NAME,
	AXIS_ALIGNED_EPSILON,
	canvasGroupIconBox,
	canvasFrameNameBox,
} from "@sketchi/drawing";
import {
	MIN_NODE_WIDTH,
	MAX_LABEL_LINE_UNITS,
	createNodeShape,
	branches,
	branchLabelMetrics,
	markerSize,
	squareChoice,
	PADDING,
	MAX_DIAMOND_LABEL_LINE_UNITS,
} from "./measure.js";
import {
	HORIZONTAL_GAP,
	VERTICAL_GAP,
	PORT_SPACING,
	PORT_PADDING,
	ARRIVAL_SPACING,
	portKey,
	FACING_LANES,
	FORWARD_SIDE,
	ROUTE_STUB_LENGTH,
	OPPOSITE_EDGE,
} from "./geometry.js";
import {
	type FlowGraph,
	outgoingEdges,
	incomingEdges,
	type RankedFlow,
	rankOrder,
	flowEdges,
	type GraphLayout,
	type GroupStructure,
	type GroupLevel,
	groupUnitId,
	type LayeredOrder,
	nodeOrderMap,
	RANK_SWEEP_COUNT,
	GROUP_UNIT_PREFIX,
} from "./topology.js";
import {
	type LayoutDirection,
	type ConnectionEdge,
	type RankMetric,
	type Wrap,
	type Arrangement,
	type ZoneWrapOptions,
	type PositionedLayout,
	type GroupBlock,
	type PlacedUnit,
	type Box,
	type GroupFrame,
	type LaneFrame,
} from "./layout-types.js";
import { exportAspect } from "./readability.js";
import {
	boundsOf,
	groupBlocks,
	GROUP_LABEL_BAND,
	ZONE_LABEL_INSET,
	ZONE_HEADER,
	groupRoot,
	groupRoots,
	zoneLabelBox,
	measureLaneLabel,
	LANE_HEADER_PADDING,
	laneElementBases,
} from "./containers.js";
import { padBox } from "./label-geometry.js";

/** Inner padding of a group's frame around its members. */
const GROUP_PADDING = 40;

/**
 * A zone's inner padding, slimmer than a frame's so nested zones stay compact,
 * and the header strip across its top that holds its label, which sits this
 * far in from the zone's left side.
 */
const ZONE_PADDING = 24;

/** The logo a group draws before its label. */
function groupIcon(group: DiagramGroup): CanvasNodeIcon | undefined {
	return group.icon ? { slug: group.icon.slug, size: CANVAS_GROUP_ICON.size } : undefined;
}

/**
 * Crossing repairs (reordered ranks, moved arrivals) each route the diagram once
 * more; denser diagrams keep a single routing pass.
 */
export const CROSSING_REPAIR_MAX_EDGES = 24;

/**
 * Each node's shape, at least its minimum size and wide enough across the flow
 * for a port per connection, sized before ranking so clamping never merges
 * endpoints.
 */
function sizedShapes(
	flow: FlowGraph,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	vertical: boolean,
	minimumWidth = MIN_NODE_WIDTH,
	lineUnits = MAX_LABEL_LINE_UNITS,
): Map<string, NodeSceneElement> {
	return new Map(
		flow.nodes.map((node) => {
			const originalShape = createNodeShape(node, minimumWidth, lineUnits);
			const minimum = minimumSizes.get(node.id);
			const shape = {
				...originalShape,
				width: Math.max(originalShape.width, minimum?.width ?? 0),
				height: Math.max(originalShape.height, minimum?.height ?? 0),
			};
			// Allocate enough port capacity before ranking; clamping must never merge endpoints.
			// A self-loop takes a corner of its own, and a marker keeps one port per side.
			const outgoing = outgoingEdges(flow, node.id).filter((e) => e.target !== node.id);
			const connections =
				incomingEdges(flow, node.id).filter((e) => e.source !== node.id).length + outgoing.length;
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
export function rankLayout(
	flow: RankedFlow,
	direction: LayoutDirection,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	stubReach: ReadonlyMap<string, number>,
	reorder = false,
	spreadFacing = false,
	thorough = false,
	throughBlocks = false,
) {
	const vertical = direction === "TB" || direction === "BT";
	// Neighbors in a rank keep room for the stubs on their facing sides, so a long
	// labeled stub never reaches the next node or meets its stub head-on, and,
	// spread, a lane for each line beyond its stub (Arrangement.spreadFacing).
	const [lowSide, highSide]: readonly [ConnectionEdge, ConnectionEdge] = vertical
		? ["left", "right"]
		: ["top", "bottom"];
	const gapBetween = (left: NodeSceneElement, right: NodeSceneElement) => {
		const high = stubReach.get(portKey(left.nodeId, highSide)) ?? 0;
		const low = stubReach.get(portKey(right.nodeId, lowSide)) ?? 0;
		return Math.max(
			HORIZONTAL_GAP,
			high + low + (spreadFacing && high > 0 && low > 0 ? FACING_LANES : PORT_SPACING),
		);
	};
	const shapesByNodeId = sizedShapes(flow, minimumSizes, vertical);
	const feedbackEdges = flow.feedback;
	const order = rankOrder(flow, throughBlocks);
	const rankByNodeId = order.ranks;
	const selected = reorder ? (thorough ? order.sifted!.real : order.reduced!.real) : order.plain;
	const rankedShapes = new Map(
		[...selected].map(([rank, ids]) => [rank, ids.map((id) => shapesByNodeId.get(id)!)]),
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
	const forwardSide = FORWARD_SIDE[direction];
	const reachOf = (shapes: readonly NodeSceneElement[], side: ConnectionEdge) =>
		Math.max(0, ...shapes.map((shape) => stubReach.get(portKey(shape.nodeId, side)) ?? 0));
	const gapAfter = rankMetrics.map((metric, rankIndex) => {
		// Horizontal labels lengthen the departure stub. Reserve room for the
		// opposing arrival stub and a routing lane instead of forcing them to overlap.
		const labelGap = vertical
			? 0
			: Math.max(
					0,
					...flowEdges(flow)
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

export const NO_WRAP: Wrap = { bandOf: new Map(), continuations: new Set() };

/** Shorter flows never wrap; each band keeps at least two ranks. */
const WRAP_MIN_RANKS = 5;

/** A flow wraps when it runs at least this many times longer than it is broad... */
export const WRAP_EXTREME_ASPECT = 4;

export const WRAP_MIN_LENGTH = 1200;

export const FITTED_LONG_SIDE = 2000;

/**
 * A column short of 4:1 whose text fits a screen at 14 px or more wraps only
 * when each new column is at least this much of the longest, so no short
 * column sits beside a long one, reached by a connector across empty space.
 */
export const WRAP_MIN_COLUMN_TEXT = 14;

export const WRAP_COLUMN_BALANCE = 0.6;

/** ...into the fewest bands that bring it within this, if any do. */
const WRAP_TARGET_ASPECT = 2;

const MAX_BANDS = 6;

/** Bands sit farther apart than ranks so each reads as its own row or column. */
const BAND_GAP = 144;

/** A column at least this tall for its breadth that cannot wrap tightens its rank gaps... */
export const COMPACT_ASPECT = 2.3;

/**
 * ...those only straight lines cross to this, room for a label beside an
 * arrowhead, and those lines turn in to the stubs either side of each turn.
 */
export const COMPACT_GAP = 56;

/** The top level of a zoned flow among its levels' wraps; no group id is empty. */
export const TOP_LEVEL = "";

export const PLAIN_ARRANGEMENT: Arrangement = {
	crossingRepair: false,
	reorder: false,
	wrap: NO_WRAP,
};

/** The direction a group reads in when it lies across the flow. */
export const ACROSS_DIRECTION: Readonly<Record<LayoutDirection, LayoutDirection>> = {
	TB: "LR",
	BT: "LR",
	LR: "TB",
	RL: "TB",
};

/** Whether reordering ranks for fewer layered crossings changes this diagram's order. */
export function reordersRanks(layoutGraph: GraphLayout, diagram: IntermediateDiagram): boolean {
	// A laned diagram orders each lane's cells as it lays them out.
	if (laned(diagram)) return false;
	const structure = layoutGraph.groups;
	// A grouped diagram reorders its top level and each group's own ranks.
	const layouts = structure
		? [structure.top, ...structure.groups.map((group) => group.flow)]
		: layoutGraph.ranks
			? [layoutGraph.ranks]
			: [];
	return layouts.some((flow) => {
		const { plain, reduced } = flow.order;
		return [...plain].some(([rank, ids]) =>
			ids.some((id, index) => reduced?.real.get(rank)?.[index] !== id),
		);
	});
}

/**
 * Whether an ungrouped, unlaned flow has a line, a return among them, that
 * skips a rank, one a lane of its own could keep straight, and its sifted
 * layered order crosses fewer than `crossings` (Arrangement.skipLanes).
 */
export function skipsRanks(
	layoutGraph: GraphLayout,
	diagram: IntermediateDiagram,
	crossings: number,
): boolean {
	if (laned(diagram) || layoutGraph.groups) return false;
	const sifted = layoutGraph.ranks?.order.sifted;
	return sifted !== undefined && sifted.virtual.size > 0 && sifted.crossings < crossings;
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
 * With `skips`, a cut that one edge joins may also carry forward edges that skip
 * ranks, each across that cut alone.
 */
export function planWrap(
	flow: RankedFlow,
	layout: IntermediateDiagram["layout"],
	reorder: boolean,
	balance = 0,
	zone?: ZoneWrapOptions,
): Wrap {
	// A band cut must not split a group: a grouped flow wraps by level instead
	// (planZoneWraps).
	if (layout.edgeRouting !== "orthogonal") return NO_WRAP;
	const { feedbackEdges, gapAfter, rankByNodeId, rankMetrics } = rankLayout(
		flow,
		layout.direction,
		zone?.sizes ?? new Map(),
		new Map(),
		reorder,
	);
	const vertical = layout.direction === "TB" || layout.direction === "BT";
	const flowLength = (from: number, to: number) =>
		rankMetrics.slice(from, to + 1).reduce((sum, metric) => sum + metric.depth, 0) +
		gapAfter.slice(from, to).reduce((sum, gap) => sum + gap, 0);
	const breadth = (from: number, to: number) =>
		Math.max(...rankMetrics.slice(from, to + 1).map((metric) => metric.breadth));
	const last = rankMetrics.length - 1;
	const natural = exportAspect(flowLength(0, last), breadth(0, last));
	// Ranks of the whole flow from one rank to another: a zone counts those it holds.
	const weight = (index: number) =>
		Math.max(...rankMetrics[index]!.shapes.map((shape) => zone?.weights.get(shape.nodeId) ?? 1));
	const ranks = (from: number, to: number) => {
		let sum = 0;
		for (let index = from; index <= to; index += 1) sum += weight(index);
		return sum;
	};
	if (ranks(0, last) < WRAP_MIN_RANKS || flowLength(0, last) <= breadth(0, last)) return NO_WRAP;

	const nodeKinds = new Map(flow.nodes.map((node) => [node.id, node.kind]));
	const rankOf = (nodeId: string) => rankByNodeId.get(nodeId) ?? 0;
	const continuationAfter = new Map<number, string>();
	const skippingAfter = new Set<number>();
	for (const [index, metric] of rankMetrics.entries()) {
		const spanning = flowEdges(flow).filter(
			(edge) =>
				Math.min(rankOf(edge.source), rankOf(edge.target)) <= metric.rank &&
				Math.max(rankOf(edge.source), rankOf(edge.target)) > metric.rank,
		);
		const joins = (edge: DiagramEdge) =>
			rankOf(edge.source) === metric.rank && rankOf(edge.target) === metric.rank + 1;
		// A cut may also carry a forward edge that skips ranks, as a cached page's
		// line to a response past the private subnet: its line is searched around
		// the zones like any other, so long as it crosses no other cut.
		const edge = spanning.find(joins);
		if (
			(zone ? spanning.length >= 1 : spanning.length === 1) &&
			edge &&
			spanning.every(
				(candidate) =>
					!feedbackEdges.has(candidate.id) &&
					(zone?.skips ? rankOf(candidate.source) < rankOf(candidate.target) : joins(candidate)) &&
					!branches(nodeKinds.get(candidate.source)),
			)
		) {
			continuationAfter.set(index, edge.id);
			if (!spanning.every(joins)) skippingAfter.add(index);
		}
	}
	// Whether an edge crosses both a cut after rank index `from` and one after `to`.
	const spansCuts = (from: number, to: number) =>
		zone?.skips === true &&
		flowEdges(flow).some(
			(edge) =>
				Math.min(rankOf(edge.source), rankOf(edge.target)) <= rankMetrics[from]!.rank &&
				Math.max(rankOf(edge.source), rankOf(edge.target)) > rankMetrics[to]!.rank,
		);

	// A band also holds the stubs of the continuations into and out of it.
	const edgeLabels = new Map(flowEdges(flow).map((edge) => [edge.id, edge.label]));
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
		return flowLength(from, to) + (from > 0 ? ROUTE_STUB_LENGTH : 0) + departure;
	};

	// Band ends: a clean cut or the last rank, the first past every unit that
	// stays in the first band. Each band keeps at least two ranks; a zoned band
	// hangs under the steps that reach it, so it may hold one.
	const firstEnd = Math.max(
		-1,
		...rankMetrics.flatMap((metric, index) =>
			metric.shapes.some((shape) => zone?.firstBand?.has(shape.nodeId)) ? [index] : [],
		),
	);
	const ends = [...continuationAfter.keys(), last]
		.filter((end) => end >= firstEnd)
		.sort((a, b) => a - b);
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
				if (
					end !== last &&
					end > previous &&
					ranks(previous + 1, end) >= minimum &&
					(previous < 0 || !spansCuts(previous, end))
				)
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
					if (end !== last && spansCuts(previous, end)) continue;
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
		...(chosen.ends.some((end) => skippingAfter.has(end)) ? { skips: true } : {}),
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
		const ranks = [...level.flow.order.plain.values()].reduce(
			(sum, ids) => sum + Math.max(...ids.map((id) => weights.get(id) ?? 1)),
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
export const ZONE_WRAP_ROUNDS = 2;

/**
 * Bands for a grouped flow too long for its breadth, best first. Each level
 * (the top level or one zone's members) wraps as a plain flow does, in the
 * stated direction, its groups whole ranks of it (planWrap). A flat group's
 * members never wrap: its frame stays one block of the top level, which alone
 * wraps, a row or column of groups laid out in rows or columns of them.
 * Levels wrap one at a time:
 * each time the level and band count that bring the whole diagram within
 * WRAP_TARGET_ASPECT with the fewest bands or, if none does, nearest it, while
 * that keeps helping. A row keeps its zones along the flow (see `hangZones`). The
 * single-level plans that come next are alternatives,
 * since a plan may route worse than the layout it replaces. Planning routes
 * nothing: it measures the unrouted layout, scaled by how far the routed one
 * (`drawn`) outgrows it, since routes widen zones for their stubs.
 */
export function planZoneWraps(
	layoutGraph: GraphLayout,
	diagram: IntermediateDiagram,
	structure: GroupStructure,
	arrangement: Arrangement,
	balance: number,
	drawn: { readonly width: number; readonly height: number },
	hangZones = false,
): ReadonlyMap<string, Wrap>[] {
	const levels = new Map<string, RankedFlow>([
		[TOP_LEVEL, structure.top],
		...(structure.zoned
			? structure.groups.map((level) => [level.group.id, level.flow] as const)
			: []),
	]);
	const weights = zoneFlowRanks(structure);
	const unrouted = (zoneWraps: ReadonlyMap<string, Wrap>) => {
		const placed = positionLayout(layoutGraph, diagram, new Map(), new Map(), {
			...arrangement,
			zoneWraps,
		});
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
	// In a row, a cut before a zone hangs that zone under the steps or zone before
	// it, though the flow passes from one to the next along the row, so every
	// zone of a level stays in the level's first band and only steps past them
	// wrap, as a bucket hangs under the VPC beside it. With `hangZones`, a row
	// plans only the cuts that hang a zone, which a layout keeps only where they
	// cross fewer lines (layoutDiagram). Flat groups, such as teams, still wrap a
	// long row into rows of whole groups. A column's cut stands the later group
	// beside the earlier instead, across a wide export, where keeping both in one
	// column would wrap the group inside it into a taller one.
	const row = diagram.layout.direction === "LR" || diagram.layout.direction === "RL";
	const zonesOf = (level: string) =>
		new Set(
			structure.zoned
				? structure.groups.flatMap(({ group }) =>
						(structure.parentOf.get(group.id) ?? TOP_LEVEL) === level
							? [groupUnitId(group.id)]
							: [],
					)
				: [],
		);
	const hangsZone = (level: string, wrap: Wrap) =>
		[...zonesOf(level)].some((unit) => (wrap.bandOf.get(unit) ?? 0) > 0);
	const planned = wraps.size;
	let current = predict(wraps);
	const skipping = (zoneWraps: ReadonlyMap<string, Wrap>) =>
		[...zoneWraps.values()].some((wrap) => wrap.skips);
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
			// Cuts that carry a line skipping ranks may balance the bands better,
			// but the line may cross another, so the cuts that carry none are
			// planned too where they differ.
			const byBands = new Map<string, Plan>();
			for (const skips of [true, false])
				for (let bands = 2; bands <= MAX_BANDS; bands += 1) {
					const wrap = planWrap(level, diagram.layout, arrangement.reorder, balance, {
						bands,
						sizes,
						weights,
						skips,
						...(row && !hangZones ? { firstBand: zonesOf(id) } : {}),
					});
					if (wrap.bandOf.size === 0) continue;
					const key = [...wrap.bandOf].join(" ");
					let plan = byBands.get(key);
					if (!plan) {
						const next = new Map([...wraps, [id, wrap]]);
						plan = { ...predict(next), bands, next };
						byBands.set(key, plan);
						plans.push(plan);
					}
					if (plan.aspect <= WRAP_TARGET_ASPECT) break;
				}
		}
		const helping = plans.filter((plan) => plan.aspect < current.aspect).sort(rank);
		const [chosen] = helping;
		if (!chosen) break;
		if (wraps.size === planned) {
			// A plan whose cuts carry a skipping line gives way to one without that
			// routes better (layoutDiagram), so one such plan always comes along.
			const next = helping.slice(1, 1 + ZONE_WRAP_ALTERNATIVES);
			const plain =
				skipping(chosen.next) && next.every((plan) => skipping(plan.next))
					? helping.find((plan) => !skipping(plan.next))
					: undefined;
			alternatives.push(...[...next, ...(plain ? [plain] : [])].map((plan) => plan.next));
		}
		wraps = chosen.next;
		current = chosen;
	}
	const hanging = (zoneWraps: ReadonlyMap<string, Wrap>) =>
		[...zoneWraps].some(([id, wrap]) => hangsZone(id, wrap));
	const result = wraps.size > planned ? [wraps, ...alternatives] : [];
	return row && hangZones ? result.filter(hanging) : result;
}

/** How far along the flow each band starts, for a wrap whose bands hang under their entries. */
function bandsUnder(
	flow: FlowGraph,
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
		const entries = flowEdges(flow).flatMap((edge) =>
			bandOf.get(edge.source) === band - 1 && bandOf.get(edge.target) === band
				? [end.get(edge.source)! + shifts[band - 1]! - lengths[band]!]
				: [],
		);
		shifts.push(Math.max(0, Math.min(Math.max(0, ...entries), longest - lengths[band]!)));
	}
	return shifts;
}

/** Weight of a passing line's place in a rank against a node's, so long lines run straight. */
const SKIP_LANE_WEIGHT = 8;

/** Alternating sweeps that settle where each node and passing line sits across the flow. */
const SKIP_LANE_SWEEPS = 4;

/**
 * Least-squares places along a line for items kept in order and at least
 * `gaps[i]` apart from the next, each pulled toward its `wanted` place by its
 * weight: pool-adjacent-violators over places shifted by the gaps before them.
 */
function orderedFit(
	wanted: readonly number[],
	weights: readonly number[],
	gaps: readonly number[],
): number[] {
	const before = wanted.map((_, index) => gaps.slice(0, index).reduce((sum, gap) => sum + gap, 0));
	const blocks: { value: number; weight: number; count: number }[] = [];
	for (const [index, value] of wanted.entries()) {
		let block = { value: value - before[index]!, weight: weights[index]!, count: 1 };
		while (blocks.length > 0 && blocks.at(-1)!.value >= block.value) {
			const last = blocks.pop()!;
			const weight = last.weight + block.weight;
			block = {
				value: (last.value * last.weight + block.value * block.weight) / weight,
				weight,
				count: last.count + block.count,
			};
		}
		blocks.push(block);
	}
	return blocks
		.flatMap((block) => Array.from({ length: block.count }, () => block.value))
		.map((value, index) => value + before[index]!);
}

/**
 * Where each node's middle sits across the flow when every line that passes a
 * rank on its way to a later one keeps a lane there (Arrangement.skipLanes):
 * the ranks keep their layered order, passing lines among their nodes, and
 * each node and lane is pulled toward the nodes and lanes it links to in the
 * ranks beside it, a lane more strongly, so a long line runs straight past the
 * ranks it skips instead of around them.
 */
function skipLaneCenters(
	layered: LayeredOrder,
	rankMetrics: readonly RankMetric[],
	breadthOf: (shape: NodeSceneElement) => number,
	gapBetween: (left: NodeSceneElement, right: NodeSceneElement) => number,
	laneGap: (shape: NodeSceneElement, side: "low" | "high") => number,
	anchors: ReadonlyMap<string, string>,
): Map<string, number> {
	const shapes = new Map(
		rankMetrics.flatMap((metric) => metric.shapes.map((shape) => [shape.nodeId, shape] as const)),
	);
	const ranks = rankMetrics.map((metric) => {
		const ids = (layered.full.get(metric.rank) ?? []).filter(
			(id) => shapes.has(id) || layered.virtual.has(id),
		);
		// Nodes the layered order lost (none, normally) keep their rank's order at its end.
		return [...ids, ...metric.shapes.map((s) => s.nodeId).filter((id) => !ids.includes(id))];
	});
	const size = (id: string) => (shapes.has(id) ? breadthOf(shapes.get(id)!) : 0);
	const gap = (left: string, right: string) => {
		const [a, b] = [shapes.get(left), shapes.get(right)];
		const lane = HORIZONTAL_GAP / 2;
		const between =
			a && b
				? gapBetween(a, b)
				: a
					? Math.max(lane, laneGap(a, "high"))
					: b
						? Math.max(lane, laneGap(b, "low"))
						: ROUTE_STUB_LENGTH;
		return size(left) / 2 + between + size(right) / 2;
	};
	const gaps = ranks.map((ids) => ids.slice(1).map((id, index) => gap(ids[index]!, id)));
	const center = new Map<string, number>();
	for (const [index, ids] of ranks.entries()) {
		const total = gaps[index]!.reduce((sum, value) => sum + value, 0);
		let at = -total / 2;
		for (const [position, id] of ids.entries()) {
			center.set(id, at);
			at += gaps[index]![position] ?? 0;
		}
	}
	const above = new Map<string, string[]>();
	const below = new Map<string, string[]>();
	for (const pairs of layered.links.values())
		for (const [upper, lower] of pairs) {
			below.set(upper, [...(below.get(upper) ?? []), lower]);
			above.set(lower, [...(above.get(lower) ?? []), upper]);
		}
	// A node follows the nodes it links to, and a lane only where it links to
	// none, so a line's lane never draws its ends off their own column.
	const pulls = (id: string, neighbors: ReadonlyMap<string, readonly string[]>) => {
		const around = (neighbors.get(id) ?? []).filter((other) => center.has(other));
		const nodes = around.filter((other) => !layered.virtual.has(other));
		return layered.virtual.has(id) || nodes.length === 0 ? around : nodes;
	};
	const settle = (index: number, neighbors: ReadonlyMap<string, readonly string[]>) => {
		const ids = ranks[index]!;
		const wanted = ids.map((id) => {
			// A forward line's lane runs on in line with the node it leaves.
			const anchor = anchors.get(id);
			if (anchor !== undefined && center.has(anchor)) return center.get(anchor)!;
			const around = pulls(id, neighbors);
			return around.length > 0
				? around.reduce((sum, other) => sum + center.get(other)!, 0) / around.length
				: center.get(id)!;
		});
		const weights = ids.map((id) =>
			layered.virtual.has(id) ? SKIP_LANE_WEIGHT : pulls(id, neighbors).length > 0 ? 1 : 0.01,
		);
		const placed = orderedFit(wanted, weights, gaps[index]!);
		ids.forEach((id, position) => center.set(id, placed[position]!));
	};
	for (let sweep = 0; sweep < SKIP_LANE_SWEEPS; sweep += 1) {
		for (let index = 1; index < ranks.length; index += 1) settle(index, above);
		for (let index = ranks.length - 2; index >= 0; index -= 1) settle(index, below);
	}
	return center;
}

/**
 * `centers` holds, by unit id, how far a zone block's members sit across the
 * flow from the block's middle, where its header strip (or a side widened for
 * its name) pushes them. A block alone in its rank is placed by its members, so
 * a flow running through nested zones stays straight.
 * With `skipLaneAt`, each skipping line's lane across the flow is recorded
 * there by edge id (Arrangement.skipLanes).
 */
function positionNodes(
	flow: RankedFlow,
	direction: LayoutDirection,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
	stubReach: ReadonlyMap<string, number> = new Map(),
	{
		compactGaps,
		reorder,
		skipLanes,
		spreadFacing,
		throughBlocks,
		widenGaps,
		wrap,
	}: Arrangement = PLAIN_ARRANGEMENT,
	centers: ReadonlyMap<string, number> = new Map(),
	skipLaneAt?: Map<string, number>,
): NodeSceneElement[] {
	const lanesAcross = skipLanes === true && wrap.continuations.size === 0;
	const { feedbackEdges, gapAfter, gapBetween, highSide, lowSide, rankMetrics, reachOf, vertical } =
		rankLayout(
			flow,
			direction,
			minimumSizes,
			stubReach,
			reorder || lanesAcross,
			spreadFacing,
			lanesAcross,
			throughBlocks,
		);
	const layered = lanesAcross ? rankOrder(flow, throughBlocks).sifted : undefined;
	const sources = new Map(flowEdges(flow).map((edge) => [edge.id, edge.source]));
	const across = layered
		? skipLaneCenters(
				layered,
				rankMetrics,
				(shape) => (vertical ? shape.width : shape.height),
				gapBetween,
				(shape, side) =>
					(stubReach.get(portKey(shape.nodeId, side === "low" ? lowSide : highSide)) ?? 0) +
					PORT_SPACING,
				new Map(
					[...layered.virtual].flatMap((id) => {
						const edgeId = id.split("\u0000")[1]!;
						return feedbackEdges.has(edgeId) ? [] : [[id, sources.get(edgeId)!] as const];
					}),
				),
			)
		: undefined;
	// Lanes shift so the nearest node or lane keeps the padding from the edge.
	const acrossLow = across
		? Math.min(
				...rankMetrics.flatMap((metric) =>
					metric.shapes.map(
						(shape) => across.get(shape.nodeId)! - (vertical ? shape.width : shape.height) / 2,
					),
				),
				...[...layered!.virtual].flatMap((id) =>
					across.has(id) ? [across.get(id)! - HORIZONTAL_GAP / 2] : [],
				),
			)
		: 0;
	// Each skipping line's lane, where its places in the ranks it passes average.
	if (across && skipLaneAt) {
		const places = new Map<string, number[]>();
		for (const id of layered!.virtual) {
			const at = across.get(id);
			const edgeId = id.split("\u0000")[1]!;
			if (at !== undefined) places.set(edgeId, [...(places.get(edgeId) ?? []), at]);
		}
		for (const [edgeId, at] of places)
			skipLaneAt.set(
				edgeId,
				PADDING + at.reduce((sum, value) => sum + value, 0) / at.length - acrossLow,
			);
	}
	const bands: { index: number; metric: RankMetric }[][] = [];
	for (const [index, metric] of rankMetrics.entries()) {
		const band = wrap.bandOf.get(metric.shapes[0]!.nodeId) ?? 0;
		(bands[band] ??= []).push({ index, metric });
	}
	const positioned: NodeSceneElement[] = [];
	const bandShift = wrap.under ? bandsUnder(flow, bands, gapAfter, wrap.bandOf) : [];
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
				if (across)
					breadthOffset =
						bandOffset +
						across.get(shape.nodeId)! -
						acrossLow -
						(vertical ? shape.width : shape.height) / 2;
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

	if (direction === "BT") {
		const totalHeight = Math.max(...positioned.map((shape) => shape.y + shape.height));
		return positioned.map((shape) => ({
			...shape,
			y: PADDING + totalHeight - shape.y - shape.height,
		}));
	}

	if (direction === "RL") {
		const totalWidth = Math.max(...positioned.map((shape) => shape.x + shape.width));
		return positioned.map((shape) => ({
			...shape,
			x: PADDING + totalWidth - shape.x - shape.width,
		}));
	}

	return positioned;
}

export function positionLayout(
	layoutGraph: GraphLayout,
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
	stubReach: ReadonlyMap<string, number> = new Map(),
	arrangement: Arrangement = PLAIN_ARRANGEMENT,
	slack: ReadonlyMap<string, number> = new Map(),
): PositionedLayout {
	if (laned(diagram))
		return positionLanedNodes(layoutGraph, diagram, minimumSizes, stubReach, arrangement);
	const structure = layoutGraph.groups;
	return structure
		? positionGroupedNodes(
				diagram,
				structure,
				minimumSizes,
				stubReach,
				{ ...arrangement, skipLanes: false },
				slack,
			)
		: positionPlainNodes(layoutGraph, diagram, minimumSizes, stubReach, arrangement);
}

/** An ungrouped, unlaned flow's nodes and, with Arrangement.skipLanes, its skipping lines' lanes. */
function positionPlainNodes(
	layoutGraph: GraphLayout,
	diagram: IntermediateDiagram,
	minimumSizes: ReadonlyMap<string, { width: number; height: number }>,
	stubReach: ReadonlyMap<string, number>,
	arrangement: Arrangement,
): PositionedLayout {
	const skipLaneAt = new Map<string, number>();
	const nodes = positionNodes(
		layoutGraph.ranks!,
		diagram.layout.direction,
		minimumSizes,
		stubReach,
		arrangement,
		new Map(),
		skipLaneAt,
	);
	return skipLaneAt.size > 0 ? { nodes, skipLaneAt } : { nodes };
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
	const layOut = ({ flow, children, crossing, group }: GroupLevel) => {
		for (const child of children) layOut(levels.get(child)!);
		const direction = turned.has(group.id)
			? ACROSS_DIRECTION[diagram.layout.direction]
			: diagram.layout.direction;
		const nodes = positionNodes(
			flow,
			direction,
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
		diagram.layout.direction,
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
	const feedback = top.feedback;
	const rankOf = top.order.ranks;
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
		const edge = flowEdges(top).find(
			(candidate) =>
				!feedback.has(candidate.id) &&
				(forward ? candidate.target : candidate.source) === id &&
				rankOf.get(forward ? candidate.source : candidate.target) === neighbor,
		);
		if (!edge) return;
		// The real edge joins members, not their blocks.
		const real = crossEdges[flowEdges(top).indexOf(edge)]!;
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
				flowEdges(top).flatMap((edge, index) => {
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

/** A vertical lane's header is at least this tall. */
const LANE_HEADER_MIN_HEIGHT = 44;

/**
 * A row of lanes still longer than this for its breadth once tightened, as the
 * PNG frames it, raises its thinnest lanes: past 2.5 a reader takes it for an
 * extreme strip.
 */
export const LANE_ASPECT = 2.4;

/** Whether a diagram declares lanes; a laned diagram puts every node in one. */
export function laned(diagram: IntermediateDiagram): boolean {
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
export function laneColumns(
	layoutGraph: GraphLayout,
	diagram: IntermediateDiagram,
	through = false,
): Map<string, number> {
	const lanes = diagram.lanes ?? [];
	const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
	const laneOf = new Map(
		diagram.nodes.map((node) => [node.id, laneIndex.get(node.lane ?? "") ?? 0]),
	);
	const feedback = layoutGraph.feedback;
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
	// Each column depends only on its predecessors. Native topological order
	// therefore preserves the result without another ready queue or edge buckets.
	const forwardGraph = Graph.mutate(layoutGraph.flow.graph, (mutable) => {
		Graph.filterEdges(mutable, (edge) => !feedback.has(edge.id) && edge.source !== edge.target);
	});
	const place = (stay: ReadonlySet<string>) => {
		const column = new Map<string, number>();
		const reached = new Map<string, number[]>();
		for (const id of Graph.values(Graph.topo(forwardGraph))) {
			const lane = laneOf.get(id)!;
			const incoming = incomingEdges(layoutGraph.flow, id).filter(
				(edge) => !feedback.has(edge.id) && edge.source !== edge.target,
			);
			const before = lanes.map((_, index) =>
				Math.max(-1, ...incoming.map((edge) => reached.get(edge.source)![index]!)),
			);
			let at = before[lane]! + 1;
			for (const edge of incoming)
				at = Math.max(at, column.get(edge.source)! + (stay.has(edge.id) ? 0 : 1));
			column.set(id, at);
			before[lane] = at;
			reached.set(id, before);
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
	layoutGraph: GraphLayout,
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
	// Rows of lanes run long, so their steps wrap sooner and keep only the width
	// their labels need.
	const shapes = vertical
		? sizedShapes(layoutGraph.flow, minimumSizes, vertical)
		: sizedShapes(
				layoutGraph.flow,
				minimumSizes,
				vertical,
				LANE_MIN_NODE_WIDTH,
				MAX_DIAMOND_LABEL_LINE_UNITS,
			);
	const columns = laneColumns(layoutGraph, diagram, through);
	const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
	const laneOf = new Map(diagram.nodes.map((node) => [node.id, node.lane!]));
	const columnCount = Math.max(0, ...columns.values()) + 1;

	// Cells of one lane and one column, stacked across in barycentric order.
	const cells = lanes.map(() => Array.from({ length: columnCount }, () => [] as string[]));
	for (const node of diagram.nodes)
		cells[laneIndex.get(node.lane!)!]![columns.get(node.id)!]!.push(node.id);
	const feedback = layoutGraph.feedback;
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
export function planLaneWrap(layoutGraph: GraphLayout, diagram: IntermediateDiagram): Wrap {
	const { columnCount, columns, depth, gapAfter, headerSize, poolBreadth } = laneGeometry(
		layoutGraph,
		diagram,
		new Map(),
		new Map(),
	);
	if (columnCount < 2 * 2) return NO_WRAP;
	const feedback = layoutGraph.feedback;
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
	layoutGraph: GraphLayout,
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
		layoutGraph,
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
	const box = (alongFrom: number, alongSize: number, acrossFrom: number, acrossSize: number): Box =>
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
