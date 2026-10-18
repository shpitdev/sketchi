import type { CanvasFrameElement, CanvasSpec } from "./canvas.js";
import {
	AXIS_ALIGNED_EPSILON,
	segmentCrossesBoundsInterior,
	segmentOverlapLength,
	segmentsFromPoints,
} from "./segments.js";
import { estimateTextWidth, wrapTextToWidth, wrappedLabelWidth } from "./text-metrics.js";

/**
 * Excalidraw paints a frame's name 3 px above its top-left corner in 14 px
 * Helvetica, 17.5 px tall, and cuts it to the frame's width; offline exports
 * paint it in Excalifont. The name box below pads that with a clearance.
 */
export const CANVAS_FRAME_NAME = Object.freeze({
	clearance: 4,
	fontSize: 14,
	height: 21,
});

/** Glyphs wider than an em in Helvetica (W, M, @, %) and in Excalifont (%). */
const WIDEST_NAME_GLYPHS = /[@%MW]/u;
/** Capitals, digits, m, w and wide symbols: up to 0.86 em in either face. */
const WIDE_NAME_GLYPHS = /[A-Z0-9mw#$&_~]/u;
const nameGlyphs = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Width a frame's name can paint in Helvetica or Excalifont, glyph by glyph,
 * never less than it does: wide capitals and symbols take a full em, other
 * capitals, digits and wide letters 0.86 em, and the remaining ASCII the
 * shared 0.62 em. Other scripts keep the shared estimate, at least 0.86 em.
 */
export function canvasFrameNameWidth(name: string): number {
	const { fontSize } = CANVAS_FRAME_NAME;
	let width = 0;
	for (const { segment } of nameGlyphs.segment(name)) {
		width += WIDEST_NAME_GLYPHS.test(segment)
			? 1.02 * fontSize
			: WIDE_NAME_GLYPHS.test(segment)
				? 0.86 * fontSize
				: /^[\x20-\x7e]$/u.test(segment)
					? estimateTextWidth(segment, fontSize)
					: Math.max(0.86 * fontSize, estimateTextWidth(segment, fontSize));
	}
	return Math.ceil(width);
}

/** A route closer than this to a frame's outline, and running along it, reads as part of it. */
export const GROUP_OUTLINE_CLEARANCE = 8;

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Where a frame's name is painted, padded by its clearance. */
export function canvasFrameNameBox(frame: Box & { readonly name?: string | undefined }): Box {
	const { clearance, height } = CANVAS_FRAME_NAME;
	const width = canvasFrameNameWidth(frame.name ?? "Frame");
	return {
		x: frame.x - clearance,
		y: frame.y - height - clearance,
		width: width + 2 * clearance,
		height: height + clearance - 1,
	};
}

export interface GroupRegionIssue {
	readonly code:
		| "frames-overlap"
		| "label-crossed"
		| "label-covered"
		| "member-outside-frame"
		| "non-member-inside-frame"
		| "route-along-outline"
		| "route-leaves-group"
		| "route-through-group";
	readonly elementId: string;
	readonly message: string;
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

function outline(box: Box) {
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
 * How a scene's group frames read: every member inside its frame and every
 * other node outside it, frames (with their names) apart, no route through a
 * group neither end belongs to, a group's own routes inside it, no route along
 * an outline, and names clear of routes and free text.
 */
export function groupRegionIssues(scene: CanvasSpec): GroupRegionIssue[] {
	const frames = scene.elements.filter(
		(element): element is CanvasFrameElement => element.type === "frame",
	);
	if (frames.length === 0) return [];
	const issues: GroupRegionIssue[] = [];
	const nodes = scene.elements.flatMap((element) => (element.type === "node" ? [element] : []));
	const frameOfNode = new Map(nodes.map((node) => [node.nodeId, node.frameId]));
	const names = new Map(frames.map((frame) => [frame.id, canvasFrameNameBox(frame)]));
	const outlines = new Map(frames.map((frame) => [frame.id, outline(frame)]));
	for (const frame of frames) {
		for (const node of nodes) {
			if (node.frameId === frame.id && !inside(node, frame))
				issues.push({
					code: "member-outside-frame",
					elementId: node.id,
					message: `Node "${node.id}" lies outside its frame "${frame.id}".`,
				});
			if (node.frameId !== frame.id && overlap(node, frame))
				issues.push({
					code: "non-member-inside-frame",
					elementId: node.id,
					message: `Node "${node.id}" overlaps frame "${frame.id}" without belonging to it.`,
				});
		}
	}
	for (const [index, frame] of frames.entries()) {
		const band = {
			...frame,
			y: names.get(frame.id)!.y,
			height: frame.y + frame.height - names.get(frame.id)!.y,
		};
		for (const other of frames.slice(index + 1)) {
			const otherBand = {
				...other,
				y: names.get(other.id)!.y,
				height: other.y + other.height - names.get(other.id)!.y,
			};
			if (overlap(band, otherBand))
				issues.push({
					code: "frames-overlap",
					elementId: frame.id,
					message: `Frame "${frame.id}" overlaps frame "${other.id}".`,
				});
		}
	}
	for (const arrow of scene.elements) {
		if (arrow.type !== "arrow") continue;
		const segments = segmentsFromPoints(arrow.points);
		const ends = [frameOfNode.get(arrow.sourceNodeId), frameOfNode.get(arrow.targetNodeId)];
		for (const frame of frames) {
			const own = ends.includes(frame.id);
			if (!own && segments.some((segment) => segmentCrossesBoundsInterior(segment, frame)))
				issues.push({
					code: "route-through-group",
					elementId: arrow.id,
					message: `Arrow "${arrow.id}" passes through group "${frame.id}".`,
				});
			if (
				ends[0] === frame.id &&
				ends[1] === frame.id &&
				arrow.points.some((point) => !inside({ ...point, width: 0, height: 0 }, frame))
			)
				issues.push({
					code: "route-leaves-group",
					elementId: arrow.id,
					message: `Arrow "${arrow.id}" leaves its group "${frame.id}".`,
				});
			if (
				segments.some((segment) =>
					outlines
						.get(frame.id)!
						.some(
							(edge) =>
								edge.orientation === segment.orientation &&
								Math.abs(edge.staticCoordinate - segment.staticCoordinate) <
									GROUP_OUTLINE_CLEARANCE &&
								segmentOverlapLength(edge, segment) > GROUP_OUTLINE_CLEARANCE,
						),
				)
			)
				issues.push({
					code: "route-along-outline",
					elementId: arrow.id,
					message: `Arrow "${arrow.id}" runs along the outline of group "${frame.id}".`,
				});
			if (segments.some((segment) => segmentCrossesBoundsInterior(segment, names.get(frame.id)!)))
				issues.push({
					code: "label-crossed",
					elementId: arrow.id,
					message: `Arrow "${arrow.id}" crosses the name of group "${frame.id}".`,
				});
		}
	}
	for (const text of scene.elements) {
		if (text.type !== "text" || text.containerId) continue;
		const maxWidth = text.maxWidth ?? 160;
		const wrapped = wrapTextToWidth(text.text, maxWidth, text.fontSize);
		const width = wrappedLabelWidth(wrapped, text.fontSize, maxWidth);
		const height = wrapped.split("\n").length * text.fontSize * 1.35;
		const box = { x: text.x - width / 2, y: text.y - height / 2, width, height };
		for (const frame of frames) {
			if (
				overlap(box, names.get(frame.id)!) ||
				outlines.get(frame.id)!.some((edge) => segmentCrossesBoundsInterior(edge, box))
			)
				issues.push({
					code: "label-covered",
					elementId: text.id,
					message: `Text "${text.id}" covers the name or outline of group "${frame.id}".`,
				});
		}
	}
	return issues;
}
