// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import {
	estimateTextWidth,
	getCanvasValidationIssues,
	type CanvasElement as SceneElement,
	type CanvasPoint as ScenePoint,
	type CanvasSpec,
} from "@sketchi/drawing";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
	formatGanttDay,
	ganttTaskSchedule,
	parseGanttDay,
	parseGanttDiagram,
	type GanttDiagram,
} from "../document";

import { readGanttScene, type GanttReadout } from "../readout";
import {
	GANTT_MIN_BAR_WIDTH,
	JOIN_BUDGET,
	REPAIR_BUDGET,
	layoutGanttDiagram,
	renderGanttDiagram,
} from "../render";
import { ROUTE_BUDGET, ROUTE_CHART_BUDGET, ROUTE_KINK_BUDGET } from "../routing";
import { GANTT_TICK_FONT_SIZE, ganttAxis } from "../scale";

interface Box {
	readonly id: string;
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

type TextElement = Extract<SceneElement, { type: "text" }>;

function textBox(element: TextElement): Box {
	const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
	const height = element.text.split("\n").length * element.fontSize * 1.35;
	return {
		id: element.id,
		left: element.x - width / 2,
		top: element.y - height / 2,
		right: element.x + width / 2,
		bottom: element.y + height / 2,
	};
}

/** Strict overlap: boxes that only touch do not overlap. */
function overlaps(a: Box, b: Box, slack = 0.5): boolean {
	return (
		a.left < b.right - slack &&
		b.left < a.right - slack &&
		a.top < b.bottom - slack &&
		b.top < a.bottom - slack
	);
}

function enters(box: Box, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
	const horizontal = Math.abs(from.y - to.y) < 0.01;
	return horizontal
		? from.y > box.top + 0.5 &&
				from.y < box.bottom - 0.5 &&
				Math.max(from.x, to.x) > box.left + 0.5 &&
				Math.min(from.x, to.x) < box.right - 0.5
		: from.x > box.left + 0.5 &&
				from.x < box.right - 0.5 &&
				Math.max(from.y, to.y) > box.top + 0.5 &&
				Math.min(from.y, to.y) < box.bottom - 0.5;
}

type GanttLayout = ReturnType<typeof layoutGanttDiagram>;

interface GanttChecks {
	/** Routes keep apart from one another and from their own ends' edges, not only off each other's lines. */
	readonly distinct?: boolean;
	/** A successor in the next row that waits on that row alone, and starts once it ends, has a forward route. */
	readonly forward?: boolean;
}

/** Every layout promise a Gantt chart makes, read from its scene and routing work. Each problem starts with its kind. */
function ganttProblems(
	diagram: GanttDiagram,
	{ scene, work }: GanttLayout,
	{ distinct = true, forward = false }: GanttChecks = {},
): string[] {
	const problems: string[] = [];
	// Routing work is bounded however crowded the plan: per layout, each dependency is placed,
	// tried in at most two more arrival plans, and rerouted at most twice, within the chart's and
	// the repairs' search budgets (each may overrun by one route's last search) and the budgets for
	// weighing kinks and joining another route's last run. A chart whose first layout doesn't read
	// clean is laid out the earlier way too, and once more clear of every mark where that way runs
	// too close to one; one whose routes still meet is laid out at most twice more.
	const dependencies = diagram.tasks.reduce((sum, task) => sum + (task.dependsOn?.length ?? 0), 0);
	if (work.layouts > 5) problems.push(`layouts: ${work.layouts}`);
	if (work.placements > 5 * dependencies * work.layouts)
		problems.push(`placements: ${work.placements}`);
	if (
		work.expansions >
		(ROUTE_CHART_BUDGET + REPAIR_BUDGET + 2 * ROUTE_BUDGET + ROUTE_KINK_BUDGET + JOIN_BUDGET) *
			work.layouts
	)
		problems.push(`search-steps: ${work.expansions}`);
	const readout = readGanttScene(scene);
	// Ticks are nice and cover the plan; bars sit on their dates.
	const schedules = diagram.tasks.map((task) => ({ task, schedule: ganttTaskSchedule(task)! }));
	const first = Math.min(...schedules.map(({ schedule }) => schedule.start));
	const last = Math.max(
		...schedules.map(({ schedule }) => Math.max(schedule.end, schedule.start + 1)),
	);
	const firstLine = readout.gridlines[0];
	const lastLine = readout.gridlines.at(-1);
	if (!firstLine || !lastLine || firstLine.day > first || lastLine.day < last)
		problems.push(`ticks-cover: ${readout.gridlines.length} gridlines`);
	for (const { day, x } of readout.gridlines)
		if (Math.abs(x - (firstLine!.x + (day - firstLine!.day) * readout.pxPerDay)) > 0.05)
			problems.push(`gridline-off-scale: ${formatGanttDay(day)}`);
	for (const { task, schedule } of schedules) {
		const mark = readout.marks.get(task.id);
		if (!mark) {
			problems.push(`mark-missing: ${task.id}`);
			continue;
		}
		if (mark.milestone !== schedule.milestone) problems.push(`mark-kind: ${task.id}`);
		if (Math.abs(mark.start - schedule.start) > 0.05) problems.push(`bar-start: ${task.id}`);
		// Bars narrower than the minimum draw at the minimum.
		const end = schedule.milestone
			? schedule.end
			: Math.max(schedule.end, schedule.start + GANTT_MIN_BAR_WIDTH / readout.pxPerDay);
		if (Math.abs(mark.end - end) > 0.05) problems.push(`bar-end: ${task.id}`);
	}
	// Text is whole, never overlaps other text or a mark, and stays in the scene.
	const texts = scene.elements.flatMap((element) =>
		element.type === "text" ? [textBox(element)] : [],
	);
	const marks: Box[] = [...readout.marks.values()].map((mark) => ({
		...mark,
		id: `gantt:task:${mark.id}`,
	}));
	texts.forEach((text, index) => {
		for (const other of texts.slice(index + 1))
			if (overlaps(text, other)) problems.push(`text-overlap: ${text.id} overlaps ${other.id}`);
		for (const mark of marks)
			if (overlaps(text, mark)) problems.push(`text-covers-mark: ${text.id} covers ${mark.id}`);
		if (text.left < 0 || text.top < 0 || text.right > scene.width || text.bottom > scene.height)
			problems.push(`text-clipped: ${text.id}`);
	});
	for (const task of diagram.tasks) {
		const label = scene.elements.find((element) => element.id === `gantt:label:${task.id}`);
		if (label?.type !== "text" || label.text.replace(/\n/gu, " ") !== task.label)
			problems.push(`label-text: ${task.id}`);
	}
	// Every dependency is drawn: orthogonal, from its predecessor into its successor, clear of
	// every other mark and every text.
	const arrows = scene.elements.filter((element) => element.type === "arrow");
	if (arrows.length !== dependencies)
		problems.push(`arrow-count: ${arrows.length} of ${dependencies}`);
	for (const arrow of arrows) {
		const ends = new Set([arrow.sourceNodeId, arrow.targetNodeId]);
		arrow.points.slice(1).forEach((to, index) => {
			const from = arrow.points[index]!;
			if (Math.abs(from.x - to.x) >= 0.01 && Math.abs(from.y - to.y) >= 0.01)
				problems.push(`not-orthogonal: ${arrow.id}`);
			for (const box of [...marks.filter((mark) => !ends.has(mark.id)), ...texts])
				if (enters(box, from, to)) problems.push(`arrow-crosses: ${arrow.id} crosses ${box.id}`);
		});
	}
	// No rule crosses text.
	for (const element of scene.elements) {
		if (element.type !== "line" || !/^gantt:(grid|minor|axis|band-edge|today)/u.test(element.id))
			continue;
		for (const text of texts)
			if (enters(text, element.points[0], element.points[1]))
				problems.push(`rule-crosses-text: ${element.id} crosses ${text.id}`);
	}
	problems.push(...clearanceProblems(arrows, marks), ...distinctProblems(scene, distinct));
	if (forward) problems.push(...backwardProblems(readout));
	return problems;
}

/** Lays a plan out and expects every promise it makes kept, the generic canvas and export checks included. */
function expectReadableGantt(diagram: GanttDiagram, checks: GanttChecks = {}): CanvasSpec {
	const layout = layoutGanttDiagram(diagram);
	expect(getCanvasValidationIssues(layout.scene), diagram.id).toEqual([]);
	expect(
		validateExcalidrawScene(convertSceneToExcalidraw(layout.scene)).issues,
		diagram.id,
	).toEqual([]);
	expect(ganttProblems(diagram, layout, checks), diagram.id).toEqual([]);
	return layout.scene;
}

/** Runs keep at least this far beside the ends of the bars and diamonds they pass, and this far above and below them. */
const MARK_SIDE_GAP = 8;
const MARK_GAP = 4;

/**
 * Runs that come closer to a bar or diamond they pass but don't connect to than its clearance:
 * a vertical run beside its end, over the height they share, or a horizontal run above or below
 * it, over the width they share.
 */
function clearanceProblems(
	arrows: readonly Extract<SceneElement, { type: "arrow" }>[],
	marks: readonly Box[],
): string[] {
	const problems: string[] = [];
	for (const arrow of arrows) {
		const ends = new Set([arrow.sourceNodeId, arrow.targetNodeId]);
		arrow.points.slice(1).forEach((to, index) => {
			const from = arrow.points[index]!;
			const vertical = Math.abs(from.x - to.x) < 0.01;
			for (const mark of marks) {
				if (ends.has(mark.id)) continue;
				const shared = vertical
					? Math.min(Math.max(from.y, to.y), mark.bottom) -
						Math.max(Math.min(from.y, to.y), mark.top)
					: Math.min(Math.max(from.x, to.x), mark.right) -
						Math.max(Math.min(from.x, to.x), mark.left);
				if (shared <= 1) continue;
				const gap = vertical
					? Math.max(mark.left - from.x, from.x - mark.right)
					: Math.max(mark.top - from.y, from.y - mark.bottom);
				if (gap < (vertical ? MARK_SIDE_GAP : MARK_GAP) - 0.02)
					problems.push(`clearance: ${arrow.id} runs ${gap.toFixed(1)} px from ${mark.id}`);
			}
		});
	}
	return problems;
}

/** Arrows keep this far from another arrow's head, and from the end of its last run. */
const HEAD_GAP = 4;
/** The part of a last run its arrowhead covers. */
const HEAD_LENGTH = 12;

type Run = { readonly from: ScenePoint; readonly to: ScenePoint };

const isHorizontal = (run: Run) => Math.abs(run.from.y - run.to.y) < 0.01;

/** How far two parallel runs overlap along their length, when they lie closer than `gap`. */
function sideBySide(a: Run, b: Run, gap: number): number {
	if (isHorizontal(a) !== isHorizontal(b)) return 0;
	const horizontal = isHorizontal(a);
	const offset = horizontal ? Math.abs(a.from.y - b.from.y) : Math.abs(a.from.x - b.from.x);
	if (offset >= gap) return 0;
	const span = (run: Run) =>
		horizontal
			? [Math.min(run.from.x, run.to.x), Math.max(run.from.x, run.to.x)]
			: [Math.min(run.from.y, run.to.y), Math.max(run.from.y, run.to.y)];
	const [aLow, aHigh] = span(a);
	const [bLow, bHigh] = span(b);
	return Math.min(aHigh!, bHigh!) - Math.max(aLow!, bLow!);
}

/** Where a route's last straight stretch begins: the index of its first run in line with its last. */
function stemStart(runs: readonly Run[]): number {
	let index = runs.length - 1;
	while (
		index > 0 &&
		isHorizontal(runs[index - 1]!) === isHorizontal(runs[index]!) &&
		(isHorizontal(runs[index]!)
			? Math.abs(runs[index - 1]!.from.y - runs[index]!.from.y) < 0.01
			: Math.abs(runs[index - 1]!.from.x - runs[index]!.from.x) < 0.01)
	)
		index -= 1;
	return index;
}

/**
 * Every dependency reads as its own line: no other route comes near its arrowhead, no two
 * routes run together, and none runs along the edge of its own predecessor or successor.
 * Routes out of one predecessor may share their first run, and routes into one successor their
 * last, as Excalidraw's bound stems allow; one that joined another's last run shares its arrowhead
 * too. Unless `strict`, only lying exactly on another route counts.
 */
function distinctProblems(scene: CanvasSpec, strict: boolean): string[] {
	const problems: string[] = [];
	const arrows = scene.elements.flatMap((element) =>
		element.type === "arrow"
			? [
					{
						arrow: element,
						runs: element.points
							.slice(1)
							.map((to, index) => ({ from: element.points[index]!, to })),
					},
				]
			: [],
	);
	const nodes = new Map(
		scene.elements.flatMap((element) =>
			element.type === "node" ? [[element.nodeId, element] as const] : [],
		),
	);
	for (const { arrow, runs } of arrows) {
		const end = arrow.points.at(-1)!;
		const before = arrow.points.at(-2)!;
		const length = Math.abs(end.x - before.x) + Math.abs(end.y - before.y);
		const ratio = Math.min(1, HEAD_LENGTH / length);
		const start = { x: end.x + (before.x - end.x) * ratio, y: end.y + (before.y - end.y) * ratio };
		const head: Box = {
			id: `${arrow.id} head`,
			left: Math.min(start.x, end.x) - HEAD_GAP,
			right: Math.max(start.x, end.x) + HEAD_GAP,
			top: Math.min(start.y, end.y) - HEAD_GAP,
			bottom: Math.max(start.y, end.y) + HEAD_GAP,
		};
		for (const { arrow: other, runs: otherRuns } of arrows) {
			if (other === arrow) continue;
			const otherEnd = other.points.at(-1)!;
			// One route joined the other's last run: both end in one arrowhead.
			const joint =
				arrow.targetNodeId === other.targetNodeId &&
				Math.hypot(end.x - otherEnd.x, end.y - otherEnd.y) < 0.01;
			otherRuns.forEach((run, at) => {
				if (
					strict &&
					!(joint && at >= stemStart(otherRuns)) &&
					Math.max(run.from.x, run.to.x) > head.left &&
					Math.min(run.from.x, run.to.x) < head.right &&
					Math.max(run.from.y, run.to.y) > head.top &&
					Math.min(run.from.y, run.to.y) < head.bottom
				)
					problems.push(`crosses-head: ${other.id} runs through the head of ${arrow.id}`);
				runs.forEach((own, index) => {
					const leaving = arrow.sourceNodeId === other.sourceNodeId && index === 0 && at === 0;
					const arriving =
						arrow.targetNodeId === other.targetNodeId &&
						((index === runs.length - 1 && at === otherRuns.length - 1) ||
							(joint && index >= stemStart(runs) && at >= stemStart(otherRuns)));
					if (!leaving && !arriving && sideBySide(own, run, strict ? 2 : 0.01) > 1)
						problems.push(`runs-along: ${arrow.id} runs along ${other.id}`);
				});
			});
		}
		// Past its first run and before its last, a route keeps off its own ends' edges.
		if (strict)
			for (const run of runs.slice(1, -1))
				for (const id of [arrow.sourceNodeId, arrow.targetNodeId]) {
					const node = nodes.get(id);
					if (!node) continue;
					const edges: Run[] = [
						{ from: { x: node.x, y: node.y }, to: { x: node.x + node.width, y: node.y } },
						{
							from: { x: node.x, y: node.y + node.height },
							to: { x: node.x + node.width, y: node.y + node.height },
						},
						{ from: { x: node.x, y: node.y }, to: { x: node.x, y: node.y + node.height } },
						{
							from: { x: node.x + node.width, y: node.y },
							to: { x: node.x + node.width, y: node.y + node.height },
						},
					];
					if (edges.some((edge) => sideBySide(run, edge, 1) > 1))
						problems.push(`runs-along-edge: ${arrow.id} runs along the edge of ${id}`);
				}
	}
	return problems;
}

/**
 * A successor in the next row that waits on that row alone, and starts once it ends, always has a
 * forward route, unless that row is a sliver whose other dependencies take the room its exit
 * needs. A route doubles back when some run goes left of both its predecessor's start and the
 * corridor just before its successor's start.
 */
function backwardProblems(readout: GanttReadout): string[] {
	const rows = [...readout.marks.values()].toSorted((a, b) => a.top - b.top);
	return readout.dependencies.flatMap(({ from, to, points }) => {
		const before = readout.marks.get(from);
		const after = readout.marks.get(to);
		if (!before || !after) return [];
		const alone = readout.dependencies.filter((dependency) => dependency.to === to).length === 1;
		const sliver =
			before.right - before.left < SLIVER_WIDTH &&
			readout.dependencies.filter(
				(dependency) => dependency.to === from || dependency.from === from,
			).length >= SLIVER_ROUTES;
		if (
			!alone ||
			sliver ||
			rows.indexOf(after) !== rows.indexOf(before) + 1 ||
			after.left < before.right
		)
			return [];
		const limit = Math.min(before.left, after.left - 40);
		return points.some((point) => point.x < limit - 0.5) ? [`runs-back: ${from}->${to}`] : [];
	});
}

/**
 * Plans per fuzz. CI runs a handful; `pnpm nx run diagram-renderer:gantt-fuzz` runs 300 as
 * local proof when layout or routing changes.
 */
// @effect-diagnostics-next-line processEnv:off -- The offline diagnostic runner reads its sample or output options from the invoking environment.
const FUZZ_SEEDS = Number(process.env["GANTT_FUZZ_SEEDS"] ?? 4);
const FUZZ_TIMEOUT = Math.max(60_000, FUZZ_SEEDS * 1_000);

/** Bars narrower than this, with this many dependencies arriving or leaving, have no room for each apart. */
const SLIVER_WIDTH = 12;
const SLIVER_ROUTES = 4;

const plan = (tasks: object[], extra: object = {}) =>
	parseGanttDiagram({ id: "plan", title: "Plan", type: "gantt", tasks, ...extra }).pipe(
		Result.getOrThrow,
	);

describe("Gantt layout", () => {
	it("keeps tick labels apart however long the plan, on a plot narrowed for a short chart", () => {
		// Review: a century on a 640 px plot drew decade labels over one another.
		const scene = renderGanttDiagram(
			plan([{ id: "a", label: "Long programme", start: "2026-01-01", end: "2125-12-31" }]),
		);
		const ticks = scene.elements
			.flatMap((element) =>
				element.type === "text" && element.id.startsWith("gantt:tick:") ? [textBox(element)] : [],
			)
			.toSorted((a, b) => a.left - b.left);
		expect(ticks.length).toBeGreaterThan(1);
		ticks
			.slice(1)
			.forEach((tick, index) =>
				expect(tick.left, tick.id).toBeGreaterThanOrEqual(ticks[index]!.right),
			);
		// Every tick label fits its cell, from a day to a century, from the narrowest plot to the widest.
		const next = random(7);
		const origin = parseGanttDay("2026-01-05")!;
		const problems: string[] = [];
		for (let index = 0; index < 400; index += 1) {
			const start = origin + Math.floor(next() * 3650);
			const span = Math.ceil(Math.exp(next() * Math.log(36_525)));
			const width = 640 + next() * 320;
			const axis = ganttAxis(start, start + span, width);
			for (const cell of axis.cells)
				if (
					estimateTextWidth(cell.label, GANTT_TICK_FONT_SIZE) >
					(cell.end - cell.start) * axis.pxPerDay
				)
					problems.push(`${span} days at ${Math.round(width)} px: "${cell.label}"`);
		}
		expect(problems.slice(0, 5)).toEqual([]);
	});

	it("bounds axis cells over a century", () => {
		// The axis never builds more cells than it could label, however long the span.
		const axis = ganttAxis(parseGanttDay("2026-01-01")!, parseGanttDay("2125-12-31")!);
		expect(axis.cells.length).toBeLessThanOrEqual(36);
	});

	it("fits 60 overlapping tasks, their progress and a Today line inside the element limit", () => {
		// Today breaks behind all 60 bars; budgeted without those breaks, this plan drew 656
		// elements.
		expectReadableGantt(
			plan(
				Array.from({ length: 60 }, (_, index) => ({
					id: `t${index}`,
					label: `Task ${index} review`,
					start: "2026-03-01",
					duration: 30,
					progress: 40,
					...(index ? { dependsOn: [`t${index - 1}`] } : {}),
				})),
				{ today: "2026-03-10" },
			),
		);
	});

	it("keeps years below 100 on their own calendar", () => {
		const scene = expectReadableGantt(
			plan([{ id: "a", label: "Ancient works", start: "0090-01-01", end: "0090-06-30" }]),
		);
		const readout = readGanttScene(scene);
		expect(formatGanttDay(readout.gridlines[0]!.day)).toBe("0090-01-01");
		expect(readout.marks.get("a")!.start).toBeCloseTo(parseGanttDay("0090-01-01")!, 1);
	});

	it("lands no arrowhead on a route, and runs no route through one, around crowded marks", () => {
		// Review: past the fuzz's 300 seeds, a sibling hugged its own milestone's bounds (477) and,
		// once names left the plot, routes out of a 3 px bar's right end ran through the arrowhead
		// entering its left (1000).
		for (const seed of [477, 1000]) expectReadableGantt(scheduledGantt(seed));
	});

	it(
		"keeps every layout invariant across a seeded fuzz of task counts, labels, spans and links",
		{ timeout: FUZZ_TIMEOUT },
		() => {
			// Links here join random tasks in any order, so routes may crowd: they still never lie on
			// one another or cross a bar or text.
			for (let seed = 1; seed <= FUZZ_SEEDS; seed += 1)
				expectReadableGantt(fuzzGantt(seed), { distinct: false });
		},
	);

	it(
		"keeps every dependency distinct and forward across a seeded fuzz of scheduled plans",
		{ timeout: FUZZ_TIMEOUT },
		() => {
			for (let seed = 1; seed <= FUZZ_SEEDS; seed += 1)
				expectReadableGantt(scheduledGantt(seed), { forward: true });
		},
	);
});

type SceneEdit = (element: SceneElement) => SceneElement | undefined;
type NodeElement = Extract<SceneElement, { type: "node" }>;
type LineElement = Extract<SceneElement, { type: "line" }>;

/** The layout with each matching element replaced, or removed where the edit returns undefined. */
function edit(layout: GanttLayout, id: string, change: SceneEdit): GanttLayout {
	const matches = (element: SceneElement) =>
		element.id === id || (element.type === "node" && element.nodeId === id);
	if (!layout.scene.elements.some(matches)) throw new Error(`no element ${id}`);
	return {
		...layout,
		scene: {
			...layout.scene,
			elements: layout.scene.elements.flatMap((element) => {
				if (!matches(element)) return [element];
				const changed = change(element);
				return changed ? [changed] : [];
			}),
		},
	};
}

function find<T extends SceneElement["type"]>(layout: GanttLayout, id: string, type: T) {
	const element = layout.scene.elements.find(
		(entry) => entry.id === id || (entry.type === "node" && entry.nodeId === id),
	);
	if (element?.type !== type) throw new Error(`no ${type} ${id}`);
	return element as Extract<SceneElement, { type: T }>;
}

const remove: SceneEdit = () => undefined;
const moveTo =
	(x: number, y: number): SceneEdit =>
	(element) =>
		({ ...element, x, y }) as SceneElement;
const reshape =
	(change: (node: NodeElement) => Partial<NodeElement>): SceneEdit =>
	(element) =>
		({ ...element, ...change(element as NodeElement) }) as SceneElement;
const route =
	(...points: ScenePoint[]): SceneEdit =>
	(element) =>
		({ ...element, points }) as SceneElement;

/** Bar or diamond by task id. */
const mark = (layout: GanttLayout, id: string) => {
	const node = find(layout, `gantt:task:${id}`, "node");
	return {
		...node,
		right: node.x + node.width,
		bottom: node.y + node.height,
		middle: node.y + node.height / 2,
	};
};
const arrow = (layout: GanttLayout, from: string, to: string) =>
	find(layout, `gantt:dependency:${from}:${to}`, "arrow");
const gridlines = (layout: GanttLayout) =>
	layout.scene.elements.filter((element) => /^gantt:grid:[\d-]+$/u.test(element.id));
const lastGridline = (layout: GanttLayout) => gridlines(layout).at(-1)!.id;
const dayWidth = (layout: GanttLayout) => readGanttScene(layout.scene).pxPerDay;

const brokenPlan = plan(
	[
		{ id: "a", label: "Design", start: "2026-01-05", duration: 5 },
		{ id: "b", label: "Build", start: "2026-01-12", duration: 10, dependsOn: ["a"] },
		{ id: "c", label: "Review", start: "2026-01-12", duration: 4, dependsOn: ["a"] },
		{ id: "m", label: "Launch", start: "2026-01-26", milestone: true, dependsOn: ["b", "c"] },
	],
	{ today: "2026-01-14" },
);

/** One deliberately broken layout per problem kind the Gantt oracle reports. */
const broken: Record<string, (layout: GanttLayout) => GanttLayout> = {
	layouts: (layout) => ({ ...layout, work: { ...layout.work, layouts: 6 } }),
	placements: (layout) => ({ ...layout, work: { ...layout.work, placements: 1_000 } }),
	"search-steps": (layout) => ({ ...layout, work: { ...layout.work, expansions: 1e9 } }),
	"ticks-cover": (layout) => edit(layout, lastGridline(layout), remove),
	"gridline-off-scale": (layout) =>
		edit(layout, gridlines(layout)[1]!.id, (line) => {
			const [from, to] = (line as LineElement).points;
			return {
				...line,
				points: [
					{ ...from, x: from.x + 30 },
					{ ...to, x: to.x + 30 },
				],
			} as SceneElement;
		}),
	"mark-missing": (layout) => edit(layout, "gantt:task:c", remove),
	"mark-kind": (layout) =>
		edit(
			layout,
			"gantt:task:b",
			reshape(() => ({ shape: "diamond" })),
		),
	"bar-start": (layout) =>
		edit(
			layout,
			"gantt:task:b",
			reshape((node) => ({
				x: node.x + 2 * dayWidth(layout),
				width: node.width - 2 * dayWidth(layout),
			})),
		),
	"bar-end": (layout) =>
		edit(
			layout,
			"gantt:task:b",
			reshape((node) => ({ width: node.width + 2 * dayWidth(layout) })),
		),
	"text-overlap": (layout) => {
		const { x, y } = find(layout, "gantt:label:b", "text");
		return edit(layout, "gantt:label:c", moveTo(x, y));
	},
	"text-covers-mark": (layout) => {
		const bar = mark(layout, "b");
		return edit(layout, "gantt:label:a", moveTo((bar.x + bar.right) / 2, bar.middle));
	},
	"text-clipped": (layout) => {
		const { y } = find(layout, "gantt:label:a", "text");
		return edit(layout, "gantt:label:a", moveTo(-40, y));
	},
	"label-text": (layout) =>
		edit(layout, "gantt:label:a", (element) => ({ ...element, text: "Desig" }) as SceneElement),
	"arrow-count": (layout) => edit(layout, arrow(layout, "a", "c").id, remove),
	"not-orthogonal": (layout) => {
		const { points } = arrow(layout, "a", "b");
		return edit(layout, arrow(layout, "a", "b").id, route(points[0], points.at(-1)!));
	},
	"arrow-crosses": (layout) => {
		const bar = mark(layout, "c");
		return edit(
			layout,
			arrow(layout, "a", "b").id,
			route({ x: bar.x - 10, y: bar.middle }, { x: bar.right + 10, y: bar.middle }),
		);
	},
	"rule-crosses-text": (layout) => {
		const label = find(layout, "gantt:label:b", "text");
		const today = layout.scene.elements.find(
			(element) => element.type === "line" && /^gantt:today(?::|$)/u.test(element.id),
		)!;
		return edit(
			layout,
			today.id,
			route({ x: label.x, y: label.y - 40 }, { x: label.x, y: label.y + 40 }),
		);
	},
	clearance: (layout) => {
		const bar = mark(layout, "c");
		return edit(
			layout,
			arrow(layout, "a", "b").id,
			route({ x: bar.x - 10, y: bar.y - 2 }, { x: bar.right + 10, y: bar.y - 2 }),
		);
	},
	"crosses-head": (layout) => {
		const end = arrow(layout, "a", "b").points.at(-1)!;
		return edit(
			layout,
			arrow(layout, "c", "m").id,
			route({ x: end.x - 6, y: end.y - 30 }, { x: end.x - 6, y: end.y + 30 }),
		);
	},
	"runs-along": (layout) => {
		const { points } = arrow(layout, "a", "b");
		return edit(
			layout,
			arrow(layout, "c", "m").id,
			route(...points.map((point) => ({ x: point.x, y: point.y + 1 }))),
		);
	},
	"runs-along-edge": (layout) => {
		const bar = mark(layout, "b");
		return edit(
			layout,
			arrow(layout, "a", "b").id,
			route(
				{ x: bar.x, y: bar.y - 20 },
				{ x: bar.x, y: bar.y },
				{ x: bar.x + 30, y: bar.y },
				{ x: bar.x + 30, y: bar.y + 5 },
			),
		);
	},
	"runs-back": (layout) => {
		const [from, to] = [mark(layout, "a"), mark(layout, "b")];
		return edit(
			layout,
			arrow(layout, "a", "b").id,
			route(
				{ x: from.right, y: from.middle },
				{ x: from.x - 20, y: from.middle },
				{ x: from.x - 20, y: to.middle },
				{ x: to.x, y: to.middle },
			),
		);
	},
};

describe("Gantt oracle", () => {
	it.each(Object.entries(broken))("reports %s on a broken layout", (kind, breakLayout) => {
		const layout = layoutGanttDiagram(brokenPlan);
		const checks = { forward: true };
		expect(ganttProblems(brokenPlan, layout, checks)).toEqual([]);
		expect(
			ganttProblems(brokenPlan, breakLayout(layout), checks).map(
				(problem) => problem.split(":")[0],
			),
		).toContain(kind);
	});
});

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const WORDS = [
	"Design",
	"Build",
	"review",
	"integration",
	"Migrate",
	"legacy",
	"data",
	"Customer-facing",
	"rollout",
	"Interoperability-testing",
	"QA",
	"and",
	"sign-off",
];

/** A random valid plan: 1–45 tasks over 3 days to 6 years, with phases, milestones and dependencies on earlier tasks. */
function fuzzGantt(seed: number): GanttDiagram {
	const next = random(seed);
	const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)]!;
	const count = 1 + Math.floor(next() * (next() < 0.3 ? 45 : 14));
	const span = [3, 20, 90, 400, 2200][Math.floor(next() * 5)]!;
	const origin = parseGanttDay("2026-01-05")!;
	const phases =
		next() < 0.5
			? ["Plan", "Build and integrate", "Launch"].slice(0, 1 + Math.floor(next() * 3))
			: [];
	const dense = next() < 0.3;
	let dependencies = 0;
	const tasks = Array.from({ length: count }, (_, index) => {
		const words = Array.from({ length: 1 + Math.floor(next() * (next() < 0.2 ? 12 : 3)) }, () =>
			pick(WORDS),
		);
		const start = origin + Math.floor(next() * span);
		const milestone = next() < 0.15;
		const duration = 1 + Math.floor(next() * Math.max(1, span / 4));
		const candidates = Array.from({ length: index }, (_, earlier) => `t${earlier}`);
		const dependsOn = candidates
			.filter(() => next() < (dense ? 0.25 : 0.08))
			.slice(0, Math.min(dense ? 4 : 2, 120 - dependencies));
		dependencies += dependsOn.length;
		return {
			id: `t${index}`,
			label: `${words.join(" ")} ${index}`,
			start: formatGanttDay(start),
			...(milestone
				? { milestone: true }
				: next() < 0.5
					? { duration }
					: { end: formatGanttDay(start + duration - 1) }),
			...(phases.length ? { phase: pick(phases) } : {}),
			...(dependsOn.length ? { dependsOn } : {}),
			...(!milestone && next() < 0.2 ? { progress: Math.floor(next() * 101) } : {}),
		};
	});
	const used = phases.filter((phase) => tasks.some((task) => task.phase === phase));
	return parseGanttDiagram({
		id: `fuzz-${seed}`,
		title: `Fuzz plan ${seed}`,
		type: "gantt",
		tasks,
		...(used.length ? { phases: used } : {}),
		...(next() < 0.3 ? { today: formatGanttDay(origin + Math.floor(next() * span)) } : {}),
	}).pipe(Result.getOrThrow);
}

/** A plan scheduled like a real one: each task starts once the earlier tasks it depends on end. */
function scheduledGantt(seed: number): GanttDiagram {
	const next = random(seed);
	const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)]!;
	const count = 2 + Math.floor(next() * 34);
	const unit = [1, 3, 7, 30][Math.floor(next() * 4)]!;
	const origin = parseGanttDay("2026-01-05")!;
	const ends: number[] = [];
	const tasks = Array.from({ length: count }, (_, index) => {
		const recent = Array.from({ length: Math.min(index, 6) }, (_, back) => index - 1 - back);
		const dependsOn = recent.filter(() => next() < 0.3).slice(0, 3);
		const ready = dependsOn.length
			? Math.max(...dependsOn.map((earlier) => ends[earlier]!))
			: origin + Math.floor(next() * 4 * unit);
		const start = ready + Math.floor(next() * 2 * unit);
		const milestone = next() < 0.15;
		const duration = 1 + Math.floor(next() * 5 * unit);
		ends.push(milestone ? start : start + duration);
		const words = Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(WORDS));
		return {
			id: `t${index}`,
			label: `${words.join(" ")} ${index}`,
			start: formatGanttDay(start),
			...(milestone ? { milestone: true } : { duration }),
			...(dependsOn.length ? { dependsOn: dependsOn.map((earlier) => `t${earlier}`) } : {}),
		};
	});
	return parseGanttDiagram({
		id: `scheduled-${seed}`,
		title: `Scheduled ${seed}`,
		type: "gantt",
		tasks,
	}).pipe(Result.getOrThrow);
}
