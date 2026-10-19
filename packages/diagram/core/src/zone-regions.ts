import type { CanvasShapeElement, CanvasSpec, CanvasTextElement } from "./canvas.js";
import { GROUP_OUTLINE_CLEARANCE } from "./group-regions.js";
import {
	AXIS_ALIGNED_EPSILON,
	segmentCrossesBoundsInterior,
	segmentOverlapLength,
	segmentsFromPoints,
} from "./segments.js";
import { boundLabelWidth, wrapTextToWidth, wrappedLabelWidth } from "./text-metrics.js";

export interface ZoneRegionIssue {
	readonly code:
		| "zone-missing"
		| "member-outside-zone"
		| "non-member-inside-zone"
		| "zone-outside-parent"
		| "zones-overlap"
		| "label-covered"
		| "label-crossed"
		| "route-through-zone"
		| "route-leaves-zone"
		| "route-along-outline";
	readonly elementId: string;
	readonly message: string;
}

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** The groups and memberships a zoned scene was drawn from. */
export interface ZonedDiagram {
	readonly groups?:
		| readonly { readonly id: string; readonly parent?: string | undefined }[]
		| undefined;
	readonly nodes: readonly { readonly id: string; readonly group?: string | undefined }[];
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

/** Where a zone's label is painted: its stored width, one line tall. */
function labelBox(text: CanvasTextElement): Box {
	const width = boundLabelWidth(text.text, text.fontSize, text.maxWidth ?? 160);
	const height = text.fontSize * (text.lineHeight ?? 1.35);
	return { x: text.x - width / 2, y: text.y - height / 2, width, height };
}

/**
 * How a scene's zones read against the groups it was drawn from: a zone per
 * group, every member inside its zone and every other node outside it, each
 * zone inside its parent and apart from every zone it is not nested in, labels
 * clear of nodes, zones and free text, no route through a zone neither end
 * sits in, along an outline or across a label, and every route whose ends
 * share a zone inside it.
 */
export function zoneRegionIssues(scene: CanvasSpec, diagram: ZonedDiagram): ZoneRegionIssue[] {
	const groups = diagram.groups ?? [];
	const issues: ZoneRegionIssue[] = [];
	const zones = new Map(
		scene.elements.flatMap((element) =>
			element.type === "node" && element.rendererRole === "zone"
				? [[element.id, element] as const]
				: [],
		),
	);
	const labels = new Map(
		scene.elements.flatMap((element) =>
			element.type === "text" && element.id.startsWith("zone-label:")
				? [[element.id.slice("zone-label:".length), labelBox(element)] as const]
				: [],
		),
	);
	const parentOf = new Map(
		groups.flatMap((group) => (group.parent === undefined ? [] : [[group.id, group.parent]])),
	);
	const chain = (group: string | undefined) => {
		const ids: string[] = [];
		for (let id = group; id !== undefined && !ids.includes(id); id = parentOf.get(id)) ids.push(id);
		return ids;
	};
	const groupOf = new Map(diagram.nodes.map((node) => [node.id, node.group]));
	const held = new Set(diagram.nodes.flatMap((node) => chain(node.group)));
	const zoneOf = (id: string) => zones.get(`group:${id}`);
	for (const group of groups) {
		if (!held.has(group.id)) continue;
		if (!zoneOf(group.id) || !labels.has(group.id))
			issues.push({
				code: "zone-missing",
				elementId: `group:${group.id}`,
				message: `Group "${group.id}" draws no zone with a label.`,
			});
	}
	const drawn = groups.filter((group) => held.has(group.id) && zoneOf(group.id));
	const nodes = scene.elements.filter(
		(element): element is CanvasShapeElement =>
			element.type === "node" && element.rendererRole === undefined,
	);
	for (const node of nodes) {
		const around = new Set(chain(groupOf.get(node.nodeId)));
		for (const group of drawn) {
			const zone = zoneOf(group.id)!;
			if (around.has(group.id) && !inside(node, zone))
				issues.push({
					code: "member-outside-zone",
					elementId: node.id,
					message: `Node "${node.id}" lies outside its zone "${zone.id}".`,
				});
			if (!around.has(group.id) && overlap(node, zone))
				issues.push({
					code: "non-member-inside-zone",
					elementId: node.id,
					message: `Node "${node.id}" overlaps zone "${zone.id}" without belonging to it.`,
				});
			const label = labels.get(group.id);
			if (label && overlap(node, label))
				issues.push({
					code: "label-covered",
					elementId: node.id,
					message: `Node "${node.id}" covers the label of zone "${zone.id}".`,
				});
		}
	}
	for (const [index, group] of drawn.entries()) {
		const zone = zoneOf(group.id)!;
		const parent = parentOf.get(group.id);
		if (parent !== undefined && zoneOf(parent) && !inside(zone, zoneOf(parent)!))
			issues.push({
				code: "zone-outside-parent",
				elementId: zone.id,
				message: `Zone "${zone.id}" leaves its parent zone "group:${parent}".`,
			});
		for (const other of drawn.slice(index + 1)) {
			const otherZone = zoneOf(other.id)!;
			const nested = chain(group.id).includes(other.id) || chain(other.id).includes(group.id);
			if (!nested && overlap(zone, otherZone))
				issues.push({
					code: "zones-overlap",
					elementId: zone.id,
					message: `Zone "${zone.id}" overlaps zone "${otherZone.id}".`,
				});
			// A nested zone keeps clear of the label in its parent's header strip.
			for (const [inner, outer] of [
				[group, other],
				[other, group],
			] as const)
				if (
					chain(inner.id).includes(outer.id) &&
					labels.has(outer.id) &&
					overlap(zoneOf(inner.id)!, labels.get(outer.id)!)
				)
					issues.push({
						code: "label-covered",
						elementId: zoneOf(inner.id)!.id,
						message: `Zone "${zoneOf(inner.id)!.id}" covers the label of zone "${zoneOf(outer.id)!.id}".`,
					});
		}
	}
	const outlines = new Map(drawn.map((group) => [group.id, outline(zoneOf(group.id)!)]));
	for (const arrow of scene.elements) {
		if (arrow.type !== "arrow") continue;
		const segments = segmentsFromPoints(arrow.points);
		const sourceChain = chain(groupOf.get(arrow.sourceNodeId));
		const targetChain = chain(groupOf.get(arrow.targetNodeId));
		const ends = new Set([...sourceChain, ...targetChain]);
		const holding = new Set(sourceChain.filter((id) => targetChain.includes(id)));
		for (const group of drawn) {
			const zone = zoneOf(group.id)!;
			if (
				!ends.has(group.id) &&
				segments.some((segment) => segmentCrossesBoundsInterior(segment, zone))
			)
				issues.push({
					code: "route-through-zone",
					elementId: arrow.id,
					message: `Arrow "${arrow.id}" passes through zone "${zone.id}".`,
				});
			if (
				holding.has(group.id) &&
				arrow.points.some((point) => !inside({ ...point, width: 0, height: 0 }, zone))
			)
				issues.push({
					code: "route-leaves-zone",
					elementId: arrow.id,
					message: `Arrow "${arrow.id}" leaves zone "${zone.id}", which holds both its ends.`,
				});
			if (
				segments.some((segment) =>
					outlines
						.get(group.id)!
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
					message: `Arrow "${arrow.id}" runs along the outline of zone "${zone.id}".`,
				});
			const label = labels.get(group.id);
			if (label && segments.some((segment) => segmentCrossesBoundsInterior(segment, label)))
				issues.push({
					code: "label-crossed",
					elementId: arrow.id,
					message: `Arrow "${arrow.id}" crosses the label of zone "${zone.id}".`,
				});
		}
	}
	for (const text of scene.elements) {
		if (text.type !== "text" || text.containerId || text.id.startsWith("zone-label:")) continue;
		const maxWidth = text.maxWidth ?? 160;
		const wrapped = wrapTextToWidth(text.text, maxWidth, text.fontSize);
		const width = wrappedLabelWidth(wrapped, text.fontSize, maxWidth);
		const height = wrapped.split("\n").length * text.fontSize * 1.35;
		const box = { x: text.x - width / 2, y: text.y - height / 2, width, height };
		for (const group of drawn) {
			const label = labels.get(group.id);
			if (
				(label && overlap(box, label)) ||
				outlines.get(group.id)!.some((edge) => segmentCrossesBoundsInterior(edge, box))
			)
				issues.push({
					code: "label-covered",
					elementId: text.id,
					message: `Text "${text.id}" covers the label or outline of zone "${zoneOf(group.id)!.id}".`,
				});
		}
	}
	return issues;
}
