/**
 * Orthogonal routing for Gantt dependencies: the cheapest elbow path between
 * a predecessor's and a successor's ports that keeps clear of every bar, label
 * and arrowhead, never runs along another dependency, and bends as little as it
 * can, without short kinks. Every pixel behind the predecessor's start costs
 * extra, so a route goes forward around an obstacle unless that is much longer.
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
	/** How far a route leaves a source port straight before it may turn: ROUTE_LEAD unless set. */
	readonly lead?: number;
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
	/**
	 * First runs of earlier routes out of this route's source. Its own first run may lie along
	 * them, so routes out of one predecessor leave it down one trunk and branch off.
	 */
	readonly trunks?: ReadonlySet<RouteSegment>;
	/**
	 * Keep-outs behind the arrowheads of routes out of this route's source, by the first run of the
	 * route each guards: this route's first run may pass one while it carries on along that run,
	 * as their shared trunk.
	 */
	readonly pastTrunk?: ReadonlyMap<RouteObstacle, RouteSegment>;
	/** Bars whose top and bottom edges runs keep off: running close along one costs extra. */
	readonly edges?: readonly RouteBox[];
	/** The last runs of earlier routes: crossing one, even behind its arrowhead, costs more. */
	readonly lastRuns?: ReadonlySet<RouteSegment>;
	/** Nothing routes above top or below bottom. */
	readonly top: number;
	readonly bottom: number;
	/** Search steps the whole chart may still spend; shared by its routes. */
	readonly budget?: { remaining: number };
	/**
	 * Search steps the whole chart may still spend weighing kinks, apart from its routing budget:
	 * a route found with kinks searches again for a cheaper one under kink costs while it lasts.
	 */
	readonly kinkBudget?: { remaining: number };
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
/**
 * A turn after a run shorter than this, other than the first, reads as a kink: a step or hook
 * rather than an elbow. It costs extra, so routes take a plain elbow where one exists.
 */
const KINK_LENGTH = 28;
const KINK_COST = 40;
/** A search weighing kinks may take this many times the steps its plain search took. */
const KINK_SEARCH_FACTOR = 2;
/** Search steps a chart may spend weighing kinks per dependency, and at most. */
export const ROUTE_KINK_BUDGET_PER_ROUTE = 1_500;
export const ROUTE_KINK_BUDGET = 48_000;
/** Runs this close along a bar's top or bottom edge read as tracing it, and cost extra per pixel. */
const EDGE_DISTANCE = 7;
const EDGE_COST = 2;
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
const DY = [0, 1, 0, -1] as const;

function step(point: RoutePoint, direction: RouteDirection, length: number): RoutePoint {
	return { x: point.x + DX[direction] * length, y: point.y + DY[direction] * length };
}

function sortedUnique(values: readonly number[]): number[] {
	const sorted = values.map((value) => Math.round(value * 100) / 100).toSorted((a, b) => a - b);
	return sorted.filter((value, index) => index === 0 || value - sorted[index - 1]! > 0.01);
}

/**
 * A binary min-heap keyed by cost, then insertion order, so ties resolve deterministically. It
 * keeps its entries in parallel typed arrays, so queueing allocates nothing.
 */
class Queue {
	private costs = new Float64Array(1024);
	private reachedAt = new Float64Array(1024);
	private orders = new Float64Array(1024);
	private states = new Int32Array(1024);
	private length = 0;
	private order = 0;
	/** The cost and reached cost of the state last popped. */
	cost = 0;
	reached = 0;

	get size(): number {
		return this.length;
	}

	/** Queue a state by its estimated total cost, noting the cost it was reached at. */
	push(cost: number, reached: number, state: number): void {
		if (this.length === this.costs.length) this.grow();
		const order = this.order++;
		let index = this.length++;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (!before(cost, order, this.costs[parent]!, this.orders[parent]!)) break;
			this.move(parent, index);
			index = parent;
		}
		this.place(index, cost, reached, order, state);
	}

	/** The state with the lowest cost; its costs are left in `cost` and `reached`. */
	pop(): number {
		const state = this.states[0]!;
		this.cost = this.costs[0]!;
		this.reached = this.reachedAt[0]!;
		const last = --this.length;
		if (last > 0) {
			const cost = this.costs[last]!;
			const reached = this.reachedAt[last]!;
			const order = this.orders[last]!;
			const moved = this.states[last]!;
			let index = 0;
			for (;;) {
				const left = index * 2 + 1;
				if (left >= last) break;
				const right = left + 1;
				const child =
					right < last &&
					before(this.costs[right]!, this.orders[right]!, this.costs[left]!, this.orders[left]!)
						? right
						: left;
				if (!before(this.costs[child]!, this.orders[child]!, cost, order)) break;
				this.move(child, index);
				index = child;
			}
			this.place(index, cost, reached, order, moved);
		}
		return state;
	}

	private move(from: number, to: number): void {
		this.costs[to] = this.costs[from]!;
		this.reachedAt[to] = this.reachedAt[from]!;
		this.orders[to] = this.orders[from]!;
		this.states[to] = this.states[from]!;
	}

	private place(index: number, cost: number, reached: number, order: number, state: number): void {
		this.costs[index] = cost;
		this.reachedAt[index] = reached;
		this.orders[index] = order;
		this.states[index] = state;
	}

	private grow(): void {
		const size = this.costs.length * 2;
		const grown = <T extends Float64Array | Int32Array>(array: T, make: (size: number) => T) => {
			const next = make(size);
			next.set(array);
			return next;
		};
		this.costs = grown(this.costs, (size) => new Float64Array(size));
		this.reachedAt = grown(this.reachedAt, (size) => new Float64Array(size));
		this.orders = grown(this.orders, (size) => new Float64Array(size));
		this.states = grown(this.states, (size) => new Int32Array(size));
	}
}

/** Whether an entry comes out of the queue before another: lower cost, then queued earlier. */
function before(cost: number, order: number, otherCost: number, otherOrder: number): boolean {
	return cost < otherCost - 1e-9 || (Math.abs(cost - otherCost) <= 1e-9 && order < otherOrder);
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

/** Whether a run lies on the same line as a segment. */
export function collinear(from: RoutePoint, to: RoutePoint, segment?: RouteSegment): boolean {
	if (!segment) return false;
	const runHorizontal = Math.abs(from.y - to.y) < 0.01;
	if (runHorizontal !== horizontal(segment)) return false;
	return runHorizontal
		? Math.abs(from.y - segment.from.y) < 0.01
		: Math.abs(from.x - segment.from.x) < 0.01;
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

/**
 * Arrays every search shares, grown as needed. An entry counts only while stamped with the
 * current search's or grid's epoch, so neither starts by clearing them.
 */
const scratch = {
	best: new Float64Array(0),
	previous: new Int32Array(0),
	stamp: new Int32Array(0),
	epoch: 0,
	steps: new Float64Array(0),
	stepStamp: new Int32Array(0),
	estimates: new Float64Array(0),
	estimateStamp: new Int32Array(0),
	gridEpoch: 0,
};

/** Fresh costs and back-links for one search over a grid's states. */
function stateScratch(states: number) {
	if (scratch.stamp.length < states) {
		scratch.best = new Float64Array(states);
		scratch.previous = new Int32Array(states);
		scratch.stamp = new Int32Array(states);
	}
	if (scratch.epoch >= 2 ** 30) {
		scratch.stamp.fill(0);
		scratch.epoch = 0;
	}
	scratch.epoch += 1;
	return scratch;
}

/** Fresh step costs and estimates for one grid's steps. */
function gridScratch(steps: number) {
	if (scratch.stepStamp.length < steps) {
		scratch.steps = new Float64Array(steps);
		scratch.stepStamp = new Int32Array(steps);
		scratch.estimates = new Float64Array(steps);
		scratch.estimateStamp = new Int32Array(steps);
	}
	if (scratch.gridEpoch >= 2 ** 30) {
		scratch.stepStamp.fill(0);
		scratch.estimateStamp.fill(0);
		scratch.gridEpoch = 0;
	}
	scratch.gridEpoch += 1;
	return scratch;
}

/** One A* search over a prepared grid: under kink costs or not, for routes cheaper than `bound`. */
type SearchRun = (
	kinks: boolean,
	bound: number,
	limit: number,
) => { readonly points?: RoutePoint[]; readonly cost?: number; readonly expansions: number };

/**
 * The grid of columns and lanes a route may take within a window, with what blocks or costs
 * each step along it, ready for searches over it. Searches over one grid share its step costs.
 */
function prepareSearch(request: RouteRequest, window: Window, packing: Packing): SearchRun {
	const { routed } = request;
	const { separation } = packing;
	const pastTrunk = request.pastTrunk ?? new Map<RouteObstacle, RouteSegment>();
	const obstacles = [...request.obstacles, ...pastTrunk.keys()];
	const leads = request.sources.map((port) => step(port, port.direction, port.lead ?? ROUTE_LEAD));
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
	type Line = {
		obstacles: RouteObstacle[];
		routed: RouteSegment[];
		beside: RouteSegment[];
		/** Bars a horizontal line runs close along. */
		edges: RouteBox[];
	};
	const nearEdges = (request.edges ?? []).filter(
		(box) =>
			box.right >= window.left &&
			box.left <= window.right &&
			box.bottom >= window.top - EDGE_DISTANCE &&
			box.top <= window.bottom + EDGE_DISTANCE,
	);
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
				edges: runHorizontal
					? nearEdges.filter(
							(box) =>
								(at <= box.top && box.top - at < EDGE_DISTANCE) ||
								(at >= box.bottom && at - box.bottom < EDGE_DISTANCE),
						)
					: [],
			};
			cache.set(at, found);
		}
		return found;
	};
	/** The line a run lies on. */
	const lineOf = (from: RoutePoint, to: RoutePoint) => {
		const runHorizontal = Math.abs(from.y - to.y) < 0.01;
		return onLine(runHorizontal ? from.y : from.x, runHorizontal);
	};
	/**
	 * Whether a run is clear of every obstacle and of runs of earlier routes. A run on the route's
	 * first, its trunk, may lie along its siblings' trunks and pass the keep-outs past them.
	 */
	const free = (
		from: RoutePoint,
		to: RoutePoint,
		port = false,
		trunk = false,
		line = lineOf(from, to),
	) => {
		const runHorizontal = Math.abs(from.y - to.y) < 0.01;
		const low = runHorizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
		const high = runHorizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
		if (
			line.obstacles.some(
				(obstacle) =>
					!(port && obstacle.own) &&
					!(trunk && collinear(from, to, pastTrunk.get(obstacle))) &&
					blocksRun(obstacle, low, high, runHorizontal),
			)
		)
			return false;
		return !line.routed.some(
			(segment) =>
				!(trunk && request.trunks?.has(segment)) && alongside(from, to, segment, separation),
		);
	};
	/** How far a horizontal run lies close along a bar's top or bottom edge. */
	const edgeLength = (from: RoutePoint, to: RoutePoint, line = lineOf(from, to)) => {
		if (line.edges.length === 0) return 0;
		const low = Math.min(from.x, to.x);
		const high = Math.max(from.x, to.x);
		let length = 0;
		for (const box of line.edges)
			length += Math.max(0, Math.min(high, box.right) - Math.max(low, box.left));
		return length;
	};
	const crossings = (from: RoutePoint, to: RoutePoint, line = lineOf(from, to)) => {
		let count = 0;
		for (const segment of line.routed)
			if (crosses(from, to, segment))
				count += request.lastRuns?.has(segment) ? LAST_RUN_CROSSING_FACTOR : 1;
		return count;
	};
	/** How far a run lies beside unrelated routes. */
	const besideLength = (from: RoutePoint, to: RoutePoint, line = lineOf(from, to)) => {
		if (line.beside.length === 0) return 0;
		const runHorizontal = Math.abs(from.y - to.y) < 0.01;
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
	const approachXs = Float64Array.from(approaches, (approach) => approach.x);
	const approachYs = Float64Array.from(approaches, (approach) => approach.y);
	const remaining = (x: number, y: number, heading: RouteDirection) => {
		let nearest = Infinity;
		for (let index = 0; index < approachXs.length; index += 1) {
			const dx = approachXs[index]! - x;
			const dy = approachYs[index]! - y;
			const ahead = dx * DX[heading] + dy * DY[heading];
			const aside = Math.abs(dx * DY[heading]) + Math.abs(dy * DX[heading]);
			const turns = aside < 0.01 ? (ahead > -0.01 ? 0 : 2) : ahead > -0.01 ? 1 : 2;
			const estimate = Math.abs(dx) + Math.abs(dy) + turns * BEND_COST + finishCosts[index]!;
			if (estimate < nearest) nearest = estimate;
		}
		return nearest;
	};

	/*
	 * A state is a node, a heading and how the route came to be there: still on its first run,
	 * which may share a trunk and turn freely; on a later run at least KINK_LENGTH long, which may
	 * carry on or turn freely; or at the end of a shorter later run, which must turn there, paying
	 * for the kink, or finish. A turn walks the new run node by node: each node short of
	 * KINK_LENGTH ends a short run, and the first node past it carries on as a long one. So what a
	 * route may do next depends on its state alone, and the search stays exact under kink costs.
	 * Where kinks cost nothing, a turn steps one node onto a long run. Routes never reverse in place.
	 */
	const FIRST = 0;
	const LONG = 1;
	const SHORT = 2;
	const { steps, stepStamp, estimates, estimateStamp, gridEpoch } = gridScratch(
		xs.length * ys.length * 4,
	);
	const finishes = new Map<number, RoutePort[]>();
	// The cheapest finish straight on from each node and heading.
	const straightFinish = new Map<number, number>();
	request.targets.forEach((port, index) => {
		const approach = approaches[index]!;
		const node = key(approach);
		if (node === undefined || !free(approach, port, true)) return;
		finishes.set(node, [...(finishes.get(node) ?? []), port]);
		const id = node * 4 + port.direction;
		straightFinish.set(id, Math.min(straightFinish.get(id) ?? Infinity, finishCosts[index]!));
	});
	/** The estimate from a node and heading, worked out once per grid. */
	const estimateAt = (node: number, heading: RouteDirection) => {
		const at = node * 4 + heading;
		if (estimateStamp[at] !== gridEpoch) {
			estimateStamp[at] = gridEpoch;
			estimates[at] = remaining(xs[node % xs.length]!, ys[Math.floor(node / xs.length)]!, heading);
		}
		return estimates[at]!;
	};
	/**
	 * The cost of one step of a run from a node to the next, Infinity where the step is blocked.
	 * Off the first run, each step's cost is worked out once per grid.
	 */
	const stepCost = (node: number, next: number, heading: RouteDirection, trunk: boolean) => {
		const edge = node * 4 + heading;
		if (!trunk && stepStamp[edge] === gridEpoch) return steps[edge]!;
		const cost = stepCostOf(pointOf(node), pointOf(next), heading, trunk) ?? Infinity;
		if (!trunk) {
			stepStamp[edge] = gridEpoch;
			steps[edge] = cost;
		}
		return cost;
	};
	const stepCostOf = (
		point: RoutePoint,
		target: RoutePoint,
		heading: RouteDirection,
		trunk: boolean,
	) => {
		const line = onLine(heading % 2 === 0 ? point.y : point.x, heading % 2 === 0);
		if (!free(point, target, false, trunk, line)) return undefined;
		// A run heading back left across another route reads as a loop through it.
		const crossingCost =
			heading === 2 ? packing.crossingCost * BACK_CROSSING_FACTOR : packing.crossingCost;
		return (
			Math.abs(target.x - point.x) +
			Math.abs(target.y - point.y) +
			behindCost(point, target) +
			EDGE_COST * edgeLength(point, target, line) +
			(crossingCost ? crossings(point, target, line) * crossingCost : 0) +
			BESIDE_COST * besideLength(point, target, line)
		);
	};
	const width = xs.length;
	const height = ys.length;
	return (kinks, bound, limit) => {
		const { best, previous, stamp, epoch } = stateScratch(xs.length * ys.length * 12);
		const costOf = (id: number) => (stamp[id] === epoch ? best[id]! : Infinity);
		/**
		 * Whether a state is outdone at its node and heading: a first run may do all a later run may,
		 * and a long run all a short one may without its kink, so either reached as cheaply makes it
		 * redundant.
		 */
		const outdone = (id: number, cost: number) => {
			const kind = id % 3;
			if (kind === FIRST) return false;
			const base = id - kind;
			// Unless it finishes straight on, a short run pays for its kink wherever it goes next.
			const kink = kind === SHORT && !straightFinish.has(base / 3) ? KINK_COST : 0;
			return (
				costOf(base + FIRST) <= cost + kink + 1e-9 ||
				(kind === SHORT && costOf(base + LONG) <= cost + kink + 1e-9)
			);
		};
		const state = (node: number, direction: RouteDirection, kind: number) =>
			(node * 4 + direction) * 3 + kind;
		const queue = new Queue();
		const startOf = new Map<number, RoutePort>();
		request.sources.forEach((port, index) => {
			const lead = leads[index]!;
			const node = key(lead);
			if (node === undefined || !free(port, lead, true, true)) return;
			const id = state(node, port.direction, FIRST);
			const cost = port.cost + (port.lead ?? ROUTE_LEAD);
			if (cost < costOf(id)) {
				stamp[id] = epoch;
				best[id] = cost;
				previous[id] = -1;
				startOf.set(id, port);
				queue.push(cost + remaining(lead.x, lead.y, port.direction), cost, id);
			}
		});
		let found: { state: number; port: RoutePort } | undefined;
		// The cheapest route so far, or the bound before one is found.
		let ceiling = bound;
		/** Queue a state reached at a cost, unless it was reached as cheaply before. */
		const arrive = (
			id: number,
			cost: number,
			from: number,
			node: number,
			heading: RouteDirection,
		) => {
			if (cost >= costOf(id) - 1e-9 || outdone(id, cost)) return;
			let estimate = estimateAt(node, heading);
			// A short run must turn, paying for its kink, unless it finishes straight on here.
			if (id % 3 === SHORT)
				estimate = Math.min(
					KINK_COST + estimate,
					straightFinish.get(node * 4 + heading) ?? Infinity,
				);
			if (cost + estimate >= ceiling) return;
			stamp[id] = epoch;
			best[id] = cost;
			previous[id] = from;
			startOf.delete(id);
			queue.push(cost + estimate, cost, id);
		};
		let expansions = 0;
		while (queue.size > 0 && expansions++ < limit) {
			const current = queue.pop();
			const priority = queue.cost;
			const reached = queue.reached;
			if (priority >= ceiling) break;
			const cost = costOf(current);
			// A state reached again more cheaply since it was queued, or outdone at its node, is stale.
			if (reached > cost + 1e-6 || outdone(current, cost)) continue;
			const kind = current % 3;
			const node = Math.floor(current / 12);
			const direction = (Math.floor(current / 3) % 4) as RouteDirection;
			const column = node % width;
			const row = (node - column) / width;
			const x = xs[column]!;
			const y = ys[row]!;
			const kink = kind === SHORT ? KINK_COST : 0;
			for (const port of finishes.get(node) ?? []) {
				if ((port.direction + 2) % 4 === direction) continue;
				const total =
					cost +
					port.cost +
					routeApproach(port.direction) +
					(port.direction === direction ? 0 : BEND_COST + kink);
				if (total < ceiling) {
					found = { state: current, port };
					ceiling = total;
				}
			}
			// Straight on, unless a short run ends here.
			const aheadColumn = column + DX[direction];
			const aheadRow = row + DY[direction];
			if (
				kind !== SHORT &&
				aheadColumn >= 0 &&
				aheadColumn < width &&
				aheadRow >= 0 &&
				aheadRow < height
			) {
				const ahead = aheadRow * width + aheadColumn;
				const id = (ahead * 4 + direction) * 3 + kind;
				const step = Math.abs(xs[aheadColumn]! - x) + Math.abs(ys[aheadRow]! - y);
				if (cost + step < costOf(id) - 1e-9) {
					const extra = stepCost(node, ahead, direction, kind === FIRST);
					if (extra !== Infinity) arrive(id, cost + extra, current, ahead, direction);
				}
			}
			// A turn either way starts a later run: walk it to its first node past KINK_LENGTH.
			for (let turn = 1; turn <= 3; turn += 2) {
				const heading = ((direction + turn) % 4) as RouteDirection;
				let total = cost + BEND_COST + kink;
				let length = 0;
				let atColumn = column;
				let atRow = row;
				for (;;) {
					const nextColumn = atColumn + DX[heading];
					const nextRow = atRow + DY[heading];
					if (nextColumn < 0 || nextColumn >= width || nextRow < 0 || nextRow >= height) break;
					const step =
						Math.abs(xs[nextColumn]! - xs[atColumn]!) + Math.abs(ys[nextRow]! - ys[atRow]!);
					const next = nextRow * width + nextColumn;
					const base = (next * 4 + heading) * 3;
					// A run already reached here as cheaply on a first or long run goes no further this way.
					if (Math.min(costOf(base), costOf(base + LONG)) <= total + step + 1e-9) break;
					const extra = stepCost(atRow * width + atColumn, next, heading, false);
					if (extra === Infinity) break;
					total += extra;
					length += step;
					atColumn = nextColumn;
					atRow = nextRow;
					const long = !kinks || length >= KINK_LENGTH;
					arrive(base + (long ? LONG : SHORT), total, current, next, heading);
					if (long) break;
				}
			}
		}
		if (!found) return { expansions };
		const cost = ceiling;
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
			path.push(pointOf(Math.floor(cursor / 12)));
			const start = startOf.get(cursor);
			if (start) {
				path.push(start);
				break;
			}
			cursor = previous[cursor]!;
		}
		return { points: simplify(path.toReversed()), cost, expansions };
	};
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
			if (!inLine || length < (source.lead ?? ROUTE_LEAD) + routeApproach(target.direction))
				continue;
			const blocked =
				request.obstacles.some(
					(obstacle) => !obstacle.own && blocksSegment(obstacle, source, target),
				) ||
				request.routed.some(
					(segment) => !request.trunks?.has(segment) && alongside(source, target, segment),
				);
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
	const kinkBudget = request.kinkBudget;
	/*
	 * Weighing kinks takes a dearer search, so a route is found without them first. Only one that
	 * kinks searches the same grid again under kink costs, for a route cheaper than that one with
	 * its kinks paid, within a few times the steps the first search took and on a budget of its
	 * own: the cheapest route under kink costs, for a fraction of the search, and never at the
	 * cost of routing the rest.
	 */
	const attempt = (window: Window, packing: Packing, weighKinks: boolean) => {
		if (budget && budget.remaining <= 0) return undefined;
		const run = prepareSearch(request, window, packing);
		const plain = run(false, Infinity, MAX_EXPANSIONS);
		if (budget) budget.remaining -= plain.expansions;
		if (!plain.points) return undefined;
		const kinks = routeKinkCost(plain.points);
		if (!weighKinks || !kinkBudget || kinkBudget.remaining <= 0 || kinks === 0) return plain.points;
		const kinked = run(
			true,
			plain.cost! + kinks - 1e-6,
			Math.min(MAX_EXPANSIONS, KINK_SEARCH_FACTOR * plain.expansions, kinkBudget.remaining),
		);
		kinkBudget.remaining -= kinked.expansions;
		return kinked.points ?? plain.points;
	};
	return attempt(near, back, true) ?? attempt(wide, back, true) ?? attempt(wide, dense, false);
}

/** What a route's kinks cost: a turn after any run but its first that is shorter than KINK_LENGTH. */
export function routeKinkCost(points: readonly RoutePoint[]): number {
	const runs = routeSegments(points);
	let cost = 0;
	for (const { from, to } of runs.slice(1, -1))
		if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) < KINK_LENGTH) cost += KINK_COST;
	return cost;
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
