/**
 * Orthogonal routing for Gantt dependencies: the cheapest elbow path between
 * a predecessor's and a successor's ports that keeps clear of every bar, label
 * and arrowhead, never runs along another dependency, and bends as little as it
 * can. Every pixel behind the predecessor's start costs extra, so a route goes
 * forward around an obstacle unless that is much longer.
 */

export interface RouteBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface RoutePoint {
	readonly x: number;
	readonly y: number;
}

/** 0 right, 1 down, 2 left, 3 up. */
export type RouteDirection = 0 | 1 | 2 | 3;

/** A point on a shape's outline and the direction a route leaves (or enters) it by. */
export interface RoutePort extends RoutePoint {
	readonly direction: RouteDirection;
	/** Preference: added to the route's cost when it uses this port. */
	readonly cost: number;
}

export interface RouteObstacle {
	readonly box: RouteBox;
	/** Routes keep this far outside the box; 0 lets them touch its edge. */
	readonly clearance: number;
	/** Clearance beside the box's left and right edges, when wider than above and below. */
	readonly sideClearance?: number;
	/** The route's own source or target: only the straight runs out of and into its ports cross its clearance. */
	readonly own?: boolean;
	/** Blocks only runs along the box's longer side; runs across it pass. */
	readonly parallel?: boolean;
}

export interface RouteSegment {
	readonly from: RoutePoint;
	readonly to: RoutePoint;
}

export interface RouteRequest {
	readonly sources: readonly RoutePort[];
	readonly targets: readonly RoutePort[];
	/** Bars, labels and earlier arrowheads: no run enters them. */
	readonly obstacles: readonly RouteObstacle[];
	/** Heights horizontal runs may use between ports, such as the gutters between rows. */
	readonly lanes: readonly number[];
	/** More, tighter heights, for when the lanes are full. */
	readonly denseLanes: readonly number[];
	/** Earlier routes: never run alongside, and crossed only at a cost. */
	readonly routed: readonly RouteSegment[];
	/**
	 * Runs of earlier routes that share this route's predecessor or successor. They may run
	 * beside it; any other route nearby reads as a doubled line and costs extra.
	 */
	readonly kin?: ReadonlySet<RouteSegment>;
	/** The last runs of earlier routes: crossing one, even behind its arrowhead, costs more. */
	readonly lastRuns?: ReadonlySet<RouteSegment>;
	/** Nothing routes above top or below bottom. */
	readonly top: number;
	readonly bottom: number;
	/** Search steps the whole chart may still spend; shared by its routes. */
	readonly budget?: { remaining: number };
	/** Where going back starts: each pixel of a run left of it costs extra. */
	readonly behind?: number;
}

/** A route leaves its source straight for this long, and enters its target straight from its port's approach. */
export const ROUTE_LEAD = 8;
/** Side entries run this far; the arrowhead takes half. */
export const ROUTE_APPROACH = 16;
/** Top and bottom entries run this far, from the gutter above or below. */
export const ROUTE_VERTICAL_APPROACH = 12;

/** How far a route runs straight into a port before it. */
export function routeApproach(direction: RouteDirection): number {
	return direction % 2 === 0 ? ROUTE_APPROACH : ROUTE_VERTICAL_APPROACH;
}
/** Parallel runs of different routes stay at least this far apart. */
export const ROUTE_SEPARATION = 5;
/** When the lanes are full, parallel runs keep at least this far apart; they never coincide. */
export const ROUTE_DENSE_SEPARATION = 2.5;
const BEND_COST = 24;
/** Each pixel a route runs back behind its source's start costs this much more. */
const BEHIND_COST = 4;
const CROSSING_COST = 30;
/** Runs within this distance of an unrelated parallel route cost extra per pixel beside it. */
const BESIDE_DISTANCE = 12;
const BESIDE_COST = 2;
/** Crossing another route while heading back left costs this many times more. */
const BACK_CROSSING_FACTOR = 8;
/** Crossing another route's last run, which leads the eye into its arrowhead, counts this many times. */
const LAST_RUN_CROSSING_FACTOR = 4;
/** The first search looks this far around the ports, then four times as far. */
const WINDOW_MARGIN = 200;
const WINDOW_ROWS = 90;
const FAR_COLUMNS = [0, 6, 12, 18, 24, 30];
/** A search gives up after this many steps, so one crowded plan cannot stall a build. */
const MAX_EXPANSIONS = 12_000;
/** Search steps one route may spend across its searches before it takes the caller's last resort. */
export const ROUTE_BUDGET = 12_000;
/** Search steps a chart may spend per dependency, and at most, before the rest take the last resort. */
export const ROUTE_CHART_BUDGET_PER_ROUTE = 6_000;
export const ROUTE_CHART_BUDGET = 160_000;

const DX = [1, 0, -1, 0] as const;
/** Straight on, then a turn either way: routes never reverse in place. */
const TURNS = [0, 1, 3] as const;
const DY = [0, 1, 0, -1] as const;

function step(point: RoutePoint, direction: RouteDirection, length: number): RoutePoint {
	return { x: point.x + DX[direction] * length, y: point.y + DY[direction] * length };
}

function sortedUnique(values: readonly number[]): number[] {
	const sorted = values.map((value) => Math.round(value * 100) / 100).toSorted((a, b) => a - b);
	return sorted.filter((value, index) => index === 0 || value - sorted[index - 1]! > 0.01);
}

/** A binary min-heap keyed by cost, then insertion order, so ties resolve deterministically. */
class Queue {
	private readonly items: { cost: number; reached: number; order: number; state: number }[] = [];
	private order = 0;

	get size(): number {
		return this.items.length;
	}

	/** Queue a state by its estimated total cost, noting the cost it was reached at. */
	push(cost: number, reached: number, state: number): void {
		const item = { cost, reached, order: this.order++, state };
		const items = this.items;
		items.push(item);
		let index = items.length - 1;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (!this.less(items[index]!, items[parent]!)) break;
			[items[index], items[parent]] = [items[parent]!, items[index]!];
			index = parent;
		}
	}

	pop(): { cost: number; reached: number; state: number } {
		const items = this.items;
		const top = items[0]!;
		const last = items.pop()!;
		if (items.length > 0) {
			items[0] = last;
			let index = 0;
			for (;;) {
				const left = index * 2 + 1;
				const right = left + 1;
				let smallest = index;
				if (left < items.length && this.less(items[left]!, items[smallest]!)) smallest = left;
				if (right < items.length && this.less(items[right]!, items[smallest]!)) smallest = right;
				if (smallest === index) break;
				[items[index], items[smallest]] = [items[smallest]!, items[index]!];
				index = smallest;
			}
		}
		return top;
	}

	private less(a: { cost: number; order: number }, b: { cost: number; order: number }): boolean {
		return a.cost < b.cost - 1e-9 || (Math.abs(a.cost - b.cost) <= 1e-9 && a.order < b.order);
	}
}

/** Whether a run at a fixed height or column enters an obstacle's cleared box. */
function blocksRun(
	obstacle: RouteObstacle,
	low: number,
	high: number,
	runHorizontal: boolean,
): boolean {
	const { box } = obstacle;
	if (obstacle.parallel && box.right - box.left >= box.bottom - box.top !== runHorizontal)
		return false;
	const clear = Math.max(0, obstacle.clearance - 0.01);
	const side = Math.max(0, (obstacle.sideClearance ?? obstacle.clearance) - 0.01);
	return runHorizontal
		? Math.min(high, box.right + side) - Math.max(low, box.left - side) > 0.01
		: Math.min(high, box.bottom + clear) - Math.max(low, box.top - clear) > 0.01;
}

/** Obstacles whose cleared box spans a line strictly: only they can block runs along it. */
function obstaclesOn(obstacles: readonly RouteObstacle[], at: number, runHorizontal: boolean) {
	return obstacles.filter(({ box, clearance, sideClearance }) => {
		const clear = Math.max(0, clearance - 0.01);
		const side = Math.max(0, (sideClearance ?? clearance) - 0.01);
		return runHorizontal
			? at > box.top - clear && at < box.bottom + clear
			: at > box.left - side && at < box.right + side;
	});
}

function blocksSegment(obstacle: RouteObstacle, from: RoutePoint, to: RoutePoint): boolean {
	const runHorizontal = Math.abs(from.y - to.y) < 0.01;
	const at = runHorizontal ? from.y : from.x;
	if (obstaclesOn([obstacle], at, runHorizontal).length === 0) return false;
	const low = runHorizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
	const high = runHorizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
	return blocksRun(obstacle, low, high, runHorizontal);
}

function horizontal(segment: RouteSegment): boolean {
	return Math.abs(segment.from.y - segment.to.y) < 0.01;
}

/** Whether a run lies along an earlier route closer than the separation. */
function alongside(
	from: RoutePoint,
	to: RoutePoint,
	segment: RouteSegment,
	separation = ROUTE_SEPARATION,
): boolean {
	const runHorizontal = Math.abs(from.y - to.y) < 0.01;
	if (runHorizontal !== horizontal(segment)) return false;
	const offset = runHorizontal
		? Math.abs(from.y - segment.from.y)
		: Math.abs(from.x - segment.from.x);
	if (offset >= separation) return false;
	const [low, high] = runHorizontal
		? [Math.min(from.x, to.x), Math.max(from.x, to.x)]
		: [Math.min(from.y, to.y), Math.max(from.y, to.y)];
	const [otherLow, otherHigh] = runHorizontal
		? [Math.min(segment.from.x, segment.to.x), Math.max(segment.from.x, segment.to.x)]
		: [Math.min(segment.from.y, segment.to.y), Math.max(segment.from.y, segment.to.y)];
	return Math.min(high, otherHigh) - Math.max(low, otherLow) > -separation;
}

function crosses(from: RoutePoint, to: RoutePoint, segment: RouteSegment): boolean {
	const runHorizontal = Math.abs(from.y - to.y) < 0.01;
	if (runHorizontal === horizontal(segment)) return false;
	const [h0, h1, v0, v1] = runHorizontal
		? [from, to, segment.from, segment.to]
		: [segment.from, segment.to, from, to];
	const x = v0.x;
	const y = h0.y;
	return (
		x > Math.min(h0.x, h1.x) + 0.01 &&
		x < Math.max(h0.x, h1.x) - 0.01 &&
		y > Math.min(v0.y, v1.y) + 0.01 &&
		y < Math.max(v0.y, v1.y) - 0.01
	);
}

function simplify(points: readonly RoutePoint[]): RoutePoint[] {
	const kept: RoutePoint[] = [];
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
			kept[kept.length - 1] = point;
		else kept.push(point);
	}
	return kept;
}

interface Window {
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
}

/** How a search may route: the gap between parallel runs, where runs may go, and what going back costs. */
interface Packing {
	readonly separation: number;
	readonly lanes: readonly number[];
	/** Extra columns between obstacle edges, as fractions of each gap. */
	readonly splits: readonly number[];
	readonly crossingCost: number;
	/** Each pixel of a run left of this x costs BEHIND_COST more. */
	readonly behind?: number;
}

function search(
	request: RouteRequest,
	window: Window,
	packing: Packing,
): { readonly points?: RoutePoint[]; readonly expansions: number } {
	const { obstacles, routed } = request;
	const { separation } = packing;
	const leads = request.sources.map((port) => step(port, port.direction, ROUTE_LEAD));
	const approaches = request.targets.map((port) =>
		step(port, ((port.direction + 2) % 4) as RouteDirection, routeApproach(port.direction)),
	);
	const portPoints = [...request.sources, ...request.targets, ...leads, ...approaches];
	// Obstacles a run could touch: those near the window, which holds every column and lane but the far ones.
	const reach = 8 + FAR_COLUMNS.at(-1)! + 2 * ROUTE_SEPARATION;
	const inWindow = obstacles.filter(
		({ box }) =>
			box.right >= window.left - reach &&
			box.left <= window.right + reach &&
			box.bottom >= window.top - reach &&
			box.top <= window.bottom + reach,
	);
	const edges = inWindow
		.filter(({ box }) => box.bottom >= window.top && box.top <= window.bottom)
		.flatMap(({ box, clearance, sideClearance }) => [
			box.left - Math.max(sideClearance ?? clearance, ROUTE_SEPARATION),
			box.right + Math.max(sideClearance ?? clearance, ROUTE_SEPARATION),
		])
		.filter((x) => x >= window.left && x <= window.right);
	// Several columns past everything in the window, so detours around it never queue for one.
	const portXs = portPoints.map((point) => point.x);
	const farLeft = Math.max(window.left, Math.min(...portXs, ...edges)) - 8;
	const farRight = Math.min(window.right, Math.max(...portXs, ...edges)) + 8;
	const columns = sortedUnique([
		...portXs,
		...edges,
		...FAR_COLUMNS.flatMap((offset) => [farLeft - offset, farRight + offset]),
	]);
	// Columns between obstacle edges give routes room to pass beside earlier ones.
	const xs = sortedUnique([
		...columns,
		...columns.slice(1).flatMap((x, index) => {
			const before = columns[index]!;
			return x - before > 4 * separation
				? packing.splits.map((split) => before + (x - before) * split)
				: [];
		}),
	]);
	const ys = sortedUnique([
		...portPoints.map((point) => point.y),
		...packing.lanes.filter((y) => y >= window.top && y <= window.bottom),
	]).filter((y) => y >= request.top && y <= request.bottom);
	const columnIndex = new Map(xs.map((x, index) => [x, index]));
	const rowIndex = new Map(ys.map((y, index) => [y, index]));
	const key = (point: RoutePoint) => {
		const x = columnIndex.get(Math.round(point.x * 100) / 100);
		const y = rowIndex.get(Math.round(point.y * 100) / 100);
		return x === undefined || y === undefined ? undefined : y * xs.length + x;
	};
	const points: RoutePoint[] = [];
	const pointOf = (node: number): RoutePoint =>
		(points[node] ??= { x: xs[node % xs.length]!, y: ys[Math.floor(node / xs.length)]! });
	// Only obstacles and earlier routes on a line can block or cross runs along it; each line's
	// share is gathered the first time the search reaches it, from the routes near the window.
	const reachRoutes = reach + BESIDE_DISTANCE;
	const nearRoutes = routed.filter(
		(segment) =>
			Math.max(segment.from.x, segment.to.x) >= window.left - reachRoutes &&
			Math.min(segment.from.x, segment.to.x) <= window.right + reachRoutes &&
			Math.max(segment.from.y, segment.to.y) >= window.top - reachRoutes &&
			Math.min(segment.from.y, segment.to.y) <= window.bottom + reachRoutes,
	);
	const levelRoutes = nearRoutes.filter(horizontal);
	const uprightRoutes = nearRoutes.filter((segment) => !horizontal(segment));
	type Line = { obstacles: RouteObstacle[]; routed: RouteSegment[]; beside: RouteSegment[] };
	const rowLines = new Map<number, Line>();
	const columnLines = new Map<number, Line>();
	const onLine = (at: number, runHorizontal: boolean): Line => {
		const cache = runHorizontal ? rowLines : columnLines;
		let found = cache.get(at);
		if (!found) {
			const [parallel, across] = runHorizontal
				? [levelRoutes, uprightRoutes]
				: [uprightRoutes, levelRoutes];
			const offset = (segment: RouteSegment) =>
				Math.abs(runHorizontal ? segment.from.y - at : segment.from.x - at);
			found = {
				obstacles: obstaclesOn(inWindow, at, runHorizontal),
				routed: [
					...parallel.filter((segment) => offset(segment) < separation),
					...across.filter((segment) =>
						runHorizontal
							? at > Math.min(segment.from.y, segment.to.y) &&
								at < Math.max(segment.from.y, segment.to.y)
							: at > Math.min(segment.from.x, segment.to.x) &&
								at < Math.max(segment.from.x, segment.to.x),
					),
				],
				beside: parallel.filter(
					(segment) => offset(segment) < BESIDE_DISTANCE && !request.kin?.has(segment),
				),
			};
			cache.set(at, found);
		}
		return found;
	};
	/** Whether a run is clear of every obstacle and of runs of earlier routes. */
	const free = (from: RoutePoint, to: RoutePoint, port = false) => {
		const runHorizontal = Math.abs(from.y - to.y) < 0.01;
		const line = onLine(runHorizontal ? from.y : from.x, runHorizontal);
		const low = runHorizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
		const high = runHorizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
		if (
			line.obstacles.some(
				(obstacle) => !(port && obstacle.own) && blocksRun(obstacle, low, high, runHorizontal),
			)
		)
			return false;
		return !line.routed.some((segment) => alongside(from, to, segment, separation));
	};
	const crossings = (from: RoutePoint, to: RoutePoint) => {
		const runHorizontal = Math.abs(from.y - to.y) < 0.01;
		const line = onLine(runHorizontal ? from.y : from.x, runHorizontal);
		let count = 0;
		for (const segment of line.routed)
			if (crosses(from, to, segment))
				count += request.lastRuns?.has(segment) ? LAST_RUN_CROSSING_FACTOR : 1;
		return count;
	};
	/** How far a run lies beside unrelated routes. */
	const besideLength = (from: RoutePoint, to: RoutePoint) => {
		const runHorizontal = Math.abs(from.y - to.y) < 0.01;
		const line = onLine(runHorizontal ? from.y : from.x, runHorizontal);
		const low = runHorizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
		const high = runHorizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
		let length = 0;
		for (const segment of line.beside) {
			const [otherLow, otherHigh] = runHorizontal
				? [Math.min(segment.from.x, segment.to.x), Math.max(segment.from.x, segment.to.x)]
				: [Math.min(segment.from.y, segment.to.y), Math.max(segment.from.y, segment.to.y)];
			length += Math.max(0, Math.min(high, otherHigh) - Math.max(low, otherLow));
		}
		return length;
	};
	// Going back behind the source costs extra on top of length.
	const { behind } = packing;
	const behindCost = (from: RoutePoint, to: RoutePoint) =>
		behind === undefined
			? 0
			: BEHIND_COST *
				Math.max(0, Math.min(behind, Math.max(from.x, to.x)) - Math.min(from.x, to.x));
	// A* toward the nearest approach: its Manhattan distance, plus a bend for each turn any route
	// from this heading must make to reach it, never overestimates.
	// Each approach also costs its port's preference and its straight run in, which no route avoids.
	const finishCosts = request.targets.map((port) => port.cost + routeApproach(port.direction));
	const remaining = (point: RoutePoint, heading: RouteDirection) => {
		let nearest = Infinity;
		approaches.forEach((approach, index) => {
			const dx = approach.x - point.x;
			const dy = approach.y - point.y;
			const ahead = dx * DX[heading] + dy * DY[heading];
			const aside = Math.abs(dx * DY[heading]) + Math.abs(dy * DX[heading]);
			const turns = aside < 0.01 ? (ahead > -0.01 ? 0 : 2) : ahead > -0.01 ? 1 : 2;
			nearest = Math.min(
				nearest,
				Math.abs(dx) + Math.abs(dy) + turns * BEND_COST + finishCosts[index]!,
			);
		});
		return nearest;
	};

	// Costs and back-links by state, in flat arrays: the search's hottest lookups.
	const states = xs.length * ys.length * 4;
	const best = new Float64Array(states).fill(Infinity);
	const previous = new Int32Array(states).fill(-1);
	const queue = new Queue();
	const state = (node: number, direction: RouteDirection) => node * 4 + direction;
	const startOf = new Map<number, RoutePort>();
	request.sources.forEach((port, index) => {
		const lead = leads[index]!;
		const node = key(lead);
		if (node === undefined || !free(port, lead, true)) return;
		const id = state(node, port.direction);
		const cost = port.cost + ROUTE_LEAD;
		if (cost < best[id]!) {
			best[id] = cost;
			startOf.set(id, port);
			queue.push(cost + remaining(pointOf(node), port.direction), cost, id);
		}
	});
	const finishes = new Map<number, RoutePort[]>();
	request.targets.forEach((port, index) => {
		const approach = approaches[index]!;
		const node = key(approach);
		if (node === undefined || !free(approach, port, true)) return;
		finishes.set(node, [...(finishes.get(node) ?? []), port]);
	});
	let found: { cost: number; state: number; port: RoutePort } | undefined;
	let expansions = 0;
	while (queue.size > 0 && expansions++ < MAX_EXPANSIONS) {
		const { cost: priority, reached, state: current } = queue.pop();
		if (found && priority >= found.cost) break;
		const cost = best[current]!;
		// A state reached again more cheaply since it was queued is stale.
		if (reached > cost + 1e-6) continue;
		const node = Math.floor(current / 4);
		const direction = (current % 4) as RouteDirection;
		const point = pointOf(node);
		for (const port of finishes.get(node) ?? []) {
			if ((port.direction + 2) % 4 === direction) continue;
			const total =
				cost +
				port.cost +
				routeApproach(port.direction) +
				(port.direction === direction ? 0 : BEND_COST);
			if (!found || total < found.cost) found = { cost: total, state: current, port };
		}
		const column = node % xs.length;
		const row = Math.floor(node / xs.length);
		for (const turn of TURNS) {
			const heading = ((direction + turn) % 4) as RouteDirection;
			const nextColumn = column + DX[heading];
			const nextRow = row + DY[heading];
			if (nextColumn < 0 || nextColumn >= xs.length || nextRow < 0 || nextRow >= ys.length)
				continue;
			const nextNode = nextRow * xs.length + nextColumn;
			const target = pointOf(nextNode);
			const nextCost =
				cost +
				Math.abs(target.x - point.x) +
				Math.abs(target.y - point.y) +
				(turn === 0 ? 0 : BEND_COST) +
				behindCost(point, target);
			const id = state(nextNode, heading);
			if (nextCost >= best[id]! - 1e-9) continue;
			if (!free(point, target)) continue;
			// A run heading back left across another route reads as a loop through it.
			const crossingCost =
				heading === 2 ? packing.crossingCost * BACK_CROSSING_FACTOR : packing.crossingCost;
			const total =
				nextCost +
				(crossingCost ? crossings(point, target) * crossingCost : 0) +
				BESIDE_COST * besideLength(point, target);
			if (total < best[id]! - 1e-9) {
				best[id] = total;
				previous[id] = current;
				startOf.delete(id);
				queue.push(total + remaining(target, heading), total, id);
			}
		}
	}
	if (!found) return { expansions };
	const path: RoutePoint[] = [found.port];
	let cursor = found.state;
	path.push(
		step(
			found.port,
			((found.port.direction + 2) % 4) as RouteDirection,
			routeApproach(found.port.direction),
		),
	);
	while (cursor >= 0) {
		path.push(pointOf(Math.floor(cursor / 4)));
		const start = startOf.get(cursor);
		if (start) {
			path.push(start);
			break;
		}
		cursor = previous[cursor]!;
	}
	return { points: simplify(path.toReversed()), expansions };
}

/**
 * A single straight run from a source port to a facing target port in line
 * with it, when one is clear: the cheapest such pair, or undefined.
 */
function straightRoute(request: RouteRequest): RoutePoint[] | undefined {
	let best: { cost: number; points: RoutePoint[] } | undefined;
	for (const source of request.sources)
		for (const target of request.targets) {
			if (source.direction !== target.direction) continue;
			const length =
				source.direction % 2 === 0
					? (target.x - source.x) * DX[source.direction]
					: (target.y - source.y) * DY[source.direction];
			const inLine =
				source.direction % 2 === 0
					? Math.abs(source.y - target.y) < 0.01
					: Math.abs(source.x - target.x) < 0.01;
			if (!inLine || length < ROUTE_LEAD + routeApproach(target.direction)) continue;
			const blocked =
				request.obstacles.some(
					(obstacle) => !obstacle.own && blocksSegment(obstacle, source, target),
				) || request.routed.some((segment) => alongside(source, target, segment));
			const cost = source.cost + target.cost + length;
			if (!blocked && (!best || cost < best.cost)) best = { cost, points: [source, target] };
		}
	return best?.points;
}

/**
 * The cheapest orthogonal route from any source port to any target port, or
 * undefined when none is found within the search budget. It searches near the
 * ports, then wider, then packs routes closer.
 */
export function routeOrthogonal(request: RouteRequest): RoutePoint[] | undefined {
	const straight = straightRoute(request);
	if (straight) return straight;
	const points = [...request.sources, ...request.targets];
	const around = (horizontal: number, vertical: number): Window => ({
		left: Math.min(...points.map((point) => point.x)) - horizontal,
		right: Math.max(...points.map((point) => point.x)) + horizontal,
		top: Math.min(...points.map((point) => point.y)) - vertical,
		bottom: Math.max(...points.map((point) => point.y)) + vertical,
	});
	const strict = {
		separation: ROUTE_SEPARATION,
		lanes: request.lanes,
		splits: [0.5],
		crossingCost: CROSSING_COST,
	} satisfies Packing;
	const { behind } = request;
	const back: Packing = behind === undefined ? strict : { ...strict, behind };
	// When the lanes are full, routes pack closer; they still never lie on one another.
	const dense: Packing = {
		...back,
		separation: ROUTE_DENSE_SEPARATION,
		lanes: request.denseLanes,
		splits: [0.25, 0.5, 0.75],
		crossingCost: 2,
	};
	const near = around(WINDOW_MARGIN, WINDOW_ROWS);
	const wide = around(4 * WINDOW_MARGIN, 4 * WINDOW_ROWS);
	// Once a chart has spent its routing budget, the rest take the caller's last resort.
	const budget = request.budget;
	const attempt = (window: Window, packing: Packing) => {
		if (budget && budget.remaining <= 0) return undefined;
		const result = search(request, window, packing);
		if (budget) budget.remaining -= result.expansions;
		return result.points;
	};
	return attempt(near, back) ?? attempt(wide, back) ?? attempt(wide, dense);
}

/** A route's runs, for later routes to keep clear of. */
export function routeSegments(points: readonly RoutePoint[]): RouteSegment[] {
	return points.slice(1).map((to, index) => ({ from: points[index]!, to }));
}

/**
 * The box around a route's arrowhead: its last run's final `length` pixels,
 * widened by `margin` on every side. Other routes keep out of it.
 */
export function routeHead(points: readonly RoutePoint[], length: number, margin: number): RouteBox {
	const end = points.at(-1)!;
	const before = points.at(-2)!;
	const run = Math.abs(end.x - before.x) + Math.abs(end.y - before.y);
	const ratio = Math.min(1, length / Math.max(run, 0.01));
	const start = { x: end.x + (before.x - end.x) * ratio, y: end.y + (before.y - end.y) * ratio };
	return {
		left: Math.min(start.x, end.x) - margin,
		right: Math.max(start.x, end.x) + margin,
		top: Math.min(start.y, end.y) - margin,
		bottom: Math.max(start.y, end.y) + margin,
	};
}
