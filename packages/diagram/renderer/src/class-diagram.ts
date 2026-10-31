import {
	type AxisAlignedSegment,
	type CanvasArrowhead,
	type CanvasStrokeStyle,
	type ClassDiagram,
	type ClassNode,
	type ClassRelationship,
	type ClassRelationshipKind,
	classAttributeText,
	classKeywordLine,
	classMethodText,
	classNodeName,
	estimateTextWidth,
	hasClassEnds,
	type IntermediateDiagram,
	isClassGeneralization,
	routingQualityFindings,
	routingQualityScale,
	segmentsFromPoints,
} from "@sketchi/diagram-core";

import {
	CLASS_END_RUN,
	type ClassLayoutLink,
	type ClassPlacement,
	type ClassPlacementOptions,
	placeClasses,
} from "./class-layout.js";
import {
	arrowCrossings,
	type ArrowSceneElement,
	type NodeSceneElement,
	type RenderedDiagramScene,
	renderGraphDiagram,
	type SceneElement,
	type TextSceneElement,
} from "./scene.js";

/** The name compartment: one 16 px line for the name, another over it for a keyword. */
const NAME_FONT_SIZE = 16;
const NAME_LINE = 22;
const NAME_PADDING = 10;
/** Member rows: one line of 14 px text each, 22 units apart. */
const MEMBER_FONT_SIZE = 14;
const MEMBER_ROW = 22;
const COMPARTMENT_PADDING = 6;
/** An empty compartment still shows, as UML draws one. */
const EMPTY_COMPARTMENT = 14;
const CELL_PADDING = 12;
const MIN_BOX_WIDTH = 140;
/** Multiplicities, roles and relationship names. */
const LABEL_FONT_SIZE = 13;
const LABEL_HEIGHT = Math.ceil(LABEL_FONT_SIZE * 1.35);
/** A label stands this far beside its line, clear of the widest head (an open arrow's wings). */
const LABEL_OFFSET = 10;
/** Room kept between a label and every box, line and other label. */
const LABEL_CLEARANCE = 3;
/**
 * A label reads as its own line's only when every other line stands half again
 * as far off as its own, and at least this much further.
 */
const ATTRIBUTION_RATIO = 1.5;
const ATTRIBUTION_MARGIN = 8;
/**
 * A multiplicity or role reads as its own end's only when its middle stands
 * this near the end's tip and, by the rule above, the line's other tip
 * stands clearly further off.
 */
const END_LABEL_REACH = 110;
/** Past this, a layout's export reads poorly; a candidate pays for any excess. */
const READABLE_ASPECT = 2.5;
const NAME_FILL = "#efe6ec";
const KEYWORD_COLOR = "#6a4e5c";
const PADDING = 48;
/** The PNG export's padding per side, in place of the scene's. */
const EXPORT_PADDING = 20;
/**
 * An export longer than this for its breadth reads too wide or too tall: a
 * placement within it that routes no worse takes its place.
 */
const LONG_EXPORT = 2.4;
/**
 * A placement keeping room for labels that reads longer than that may still
 * take over, when it reads at most this much longer than the one it replaces.
 */
const LABEL_ROOM_STRETCH = 1.05;

/** Each kind's line: dashed or solid, and the heads at its `from` and `to` ends. */
const LINE_STYLES: Readonly<
	Record<
		ClassRelationshipKind,
		{
			readonly stroke: CanvasStrokeStyle;
			readonly from: CanvasArrowhead;
			readonly to: CanvasArrowhead;
		}
	>
> = {
	inheritance: { stroke: "solid", from: null, to: "triangle_outline" },
	realization: { stroke: "dashed", from: null, to: "triangle_outline" },
	composition: { stroke: "solid", from: "diamond", to: null },
	aggregation: { stroke: "solid", from: "diamond_outline", to: null },
	association: { stroke: "solid", from: null, to: null },
	dependency: { stroke: "dashed", from: null, to: "arrow" },
};

/** The heads a relationship draws: a navigable association, composition or aggregation adds an open arrow at `to`. */
export function classRelationshipHeads(
	relationship: Pick<ClassRelationship, "kind" | "navigable">,
): {
	readonly from: CanvasArrowhead;
	readonly to: CanvasArrowhead;
	readonly stroke: CanvasStrokeStyle;
} {
	const style = LINE_STYLES[relationship.kind];
	return relationship.navigable && hasClassEnds(relationship.kind)
		? { ...style, to: "arrow" }
		: style;
}

/** A class box's size and the text of its compartments. */
interface Box {
	readonly node: ClassNode;
	readonly name: string;
	readonly heading: string;
	readonly width: number;
	readonly height: number;
	readonly band: number;
	readonly attributesHeight: number;
	readonly methodsHeight: number;
	readonly attributes: readonly string[];
	readonly methods: readonly string[];
}

const compartment = (lines: readonly string[]) =>
	lines.length > 0 ? 2 * COMPARTMENT_PADDING + lines.length * MEMBER_ROW : EMPTY_COMPARTMENT;

function boxOf(node: ClassNode): Box {
	const name = classNodeName(node).trim();
	const keyword = classKeywordLine(node);
	const attributes = node.attributes.map(classAttributeText);
	const methods = node.methods.map(classMethodText);
	const widest = Math.max(
		estimateTextWidth(name, NAME_FONT_SIZE),
		keyword ? estimateTextWidth(keyword, NAME_FONT_SIZE) : 0,
		...[...attributes, ...methods].map((line) => estimateTextWidth(line, MEMBER_FONT_SIZE)),
	);
	const band = (keyword ? 2 : 1) * NAME_LINE + 2 * NAME_PADDING;
	const [attributesHeight, methodsHeight] = [compartment(attributes), compartment(methods)];
	return {
		node,
		name,
		heading: keyword ? `${keyword}\n${name}` : name,
		width: Math.max(MIN_BOX_WIDTH, Math.ceil(widest) + 2 * CELL_PADDING),
		height: band + attributesHeight + methodsHeight,
		band,
		attributesHeight,
		methodsHeight,
		attributes,
		methods,
	};
}

/** The labels each end of a relationship carries: its multiplicity and its role. */
function endLabels(relationship: ClassRelationship, end: "from" | "to"): string[] {
	return [
		relationship[end === "from" ? "fromMultiplicity" : "toMultiplicity"],
		relationship[end === "from" ? "fromRole" : "toRole"],
	].flatMap((text) => (text ? [text.trim()] : []));
}

const labelWidth = (text: string) => Math.ceil(estimateTextWidth(text, LABEL_FONT_SIZE)) + 2;

/** A label broken at spaces into `lines` lines, the widest as narrow as it can be, never mid-word. */
function wrapLabel(text: string, lines: number): string {
	const words = text.split(/\s+/u);
	if (lines <= 1 || words.length < lines) return text;
	const width = (from: number, to: number) =>
		estimateTextWidth(words.slice(from, to).join(" "), LABEL_FONT_SIZE);
	// The narrowest widest line for the words from `from` on, over `count` lines.
	const memo = new Map<string, { readonly widest: number; readonly breaks: readonly number[] }>();
	const best = (from: number, count: number): { widest: number; breaks: readonly number[] } => {
		if (count === 1) return { widest: width(from, words.length), breaks: [] };
		const key = `${from}:${count}`;
		const known = memo.get(key);
		if (known) return known;
		let choice = { widest: Infinity, breaks: [] as readonly number[] };
		for (let to = from + 1; to <= words.length - count + 1; to += 1) {
			const rest = best(to, count - 1);
			const widest = Math.max(width(from, to), rest.widest);
			if (widest < choice.widest) choice = { widest, breaks: [to, ...rest.breaks] };
		}
		memo.set(key, choice);
		return choice;
	};
	const breaks = [0, ...best(0, lines).breaks, words.length];
	return breaks
		.slice(1)
		.map((to, index) => words.slice(breaks[index], to).join(" "))
		.join("\n");
}

/** Node ids of the room held for labels while routing; never drawn. */
const LABEL_ROOM_PREFIX = "label-room:";

/**
 * Room beside each end of a line between neighbors in a row that carries a
 * multiplicity or role: a band above and below the line along its labels'
 * width, so no other line routes through where they will stand.
 */
function labelRooms(
	diagram: ClassDiagram,
	placement: ClassPlacement,
): Map<string, { x: number; y: number; width: number; height: number }> {
	const rooms = new Map<string, { x: number; y: number; width: number; height: number }>();
	for (const relationship of diagram.relationships) {
		for (const end of ["from", "to"] as const) {
			const anchor = placement.anchors.get(
				`${relationship.id}:${end === "from" ? "source" : "target"}`,
			);
			const box = placement.boxes.get(relationship[end].trim());
			const labels = endLabels(relationship, end);
			if (!anchor || !box || labels.length === 0) continue;
			if (anchor.side !== "left" && anchor.side !== "right") continue;
			const width = Math.max(...labels.map(labelWidth)) + 8;
			const y = box.y + box.height / 2 + anchor.offset;
			const x = anchor.side === "right" ? box.x + box.width + 2 : box.x - 2 - width;
			for (const [band, top] of [
				["above", y - LABEL_OFFSET + 4 - LABEL_HEIGHT],
				["below", y + LABEL_OFFSET - 4],
			] as const)
				rooms.set(`${LABEL_ROOM_PREFIX}${relationship.id}:${end}:${band}`, {
					x,
					y: top,
					width,
					height: LABEL_HEIGHT,
				});
		}
	}
	return rooms;
}

/** Route one placement's relationships between their pinned ends. */
function routedScene(
	diagram: ClassDiagram,
	boxes: ReadonlyMap<string, Box>,
	placement: ClassPlacement,
): RenderedDiagramScene {
	const rooms = labelRooms(diagram, placement);
	const graph = {
		id: diagram.id,
		title: diagram.title,
		type: "flowchart",
		nodes: [
			...diagram.classes.map((node) => ({
				id: node.id,
				label: boxes.get(node.id)!.name,
				kind: "class",
				metadata: {},
			})),
			...[...rooms.keys()].map((id) => ({ id, label: "·", kind: "class", metadata: {} })),
		],
		// Lines between neighboring rows route first, so a line spanning rows sees them and
		// keeps to its own corridor instead of cutting across them through another gap.
		edges: diagram.relationships
			.map((relationship) => ({
				id: relationship.id,
				source: relationship.from.trim(),
				target: relationship.to.trim(),
				metadata: {},
			}))
			.map((edge, index) => ({
				edge,
				index,
				span: Math.abs(
					(placement.rows.get(edge.source) ?? 0) - (placement.rows.get(edge.target) ?? 0),
				),
			}))
			.sort((a, b) => Math.min(a.span, 2) - Math.min(b.span, 2) || a.index - b.index)
			.map(({ edge }) => edge),
		layout: { direction: "TB", edgeRouting: "orthogonal" },
		style: diagram.style,
		metadata: {},
	} satisfies IntermediateDiagram;
	return renderGraphDiagram(graph, {
		placement: new Map([...placement.boxes, ...rooms]),
		anchors: placement.anchors,
		endRun: CLASS_END_RUN,
	});
}

/**
 * Placements to try, each routed in full: wholes above their parts, the rows
 * that ignore it, the same aiming nearer square, and one that keeps related
 * classes side by side. Larger models try the first two.
 */
const PLACEMENTS: readonly ClassPlacementOptions[] = [
	{ wholeBelow: 1.5 },
	{},
	{ aspect: 1.1 },
	{ between: 1 },
];
/**
 * Tried only while the best placement's export reads too long: whole
 * hierarchies may step down a row, so one stands beside another's subclasses
 * instead of beside it.
 */
const SQUARER: ClassPlacementOptions = { aspect: 1.1, hierarchies: true };
const LARGE_MODEL = 20;
const PLACEMENT_MARGIN = 0.75;

/** What a routed placement draws that trips a reader. */
interface RoutedCounts {
	readonly crossings: number;
	/** Reader-scale findings at the scene's export size. */
	readonly findings: number;
	/** How far lines run past their way between ends, summed (detour). */
	readonly detours: number;
	readonly hugging: number;
}

function routedCounts(scene: RenderedDiagramScene): RoutedCounts {
	const arrows = scene.elements.filter((e): e is ArrowSceneElement => e.type === "arrow");
	return {
		crossings: arrowCrossings(arrows),
		findings: routingQualityFindings(
			arrows.map((arrow) => ({
				id: arrow.id,
				points: arrow.points,
				sourceId: arrow.sourceNodeId,
				targetId: arrow.targetNodeId,
			})),
			routingQualityScale({ width: scene.width, height: scene.height }),
		).length,
		detours: arrows.reduce((sum, arrow) => sum + detour(arrow), 0),
		hugging: huggingRuns(arrows),
	};
}

/** Crossings plus reader-scale findings at the scene's export size, any too-long side, and detours. */
function routedCost(scene: RenderedDiagramScene, counts: RoutedCounts): number {
	const aspect = Math.max(scene.width / scene.height, scene.height / scene.width);
	return (
		counts.crossings +
		counts.findings +
		(aspect > READABLE_ASPECT ? 4 * (aspect - READABLE_ASPECT) : 0) +
		counts.detours +
		HUGGING * counts.hugging
	);
}

/** Width over height, either way up, of the scene as the PNG export pads it. */
function exportAspect(scene: RenderedDiagramScene): number {
	const [width, height] = [scene.width, scene.height].map(
		(side) => side - 2 * PADDING + 2 * EXPORT_PADDING,
	) as [number, number];
	return Math.max(width / height, height / width);
}

/** Two lines running side by side this close read as one. */
const HUGGING_CLEARANCE = 10;
/** A pair that hugs costs more than a crossing: a reader cannot follow either line. */
const HUGGING = 3;

/** Pairs of runs of different lines, parallel, overlapping and nearer than the clearance. */
function huggingRuns(arrows: readonly ArrowSceneElement[]): number {
	const runs = arrows.flatMap((arrow) =>
		segmentsFromPoints(arrow.points).map((segment) => ({ arrow: arrow.id, segment })),
	);
	let pairs = 0;
	for (const [index, left] of runs.entries())
		for (const right of runs.slice(index + 1))
			if (
				right.arrow !== left.arrow &&
				right.segment.orientation === left.segment.orientation &&
				Math.abs(right.segment.staticCoordinate - left.segment.staticCoordinate) <
					HUGGING_CLEARANCE &&
				Math.min(right.segment.max, left.segment.max) >
					Math.max(right.segment.min, left.segment.min)
			)
				pairs += 1;
	return pairs;
}

/** How much longer than the way between its ends a line runs, past a little slack. */
function detour(arrow: ArrowSceneElement): number {
	const [start, end] = [arrow.points[0], arrow.points.at(-1)!];
	let length = 0;
	for (const [index, point] of arrow.points.slice(1).entries())
		length +=
			Math.abs(point.x - arrow.points[index]!.x) + Math.abs(point.y - arrow.points[index]!.y);
	const direct = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
	return Math.max(0, length / (direct + 2 * CLASS_END_RUN + 200) - 1);
}

/** A routed scene's class boxes, without the room it held for labels. */
function classBoxes(scene: RenderedDiagramScene): NodeSceneElement[] {
	return scene.elements.filter(
		(element): element is NodeSceneElement =>
			element.type === "node" && !element.nodeId.startsWith(LABEL_ROOM_PREFIX),
	);
}

/** Route each distinct candidate placement, keep the one that reads best, and place its labels. */
function bestScene(
	diagram: ClassDiagram,
	boxes: ReadonlyMap<string, Box>,
): { readonly scene: RenderedDiagramScene; readonly labels: readonly TextSceneElement[] } {
	const links: ClassLayoutLink[] = diagram.relationships.map((relationship) => ({
		id: relationship.id,
		from: relationship.from.trim(),
		to: relationship.to.trim(),
		generalization: isClassGeneralization(relationship.kind),
		whole: relationship.kind === "composition" || relationship.kind === "aggregation",
		fromLabel: Math.max(0, ...endLabels(relationship, "from").map(labelWidth)),
		toLabel: Math.max(0, ...endLabels(relationship, "to").map(labelWidth)),
		label: relationship.label ? labelWidth(relationship.label.trim()) : 0,
	}));
	const layoutBoxes = diagram.classes.map((node) => {
		const box = boxes.get(node.id)!;
		return {
			id: node.id,
			width: box.width,
			height: box.height,
			dividers: [box.band, box.band + box.attributesHeight],
		};
	});
	const options = diagram.classes.length > LARGE_MODEL ? PLACEMENTS.slice(0, 2) : PLACEMENTS;
	const tried = new Set<string>();
	type Routed = { cost: number; counts: RoutedCounts; scene: RenderedDiagramScene };
	let best: Routed | undefined;
	const long = ({ scene }: Routed) => exportAspect(scene) > LONG_EXPORT;
	const longSide = ({ scene }: Routed) => Math.max(scene.width, scene.height);
	// Where the best export reads too long, one within the aspect takes its place
	// when it draws no more of anything a reader trips on, and no longer a side, so
	// no text shrinks to fit.
	const squarer = (candidate: Routed, current: Routed) =>
		long(current) &&
		!long(candidate) &&
		longSide(candidate) <= longSide(current) &&
		(Object.keys(candidate.counts) as (keyof RoutedCounts)[]).every(
			(key) => candidate.counts[key] <= current.counts[key],
		);
	for (const option of [...options, SQUARER]) {
		if (option === SQUARER && (options !== PLACEMENTS || !long(best!))) break;
		const placement = placeClasses(layoutBoxes, links, option);
		const key = JSON.stringify([...placement.boxes, ...placement.anchors]);
		if (tried.has(key)) continue;
		tried.add(key);
		const scene = routedScene(diagram, boxes, placement);
		const counts = routedCounts(scene);
		const routed = { cost: routedCost(scene, counts), counts, scene };
		// Another placement must beat the default rows clearly, not by a fraction; the
		// squarer one only reading within the aspect.
		if (
			!best ||
			(option !== SQUARER && routed.cost < best.cost - PLACEMENT_MARGIN) ||
			squarer(routed, best)
		)
			best = routed;
		if (routed.cost === 0 && !long(best)) break;
	}
	// While a label stands clearly its own line's nowhere, the placements run again
	// keeping room for labels; one takes its place when it leaves fewer such labels,
	// draws no more crossings, detours or hugging runs, reads hardly longer, and draws
	// no more crossings and findings together than one more for each label it clears:
	// a label read as another line's misleads a reader more than a jog does.
	const labelled = (routed: Routed) => ({
		...routed,
		labels: placeLabels(
			diagram,
			routed.scene.elements.filter((e): e is ArrowSceneElement => e.type === "arrow"),
			classBoxes(routed.scene),
		),
	});
	let chosen = labelled(best!);
	for (const option of options) {
		if (chosen.labels.unclear === 0) break;
		const placement = placeClasses(layoutBoxes, links, { ...option, labelRoom: true });
		const key = JSON.stringify([...placement.boxes, ...placement.anchors]);
		if (tried.has(key)) continue;
		tried.add(key);
		const scene = routedScene(diagram, boxes, placement);
		const counts = routedCounts(scene);
		const routed = labelled({ cost: routedCost(scene, counts), counts, scene });
		const was = chosen.counts;
		if (
			routed.labels.unclear < chosen.labels.unclear &&
			(!long(routed) || exportAspect(scene) <= LABEL_ROOM_STRETCH * exportAspect(chosen.scene)) &&
			counts.crossings <= was.crossings &&
			counts.crossings + counts.findings <=
				was.crossings + was.findings + chosen.labels.unclear - routed.labels.unclear &&
			counts.detours <= was.detours &&
			counts.hugging <= was.hugging
		)
			chosen = routed;
	}
	return { scene: chosen.scene, labels: chosen.labels.texts };
}

/** A class's elements: its outline, its name band, its methods compartment and their texts. */
function boxElements(
	box: Box,
	at: NodeSceneElement,
	diagram: ClassDiagram,
): { readonly nodes: NodeSceneElement[]; readonly texts: TextSceneElement[] } {
	const { id } = box.node;
	const groupIds = [`class:${id}`];
	// The layout may grow a box past its text to give each line end its port.
	const [width, height] = [at.width, at.height];
	const shape = (
		suffix: string,
		kind: string,
		y: number,
		tall: number,
		fill?: string,
	): NodeSceneElement => ({
		type: "node",
		id: `node:${id}${suffix}`,
		nodeId: `${id}${suffix}`,
		kind,
		rendererRole: "class-box",
		shape: "rectangle",
		x: at.x,
		y,
		width,
		height: tall,
		label: box.name,
		...(fill ? { fillColor: fill, fillStyle: "solid" as const } : {}),
		groupIds,
	});
	const outline = shape("", "class", at.y, height, diagram.style.backgroundColor);
	const band = shape(":name", "class-name", at.y, box.band, NAME_FILL);
	const methodsTop = at.y + box.band + box.attributesHeight;
	const methods = shape(":methods", "class-methods", methodsTop, at.y + height - methodsTop);
	const texts: TextSceneElement[] = [
		{
			type: "text",
			id: `label:${id}:name`,
			containerId: band.id,
			x: at.x + width / 2,
			y: at.y + box.band / 2,
			text: box.heading,
			fontSize: NAME_FONT_SIZE,
			lineHeight: NAME_LINE / NAME_FONT_SIZE,
			maxWidth: width - 2 * CELL_PADDING,
			...(box.heading !== box.name ? { textColor: KEYWORD_COLOR } : {}),
			groupIds,
		},
	];
	// Converted text is centered on its point; each compartment's starts at its left edge.
	const lines = (suffix: string, rows: readonly string[], top: number) => {
		if (rows.length === 0) return;
		const height = rows.length * MEMBER_ROW;
		const width = Math.ceil(
			Math.max(...rows.map((row) => estimateTextWidth(row, MEMBER_FONT_SIZE))),
		);
		texts.push({
			type: "text",
			id: `text:${id}:${suffix}`,
			x: at.x + CELL_PADDING + width / 2,
			y: top + COMPARTMENT_PADDING + height / 2,
			text: rows.join("\n"),
			fontSize: MEMBER_FONT_SIZE,
			lineHeight: MEMBER_ROW / MEMBER_FONT_SIZE,
			maxWidth: width,
			textAlign: "left",
			groupIds,
		});
	};
	lines("attributes", box.attributes, at.y + box.band);
	lines("methods", box.methods, methodsTop);
	return { nodes: [outline, band, methods], texts };
}

interface Rect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
	return (
		a.left < b.right + gap &&
		b.left < a.right + gap &&
		a.top < b.bottom + gap &&
		b.top < a.bottom + gap
	);
}

function rectTouchesSegment(rect: Rect, segment: AxisAlignedSegment, gap: number): boolean {
	return segment.orientation === "horizontal"
		? segment.staticCoordinate > rect.top - gap &&
				segment.staticCoordinate < rect.bottom + gap &&
				segment.max > rect.left - gap &&
				segment.min < rect.right + gap
		: segment.staticCoordinate > rect.left - gap &&
				segment.staticCoordinate < rect.right + gap &&
				segment.max > rect.top - gap &&
				segment.min < rect.bottom + gap;
}

function rectSegmentDistance(rect: Rect, segment: AxisAlignedSegment): number {
	const [x0, x1, y0, y1] =
		segment.orientation === "horizontal"
			? [segment.min, segment.max, segment.staticCoordinate, segment.staticCoordinate]
			: [segment.staticCoordinate, segment.staticCoordinate, segment.min, segment.max];
	return Math.hypot(
		Math.max(0, rect.left - x1, x0 - rect.right),
		Math.max(0, rect.top - y1, y0 - rect.bottom),
	);
}

/**
 * Where a label may go along one run of a line, nearest its start first: on
 * either side of the run, `along` units out from the run's start.
 */
function* labelSpots(
	from: { readonly x: number; readonly y: number },
	to: { readonly x: number; readonly y: number },
	width: number,
	height: number,
	sides: readonly (-1 | 1)[],
	start: number,
): Generator<Rect> {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (length < 1) return;
	const [dx, dy] = [(to.x - from.x) / length, (to.y - from.y) / length];
	const extent = Math.abs(dx) > 0.5 ? width : height;
	for (let along = start; along + extent <= Math.max(length, start + extent); along += 6) {
		for (const side of sides) {
			if (Math.abs(dx) > 0.5) {
				// A horizontal run: the label above (-1) or below (1) it.
				const left = dx > 0 ? from.x + along : from.x - along - width;
				const top = side < 0 ? from.y - LABEL_OFFSET + 4 - height : from.y + LABEL_OFFSET - 4;
				yield { left, top, right: left + width, bottom: top + height };
			} else {
				// A vertical run: the label right (1) or left (-1) of it.
				const top = dy > 0 ? from.y + along : from.y - along - height;
				const left = side > 0 ? from.x + LABEL_OFFSET : from.x - LABEL_OFFSET - width;
				yield { left, top, right: left + width, bottom: top + height };
			}
		}
		if (along + extent >= length) break;
	}
}

function rectPointDistance(rect: Rect, point: { readonly x: number; readonly y: number }): number {
	return Math.hypot(
		Math.max(0, rect.left - point.x, point.x - rect.right),
		Math.max(0, rect.top - point.y, point.y - rect.bottom),
	);
}

/** A route from its start up to halfway along it. */
function halfway(points: readonly { x: number; y: number }[]): { x: number; y: number }[] {
	const lengths = points
		.slice(1)
		.map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
	let rest = lengths.reduce((sum, length) => sum + length, 0) / 2;
	const half = [points[0]!];
	for (const [index, length] of lengths.entries()) {
		const [from, to] = [points[index]!, points[index + 1]!];
		if (length >= rest) {
			const t = length > 0 ? rest / length : 0;
			half.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
			break;
		}
		half.push(to);
		rest -= length;
	}
	return half;
}

/**
 * Place each multiplicity and role beside its end's first run, the two on
 * opposite sides of the line, and each relationship's name beside its
 * longest run, every one clear of the boxes, the lines and the others, and
 * clearly nearer its own line than any other, so none reads as another's;
 * a multiplicity or role also stays beside its own end's tip, clearly nearer
 * it than the line's other tip, so none reads as the other end's.
 */
function placeLabels(
	diagram: ClassDiagram,
	arrows: readonly ArrowSceneElement[],
	boxes: readonly NodeSceneElement[],
): { readonly texts: readonly TextSceneElement[]; readonly unclear: number } {
	const boxRects = boxes.map((box) => ({
		left: box.x,
		top: box.y,
		right: box.x + box.width,
		bottom: box.y + box.height,
	}));
	const owned = arrows.flatMap((arrow) =>
		segmentsFromPoints(arrow.points).map((segment) => ({ owner: arrow.edgeId, segment })),
	);
	const segments = owned.map((run) => run.segment);
	const placed: Rect[] = [];
	const collisions = (rect: Rect) =>
		boxRects.filter((box) => rectsOverlap(rect, box, LABEL_CLEARANCE)).length +
		segments.filter((segment) => rectTouchesSegment(rect, segment, LABEL_CLEARANCE)).length +
		placed.filter((other) => rectsOverlap(rect, other, LABEL_CLEARANCE)).length;
	const free = (rect: Rect) => collisions(rect) === 0;
	const anywhere = () => free;
	// The text as drawn within its room.
	const drawnRect = (text: string, rect: Rect): Rect => {
		const inset = {
			x: (labelWidth(text) - estimateTextWidth(text, LABEL_FONT_SIZE)) / 2,
			y: (text.split("\n").length * (LABEL_HEIGHT - LABEL_FONT_SIZE * 1.35)) / 2,
		};
		return {
			left: rect.left + inset.x,
			top: rect.top + inset.y,
			right: rect.right - inset.x,
			bottom: rect.bottom - inset.y,
		};
	};
	// Free, and the text as drawn within its room stands clearly nearer its own line.
	const attributed = (owner: string, text: string) => (rect: Rect) => {
		if (!free(rect)) return false;
		const drawn = drawnRect(text, rect);
		let [own, other] = [Infinity, Infinity];
		for (const run of owned) {
			const distance = rectSegmentDistance(drawn, run.segment);
			if (run.owner === owner) own = Math.min(own, distance);
			else other = Math.min(other, distance);
		}
		return other >= Math.max(ATTRIBUTION_RATIO * own, own + ATTRIBUTION_MARGIN);
	};
	const texts: TextSceneElement[] = [];
	// Labels no spot left clearly their own line's.
	let unclear = 0;
	const add = (id: string, text: string, rect: Rect, groupId?: string) => {
		placed.push(rect);
		texts.push({
			type: "text",
			id,
			x: (rect.left + rect.right) / 2,
			y: (rect.top + rect.bottom) / 2,
			text,
			fontSize: LABEL_FONT_SIZE,
			maxWidth: rect.right - rect.left,
			...(groupId ? { groupIds: [groupId] } : {}),
		});
	};
	const byId = new Map(arrows.map((arrow) => [arrow.edgeId, arrow]));
	// The spots along the route from one end, nearest that end first.
	const spots = (
		points: readonly { x: number; y: number }[],
		width: number,
		height: number,
		sides: readonly (-1 | 1)[],
		start: number,
	) =>
		points
			.slice(0, -1)
			.flatMap((point, index) => [
				...labelSpots(point, points[index + 1]!, width, height, sides, index === 0 ? start : 6),
			]);
	for (const relationship of diagram.relationships) {
		const arrow = byId.get(relationship.id);
		if (!arrow) continue;
		for (const end of ["from", "to"] as const) {
			const labels = endLabels(relationship, end);
			if (labels.length === 0) continue;
			const route = end === "from" ? arrow.points : arrow.points.toReversed();
			const [tip, far] = [route[0]!, route.at(-1)!];
			const owner = end === "from" ? arrow.sourceNodeId : arrow.targetNodeId;
			const keys = [
				relationship[end === "from" ? "fromMultiplicity" : "toMultiplicity"] && "multiplicity",
				relationship[end === "from" ? "fromRole" : "toRole"] && "role",
			].filter((key): key is string => typeof key === "string");
			const place = (
				points: readonly { x: number; y: number }[],
				side: (index: number) => readonly (-1 | 1)[],
				accept: (text: string) => (rect: Rect) => boolean,
			) => {
				const rects: Rect[] = [];
				for (const [index, label] of labels.entries()) {
					const rect = spots(points, labelWidth(label), LABEL_HEIGHT, side(index), 4).find(
						accept(label),
					);
					if (!rect) break;
					rects.push(rect);
					placed.push(rect);
				}
				placed.splice(placed.length - rects.length, rects.length);
				return rects.length === labels.length ? rects : undefined;
			};
			// The text as drawn stands beside this end's tip, the other tip clearly further off.
			const beside = (text: string) => (rect: Rect) => {
				const drawn = drawnRect(text, rect);
				const [own, other] = [rectPointDistance(drawn, tip), rectPointDistance(drawn, far)];
				return (
					Math.hypot(
						(drawn.left + drawn.right) / 2 - tip.x,
						(drawn.top + drawn.bottom) / 2 - tip.y,
					) <= END_LABEL_REACH &&
					other >= Math.max(ATTRIBUTION_RATIO * own, own + ATTRIBUTION_MARGIN)
				);
			};
			const near = (text: string) => {
				const here = beside(text);
				return (rect: Rect) => free(rect) && here(rect);
			};
			// On the end's first run, beside the end and clearly its own line's: two labels
			// on opposite sides, whichever way round fits, else together on one side; one
			// label on either side, nearest the end first.
			const mine = (text: string) => {
				const [line, here] = [attributed(relationship.id, text), beside(text)];
				return (rect: Rect) => line(rect) && here(rect);
			};
			const sides: ((index: number) => readonly (-1 | 1)[])[] =
				labels.length === 2
					? [
							(index) => [index === 0 ? 1 : -1],
							(index) => [index === 0 ? -1 : 1],
							() => [1],
							() => [-1],
						]
					: [() => [1, -1]];
			// Failing that, each the nearest such spot on either side along the end's
			// half of the line; then the same beside the end, if nearer another line;
			// then opposite sides, then each the nearest free spot on either side along
			// the end's half; then, with none free, its first spot.
			const orders: (readonly (-1 | 1)[])[] =
				labels.length === 2
					? [
							[1, -1],
							[-1, 1],
						]
					: [[1], [-1]];
			const half = halfway(route);
			const nearest = (accept: (text: string) => (rect: Rect) => boolean) =>
				sides.map((side) => place(route.slice(0, 2), side, accept)).find(Boolean) ??
				place(half, () => [1, -1], accept);
			const clear = nearest(mine);
			if (!clear) unclear += labels.length;
			const chosen =
				clear ??
				nearest(near) ??
				orders.map((order) => place(half, (index) => [order[index]!], anywhere)).find(Boolean) ??
				place(half, () => [1, -1], anywhere) ??
				labels.map((label) => spots(route, labelWidth(label), LABEL_HEIGHT, [1, -1], 4)[0]!);
			for (const [index, rect] of chosen.entries())
				add(
					`relationship:${relationship.id}:${end}:${keys[index]}`,
					labels[index]!,
					rect,
					`class:${owner}`,
				);
		}
	}
	// Each name beside its longest run, else anywhere along its line past the end runs;
	// a long name with no room on one line wraps onto up to five lines. A spot clearly
	// its own line's comes first, then any free one.
	for (const relationship of diagram.relationships) {
		const arrow = byId.get(relationship.id);
		if (!arrow || !relationship.label) continue;
		const runs = arrow.points
			.slice(0, -1)
			.map((point, index) => [point, arrow.points[index + 1]!] as const);
		const longest = runs.reduce((best, run) =>
			Math.hypot(run[1].x - run[0].x, run[1].y - run[0].y) >
			Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y)
				? run
				: best,
		);
		const middle = {
			x: (longest[0].x + longest[1].x) / 2,
			y: (longest[0].y + longest[1].y) / 2,
		};
		const candidates = [1, 2, 3, 4, 5].map((lines) => wrapLabel(relationship.label!.trim(), lines));
		const search = (text: string) => {
			const [width, height] = [labelWidth(text), text.split("\n").length * LABEL_HEIGHT];
			return [
				...spots([middle, longest[1]], width, height, [-1, 1], 0),
				...spots(arrow.points, width, height, [-1, 1], CLASS_END_RUN),
				...spots(arrow.points, width, height, [-1, 1], 0),
			];
		};
		const first = (accept: (text: string) => (rect: Rect) => boolean) =>
			candidates
				.map((text) => ({ text, rect: search(text).find(accept(text)) }))
				.find((candidate) => candidate.rect !== undefined);
		const clear = first((text) => attributed(relationship.id, text));
		if (!clear) unclear += 1;
		const found = clear ?? first(anywhere);
		if (found) {
			add(`relationship:${relationship.id}:name`, found.text, found.rect!);
			continue;
		}
		// No free spot: the one that touches fewest boxes, lines and labels.
		const fallback = candidates
			.flatMap((text) => search(text).map((rect) => ({ text, rect, hits: collisions(rect) })))
			.reduce((best, candidate) => (candidate.hits < best.hits ? candidate : best));
		add(`relationship:${relationship.id}:name`, fallback.text, fallback.rect);
	}
	return { texts, unclear };
}

/** Shift every element so nothing sits nearer the origin than the scene's padding. */
function padded(elements: readonly SceneElement[]): {
	elements: SceneElement[];
	width: number;
	height: number;
} {
	const corners = elements.flatMap((element) => {
		if (element.type === "arrow" || element.type === "line") return [...element.points];
		if (element.type === "text") {
			if (element.containerId) return [];
			const half = (element.maxWidth ?? 0) / 2;
			const lines = element.text.split("\n").length;
			const tall = (lines * element.fontSize * (element.lineHeight ?? 1.35)) / 2;
			return [
				{ x: element.x - half, y: element.y - tall },
				{ x: element.x + half, y: element.y + tall },
			];
		}
		if (element.type === "frame" || element.type === "node")
			return [
				{ x: element.x, y: element.y },
				{ x: element.x + element.width, y: element.y + element.height },
			];
		return [];
	});
	const [minX, minY] = [Math.min(...corners.map((p) => p.x)), Math.min(...corners.map((p) => p.y))];
	const [dx, dy] = [Math.max(0, PADDING - minX), Math.max(0, PADDING - minY)].map(Math.ceil) as [
		number,
		number,
	];
	const moved = elements.map((element): SceneElement => {
		if (dx === 0 && dy === 0) return element;
		if (element.type === "arrow")
			return {
				...element,
				points: element.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) as [
					(typeof element.points)[0],
					...(typeof element.points)[number][],
				],
			};
		if (element.type === "line") return element;
		return { ...element, x: element.x + dx, y: element.y + dy };
	});
	return {
		elements: moved,
		width: Math.max(...corners.map((p) => p.x)) + dx + PADDING,
		height: Math.max(...corners.map((p) => p.y)) + dy + PADDING,
	};
}

/**
 * Render a UML class diagram: each class a box of three compartments (its
 * name under any keyword, its attributes, its methods), superclasses and
 * interfaces above the classes that extend or implement them, and each
 * relationship an orthogonal line with its kind's heads and dashes, its
 * multiplicities and roles beside its ends.
 */
export function renderClassDiagram(diagram: ClassDiagram): RenderedDiagramScene {
	const boxes = new Map(diagram.classes.map((node) => [node.id, boxOf(node)]));
	const { scene, labels } = bestScene(diagram, boxes);
	const placed = new Map(classBoxes(scene).map((element) => [element.nodeId, element]));
	const drawn = diagram.classes.map((node) =>
		boxElements(boxes.get(node.id)!, placed.get(node.id)!, diagram),
	);
	const relationships = new Map(
		diagram.relationships.map((relationship) => [relationship.id, relationship]),
	);
	const arrows = scene.elements.flatMap((element): ArrowSceneElement[] => {
		if (element.type !== "arrow") return [];
		const heads = classRelationshipHeads(relationships.get(element.edgeId)!);
		return [
			{
				...element,
				startArrowhead: heads.from,
				endArrowhead: heads.to,
				...(heads.stroke === "dashed" ? { strokeStyle: "dashed" as const } : {}),
			},
		];
	});
	const { elements, width, height } = padded([
		...drawn.flatMap((box) => [...box.nodes, ...box.texts]),
		...arrows,
		...labels,
	]);
	return {
		...scene,
		width,
		height,
		elements,
		zOrder: elements.map((element) => element.id),
	};
}

/** A class box's outline, name band or methods compartment keeps its role while it is still a plain rectangle. */
export function isStructurallyValidClassBox(element: {
	readonly icon?: unknown;
	readonly id: string;
	readonly nodeId: string;
	readonly shape: string;
}): boolean {
	return (
		element.shape === "rectangle" &&
		element.icon === undefined &&
		element.id === `node:${element.nodeId}`
	);
}
