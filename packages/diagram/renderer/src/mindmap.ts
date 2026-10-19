import {
	boundLabelWidth,
	CANVAS_SPEC_VERSION,
	canvasBoundTextBox,
	clearanceBelow,
	cubicConnectorPoints,
	type EdgeBox,
	estimateTextWidth,
	type MindmapDiagram,
	validateMindmapDiagram,
	wrapTextToWidth,
} from "@sketchi/diagram-core";

import { CHART_SERIES_COLORS } from "./chart.js";
import type {
	ArrowSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	ScenePoint,
	TextSceneElement,
} from "./scene.js";

/**
 * Label size, padding and stroke by depth: the central topic, the main
 * branches, then every topic below them.
 */
const LEVELS = [
	{ fontSize: 20, textWidth: 160, padX: 0, padY: 0, strokeWidth: 2 },
	{ fontSize: 16, textWidth: 180, padX: 16, padY: 11, strokeWidth: 2 },
	{ fontSize: 14, textWidth: 150, padX: 12, padY: 9, strokeWidth: 1 },
] as const;
const LINE_HEIGHT = 1.35;
/** Room around the central topic's label inside its ellipse. */
const ROOT_INSET = { x: 18, y: 10 };
/** Horizontal room for a curve from the central topic, and between deeper levels. */
const ROOT_GAP = 72;
const CHILD_GAP = 44;
/** A tall fan of curves gets this share of its height as extra run, up to FAN_RUN. */
const FAN_SLOPE = 0.08;
const FAN_RUN = 40;
/** Vertical clearance between main branches, between subtrees below them, and between leaves. */
const BRANCH_MARGIN = 28;
const SUBTREE_MARGIN = 14;
const SIBLING_MARGIN = 8;
/** Boxes this close side by side still count as stacked, so diagonal neighbors keep clear too. */
const SIDE_SLACK = 8;
/** A folded topic lists its children below itself: curves leave its bottom edge this far in. */
const FOLD_PORT = 20;
const FOLD_RUN = 28;
const FOLD_GAP = 12;
const PADDING = 40;
/** Hosted PNGs frame the drawing this tightly, so aspect is measured there. */
const EXPORT_PADDING = 20;
/** A map wider than this spreads its main branches apart vertically, up to MAX_SPREAD each. */
const TARGET_ASPECT = 1.8;
const MAX_SPREAD = 120;
/** A map still wider than this folds its deepest topics into lists below them. */
const MAX_ASPECT = 2.4;
/**
 * Main branches sit on an arc: the farthest from the center comes this share
 * of its distance closer, or of ROOT_GAP while level with the central topic.
 */
const ARC_PULL = 0.6;
/** Share of a curve's run its control points reach along the run. */
const CURVE_REACH = 0.5;
/** A curve from the central topic heads straight for its branch for this share of the way. */
const ROOT_REACH = 0.4;

/** A topic and its measured label, children in authored order. */
interface Topic {
	readonly id: string;
	readonly depth: number;
	readonly text: string;
	readonly fontSize: number;
	readonly width: number;
	readonly height: number;
	readonly children: readonly Topic[];
}

type Box = EdgeBox;

/** Where a topic sits in its block: its inner edge (toward the center) and its center line. */
interface Place {
	readonly x: number;
	readonly y: number;
}

/**
 * A subtree laid out growing outward (positive x), its topic's inner edge at
 * x 0 and its center line at y 0. Boxes hold every node and every fan of
 * curves from a parent to its children, so packing blocks apart keeps curves
 * clear too.
 */
interface Block {
	readonly boxes: readonly Box[];
	readonly places: ReadonlyMap<string, Place>;
	/** Topics that list their children below themselves. */
	readonly folded: ReadonlySet<string>;
	readonly top: number;
	readonly bottom: number;
	readonly outer: number;
}

/** A main branch's block placed on one side of the center. */
interface Band {
	readonly block: Block;
	/** +1 grows right of the center, -1 left. */
	readonly side: 1 | -1;
	/** Center line of the main topic. */
	readonly y: number;
	/** Distance from the center to the main topic's inner edge. */
	readonly inner: number;
}

/** A topic's box with its center at the origin, before the scene is framed. */
interface PlacedTopic {
	readonly topic: Topic;
	readonly parent: PlacedTopic | undefined;
	/** Index of its main branch; -1 for the central topic. */
	readonly branch: number;
	readonly side: 1 | -1;
	/** Its parent lists it below itself rather than beside. */
	readonly folded: boolean;
	readonly x: number;
	readonly y: number;
}

function level(depth: number) {
	return LEVELS[Math.min(depth, LEVELS.length - 1)]!;
}

/** Wrap to the narrowest width that keeps the line count, so lines balance. */
function balancedWrap(text: string, maxWidth: number, fontSize: number): string {
	const lines = (value: string) => value.split("\n").length;
	const wrapped = wrapTextToWidth(text, maxWidth, fontSize);
	if (lines(wrapped) === 1) return wrapped;
	let low = fontSize;
	let high = maxWidth;
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		if (lines(wrapTextToWidth(text, middle, fontSize)) <= lines(wrapped)) high = middle;
		else low = middle;
	}
	return wrapTextToWidth(text, high, fontSize);
}

/** The central topic is an ellipse whose inscribed text box, as Excalidraw computes it, holds the label. */
function rootSize(textWidth: number, textHeight: number): { width: number; height: number } {
	let width = Math.ceil((textWidth + 2 * ROOT_INSET.x) * Math.SQRT2);
	let height = Math.ceil((textHeight + 2 * ROOT_INSET.y) * Math.SQRT2);
	while (canvasBoundTextBox({ shape: "ellipse", width, height }).width < textWidth + ROOT_INSET.x)
		width += 1;
	while (canvasBoundTextBox({ shape: "ellipse", width, height }).height < textHeight + ROOT_INSET.y)
		height += 1;
	return { width, height };
}

function measureTopics(diagram: MindmapDiagram): Topic {
	const children = new Map<string, { id: string; index: number }[]>();
	for (const edge of diagram.edges) {
		const list = children.get(edge.source) ?? [];
		list.push({ id: edge.target, index: edge.metadata.siblingIndex });
		children.set(edge.source, list);
	}
	const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
	const build = (id: string, depth: number): Topic => {
		const node = byId.get(id)!;
		const { fontSize, textWidth, padX, padY } = level(depth);
		const text = balancedWrap(node.label, textWidth, fontSize);
		const width = Math.ceil(
			Math.max(estimateTextWidth(text, fontSize), boundLabelWidth(text, fontSize, textWidth)),
		);
		const height = Math.ceil(text.split("\n").length * fontSize * LINE_HEIGHT);
		const size =
			depth === 0
				? rootSize(width, height)
				: { width: width + 2 * padX, height: height + 2 * padY };
		return {
			id,
			depth,
			text,
			fontSize,
			...size,
			children: (children.get(id) ?? [])
				.toSorted((a, b) => a.index - b.index)
				.map((child) => build(child.id, depth + 1)),
		};
	};
	const root = diagram.nodes.find((node) => node.kind === "root")!;
	return build(root.id, 0);
}

function shifted(box: Box, dx: number, dy: number): Box {
	return { x0: box.x0 + dx, x1: box.x1 + dx, y0: box.y0 + dy, y1: box.y1 + dy };
}

function finish(
	boxes: readonly Box[],
	places: ReadonlyMap<string, Place>,
	folded: ReadonlySet<string>,
): Block {
	return {
		boxes,
		places,
		folded,
		top: Math.min(...boxes.map((box) => box.y0)),
		bottom: Math.max(...boxes.map((box) => box.y1)),
		outer: Math.max(...boxes.map((box) => box.x1)),
	};
}

/**
 * Lay a subtree out growing outward. Children stack in order, each packed as
 * close under the one before as their shapes allow: beside their parent, one
 * curve's run beyond it and with the parent centered on them, or, for a topic
 * at `foldDepth` or deeper, listed below it.
 */
function layoutBlock(topic: Topic, foldDepth: number): Block {
	const node: Box = { x0: 0, x1: topic.width, y0: -topic.height / 2, y1: topic.height / 2 };
	if (topic.children.length === 0)
		return finish([node], new Map([[topic.id, { x: 0, y: 0 }]]), new Set());
	const fold = topic.depth >= foldDepth;
	const margin = topic.depth <= 1 ? SUBTREE_MARGIN : SIBLING_MARGIN;
	const blocks = topic.children.map((child) => layoutBlock(child, foldDepth));
	// Stack the children, as if they started at x 0, below the parent when folded.
	const childX = fold ? FOLD_PORT + FOLD_RUN : 0;
	const placed: Box[] = fold ? [node] : [];
	const offsets: number[] = [];
	for (const block of blocks) {
		const moved = block.boxes.map((box) => shifted(box, childX, 0));
		const dy =
			offsets.length > 0
				? clearanceBelow(placed, moved, margin, SIDE_SLACK)
				: fold
					? Math.max(
							clearanceBelow(placed, moved, FOLD_GAP, SIDE_SLACK),
							node.y1 + FOLD_GAP - block.top,
						)
					: 0;
		offsets.push(dy);
		placed.push(...moved.map((box) => shifted(box, 0, dy)));
	}
	const first = offsets[0]!;
	const last = offsets.at(-1)!;
	const folded = new Set(blocks.flatMap((block) => [...block.folded]));
	if (fold) folded.add(topic.id);
	// Beside its parent, a fan of curves runs farther the taller it is.
	const run = fold ? 0 : topic.width + CHILD_GAP + Math.min(FAN_RUN, FAN_SLOPE * (last - first));
	const middle = fold ? 0 : (first + last) / 2;
	const places = new Map<string, Place>([[topic.id, { x: 0, y: 0 }]]);
	blocks.forEach((block, index) => {
		for (const [id, place] of block.places)
			places.set(id, { x: place.x + childX + run, y: place.y + offsets[index]! - middle });
	});
	const fan: Box = fold
		? { x0: FOLD_PORT, x1: childX, y0: node.y1, y1: last }
		: { x0: topic.width, x1: run, y0: first - middle, y1: last - middle };
	const children = (fold ? placed.slice(1) : placed).map((box) => shifted(box, run, -middle));
	return finish([node, fan, ...children], places, folded);
}

/** Vertical gap between two neighboring main branches; lone topics sit closer. */
function bandGap(above: Block, below: Block): number {
	return above.places.size === 1 && below.places.size === 1 ? SUBTREE_MARGIN : BRANCH_MARGIN;
}

function stackHeight(blocks: readonly Block[], spread = 0): number {
	return blocks.reduce(
		(sum, block, index) =>
			sum +
			(block.bottom - block.top) +
			(index === 0 ? 0 : bandGap(blocks[index - 1]!, block) + spread),
		0,
	);
}

/**
 * Split the main branches into a right and a left side whose stacks are as
 * close in height as possible, keeping the authored order clockwise: the first
 * branches down the right from the top, the rest up the left.
 */
function splitSides(blocks: readonly Block[]): number {
	let best = blocks.length;
	let bestDifference = Infinity;
	const preferred = Math.ceil(blocks.length / 2);
	for (let split = 1; split <= blocks.length; split += 1) {
		const difference = Math.abs(
			stackHeight(blocks.slice(0, split)) - stackHeight(blocks.slice(split)),
		);
		if (
			difference < bestDifference - 1e-6 ||
			(Math.abs(difference - bestDifference) <= 1e-6 &&
				Math.abs(split - preferred) < Math.abs(best - preferred))
		) {
			best = split;
			bestDifference = difference;
		}
	}
	return best;
}

/** Center lines of one side's blocks stacked top to bottom around `middle`. */
function stackSide(blocks: readonly Block[], spread: number, middle: number): number[] {
	const centers: number[] = [];
	let top = middle - stackHeight(blocks, spread) / 2;
	blocks.forEach((block, index) => {
		if (index > 0) top += bandGap(blocks[index - 1]!, block) + spread;
		centers.push(top - block.top);
		top += block.bottom - block.top;
	});
	return centers;
}

/**
 * How far to offset a lone right branch up and a lone left one down, so the
 * drawing grows to `wanted` tall: no farther than until each clears the
 * central topic, past which only empty space grows. A missing side is
 * `undefined`.
 */
function staggerFor(
	right: number | undefined,
	left: number | undefined,
	wanted: number,
	center: number,
): number {
	const height = (offset: number) => {
		const spans = [
			[-center / 2, center / 2],
			...(right === undefined ? [] : [[-offset - right / 2, -offset + right / 2]]),
			...(left === undefined ? [] : [[offset - left / 2, offset + left / 2]]),
		] as const;
		return Math.max(...spans.map(([, bottom]) => bottom)) - Math.min(...spans.map(([top]) => top));
	};
	let low = 0;
	let high = (Math.max(right ?? 0, left ?? 0) + center) / 2 + BRANCH_MARGIN;
	if (height(high) <= wanted) return high;
	if (height(low) >= wanted) return 0;
	for (let step = 0; step < 24; step += 1) {
		const middle = (low + high) / 2;
		if (height(middle) < wanted) low = middle;
		else high = middle;
	}
	return high;
}

/**
 * Place the main branches around the central topic: balanced sides in
 * clockwise order; spread apart, or staggered when each side holds one, while
 * the map reads wider than TARGET_ASPECT; and pulled toward the center the
 * farther they sit above or below it, so the map reads round.
 */
function arrangeBands(root: Topic, foldDepth: number, mirrored: boolean): Band[] {
	const blocks = root.children.map((topic) => layoutBlock(topic, foldDepth));
	const split = splitSides(blocks);
	const indexes = blocks.map((_, index) => index);
	const rightIndexes = indexes.slice(0, split);
	const leftIndexes = indexes.slice(split).toReversed();
	const right = rightIndexes.map((index) => blocks[index]!);
	const left = leftIndexes.map((index) => blocks[index]!);
	const halfWidth = root.width / 2;
	const halfHeight = root.height / 2;
	const base = halfWidth + ROOT_GAP;
	const extent = (side: readonly Block[]) =>
		Math.max(halfWidth, ...side.map((block) => base + block.outer));
	const width = extent(right) + extent(left);
	const natural = Math.max(root.height, stackHeight(right), stackHeight(left));
	const wanted = (width + 2 * EXPORT_PADDING) / TARGET_ASPECT - 2 * EXPORT_PADDING;
	const short = Math.max(0, wanted - natural);
	const readable = (width + 2 * EXPORT_PADDING) / MAX_ASPECT - 2 * EXPORT_PADDING;
	// With at most one branch a side there is nothing to spread. While the map would read
	// wider than MAX_ASPECT, offset them up and down instead.
	const span = (side: readonly Block[]) => (side[0] ? side[0].bottom - side[0].top : undefined);
	const stagger =
		right.length <= 1 && left.length <= 1
			? staggerFor(span(right), span(left), readable, root.height)
			: 0;
	// Spread toward TARGET_ASPECT up to MAX_SPREAD a gap, and as far as MAX_ASPECT needs.
	const placeSide = (side: readonly Block[], sign: 1 | -1, middle: number): Band[] => {
		const gap = (height: number) => Math.max(0, height - stackHeight(side)) / (side.length - 1);
		const spread = side.length > 1 ? Math.max(Math.min(MAX_SPREAD, gap(wanted)), gap(readable)) : 0;
		const centers = stackSide(side, short > 0 ? spread : 0, middle);
		return side.map((block, index) => ({
			block,
			side: (mirrored ? -sign : sign) as 1 | -1,
			y: centers[index]!,
			inner: base,
		}));
	};
	// By branch, in authored order.
	const bands: Band[] = [];
	placeSide(right, 1, -stagger).forEach((band, index) => (bands[rightIndexes[index]!] = band));
	placeSide(left, -1, stagger).forEach((band, index) => (bands[leftIndexes[index]!] = band));
	const farthest = Math.max(...bands.map((band) => Math.abs(band.y)));
	return bands.map((band) => {
		if (farthest === 0) return band;
		const arc = ARC_PULL * (band.y / farthest) ** 2;
		// A band level with the central topic keeps clear of it; one above or below it may come
		// in over it.
		const beside =
			band.y + band.block.bottom > -halfHeight - BRANCH_MARGIN &&
			band.y + band.block.top < halfHeight + BRANCH_MARGIN;
		return {
			...band,
			inner: beside
				? Math.max(base - arc * ROOT_GAP, halfWidth + CHILD_GAP)
				: Math.max(base - arc * base, CHILD_GAP),
		};
	});
}

function placeTopics(root: Topic, bands: readonly Band[]): PlacedTopic[] {
	const center: PlacedTopic = {
		topic: root,
		parent: undefined,
		branch: -1,
		side: 1,
		folded: false,
		x: -root.width / 2,
		y: -root.height / 2,
	};
	const placed: PlacedTopic[] = [center];
	const visit = (topic: Topic, parent: PlacedTopic, band: Band, branch: number) => {
		const place = band.block.places.get(topic.id)!;
		const inner = band.inner + place.x;
		const entry: PlacedTopic = {
			topic,
			parent,
			branch,
			side: band.side,
			folded: parent.branch !== -1 && band.block.folded.has(parent.topic.id),
			x: band.side === 1 ? inner : -inner - topic.width,
			y: band.y + place.y - topic.height / 2,
		};
		placed.push(entry);
		for (const child of topic.children) visit(child, entry, band, branch);
	};
	root.children.forEach((topic, branch) => visit(topic, center, bands[branch]!, branch));
	return placed;
}

/** The export's width over its height. */
function exportAspect(placed: readonly PlacedTopic[]): number {
	const xs = placed.flatMap((entry) => [entry.x, entry.x + entry.topic.width]);
	const ys = placed.flatMap((entry) => [entry.y, entry.y + entry.topic.height]);
	return (
		(Math.max(...xs) - Math.min(...xs) + 2 * EXPORT_PADDING) /
		(Math.max(...ys) - Math.min(...ys) + 2 * EXPORT_PADDING)
	);
}

function depthOf(topic: Topic): number {
	return Math.max(topic.depth, ...topic.children.map(depthOf));
}

/**
 * Lay the map out unfolded or, while it reads wider than MAX_ASPECT, with
 * topics from ever shallower depths folding their children into lists below
 * them; the least folding that reads keeps the map most like a mindmap.
 */
function layoutMindmap(root: Topic, mirrored: boolean): PlacedTopic[] {
	const place = (foldDepth: number) => placeTopics(root, arrangeBands(root, foldDepth, mirrored));
	let best = place(Infinity);
	for (let foldDepth = depthOf(root) - 1; foldDepth >= 1; foldDepth -= 1) {
		if (exportAspect(best) <= MAX_ASPECT + 0.01) break;
		const folded = place(foldDepth);
		if (exportAspect(folded) < exportAspect(best)) best = folded;
	}
	return best;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Sample a curve; a level run stays one straight segment. */
function curvePoints(
	controls: readonly [ScenePoint, ScenePoint, ScenePoint, ScenePoint],
): [ScenePoint, ...ScenePoint[]] {
	const [start, , , end] = controls;
	if (Math.abs(end.y - start.y) < 0.5)
		return [
			{ x: round(start.x), y: round(start.y) },
			{ x: round(end.x), y: round(end.y) },
		];
	return cubicConnectorPoints(controls);
}

function innerEdge(shape: NodeSceneElement, side: 1 | -1): ScenePoint {
	return { x: side === 1 ? shape.x : shape.x + shape.width, y: shape.y + shape.height / 2 };
}

/**
 * Where each main branch's curve leaves the central topic's ellipse, as an
 * angle around it: halfway between where the line to the branch crosses the
 * ellipse and an even spacing of that side's curves, so many branches leave
 * apart instead of bunching where the lines converge.
 */
function rootPorts(
	center: NodeSceneElement,
	branches: readonly { readonly shape: NodeSceneElement; readonly side: 1 | -1 }[],
): Map<string, number> {
	const a = center.width / 2;
	const b = center.height / 2;
	const ports = new Map<string, number>();
	for (const side of [1, -1] as const) {
		const rays = branches
			.filter((branch) => branch.side === side)
			.map((branch) => {
				const end = innerEdge(branch.shape, side);
				// Angles run from the top of the side to its bottom, on either side.
				const angle = Math.atan2((end.y - center.y - b) / b, (side * (end.x - center.x - a)) / a);
				return { id: branch.shape.nodeId, angle };
			})
			.toSorted((left, right) => left.angle - right.angle);
		const first = rays[0]?.angle ?? 0;
		const last = rays.at(-1)?.angle ?? 0;
		rays.forEach((ray, index) => {
			const even =
				rays.length === 1 ? ray.angle : first + ((last - first) * index) / (rays.length - 1);
			ports.set(ray.id, (ray.angle + even) / 2);
		});
	}
	return ports;
}

/**
 * The curve from a parent to a child: from the central topic's ellipse at
 * the child's port, heading for the child; from a folded parent's bottom
 * edge, down; otherwise from the parent's outer edge. Each arrives level at
 * the child's inner edge.
 */
function connector(
	child: NodeSceneElement,
	parent: NodeSceneElement,
	entry: PlacedTopic,
	port: number | undefined,
) {
	const side = entry.side;
	const end = innerEdge(child, side);
	if (port !== undefined) {
		const a = parent.width / 2;
		const b = parent.height / 2;
		const start = {
			x: parent.x + a + side * a * Math.cos(port),
			y: parent.y + b + b * Math.sin(port),
		};
		return curvePoints([
			start,
			{
				x: start.x + ROOT_REACH * (end.x - start.x),
				y: start.y + ROOT_REACH * (end.y - start.y),
			},
			{ x: end.x - side * CURVE_REACH * Math.abs(end.x - start.x), y: end.y },
			end,
		]);
	}
	if (entry.folded) {
		const start = {
			x: side === 1 ? parent.x + FOLD_PORT : parent.x + parent.width - FOLD_PORT,
			y: parent.y + parent.height,
		};
		return curvePoints([
			start,
			{ x: start.x, y: start.y + CURVE_REACH * (end.y - start.y) },
			{ x: end.x - side * CURVE_REACH * Math.abs(end.x - start.x), y: end.y },
			end,
		]);
	}
	const start = {
		x: side === 1 ? parent.x + parent.width : parent.x,
		y: parent.y + parent.height / 2,
	};
	const reach = CURVE_REACH * Math.abs(end.x - start.x);
	return curvePoints([
		start,
		{ x: start.x + side * reach, y: start.y },
		{ x: end.x - side * reach, y: end.y },
		end,
	]);
}

/** A color `share` of the way from the background to `color`. */
function tint(color: string, background: string, share: number): string {
	const channel = (hex: string, offset: number) =>
		Number.parseInt(hex.slice(offset, offset + 2), 16);
	return `#${[1, 3, 5]
		.map((offset) =>
			Math.round(
				channel(background, offset) +
					(channel(color, offset) - channel(background, offset)) * share,
			)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

/**
 * Render a mindmap around its central topic: main branches balanced on both
 * sides in clockwise order, each subtree in its own color, joined by curves,
 * with label size stepping down from the center.
 */
export function renderMindmapDiagram(input: MindmapDiagram): RenderedDiagramScene {
	const diagram = validateMindmapDiagram(input);
	const root = measureTopics(diagram);
	const placed = layoutMindmap(root, diagram.layout.direction === "RL");
	const dx = Math.round(PADDING - Math.min(...placed.map((entry) => entry.x)));
	const dy = Math.round(PADDING - Math.min(...placed.map((entry) => entry.y)));
	const accent = diagram.style.accentColor;
	const background = diagram.style.backgroundColor;
	const colorOf = (entry: PlacedTopic) =>
		entry.branch === -1 ? accent : CHART_SERIES_COLORS[entry.branch % CHART_SERIES_COLORS.length]!;
	// Each main branch moves as one group in Excalidraw.
	const groupsOf = (entry: PlacedTopic) =>
		entry.branch === -1 ? {} : { groupIds: [`branch:${root.children[entry.branch]!.id}`] };
	const nodes = placed.map((entry): NodeSceneElement => {
		const { topic } = entry;
		const share = [0.18, 0.16, 0.06][topic.depth];
		return {
			type: "node",
			id: `node:${topic.id}`,
			nodeId: topic.id,
			kind: topic.depth === 0 ? "root" : "topic",
			shape: topic.depth === 0 ? "ellipse" : "rectangle",
			x: Math.round(entry.x) + dx,
			y: Math.round(entry.y) + dy,
			width: topic.width,
			height: topic.height,
			label: topic.text,
			strokeColor: colorOf(entry),
			strokeWidth: level(topic.depth).strokeWidth,
			...(share === undefined
				? {}
				: { fillColor: tint(colorOf(entry), background, share), fillStyle: "solid" as const }),
			...groupsOf(entry),
		};
	});
	const labels = placed.map((entry, index): TextSceneElement => ({
		type: "text",
		id: `label:${entry.topic.id}`,
		containerId: nodes[index]!.id,
		x: nodes[index]!.x + entry.topic.width / 2,
		y: nodes[index]!.y + entry.topic.height / 2,
		text: entry.topic.text,
		fontSize: entry.topic.fontSize,
		maxWidth: Math.max(1, entry.topic.width - 24),
		...groupsOf(entry),
	}));
	const shapes = new Map(nodes.map((node) => [node.nodeId, node]));
	const ports = rootPorts(
		nodes[0]!,
		placed.flatMap((entry, index) =>
			entry.topic.depth === 1 ? [{ shape: nodes[index]!, side: entry.side }] : [],
		),
	);
	const edgeIds = new Map(diagram.edges.map((edge) => [edge.target, edge.id]));
	const arrows = placed.flatMap((entry, index): ArrowSceneElement[] => {
		if (!entry.parent) return [];
		const { topic } = entry;
		const edgeId = edgeIds.get(topic.id)!;
		const points = connector(
			nodes[index]!,
			shapes.get(entry.parent.topic.id)!,
			entry,
			ports.get(topic.id),
		);
		return [
			{
				type: "arrow",
				id: `edge:${edgeId}`,
				edgeId,
				sourceNodeId: entry.parent.topic.id,
				targetNodeId: topic.id,
				points,
				...(points.length > 2 ? { curved: true } : {}),
				endArrowhead: null,
				strokeColor: colorOf(entry),
				strokeWidth: topic.depth === 1 ? 4 : 2,
				// A curve from the center belongs to no branch, so moving a branch stretches it.
				...(entry.parent.branch === -1 ? {} : groupsOf(entry)),
			},
		];
	});
	const right = Math.max(...nodes.map((node) => node.x + node.width));
	const bottom = Math.max(...nodes.map((node) => node.y + node.height));
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: diagram.id,
		title: diagram.title,
		width: right + PADDING,
		height: bottom + PADDING,
		accentColor: accent,
		backgroundColor: background,
		elements: [...arrows, ...nodes, ...labels],
		layers: [],
		layouts: [],
		zOrder: [...arrows, ...nodes, ...labels].map((element) => element.id),
	};
}
