import {
	CANVAS_SPEC_VERSION,
	SKETCHI_DIAGRAM_PALETTE,
	validateVennDiagram,
	vennSetColor,
	type VennDiagram,
} from "@sketchi/diagram-core";

import type {
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	TextSceneElement,
} from "./scene.js";
import {
	layoutVennDiagram,
	VENN_SET_LABEL_FONT,
	type VennBox,
	type VennCircle,
	type VennLayout,
} from "./venn-layout.js";

export const VENN_SET_ROLE = "venn-set";

/** A set's circle keeps its role only while it still reads as one: an unlabeled ellipse on its set id. */
export function isStructurallyValidVennSet(element: {
	readonly id: string;
	readonly nodeId: string;
	readonly shape: string;
	readonly icon?: unknown;
}): boolean {
	return (
		/^venn:set:\d+(?::fill)?$/u.test(element.nodeId) &&
		element.id === `node:${element.nodeId}` &&
		element.shape === "ellipse" &&
		element.icon === undefined
	);
}

const PADDING = 40;
const INK = SKETCHI_DIAGRAM_PALETTE.ink;
/** Fills are translucent so each overlap reads as the blend of its sets. */
export const VENN_FILL_OPACITY = 22;
/** Text on any region's blended fill keeps at least this contrast. */
const MIN_TEXT_CONTRAST = 7;

/** The id of a region's group and texts: its set indexes joined by "+". */
export function vennRegionId(key: readonly number[]): string {
	return `venn:region:${key.join("+")}`;
}

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
	const value = Number.parseInt(hex.slice(1), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hex(color: Rgb): string {
	return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function luminance(color: Rgb): number {
	const [r, g, b] = color.map((channel) => {
		const value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	}) as unknown as Rgb;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
	const la = luminance(rgb(a));
	const lb = luminance(rgb(b));
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The color a region shows: each of its sets' fills composited over the surface in order. */
export function vennRegionFill(
	surface: string,
	fills: readonly string[],
	key: readonly number[],
	opacity = VENN_FILL_OPACITY,
): string {
	let color = rgb(surface);
	for (const index of key) color = mix(color, rgb(fills[index]!), opacity / 100);
	return hex(color);
}

/** Every non-empty combination of `count` sets, as ascending index lists. */
function allKeys(count: number): number[][] {
	const keys: number[][] = [];
	for (let mask = 1; mask < 1 << count; mask += 1)
		keys.push(
			Array.from({ length: count }, (_, index) => index).filter((index) => mask & (1 << index)),
		);
	return keys;
}

/**
 * Fill tints for the sets: their own colors, lightened toward white only as far
 * as needed for ink to read on every region's blend.
 */
export function vennFills(surface: string, colors: readonly string[]): string[] {
	const keys = allKeys(colors.length);
	for (let step = 0; step <= 10; step += 1) {
		const fills = colors.map((color) => hex(mix(rgb(color), [255, 255, 255], step / 10)));
		if (
			keys.every(
				(key) => contrastRatio(INK, vennRegionFill(surface, fills, key)) >= MIN_TEXT_CONTRAST,
			)
		)
			return fills;
	}
	return colors.map(() => "#ffffff");
}

/** A set's label color: its own hue, darkened until it reads on the surface. */
export function vennLabelColor(surface: string, color: string): string {
	for (let step = 0; step <= 20; step += 1) {
		const shade = hex(mix(rgb(color), [0, 0, 0], step / 20));
		if (contrastRatio(shade, surface) >= 4.5) return shade;
	}
	return INK;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

interface Drawn {
	readonly elements: SceneElement[];
	readonly back: string[];
	readonly middle: string[];
	readonly front: string[];
}

function text(
	drawn: Drawn,
	id: string,
	value: string,
	fontSize: number,
	box: VennBox,
	color: string,
	groupIds: string[],
): void {
	drawn.elements.push({
		type: "text",
		id,
		x: round((box.left + box.right) / 2),
		y: round((box.top + box.bottom) / 2),
		text: value,
		fontSize,
		maxWidth: Math.ceil(box.right - box.left),
		textAlign: "center",
		textColor: color,
		groupIds,
	} satisfies TextSceneElement);
	drawn.front.push(id);
}

function circleNode(
	nodeId: string,
	circle: VennCircle,
	label: string,
	style: Partial<NodeSceneElement>,
): NodeSceneElement {
	return {
		type: "node",
		id: `node:${nodeId}`,
		nodeId,
		rendererRole: VENN_SET_ROLE,
		shape: "ellipse",
		x: round(circle.x - circle.r),
		y: round(circle.y - circle.r),
		width: round(circle.r * 2),
		height: round(circle.r * 2),
		label,
		...style,
	};
}

function sceneBounds(layout: VennLayout): VennBox {
	const boxes: VennBox[] = [
		...layout.circles.map((circle) => ({
			left: circle.x - circle.r,
			right: circle.x + circle.r,
			top: circle.y - circle.r,
			bottom: circle.y + circle.r,
		})),
		...layout.labels.map((label) => label.box),
	];
	return {
		left: Math.min(...boxes.map((box) => box.left)),
		top: Math.min(...boxes.map((box) => box.top)),
		right: Math.max(...boxes.map((box) => box.right)),
		bottom: Math.max(...boxes.map((box) => box.bottom)),
	};
}

/**
 * Render a Venn diagram: a translucent circle per set with its label outside,
 * and each region's label, count or items centred inside that region, clear
 * of every outline. Each set (fill, outline, label) and each region's text is
 * one Excalidraw group.
 */
export function renderVennDiagram(input: VennDiagram): RenderedDiagramScene {
	const diagram = validateVennDiagram(input);
	const surface = diagram.style.backgroundColor;
	const layout = layoutVennDiagram(diagram);
	const bounds = sceneBounds(layout);
	const dx = PADDING - bounds.left;
	const dy = PADDING - bounds.top;
	const shift = <T extends { x: number; y: number }>(point: T): T => ({
		...point,
		x: point.x + dx,
		y: point.y + dy,
	});
	const shiftBox = (box: VennBox): VennBox => ({
		left: box.left + dx,
		right: box.right + dx,
		top: box.top + dy,
		bottom: box.bottom + dy,
	});
	const colors = diagram.sets.map((set, index) => vennSetColor(set, index));
	const fills = vennFills(surface, colors);
	const drawn: Drawn = { elements: [], back: [], middle: [], front: [] };
	diagram.sets.forEach((set, index) => {
		const circle = shift(layout.circles[index]!);
		const group = [`venn:set:${index}`];
		// The fill's own edge sits under the outline; scenes keep hex colors only.
		const fill = circleNode(`venn:set:${index}:fill`, circle, set.label, {
			fillColor: fills[index]!,
			fillStyle: "solid",
			strokeColor: fills[index]!,
			strokeWidth: 1,
			roughness: 0,
			opacity: VENN_FILL_OPACITY,
			groupIds: group,
		});
		drawn.elements.push(fill);
		drawn.back.push(fill.id);
		const outline = circleNode(`venn:set:${index}`, circle, set.label, {
			strokeColor: colors[index]!,
			strokeWidth: 2,
			// Exact circles: text clears the outline it is measured against.
			roughness: 0,
			groupIds: group,
		});
		drawn.elements.push(outline);
		drawn.middle.push(outline.id);
		const label = layout.labels[index]!;
		text(
			drawn,
			`venn:set:${index}:label`,
			label.text,
			VENN_SET_LABEL_FONT,
			shiftBox(label.box),
			vennLabelColor(surface, colors[index]!),
			group,
		);
	});
	for (const region of layout.regions) {
		const id = vennRegionId(region.key);
		const centre = shift(region.center);
		const top = centre.y - region.block.height / 2;
		for (const piece of region.block.pieces) {
			const pieceTop = top + piece.top;
			text(
				drawn,
				piece.role === "item" ? `${id}:item:${piece.index}` : `${id}:${piece.role}`,
				piece.text,
				piece.fontSize,
				{
					left: centre.x - piece.width / 2,
					right: centre.x + piece.width / 2,
					top: pieceTop,
					bottom: pieceTop + piece.height,
				},
				INK,
				[id],
			);
		}
	}
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: diagram.id,
		title: diagram.title,
		width: Math.ceil(bounds.right - bounds.left + PADDING * 2),
		height: Math.ceil(bounds.bottom - bounds.top + PADDING * 2),
		accentColor: diagram.style.accentColor,
		backgroundColor: surface,
		elements: drawn.elements,
		layers: [],
		layouts: [],
		zOrder: [...drawn.back, ...drawn.middle, ...drawn.front],
	};
}
