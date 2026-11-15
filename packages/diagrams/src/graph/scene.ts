/** Owns the six-phase arrangement search and final Canvas assembly.
 * Candidate routing lives in layout; geometric repairs live in polish. */
import {
	type CanvasSpec,
	type DiagramStyle,
	AXIS_ALIGNED_EPSILON,
	type CanvasFrameElement as FrameSceneElement,
	CANVAS_SPEC_VERSION,
} from "@sketchi/drawing";
import { type GraphInput } from "./input.js";
import { type GraphRenderOptions } from "./options.js";
import {
	type DiagramLayout,
	type Arrangement,
	type Wrap,
	type SettledLayout,
	type CompletedLayout,
	type SideOverrides,
} from "./layout-types.js";
import {
	exportRouteDefects,
	inwardEndpoints,
	arrowCrossings,
	readerFindingCount,
	routesNoWorse,
	WRAP_ASPECT,
	detouredLines,
	headCrossers,
	touchingEdges,
	touchingLineCount,
	exportAspect,
} from "./readability.js";
import {
	polishLevels,
	layoutDiagram,
	contendedContinuations,
	portJogCount,
	zoneCutEdges,
	behindRankStep,
	zonesWithoutAlongsideRoom,
	GROUP_SLACK,
	compactGaps,
	laneBreadthFor,
	narrowStepGaps,
	portOffsetsAt,
} from "./layout.js";
import {
	PLAIN_ARRANGEMENT,
	CROSSING_REPAIR_MAX_EDGES,
	laned,
	reordersRanks,
	FITTED_LONG_SIDE,
	WRAP_EXTREME_ASPECT,
	WRAP_MIN_COLUMN_TEXT,
	WRAP_COLUMN_BALANCE,
	WRAP_MIN_LENGTH,
	planLaneWrap,
	NO_WRAP,
	planWrap,
	ZONE_WRAP_ROUNDS,
	planZoneWraps,
	TOP_LEVEL,
	positionLayout,
	COMPACT_ASPECT,
	laneColumns,
	skipsRanks,
} from "./placement.js";
import { groupBlocks, laneBlocks } from "./containers.js";
import { drawnSize, routeLength } from "./route-geometry.js";
import { placedBranchLabels, branchLabels, clearLabels, clearOutlines } from "./labels.js";
import { EXPORT_PADDING, NODE_LABEL_FONT_SIZE } from "./measure.js";
import {
	stepsClearOfEnds,
	straightEndsOffVertices,
	centerLoneArrivals,
	endsOffCorners,
	straightenArrivals,
	polishArrivals,
	returnsToNearVertices,
	nestSharedArrivals,
	drawsNoWorse,
	nearOutlines,
	hookedRoutes,
	repairCrossings,
	lowerScore,
	CROSSING_REPAIR_MAX_CROSSINGS,
	labelCrowding,
	drawnLongSide,
	drawnExtent,
	sharedSegmentCount,
	dippedArrivals,
	labelsNoWorse,
	LABEL_ROOM_FOR_CROSSING,
	LONGER_FOR_CROSSINGS,
	chooseBranchSides,
	RIVAL_CROSSING_SLACK,
} from "./polish.js";
import { ROUTE_STUB_LENGTH, OPPOSITE_EDGE, FORWARD_SIDE } from "./geometry.js";
import { routeAllEdges, TOUCH_MOVES, TOUCH_DRAWINGS, TOUCH_ROUNDS } from "./routing.js";
import {
	nodeTexts,
	withGroupFrames,
	drawnMarker,
	laneElements,
	zoneElements,
	normalizeSceneOrigin,
	sceneBounds,
} from "./compose.js";
import { curvedScene } from "./curved-routes.js";
import {
	type GraphLayout,
	prepareGraph,
	withReducedRanks,
	withThroughRanks,
	withSiftedRanks,
} from "./topology.js";
import { unavoidableCrossings } from "./planarity.js";

/** Lay out and route the trusted geometry supplied by a validated family. */
export function renderGraphDiagram(
	diagram: GraphInput,
	presentation: { readonly id: string; readonly title: string; readonly style: DiagramStyle },
	renderOptions: GraphRenderOptions = {},
): CanvasSpec {
	// Curved lines follow the orthogonal routes, each corner curved (curvedScene).
	if (diagram.layout.edgeRouting === "curved")
		return curvedScene(
			renderGraphDiagram(
				{ ...diagram, layout: { ...diagram.layout, edgeRouting: "orthogonal" } },
				presentation,
				renderOptions,
			),
		);
	const search = settleWithPolishFallback(diagram, renderOptions);
	repairInitialCrossings(search);
	const tooLongBeforeWrap = wrapFlow(search);
	layGroupsAcrossFlow(search, tooLongBeforeWrap);
	wrapZones(search);
	const layout = polishAndClear(search);
	const { groups, lanes, routedEdges } = layout;
	const routedArrows =
		diagram.layout.edgeRouting === "straight"
			? straightEndsOffVertices(layout, renderOptions)
			: [...layout.edgeArrows];
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
	const framed = groups && !groups.zoned ? withGroupFrames(groups, drawn, routedEdges) : drawn;
	const { arrows: edgeArrows, frames, labels } = framed;
	const nodeShapes = framed.nodes.flatMap((shape) =>
		drawnMarker(shape, presentation.style.accentColor),
	);
	// Lanes sit under everything, each band, then its header and the header's name;
	// zones likewise, outermost first, each outline then its label.
	const lane = lanes
		? laneElements(lanes)
		: groups?.zoned
			? zoneElements(groups, presentation.style.accentColor)
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
		diagramId: presentation.id,
		title: presentation.title,
		width: bounds.width,
		height: bounds.height,
		accentColor: presentation.style.accentColor,
		backgroundColor: presentation.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder,
	};
}

/** One render's search data. Only the prepared rank variants and chosen candidate change. */
interface LayoutSearch {
	readonly renderOptions: GraphRenderOptions;
	readonly levels: ReturnType<typeof polishLevels>;
	readonly arranged: boolean;
	readonly orthogonal: boolean;
	readonly vertical: boolean;
	readonly repairable: boolean;
	layoutGraph: GraphLayout;
	best: SettledLayout;
}

// Export defects come first; inward endpoints only break ties.
const defectsOf = (attempt: DiagramLayout) =>
	[
		exportRouteDefects(attempt.edgeArrows, attempt.nodeShapes, attempt.groups, attempt.lanes)
			.length,
		inwardEndpoints(attempt.edgeArrows, attempt.nodeShapes),
	] as const;
const fewer = (a: readonly [number, number], b: readonly [number, number]) =>
	a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
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
// A flow too long to read pays for its length, which no crossing or finding
// outweighs one for one: a layout that brings it within a readable aspect
// also routes no worse when it draws no more flaws in all, its crossings
// and reader findings together, than the long one.
const flawCount = (layout: DiagramLayout) =>
	routed(layout, false).reduce((sum, count) => sum + count, 0);
const readsWhole = (search: LayoutSearch, layout: DiagramLayout, current: DiagramLayout) =>
	lengthOf(search, current).tooLong &&
	!lengthOf(search, layout).tooLong &&
	flawCount(layout) <= flawCount(current);
const consider = (
	search: LayoutSearch,
	arrangement: Arrangement,
	fewerCrossings: boolean,
	cleanerOnly = false,
	readable = false,
) => {
	const { renderOptions, levels } = search;
	
	const layout = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
	const defects = defectsOf(layout);
	if (
		!fewer(search.best.defects, defects) &&
		(cleanerOnly
			? cleaner(layout, search.best.layout, false)
			: routesNoWorse(layout, search.best.layout, fewerCrossings, false) ||
				(readable && readsWhole(search, layout, search.best.layout)))
	)
		search.best = { arrangement, defects, layout };
	return layout;
};
const lengthOf = (search: LayoutSearch, layout: DiagramLayout) => {
	const { vertical } = search;
	const size = drawnSize(
		[...layout.nodeShapes, ...groupBlocks(layout.groups), ...laneBlocks(layout.lanes)],
		layout.edgeArrows,
		placedBranchLabels(
			[...layout.edgeArrows],
			layout.routedEdges,
			layout.nodeShapes,
			layout.groups,
			false,
			layout.lanes,
		).bounds,
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
// A layout as drawn: its lines cleared of the nodes they pass too closely and
// of its labels.
const finished = (search: LayoutSearch, settled: DiagramLayout) =>
	search.orthogonal ? clearLabels(clearOutlines(settled)) : settled;
// Returns that wind round to a decision's far side, lines that turn over a
// corner into a crowded side, dip into their target, cross or wind round
// another line into one end, jog beside a port, meet a rounded node within
// its corner's curve, land alone by a side's corner or step sideways beside
// an end are polished where that draws no worse: last, after every choice.
// The ends' polish, from the straight runs on:
const polished = (search: LayoutSearch, drawn: DiagramLayout, nest = true) => {
	const { renderOptions, orthogonal } = search;
	
	const finish = (layout: DiagramLayout) => finished(search, layout);
	const polishedEnds = (arrived: DiagramLayout) =>
		stepsClearOfEnds(
			renderOptions,
			diagram,
			centerLoneArrivals(
				renderOptions,
				diagram,
				endsOffCorners(
					renderOptions,
					diagram,
					straightenArrivals(arrived, finish, defectsOf, fewer),
					finish,
					defectsOf,
					fewer,
				),
				finish,
				defectsOf,
				fewer,
			),
			defectsOf,
			fewer,
		);

	if (!orthogonal) return drawn;
	const arrived = polishArrivals(
		search.layoutGraph,
		returnsToNearVertices(search.layoutGraph, renderOptions, drawn, finish, defectsOf, fewer),
		finish,
		defectsOf,
		fewer,
	);
	const plain = polishedEnds(arrived);
	if (!nest) return plain;
	// Lines merging into one end nest (nestSharedArrivals) where, polished
	// to the end, that draws no worse than leaving them: a nesting that
	// removes one crossing must not bar a later polish that removes more.
	const nested = nestSharedArrivals(
		search.layoutGraph,
		renderOptions,
		arrived,
		finish,
		defectsOf,
		fewer,
	);
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
const clearedLast = (search: LayoutSearch, settled: DiagramLayout) => {
	const { orthogonal } = search;
	if (!orthogonal) return settled;
	const cleared = clearOutlines(settled, true);
	return cleared === settled ? settled : clearLabels(cleared);
};

/** 1. Settle the plain arrangement, dropping polish only to recover a valid export. */
function settleWithPolishFallback(
	diagram: GraphInput,
	renderOptions: GraphRenderOptions,
): LayoutSearch {
	const layoutGraph = prepareGraph(diagram, renderOptions.placement === undefined);
	// Polish must never cost a valid export: drop passes until the export defects and
	// inward endpoints are as few as the plain router's, preferring more polish on a tie.
	const levels = polishLevels(diagram.layout.edgeRouting);
	const settle = (arrangement: Arrangement) => {
		const [first, ...fallbacks] = levels;
		let layout = layoutDiagram(layoutGraph, renderOptions, first!, arrangement);
		let defects = defectsOf(layout);
		for (const polish of fallbacks) {
			if (defects[0] === 0 && defects[1] === 0) break;
			const candidate = layoutDiagram(layoutGraph, renderOptions, polish, arrangement);
			const candidateDefects = defectsOf(candidate);
			if (fewer(candidateDefects, defects)) [layout, defects] = [candidate, candidateDefects];
		}
		return { arrangement, defects, layout };
	};
	const best = settle(PLAIN_ARRANGEMENT);
	// A placed graph keeps its family's arrangement.
	const arranged = renderOptions.placement === undefined;

	const orthogonal = diagram.layout.edgeRouting === "orthogonal";
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const repairable = arranged && orthogonal && diagram.edges.length <= CROSSING_REPAIR_MAX_EDGES;
	return {
		renderOptions,
		layoutGraph,
		levels,
		best,
		arranged,
		orthogonal,
		vertical,
		repairable,
	};
}

/** 2. Try crossing repair, then reduced ranks only while crossings remain. */
function repairInitialCrossings(search: LayoutSearch): void {
	const { repairable } = search;
	
	// Crossing repairs are tried only where the polished router crossed: arrival
	// order and moved arrivals stay when they route no worse, and reordered ranks
	// only when they route with fewer crossings.
	if (repairable && arrowCrossings(search.best.layout.edgeArrows, false) > 0)
		consider(search, { ...search.best.arrangement, crossingRepair: true }, false);
	if (repairable && !laned(diagram) && arrowCrossings(search.best.layout.edgeArrows, false) > 0) {
		search.layoutGraph = withReducedRanks(search.layoutGraph);
		if (reordersRanks(search.layoutGraph))
			consider(search, { ...search.best.arrangement, reorder: true }, true);
	}
}

/** 3. Wrap long flows or lane pools, then compare gap and line-break continuations. */
function wrapFlow(search: LayoutSearch): boolean {
	const { arranged, orthogonal, repairable } = search;
	
	const { aspect, balance, tooLong } = lengthOf(search, search.best.layout);
	// Lanes wrap into pools only past the extreme aspect: a pool split apart reads
	// worse than one long pool.
	const wrap =
		arranged && orthogonal && tooLong
			? laned(diagram)
				? aspect >= WRAP_EXTREME_ASPECT
					? planLaneWrap(search.layoutGraph)
					: NO_WRAP
				: !search.layoutGraph.ranks
					? NO_WRAP
					: planWrap(
							search.layoutGraph.ranks,
							diagram.layout,
							search.best.arrangement.reorder,
							balance,
						)
			: NO_WRAP;
	// A wrapped layout may need crossing repairs of its own; it tries them first.
	const considerWrap = (next: Wrap, cleanerOnly = false) => {
		let tried: DiagramLayout | undefined;
		for (const crossingRepair of repairable && !search.best.arrangement.crossingRepair
			? [true, false]
			: [search.best.arrangement.crossingRepair]) {
			if (next.continuations.size === 0 || search.best.arrangement.wrap === next) break;
			tried = consider(
				search,
				{ ...search.best.arrangement, crossingRepair, wrap: next },
				false,
				cleanerOnly,
				!cleanerOnly,
			);
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
		const gap = search.best.arrangement.wrap === wrap;
		if (!gap || routed(search.best.layout, false).some((count) => count > 0)) {
			const leaveForward = contendedContinuations(tried, wrap, diagram.layout.direction);
			if (leaveForward.size > 0) considerWrap({ ...wrap, leaveForward }, gap);
			if (
				search.best.arrangement.wrap === wrap ||
				search.best.arrangement.wrap.continuations.size === 0
			)
				considerWrap({ ...wrap, lineBreaks: true }, gap);
		}
	}
	// The next phase deliberately uses this pre-wrap length, just as the original search did.
	return tooLong;
}

/** 4. Place grouped members across a long flow; zones retain the authored direction. */
function layGroupsAcrossFlow(search: LayoutSearch, tooLong: boolean): void {
	const { arranged, orthogonal, repairable } = search;
	// A long flow of groups first lays each group's members across the flow, when
	// that routes no worse. Zones never do: across the flow, a zone's members
	// would contradict the direction the diagram states.
	const structure = search.layoutGraph.groups;
	const groupsAcross =
		arranged && orthogonal && tooLong && structure !== undefined && !structure.zoned;
	for (const crossingRepair of repairable && !search.best.arrangement.crossingRepair
		? [true, false]
		: [search.best.arrangement.crossingRepair]) {
		if (!groupsAcross || search.best.arrangement.groupsAcross) break;
		consider(search, { ...search.best.arrangement, crossingRepair, groupsAcross: true }, false);
	}
}

/** 5. Compare zone/frame bands, around-rank routes and room for outline clearance. */
function wrapZones(search: LayoutSearch): void {
	const { renderOptions, levels, arranged, orthogonal, repairable } = search;
	
	const structure = search.layoutGraph.groups;
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
		lengthOf(search, layout).aspect,
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
			clearedLast(search, finished(search, settled)),
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
				findingsOf(clearedLast(search, polished(search, finished(search, candidate)))) <=
					findingsOf(clearedLast(search, polished(search, finished(search, reference)))))
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
		const length = lengthOf(search, search.best.layout);
		if (!length.tooLong) break;
		const kept = search.best;
		let chosen: (typeof search.best & { score: number[] }) | undefined;
		let repairedChoice: (typeof search.best & { score: number[] }) | undefined;
		// A chosen plan whose cuts carry a line skipping ranks also gives way to a
		// later plan adding nothing that crosses fewer lines or draws fewer
		// findings: the skipping line may cross another, so the plan is kept only
		// where it draws neither more than such a rival.
		let yielding = false;
		// A row's plans keep its zones along the flow. Those that hang a zone come
		// last, each kept only where it crosses fewer lines than the row and than
		// any plan before it, as a dense graph's lines back against the flow may;
		// a row that crosses none plans none.
		const rowOfZones =
			structure.zoned &&
			(diagram.layout.direction === "LR" || diagram.layout.direction === "RL") &&
			arrowCrossings(kept.layout.edgeArrows, false) > 0;
		const plans = [false, ...(rowOfZones ? [true] : [])].flatMap((hangs) =>
			planZoneWraps(
				search.layoutGraph,
				structure,
				kept.arrangement,
				length.balance,
				length.size,
				hangs,
			).map((zoneWraps) => ({ hangs, zoneWraps })),
		);
		for (const { hangs, zoneWraps } of plans) {
			const planned = {
				...kept.arrangement,
				crossingRepair: repairable || kept.arrangement.crossingRepair,
				zoneWraps,
			};
			const drawn = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, planned);
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
				? layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, {
						...planned,
						avoidCrossings: true,
					})
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
				!hangs &&
				!acceptable(unrepaired) &&
				repairable &&
				crossed &&
				(!structure.zoned || !zoneWraps.has(TOP_LEVEL)) &&
				arrowCrossings(rerouted.edgeArrows) === arrowCrossings(kept.layout.edgeArrows) + 1
					? repairCrossings(
							search.layoutGraph,
							renderOptions,
							levels[0]!,
							unrepaired,
							defectsOf,
							fewer,
						)
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
			if (
				hangs &&
				(score[0]! >= crossings! || (chosen !== undefined && score[0]! >= chosen.score[0]!))
			)
				continue;
			const skips = [...zoneWraps.values()].some((wrap) => wrap.skips);
			if (
				!chosen ||
				lowerScore(score, chosen.score) ||
				(yielding && unrivaled && (score[0]! < chosen.score[0]! || score[1]! < chosen.score[1]!))
			) {
				chosen = { arrangement, defects, layout, score };
				yielding = skips;
			}
			if (unrivaled && !skips) break;
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
					(lengthOf(search, chosen.layout).tooLong &&
						!lengthOf(search, repairedChoice.layout).tooLong)) &&
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
			positionLayout(search.layoutGraph, new Map(), new Map(), option)
				.nodes.map((node) => `${node.x},${node.y}`)
				.join(" ");
		if (
			!structure.zoned &&
			top &&
			arrangement &&
			!top.rise &&
			planned(arrangement) !== planned(chosen.arrangement)
		) {
			const layout = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
			const defects = defectsOf(layout);
			if (
				!fewer(chosen.defects, defects) &&
				routesNoWorse(layout, chosen.layout, false, false, false, false) &&
				drawnNoWorse(layout, chosen.layout, true)
			)
				chosen = { arrangement, defects, layout, score: zoneScore(layout) };
		}
		search.best = chosen;
	}
	// A line into a hanging band that runs around a step of the target's rank
	// to reach it is kept when that routes no worse, hooks or detours no line
	// more, and draws the lines shorter in total.
	const cuts = zoneCutEdges(search.layoutGraph, search.best.arrangement.zoneWraps);
	if (
		search.best.arrangement.zoneWraps &&
		!search.best.arrangement.aroundRanks &&
		search.best.layout.routedEdges.some(
			({ edge, source, target }) =>
				cuts.has(edge.id) &&
				behindRankStep(source, target, search.best.layout.nodeShapes, diagram.layout.direction),
		)
	) {
		const arrangement = { ...search.best.arrangement, aroundRanks: true };
		const layout = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
		const defects = defectsOf(layout);
		const total = ({ edgeArrows }: DiagramLayout) =>
			edgeArrows.reduce((sum, arrow) => sum + routeLength(arrow.points), 0);
		if (
			!fewer(search.best.defects, defects) &&
			routesNoWorse(layout, search.best.layout, false, false) &&
			hookedRoutes(layout) <= hookedRoutes(search.best.layout) &&
			detouredLines(layout.edgeArrows) <= detouredLines(search.best.layout.edgeArrows) &&
			total(layout) < total(search.best.layout) - AXIS_ALIGNED_EPSILON
		)
			search.best = { arrangement, defects, layout };
	}
	// A line alongside a node in a zone, nearer than the corridor gap, moves out
	// to the gap last (clearOutlines). Where the zone's outline leaves it no lane
	// there, the zone grows, once every other choice is made, where that routes
	// no worse and leaves fewer such zones.
	const roomless =
		orthogonal && search.best.layout.groups?.zoned
			? zonesWithoutAlongsideRoom(clearedLast(search, finished(search, search.best.layout)))
			: new Set<string>();
	if (roomless.size > 0) {
		const zoneSlack = new Map(search.best.arrangement.zoneSlack ?? []);
		for (const id of roomless) zoneSlack.set(id, (zoneSlack.get(id) ?? 0) + GROUP_SLACK);
		const arrangement = { ...search.best.arrangement, zoneSlack };
		const layout = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
		const defects = defectsOf(layout);
		if (
			!fewer(search.best.defects, defects) &&
			routesNoWorse(layout, search.best.layout, false, false) &&
			zonesWithoutAlongsideRoom(clearedLast(search, finished(search, layout))).size < roomless.size
		)
			search.best = { arrangement, defects, layout };
	}
}

/** 6. Repair and tighten the winner, clear heads/touches, then judge fully drawn rivals. */
function polishAndClear(search: LayoutSearch): DiagramLayout {
	const { renderOptions, levels, arranged, orthogonal, vertical, repairable } = search;
	
	const structure = search.layoutGraph.groups;
	// In lanes a step takes lines in and sends them out by different sides, when
	// that routes no worse.
	if (arranged && orthogonal && laned(diagram))
		consider(search, { ...search.best.arrangement, separateRoles: true }, false);
	// Crossings the arrangements leave are repaired where few enough to untangle.
	const repaired = (settled: SettledLayout) => {
		const crossings = arrowCrossings(settled.layout.edgeArrows);
		return repairable && crossings > 0 && crossings <= CROSSING_REPAIR_MAX_CROSSINGS
			? repairCrossings(search.layoutGraph, renderOptions, levels[0]!, settled, defectsOf, fewer)
			: settled;
	};
	let layout: DiagramLayout;
	// Repairs, then the finished layout, tightened where it runs long and with
	// its lines cleared of other lines' arrowheads.
	const complete = (
		unrepaired: SettledLayout,
		hopeless?: (layout: DiagramLayout) => boolean,
	): CompletedLayout => {
		search.best = unrepaired;
		search.best = repaired(search.best);
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
			arrowCrossings(search.best.layout.edgeArrows) > 0
		) {
			const arrangement = { ...unrepaired.arrangement, wrap: { ...gapWrap, lineBreaks: true } };
			const layout = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
			const around = repaired({ arrangement, defects: defectsOf(layout), layout });
			if (
				!fewer(search.best.defects, around.defects) &&
				cleaner(around.layout, search.best.layout, true)
			)
				search.best = around;
		}
		// Only pairs still crossing after the normal repairs may leave their lanes.
		// One extra ordinary-routing layout is screened by the same export/reader
		// admission as other candidates. Preserve every unrelated paired lane.
		if (renderOptions.pairedReturns && arrowCrossings(search.best.layout.edgeArrows) > 0) {
			const previous = search.best;
			const arrows = new Map(search.best.layout.edgeArrows.map((arrow) => [arrow.edgeId, arrow]));
			const unpairedReturns = new Set<string>();
			for (const route of search.best.layout.routedEdges) {
				const arrow = arrows.get(route.edge.id);
				if (
					route.pair === undefined ||
					!arrow ||
					!search.best.layout.edgeArrows.some(
						(other) => other !== arrow && arrowCrossings([arrow, other]) > 0,
					)
				)
					continue;
				for (const member of search.best.layout.routedEdges)
					if (
						member.pair !== undefined &&
						(member.edge.id === route.edge.id ||
							(member.edge.source === route.edge.target &&
								member.edge.target === route.edge.source))
					)
						unpairedReturns.add(member.edge.id);
			}
			if (unpairedReturns.size > 0) {
				consider(search, { ...search.best.arrangement, unpairedReturns }, true);
				const remaining = arrowCrossings(search.best.layout.edgeArrows);
				if (
					search.best !== previous &&
					repairable &&
					remaining > 0 &&
					remaining <= CROSSING_REPAIR_MAX_CROSSINGS
				)
					search.best = repairCrossings(
						search.layoutGraph,
						renderOptions,
						levels[0]!,
						search.best,
						defectsOf,
						fewer,
					);
				const keptPairs = new Set(
					search.best.layout.routedEdges
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
					search.best = previous;
			}
		}
		layout = finished(search, search.best.layout);
		// A rival already beaten as repaired needs no tightening or head repair.
		if (hopeless?.(layout)) return { layout, settled: search.best };
		// A plain column, or a laned flow, still too long for its breadth, which no
		// wrap shortened, tightens along the flow; so do the bands of a wrapped
		// flow whose text a screen still shrinks below WRAP_MIN_COLUMN_TEXT. In
		// lanes, a handoff to a lane
		// further than the next first stays in its source's column where the lanes
		// between are empty there (laneColumns). Then rank or column gaps draw as
		// short as the lines in them allow (compactGaps), or, failing that, only
		// those lines cross straight. Each is kept when it reads shorter (a wrapped
		// flow: its long side shrinks, which tighter bands can reach by rerouting a
		// line that ran out around them), routes no worse, lengthens, hooks or
		// detours no line and crowds no label more. Lanes
		// tighten only while no line runs through an arrowhead, before or after: the
		// head repair below reroutes such a line, and closed-up lanes leave it less
		// room to.
		const wrapped = () => search.best.arrangement.wrap.continuations.size > 0;
		const longSide = (drawn: DiagramLayout) => {
			const { width, height } = lengthOf(search, drawn).size;
			return Math.max(width, height);
		};
		const tightenable = () =>
			arranged &&
			orthogonal &&
			(laned(diagram) || (vertical && !structure)) &&
			(wrapped()
				? !laned(diagram) &&
					(NODE_LABEL_FONT_SIZE * FITTED_LONG_SIDE) / (longSide(layout) + 2 * EXPORT_PADDING) <
						WRAP_MIN_COLUMN_TEXT
				: lengthOf(search, layout).aspect >= COMPACT_ASPECT) &&
			(!laned(diagram) || headCrossers(layout).size === 0);
		const tighten = (arrangement: Arrangement) => {
			const attempt = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
			const compact = repaired({ arrangement, defects: defectsOf(attempt), layout: attempt });
			const candidate = finished(search, compact.layout);
			const lengths = new Map(
				layout.edgeArrows.map((arrow) => [arrow.id, routeLength(arrow.points)]),
			);
			if (
				!fewer(search.best.defects, compact.defects) &&
				routesNoWorse(candidate, layout, false, true) &&
				candidate.edgeArrows.every(
					(arrow) => routeLength(arrow.points) <= lengths.get(arrow.id)! + AXIS_ALIGNED_EPSILON,
				) &&
				(!laned(diagram) || headCrossers(candidate).size === 0) &&
				hookedRoutes(candidate) <= hookedRoutes(layout) &&
				detouredLines(candidate.edgeArrows) <= detouredLines(layout.edgeArrows) &&
				labelCrowding(candidate).every((count, index) => count <= labelCrowding(layout)[index]!) &&
				(wrapped()
					? longSide(candidate) < longSide(layout) - AXIS_ALIGNED_EPSILON
					: lengthOf(search, candidate).aspect < lengthOf(search, layout).aspect)
			) {
				search.best = compact;
				layout = candidate;
				return true;
			}
			return false;
		};
		if (laned(diagram) && tightenable()) {
			const through = laneColumns(search.layoutGraph, true);
			if ([...laneColumns(search.layoutGraph)].some(([id, column]) => through.get(id) !== column))
				tighten({ ...search.best.arrangement, throughHandoffs: true });
		}
		for (const straight of tightenable() ? [false, true] : []) {
			const gaps = compactGaps(search.layoutGraph, layout, search.best.arrangement, straight);
			if (gaps.size > 0 && tighten({ ...search.best.arrangement, compactGaps: gaps })) break;
		}
		// A row of lanes still longer than LANE_ASPECT for its breadth raises its
		// thinnest lanes to one breadth (laneBreadthFor), its steps centered in
		// them. Kept when it reads shorter, routes no worse and hooks, detours or
		// crowds no more; its lines may lengthen across the broader lanes.
		const breadth =
			arranged &&
			orthogonal &&
			laned(diagram) &&
			search.best.arrangement.wrap.continuations.size === 0 &&
			headCrossers(layout).size === 0
				? laneBreadthFor(layout, lengthOf(search, layout).size)
				: undefined;
		if (breadth !== undefined) {
			const arrangement = { ...search.best.arrangement, laneBreadth: breadth };
			const attempt = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
			const broad = repaired({ arrangement, defects: defectsOf(attempt), layout: attempt });
			const candidate = finished(search, broad.layout);
			if (
				!fewer(search.best.defects, broad.defects) &&
				routesNoWorse(candidate, layout, false, true) &&
				headCrossers(candidate).size === 0 &&
				hookedRoutes(candidate) <= hookedRoutes(layout) &&
				detouredLines(candidate.edgeArrows) <= detouredLines(layout.edgeArrows) &&
				labelCrowding(candidate).every((count, index) => count <= labelCrowding(layout)[index]!) &&
				lengthOf(search, candidate).aspect < lengthOf(search, layout).aspect
			) {
				search.best = broad;
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
				finished(search, {
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
			const arrangement = { ...search.best.arrangement, clearHeads: true };
			const attempt = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
			clearings.push(
				finished(
					search,
					repaired({ arrangement, defects: defectsOf(attempt), layout: attempt }).layout,
				),
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
		return { layout, settled: search.best };
	};
	// Two lines that meet anywhere but a clean crossing, one bending or ending on
	// or beside the other (touchingLines), read as one line that forks or merges
	// there: a reader can follow either into the other's target. Where the drawn
	// layout leaves such pairs among at most TOUCH_MOVES lines, those lines are
	// routed again after all the others, bending clear of other lines first:
	// together in either order, and each alone. In a graph few enough edges to
	// repair and not laned, every line is laid out again from scratch too, each
	// gap between neighbors whose facing sides both carry a line spread to a
	// lane each (Arrangement.spreadFacing). Of each kind, the candidates that,
	// finished, touch fewer and fail no more are drawn in full, clearest first,
	// up to TOUCH_DRAWINGS, and the first is kept that, as drawn, touches fewer
	// and draws no more export defects, crossings, reader findings (a touching
	// pair counts as one), lines through a head, hooks, shared segments, lines
	// near nodes, dips, detours, crowded or detached labels, and no longer a
	// drawing; the clearer of the two kinds wins.
	const clearTouches = (layout: DiagramLayout, scratch: boolean): DiagramLayout => {
		// A family that places its own boxes keeps its lines.
		const touching = arranged && orthogonal ? touchingEdges(layout) : new Set<string>();
		if (touching.size === 0 || !layout.portOffsets || !layout.routeOptions) return layout;
		const { edgeArrows, nodeShapes, portOffsets, routeOptions, routedEdges } = layout;
		const order = routedEdges.map((_, index) => index);
		const moved = order.filter((index) => touching.has(routedEdges[index]!.edge.id));
		if (moved.length > TOUCH_MOVES) return layout;
		const touches = touchingLineCount(layout);
		const aspectOf = (candidate: DiagramLayout) => {
			const { width, height } = drawnExtent(candidate);
			return exportAspect(width, height);
		};
		const clearer = (candidate: DiagramLayout) =>
			!fewer(defectsOf(layout), defectsOf(candidate)) &&
			touchingLineCount(candidate) < touches &&
			routesNoWorse(candidate, layout, false, true, false, true, true) &&
			headCrossers(candidate).size <= headCrossers(layout).size &&
			hookedRoutes(candidate) <= hookedRoutes(layout) &&
			sharedSegmentCount(candidate) <= sharedSegmentCount(layout) &&
			nearOutlines(candidate) <= nearOutlines(layout) &&
			dippedArrivals(candidate.edgeArrows).size <= dippedArrivals(layout.edgeArrows).size &&
			drawnLongSide(candidate) <= drawnLongSide(layout) + AXIS_ALIGNED_EPSILON &&
			aspectOf(candidate) <= aspectOf(layout) + AXIS_ALIGNED_EPSILON &&
			detouredLines(candidate.edgeArrows) <= detouredLines(layout.edgeArrows) &&
			labelsNoWorse(candidate, layout);
		const clearness = (candidate: DiagramLayout) => [
			touchingLineCount(candidate),
			...routed(candidate, true),
		];
		// Only a candidate that, finished, touches fewer and fails no more is
		// worth polishing and clearing at last to be judged as drawn.
		const clearest = (candidates: readonly DiagramLayout[]) => {
			const screened = candidates
				.map((layout) => finished(search, layout))
				.filter(
					(candidate) =>
						touchingLineCount(candidate) < touches &&
						!fewer(defectsOf(layout), defectsOf(candidate)),
				)
				.map((candidate) => ({ candidate, score: clearness(candidate) }))
				.sort((a, b) => (lowerScore(a.score, b.score) ? -1 : lowerScore(b.score, a.score) ? 1 : 0));
			for (const { candidate } of screened.slice(0, TOUCH_DRAWINGS)) {
				// Polished as drawn but for nesting, which tries every order of
				// every merge: most of the whole layout's polish.
				const drawn = clearedLast(search, polished(search, candidate, false));
				if (clearer(drawn)) return drawn;
			}
			return undefined;
		};
		const again = clearest(
			[moved, [...moved].reverse(), ...moved.map((index) => [index])].map((last) => {
				const rerouted = new Set(last);
				return {
					...layout,
					edgeArrows: routeAllEdges(
						routedEdges,
						"orthogonal",
						portOffsets,
						nodeShapes,
						{ ...routeOptions, clearTouches: true },
						[...order.filter((index) => !rerouted.has(index)), ...last],
						new Map(
							edgeArrows
								.filter((_, index) => !rerouted.has(index))
								.map((arrow) => [arrow.edgeId, arrow]),
						),
					),
				};
			}),
		);
		// Lanes place their steps by lane, not by the gaps between neighbors.
		const arrangement = { ...search.best.arrangement, clearTouches: true, spreadFacing: true };
		const attempt =
			repairable && scratch && !laned(diagram)
				? layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement)
				: undefined;
		const fresh = attempt
			? clearest([repaired({ arrangement, defects: defectsOf(attempt), layout: attempt }).layout])
			: undefined;
		return fresh && (!again || lowerScore(clearness(fresh), clearness(again)))
			? fresh
			: (again ?? layout);
	};
	// Fewer crossings, each removed outweighing a reader finding added, and
	// otherwise drawn no worse (drawsNoWorse), but for the findings traded and
	// a drawing up to LONGER_FOR_CROSSINGS longer, short of an extreme aspect.
	const straighter = (candidate: DiagramLayout, current: DiagramLayout) => {
		const [crossings, findings] = routed(candidate, true) as [number, number];
		const [currentCrossings, currentFindings] = routed(current, true) as [number, number];
		const [labels, labelRoom] = labelCrowding(candidate);
		const [currentLabels, currentRoom] = labelCrowding(current);
		const aspectOf = (drawn: DiagramLayout) => {
			const { width, height } = drawnExtent(drawn);
			return exportAspect(width, height);
		};
		const aspect = aspectOf(candidate);
		return (
			crossings < currentCrossings &&
			arrowCrossings(candidate.edgeArrows, false) <= arrowCrossings(current.edgeArrows, false) &&
			crossings + findings <= currentCrossings + currentFindings &&
			touchingLineCount(candidate) <= touchingLineCount(current) &&
			!fewer(defectsOf(current), defectsOf(candidate)) &&
			(aspect < WRAP_EXTREME_ASPECT || aspect <= aspectOf(current) + AXIS_ALIGNED_EPSILON) &&
			headCrossers(candidate).size <= headCrossers(current).size &&
			hookedRoutes(candidate) <= hookedRoutes(current) &&
			detouredLines(candidate.edgeArrows) <= detouredLines(current.edgeArrows) &&
			dippedArrivals(candidate.edgeArrows).size <= dippedArrivals(current.edgeArrows).size &&
			labels <= currentLabels &&
			labelRoom <= currentRoom + (currentCrossings - crossings) * LABEL_ROOM_FOR_CROSSING &&
			drawnLongSide(candidate) <=
				Math.max(drawnLongSide(current) * LONGER_FOR_CROSSINGS, FITTED_LONG_SIDE) &&
			sharedSegmentCount(candidate) <= sharedSegmentCount(current)
		);
	};
	const beforeRepairs = search.best;
	({ layout, settled: search.best } = complete(beforeRepairs));
	// A decision's branches leave by the vertices that route them best together.
	if (repairable && !laned(diagram))
		({ layout, settled: search.best } = chooseBranchSides(
			search.layoutGraph,
			renderOptions,
			levels[0]!,
			beforeRepairs,
			{ layout, settled: search.best },
			complete,
			defectsOf,
			fewer,
		));
	// The drawn layout polished at last: its ends, a gap grown for a step too
	// near its ends, and lines that touch cleared.
	const drawnToTheEnd = (start: CompletedLayout): CompletedLayout => {
		({ layout, settled: search.best } = start);
		// Last, the drawn layout's ends are polished.
		layout = polished(search, layout);
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
			search.best.arrangement.wrap.continuations.size === 0 &&
			!search.best.arrangement.compactGaps
				? narrowStepGaps(diagram, layout)
				: new Map<number, number>();
		if (narrow.size > 0) {
			const drawn = { layout, settled: search.best };
			const arrangement = { ...search.best.arrangement, widenGaps: narrow };
			const attempt = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
			const settled = { arrangement, defects: defectsOf(attempt), layout: attempt };
			const [candidate, current] = [polished(search, finished(search, attempt)), drawn.layout].map(
				(layout) => clearedLast(search, layout),
			);
			const [labels, currentLabels] = [candidate!, current!].map(labelCrowding);
			const grows =
				!fewer(defectsOf(current!), defectsOf(candidate!)) &&
				lengthOf(search, candidate!).aspect < COMPACT_ASPECT &&
				portJogCount(candidate!) < portJogCount(current!) &&
				routesNoWorse(candidate!, current!, false, true) &&
				headCrossers(candidate!).size <= headCrossers(current!).size &&
				hookedRoutes(candidate!) <= hookedRoutes(current!) &&
				detouredLines(candidate!.edgeArrows) <= detouredLines(current!.edgeArrows) &&
				dippedArrivals(candidate!.edgeArrows).size <= dippedArrivals(current!.edgeArrows).size &&
				labels!.every((count, index) => count <= currentLabels![index]!) &&
				nearOutlines(candidate!) <= nearOutlines(current!);
			({ layout, settled: search.best } = grows
				? { layout: candidate!, settled }
				: { layout: current!, settled: drawn.settled });
		} else layout = clearedLast(search, layout);
		// Each round starts from the lines the last one left touching.
		for (let round = 0; round < TOUCH_ROUNDS; round += 1) {
			const cleared = clearTouches(layout, round === 0);
			if (cleared === layout) break;
			layout = cleared;
		}
		return { layout, settled: search.best };
	};
	({ layout, settled: search.best } = drawnToTheEnd({ layout, settled: search.best }));
	// Where the drawing still crosses, lines that run around into the same side
	// of a node may nest by reach (Arrangement.nestAround), lines that skip
	// ranks may run straight in lanes of their own (Arrangement.skipLanes), and,
	// among zones, a node a zone's members reach from another node outside it
	// may rank after that one (Arrangement.throughBlocks), its line back into
	// the zone running straight back. Each rival is repaired and drawn to the
	// end the same way, and kept where it crosses fewer lines, a crossing
	// removed outweighing a reader finding added, and draws no worse otherwise
	// (straighter).
	const backInto = (entries: ReadonlySet<string>): SideOverrides =>
		new Map(
			[...entries]
				.filter((id) => search.layoutGraph.feedback.has(id))
				.map((id) => [
					id,
					{
						sourceEdge: OPPOSITE_EDGE[FORWARD_SIDE[diagram.layout.direction]],
						targetEdge: FORWARD_SIDE[diagram.layout.direction],
					},
				]),
		);
	// Nesting is tried only where it orders some side's ports otherwise.
	const nests = () => {
		const { portOffsets, routedEdges } = layout;
		if (!portOffsets) return false;
		const nested = portOffsetsAt(routedEdges, levels[0]!, "nested", laned(diagram));
		return [...nested].some(([key, offset]) => portOffsets.get(key) !== offset);
	};
	const rivals = (): Partial<Arrangement>[] => {
		search.layoutGraph = search.layoutGraph.groups
			? withThroughRanks(search.layoutGraph, beforeRepairs.arrangement.reorder)
			: withSiftedRanks(search.layoutGraph);
		const through = search.layoutGraph.groups?.top.through;
		return [
			...(nests() ? [{ nestAround: true }] : []),
			...(skipsRanks(search.layoutGraph, arrowCrossings(layout.edgeArrows))
				? [{ skipLanes: true }]
				: []),
			...(through !== undefined
				? [
						{
							throughBlocks: true,
							sides: new Map([
								...(beforeRepairs.arrangement.sides ?? []),
								...backInto(through.entries),
							]),
						},
					]
				: []),
		];
	};
	// None is tried where the drawing crosses no more than its graph forces, or
	// in lanes, which order and place their steps by lane.
	const rivalled =
		repairable &&
		!laned(diagram) &&
		beforeRepairs.arrangement.wrap.continuations.size === 0 &&
		arrowCrossings(layout.edgeArrows) >
			unavoidableCrossings(diagram.edges.map((edge) => [edge.source, edge.target]));
	// A rival only ever improves the drawing: one that fails to lay out leaves
	// the drawing as it was.
	const rivalFrom = (rivalArrangement: Partial<Arrangement>) => {
		const drawn = { layout, settled: search.best };
		const arrangement = { ...beforeRepairs.arrangement, ...rivalArrangement };
		const attempt = layoutDiagram(search.layoutGraph, renderOptions, levels[0]!, arrangement);
		const crossings = arrowCrossings(layout.edgeArrows);
		// A rival that crosses far more before its repairs than the arranged
		// layout did, or still crosses as many once repaired, is drawn no further.
		if (
			arrowCrossings(attempt.edgeArrows) >
			arrowCrossings(beforeRepairs.layout.edgeArrows) + RIVAL_CROSSING_SLACK
		)
			return drawn;
		// Completing and drawing the rival draws over the layout in hand.
		const completed = complete(
			{ arrangement, defects: defectsOf(attempt), layout: attempt },
			(candidate) => arrowCrossings(candidate.edgeArrows) >= crossings,
		);
		if (arrowCrossings(completed.layout.edgeArrows) >= crossings) return drawn;
		const rival = drawnToTheEnd(completed);
		return straighter(rival.layout, drawn.layout) ? rival : drawn;
	};
	const drawnRivals = (() => {
		try {
			return rivalled ? rivals() : [];
		} catch {
			return [];
		}
	})();
	for (const rivalArrangement of drawnRivals) {
		if (arrowCrossings(layout.edgeArrows) === 0) break;
		const drawn = { layout, settled: search.best };
		try {
			({ layout, settled: search.best } = rivalFrom(rivalArrangement));
		} catch {
			({ layout, settled: search.best } = drawn);
		}
	}
	return layout;
}
