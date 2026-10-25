import {
	type CanvasArrowhead,
	type ErCardinality,
	type ErDiagram,
	type ErEntity,
	type ErRelationship,
	erEntityName,
	erFieldKeys,
	erNameKey,
	estimateTextWidth,
	type IntermediateDiagram,
	parseErEnd,
	routingQualityFindings,
	routingQualityScale,
} from "@sketchi/diagram-core";

import {
	ER_FAN_STEP,
	type ErLayoutLink,
	type ErPlacement,
	type ErPlacementOptions,
	placeErTables,
} from "./er-layout.js";
import {
	arrowCrossings,
	type ArrowSceneElement,
	type GraphAnchor,
	type NodeSceneElement,
	type RenderedDiagramScene,
	renderGraphDiagram,
	type SceneElement,
	type TextSceneElement,
} from "./scene.js";

/** The band at a table's top that carries its name. */
const HEADER_HEIGHT = 40;
const NAME_FONT_SIZE = 16;
/** Field rows: one line of 14 px text each, a line height of 2 apart. */
const FIELD_FONT_SIZE = 14;
const ROW_HEIGHT = 28;
const BODY_PADDING = 6;
const CELL_PADDING = 14;
const KEY_GAP = 8;
const TYPE_GAP = 16;
const MIN_TABLE_WIDTH = 160;
/**
 * Straight run at each end of a relationship: room for Excalidraw's crow's
 * foot or bar (20 units, drawn at full size on a last run of 40 or more) and,
 * past it, the ring of an optional end.
 */
const END_RUN = 48;
const RING_SIZE = 12;
/** A ring's center sits this far along its line from the table. */
const RING_DISTANCE = 32;
/** Past this, a layout's export reads as a strip; a candidate pays for any excess. */
const READABLE_ASPECT = 2;
const HEADER_FILL = "#efe6ec";
const KEY_COLOR = "#6a4e5c";
const TYPE_COLOR = "#6f6656";

/** The head each end draws; an optional end adds a ring past it. */
const ER_ARROWHEADS: Readonly<Record<ErCardinality, CanvasArrowhead>> = {
	one: "crowfoot_one",
	"zero-or-one": "crowfoot_one",
	many: "crowfoot_many",
	"one-or-many": "crowfoot_one_or_many",
	"zero-or-many": "crowfoot_many",
};

function optional(cardinality: ErCardinality): boolean {
	return cardinality === "zero-or-one" || cardinality === "zero-or-many";
}

function single(cardinality: ErCardinality): boolean {
	return cardinality === "one" || cardinality === "zero-or-one";
}

/** A field's row: its place among the fields, its middle from the table's top and its height. */
interface Row {
	readonly index: number;
	readonly middle: number;
	readonly height: number;
}

/**
 * Room a table makes for the ends on its rows: extra height for each row,
 * by its place among the fields, and room below the last row.
 */
interface Growth {
	readonly rows: readonly number[];
	readonly foot: number;
}

/** A table's size and the text of its three columns: keys, field names and types. */
interface Table {
	readonly entity: ErEntity;
	readonly name: string;
	readonly width: number;
	readonly height: number;
	readonly keys: readonly string[];
	readonly names: readonly string[];
	readonly types: readonly string[];
	readonly keyWidth: number;
	readonly nameWidth: number;
	readonly typeWidth: number;
	/** Each field's row, by its name's key. */
	readonly rows: ReadonlyMap<string, Row>;
	readonly growth: Growth;
}

const columnWidth = (lines: readonly string[]) =>
	Math.ceil(Math.max(0, ...lines.map((line) => estimateTextWidth(line, FIELD_FONT_SIZE))));

const NO_GROWTH: Growth = { rows: [], foot: 0 };

function tableOf(entity: ErEntity, growth: Growth = NO_GROWTH): Table {
	const name = erEntityName(entity);
	const keys = entity.fields.map((field) => erFieldKeys(field).join(" "));
	// A nullable field reads `type?`, or `name?` when it has no type.
	const names = entity.fields.map(
		(field) => `${field.name.trim()}${field.nullable && !field.type ? "?" : ""}`,
	);
	const types = entity.fields.map((field) =>
		field.type ? `${field.type}${field.nullable ? "?" : ""}` : "",
	);
	const [keyWidth, nameWidth, typeWidth] = [keys, names, types].map(columnWidth) as [
		number,
		number,
		number,
	];
	const body =
		CELL_PADDING +
		keyWidth +
		(keyWidth > 0 ? KEY_GAP : 0) +
		nameWidth +
		(typeWidth > 0 ? TYPE_GAP + typeWidth : 0) +
		CELL_PADDING;
	const header = Math.ceil(estimateTextWidth(name, NAME_FONT_SIZE)) + 2 * CELL_PADDING;
	let top = HEADER_HEIGHT + BODY_PADDING;
	const rows = entity.fields.map((field, index): readonly [string, Row] => {
		const height = ROW_HEIGHT + (growth.rows[index] ?? 0);
		top += height;
		return [erNameKey(field.name), { index, middle: top - height / 2, height }];
	});
	return {
		entity,
		name,
		width: Math.max(MIN_TABLE_WIDTH, body, header),
		height: entity.fields.length > 0 ? top + BODY_PADDING + growth.foot : HEADER_HEIGHT,
		keys,
		names,
		types,
		keyWidth,
		nameWidth,
		typeWidth,
		rows: new Map(rows),
		growth,
	};
}

/**
 * One end of a relationship as drawn: its table, the row it attaches to (none
 * for the name band), the middle and height of that row or band, and its head.
 */
interface End {
	readonly entity: string;
	readonly row: Row | undefined;
	readonly y: number;
	readonly band: number;
	readonly cardinality: ErCardinality;
}

/** A relationship oriented from its referenced (parent) end to the end holding the key (child). */
interface Link {
	readonly relationship: ErRelationship;
	readonly parent: End;
	readonly child: End;
}

/**
 * Orient a relationship parent first: the one end of a one-to-many, the end
 * whose field is a plain primary key in a one-to-one, otherwise as written.
 */
function linkOf(relationship: ErRelationship, tables: ReadonlyMap<string, Table>): Link {
	const [from, to] = [parseErEnd(relationship.from), parseErEnd(relationship.to)];
	const field = (end: typeof from) =>
		end.field === undefined
			? undefined
			: tables
					.get(end.entity)!
					.entity.fields.find((candidate) => erNameKey(candidate.name) === erNameKey(end.field!));
	// An end without a field, opposite one with a field, attaches at its table's single primary key.
	const rowOf = (end: typeof from, other: typeof from) => {
		const table = tables.get(end.entity)!;
		if (end.field !== undefined) return table.rows.get(erNameKey(end.field))!;
		const keys = table.entity.fields.filter((candidate) => candidate.pk);
		if (other.field !== undefined && keys.length === 1)
			return table.rows.get(erNameKey(keys[0]!.name))!;
		return undefined;
	};
	const endOf = (end: typeof from, other: typeof from, cardinality: ErCardinality): End => {
		const row = rowOf(end, other);
		return {
			entity: end.entity,
			row,
			y: row?.middle ?? HEADER_HEIGHT / 2,
			band: row?.height ?? HEADER_HEIGHT,
			cardinality,
		};
	};
	const ends = {
		from: endOf(from, to, relationship.fromCardinality),
		to: endOf(to, from, relationship.toCardinality),
	};
	const plainKey = (end: typeof from) => {
		const found = field(end);
		return found !== undefined && found.pk === true && found.fk !== true;
	};
	const fromIsParent =
		single(relationship.fromCardinality) !== single(relationship.toCardinality)
			? single(relationship.fromCardinality)
			: !(plainKey(to) && !plainKey(from));
	return fromIsParent
		? { relationship, parent: ends.from, child: ends.to }
		: { relationship, parent: ends.to, child: ends.from };
}

interface PinnedEnd {
	readonly link: Link;
	readonly end: "parent" | "child";
	side: GraphAnchor["side"];
	/** The middle of the row or name band the end attaches to, from its table's top. */
	readonly row: number;
	/** That row's or band's height. */
	readonly band: number;
	/** Its port on that row. */
	y: number;
}

/**
 * Ports on one side of a row sit at most this far apart, so two ends' bars
 * or feet (Excalidraw draws each 17 across) stand clear of each other, and
 * this far inside the row's band, so no port reads as the line between two
 * rows. Two ends share a row's side cleanly; a third bunches them.
 */
const PORT_STEP = 22;
const PORT_MARGIN = 3;
/** How far across its line an end's bar or foot reaches, with a hair to spare (Excalidraw: 20 sin 25°). */
const MARK_REACH = 9;
/** The router holds each port this far from its side's corners (scene's port padding). */
const CORNER_CLEARANCE = 16;
/** A row side holding more ends than this hands its farthest to the row's free side. */
const CROWDED_ROW = 2;

type Boxes = ReadonlyMap<
	string,
	{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }
>;

/** Where an end's row or band sits on the canvas. */
function rowOf(end: PinnedEnd, boxes: Boxes): number {
	return boxes.get(end.link[end.end].entity)!.y + end.row;
}

/** Where an end's port sits on the canvas. */
function portOf(end: PinnedEnd, boxes: Boxes): number {
	return boxes.get(end.link[end.end].entity)!.y + end.y;
}

/**
 * Whether two tables stand in one column: their middles meet, give or take
 * the half unit a column's rounding leaves between tables of odd widths.
 */
function sharesColumn(
	first: { readonly x: number; readonly width: number },
	second: { readonly x: number; readonly width: number },
): boolean {
	return Math.abs(first.x + first.width / 2 - (second.x + second.width / 2)) < 1;
}

function sameColumn(boxes: Boxes, a: PinnedEnd, b: PinnedEnd): boolean {
	return sharesColumn(boxes.get(a.link[a.end].entity)!, boxes.get(b.link[b.end].entity)!);
}

/**
 * How far an end's table side stands inside its column's outer edge: runs
 * count from that edge, so lines of narrower tables turn in line with the rest.
 */
function insetOf(end: PinnedEnd, boxes: Boxes): number {
	const box = boxes.get(end.link[end.end].entity)!;
	const column = [...boxes.values()].filter((other) => sharesColumn(other, box));
	return end.side === "left"
		? box.x - Math.min(...column.map((other) => other.x))
		: Math.max(...column.map((other) => other.x + other.width)) - (box.x + box.width);
}

function partnerOf(ends: readonly PinnedEnd[], end: PinnedEnd): PinnedEnd {
	return ends.find((other) => other.link === end.link && other !== end)!;
}

/** The ends on each side of each row; ends over a table's top stand apart. */
function rowGroups(ends: readonly PinnedEnd[]): PinnedEnd[][] {
	const rows = new Map<string, PinnedEnd[]>();
	for (const end of ends) {
		if (end.side === "top") continue;
		const key = `${end.link[end.end].entity}\u0000${end.side}\u0000${end.row}`;
		rows.set(key, [...(rows.get(key) ?? []), end]);
	}
	return [...rows.values()];
}

/**
 * Ends crowding one side of a row spill to its other side while that holds
 * fewer, the farthest reaching first: a line climbing past its table's top,
 * or dropping past its bottom, wraps around the table and clears the rest.
 * Loops keep their side. Reports whether any end moved.
 */
function spillCrowdedRows(ends: readonly PinnedEnd[], boxes: Boxes): boolean {
	let spilled = false;
	for (const row of rowGroups(ends)) {
		if (row.length <= CROWDED_ROW) continue;
		const [entity, side] = [row[0]!.link[row[0]!.end].entity, row[0]!.side];
		const box = boxes.get(entity)!;
		const opposite = side === "left" ? "right" : "left";
		let across = ends.filter(
			(end) =>
				end.link[end.end].entity === entity && end.side === opposite && end.row === row[0]!.row,
		).length;
		const reach = (end: PinnedEnd) => {
			const target = rowOf(partnerOf(ends, end), boxes);
			return Math.max(box.y - END_RUN - target, target - (box.y + box.height + END_RUN));
		};
		const movable = row
			.filter((end) => partnerOf(ends, end).side !== end.side && reach(end) > 0)
			.sort((a, b) => reach(b) - reach(a));
		let here = row.length;
		for (const end of movable) {
			if (here - across < 2) break;
			end.side = opposite;
			here -= 1;
			across += 1;
			spilled = true;
		}
	}
	return spilled;
}

/**
 * Every end has a port of its own, so no two lines share a run or a head.
 * Ends on one side of a row spread across its band: lines climbing take the
 * upper ports, loops within the column (which turn nearest) then the farthest
 * topmost, and lines dropping the lower ones, so none crosses another. Lines
 * climbing turn at runs of their own from the column's edge, the farthest
 * first so the nearer nest inside it; so do lines dropping. An end alone on
 * its row then meets its partner's port level where that port lies within
 * its row, so a line between level rows runs straight.
 */
function spreadPorts(ends: readonly PinnedEnd[], boxes: Boxes): Map<PinnedEnd, number> {
	const rows = rowGroups(ends);
	const half = (end: PinnedEnd) => end.band / 2 - PORT_MARGIN;
	const runs = new Map<PinnedEnd, number>();
	for (const row of rows) {
		if (row.length < 2) continue;
		const rise = (end: PinnedEnd) => rowOf(partnerOf(ends, end), boxes) - rowOf(end, boxes);
		// A loop within the column turns nearer than a line out to another column.
		const loop = (end: PinnedEnd) => (sameColumn(boxes, end, partnerOf(ends, end)) ? 1 : 0);
		const ups = row
			.filter((end) => rise(end) < 0)
			.sort((a, b) => loop(b) - loop(a) || rise(a) - rise(b));
		const downs = row
			.filter((end) => rise(end) > 0)
			.sort((a, b) => loop(a) - loop(b) || rise(a) - rise(b));
		const order = [...ups, ...row.filter((end) => rise(end) === 0), ...downs];
		const step = Math.min(PORT_STEP, (2 * half(row[0]!)) / (order.length - 1));
		order.forEach((end, slot) => {
			end.y = end.row + (slot - (order.length - 1) / 2) * step;
		});
		const run = (end: PinnedEnd, slot: number) =>
			runs.set(end, insetOf(end, boxes) + END_RUN + slot * ER_FAN_STEP);
		ups.forEach(run);
		downs.toReversed().forEach(run);
	}
	for (const row of rows) {
		if (row.length > 1) continue;
		const end = row[0]!;
		const partner = partnerOf(ends, end);
		if (partner.side === end.side || partner.side === "top") continue;
		const port = portOf(partner, boxes) - (rowOf(end, boxes) - end.row);
		if (Math.abs(port - end.row) <= half(end)) end.y = port;
	}
	// An end alone on its row turns at the end run from its column's edge too,
	// clear of the marks on any wider table's side in that column.
	for (const end of ends)
		if (end.side !== "top" && !runs.has(end) && insetOf(end, boxes) > 0)
			runs.set(end, insetOf(end, boxes) + END_RUN);
	const sides = new Map<string, PinnedEnd[]>();
	for (const end of ends) {
		if (end.side === "top") continue;
		const key = `${end.link[end.end].entity}\u0000${end.side}`;
		sides.set(key, [...(sides.get(key) ?? []), end]);
	}
	for (const side of sides.values()) {
		const { height } = boxes.get(side[0]!.link[side[0]!.end].entity)!;
		keepClear(
			side.sort((a, b) => a.row - b.row || a.y - b.y),
			(end) => Math.max(end.row - half(end), CORNER_CLEARANCE),
			(end) => Math.min(end.row + half(end), height - CORNER_CLEARANCE),
		);
	}
	return runs;
}

/**
 * Hold the ports down one side of a table apart: ports of neighboring rows at
 * least a mark's reach apart, so no end's bar or foot reaches across another
 * row's line, and ports of one row as far apart as every port fitting within
 * its own row's band then allows, up to a port step. Each port moves from
 * where its row put it only as far as that takes, and none comes nearer a
 * corner than the router allows. `side` runs top to bottom.
 */
function keepClear(
	side: readonly PinnedEnd[],
	lowest: (end: PinnedEnd) => number,
	highest: (end: PinnedEnd) => number,
): void {
	if (side.length < 2) return;
	const apart = (gap: number, index: number) =>
		side[index]!.row === side[index - 1]!.row ? gap : Math.max(gap, MARK_REACH);
	const fits = (gap: number) => {
		let port = -Infinity;
		for (const [index, end] of side.entries()) {
			port = Math.max(lowest(end), index > 0 ? port + apart(gap, index) : port);
			if (port > highest(end) + 1e-9) return false;
		}
		return true;
	};
	let [low, high] = [0, PORT_STEP];
	if (fits(high)) low = high;
	else
		for (let round = 0; round < 24; round += 1) {
			const middle = (low + high) / 2;
			if (fits(middle)) low = middle;
			else high = middle;
		}
	// The lowest each port may sit and still leave room for the ports below it.
	const latest = side.map(highest);
	for (let index = side.length - 2; index >= 0; index -= 1)
		latest[index] = Math.min(latest[index]!, latest[index + 1]! - apart(low, index + 1));
	let previous = -Infinity;
	for (const [index, end] of side.entries()) {
		const earliest = index > 0 ? previous + apart(low, index) : -Infinity;
		end.y = Math.min(Math.max(end.y, lowest(end), earliest), latest[index]!);
		previous = end.y;
	}
}

/** Each end of a placement's links, on the side the placement gives it. */
function pinnedEnds(links: readonly Link[], placement: ErPlacement): PinnedEnd[] {
	const ends: PinnedEnd[] = links.flatMap((link) => {
		const sides = placement.sides.get(link.relationship.id)!;
		return (["parent", "child"] as const).map((end) => ({
			link,
			end,
			side: sides[end],
			row: link[end].y,
			band: link[end].band,
			y: link[end].y,
		}));
	});
	// A loop whose two ends would meet leaves its table's side and returns over its top.
	for (const link of links) {
		if (link.parent.entity !== link.child.entity) continue;
		const [parent, child] = ends.filter((end) => end.link === link);
		if (parent && child && parent.row === child.row) child.side = "top";
	}
	return ends;
}

/** Give each end its port and route the placement's links between them. */
function routedScene(
	diagram: ErDiagram,
	tables: ReadonlyMap<string, Table>,
	links: readonly Link[],
	placement: ErPlacement,
	ends: readonly PinnedEnd[],
): RenderedDiagramScene {
	const runs = spreadPorts(ends, placement.boxes);
	loopRuns(ends, placement.boxes, runs);
	const anchors = new Map<string, GraphAnchor>(
		ends.map((end) => {
			const table = tables.get(end.link[end.end].entity)!;
			const offset =
				end.side === "top"
					? (parentSide(ends, end.link) === "left" ? -1 : 1) * (table.width / 2 - 2 * CELL_PADDING)
					: end.y - table.height / 2;
			const run = runs.get(end);
			return [
				`${end.link.relationship.id}:${end.end === "parent" ? "source" : "target"}`,
				{ side: end.side, offset, ...(run === undefined ? {} : { run }) },
			] as const;
		}),
	);
	const graph = {
		id: diagram.id,
		title: diagram.title,
		type: "flowchart",
		nodes: diagram.entities.map((entity) => ({
			id: entity.id,
			label: erEntityName(entity),
			kind: "entity",
			metadata: {},
		})),
		edges: links.map((link) => ({
			id: link.relationship.id,
			source: link.parent.entity,
			target: link.child.entity,
			metadata: {},
			...(link.relationship.label ? { label: link.relationship.label } : {}),
		})),
		layout: { direction: "LR", edgeRouting: "orthogonal" },
		style: diagram.style,
		metadata: {},
	} satisfies IntermediateDiagram;
	return renderGraphDiagram(graph, { placement: placement.boxes, anchors, endRun: END_RUN });
}

/**
 * Placements to try, each routed in full: from a layered start and from one
 * centered on the most linked table, each aiming at a few shapes from wide to
 * tall, and one that stacks linked tables freely, which suits a schema of a
 * few tables. Larger schemas try the first two only.
 */
const PLACEMENTS: readonly ErPlacementOptions[] = [
	...(["layered", "hub"] as const).flatMap((start) =>
		[1.6, 1.1, 0.7, 0.5].map((aspect) => ({ start, aspect, sameColumn: 1 })),
	),
	{ aspect: 0.5, sameColumn: 0 },
];
const LARGE_SCHEMA = 24;
const PLACEMENT_MARGIN = 0.75;

/**
 * Crossings plus reader-scale findings, judged at the scene's export size, any
 * too-long side, each bunch of ports closer than a step, and each end that
 * wraps around its own table, about what a reader counts as a flaw each; and
 * a little for each table a line within a column runs past.
 */
function routedCost(scene: RenderedDiagramScene): number {
	const arrows = scene.elements.filter((e): e is ArrowSceneElement => e.type === "arrow");
	const aspect = Math.max(scene.width / scene.height, scene.height / scene.width);
	return (
		arrowCrossings(arrows) +
		routingQualityFindings(
			arrows.map((arrow) => ({
				id: arrow.id,
				points: arrow.points,
				sourceId: arrow.sourceNodeId,
				targetId: arrow.targetNodeId,
			})),
			routingQualityScale({ width: scene.width, height: scene.height }),
		).length +
		(aspect > READABLE_ASPECT ? 4 * (aspect - READABLE_ASPECT) : 0) +
		arrows.reduce((sum, arrow) => sum + detour(arrow), 0) +
		bunchedPorts(arrows) +
		wraps(scene, arrows) +
		PASSED_TABLE * passedTables(scene, arrows)
	);
}

/** Cost of each table a line within a column runs past beside it. */
const PASSED_TABLE = 0.25;

/**
 * Tables a line between two tables of one column runs past: those standing
 * between its two in that column, each a stretch the reader follows beside.
 */
function passedTables(scene: RenderedDiagramScene, arrows: readonly ArrowSceneElement[]): number {
	const boxes = scene.elements.flatMap((element) => (element.type === "node" ? [element] : []));
	const byId = new Map(boxes.map((box) => [box.nodeId, box]));
	let count = 0;
	for (const arrow of arrows) {
		const [source, target] = [byId.get(arrow.sourceNodeId), byId.get(arrow.targetNodeId)];
		if (!source || !target || source === target) continue;
		if (!(source.x < target.x + target.width && target.x < source.x + source.width)) continue;
		const [low, high] = [
			Math.min(source.y + source.height, target.y + target.height),
			Math.max(source.y, target.y),
		];
		count += boxes.filter(
			(box) =>
				box !== source &&
				box !== target &&
				box.y >= low &&
				box.y + box.height <= high &&
				box.x < Math.max(source.x + source.width, target.x + target.width) &&
				Math.min(source.x, target.x) < box.x + box.width,
		).length;
	}
	return count;
}

/**
 * Ends that leave their table on the side away from a table in another
 * column, so the line wraps around its own table to get there.
 */
function wraps(scene: RenderedDiagramScene, arrows: readonly ArrowSceneElement[]): number {
	const boxes = new Map(
		scene.elements.flatMap((element) =>
			element.type === "node" ? [[element.nodeId, element] as const] : [],
		),
	);
	let count = 0;
	for (const arrow of arrows) {
		const [source, target] = [boxes.get(arrow.sourceNodeId), boxes.get(arrow.targetNodeId)];
		if (!source || !target) continue;
		if (source.x < target.x + target.width && target.x < source.x + source.width) continue;
		for (const [tip, next, other] of [
			[arrow.points[0], arrow.points[1]!, arrow.points.at(-1)!],
			[arrow.points.at(-1)!, arrow.points.at(-2)!, arrow.points[0]],
		] as const)
			if ((next.x - tip.x) * (other.x - tip.x) < 0) count += 1;
	}
	return count;
}

/**
 * Runs of ports on one side of a table nearer than a port step: a reader
 * sees each run as one bunch of marks, a little worse for each further port.
 */
function bunchedPorts(arrows: readonly ArrowSceneElement[]): number {
	const sides = new Map<string, number[]>();
	for (const arrow of arrows)
		for (const [node, point] of [
			[arrow.sourceNodeId, arrow.points[0]],
			[arrow.targetNodeId, arrow.points.at(-1)!],
		] as const) {
			const key = `${node}\u0000${Math.round(point.x)}`;
			sides.set(key, [...(sides.get(key) ?? []), point.y]);
		}
	let bunches = 0;
	for (const ports of sides.values()) {
		ports.sort((a, b) => a - b);
		let inBunch = false;
		for (const [index, port] of ports.slice(1).entries()) {
			const near = port - ports[index]! < PORT_STEP - 0.01;
			if (near) bunches += inBunch ? 0.25 : 1;
			inBunch = near;
		}
	}
	return bunches;
}

/** How much longer than the way between its ends a line runs, past a little slack. */
function detour(arrow: ArrowSceneElement): number {
	const [start, end] = [arrow.points[0], arrow.points.at(-1)!];
	let length = 0;
	for (const [index, point] of arrow.points.slice(1).entries())
		length +=
			Math.abs(point.x - arrow.points[index]!.x) + Math.abs(point.y - arrow.points[index]!.y);
	const direct = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
	return Math.max(0, length / (direct + 2 * END_RUN + 200) - 1);
}

/**
 * A placement, the tables and links it was made for and the option it was made
 * with, and whether its crowded rows spill to their free sides.
 */
interface Candidate {
	readonly tables: ReadonlyMap<string, Table>;
	readonly links: readonly Link[];
	readonly placement: ErPlacement;
	readonly option: ErPlacementOptions;
	readonly spill: boolean;
}

/** A candidate's ends, on the sides its placement gives them, spilled if it spills. */
function endsOf(candidate: Candidate): PinnedEnd[] {
	const ends = pinnedEnds(candidate.links, candidate.placement);
	if (candidate.spill) spillCrowdedRows(ends, candidate.placement.boxes);
	return ends;
}

function sceneOf(diagram: ErDiagram, candidate: Candidate): RenderedDiagramScene {
	return routedScene(
		diagram,
		candidate.tables,
		candidate.links,
		candidate.placement,
		endsOf(candidate),
	);
}

/**
 * Extra height a row takes for each end past the second on its fuller side:
 * two lines, so its outermost port, a further port step out, stays as much
 * nearer its own field than its neighbor's as either of two ends on a plain row.
 */
const ROW_GROWTH = 2 * ROW_HEIGHT;
/** Times a placement is made again, its tables grown to fit the ends the last one gave them. */
const GROWTH_PASSES = 2;

/**
 * Tables with room for the ends a placement gives their rows, a port step
 * apart: a row holding more than two ends on a side grows for each further
 * end, and a last row makes room below its lowest port, clear of the table's
 * corner. A table keeps any room it already has. Undefined when every table
 * has enough.
 */
function grownTables(
	tables: ReadonlyMap<string, Table>,
	ends: readonly PinnedEnd[],
): Map<string, Table> | undefined {
	const counts = new Map<string, number>();
	for (const end of ends) {
		const { entity, row } = end.link[end.end];
		if (row === undefined || end.side === "top") continue;
		const key = `${entity}\u0000${end.side}\u0000${row.index}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	let grown: Map<string, Table> | undefined;
	for (const table of tables.values()) {
		const { entity, growth } = table;
		const most = (index: number) =>
			Math.max(
				...(["left", "right"] as const).map(
					(side) => counts.get(`${entity.id}\u0000${side}\u0000${index}`) ?? 0,
				),
			);
		const rows = entity.fields.map((_, index) =>
			Math.max(growth.rows[index] ?? 0, ROW_GROWTH * Math.max(0, most(index) - 2)),
		);
		// The last row's lowest port sits half its ends' spread below its middle.
		const last = entity.fields.length - 1;
		const reach = ((Math.max(1, most(last)) - 1) * PORT_STEP) / 2;
		const below = (ROW_HEIGHT + (rows[last] ?? 0)) / 2 + BODY_PADDING;
		const foot = Math.max(
			growth.foot,
			last < 0 ? 0 : 2 * Math.ceil(Math.max(0, reach + CORNER_CLEARANCE - below) / 2),
		);
		if (foot === growth.foot && rows.every((extra, index) => extra === (growth.rows[index] ?? 0)))
			continue;
		grown ??= new Map(tables);
		grown.set(entity.id, tableOf(entity, { rows, foot }));
	}
	return grown;
}

/**
 * Place the tables as the layout sees them: boxes, and links between rows with
 * any label, each meeting its rows at the given ports, by end, or their middles.
 */
function placeTables(
	tables: ReadonlyMap<string, Table>,
	links: readonly Link[],
	option: ErPlacementOptions,
	ports: ReadonlyMap<string, number> = new Map(),
): ErPlacement {
	return placeErTables(
		[...tables.values()].map((table) => ({
			id: table.entity.id,
			width: table.width,
			height: table.height,
		})),
		links.map((link): ErLayoutLink => ({
			id: link.relationship.id,
			parent: link.parent.entity,
			child: link.child.entity,
			parentY: link.parent.y,
			childY: link.child.y,
			...(ports.has(`${link.relationship.id}:parent`)
				? { parentPort: link.parent.y + ports.get(`${link.relationship.id}:parent`)! }
				: {}),
			...(ports.has(`${link.relationship.id}:child`)
				? { childPort: link.child.y + ports.get(`${link.relationship.id}:child`)! }
				: {}),
			labelWidth: link.relationship.label
				? Math.min(160, Math.ceil(estimateTextWidth(link.relationship.label, 13)))
				: 0,
		})),
		END_RUN,
		option,
	);
}

/**
 * The candidate placed again, in the columns it chose, with its tables grown
 * to fit the ends each placement gives their rows, until they fit.
 */
function grownCandidate(diagram: ErDiagram, start: Candidate): Candidate {
	let candidate = start;
	for (let pass = 0; pass < GROWTH_PASSES; pass += 1) {
		const ends = endsOf(candidate);
		const tables = grownTables(candidate.tables, ends);
		if (!tables) break;
		const links = diagram.relationships.map((relationship) => linkOf(relationship, tables));
		const option = { ...start.option, arrangement: start.placement.arrangement };
		const ports = crowdedPorts(ends, candidate.placement.boxes);
		candidate = { ...start, tables, links, placement: placeTables(tables, links, option, ports) };
	}
	return candidate;
}

/**
 * Where each end on a row side holding more than two will meet its grown row,
 * from the row's middle, by `<relationship>:<parent|child>`: in the order the
 * ports run down the side now, a port step apart around the middle.
 */
function crowdedPorts(ends: readonly PinnedEnd[], boxes: Boxes): Map<string, number> {
	spreadPorts(ends, boxes);
	const ports = new Map<string, number>();
	for (const row of rowGroups(ends)) {
		if (row.length <= 2) continue;
		row
			.toSorted((a, b) => a.y - b.y)
			.forEach((end, slot) =>
				ports.set(
					`${end.link.relationship.id}:${end.end}`,
					(slot - (row.length - 1) / 2) * PORT_STEP,
				),
			);
	}
	return ports;
}

/**
 * What a reader counts against a scene, which a placement grown for its ends
 * must not worsen: crossings, reader-scale findings, detours, ends wrapping
 * their own table, tables a line runs past, marks on labels and the drawing's
 * long side.
 */
function flaws(scene: RenderedDiagramScene) {
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
		// A line more than twice the way between its ends, past a little slack, reads as a detour.
		detours: arrows.filter((arrow) => {
			const [start, end] = [arrow.points[0], arrow.points.at(-1)!];
			let length = 0;
			for (const [index, point] of arrow.points.slice(1).entries())
				length +=
					Math.abs(point.x - arrow.points[index]!.x) + Math.abs(point.y - arrow.points[index]!.y);
			return length > 2 * (Math.abs(end.x - start.x) + Math.abs(end.y - start.y)) + 120;
		}).length,
		wraps: wraps(scene, arrows),
		passed: passedTables(scene, arrows),
		marksOnLabels: marksOnLabels(scene, arrows),
		length: Math.max(scene.width, scene.height),
	};
}

/**
 * Ends whose bar or foot, past its tip as Excalidraw draws it, overlaps a
 * relationship's label.
 */
function marksOnLabels(scene: RenderedDiagramScene, arrows: readonly ArrowSceneElement[]): number {
	const labels = scene.elements.flatMap((element) =>
		element.type === "text" && element.containerId === undefined
			? [
					{
						x: element.x,
						y: element.y,
						half:
							Math.min(
								element.maxWidth ?? Infinity,
								estimateTextWidth(element.text, element.fontSize),
							) / 2,
						height: (element.fontSize * 1.25) / 2,
					},
				]
			: [],
	);
	let count = 0;
	for (const arrow of arrows)
		for (const [tip, next] of [
			[arrow.points[0], arrow.points[1]!],
			[arrow.points.at(-1)!, arrow.points.at(-2)!],
		] as const) {
			const run = Math.hypot(next.x - tip.x, next.y - tip.y) || 1;
			const size = Math.min(20, run / 2);
			const [dx, dy] = [(next.x - tip.x) / run, (next.y - tip.y) / run];
			const [x0, x1] = [Math.min(tip.x, tip.x + dx * size), Math.max(tip.x, tip.x + dx * size)];
			const [y0, y1] = [Math.min(tip.y, tip.y + dy * size), Math.max(tip.y, tip.y + dy * size)];
			if (
				labels.some(
					(label) =>
						x0 - Math.abs(dy) * MARK_REACH < label.x + label.half &&
						label.x - label.half < x1 + Math.abs(dy) * MARK_REACH &&
						y0 - Math.abs(dx) * MARK_REACH < label.y + label.height &&
						label.y - label.height < y1 + Math.abs(dx) * MARK_REACH,
				)
			)
				count += 1;
		}
	return count;
}

/** Whether a scene draws no more of any flaw than another. */
function drawsNoWorse(after: RenderedDiagramScene, before: RenderedDiagramScene): boolean {
	const [next, current] = [flaws(after), flaws(before)];
	return (Object.keys(next) as (keyof typeof next)[]).every(
		(key) => next[key] <= current[key] + 1e-9,
	);
}

/**
 * Route each distinct candidate placement and keep the one that crosses least,
 * then give the ends on its crowded rows room of their own where that draws
 * no worse.
 */
function bestScene(
	diagram: ErDiagram,
	tables: ReadonlyMap<string, Table>,
	links: readonly Link[],
): { readonly scene: RenderedDiagramScene; readonly candidate: Candidate } {
	const options = diagram.entities.length > LARGE_SCHEMA ? PLACEMENTS.slice(0, 2) : PLACEMENTS;
	const tried = new Set<string>();
	let best:
		| { cost: number; score: number; scene: RenderedDiagramScene; candidate: Candidate }
		| undefined;
	for (const option of options) {
		const placement = placeTables(tables, links, option);
		const key = JSON.stringify([...placement.boxes, ...placement.sides]);
		if (tried.has(key)) continue;
		tried.add(key);
		const candidate = { tables, links, placement, option, spill: false };
		const scene = sceneOf(diagram, candidate);
		const cost = routedCost(scene);
		// Another placement must beat the first, layered one clearly, not by a fraction.
		const score = best ? cost : cost - PLACEMENT_MARGIN;
		if (!best || score < best.score) best = { cost, score, scene, candidate };
		if (cost === 0) break;
	}
	// The chosen placement also tries its crowded rows spilled to their free sides.
	let chosen: { scene: RenderedDiagramScene; candidate: Candidate } = best!;
	const spilled = { ...best!.candidate, spill: true };
	if (spillCrowdedRows(pinnedEnds(spilled.links, spilled.placement), spilled.placement.boxes)) {
		const scene = sceneOf(diagram, spilled);
		if (routedCost(scene) < best!.cost) chosen = { scene, candidate: spilled };
	}
	const grown = grownCandidate(diagram, chosen.candidate);
	if (grown === chosen.candidate) return chosen;
	const scene = sceneOf(diagram, grown);
	return drawsNoWorse(scene, chosen.scene) ? { scene, candidate: grown } : chosen;
}

/**
 * A loop between two tables of one column, or from a table to itself, turns
 * at one line for both its ends: at its own slot's run from the column's edge,
 * so it nests among the row's other lines, and outside any shorter loop on
 * that side whose rows it spans.
 */
function loopRuns(ends: readonly PinnedEnd[], boxes: Boxes, runs: Map<PinnedEnd, number>): void {
	const loops = ends
		.filter((end) => end.end === "parent")
		.flatMap((parent) => {
			const child = partnerOf(ends, parent);
			const sameSide = parent.side === child.side && parent.side !== "top";
			return sameSide && sameColumn(boxes, parent, child) ? [{ parent, child }] : [];
		})
		.sort(
			(a, b) =>
				Math.abs(portOf(a.parent, boxes) - portOf(a.child, boxes)) -
				Math.abs(portOf(b.parent, boxes) - portOf(b.child, boxes)),
		);
	const placed: {
		readonly end: PinnedEnd;
		readonly top: number;
		readonly bottom: number;
		readonly tip: number;
	}[] = [];
	for (const { parent, child } of loops) {
		const [from, to] = [
			boxes.get(parent.link.parent.entity)!,
			boxes.get(parent.link.child.entity)!,
		];
		const slot = (end: PinnedEnd) =>
			(runs.get(end) ?? insetOf(end, boxes) + END_RUN) - insetOf(end, boxes);
		const run = Math.max(slot(parent), slot(child));
		const [top, bottom] = [portOf(parent, boxes), portOf(child, boxes)].sort((a, b) => a - b) as [
			number,
			number,
		];
		const inner = placed.filter(
			(loop) =>
				loop.end.side === parent.side &&
				sameColumn(boxes, loop.end, parent) &&
				loop.top <= bottom &&
				top <= loop.bottom,
		);
		if (parent.side === "left") {
			const tip = Math.min(
				from.x - insetOf(parent, boxes) - run,
				...inner.map((loop) => loop.tip - ER_FAN_STEP),
			);
			runs.set(parent, from.x - tip);
			runs.set(child, to.x - tip);
			placed.push({ end: parent, top, bottom, tip });
		} else {
			const tip = Math.max(
				from.x + from.width + insetOf(parent, boxes) + run,
				...inner.map((loop) => loop.tip + ER_FAN_STEP),
			);
			runs.set(parent, tip - from.x - from.width);
			runs.set(child, tip - to.x - to.width);
			placed.push({ end: parent, top, bottom, tip });
		}
	}
}

function parentSide(ends: readonly PinnedEnd[], link: Link): GraphAnchor["side"] {
	return ends.find((end) => end.link === link && end.end === "parent")?.side ?? "right";
}

/** A table's elements: its outline, its name band, and a text per column of its rows. */
function tableElements(
	table: Table,
	box: NodeSceneElement,
	diagram: ErDiagram,
): { readonly nodes: NodeSceneElement[]; readonly texts: TextSceneElement[] } {
	const { id } = table.entity;
	const groupIds = [`table:${id}`];
	const outline: NodeSceneElement = {
		type: "node",
		id: `node:${id}`,
		nodeId: id,
		kind: "entity",
		rendererRole: "er-table",
		shape: "rectangle",
		x: box.x,
		y: box.y,
		width: table.width,
		height: table.height,
		label: table.name,
		fillColor: diagram.style.backgroundColor,
		fillStyle: "solid",
		groupIds,
	};
	const band: NodeSceneElement = {
		type: "node",
		id: `node:${id}:header`,
		nodeId: `${id}:header`,
		kind: "entity-name",
		rendererRole: "er-table",
		shape: "rectangle",
		x: box.x,
		y: box.y,
		width: table.width,
		height: HEADER_HEIGHT,
		label: table.name,
		fillColor: HEADER_FILL,
		fillStyle: "solid",
		groupIds,
	};
	const texts: TextSceneElement[] = [
		{
			type: "text",
			id: `label:${id}:header`,
			containerId: band.id,
			x: box.x + table.width / 2,
			y: box.y + HEADER_HEIGHT / 2,
			text: table.name,
			fontSize: NAME_FONT_SIZE,
			maxWidth: table.width - 2 * CELL_PADDING,
			groupIds,
		},
	];
	if (table.entity.fields.length > 0) {
		const top = box.y + HEADER_HEIGHT + BODY_PADDING;
		const height = table.entity.fields.length * ROW_HEIGHT;
		const rows = [...table.rows.values()];
		// Converted text is centered on its point; each column starts at its left edge.
		// Rows of one height share a text per column; where a row grew, each row with
		// text has its own.
		const column = (
			suffix: string,
			lines: readonly string[],
			left: number,
			width: number,
			textColor?: string,
		): TextSceneElement[] => {
			const cell = (id: string, text: string, y: number): TextSceneElement => ({
				type: "text",
				id,
				x: left + width / 2,
				y,
				text,
				fontSize: FIELD_FONT_SIZE,
				lineHeight: ROW_HEIGHT / FIELD_FONT_SIZE,
				maxWidth: width,
				textAlign: "left",
				...(textColor ? { textColor } : {}),
				groupIds,
			});
			return table.growth.rows.some((extra) => extra > 0)
				? rows.flatMap((row) =>
						lines[row.index]
							? [cell(`text:${id}:${suffix}:${row.index}`, lines[row.index]!, box.y + row.middle)]
							: [],
					)
				: [cell(`text:${id}:${suffix}`, lines.join("\n"), top + height / 2)];
		};
		let left = box.x + CELL_PADDING;
		if (table.keyWidth > 0) {
			texts.push(...column("keys", table.keys, left, table.keyWidth, KEY_COLOR));
			left += table.keyWidth + KEY_GAP;
		}
		texts.push(...column("fields", table.names, left, table.nameWidth));
		if (table.typeWidth > 0)
			texts.push(
				...column(
					"types",
					table.types,
					left + table.nameWidth + TYPE_GAP,
					table.typeWidth,
					TYPE_COLOR,
				),
			);
	}
	return { nodes: [outline, band], texts };
}

/** The ring an optional end draws on its line, past its bar or foot, grouped with its table. */
function ring(
	arrow: ArrowSceneElement,
	at: "start" | "end",
	entity: string,
	index: number,
	diagram: ErDiagram,
	distance = RING_DISTANCE,
): NodeSceneElement {
	const points = arrow.points;
	const [tip, next] = at === "start" ? [points[0], points[1]] : [points.at(-1)!, points.at(-2)];
	const length = next ? Math.hypot(next.x - tip.x, next.y - tip.y) : 1;
	const [dx, dy] = next ? [(next.x - tip.x) / length, (next.y - tip.y) / length] : [1, 0];
	const center = { x: tip.x + dx * distance, y: tip.y + dy * distance };
	return {
		type: "node",
		id: `node:${entity}:optional:${index}`,
		nodeId: `${entity}:optional:${index}`,
		kind: "optional",
		rendererRole: "er-optional",
		shape: "circle",
		x: center.x - RING_SIZE / 2,
		y: center.y - RING_SIZE / 2,
		width: RING_SIZE,
		height: RING_SIZE,
		label: "Optional end",
		fillColor: diagram.style.backgroundColor,
		fillStyle: "solid",
		strokeColor: diagram.style.accentColor,
		groupIds: [`table:${entity}`],
	};
}

/**
 * Render an ER diagram: each entity a table (its name over a row per field,
 * with key markers and types in their own columns), each relationship an
 * orthogonal line from row to row with a crow's-foot end at each table.
 */
export function renderErDiagram(diagram: ErDiagram): RenderedDiagramScene {
	const start = new Map(diagram.entities.map((entity) => [entity.id, tableOf(entity)]));
	const {
		scene,
		candidate: { tables, links },
	} = bestScene(
		diagram,
		start,
		diagram.relationships.map((relationship) => linkOf(relationship, start)),
	);
	const boxes = new Map(
		scene.elements.flatMap((element) =>
			element.type === "node" ? [[element.nodeId, element] as const] : [],
		),
	);
	const drawnTables = diagram.entities.map((entity) =>
		tableElements(tables.get(entity.id)!, boxes.get(entity.id)!, diagram),
	);
	const linkById = new Map(links.map((link) => [link.relationship.id, link]));
	const rings: NodeSceneElement[] = [];
	const touches = (drawn: NodeSceneElement) =>
		rings.some((other) => Math.hypot(other.x - drawn.x, other.y - drawn.y) < RING_SIZE + 2);
	const arrows = scene.elements.flatMap((element): ArrowSceneElement[] => {
		if (element.type !== "arrow") return [];
		const link = linkById.get(element.edgeId)!;
		for (const [at, end] of [
			["start", link.parent],
			["end", link.child],
		] as const) {
			if (!optional(end.cardinality)) continue;
			// A ring that would touch a neighbor's moves further along its own first run.
			const [tip, next] =
				at === "start"
					? [element.points[0], element.points[1]!]
					: [element.points.at(-1)!, element.points.at(-2)!];
			const run = Math.hypot(next.x - tip.x, next.y - tip.y);
			let drawn = ring(element, at, end.entity, rings.length, diagram);
			for (
				let distance = RING_DISTANCE + RING_SIZE + 2;
				touches(drawn) && distance + RING_SIZE <= run;
				distance += RING_SIZE + 2
			)
				drawn = ring(element, at, end.entity, rings.length, diagram, distance);
			rings.push(drawn);
		}
		return [
			{
				...element,
				startArrowhead: ER_ARROWHEADS[link.parent.cardinality],
				endArrowhead: ER_ARROWHEADS[link.child.cardinality],
			},
		];
	});
	const labels = scene.elements.filter(
		(element): element is TextSceneElement =>
			element.type === "text" && element.containerId === undefined,
	);
	const elements: SceneElement[] = [
		...drawnTables.flatMap((table) => [...table.nodes, ...table.texts]),
		...arrows,
		...rings,
		...labels,
	];
	return {
		...scene,
		elements,
		zOrder: elements.map((element) => element.id),
	};
}

/** A table's outline or name band keeps its role while it is still a plain rectangle. */
export function isStructurallyValidErTable(element: {
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

/** An optional-end ring keeps its role while it is still a small round mark. */
export function isStructurallyValidErOptional(element: {
	readonly height: number;
	readonly icon?: unknown;
	readonly nodeId: string;
	readonly shape: string;
	readonly width: number;
}): boolean {
	return (
		(element.shape === "circle" || element.shape === "ellipse") &&
		element.icon === undefined &&
		element.nodeId.includes(":optional:") &&
		Math.max(element.width, element.height) <= 2 * RING_SIZE
	);
}
