import {
	estimateTextWidth,
	formatGanttDay,
	ganttFixture,
	ganttTaskSchedule,
	getCanvasValidationIssues,
	parseGanttDay,
	parseGanttDiagram,
	type GanttDiagram,
} from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { renderDiagram } from "../diagram.js";
import {
	GANTT_MIN_BAR_WIDTH,
	JOIN_BUDGET,
	REPAIR_BUDGET,
	ganttCaptions,
	layoutGanttDiagram,
	renderGanttDiagram,
} from "../gantt.js";
import { ROUTE_BUDGET, ROUTE_CHART_BUDGET, ROUTE_KINK_BUDGET } from "../gantt-routing.js";
import { readGanttScene } from "../gantt-readout.js";
import { GANTT_TICK_FONT_SIZE, ganttAxis } from "../gantt-scale.js";
import type { RenderedDiagramScene, SceneElement, ScenePoint } from "../scene.js";

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

/** Every layout invariant a Gantt chart promises, checked on its scene alone. */
function expectReadableGantt(
	diagram: GanttDiagram,
	{ distinct = true }: { readonly distinct?: boolean } = {},
): RenderedDiagramScene {
	const { scene, work } = layoutGanttDiagram(diagram);
	const context = diagram.id;
	expect(getCanvasValidationIssues(scene), context).toEqual([]);
	// Routing work is bounded however crowded the plan: per layout, each dependency is placed,
	// tried in at most two more arrival plans, and rerouted at most twice, within the chart's and
	// the repairs' search budgets (each may overrun by one route's last search) and the budgets for
	// weighing kinks and joining another route's last run. A chart whose first layout doesn't read
	// clean is laid out the earlier way too, and once more clear of every mark where that way runs
	// too close to one; one whose routes still meet is laid out at most twice more.
	const dependencyCount = diagram.tasks.reduce(
		(sum, task) => sum + (task.dependsOn?.length ?? 0),
		0,
	);
	expect(work.layouts, `${context} layouts`).toBeLessThanOrEqual(5);
	expect(work.placements, `${context} placements`).toBeLessThanOrEqual(
		5 * dependencyCount * work.layouts,
	);
	expect(work.expansions, `${context} search steps`).toBeLessThanOrEqual(
		(ROUTE_CHART_BUDGET + REPAIR_BUDGET + 2 * ROUTE_BUDGET + ROUTE_KINK_BUDGET + JOIN_BUDGET) *
			work.layouts,
	);
	const readout = readGanttScene(scene);
	// Ticks are nice and cover the plan; bars sit on their dates.
	const schedules = diagram.tasks.map((task) => ({ task, schedule: ganttTaskSchedule(task)! }));
	const first = Math.min(...schedules.map(({ schedule }) => schedule.start));
	const last = Math.max(
		...schedules.map(({ schedule }) => Math.max(schedule.end, schedule.start + 1)),
	);
	expect(readout.gridlines[0]!.day, context).toBeLessThanOrEqual(first);
	expect(readout.gridlines.at(-1)!.day, context).toBeGreaterThanOrEqual(last);
	for (const { day, x } of readout.gridlines)
		expect(x, `${context} gridline ${formatGanttDay(day)}`).toBeCloseTo(
			readout.gridlines[0]!.x + (day - readout.gridlines[0]!.day) * readout.pxPerDay,
			1,
		);
	for (const { task, schedule } of schedules) {
		const mark = readout.marks.get(task.id)!;
		expect(mark.milestone, `${context} ${task.id}`).toBe(schedule.milestone);
		expect(mark.start, `${context} ${task.id} start`).toBeCloseTo(schedule.start, 1);
		// Bars narrower than the minimum draw at the minimum.
		expect(mark.end, `${context} ${task.id} end`).toBeCloseTo(
			schedule.milestone
				? schedule.end
				: Math.max(schedule.end, schedule.start + GANTT_MIN_BAR_WIDTH / readout.pxPerDay),
			1,
		);
	}
	// Text is whole, never overlaps other text or a mark, and stays in the scene.
	const texts = scene.elements.flatMap((element) =>
		element.type === "text" ? [textBox(element)] : [],
	);
	const marks: Box[] = [...readout.marks.values()].map((mark) => ({
		...mark,
		id: `gantt:task:${mark.id}`,
	}));
	// Problems gather into one assertion per check, so big plans stay quick to verify.
	const textProblems: string[] = [];
	texts.forEach((text, index) => {
		for (const other of texts.slice(index + 1))
			if (overlaps(text, other)) textProblems.push(`${text.id} overlaps ${other.id}`);
		for (const mark of marks)
			if (overlaps(text, mark)) textProblems.push(`${text.id} overlaps ${mark.id}`);
		if (text.left < 0 || text.top < 0 || text.right > scene.width || text.bottom > scene.height)
			textProblems.push(`${text.id} clipped`);
	});
	expect(textProblems, context).toEqual([]);
	for (const task of diagram.tasks) {
		const label = scene.elements.find((element) => element.id === `gantt:label:${task.id}`);
		expect(label?.type === "text" && label.text.replace(/\n/gu, " "), context).toBe(task.label);
	}
	// Every dependency is drawn: orthogonal, from its predecessor into its successor, clear of
	// every other mark and every text.
	const arrows = scene.elements.filter((element) => element.type === "arrow");
	const dependencies = diagram.tasks.reduce((sum, task) => sum + (task.dependsOn?.length ?? 0), 0);
	expect(arrows, context).toHaveLength(dependencies);
	const crossings: string[] = [];
	for (const arrow of arrows) {
		const ends = new Set([arrow.sourceNodeId, arrow.targetNodeId]);
		arrow.points.slice(1).forEach((to, index) => {
			const from = arrow.points[index]!;
			if (Math.abs(from.x - to.x) >= 0.01 && Math.abs(from.y - to.y) >= 0.01)
				crossings.push(`${arrow.id} is not orthogonal`);
			for (const box of [...marks.filter((mark) => !ends.has(mark.id)), ...texts])
				if (enters(box, from, to)) crossings.push(`${arrow.id} crosses ${box.id}`);
		});
	}
	// No rule crosses text.
	for (const element of scene.elements) {
		if (element.type !== "line" || !/^gantt:(grid|minor|axis|band-edge|today)/u.test(element.id))
			continue;
		for (const text of texts)
			if (enters(text, element.points[0], element.points[1]))
				crossings.push(`${element.id} crosses ${text.id}`);
	}
	expect(crossings, context).toEqual([]);
	expect(clearanceProblems(arrows, marks), context).toEqual([]);
	expect(distinctProblems(scene, distinct), context).toEqual([]);
	return scene;
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
					problems.push(`${arrow.id} runs ${gap.toFixed(1)} px from ${mark.id}`);
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
function distinctProblems(scene: RenderedDiagramScene, strict: boolean): string[] {
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
					problems.push(`${other.id} runs through the head of ${arrow.id}`);
				runs.forEach((own, index) => {
					const leaving = arrow.sourceNodeId === other.sourceNodeId && index === 0 && at === 0;
					const arriving =
						arrow.targetNodeId === other.targetNodeId &&
						((index === runs.length - 1 && at === otherRuns.length - 1) ||
							(joint && index >= stemStart(runs) && at >= stemStart(otherRuns)));
					if (!leaving && !arriving && sideBySide(own, run, strict ? 2 : 0.01) > 1)
						problems.push(`${arrow.id} runs along ${other.id}`);
				});
			});
		}
		// Past its first run and before its last, a route keeps off its own ends' edges.
		if (strict)
			for (const run of runs.slice(1, -1))
				for (const id of [arrow.sourceNodeId, arrow.targetNodeId]) {
					const node = nodes.get(id)!;
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
						problems.push(`${arrow.id} runs along the edge of ${id}`);
				}
	}
	return problems;
}

/** Pairs of routes that cross: a run of one through the interior of a run of the other. */
function crossings(routes: readonly { from: string; to: string; points: readonly ScenePoint[] }[]) {
	const runsOf = (points: readonly ScenePoint[]) =>
		points.slice(1).map((to, index) => ({ from: points[index]!, to }));
	return routes.flatMap((route, index) =>
		routes.slice(index + 1).flatMap((other) =>
			runsOf(route.points).some((a) =>
				runsOf(other.points).some((b) => {
					if (isHorizontal(a) === isHorizontal(b)) return false;
					const [h, v] = isHorizontal(a) ? [a, b] : [b, a];
					return (
						v.from.x > Math.min(h.from.x, h.to.x) + 0.5 &&
						v.from.x < Math.max(h.from.x, h.to.x) - 0.5 &&
						h.from.y > Math.min(v.from.y, v.to.y) + 0.5 &&
						h.from.y < Math.max(v.from.y, v.to.y) - 0.5
					);
				}),
			)
				? [`${route.from}->${route.to} crosses ${other.from}->${other.to}`]
				: [],
		),
	);
}

/** How often a route turns. */
function turns(points: readonly ScenePoint[]): number {
	const runs = points.slice(1).map((to, index) => ({ from: points[index]!, to }));
	return runs.filter(
		(run, index) => index > 0 && isHorizontal(run) !== isHorizontal(runs[index - 1]!),
	).length;
}

/** Steps in a route: a run shorter than 28 px between two parallel runs. */
function steps(points: readonly ScenePoint[]): number[] {
	const runs = points.slice(1).map((to, index) => ({ from: points[index]!, to }));
	return runs.flatMap((run, index) => {
		const [before, after] = [runs[index - 1], runs[index + 1]];
		const length = Math.abs(run.to.x - run.from.x) + Math.abs(run.to.y - run.from.y);
		return before && after && isHorizontal(before) === isHorizontal(after) && length < 28
			? [Math.round(length * 10) / 10]
			: [];
	});
}

/** Whether a route hooks: some run heads against an earlier run along the same axis. */
function hooks(points: readonly ScenePoint[]): boolean {
	const headings = new Set<string>();
	for (const [index, to] of points.slice(1).entries()) {
		const from = points[index]!;
		const heading =
			Math.abs(from.y - to.y) < 0.01 ? Math.sign(to.x - from.x) * 2 : Math.sign(to.y - from.y);
		if (headings.has(String(-heading))) return true;
		headings.add(String(heading));
	}
	return false;
}

/**
 * Whether a route doubles back: some run goes left of both its predecessor's start and the
 * corridor just before its successor's start.
 */
function runsBack(scene: RenderedDiagramScene, arrowId: string): boolean {
	const readout = readGanttScene(scene);
	const dependency = readout.dependencies.find(
		(entry) => `gantt:dependency:${entry.from}:${entry.to}` === arrowId,
	)!;
	const from = readout.marks.get(dependency.from)!;
	const to = readout.marks.get(dependency.to)!;
	const limit = Math.min(from.left, to.left - 40);
	return dependency.points.some((point) => point.x < limit - 0.5);
}

/**
 * Plans per fuzz. CI runs a handful; `pnpm nx run diagram-renderer:gantt-fuzz` runs 300 as
 * local proof when layout or routing changes.
 */
const FUZZ_SEEDS = Number(process.env["GANTT_FUZZ_SEEDS"] ?? 4);
const FUZZ_TIMEOUT = Math.max(60_000, FUZZ_SEEDS * 1_000);

/** Bars narrower than this, with this many dependencies arriving or leaving, have no room for each apart. */
const SLIVER_WIDTH = 12;
const SLIVER_ROUTES = 4;

const plan = (tasks: object[], extra: object = {}) =>
	parseGanttDiagram({ id: "plan", title: "Plan", type: "gantt", tasks, ...extra });

describe("Gantt renderer", () => {
	it("renders the fixture into a valid, deterministic scene", () => {
		const scene = renderDiagram(ganttFixture);
		expect(scene.diagramId).toBe("release-plan");
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(renderDiagram(ganttFixture)).toEqual(scene);
		expectReadableGantt(ganttFixture);
	});

	it.each([
		["3 weeks", "2026-03-02", "2026-03-20", "day", 1],
		["3 months", "2026-03-02", "2026-05-29", "week", 1],
		["a year", "2026-01-05", "2026-12-18", "month", 1],
		["3 years", "2026-01-05", "2028-11-30", "quarter", 1],
		["12 years", "2026-01-05", "2037-06-30", "year", 1],
	])("chooses nice ticks by span: %s reads in %ss", (_name, start, end, unit, step) => {
		const axis = ganttAxis(parseGanttDay(start)!, parseGanttDay(end)! + 1);
		expect([axis.unit, axis.step]).toEqual([unit, step]);
		expect(axis.start).toBeLessThanOrEqual(parseGanttDay(start)!);
		expect(axis.end).toBeGreaterThan(parseGanttDay(end)!);
		// Cells start on their unit's boundary and tile the axis.
		for (const [index, cell] of axis.cells.entries()) {
			const date = new Date(cell.start * 86_400_000);
			if (unit === "week") expect(date.getUTCDay()).toBe(1);
			if (unit === "month" || unit === "quarter" || unit === "year")
				expect(date.getUTCDate()).toBe(1);
			if (unit === "quarter") expect(date.getUTCMonth() % 3).toBe(0);
			if (unit === "year") expect(date.getUTCMonth()).toBe(0);
			expect(cell.end).toBe(axis.cells[index + 1]?.start ?? axis.end);
		}
	});

	it("draws bars to scale, and names every task in a column left of the plot, level with its bar", () => {
		const diagram = plan(
			[
				{ id: "long", label: "Fits", start: "2026-03-02", duration: 10, phase: "Build" },
				{
					id: "short",
					label: "A name far too long for its bar",
					start: "2026-03-05",
					duration: 1,
					phase: "Build",
				},
				{ id: "gate", label: "Gate", start: "2026-03-16", milestone: true, phase: "Ship" },
			],
			{ phases: ["Build", "Ship"] },
		);
		const scene = expectReadableGantt(diagram);
		const readout = readGanttScene(scene);
		const long = readout.marks.get("long")!;
		const short = readout.marks.get("short")!;
		expect((long.right - long.left) / (short.right - short.left)).toBeCloseTo(10, 2);
		const box = (id: string) => {
			const element = scene.elements.find((entry) => entry.id === id);
			if (element?.type !== "text") throw new Error(`missing ${id}`);
			return textBox(element);
		};
		const plotLeft = readout.gridlines[0]!.x;
		const names = ["long", "short", "gate"].map((id) => box(`gantt:label:${id}`));
		const phase = box("gantt:phase:0");
		for (const [index, id] of ["long", "short", "gate"].entries()) {
			const name = names[index]!;
			const dates = box(`gantt:caption:${id}`);
			const mark = readout.marks.get(id)!;
			// Names line up, in from their phase's, then dates, then the plot; each level with its mark.
			expect(name.left, id).toBeCloseTo(names[0]!.left, 1);
			expect(name.left, id).toBeGreaterThan(phase.left);
			expect(dates.left, id).toBeGreaterThan(name.right);
			expect(dates.right, id).toBeLessThan(plotLeft);
			expect((name.top + name.bottom) / 2, id).toBeCloseTo((mark.top + mark.bottom) / 2, 0);
		}
		// Dates right-align in their column, phase spans with them.
		expect(box("gantt:caption:long").right).toBeCloseTo(box("gantt:phase-caption:0").right, 1);
		// A rule runs between every two rows, from the table's left across the plot.
		const rules = scene.elements.filter(
			(element) => element.type === "line" && element.id.startsWith("gantt:row-rule:"),
		);
		expect(rules).toHaveLength(5);
		for (const rule of rules)
			if (rule.type === "line") {
				expect(rule.points[0].x).toBeLessThanOrEqual(phase.left + 0.5);
				expect(rule.points[1].x).toBeCloseTo(readout.gridlines.at(-1)!.x, 1);
			}
	});

	it("groups a row's name with its dates, apart from its bar, so dragging a bar keeps the table", () => {
		const scene = expectReadableGantt(
			plan([{ id: "a", label: "Build", start: "2026-03-02", end: "2026-03-13", progress: 40 }]),
		);
		const groups = (id: string) => scene.elements.find((element) => element.id === id)?.groupIds;
		expect(groups("gantt:label:a")).toEqual(["gantt:row:a"]);
		expect(groups("gantt:caption:a")).toEqual(["gantt:row:a"]);
		expect(groups("node:gantt:task:a")).toEqual(["gantt:task:a"]);
		expect(groups("node:gantt:progress:a")).toEqual(["gantt:task:a"]);
	});

	it("draws milestones as diamonds on their day and Today as a dashed line", () => {
		const diagram = plan(
			[
				{ id: "build", label: "Build", start: "2026-03-02", end: "2026-03-13" },
				{ id: "ship", label: "Ship", start: "2026-03-16", milestone: true, dependsOn: ["build"] },
			],
			{ today: "2026-03-10" },
		);
		const scene = expectReadableGantt(diagram);
		const readout = readGanttScene(scene);
		expect(readout.marks.get("ship")?.milestone).toBe(true);
		expect(readout.today).toBe(parseGanttDay("2026-03-10"));
		const today = scene.elements.find((element) => element.id === "gantt:today");
		expect(today?.type === "line" && today.strokeStyle).toBe("dashed");
		expect(scene.elements.find((element) => element.id === "gantt:today-label")).toMatchObject({
			text: "Today · Mar 10",
		});
	});

	it("routes a dependency from its predecessor's end into its successor's start", () => {
		const diagram = plan([
			{ id: "a", label: "Design", start: "2026-03-02", end: "2026-03-06" },
			{ id: "b", label: "Build", start: "2026-03-09", duration: 5, dependsOn: ["a"] },
		]);
		const scene = expectReadableGantt(diagram);
		const readout = readGanttScene(scene);
		const [arrow] = readout.dependencies;
		const a = readout.marks.get("a")!;
		const b = readout.marks.get("b")!;
		const start = arrow!.points[0]!;
		const end = arrow!.points.at(-1)!;
		expect(start.x).toBeGreaterThan(a.right - 31);
		expect(start.x).toBeLessThanOrEqual(a.right);
		expect(end).toEqual({ x: b.left, y: (b.top + b.bottom) / 2 });
	});

	it("runs every dependency forward when a forward route exists, and never back past its predecessor", () => {
		const diagram = plan([
			{ id: "a", label: "Discovery", start: "2026-03-02", end: "2026-03-06" },
			{ id: "b", label: "Build", start: "2026-03-09", end: "2026-03-13", dependsOn: ["a"] },
			{ id: "c", label: "Docs", start: "2026-03-09", end: "2026-03-20", dependsOn: ["a"] },
			{ id: "d", label: "Test", start: "2026-03-23", end: "2026-03-27", dependsOn: ["b", "c"] },
			{ id: "e", label: "Release", start: "2026-03-30", milestone: true, dependsOn: ["d", "a"] },
		]);
		const scene = expectReadableGantt(diagram);
		for (const arrow of readGanttScene(scene).dependencies)
			expect(runsBack(scene, `gantt:dependency:${arrow.from}:${arrow.to}`), arrow.to).toBe(false);
	});

	it("takes a successor that starts before its predecessor ends through its own elbow into its start", () => {
		const diagram = plan([
			{ id: "p", label: "Platform", start: "2026-03-02", end: "2026-03-13" },
			{ id: "s", label: "Pilot", start: "2026-03-09", end: "2026-03-20", dependsOn: ["p"] },
		]);
		const scene = expectReadableGantt(diagram);
		const readout = readGanttScene(scene);
		const [arrow] = readout.dependencies;
		const p = readout.marks.get("p")!;
		const s = readout.marks.get("s")!;
		// Down from the predecessor's end, back in the gutter above the successor, into its start.
		expect(arrow!.points[0]!.y).toBe(p.bottom);
		expect(arrow!.points[0]!.x).toBeGreaterThan(s.left);
		const end = arrow!.points.at(-1)!;
		expect(end.x - s.left).toBeLessThanOrEqual(32);
		expect([s.top, (s.top + s.bottom) / 2]).toContain(end.y);
		for (const point of arrow!.points) expect(point.x).toBeGreaterThanOrEqual(s.left - 40);
		expect(runsBack(scene, "gantt:dependency:p:s")).toBe(false);
	});

	it("routes around bars and labels in the rows between, and never along another dependency", () => {
		// The middle task's long bar sits between the predecessor and its successors.
		const diagram = plan([
			{ id: "a", label: "Discovery", start: "2026-03-02", end: "2026-03-06" },
			{ id: "wide", label: "Platform work", start: "2026-03-02", end: "2026-04-24" },
			{ id: "b", label: "Build", start: "2026-03-09", duration: 10, dependsOn: ["a"] },
			{ id: "c", label: "Docs", start: "2026-03-09", duration: 5, dependsOn: ["a"] },
			{
				id: "d",
				label: "Release",
				start: "2026-04-27",
				milestone: true,
				dependsOn: ["wide", "b", "c"],
			},
		]);
		expectReadableGantt(diagram);
	});

	it("runs dependencies out of one milestone down one trunk, branching off without crossing", () => {
		// Review: three routes out of a sign-off milestone each found their own way down and crossed
		// twice.
		const diagram = plan([
			{ id: "prep", label: "Preparation work", start: "2026-03-02", end: "2026-03-13" },
			{ id: "gate", label: "Gate", start: "2026-03-16", milestone: true, dependsOn: ["prep"] },
			{ id: "c1", label: "Catalog", start: "2026-03-18", duration: 10, dependsOn: ["gate"] },
			{ id: "c2", label: "Orders", start: "2026-03-18", duration: 20, dependsOn: ["gate"] },
			{ id: "c3", label: "Clickstream", start: "2026-03-23", duration: 8, dependsOn: ["gate"] },
		]);
		const routes = readGanttScene(expectReadableGantt(diagram)).dependencies;
		const fanned = routes.filter((route) => route.from === "gate");
		for (const route of fanned) {
			expect(route.points[0], route.to).toEqual(fanned[0]!.points[0]);
			expect(turns(route.points), route.to).toBe(1);
		}
		expect(crossings(routes)).toEqual([]);
	});

	it("drops straight into a successor starting under its predecessor's end, or turns once into its side", () => {
		// Review: these drew a small step just before each arrowhead.
		const diagram = plan([
			{ id: "a", label: "Workstream 1", start: "2026-01-05", duration: 4 },
			{ id: "b", label: "Workstream 2", start: "2026-01-08", duration: 6, dependsOn: ["a"] },
			{ id: "c", label: "Architecture", start: "2026-01-26", duration: 10, dependsOn: ["b"] },
			{ id: "d", label: "Approved", start: "2026-02-06", milestone: true, dependsOn: ["c"] },
		]);
		const routes = readGanttScene(expectReadableGantt(diagram)).dependencies;
		const route = (to: string) => routes.find((entry) => entry.to === to)!.points;
		expect(turns(route("b")), "a->b").toBe(0);
		expect(turns(route("d")), "c->d").toBe(1);
		for (const { to, points } of routes) expect(steps(points), to).toEqual([]);
	});

	it("turns once out of a short bar's end into a tiny successor starting the next day", () => {
		// A/B: Final delta sync -> Switch traffic stepped into the tiny bar from the gutter above.
		const diagram = plan([
			{ id: "freeze", label: "Freeze", start: "2026-06-22", milestone: true },
			{ id: "sync", label: "Sync", start: "2026-06-22", duration: 3, dependsOn: ["freeze"] },
			{ id: "switch", label: "Switch", start: "2026-06-25", duration: 2, dependsOn: ["sync"] },
			{ id: "live", label: "Live", start: "2026-06-29", milestone: true, dependsOn: ["switch"] },
			{ id: "archive", label: "Archive", start: "2026-02-02", end: "2026-07-17" },
		]);
		const routes = readGanttScene(expectReadableGantt(diagram)).dependencies;
		const route = routes.find((entry) => entry.to === "switch")!.points;
		expect(turns(route)).toBe(1);
		expect(steps(route)).toEqual([]);
	});

	it("drops onto a milestone's edge past a bar that ends just short of its vertex", () => {
		// Round 18: Finance reports -> Wave 1 sign-off passed Wave 1 validation, which ends 2 px short
		// of the diamond's vertex, and hooked back to that vertex.
		const diagram = plan([
			{ id: "finance", label: "Finance reports", start: "2026-04-13", duration: 15 },
			{ id: "validation", label: "Wave 1 validation", start: "2026-04-20", end: "2026-04-30" },
			{
				id: "signoff",
				label: "Sign-off",
				start: "2026-05-01",
				milestone: true,
				dependsOn: ["finance", "validation"],
			},
			{ id: "programme", label: "Programme", start: "2026-01-05", end: "2026-07-31" },
		]);
		const readout = readGanttScene(expectReadableGantt(diagram));
		const route = readout.dependencies.find((entry) => entry.from === "finance")!.points;
		expect(hooks(route)).toBe(false);
		expect(turns(route)).toBe(1);
		const end = route.at(-1)!;
		const signoff = readout.marks.get("signoff")!;
		expect(end.x).toBeGreaterThan(readout.marks.get("validation")!.right);
		expect(end.x).toBeLessThan(signoff.right);
		expect(end.y).toBeLessThan((signoff.top + signoff.bottom) / 2);
	});

	it("joins another arrival's last run when the one clear entry into their successor is taken", () => {
		// Round 18: Migrate catalog -> Wave 2 validation ran around its successor and up into its
		// bottom, as Migrate order history's route took the one top entry clear of the bars between.
		const diagram = plan([
			{ id: "catalog", label: "Catalog", start: "2026-05-04", end: "2026-05-22" },
			{ id: "orders", label: "Orders", start: "2026-05-04", end: "2026-06-05" },
			{ id: "clicks", label: "Clickstream", start: "2026-05-11", duration: 20 },
			{
				id: "dashboards",
				label: "Dashboards",
				start: "2026-06-01",
				end: "2026-06-12",
				dependsOn: ["clicks"],
			},
			{
				id: "validation",
				label: "Validation",
				start: "2026-06-08",
				end: "2026-06-19",
				dependsOn: ["catalog", "orders"],
			},
			{ id: "programme", label: "Programme", start: "2026-01-05", end: "2026-07-31" },
		]);
		const readout = readGanttScene(expectReadableGantt(diagram));
		const arrivals = readout.dependencies.filter((entry) => entry.to === "validation");
		for (const { from, points } of arrivals) {
			expect(hooks(points), from).toBe(false);
			expect(turns(points), from).toBe(1);
		}
		// One arrowhead: the later route carries on along the earlier one's last run.
		expect(arrivals[0]!.points.at(-1)).toEqual(arrivals[1]!.points.at(-1));
	});

	it("hooks around a bar over its successor's start half a bar height clear of it, back to the start", () => {
		// Round 18: Data lake storage -> Monitoring turned 14 px past Orchestration's end, only to keep
		// its run back to Monitoring's start 28 px long; at 8 px, judges read a route rounding a bar
		// as tracing its edge.
		const diagram = plan([
			{ id: "lake", label: "Lake", start: "2026-03-02", end: "2026-03-13" },
			{ id: "orchestration", label: "Orchestration", start: "2026-03-02", end: "2026-03-20" },
			{
				id: "monitoring",
				label: "Monitoring",
				start: "2026-03-16",
				duration: 7,
				dependsOn: ["lake"],
			},
			{ id: "programme", label: "Programme", start: "2026-01-05", end: "2026-07-31" },
		]);
		const readout = readGanttScene(expectReadableGantt(diagram));
		const [route] = readout.dependencies;
		const blocker = readout.marks.get("orchestration")!;
		const monitoring = readout.marks.get("monitoring")!;
		// Orchestration covers every column from Lake's end to Monitoring's start: the route must hook.
		expect(hooks(route!.points)).toBe(true);
		const turn = Math.max(...route!.points.map((point) => point.x));
		expect(turn - blocker.right).toBeGreaterThanOrEqual(14.5);
		expect(turn - blocker.right).toBeLessThanOrEqual(15.5);
		expect(route!.points.at(-1)!.x - monitoring.left).toBeLessThanOrEqual(8);
	});

	it("keeps fallback routes down the corridor a bar's clearance from the bars at the axis start", () => {
		// Review (PR #506): fallback routes down the corridor ran 1.5 px beside bars starting on the
		// axis's first day, and their gutter runs 1 px above others.
		expectReadableGantt(fuzzGantt(62), { distinct: false });
	});

	it("keeps a crowded plan's fallback routes apart and clear of its marks, without roomier layouts", () => {
		// Review (PR #506): with every search spent, t2 -> t29 fell back down the corridor 1.5 px from
		// t8 -> t28 for 1,600 px, and two roomier layouts tried in vain to clear it. The earlier
		// routing's own fallbacks here ran 2 px from bars at the axis start, so it is laid out once more
		// clear of them.
		const scene = expectReadableGantt(fuzzGantt(464));
		expect(readGanttScene(scene).dependencies.length).toBeGreaterThan(40);
		const { work } = layoutGanttDiagram(fuzzGantt(464));
		expect(work.layouts).toBeLessThanOrEqual(3);
		expect(work.conflicts).toBe(0);
	});

	it("crosses no more often than the earlier routing where its forward choices would", () => {
		// Review (PR #506): scheduled-188's routes crossed in 26 pairs where the earlier routing's
		// crossed in 16.
		const routes = readGanttScene(expectReadableGantt(scheduledGantt(188))).dependencies;
		expect(crossings(routes).length).toBeLessThanOrEqual(16);
	});

	it("keeps a plain elbow however the search first reaches its turn", () => {
		// Review: two ways into one point and heading were kept as one, the cheaper so far, though
		// the dearer had turned long enough before to bend again without a kink. t19 -> t23 took a
		// 25 px step that a cheaper route avoided.
		const routes = readGanttScene(expectReadableGantt(scheduledGantt(4))).dependencies;
		const route = routes.find((entry) => entry.from === "t19" && entry.to === "t23")!;
		expect(steps(route.points)).toEqual([]);
	});

	it("groups rows under phase headers in phase order, with phase spans in the date column", () => {
		const diagram = plan(
			[
				{ id: "a", label: "Survey", start: "2026-06-01", duration: 3, phase: "Prepare" },
				{
					id: "b",
					label: "Build",
					start: "2026-06-08",
					duration: 5,
					phase: "Make",
					dependsOn: ["a"],
				},
				{ id: "c", label: "Permit", start: "2026-06-01", duration: 2, phase: "Prepare" },
			],
			{ phases: ["Prepare", "Make"] },
		);
		const scene = expectReadableGantt(diagram);
		const readout = readGanttScene(scene);
		expect(readout.phases).toEqual([
			{ name: "Prepare", tasks: ["a", "c"] },
			{ name: "Make", tasks: ["b"] },
		]);
		const captions = ganttCaptions(diagram);
		expect(captions.phases.get("Prepare")).toBe("Jun 1–3, 2026");
		expect(readout.captions.get("b")).toBe("Jun 8–12");
	});

	it("states progress in the date column and as a darker fill over the completed part", () => {
		const scene = expectReadableGantt(
			plan([{ id: "a", label: "Build", start: "2026-03-02", end: "2026-03-13", progress: 40 }]),
		);
		expect(readGanttScene(scene).captions.get("a")).toBe("Mar 2–13, 2026 · 40%");
		const done = scene.elements.find((element) => element.id === "node:gantt:progress:a");
		const bar = scene.elements.find((element) => element.id === "node:gantt:task:a");
		if (done?.type !== "node" || bar?.type !== "node") throw new Error("missing progress fill");
		expect(done).toMatchObject({ x: bar.x, y: bar.y, height: bar.height, shape: "rectangle" });
		expect(done.width / bar.width).toBeCloseTo(0.4, 2);
		expect(done.fillColor).not.toBe(bar.fillColor);
	});

	it("gives every incoming dependency its own entry, clear of the Today line", () => {
		const diagram = plan(
			[
				{ id: "a", label: "A", start: "2026-03-02", duration: 3 },
				{ id: "b", label: "B", start: "2026-03-02", duration: 4 },
				{ id: "c", label: "C", start: "2026-03-03", duration: 3 },
				{ id: "d", label: "D", start: "2026-03-09", duration: 6, dependsOn: ["a", "b", "c"] },
				{ id: "m", label: "M", start: "2026-03-16", milestone: true, dependsOn: ["a", "b", "d"] },
			],
			{ today: "2026-03-09" },
		);
		const scene = expectReadableGantt(diagram);
		const readout = readGanttScene(scene);
		for (const target of ["d", "m"]) {
			const ends = readout.dependencies
				.filter((dependency) => dependency.to === target)
				.map((dependency) => dependency.points.at(-1)!);
			expect(ends).toHaveLength(3);
			ends.forEach((end, index) => {
				for (const other of ends.slice(index + 1))
					expect(Math.hypot(end.x - other.x, end.y - other.y)).toBeGreaterThanOrEqual(7);
			});
		}
		const today = scene.elements.find((element) => element.id === "gantt:today");
		if (today?.type !== "line") throw new Error("missing Today");
		for (const dependency of readout.dependencies)
			for (const [index, to] of dependency.points.slice(1).entries()) {
				const from = dependency.points[index]!;
				if (Math.abs(from.x - to.x) < 0.01)
					expect(Math.abs(from.x - today.points[0].x)).toBeGreaterThanOrEqual(3.5);
			}
	});

	it("names each dependency unambiguously when task ids contain colons", () => {
		const scene = expectReadableGantt(
			plan([
				{ id: "a", label: "A", start: "2026-03-01", duration: 1 },
				{ id: "b:c", label: "BC", start: "2026-03-02", duration: 1, dependsOn: ["a"] },
				{ id: "a:b", label: "AB", start: "2026-03-03", duration: 1 },
				{ id: "c", label: "C", start: "2026-03-04", duration: 1, dependsOn: ["a:b"] },
			]),
		);
		const ids = scene.elements.flatMap((element) => (element.type === "arrow" ? [element.id] : []));
		expect(new Set(ids).size).toBe(2);
		expect(readGanttScene(scene).dependencies.map(({ from, to }) => `${from}>${to}`)).toEqual([
			"a>b:c",
			"a:b>c",
		]);
	});

	it("keeps years below 100 on their own calendar", () => {
		const scene = expectReadableGantt(
			plan([{ id: "a", label: "Ancient works", start: "0090-01-01", end: "0090-06-30" }]),
		);
		const readout = readGanttScene(scene);
		expect(formatGanttDay(readout.gridlines[0]!.day)).toBe("0090-01-01");
		expect(readout.marks.get("a")!.start).toBeCloseTo(parseGanttDay("0090-01-01")!, 1);
	});

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

	it("rejects a billion-day task before laying out any axis", () => {
		expect(() =>
			renderGanttDiagram(
				plan([{ id: "a", label: "Forever", start: "2026-03-02", duration: 1_000_000_000 }]),
			),
		).toThrow(/duration/u);
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

	it("keeps the fallback corridor clear of a milestone in the axis's first days", () => {
		// Review: with 275 fuzz plans, two fallback routes crossed milestone t22 here.
		expectReadableGantt(fuzzGantt(275), { distinct: false });
	});

	it("lands no arrowhead on a route, and runs no route through one, around crowded marks", () => {
		// Review: t9 → t11 ran through the head of t3 → t9 at a crowded milestone. A wider sweep
		// found a sibling hugging its own milestone's bounds (477), and, once names left the plot, routes
		// out of a 3 px bar's right end through the arrowhead entering its left (1000).
		for (const seed of [81, 477, 1000]) expectReadableGantt(scheduledGantt(seed));
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
			for (let seed = 1; seed <= FUZZ_SEEDS; seed += 1) {
				const scene = expectReadableGantt(scheduledGantt(seed));
				// A successor in the next row that waits on that row alone, and starts once it ends, always
				// has a forward route, unless that row is a sliver whose other dependencies take the room
				// its exit needs.
				const readout = readGanttScene(scene);
				const rows = [...readout.marks.values()].toSorted((a, b) => a.top - b.top);
				for (const { from, to } of readout.dependencies) {
					const before = readout.marks.get(from)!;
					const after = readout.marks.get(to)!;
					const alone =
						readout.dependencies.filter((dependency) => dependency.to === to).length === 1;
					const sliver =
						before.right - before.left < SLIVER_WIDTH &&
						readout.dependencies.filter(
							(dependency) => dependency.to === from || dependency.from === from,
						).length >= SLIVER_ROUTES;
					if (
						alone &&
						!sliver &&
						rows.indexOf(after) === rows.indexOf(before) + 1 &&
						after.left >= before.right
					)
						expect(
							runsBack(scene, `gantt:dependency:${from}:${to}`),
							`scheduled-${seed} ${from}->${to}`,
						).toBe(false);
				}
			}
		},
	);
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
	});
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
	});
}
