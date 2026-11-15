import {
	DEFAULT_GLYPH_UNITS,
	type CanvasShapeKind as NodeSceneShape,
	type CanvasComposedShapeKind,
	wrapTextToUnits,
	estimateTextWidth,
	CANVAS_NODE_ICON,
	canvasBoundTextBox,
	type CanvasNodeIcon,
	canvasNodeIconBand,
	type CanvasShapeElement as NodeSceneElement,
	isCanvasComposedShape,
	CANVAS_SHAPE_CURVE,
	wrapTextToWidth,
	wrappedLabelWidth,
} from "@sketchi/drawing";
import { type DiagramNode, type GraphNode, DIAGRAM_NODE_COLORS } from "./intermediate.js";
import { type LabelMetrics, type DescriptionMetrics } from "./layout-types.js";

export const MIN_NODE_WIDTH = 184;

export const MIN_NODE_HEIGHT = 72;

export const PADDING = 48;

/** Sketchi PNG export padding per side (browser-renderer EXPORT_PADDING). */
export const EXPORT_PADDING = 20;

export const NODE_LABEL_FONT_SIZE = 14;

export const NODE_LABEL_LINE_HEIGHT = 1.35;

export const NODE_LABEL_HORIZONTAL_PADDING = 36;

const NODE_LABEL_VERTICAL_PADDING = 28;

/** Eighteen average glyphs per line before wrapping. */
export const MAX_LABEL_LINE_UNITS = 18 * DEFAULT_GLYPH_UNITS;

/** A diamond's bound-text box is half its width, so decisions wrap sooner. */
export const MAX_DIAMOND_LABEL_LINE_UNITS = 12 * DEFAULT_GLYPH_UNITS;

/** Logo edge per shape; smaller marks keep start/end and decision nodes compact. */
const NODE_ICON_SIZE: Readonly<Record<NodeSceneShape, number>> = {
	circle: 24,
	bucket: 28,
	cylinder: 28,
	diamond: 20,
	document: 28,
	ellipse: 24,
	pipe: 28,
	polygon: 28,
	rectangle: 28,
};

/** The canvas shape each infrastructure node shape draws as. */
const COMPOSED_SHAPES: Readonly<
	Record<NonNullable<DiagramNode["shape"]>, CanvasComposedShapeKind>
> = { database: "cylinder", queue: "pipe", document: "document", storage: "bucket" };

/** Excalidraw draws an arrowhead this long, at most half its final run. */
export const ARROWHEAD_LENGTH = 25;

/** Its wings fan 20 degrees off its line. */
export const ARROWHEAD_WING = (20 * Math.PI) / 180;

function measureLabel(label: string, maxLineUnits: number): LabelMetrics {
	const text = wrapTextToUnits(label, maxLineUnits);
	const lines = text.split("\n");
	const textWidth = estimateTextWidth(text, NODE_LABEL_FONT_SIZE);
	const textHeight = Math.ceil(lines.length * NODE_LABEL_FONT_SIZE * NODE_LABEL_LINE_HEIGHT);
	const width = Math.ceil(textWidth + NODE_LABEL_HORIZONTAL_PADDING);
	const height = Math.ceil(textHeight + NODE_LABEL_VERTICAL_PADDING);

	return { text, textHeight, textWidth, width, height };
}

/**
 * Smallest container whose Excalidraw bound-text box holds text of this size:
 * a label and any logo band, or a label centered between its description and
 * logo bands. Excalidraw re-wraps an edited label to this box (half the width
 * of a diamond, the inscribed rectangle of an ellipse), so sizing to it keeps
 * the stored wrap and the logo clear after editing.
 */
function boundTextContainerSize(
	shape: NodeSceneShape,
	textWidth: number,
	textHeight: number,
): { readonly height: number; readonly width: number } {
	const padding = CANVAS_NODE_ICON.boundTextPadding * 2;
	const scale =
		shape === "diamond" ? 2 : shape === "ellipse" || shape === "circle" ? Math.SQRT2 : 1;
	let width = Math.ceil((textWidth + padding) * scale);
	let height = Math.ceil((textHeight + padding) * scale);
	// Excalidraw rounds its text box, which can land just under the closed-form
	// size; grow until the rounded box itself holds the text.
	while (canvasBoundTextBox({ height, shape, width }).width < textWidth) {
		width += 1;
	}
	while (canvasBoundTextBox({ height, shape, width }).height < textHeight) {
		height += 1;
	}
	return { width, height };
}

/**
 * A node's description draws as a smaller, muted subtitle under its label. The
 * label stays centered, as Excalidraw keeps a bound label, so the node holds a
 * band as deep as the description's (or its logo's, if deeper) on both sides.
 */
export const NODE_DESCRIPTION_FONT_SIZE = 12;

export const NODE_DESCRIPTION_LINE_HEIGHT = 1.25;

export const NODE_DESCRIPTION_COLOR = "#5f574c";

/** Space between a label and its description, and under the description. */
export const NODE_DESCRIPTION_GAP = 2;

const NODE_DESCRIPTION_CLEARANCE = 4;

/**
 * Lines a description wraps in before its node widens, up to its shape's
 * limit: two in a box, one in a diamond or an ellipse, which pay for a line in
 * width as well as height.
 */
function descriptionLines(shape: NodeSceneShape): number {
	return shape === "diamond" || shape === "ellipse" || shape === "circle" ? 1 : 2;
}

/** At the widest a description may run to this many lines before its build warns. */
export const NODE_DESCRIPTION_MAX_LINES = 3;

/**
 * Widest description text per shape: a box keeps its node within 300 px. A
 * diamond holds its text in half its width and height, and an ellipse in its
 * inscribed box, so every extra line costs them two or three times its height;
 * they widen further, to about 500 and 380 px, before wrapping another line.
 */
const NODE_DESCRIPTION_MAX_WIDTH: Readonly<Record<NodeSceneShape, number>> = {
	bucket: 220,
	circle: 260,
	cylinder: 264,
	diamond: 240,
	document: 264,
	ellipse: 260,
	pipe: 240,
	polygon: 264,
	rectangle: 264,
};

function descriptionUnits(width: number): number {
	return Math.floor((width * 100) / NODE_DESCRIPTION_FONT_SIZE);
}

/**
 * Wrap a description at whole words to its node's label width, or wider, up to
 * its shape's limit, when that keeps it to its shape's lines. It depends only on the
 * text and the shape, so layout and drawing wrap it alike.
 */
export function measureDescription(description: string, shape: NodeSceneShape): DescriptionMetrics {
	const labelUnits = shape === "diamond" ? MAX_DIAMOND_LABEL_LINE_UNITS : MAX_LABEL_LINE_UNITS;
	const base = descriptionUnits((labelUnits * NODE_LABEL_FONT_SIZE) / 100);
	const limit = descriptionUnits(NODE_DESCRIPTION_MAX_WIDTH[shape]);
	const lineCount = (text: string) => text.split("\n").length;
	let text = wrapTextToUnits(description, base);
	for (let units = base; lineCount(text) > descriptionLines(shape) && units < limit;) {
		units = Math.min(limit, units + DEFAULT_GLYPH_UNITS);
		text = wrapTextToUnits(description, units);
	}
	const lines = lineCount(text);
	return {
		text,
		lines,
		width: estimateTextWidth(text, NODE_DESCRIPTION_FONT_SIZE),
		height: Math.ceil(lines * NODE_DESCRIPTION_FONT_SIZE * NODE_DESCRIPTION_LINE_HEIGHT),
	};
}

/** Depth of the band on each side of a described node's centered label. */
function descriptionBand(description: DescriptionMetrics, icon: CanvasNodeIcon | undefined) {
	return Math.max(
		canvasNodeIconBand(icon),
		NODE_DESCRIPTION_GAP + description.height + NODE_DESCRIPTION_CLEARANCE,
	);
}

/**
 * Edge of the round markers state machines draw: an initial pseudostate's dot
 * and a final state's bullseye. Each carries exactly one transition, so it
 * keeps one port per side and never widens for more.
 */
const MARKER_SIZE: Readonly<Record<string, number>> = { initial: 20, final: 28 };

/** A state is a compact rounded box; an unlabeled choice is a small diamond. */
const STATE_MIN_WIDTH = 136;

const STATE_MIN_HEIGHT = 56;

const CHOICE_SIZE = 44;

/** An unlabeled choice stays a square diamond as it grows for its ports. */
export function squareChoice<T extends { width: number; height: number }>(
	shape: T,
	breadth: number,
): T {
	const edge = Math.max(shape.width, shape.height, breadth);
	return { ...shape, width: edge, height: edge };
}

export function markerSize(node: { readonly kind?: string | undefined }): number | undefined {
	return node.kind === undefined ? undefined : MARKER_SIZE[node.kind];
}

/** Nodes that branch on labeled outgoing edges: flowchart decisions and state-machine choices. */
export function branches(kind: string | undefined): boolean {
	return kind === "decision" || kind === "choice";
}

function shapeForNode(node: DiagramNode): NodeSceneShape {
	if (node.shape !== undefined) return COMPOSED_SHAPES[node.shape];
	const kind = node.kind?.toLowerCase();
	if (kind === "start" || kind === "end") {
		return "ellipse";
	}
	if (kind === "initial" || kind === "final") {
		return "circle";
	}
	if (branches(kind)) {
		return "diamond";
	}
	return "rectangle";
}

/** A colored node's stroke and its pale fill, so its label stays readable. */
function nodeColorStyle(
	node: GraphNode,
): Pick<NodeSceneElement, "fillColor" | "fillStyle" | "strokeColor"> {
	if (!node.color) return {};
	const { stroke, fill } = DIAGRAM_NODE_COLORS[node.color];
	return { strokeColor: stroke, fillColor: fill, fillStyle: "solid" };
}

export function createNodeShape(
	node: GraphNode,
	minimumWidth = MIN_NODE_WIDTH,
	lineUnits = MAX_LABEL_LINE_UNITS,
): NodeSceneElement {
	return { ...createUncoloredNodeShape(node, minimumWidth, lineUnits), ...nodeColorStyle(node) };
}

function createUncoloredNodeShape(
	node: GraphNode,
	minimumWidth: number,
	lineUnits: number,
): NodeSceneElement {
	const shape = shapeForNode(node);
	const marker = markerSize(node);
	if (marker !== undefined || (node.kind === "choice" && !node.label)) {
		const size = marker ?? CHOICE_SIZE;
		return {
			type: "node",
			id: `node:${node.id}`,
			nodeId: node.id,
			...(node.kind ? { kind: node.kind } : {}),
			shape,
			x: 0,
			y: 0,
			width: size,
			height: size,
			label: "",
		};
	}
	const labelUnits = shape === "diamond" ? MAX_DIAMOND_LABEL_LINE_UNITS : lineUnits;
	const labelMetrics = measureLabel(node.label, labelUnits);
	const icon = node.icon ? { slug: node.icon.slug, size: NODE_ICON_SIZE[shape] } : undefined;
	// A composed shape keeps its label's padding clear of the curves at its ends.
	const curve = isCanvasComposedShape(shape) ? CANVAS_SHAPE_CURVE[shape] : 0;
	const shapeWidthPad =
		shape === "diamond" ? 32 : shape === "ellipse" ? 20 : shape === "pipe" ? 4 * curve : 0;
	const shapeHeightPad =
		shape === "diamond"
			? 32
			: shape === "cylinder" || shape === "document" || shape === "bucket"
				? 3 * curve
				: 0;
	const [minWidth, minHeight] =
		node.kind === "state" ? [STATE_MIN_WIDTH, STATE_MIN_HEIGHT] : [minimumWidth, MIN_NODE_HEIGHT];
	if (node.description) {
		// Every described node fits Excalidraw's edit-time text box: its centered
		// label between two bands, the lower holding the description.
		const description = measureDescription(node.description, shape);
		// The node is as wide as its description, so its label wraps no narrower.
		const label = measureLabel(
			node.label,
			Math.max(labelUnits, Math.floor((description.width * 100) / NODE_LABEL_FONT_SIZE)),
		);
		const textWidth = Math.max(label.textWidth, description.width);
		const boundText = boundTextContainerSize(
			shape,
			textWidth,
			label.textHeight + 2 * descriptionBand(description, icon),
		);
		return {
			type: "node",
			id: `node:${node.id}`,
			nodeId: node.id,
			...(node.kind ? { kind: node.kind } : {}),
			...(icon ? { icon } : {}),
			shape,
			x: 0,
			y: 0,
			width: Math.max(
				minWidth,
				Math.ceil(textWidth + NODE_LABEL_HORIZONTAL_PADDING) + shapeWidthPad,
				boundText.width,
			),
			height: Math.max(minHeight, boundText.height),
			label: label.text,
		};
	}
	// Logo nodes, diamonds and composed shapes must fit Excalidraw's edit-time
	// text box; other plain nodes keep their padded label box, which already
	// contains it.
	const boundText =
		icon || shape === "diamond" || curve > 0
			? boundTextContainerSize(
					shape,
					labelMetrics.textWidth,
					labelMetrics.textHeight + canvasNodeIconBand(icon),
				)
			: { height: 0, width: 0 };

	return {
		type: "node",
		id: `node:${node.id}`,
		nodeId: node.id,
		...(node.kind ? { kind: node.kind } : {}),
		...(icon ? { icon } : {}),
		shape,
		x: 0,
		y: 0,
		width: Math.max(minWidth, labelMetrics.width + shapeWidthPad, boundText.width),
		height: icon
			? Math.max(minHeight, boundText.height)
			: Math.max(minHeight, labelMetrics.height + shapeHeightPad, boundText.height),
		label: labelMetrics.text,
	};
}

/**
 * Free labels measured, by wrap width and text: the router asks for a branch
 * label's size on every stub it tries, and wrapping segments the text anew.
 */
const freeLabelSizes = new Map<string, Readonly<{ width: number; height: number }>>();

/** Labels measured before the cache starts over, so a long-lived worker stays small. */
const FREE_LABEL_SIZES = 4_096;

export function freeLabelSize(
	label: string,
	maxWidth: number,
): Readonly<{ width: number; height: number }> {
	const key = `${maxWidth}\u0000${label}`;
	let size = freeLabelSizes.get(key);
	if (!size) {
		const text = wrapTextToWidth(label, maxWidth, 13);
		size = {
			width: wrappedLabelWidth(text, 13, maxWidth),
			height: Math.ceil(text.split("\n").length * 13 * 1.35),
		};
		if (freeLabelSizes.size >= FREE_LABEL_SIZES) freeLabelSizes.clear();
		freeLabelSizes.set(key, size);
	}
	return size;
}

/** Decision branch labels wrap narrow to stay compact beside their vertex. */
export function branchLabelMaxWidth(fromDecision: boolean | undefined): number {
	return fromDecision ? 80 : 160;
}

export function branchLabelMetrics(
	label: string,
	fromDecision = false,
): { width: number; height: number } {
	return freeLabelSize(label, branchLabelMaxWidth(fromDecision));
}
