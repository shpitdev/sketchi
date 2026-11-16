/** Owns group, zone and lane geometry: bounds, labels, obstacles and boundary defects. */
import {
	CANVAS_ZONE_HEADER,
	CANVAS_FRAME_NAME,
	type CanvasNodeIcon,
	canvasGroupIconRun,
	canvasFrameNameWidth,
	DEFAULT_GLYPH_UNITS,
	wrapTextToUnits,
	wrapTextToWidth,
	estimateTextWidth,
	type CanvasShapeElement as NodeSceneElement,
	type CanvasConnectorElement as ArrowSceneElement,
	type AxisAlignedSegment,
	segmentsFromPoints,
	type CanvasPoint as ScenePoint,
	AXIS_ALIGNED_EPSILON,
	segmentCrossesBoundsInterior,
	GROUP_OUTLINE_CLEARANCE,
	segmentOverlapLength,
} from "@sketchi/drawing";
import {
	type GroupFrame,
	type Box,
	type GroupLayout,
	type RoutedEdge,
	type LaneFrame,
	type LaneLayout,
} from "./layout-types";
import { type GroupStructure } from "./topology";
import { NODE_LABEL_LINE_HEIGHT } from "./measure";

/** The band above each frame that keeps Excalidraw's frame name clear. */
export const GROUP_LABEL_BAND = 28;

/** Thickness of the walls that keep a group's own edges inside its frame. */
const GROUP_WALL = 4;

export const ZONE_HEADER = CANVAS_ZONE_HEADER.height;

export const ZONE_LABEL_INSET = CANVAS_ZONE_HEADER.labelInset;

export const ZONE_LABEL_FONT_SIZE = CANVAS_FRAME_NAME.fontSize;

/** What routes and labels keep off for a group: its name, and a frame's logo. */
export function groupKeepOuts(frame: GroupFrame): Box[] {
	return frame.logoBox ? [frame.labelBox, frame.logoBox] : [frame.labelBox];
}

/** A group and every group around it, innermost first. */
export function groupChain(groups: GroupLayout, groupId: string | undefined): string[] {
	const chain: string[] = [];
	for (let id = groupId; id !== undefined; id = groups.parentOf.get(id)) chain.push(id);
	return chain;
}

/** The innermost group holding both nodes, if any. */
export function sharedGroup(groups: GroupLayout, left: string, right: string): string | undefined {
	const outer = new Set(groupChain(groups, groups.groupOf.get(right)));
	return groupChain(groups, groups.groupOf.get(left)).find((id) => outer.has(id));
}

export function boundsOf(shapes: readonly Box[]): Box {
	const x = Math.min(...shapes.map((shape) => shape.x));
	const y = Math.min(...shapes.map((shape) => shape.y));
	return {
		x,
		y,
		width: Math.max(...shapes.map((shape) => shape.x + shape.width)) - x,
		height: Math.max(...shapes.map((shape) => shape.y + shape.height)) - y,
	};
}

/** A group and every group around it, innermost first. */
export function groupRoots(structure: GroupStructure, groupId: string): string[] {
	const chain: string[] = [];
	for (let id: string | undefined = groupId; id !== undefined; id = structure.parentOf.get(id))
		chain.push(id);
	return chain;
}

/** The outermost group around a group. */
export function groupRoot(structure: GroupStructure, groupId: string): string {
	return groupRoots(structure, groupId).at(-1)!;
}

/** Where a zone's label, and the logo before it, are painted in its header strip, padded by its clearance. */
export function zoneLabelBox(box: Box, label: string, icon: CanvasNodeIcon | undefined): Box {
	const { clearance, height } = CANVAS_FRAME_NAME;
	return {
		x: box.x + ZONE_LABEL_INSET - clearance,
		y: box.y + (ZONE_HEADER - height) / 2 - clearance,
		width: canvasGroupIconRun(icon) + canvasFrameNameWidth(label) + 2 * clearance,
		height: height + 2 * clearance,
	};
}

export const LANE_LABEL_FONT_SIZE = 16;

/** A horizontal lane's header wraps its name at about fourteen average glyphs. */
const LANE_LABEL_LINE_UNITS = 14 * DEFAULT_GLYPH_UNITS;

export const LANE_HEADER_PADDING = 16;

/** A lane name wrapped for its header, at a width or the header's usual line length. */
export function measureLaneLabel(
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
export function obstacleBox(id: string, box: Box): NodeSceneElement {
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
export function compositeShapes(groups: GroupLayout | undefined): NodeSceneElement[] {
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
export function groupBlocks(groups: GroupLayout | undefined): NodeSceneElement[] {
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
export function groupObstacles(
	groups: GroupLayout | undefined,
	route: RoutedEdge,
): NodeSceneElement[] {
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

export const GROUP_OUTLINE = "group-outline:";

/**
 * Lane boundaries are outlines too, but only the outline clearance holds a
 * route off them: thin and crisp, a boundary never reads as another arrow.
 */
export const LANE_OUTLINE = `${GROUP_OUTLINE}lane:`;

/**
 * A route keeps this far from a lane boundary it runs along wherever it can;
 * closer than the outline clearance is a defect.
 */
export const LANE_OUTLINE_CLEARANCE = 24;

/**
 * Each frame's outline as an unbound, headless line for routes to keep apart
 * from. A zone's outline is crisp and thin like a lane's boundary, so routes
 * keep a lane's room from it wherever they can.
 */
export function groupOutlineLines(groups: GroupLayout | undefined): ArrowSceneElement[] {
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
export function frameOutline(box: Box): AxisAlignedSegment[] {
	return segmentsFromPoints([
		{ x: box.x, y: box.y },
		{ x: box.x + box.width, y: box.y },
		{ x: box.x + box.width, y: box.y + box.height },
		{ x: box.x, y: box.y + box.height },
		{ x: box.x, y: box.y },
	]);
}

export function insideBox(point: ScenePoint, box: Box): boolean {
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
export function groupRouteDefects(
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
export function laneElementId(frame: LaneFrame): string {
	return frame.elementId;
}

/**
 * The id each lane's band draws under, by lane id: `lane:` and the lane's id
 * escaped, so no lane's ids extend another's, then a later pool's number. A
 * base a diagram node's id already uses takes `@1`, `@2` and so on; escaping
 * leaves no `:` or `@` in a lane's id, so these never meet another lane's.
 */
export function laneElementBases(
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
export function laneObstacles(
	lanes: LaneLayout | undefined,
	continuation = false,
): NodeSceneElement[] {
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
export function laneBoundaries(lanes: LaneLayout): AxisAlignedSegment[] {
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
export function laneOutlineLines(lanes: LaneLayout | undefined): ArrowSceneElement[] {
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
export function laneRouteDefects(
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

/** The lanes as one block, for sizing what is drawn. */
export function laneBlocks(lanes: LaneLayout | undefined): NodeSceneElement[] {
	return lanes ? [obstacleBox("lanes", lanes.pool)] : [];
}
