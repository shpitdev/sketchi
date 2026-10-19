import type { CanvasShapeElement, CanvasSpec } from "./canvas.js";
import { GROUP_OUTLINE_CLEARANCE } from "./group-regions.js";
import {
	AXIS_ALIGNED_EPSILON,
	type AxisAlignedSegment,
	segmentCrossesBoundsInterior,
	segmentOverlapLength,
	segmentsFromPoints,
} from "./segments.js";
import { wrapTextToWidth, wrappedLabelWidth } from "./text-metrics.js";

export interface LaneRegionIssue {
	readonly code:
		| "lane-missing"
		| "lanes-out-of-order"
		| "lanes-uneven"
		| "member-outside-lane"
		| "route-through-header"
		| "route-along-boundary"
		| "route-leaves-lanes"
		| "label-covered";
	readonly elementId: string;
	readonly message: string;
}

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

function inside(inner: Box, outer: Box): boolean {
	return (
		inner.x >= outer.x - AXIS_ALIGNED_EPSILON &&
		inner.y >= outer.y - AXIS_ALIGNED_EPSILON &&
		inner.x + inner.width <= outer.x + outer.width + AXIS_ALIGNED_EPSILON &&
		inner.y + inner.height <= outer.y + outer.height + AXIS_ALIGNED_EPSILON
	);
}

function overlap(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.width - AXIS_ALIGNED_EPSILON &&
		b.x < a.x + a.width - AXIS_ALIGNED_EPSILON &&
		a.y < b.y + b.height - AXIS_ALIGNED_EPSILON &&
		b.y < a.y + a.height - AXIS_ALIGNED_EPSILON
	);
}

function outline(box: Box): AxisAlignedSegment[] {
	const { x, y, width, height } = box;
	return segmentsFromPoints([
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height },
		{ x, y },
	]);
}

/**
 * How a scene's swimlanes read against the diagram that declares them: one
 * band per declared lane, in declared order, side by side and all one length;
 * every node inside its own lane's band and clear of its header; no route
 * across a header, along or hard beside a lane's outline, or out of the
 * lanes; and free text clear of headers and boundaries.
 */
export function laneRegionIssues(
	scene: CanvasSpec,
	diagram: {
		readonly lanes?: readonly { readonly id: string }[] | undefined;
		readonly nodes: readonly { readonly id: string; readonly lane?: string | undefined }[];
	},
): LaneRegionIssue[] {
	const lanes = diagram.lanes ?? [];
	if (lanes.length === 0) return [];
	const issues: LaneRegionIssue[] = [];
	const shapes = new Map(
		scene.elements.flatMap((element) =>
			element.type === "node" ? [[element.id, element] as const] : [],
		),
	);
	// Bands and headers draw in order, pool by pool, each pool's lanes in declared
	// order; a wrapped diagram draws its lanes again in each further pool.
	const bands = scene.elements.filter(
		(element): element is CanvasShapeElement =>
			element.type === "node" && element.rendererRole === "swimlane",
	);
	const headers = scene.elements.filter(
		(element): element is CanvasShapeElement =>
			element.type === "node" && element.rendererRole === "swimlane-header",
	);
	if (bands.length === 0 || bands.length % lanes.length !== 0 || headers.length !== bands.length)
		return [
			{
				code: "lane-missing",
				elementId: bands[0]?.id ?? "lanes",
				message: `Expected a band and a header for each of ${lanes.length} lanes in every pool, found ${bands.length} bands and ${headers.length} headers.`,
			},
		];
	const pools = Array.from({ length: bands.length / lanes.length }, (_, pool) => ({
		bands: bands.slice(pool * lanes.length, (pool + 1) * lanes.length),
		headers: headers.slice(pool * lanes.length, (pool + 1) * lanes.length),
	}));
	const drawn = pools.flatMap((pool) => pool.bands);
	const heads = pools.flatMap((pool) => pool.headers);
	// Rows stack down for a horizontal flow, columns run across for a vertical one.
	const first = pools[0]!.bands;
	const rows = first.length < 2 ? first[0]!.width >= first[0]!.height : first[1]!.y > first[0]!.y;
	const [along, across, length, breadth] = rows
		? (["x", "y", "width", "height"] as const)
		: (["y", "x", "height", "width"] as const);
	for (const { bands } of pools)
		for (const [index, band] of bands.entries()) {
			const previous = bands[index - 1];
			if (
				previous &&
				Math.abs(previous[across] + previous[breadth] - band[across]) > AXIS_ALIGNED_EPSILON
			)
				issues.push({
					code: "lanes-out-of-order",
					elementId: band.id,
					message: `Lane "${band.id}" does not follow "${previous.id}" directly.`,
				});
			if (
				Math.abs(band[along] - first[0]![along]) > AXIS_ALIGNED_EPSILON ||
				Math.abs(band[length] - first[0]![length]) > AXIS_ALIGNED_EPSILON
			)
				issues.push({
					code: "lanes-uneven",
					elementId: band.id,
					message: `Lane "${band.id}" does not run the same length as the others.`,
				});
		}
	const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
	for (const node of diagram.nodes) {
		const shape = shapes.get(`node:${node.id}`);
		const index = laneIndex.get(node.lane ?? "");
		if (!shape) continue;
		if (
			index === undefined ||
			!pools.some(
				({ bands, headers }) => inside(shape, bands[index]!) && !overlap(shape, headers[index]!),
			)
		)
			issues.push({
				code: "member-outside-lane",
				elementId: shape.id,
				message: `Node "${shape.id}" lies outside the body of its lane "${node.lane}".`,
			});
	}
	const pool = {
		x: Math.min(...drawn.map((band) => band.x)),
		y: Math.min(...drawn.map((band) => band.y)),
		width:
			Math.max(...drawn.map((band) => band.x + band.width)) -
			Math.min(...drawn.map((band) => band.x)),
		height:
			Math.max(...drawn.map((band) => band.y + band.height)) -
			Math.min(...drawn.map((band) => band.y)),
	};
	const boundaries = [...drawn.flatMap(outline), ...heads.flatMap(outline)];
	for (const arrow of scene.elements) {
		if (arrow.type !== "arrow") continue;
		const segments = segmentsFromPoints(arrow.points);
		if (
			segments.some((segment) => heads.some((head) => segmentCrossesBoundsInterior(segment, head)))
		)
			issues.push({
				code: "route-through-header",
				elementId: arrow.id,
				message: `Arrow "${arrow.id}" crosses a lane header.`,
			});
		if (
			segments.some((segment) =>
				boundaries.some(
					(edge) =>
						edge.orientation === segment.orientation &&
						Math.abs(edge.staticCoordinate - segment.staticCoordinate) < GROUP_OUTLINE_CLEARANCE &&
						segmentOverlapLength(edge, segment) > GROUP_OUTLINE_CLEARANCE,
				),
			)
		)
			issues.push({
				code: "route-along-boundary",
				elementId: arrow.id,
				message: `Arrow "${arrow.id}" runs along a lane boundary.`,
			});
		if (arrow.points.some((point) => !inside({ ...point, width: 0, height: 0 }, pool)))
			issues.push({
				code: "route-leaves-lanes",
				elementId: arrow.id,
				message: `Arrow "${arrow.id}" leaves the lanes.`,
			});
	}
	for (const text of scene.elements) {
		if (text.type !== "text" || text.containerId) continue;
		const maxWidth = text.maxWidth ?? 160;
		const wrapped = wrapTextToWidth(text.text, maxWidth, text.fontSize);
		const width = wrappedLabelWidth(wrapped, text.fontSize, maxWidth);
		const height = wrapped.split("\n").length * text.fontSize * 1.35;
		const box = { x: text.x - width / 2, y: text.y - height / 2, width, height };
		if (
			heads.some((head) => overlap(box, head)) ||
			boundaries.some((edge) => segmentCrossesBoundsInterior(edge, box))
		)
			issues.push({
				code: "label-covered",
				elementId: text.id,
				message: `Text "${text.id}" covers a lane header or boundary.`,
			});
	}
	return issues;
}
