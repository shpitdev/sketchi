/**
 * Navigation arrows between wireframe screens: the cheapest orthogonal route
 * from a control's side to an outside edge of the screen it opens, clear of
 * every other screen, every screen's name, and everything on the control's
 * own screen but the containers around it. The search runs on a sparse grid
 * through every obstacle's edges and the middle of every channel between
 * them, so a route finds any gap a line fits through. Each bend costs, so
 * routes stay short and straight; earlier routes cost to run along, so arrows
 * keep apart.
 */

export interface NavigationBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface NavigationPoint {
	readonly x: number;
	readonly y: number;
}

export interface NavigationRequest {
	/** The control's box; the route leaves through its left or right side. */
	readonly source: NavigationBox;
	/** The screen's frame the route ends on. */
	readonly target: NavigationBox;
	/** Boxes the route keeps clear of. */
	readonly obstacles: readonly NavigationBox[];
}

/** How far a route keeps from an obstacle. */
const CLEARANCE = 4;
/** What a bend costs, in pixels of length. */
const BEND = 48;
/** Running along an earlier route costs this much per pixel more; crossing one, a little. */
const ALONG = 60;
const ACROSS = 16;
/** Two routes this close run along each other. */
const NEAR = 6;
/** Where an arrow may meet a frame: away from its corners. */
const EDGE_MARGIN = 24;
/** How far a route runs straight before it meets its frame, so its head has room. */
const APPROACH = 28;
/** Grid lines through wide empty space, so a route need not hug an obstacle. */
const SPACING = 96;
/** Grid states one route may expand before it gives up. */
const BUDGET = 400_000;

const MOVES = [
	{ dx: 1, dy: 0 },
	{ dx: 0, dy: 1 },
	{ dx: -1, dy: 0 },
	{ dx: 0, dy: -1 },
] as const;

interface Rect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** A binary min-heap of grid states by cost. */
class Heap {
	private readonly items: { cost: number; state: number }[] = [];
	get size(): number {
		return this.items.length;
	}
	push(cost: number, state: number): void {
		const items = this.items;
		items.push({ cost, state });
		let at = items.length - 1;
		while (at > 0) {
			const parent = (at - 1) >> 1;
			if (items[parent]!.cost <= items[at]!.cost) break;
			[items[parent], items[at]] = [items[at]!, items[parent]!];
			at = parent;
		}
	}
	pop(): { cost: number; state: number } {
		const items = this.items;
		const top = items[0]!;
		const last = items.pop()!;
		if (items.length > 0) {
			items[0] = last;
			let at = 0;
			for (;;) {
				const left = 2 * at + 1;
				const right = left + 1;
				let least = at;
				if (left < items.length && items[left]!.cost < items[least]!.cost) least = left;
				if (right < items.length && items[right]!.cost < items[least]!.cost) least = right;
				if (least === at) break;
				[items[least], items[at]] = [items[at]!, items[least]!];
				at = least;
			}
		}
		return top;
	}
}

/** Drop repeated points and the middle of every three collinear ones. */
function simplify(points: readonly NavigationPoint[]): NavigationPoint[] {
	const kept: NavigationPoint[] = [];
	for (const point of points) {
		const last = kept.at(-1);
		if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) continue;
		const before = kept.at(-2);
		if (
			before &&
			last &&
			((Math.abs(before.x - last.x) < 0.01 && Math.abs(last.x - point.x) < 0.01) ||
				(Math.abs(before.y - last.y) < 0.01 && Math.abs(last.y - point.y) < 0.01))
		)
			kept.pop();
		kept.push(point);
	}
	return kept;
}

const holds = (outer: NavigationBox, inner: NavigationBox) =>
	inner.x >= outer.x &&
	inner.y >= outer.y &&
	inner.x + inner.width <= outer.x + outer.width &&
	inner.y + inner.height <= outer.y + outer.height;

/** Boxes not inside another: the rest add nothing to block. */
function outermost(boxes: readonly NavigationBox[]): NavigationBox[] {
	return boxes.filter(
		(box, index) =>
			!boxes.some(
				(other, at) => at !== index && holds(other, box) && (!holds(box, other) || at < index),
			),
	);
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Sorted coordinates within `low`–`high`, with lines added through the middle of every gap. */
function lines(values: readonly number[], low: number, high: number): number[] {
	const sorted = [...new Set(values.map(round))]
		.filter((value) => value >= low && value <= high)
		.toSorted((a, b) => a - b);
	const filled: number[] = [];
	for (const [index, value] of sorted.entries()) {
		const previous = sorted[index - 1];
		if (previous !== undefined) {
			const gap = value - previous;
			const pieces = Math.max(2, Math.ceil(gap / SPACING));
			for (let piece = 1; piece < pieces; piece += 1)
				filled.push(round(previous + (gap * piece) / pieces));
		}
		filled.push(value);
	}
	return filled;
}

/**
 * What a step costs beside earlier routes: running along one within NEAR
 * costs per pixel of overlap, and crossing one a little.
 */
function crowding(
	from: NavigationPoint,
	to: NavigationPoint,
	routed: readonly NavigationPoint[][],
): number {
	const horizontal = Math.abs(from.y - to.y) < 0.01;
	const low = horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
	const high = horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
	const fixed = horizontal ? from.y : from.x;
	let cost = 0;
	for (const route of routed)
		for (let index = 1; index < route.length; index += 1) {
			const a = route[index - 1]!;
			const b = route[index]!;
			const otherHorizontal = Math.abs(a.y - b.y) < 0.01;
			const otherLow = otherHorizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
			const otherHigh = otherHorizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
			const otherFixed = otherHorizontal ? a.y : a.x;
			if (otherHorizontal === horizontal) {
				if (Math.abs(otherFixed - fixed) >= NEAR) continue;
				const overlap = Math.min(high, otherHigh) - Math.max(low, otherLow);
				if (overlap > 0) cost += overlap * ALONG;
			} else if (otherFixed >= low && otherFixed <= high && fixed >= otherLow && fixed <= otherHigh)
				cost += ACROSS;
		}
	return cost;
}

/**
 * Route every request in order, each clear of the ones before it. A request
 * no search can place comes back undefined.
 */
export function routeNavigations(
	requests: readonly NavigationRequest[],
	area: NavigationBox,
): (NavigationPoint[] | undefined)[] {
	const routed: NavigationPoint[][] = [];
	return requests.map((request) => {
		const route = routeOne(request, area, routed);
		if (route) routed.push(route);
		return route;
	});
}

function routeOne(
	request: NavigationRequest,
	area: NavigationBox,
	routed: readonly NavigationPoint[][],
): NavigationPoint[] | undefined {
	const { source, target } = request;
	const middle = round(source.y + source.height / 2);
	const blocks: Rect[] = outermost([...request.obstacles, source]).map((box) => ({
		left: box.x - CLEARANCE,
		top: box.y - CLEARANCE,
		right: box.x + box.width + CLEARANCE,
		bottom: box.y + box.height + CLEARANCE,
	}));
	const goal: Rect = {
		left: round(target.x),
		top: round(target.y),
		right: round(target.x + target.width),
		bottom: round(target.y + target.height),
	};
	const exitRight = round(source.x + source.width + CLEARANCE);
	const exitLeft = round(source.x - CLEARANCE);
	const xs = lines(
		[
			area.x,
			area.x + area.width,
			exitLeft,
			exitRight,
			goal.left,
			goal.right,
			goal.left + EDGE_MARGIN,
			goal.right - EDGE_MARGIN,
			goal.left - APPROACH,
			goal.right + APPROACH,
			...blocks.flatMap((block) => [block.left, block.right]),
		],
		area.x,
		area.x + area.width,
	);
	const ys = lines(
		[
			area.y,
			area.y + area.height,
			middle,
			goal.top,
			goal.bottom,
			goal.top + EDGE_MARGIN,
			goal.bottom - EDGE_MARGIN,
			goal.top - APPROACH,
			goal.bottom + APPROACH,
			...blocks.flatMap((block) => [block.top, block.bottom]),
		],
		area.y,
		area.y + area.height,
	);
	const columns = xs.length;
	const rows = ys.length;
	const at = (i: number, j: number) => j * columns + i;
	const inside = (rect: Rect, x: number, y: number) =>
		x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
	const blocked = (x: number, y: number) =>
		inside(goal, x, y) || blocks.some((block) => inside(block, x, y));
	const onGoal = (x: number, y: number) =>
		x >= goal.left && x <= goal.right && y >= goal.top && y <= goal.bottom && !inside(goal, x, y);
	const free = new Uint8Array(columns * rows);
	for (let j = 0; j < rows; j += 1)
		for (let i = 0; i < columns; i += 1) free[at(i, j)] = blocked(xs[i]!, ys[j]!) ? 0 : 1;
	// Neighboring grid lines leave no obstacle edge between them, so a step's middle decides.
	const stepClear = (x0: number, y0: number, x1: number, y1: number) =>
		!blocked((x0 + x1) / 2, (y0 + y1) / 2);
	const best = new Float64Array(columns * rows * 4).fill(Number.POSITIVE_INFINITY);
	const previous = new Int32Array(columns * rows * 4).fill(-1);
	// How far each state has run straight, for the approach into the frame.
	const run = new Float64Array(columns * rows * 4);
	const heap = new Heap();
	const estimate = (x: number, y: number) =>
		Math.max(0, goal.left - x, x - goal.right) + Math.max(0, goal.top - y, y - goal.bottom);
	const sj = ys.indexOf(middle);
	const start = (x: number, direction: number) => {
		const i = xs.indexOf(x);
		if (i < 0 || sj < 0 || !free[at(i, sj)]) return;
		const state = at(i, sj) * 4 + direction;
		best[state] = 0;
		heap.push(estimate(x, middle), state);
	};
	start(exitRight, 0);
	start(exitLeft, 2);
	let expanded = 0;
	let finish: { state: number; end: NavigationPoint } | undefined;
	let finishCost = Number.POSITIVE_INFINITY;
	while (heap.size > 0 && expanded < BUDGET) {
		const { cost, state } = heap.pop();
		if (cost >= finishCost) break;
		const spent = best[state]!;
		const node = Math.floor(state / 4);
		const direction = state % 4;
		const i = node % columns;
		const j = Math.floor(node / columns);
		const x = xs[i]!;
		const y = ys[j]!;
		if (cost - estimate(x, y) > spent + 1e-6) continue;
		expanded += 1;
		for (const [turn, move] of MOVES.entries()) {
			if ((turn + 2) % 4 === direction) continue;
			const ni = i + move.dx;
			const nj = j + move.dy;
			if (ni < 0 || nj < 0 || ni >= columns || nj >= rows) continue;
			const nx = xs[ni]!;
			const ny = ys[nj]!;
			const length = Math.abs(nx - x) + Math.abs(ny - y);
			const bend = turn === direction ? 0 : BEND;
			const straight = (turn === direction ? run[state]! : 0) + length;
			if (onGoal(nx, ny)) {
				// The route meets the frame here: square to its edge, away from its corners, after a straight run.
				const square =
					(move.dx !== 0 && (nx === goal.left || nx === goal.right)) ||
					(move.dy !== 0 && (ny === goal.top || ny === goal.bottom));
				const clear =
					move.dx !== 0
						? ny >= goal.top + EDGE_MARGIN && ny <= goal.bottom - EDGE_MARGIN
						: nx >= goal.left + EDGE_MARGIN && nx <= goal.right - EDGE_MARGIN;
				const total = spent + bend + length;
				if (
					square &&
					clear &&
					straight >= APPROACH &&
					stepClear(x, y, nx, ny) &&
					total < finishCost
				) {
					finishCost = total;
					finish = { state, end: { x: nx, y: ny } };
				}
				continue;
			}
			const next = at(ni, nj);
			if (!free[next] || !stepClear(x, y, nx, ny)) continue;
			const nextState = next * 4 + turn;
			const total = spent + length + bend + crowding({ x, y }, { x: nx, y: ny }, routed);
			if (total < best[nextState]!) {
				best[nextState] = total;
				previous[nextState] = state;
				run[nextState] = straight;
				heap.push(total + estimate(nx, ny), nextState);
			}
		}
	}
	if (!finish) return undefined;
	const nodes: NavigationPoint[] = [];
	for (let state = finish.state; state >= 0; state = previous[state]!) {
		const node = Math.floor(state / 4);
		nodes.push({ x: xs[node % columns]!, y: ys[Math.floor(node / columns)]! });
	}
	nodes.reverse();
	const first = nodes[0]!;
	const exit = { x: first.x > source.x ? source.x + source.width : source.x, y: middle };
	return simplify([exit, ...nodes, finish.end]);
}
