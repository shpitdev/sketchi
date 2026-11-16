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
} from "../document.js";

import { readGanttScene } from "../readout.js";
import {
	GANTT_MIN_BAR_WIDTH,
	JOIN_BUDGET,
	REPAIR_BUDGET,
	layoutGanttDiagram,
	renderGanttDiagram,
} from "../render.js";
import { ROUTE_BUDGET, ROUTE_CHART_BUDGET, ROUTE_KINK_BUDGET } from "../routing.js";
import { GANTT_TICK_FONT_SIZE, ganttAxis } from "../scale.js";

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
): CanvasSpec {
	const { scene, work } = layoutGanttDiagram(diagram);
	const context = diagram.id;
	expect(getCanvasValidationIssues(scene), context).toEqual([]);
	expect(validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues, context).toEqual([]);
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

/**
 * Whether a route doubles back: some run goes left of both its predecessor's start and the
 * corridor just before its successor's start.
 */
function runsBack(scene: CanvasSpec, arrowId: string): boolean {
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
