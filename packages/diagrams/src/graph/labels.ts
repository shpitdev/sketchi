import {
	type RoutedEdge,
	type GroupLayout,
	type LaneLayout,
	type LabelShortfall,
	type LabelBox,
	type DiagramLayout,
} from "./layout-types.js";
import {
	type CanvasConnectorElement as ArrowSceneElement,
	type CanvasShapeElement as NodeSceneElement,
	type CanvasTextElement as TextSceneElement,
	segmentsFromPoints,
	type CanvasPoint as ScenePoint,
} from "@sketchi/drawing";
import {
	obstacleBox,
	laneElementId,
	frameOutline,
	laneBoundaries,
	boundsOf,
	groupBlocks,
	laneBlocks,
} from "./containers.js";
import { branchLabelMetrics, branches, branchLabelMaxWidth } from "./measure.js";
import { branchLabelPosition } from "./ports.js";
import {
	labelBox,
	arrowheadBox,
	labelConflicts,
	padBox,
	labelSlidePositions,
	labelRuns,
	clearOfHead,
	labelAmbiguous,
	labelShortfall,
	boxWithin,
	LABEL_MOVE_MARGIN,
	nearestLine,
	labelAlign,
	LABEL_OTHER_LINE_CLEARANCE,
	boxSegmentDistance,
} from "./label-geometry.js";
import {
	arrowCrossings,
	exportRouteDefects,
	readerFindingCount,
	headCrossers,
	inwardEndpoints,
} from "./readability.js";
import {
	alongsideReach,
	routeClearanceCount,
	routeAlongsideCount,
	straightRuns,
	compactPoints,
} from "./route-geometry.js";
import { runsClearOfOutlines, orthogonalRoute, keepsStubs } from "./routing.js";

/**
 * Unbound, grouped text keeps its authored position through Excalidraw export.
 * Each label starts beside its source stub, where routing reserved room for it;
 * one that the final routes, a node or another label still touch slides along
 * its own route, nearest its source first, to the first clear spot.
 */
export function branchLabels(
	arrows: ArrowSceneElement[],
	routes: readonly RoutedEdge[],
	shapes: readonly NodeSceneElement[],
	groups?: GroupLayout,
	unambiguous = true,
	lanes?: LaneLayout,
): TextSceneElement[] {
	return placedBranchLabels(arrows, routes, shapes, groups, unambiguous, lanes).labels;
}

/**
 * Branch labels placed as drawn, how many lines, nodes or labels they still
 * touch, and those that sit nearer another line than they may.
 */
export function placedBranchLabels(
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
 * The drawn layout with each run that passes too close to a node's outline
 * moved just clear of it, where the route stays orthogonal and the move draws
 * no more export defects, crossings, reader-scale findings, inward endpoints
 * or labels touching anything. Runs only after every other choice, so no
 * other route moves. In the `last` pass, after every choice, a line moves
 * again from where its last move left it until no run is near, and no move
 * may run a line through a head: no head repair follows. Then, in zones, each
 * run alongside a node nearer than the corridor gap moves out to the gap where
 * that brings its line within the clearance of no node (alongsideReach).
 */
export function clearOutlines(layout: DiagramLayout, last = false): DiagramLayout {
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
	// Runs within the clearance first, as everywhere; then, last, in zones, runs
	// alongside a node, each move bringing the line within the clearance of none.
	const passes = [undefined, last ? alongsideReach(layout) : undefined];
	for (const [index, arrow] of layout.edgeArrows.entries()) {
		const ends = new Set([arrow.sourceNodeId, arrow.targetNodeId]);
		const close = (points: readonly ScenePoint[]) => routeClearanceCount(points, nodeShapes, ends);
		for (const [pass, alongside] of passes.entries()) {
			if (pass > 0 && !alongside) break;
			const count = (points: readonly ScenePoint[]) =>
				alongside ? routeAlongsideCount(points, nodeShapes, ends, alongside) : close(points);
			let near = count(arrows[index]!.points);
			// Each move clears at least one run, so a line stops once none is near.
			for (let moves = 0; near > 0 && (last || moves === 0); moves += 1) {
				current ??= score(arrows);
				let moved = false;
				const before = close(arrows[index]!.points);
				for (const points of runsClearOfOutlines(
					arrows[index]!.points,
					nodeShapes,
					ends,
					alongside,
				)) {
					const nearer = count(points);
					if (
						!orthogonalRoute(points) ||
						nearer >= near ||
						(alongside !== undefined && close(points) > before)
					)
						continue;
					const candidate = arrows.map((other, at) =>
						at === index ? { ...other, points } : other,
					);
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
export function clearLabels(layout: DiagramLayout): DiagramLayout {
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
