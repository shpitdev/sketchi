import { boundLabelWidth } from "@sketchi/diagram-core";

import type { RenderedDiagramScene, SceneElement, TextSceneElement } from "./scene.js";
import {
	isWireframeInteractive,
	WIREFRAME_SPACING,
	type WireframeLayout,
	type WireframeLayoutComponent,
} from "./wireframe.js";

interface Bounds {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface WireframeLayoutIssue {
	readonly code:
		| "outside-frame"
		| "frames-overlap"
		| "shapes-overlap"
		| "text-crosses-shape"
		| "texts-overlap"
		| "text-outside-component";
	readonly elementIds: readonly string[];
	readonly message: string;
}

const TOLERANCE = 0.5;

/** The box Excalidraw stores for a text element, as the adapter sizes it. */
export function wireframeTextBounds(
	text: TextSceneElement,
	container?: { x: number; y: number; width: number; height: number },
): Bounds {
	const width = boundLabelWidth(text.text, text.fontSize, text.maxWidth ?? 160);
	const height = Math.ceil(
		text.text.split("\n").length * text.fontSize * (text.lineHeight ?? 1.35),
	);
	const centerX = container ? container.x + container.width / 2 : text.x;
	const centerY = container ? container.y + container.height / 2 : text.y;
	return {
		left: centerX - width / 2,
		top: centerY - height / 2,
		right: centerX + width / 2,
		bottom: centerY + height / 2,
	};
}

function elementBounds(element: SceneElement, byId: ReadonlyMap<string, SceneElement>): Bounds {
	if (element.type === "text") {
		const container = element.containerId ? byId.get(element.containerId) : undefined;
		return wireframeTextBounds(element, container?.type === "node" ? container : undefined);
	}
	if (element.type === "line" || element.type === "arrow") {
		const xs = element.points.map((point) => point.x);
		const ys = element.points.map((point) => point.y);
		return {
			left: Math.min(...xs),
			top: Math.min(...ys),
			right: Math.max(...xs),
			bottom: Math.max(...ys),
		};
	}
	return {
		left: element.x,
		top: element.y,
		right: element.x + element.width,
		bottom: element.y + element.height,
	};
}

const inside = (inner: Bounds, outer: Bounds, tolerance = TOLERANCE) =>
	inner.left >= outer.left - tolerance &&
	inner.top >= outer.top - tolerance &&
	inner.right <= outer.right + tolerance &&
	inner.bottom <= outer.bottom + tolerance;

const apart = (a: Bounds, b: Bounds, tolerance = TOLERANCE) =>
	a.right <= b.left + tolerance ||
	b.right <= a.left + tolerance ||
	a.bottom <= b.top + tolerance ||
	b.bottom <= a.top + tolerance;

/** A component's own group: the first group of each of its elements. */
const ownGroup = (element: SceneElement) => element.groupIds?.[0];

/**
 * Layout defects a drawn wireframe shows, read from its scene alone: an
 * element outside its screen's frame, overlapping frames, two shapes that
 * overlap without one holding the other, text crossing a shape's border or
 * another text, and a component's text outside its own outline. A modal's
 * backdrop and everything over it are drawn over the screen on purpose.
 */
export function wireframeLayoutIssues(scene: RenderedDiagramScene): WireframeLayoutIssue[] {
	const issues: WireframeLayoutIssue[] = [];
	const byId = new Map(scene.elements.map((element) => [element.id, element]));
	const bounds = new Map(
		scene.elements.map((element) => [element.id, elementBounds(element, byId)]),
	);
	const frames = scene.elements.filter((element) => element.type === "frame");
	for (const [index, frame] of frames.entries())
		for (const other of frames.slice(index + 1))
			if (!apart(bounds.get(frame.id)!, bounds.get(other.id)!))
				issues.push({
					code: "frames-overlap",
					elementIds: [frame.id, other.id],
					message: `Screens "${frame.name ?? frame.id}" and "${other.name ?? other.id}" overlap.`,
				});
	for (const element of scene.elements) {
		if (!element.frameId) continue;
		const frame = bounds.get(element.frameId);
		if (frame && !inside(bounds.get(element.id)!, frame))
			issues.push({
				code: "outside-frame",
				elementIds: [element.id, element.frameId],
				message: `"${element.id}" reaches outside its screen.`,
			});
	}
	// Everything a modal's backdrop covers sits under the overlay; only the rest is compared.
	const layers = new Map<string, number>();
	let layer = 0;
	for (const element of scene.elements) {
		if (element.type === "node" && element.kind === "wireframe:scrim") layer += 1;
		layers.set(element.id, layer);
	}
	const sameLayer = (a: SceneElement, b: SceneElement) =>
		a.frameId === b.frameId && layers.get(a.id) === layers.get(b.id);
	const shapes = scene.elements.filter(
		(element) => element.type === "node" && element.kind !== "wireframe:scrim",
	);
	for (const [index, shape] of shapes.entries()) {
		const box = bounds.get(shape.id)!;
		for (const other of shapes.slice(index + 1)) {
			if (!sameLayer(shape, other) || ownGroup(shape) === ownGroup(other)) continue;
			const otherBox = bounds.get(other.id)!;
			if (!apart(box, otherBox) && !inside(box, otherBox) && !inside(otherBox, box))
				issues.push({
					code: "shapes-overlap",
					elementIds: [shape.id, other.id],
					message: `"${shape.id}" and "${other.id}" overlap.`,
				});
		}
	}
	const texts = scene.elements.filter((element) => element.type === "text");
	for (const [index, text] of texts.entries()) {
		const box = bounds.get(text.id)!;
		for (const shape of shapes) {
			if (!sameLayer(text, shape) || text.containerId === shape.id) continue;
			const shapeBox = bounds.get(shape.id)!;
			if (!apart(box, shapeBox) && !inside(box, shapeBox))
				issues.push({
					code: "text-crosses-shape",
					elementIds: [text.id, shape.id],
					message: `Text "${text.text.replace(/\n/gu, " ")}" crosses the border of "${shape.id}".`,
				});
		}
		for (const other of texts.slice(index + 1))
			if (sameLayer(text, other) && !apart(box, bounds.get(other.id)!))
				issues.push({
					code: "texts-overlap",
					elementIds: [text.id, other.id],
					message: `Texts "${text.text.replace(/\n/gu, " ")}" and "${other.text.replace(/\n/gu, " ")}" overlap.`,
				});
		// A component whose outline is its own box keeps its words inside it.
		const outline = byId.get(`${text.id.slice(0, text.id.lastIndexOf(":"))}:box`);
		if (
			outline?.type === "node" &&
			ownGroup(outline) === ownGroup(text) &&
			!inside(box, bounds.get(outline.id)!) &&
			outline.kind !== "wireframe:checkbox" &&
			outline.kind !== "wireframe:radio" &&
			outline.kind !== "wireframe:icon" &&
			!isFieldLabel(text)
		)
			issues.push({
				code: "text-outside-component",
				elementIds: [text.id, outline.id],
				message: `Text "${text.text.replace(/\n/gu, " ")}" spills out of "${outline.id}".`,
			});
	}
	return issues;
}

/** A field's label sits above its box, and a control's beside it, by design. */
const isFieldLabel = (text: TextSceneElement) => text.id.endsWith(":label") && !text.containerId;

export interface WireframeBoxIssue {
	readonly code:
		| "outside-parent"
		| "outside-screen"
		| "siblings-overlap"
		| "gap-off-scale"
		| "uneven-gap"
		| "small-touch-target"
		| "screen-widened";
	readonly paths: readonly string[];
	readonly screen: string;
	readonly message: string;
}

/** The least height of a target a finger hits on a phone. */
export const WIREFRAME_TOUCH_TARGET = 44;

/**
 * Defects in the boxes a wireframe lays out: a child outside its parent or a
 * component outside its screen, siblings that overlap, a gap between
 * siblings off the spacing scale or unlike the gap its container sets, a
 * control on a phone shorter than a touch target, and a screen wider than
 * its device.
 */
export function wireframeBoxIssues(layout: WireframeLayout): WireframeBoxIssue[] {
	const issues: WireframeBoxIssue[] = [];
	for (const screen of layout.screens) {
		const push = (code: WireframeBoxIssue["code"], paths: readonly string[], message: string) =>
			issues.push({ code, paths, screen: screen.id, message });
		if (screen.widened)
			push(
				"screen-widened",
				[],
				`Screen "${screen.id}" grew past its device's width to fit a word.`,
			);
		const byPath = new Map(screen.components.map((component) => [component.path, component]));
		const asBounds = (box: WireframeLayoutComponent["box"]): Bounds => ({
			left: box.x,
			top: box.y,
			right: box.x + box.width,
			bottom: box.y + box.height,
		});
		const frame = asBounds(screen.frame);
		const children = new Map<string | undefined, WireframeLayoutComponent[]>();
		for (const component of screen.components) {
			const list = children.get(component.parent) ?? [];
			list.push(component);
			children.set(component.parent, list);
			const box = asBounds(component.box);
			if (!inside(box, frame))
				push(
					"outside-screen",
					[component.path],
					`The ${component.type} at ${component.path} reaches outside its screen.`,
				);
			const parent = component.parent === undefined ? undefined : byPath.get(component.parent);
			if (parent && !inside(box, asBounds(parent.box)))
				push(
					"outside-parent",
					[component.path, parent.path],
					`The ${component.type} at ${component.path} reaches outside its ${parent.type}.`,
				);
			if (
				screen.device === "mobile" &&
				isWireframeInteractive(component.type) &&
				component.box.height < WIREFRAME_TOUCH_TARGET - TOLERANCE
			)
				push(
					"small-touch-target",
					[component.path],
					`The ${component.type} at ${component.path} is ${component.box.height} tall, under a ${WIREFRAME_TOUCH_TARGET} px touch target.`,
				);
		}
		for (const [parentPath, siblings] of children) {
			for (const [index, sibling] of siblings.entries())
				for (const other of siblings.slice(index + 1))
					if (
						sibling.overlay === other.overlay &&
						!apart(asBounds(sibling.box), asBounds(other.box))
					)
						push(
							"siblings-overlap",
							[sibling.path, other.path],
							`The ${sibling.type} at ${sibling.path} overlaps the ${other.type} at ${other.path}.`,
						);
			const parent = parentPath === undefined ? undefined : byPath.get(parentPath);
			const flow = parent?.flow;
			if (!flow) continue;
			if (!(WIREFRAME_SPACING as readonly number[]).includes(flow.gap))
				push(
					"gap-off-scale",
					[parent.path],
					`The ${parent.type} at ${parent.path} spaces its children ${flow.gap} apart, off the spacing scale.`,
				);
			// Siblings on one line: a column holds one per line; rows and grids share a line where their boxes share height.
			const lines: WireframeLayoutComponent[][] = [];
			for (const sibling of siblings.toSorted((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
				const line =
					flow.axis === "column"
						? undefined
						: lines.find((members) =>
								members.some(
									(member) =>
										member.box.y < sibling.box.y + sibling.box.height &&
										sibling.box.y < member.box.y + member.box.height,
								),
							);
				if (line) line.push(sibling);
				else lines.push([sibling]);
			}
			if (flow.axis === "column") {
				const ordered = siblings.toSorted((a, b) => a.box.y - b.box.y);
				for (const [index, next] of ordered.slice(1).entries()) {
					const previous = ordered[index]!;
					const gap = next.box.y - (previous.box.y + previous.box.height);
					if (Math.abs(gap - flow.gap) > TOLERANCE)
						push(
							"uneven-gap",
							[previous.path, next.path],
							`The ${parent.type} at ${parent.path} sets ${flow.gap} between children; ${previous.path} and ${next.path} sit ${gap} apart.`,
						);
				}
				continue;
			}
			for (const line of lines) {
				if (flow.spread) continue;
				const ordered = line.toSorted((a, b) => a.box.x - b.box.x);
				for (const [index, next] of ordered.slice(1).entries()) {
					const previous = ordered[index]!;
					const gap = next.box.x - (previous.box.x + previous.box.width);
					// A grid's cells are even; a widget that hugs its text leaves its cell's rest empty.
					if (
						flow.axis === "grid" ? gap < flow.gap - TOLERANCE : Math.abs(gap - flow.gap) > TOLERANCE
					)
						push(
							"uneven-gap",
							[previous.path, next.path],
							`The ${parent.type} at ${parent.path} sets ${flow.gap} between children; ${previous.path} and ${next.path} sit ${gap} apart.`,
						);
				}
			}
			for (const [index, next] of lines.slice(1).entries()) {
				const previous = lines[index]!;
				const gap =
					Math.min(...next.map((member) => member.box.y)) -
					Math.max(...previous.map((member) => member.box.y + member.box.height));
				if (gap < flow.gap - TOLERANCE)
					push(
						"uneven-gap",
						[previous[0]!.path, next[0]!.path],
						`The ${parent.type} at ${parent.path} sets ${flow.gap} between lines; two of its lines sit ${gap} apart.`,
					);
			}
		}
	}
	return issues;
}
