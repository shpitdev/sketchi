import { clearanceLeft, clearanceRight, type EdgeBox } from "@sketchi/diagram-core";

/**
 * Deterministic org-chart placement: a compact top-down tree whose managers
 * hang their reports from a bus, stack many leaf reports in one or two
 * columns under them, keep assistants beside them on their stem, and wrap a
 * too-wide row of reports into several rows down a trunk. Every connector is
 * an orthogonal polyline from its manager's card to its report's.
 */

export interface OrgPoint {
	readonly x: number;
	readonly y: number;
}

export interface OrgRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** A person as the layout reads them: their card's size, their reports and their assistants. */
export interface OrgTreeNode {
	readonly id: string;
	readonly width: number;
	readonly height: number;
	/** Direct reports other than assistants, in authored order. */
	readonly reports: readonly OrgTreeNode[];
	/** Assistants: leaves drawn beside the manager on their stem. */
	readonly assistants: readonly OrgTreeNode[];
	/** The department this person starts below a manager of another department, drawn as a region when grouping. */
	readonly region?: { readonly label: string; readonly nameWidth: number };
}

/** A solid reporting line from a manager's card to a report's, corner by corner. */
export interface OrgLink {
	readonly manager: string;
	readonly report: string;
	readonly points: readonly OrgPoint[];
}

/** A department region: a frame around a department root's whole subtree. */
export interface OrgRegion {
	readonly root: string;
	readonly label: string;
	readonly frame: OrgRect;
	readonly members: readonly string[];
}

/** How a manager's row of reports was laid out, for the search that wraps wide rows. */
interface RowInfo {
	readonly width: number;
	readonly widestItem: number;
	/** The manager at the top of the widest item, unless it is a stack of leaves. */
	readonly widest: string | undefined;
	readonly items: number;
	readonly rows: number;
}

export interface OrgLayout {
	readonly cards: ReadonlyMap<string, OrgRect>;
	readonly links: readonly OrgLink[];
	readonly regions: readonly OrgRegion[];
	readonly width: number;
	readonly height: number;
	/** Placements tried, this one included. */
	readonly attempts: number;
	/** Leaf groups stack from this many reports. */
	readonly stackMin: number;
	/** Managers whose reports wrap into more than one row, and how many. */
	readonly wraps: ReadonlyMap<string, number>;
	/** Managers who list their reports, each with their own team, in columns along their stem. */
	readonly outlines: ReadonlyMap<string, 1 | 2>;
}

/**
 * Choices the search makes: how few leaf reports stack, which managers list
 * their small teams in columns along their stem, and how many rows each
 * manager's reports take.
 */
interface Policy {
	readonly stackMin: number;
	/** Stacks of this many leaves or more take two columns. */
	readonly twoColumns: number;
	/** Managers who list their reports along their stem, in one column or two. */
	readonly outline: ReadonlyMap<string, 1 | 2>;
	readonly rows: ReadonlyMap<string, number>;
}

/** Vertical room between a manager (or their assistants) and the cards their bus feeds; the bus runs halfway. */
export const ORG_LEVEL_GAP = 56;
/** Horizontal clearance between neighboring subtrees, connectors included. */
const SIBLING_GAP = 24;
/** Boxes this close above or below each other still count as sharing a row. */
const ROW_SLACK = 8;
/** Gap between cards stacked in a column, and from a stem to the first stacked card. */
const STACK_GAP = 14;
const STACK_TOP = 18;
/** A stacked card's connector leaves the spine this far before reaching its side. */
export const ORG_STUB = 18;
/** A one-column stack's spine stands this far in from its manager's left edge. */
const INDENT = 20;
/** An assistant hangs this far below their manager, this far off the stem. */
const ASSIST_GAP = 16;
const ASSIST_STUB = 22;
/** Separate trees of a forest stand this far apart. */
const ROOT_GAP = 64;
/** A region's frame keeps this far outside its members, and its name this far from the line into it. */
const REGION_PAD = 20;
/** Beside a region, packing keeps this much more room, so a dotted line passes between two. */
const REGION_SIDE_ROOM = 10;
const REGION_NAME_HEIGHT = 21;
const REGION_NAME_CLEARANCE = 4;
const REGION_LINE_CLEARANCE = 10;
/** Leaf reports always stack from this many; the search may stack from as few as MIN_STACK. */
const HARD_STACK_MIN = 5;
const MIN_STACK = 2;
/** A stack of this many leaves takes two columns either side of the spine; a too-wide chart takes more in one. */
const TWO_COLUMNS = 5;
const ONE_COLUMN_MOST = 8;
/** A stack holds at most this many leaves, ten rows of two; more split into stacks side by side. */
const MAX_STACK = 20;
/** Hosted PNGs frame the drawing this tightly, so aspect is measured there. */
const EXPORT_PADDING = 20;
/** The search wraps and stacks until the export reads no wider than this, nor taller than its inverse. */
export const ORG_MAX_ASPECT = 2.4;
const MIN_ASPECT = 0.45;
/** The export must stay inside the CLI's PNG ceiling (6.29M square units) with room to spare. */
const AREA_BUDGET = 5_600_000;
const PNG_PADDING = 40;
const TITLE_BAND = 64;
/** A row one subtree takes most of narrows little when wrapped; its widest item must be under this share. */
const DOMINANT = 0.6;
/** Search steps, each trying up to WRAP_CANDIDATES placements. */
const MAX_STEPS = 30;
const WRAP_CANDIDATES = 3;

/** A placed subtree in its own coordinates: its root's card centered on x 0, its top at y 0. */
interface Block {
	boxes: EdgeBox[];
	cards: Map<string, OrgRect>;
	links: OrgLink[];
	regions: OrgRegion[];
	rows: Map<string, RowInfo>;
	/** Where the line from the manager above drops in: the root's top center, or a stack's spine. */
	attach: number;
	/** The line from above continues down to each of these points: one per report the block carries. */
	tails: { report: string; points: OrgPoint[] }[];
	/** Topmost extent, a region's name included; 0 unless the block is a region. */
	top: number;
}

const shiftPoint = (point: OrgPoint, dx: number, dy: number): OrgPoint => ({
	x: point.x + dx,
	y: point.y + dy,
});
const shiftRect = (rect: OrgRect, dx: number, dy: number): OrgRect => ({
	...rect,
	x: rect.x + dx,
	y: rect.y + dy,
});
const shiftBox = (box: EdgeBox, dx: number, dy: number): EdgeBox => ({
	x0: box.x0 + dx,
	x1: box.x1 + dx,
	y0: box.y0 + dy,
	y1: box.y1 + dy,
});
const rectBox = (rect: OrgRect): EdgeBox => ({
	x0: rect.x,
	x1: rect.x + rect.width,
	y0: rect.y,
	y1: rect.y + rect.height,
});

/** Drop repeated points and the middle of straight runs, so every corner is a turn. */
export function simplifyPolyline(points: readonly OrgPoint[]): OrgPoint[] {
	const distinct = points.filter(
		(point, index) =>
			index === 0 ||
			Math.abs(point.x - points[index - 1]!.x) > 0.01 ||
			Math.abs(point.y - points[index - 1]!.y) > 0.01,
	);
	return distinct.filter((point, index) => {
		if (index === 0 || index === distinct.length - 1) return true;
		const before = distinct[index - 1]!;
		const after = distinct[index + 1]!;
		const vertical = Math.abs(before.x - point.x) < 0.01 && Math.abs(point.x - after.x) < 0.01;
		const horizontal = Math.abs(before.y - point.y) < 0.01 && Math.abs(point.y - after.y) < 0.01;
		return !vertical && !horizontal;
	});
}

/** Boxes around each run of a polyline, so packing keeps other subtrees off the line. */
function lineBoxes(points: readonly OrgPoint[]): EdgeBox[] {
	return points.slice(1).map((point, index) => {
		const from = points[index]!;
		return {
			x0: Math.min(from.x, point.x) - 1,
			x1: Math.max(from.x, point.x) + 1,
			y0: Math.min(from.y, point.y) - 1,
			y1: Math.max(from.y, point.y) + 1,
		};
	});
}

function emptyBlock(): Block {
	return {
		boxes: [],
		cards: new Map(),
		links: [],
		regions: [],
		rows: new Map(),
		attach: 0,
		tails: [],
		top: 0,
	};
}

function addCard(block: Block, id: string, rect: OrgRect): void {
	block.cards.set(id, rect);
	block.boxes.push(rectBox(rect));
}

function addLink(block: Block, manager: string, report: string, points: readonly OrgPoint[]): void {
	const simple = simplifyPolyline(points);
	block.links.push({ manager, report, points: simple });
	block.boxes.push(...lineBoxes(simple));
}

/** Copy `from` into `into`, moved by dx, dy. */
function merge(into: Block, from: Block, dx: number, dy: number): void {
	for (const [id, rect] of from.cards) into.cards.set(id, shiftRect(rect, dx, dy));
	into.boxes.push(...from.boxes.map((box) => shiftBox(box, dx, dy)));
	into.links.push(
		...from.links.map((link) => ({
			...link,
			points: link.points.map((point) => shiftPoint(point, dx, dy)),
		})),
	);
	into.regions.push(
		...from.regions.map((region) => ({ ...region, frame: shiftRect(region.frame, dx, dy) })),
	);
	for (const [id, info] of from.rows) into.rows.set(id, info);
}

function extent(boxes: readonly EdgeBox[]): EdgeBox {
	return {
		x0: Math.min(...boxes.map((box) => box.x0)),
		x1: Math.max(...boxes.map((box) => box.x1)),
		y0: Math.min(...boxes.map((box) => box.y0)),
		y1: Math.max(...boxes.map((box) => box.y1)),
	};
}

const isLeaf = (node: OrgTreeNode) => node.reports.length === 0 && node.assistants.length === 0;
/** A manager of leaves alone, without assistants. */
const leadsLeaves = (node: OrgTreeNode) =>
	node.assistants.length === 0 && node.reports.length > 0 && node.reports.every(isLeaf);
/**
 * A manager whose reports are leaves or lead leaves may list them in columns
 * along their stem, each report's team indented under them, instead of a row:
 * the lowest two levels read as an outline.
 */
export const canOutline = (node: OrgTreeNode) =>
	node.reports.length >= 2 &&
	node.reports.some(leadsLeaves) &&
	node.reports.every((report) => isLeaf(report) || leadsLeaves(report)) &&
	node.reports.every((report) => report.region === undefined);

/**
 * Leaves stacked along a spine at x 0, the first card's top at y 0: one
 * column to the spine's right, or two either side of it in reading order.
 */
function stackBlock(
	leaves: readonly OrgTreeNode[],
	column?: 1 | -1,
	twoColumnsFrom = TWO_COLUMNS,
): Block {
	const block = emptyBlock();
	const twoColumns = column === undefined && leaves.length >= twoColumnsFrom;
	let y = 0;
	leaves.forEach((leaf, index) => {
		const side = column ?? (twoColumns && index % 2 === 0 ? -1 : 1);
		const x = side === 1 ? ORG_STUB : -ORG_STUB - leaf.width;
		addCard(block, leaf.id, { x, y, width: leaf.width, height: leaf.height });
		const middle = y + leaf.height / 2;
		block.tails.push({
			report: leaf.id,
			points: [
				{ x: 0, y: middle },
				{ x: side === 1 ? x : x + leaf.width, y: middle },
			],
		});
		if (!twoColumns || side === 1 || index === leaves.length - 1) y += leaf.height + STACK_GAP;
	});
	// The spine, from the bus above down to the last card, keeps neighbors off it too.
	const lastMiddle = Math.max(...block.tails.map((tail) => tail.points[0]!.y));
	block.boxes.push({ x0: -1, x1: 1, y0: -ORG_LEVEL_GAP / 2, y1: lastMiddle });
	return block;
}

/** Hang a block's tails from a point: the manager's stem, through `via`, to each report. */
function hang(
	into: Block,
	manager: string,
	from: OrgPoint,
	via: readonly OrgPoint[],
	tails: Block["tails"],
	dx: number,
	dy: number,
): void {
	for (const tail of tails)
		addLink(into, manager, tail.report, [
			from,
			...via,
			...tail.points.map((point) => shiftPoint(point, dx, dy)),
		]);
}

/** Width of consecutive items packed side by side, gaps included. */
function span(widths: readonly number[], from: number, to: number): number {
	let sum = 0;
	for (let index = from; index < to; index += 1) sum += widths[index]!;
	return sum + SIBLING_GAP * Math.max(0, to - from - 1);
}

/**
 * Where a row the trunk runs down through splits into the items left of it
 * and those right of it: as even as the items allow, so the row reaches no
 * farther either side than it must. A single item hangs right.
 */
function splitAtTrunk(widths: readonly number[], from: number, to: number) {
	let best = { split: from, half: span(widths, from, to), imbalance: span(widths, from, to) };
	for (let split = from + 1; split < to; split += 1) {
		const left = span(widths, from, split);
		const right = span(widths, split, to);
		const half = Math.max(left, right);
		const imbalance = Math.abs(left - right);
		if (half < best.half - 1e-9 || (half < best.half + 1e-9 && imbalance < best.imbalance - 1e-9))
			best = { split, half, imbalance };
	}
	return best;
}

/**
 * Split items into `count` consecutive rows hung from a trunk: every row but
 * the last splits either side of it, the last centers under it. The rows
 * reach as little as they can either side of the trunk, then as evenly.
 */
function partition<T>(items: readonly T[], widths: readonly number[], count: number): T[][] {
	const n = items.length;
	type Cost = { half: number; imbalance: number; cut: number };
	const better = (a: Cost, b: Cost | undefined) =>
		!b || a.half < b.half - 1e-9 || (a.half < b.half + 1e-9 && a.imbalance < b.imbalance - 1e-9);
	// best[k][i]: rows k of the first i items, none of them the last row.
	const best: (Cost | undefined)[][] = Array.from({ length: count + 1 }, () =>
		Array.from({ length: n + 1 }, () => undefined),
	);
	best[0]![0] = { half: 0, imbalance: 0, cut: 0 };
	for (let k = 1; k < count; k += 1)
		for (let i = k; i <= n - (count - k); i += 1)
			for (let j = k - 1; j < i; j += 1) {
				const before = best[k - 1]![j];
				if (!before) continue;
				const row = splitAtTrunk(widths, j, i);
				const cost = {
					half: Math.max(before.half, row.half),
					imbalance: before.imbalance + row.imbalance,
					cut: j,
				};
				if (better(cost, best[k]![i])) best[k]![i] = cost;
			}
	let last: Cost | undefined;
	for (let j = count - 1; j < n; j += 1) {
		const before = best[count - 1]![j];
		if (!before) continue;
		const cost = {
			half: Math.max(before.half, span(widths, j, n) / 2),
			imbalance: before.imbalance,
			cut: j,
		};
		if (better(cost, last)) last = cost;
	}
	const groups: T[][] = [items.slice(last!.cut)];
	let end = last!.cut;
	for (let k = count - 1; k >= 1; k -= 1) {
		const start = best[k]![end]!.cut;
		groups.unshift(items.slice(start, end));
		end = start;
	}
	return groups;
}

interface Item {
	readonly block: Block;
	readonly width: number;
	/** The report at the top of a subtree; none for a stack of leaves. */
	readonly root?: string;
}

/**
 * Pack a row of items left to right in local coordinates, each as close to
 * the one before as their shapes allow, and return each item's x offset.
 */
function packRow(items: readonly Item[], placed: EdgeBox[] = []): number[] {
	const offsets: number[] = [];
	for (const item of items) {
		const clearance = clearanceRight(placed, item.block.boxes, SIBLING_GAP, ROW_SLACK);
		const dx = Number.isFinite(clearance) ? clearance : offsets.length === 0 ? 0 : -Infinity;
		const offset = Number.isFinite(dx)
			? dx
			: Math.max(...placed.map((box) => box.x1)) + SIBLING_GAP - extent(item.block.boxes).x0;
		offsets.push(offset);
		placed.push(...item.block.boxes.map((box) => shiftBox(box, offset, 0)));
	}
	return offsets;
}

/** Pack items leftward from `placed`, the last item nearest it, and return each item's x offset. */
function packLeft(items: readonly Item[], placed: EdgeBox[]): number[] {
	const offsets: number[] = Array.from({ length: items.length }, () => 0);
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index]!;
		const clearance = clearanceLeft(placed, item.block.boxes, SIBLING_GAP, ROW_SLACK);
		const offset = Number.isFinite(clearance)
			? clearance
			: Math.min(...placed.map((box) => box.x0)) - SIBLING_GAP - extent(item.block.boxes).x1;
		offsets[index] = offset;
		placed.push(...item.block.boxes.map((box) => shiftBox(box, offset, 0)));
	}
	return offsets;
}

/** Draw a region around a department root's subtree, its frame clear of the line into it. */
function wrapRegion(block: Block, node: OrgTreeNode): Block {
	if (!node.region) return block;
	const inner = extent(block.boxes);
	const frame: EdgeBox = {
		// The name, painted above the frame's left corner, ends short of the line that drops in.
		x0: Math.min(
			inner.x0 - REGION_PAD,
			block.attach - REGION_LINE_CLEARANCE - node.region.nameWidth - 2 * REGION_NAME_CLEARANCE,
		),
		x1: inner.x1 + REGION_PAD,
		y0: inner.y0 - REGION_PAD,
		y1: inner.y1 + REGION_PAD,
	};
	const top = frame.y0 - REGION_NAME_HEIGHT - REGION_NAME_CLEARANCE;
	return {
		...block,
		boxes: [
			{ ...frame, x0: frame.x0 - REGION_SIDE_ROOM, x1: frame.x1 + REGION_SIDE_ROOM, y0: top },
		],
		regions: [
			...block.regions,
			{
				root: node.id,
				label: node.region.label,
				frame: {
					x: frame.x0,
					y: frame.y0,
					width: frame.x1 - frame.x0,
					height: frame.y1 - frame.y0,
				},
				members: [...block.cards.keys()],
			},
		],
		top,
	};
}

/**
 * Lay out a subtree with its root's card centered on x 0 and its top at y 0.
 * `column` marks a report listed beside its manager's stem, on that side: its
 * own leaves stack in one column, hanging away from the stem.
 */
function layoutNode(node: OrgTreeNode, policy: Policy, inRegion: boolean, column?: 1 | -1): Block {
	const block = emptyBlock();
	const { width, height } = node;
	addCard(block, node.id, { x: -width / 2, y: 0, width, height });
	block.tails.push({ report: node.id, points: [{ x: 0, y: 0 }] });
	const stem: OrgPoint = { x: 0, y: height };
	const allLeaves = node.reports.length > 0 && node.reports.every(isLeaf);
	const stacked =
		allLeaves &&
		(column !== undefined ||
			(node.reports.length >= policy.stackMin && node.reports.length <= MAX_STACK));
	const oneColumn = stacked && (column !== undefined || node.reports.length < policy.twoColumns);
	let base = height;
	// Assistants hang off the stem, alternating right and left, or all right of the
	// spine of a one-column stack or list near the manager's left edge.
	const outline = canOutline(node) ? policy.outline.get(node.id) : undefined;
	const rightOnly = oneColumn || outline === 1 || (outline === 2 && node.reports.length < 3);
	node.assistants.forEach((assistant, index) => {
		const side = rightOnly || index % 2 === 0 ? 1 : -1;
		const row = rightOnly ? index : Math.floor(index / 2);
		const y = height + ASSIST_GAP + row * (assistant.height + STACK_GAP);
		const x = side === 1 ? ASSIST_STUB : -ASSIST_STUB - assistant.width;
		addCard(block, assistant.id, { x, y, width: assistant.width, height: assistant.height });
		const middle = y + assistant.height / 2;
		addLink(block, node.id, assistant.id, [
			stem,
			{ x: 0, y: middle },
			{ x: side === 1 ? x : x + assistant.width, y: middle },
		]);
		base = Math.max(base, y + assistant.height);
	});
	if (node.reports.length === 0) return block;
	const regions = inRegion || node.region !== undefined;
	if (stacked) {
		// The stack hangs straight from the manager: from the stem, or for one column
		// from a spine near the manager's left edge.
		const side = column ?? 1;
		const stack = stackBlock(node.reports, oneColumn ? side : undefined, policy.twoColumns);
		const spine = oneColumn ? side * (-width / 2 + INDENT) : 0;
		const top = base + STACK_TOP;
		merge(block, { ...stack, links: [], regions: [], rows: new Map(), tails: [] }, spine, top);
		hang(block, node.id, { x: spine, y: height }, [], stack.tails, spine, top);
		return block;
	}
	if (outline !== undefined) {
		// Reports listed along the stem in reading order, left then right, each with its
		// team indented under it.
		const twoColumns = outline === 2 && node.reports.length >= 3;
		const spine = twoColumns ? 0 : -width / 2 + INDENT;
		// Each column fills on its own, so a short team never leaves a hole beside a long one.
		const next = new Map<1 | -1, number>([
			[1, base + STACK_TOP],
			[-1, base + STACK_TOP],
		]);
		node.reports.forEach((report, index) => {
			const side: 1 | -1 = twoColumns && index % 2 === 0 ? -1 : 1;
			const top = next.get(side)!;
			const child = layoutNode(report, policy, regions, side);
			const dx = spine + side * (ORG_STUB + report.width / 2);
			merge(block, child, dx, top);
			const middle = top + report.height / 2;
			addLink(block, node.id, report.id, [
				{ x: spine, y: height },
				{ x: spine, y: middle },
				{ x: dx - (side * report.width) / 2, y: middle },
			]);
			next.set(side, top + extent(child.boxes).y1 + STACK_GAP);
		});
		return block;
	}
	// A row of reports below a bus; a mixed row stacks its leaves as one item.
	const leaves = node.reports.filter(isLeaf);
	const groupLeaves = leaves.length >= policy.stackMin;
	// Too many leaves for one stack split evenly into stacks side by side.
	const stacks = Math.ceil(leaves.length / MAX_STACK);
	const items: Item[] = [];
	for (const report of node.reports) {
		if (groupLeaves && isLeaf(report)) {
			if (report === leaves[0])
				for (let index = 0; index < stacks; index += 1) {
					const stack = stackBlock(
						leaves.slice(
							Math.round((index * leaves.length) / stacks),
							Math.round(((index + 1) * leaves.length) / stacks),
						),
						undefined,
						policy.twoColumns,
					);
					items.push({ block: stack, width: widthOf(stack) });
				}
			continue;
		}
		const child = layoutNode(report, policy, regions);
		const wrapped = regions ? child : wrapRegion(child, report);
		items.push({ block: wrapped, width: widthOf(wrapped), root: report.id });
	}
	const rowCount = Math.max(1, Math.min(policy.rows.get(node.id) ?? 1, items.length));
	const rows = partition(
		items,
		items.map((item) => item.width),
		rowCount,
	);
	let busTop = base;
	let rowWidth = 0;
	rows.forEach((row, rowIndex) => {
		const last = rowIndex === rows.length - 1;
		let offsets: number[];
		if (last) {
			offsets = packRow(row);
			const attaches = row.map((item, index) => offsets[index]! + item.block.attach);
			const center = (Math.min(...attaches) + Math.max(...attaches)) / 2;
			offsets = offsets.map((offset) => offset - center);
		} else {
			// The trunk carries on down between this row's left and right halves.
			const widths = row.map((item) => item.width);
			const { split } = splitAtTrunk(widths, 0, row.length);
			const trunk: EdgeBox = { x0: -1, x1: 1, y0: -1e6, y1: 1e6 };
			offsets = [...packLeft(row.slice(0, split), [trunk]), ...packRow(row.slice(split), [trunk])];
		}
		// Every report of a row tops out level; a region's name rises above its root.
		const overhang = Math.max(0, ...row.map((item) => -item.block.top));
		const bus = busTop + ORG_LEVEL_GAP / 2;
		const rootTop = busTop + ORG_LEVEL_GAP + overhang;
		const placed: EdgeBox[] = [];
		row.forEach((item, index) => {
			const dx = offsets[index]!;
			merge(block, item.block, dx, rootTop);
			hang(
				block,
				node.id,
				stem,
				[
					{ x: 0, y: bus },
					{ x: dx + item.block.attach, y: bus },
				],
				item.block.tails,
				dx,
				rootTop,
			);
			placed.push(...item.block.boxes.map((box) => shiftBox(box, dx, rootTop)));
		});
		const span = extent(placed);
		rowWidth = Math.max(rowWidth, span.x1 - span.x0);
		busTop = span.y1;
	});
	const widest = items.reduce((best, item) => (item.width > best.width ? item : best));
	block.rows.set(node.id, {
		width: rowWidth,
		widestItem: widest.width,
		widest: widest.root,
		items: items.length,
		rows: rows.length,
	});
	return block;
}

function widthOf(block: Block): number {
	const box = extent(block.boxes);
	return box.x1 - box.x0;
}

/** Lay out every tree side by side, then move the drawing so its top-left corner is at the origin. */
function place(roots: readonly OrgTreeNode[], policy: Policy): Block {
	const blocks = roots.map((root) => layoutNode(root, policy, false));
	const forest = emptyBlock();
	const placed: EdgeBox[] = [];
	for (const block of blocks) {
		const clearance = clearanceRight(placed, block.boxes, ROOT_GAP, ROW_SLACK);
		const dx = Number.isFinite(clearance) ? clearance : 0;
		merge(forest, block, dx, 0);
		placed.push(...block.boxes.map((box) => shiftBox(box, dx, 0)));
	}
	const all = extent(drawnBoxes(forest));
	const moved = emptyBlock();
	merge(moved, forest, -all.x0, -all.y0);
	return moved;
}

/** Everything the export frames: cards, connectors, and region frames with their names. */
function drawnBoxes(block: Block): EdgeBox[] {
	return [
		...[...block.cards.values()].map(rectBox),
		...block.links.flatMap((link) => lineBoxes(link.points)),
		...block.regions.map((region) => ({
			...rectBox(region.frame),
			y0: region.frame.y - REGION_NAME_HEIGHT - REGION_NAME_CLEARANCE,
		})),
	];
}

function aspectOf(block: Block): number {
	const box = extent(drawnBoxes(block));
	return (box.x1 - box.x0 + 2 * EXPORT_PADDING) / (box.y1 - box.y0 + 2 * EXPORT_PADDING);
}

/** How far a placement reads outside the aspect band; 1 or less is inside it. */
function aspectPenalty(block: Block): number {
	const aspect = aspectOf(block);
	return Math.max(aspect / ORG_MAX_ASPECT, MIN_ASPECT / aspect);
}

/** The exported PNG's area: the drawing, its padding and the title band above it. */
function areaOf(block: Block): number {
	const box = extent(drawnBoxes(block));
	return (box.x1 - box.x0 + 2 * PNG_PADDING) * (box.y1 - box.y0 + 2 * PNG_PADDING + TITLE_BAND);
}

/** How far a placement reads outside both bounds, aspect and area; 1 when inside both. */
function excess(block: Block): number {
	return Math.max(1, aspectPenalty(block)) * Math.max(1, areaOf(block) / AREA_BUDGET);
}

/**
 * Place an org chart: the most tree-like placement whose export reads no wider
 * than ORG_MAX_ASPECT and fits a PNG. Leaf reports stack from five. A chart
 * that does not fit first stacks every group of two or more leaves, then wraps
 * one row at a time into one more row: of the rows no single subtree dominates,
 * those that would narrow most, keeping the wrap that fits on the narrowest
 * subtrees, or else the one that reads best, until it fits or nothing helps.
 */
export function layoutOrgChart(roots: readonly OrgTreeNode[]): OrgLayout {
	let policy: Policy = {
		stackMin: HARD_STACK_MIN,
		twoColumns: TWO_COLUMNS,
		outline: new Map(),
		rows: new Map(),
	};
	let best = place(roots, policy);
	let attempts = 1;
	if (excess(best) > 1) {
		const compact = { ...policy, stackMin: MIN_STACK };
		const stacked = place(roots, compact);
		attempts += 1;
		if (excess(stacked) < excess(best) - 1e-9) [policy, best] = [compact, stacked];
	}
	const depthOf = new Map<string, number>();
	const outlinable: string[] = [];
	const visit = (node: OrgTreeNode, depth: number) => {
		depthOf.set(node.id, depth);
		// The top two levels keep their row, so the chart's leaders read as ranks.
		if (depth >= 1 && canOutline(node)) outlinable.push(node.id);
		for (const report of node.reports) visit(report, depth + 1);
	};
	for (const root of roots) visit(root, 0);
	/** Try each candidate policy and keep the one that fits best, or reads best if none fits. */
	const tryAll = (candidates: readonly { policy: Policy; preference: number }[]) => {
		let next: { policy: Policy; block: Block; excess: number; preference: number } | undefined;
		for (const { policy: candidate, preference } of candidates) {
			const block = place(roots, candidate);
			attempts += 1;
			const entry = { policy: candidate, block, excess: excess(block), preference };
			const better =
				!next ||
				(entry.excess <= 1 && next.excess <= 1
					? entry.preference < next.preference - 1e-9
					: entry.excess < next.excess - 1e-9);
			if (better) next = entry;
		}
		return next && next.excess < excess(best) - 1e-6 ? next : undefined;
	};
	for (let step = 0; step < MAX_STEPS && excess(best) > 1; step += 1) {
		const rows = best.rows;
		// First stack more leaves in one column; then list the widest small teams along
		// their manager's stem, in two columns and then one, deepest first. Every level
		// above keeps its row, and each report stays beside its manager.
		const narrower =
			policy.twoColumns <= ONE_COLUMN_MOST
				? tryAll([{ policy: { ...policy, twoColumns: ONE_COLUMN_MOST + 1 }, preference: 0 }])
				: undefined;
		if (narrower) {
			[policy, best] = [narrower.policy, narrower.block];
			continue;
		}
		const widestFirst = (left: string, right: string) =>
			(rows.get(right)?.width ?? 0) - (rows.get(left)?.width ?? 0) || left.localeCompare(right);
		const outlines = [
			...outlinable
				.filter((id) => !policy.outline.has(id) && rows.has(id))
				.toSorted(widestFirst)
				.slice(0, WRAP_CANDIDATES)
				.map((id) => ({
					policy: { ...policy, outline: new Map(policy.outline).set(id, 2 as const) },
					preference: -depthOf.get(id)!,
				})),
			...[...policy.outline]
				.filter(([, columns]) => columns === 2)
				.map(([id]) => id)
				.slice(0, WRAP_CANDIDATES)
				.map((id) => ({
					policy: { ...policy, outline: new Map(policy.outline).set(id, 1 as const) },
					preference: 1 - depthOf.get(id)!,
				})),
		];
		const outlined = tryAll(outlines);
		if (outlined) {
			[policy, best] = [outlined.policy, outlined.block];
			continue;
		}
		// Then wrap rows: of the rows no single subtree dominates, those that would narrow
		// most, and the rows down the chain of widest subtrees, whose width the chart's rests
		// on; rows below the top before the top's own.
		const open = ([, info]: [string, RowInfo]) => info.items > info.rows;
		const narrowing = [...rows]
			.filter((entry) => open(entry) && entry[1].widestItem < DOMINANT * entry[1].width)
			.toSorted(
				([leftId, left], [rightId, right]) =>
					right.width - right.widestItem - (left.width - left.widestItem) ||
					leftId.localeCompare(rightId),
			)
			.slice(0, WRAP_CANDIDATES);
		const chain: [string, RowInfo][] = [];
		for (const root of roots) {
			let id: string | undefined = root.id;
			while (id !== undefined && rows.has(id)) {
				chain.push([id, rows.get(id)!]);
				id = rows.get(id)!.widest;
			}
		}
		const wrappable = [
			...narrowing,
			...chain
				.filter(open)
				.filter(([id]) => !narrowing.some(([other]) => other === id))
				.slice(0, WRAP_CANDIDATES),
		];
		const wrap = (entries: readonly [string, RowInfo][]) =>
			tryAll(
				entries.map(([id, info]) => ({
					policy: { ...policy, rows: new Map(policy.rows).set(id, info.rows + 1) },
					// Of the wraps that fit, the one on the narrowest subtrees keeps the tree whole.
					preference: info.widestItem,
				})),
			);
		const wrapped =
			wrap(wrappable.filter(([id]) => depthOf.get(id)! >= 1)) ??
			wrap(wrappable.filter(([id]) => depthOf.get(id) === 0));
		if (!wrapped) break;
		[policy, best] = [wrapped.policy, wrapped.block];
	}
	// A wrap an earlier step needed may be one a later wrap made unnecessary: unwrap
	// each row, last wrapped first, while the chart still fits as well.
	for (const id of [...policy.rows.keys()].toReversed()) {
		for (let rows = policy.rows.get(id)! - 1; rows >= 1; rows -= 1) {
			const candidate = { ...policy, rows: new Map(policy.rows).set(id, rows) };
			const block = place(roots, candidate);
			attempts += 1;
			if (excess(block) > Math.max(1, excess(best)) + 1e-9) break;
			policy = candidate;
			best = block;
		}
	}
	const box = extent(drawnBoxes(best));
	return {
		cards: best.cards,
		links: best.links,
		regions: best.regions,
		width: box.x1 - box.x0,
		height: box.y1 - box.y0,
		attempts,
		stackMin: policy.stackMin,
		wraps: new Map([...policy.rows].filter(([, rows]) => rows > 1)),
		outlines: policy.outline,
	};
}
