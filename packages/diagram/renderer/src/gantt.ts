import {
	CANVAS_LIMITS,
	CANVAS_SPEC_VERSION,
	estimateTextWidth,
	formatGanttDay,
	ganttRows,
	ganttTaskSchedule,
	parseGanttDay,
	SKETCHI_DIAGRAM_PALETTE,
	validateGanttDiagram,
	wrapTextToWidth,
	type GanttDiagram,
	type GanttSchedule,
	type GanttTask,
	type TimelineDiagram,
} from "@sketchi/diagram-core";

import { CHART_SERIES_COLORS } from "./chart.js";
import {
	GANTT_BAND_FONT_SIZE,
	GANTT_TICK_FONT_SIZE,
	GANTT_PLOT_WIDTH,
	ganttAxis,
	ganttBandLabels,
	type GanttAxis,
} from "./gantt-scale.js";
import {
	KINK_LENGTH,
	ROUTE_APPROACH,
	ROUTE_SEPARATION,
	ROUTE_BUDGET,
	ROUTE_CHART_BUDGET,
	ROUTE_CHART_BUDGET_PER_ROUTE,
	ROUTE_KINK_BUDGET,
	ROUTE_KINK_BUDGET_PER_ROUTE,
	ROUTE_LEAD,
	ROUTE_VERTICAL_APPROACH,
	SIDE_DISTANCE,
	collinear,
	routeApproach,
	routeHead,
	routeKinkCost,
	routeOrthogonal,
	routeSegments,
	type RouteDirection,
	type RouteObstacle,
	type RoutePoint,
	type RoutePort,
	type RouteRequest,
	type RouteSegment,
} from "./gantt-routing.js";
import type {
	ArrowSceneElement,
	LineSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	TextSceneElement,
} from "./scene.js";
import { breakRulesUnderText } from "./scene-rules.js";
import { timelineCaptions } from "./timeline-captions.js";

export const GANTT_MARK_ROLE = "gantt-mark";

/**
 * A Gantt mark keeps its role only while it still reads as one: an unlabeled
 * bar, milestone or completed part on its gantt id.
 */
export function isStructurallyValidGanttMark(element: {
	readonly id: string;
	readonly nodeId: string;
	readonly icon?: unknown;
}): boolean {
	return (
		(element.nodeId.startsWith("gantt:task:") || element.nodeId.startsWith("gantt:progress:")) &&
		element.id === `node:${element.nodeId}` &&
		element.icon === undefined
	);
}

const PADDING = 40;
const LINE_HEIGHT = 1.35;
const TITLE_FONT = 20;
const LABEL_FONT = 14;
const CAPTION_FONT = 12;
const PHASE_FONT = 15;
const TODAY_FONT = 12;

const INK = SKETCHI_DIAGRAM_PALETTE.ink;
const MUTED_INK = "#4c4639";
const GRID_COLOR = "#e6dfd2";
const MINOR_GRID_COLOR = "#f0ebe1";
const ROW_RULE_COLOR = "#ebe4d8";
const BAND_GRID_COLOR = "#cbbfa9";
const AXIS_COLOR = "#8c826f";
const ARROW_COLOR = "#5c5345";
const TODAY_COLOR = "#c0392b";
/** The completed part of a bar mixes this much ink into its color. */
const PROGRESS_SHADE = 0.35;

/** A task row; bars sit in its middle and dependencies run in the gutters between rows. */
const ROW_HEIGHT = 44;
/** Extra row height for the layouts tried when routes still meet, roomiest last. */
const ROOMY_ROWS = [12, 24];
const ROOMY_CONFLICTS = 4;
const ROW_PAD = 8;
const PHASE_ROW_HEIGHT = 40;
const BAR_HEIGHT = 22;
const MILESTONE_SIZE = 26;
export const GANTT_MIN_BAR_WIDTH = 2;
const MIN_BAR_WIDTH = GANTT_MIN_BAR_WIDTH;
const CAPTION_GAP = 10;
/** The date column ends this far left of the plot. */
const COLUMN_GAP = 16;
/** Names end at least this far left of the date column. */
const NAME_GAP = 20;
/** Under a phase header, task names sit this far in from its name. */
const NAME_INDENT = 12;
/** A corridor between the date column and the axis start, free for dependencies. */
const CORRIDOR_WIDTH = 24;
/** Marks keep at least this far right of the corridor's last column. */
const CORRIDOR_MARK_GAP = 2;
/** Task names wrap at word boundaries past this width, phase names past this one. */
const NAME_MAX_WIDTH = 260;
const PHASE_MAX_WIDTH = 220;
const HEADER_ROW_HEIGHT = 22;
const TITLE_GAP = 14;
const TODAY_ROW_HEIGHT = 18;
/** A short chart's plot narrows, down to this, to keep the chart no wider than this times its height. */
const MIN_PLOT_WIDTH = 640;
const MAX_ASPECT = 2.2;
/** Charts this tall repeat the axis under their rows. */
const BOTTOM_AXIS_ROWS = 16;
/** Routes keep this far above and below bars, and farther beside them. */
const BAR_CLEARANCE = 4;
const BAR_SIDE_CLEARANCE = 8;
/**
 * Laid out clear, the axis starts past the corridor and a bar's side clearance, so routes down it
 * keep clear of every mark; else it starts right after the corridor, as before.
 */
const PLOT_INSET = CORRIDOR_WIDTH + BAR_SIDE_CLEARANCE;
/**
 * Columns where a route passes straight beside a bar: as close as it may and, laid out `forward`,
 * well clear of its end.
 */
function besideBar(box: Box, forward: boolean): number[] {
	const close = [box.left - BAR_SIDE_CLEARANCE, box.right + BAR_SIDE_CLEARANCE];
	return forward ? [box.left - SIDE_DISTANCE, ...close, box.right + SIDE_DISTANCE] : close;
}
/** A route keeps this far off its own predecessor and successor, but for its runs out of and into them. */
const OWN_CLEARANCE = 3;
/** A bar's further side entries sit this far above and below its middle, and cost this much. */
const SIDE_ENTRY_OFFSET = 7;
const SIDE_ENTRY_COST = 24;
/** Arrivals through a bar's top or bottom stay this far from where its own dependencies leave. */
const EXIT_SPACING = 8;
/** Spacing of the fallback entries along a crowded successor's outline. */
const OUTLINE_STEP = 3;
/** Entry points into one task stay this far apart, so arrowheads never stack. */
const ENTRY_SPACING = 11;
/** Arrow shafts and heads keep this far from the Today line. */
const TODAY_CLEARANCE = 5;
/**
 * Excalidraw sizes an arrowhead by its last run, so a dependency ends in a run
 * of its entry's approach length and heads draw alike.
 */
function withArrowheadRun(points: readonly RoutePoint[]): RoutePoint[] {
	const end = points.at(-1)!;
	const before = points.at(-2)!;
	const length = Math.abs(end.x - before.x) + Math.abs(end.y - before.y);
	const run = arrowheadRun(points);
	if (length <= run + 1) return [...points];
	const ratio = run / length;
	return [
		...points.slice(0, -1),
		{ x: end.x + (before.x - end.x) * ratio, y: end.y + (before.y - end.y) * ratio },
		end,
	];
}

/** The length of a route's final run that its arrowhead covers. */
function arrowheadRun(points: readonly RoutePoint[]): number {
	const end = points.at(-1)!;
	const before = points.at(-2)!;
	return Math.abs(end.y - before.y) < 0.01 ? ROUTE_APPROACH : ROUTE_VERTICAL_APPROACH;
}

/** Lanes in a gutter: its middle, then either side; when those fill, closer ones between. */
const LANE_OFFSETS = [0, -6, 6];
const DENSE_LANE_OFFSETS = [-3, 3];

type Layer = "back" | "middle" | "front";

interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

interface Measured {
	readonly text: string;
	readonly width: number;
	readonly height: number;
}

function measure(text: string, fontSize: number): Measured {
	return {
		text,
		width: Math.ceil(estimateTextWidth(text, fontSize)),
		height: Math.ceil(text.split("\n").length * fontSize * LINE_HEIGHT),
	};
}

/** Wrap at word boundaries; words stay whole even when wider than the line. */
function wrapped(text: string, width: number, fontSize: number): Measured {
	const single = measure(text, fontSize);
	return single.width <= width
		? single
		: measure(wrapTextToWidth(text, Math.max(1, width), fontSize), fontSize);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

class SceneBuilder {
	readonly elements: SceneElement[] = [];
	private readonly layers: Record<Layer, string[]> = { back: [], middle: [], front: [] };
	readonly textBoxes: Box[] = [];

	push(element: SceneElement, layer: Layer): void {
		this.elements.push(element);
		this.layers[layer].push(element.id);
	}

	zOrder(): string[] {
		return [...this.layers.back, ...this.layers.middle, ...this.layers.front];
	}

	text(
		id: string,
		value: Measured,
		left: number,
		top: number,
		fontSize: number,
		color: string,
		align: "center" | "left" | "right" = "left",
		extra: Partial<TextSceneElement> = {},
	): Box {
		const box = { left, top, right: left + value.width, bottom: top + value.height };
		this.push(
			{
				type: "text",
				id,
				x: round(left + value.width / 2),
				y: round(top + value.height / 2),
				text: value.text,
				fontSize,
				maxWidth: value.width,
				textAlign: align,
				textColor: color,
				...extra,
			} satisfies TextSceneElement,
			"front",
		);
		this.textBoxes.push(box);
		return box;
	}

	line(
		id: string,
		points: readonly RoutePoint[],
		style: Partial<LineSceneElement>,
		layer: Layer = "back",
	): void {
		const [first, second, ...rest] = points.map((point) => ({
			x: round(point.x),
			y: round(point.y),
		}));
		this.push(
			{
				type: "line",
				id,
				points: [first!, second!, ...rest],
				roughness: 0,
				strokeWidth: 1,
				...style,
			} satisfies LineSceneElement,
			layer,
		);
	}

	mark(
		nodeId: string,
		shape: NodeSceneElement["shape"],
		box: { x: number; y: number; width: number; height: number },
		label: string,
		style: Partial<NodeSceneElement>,
	): void {
		this.push(
			{
				type: "node",
				id: `node:${nodeId}`,
				nodeId,
				rendererRole: GANTT_MARK_ROLE,
				shape,
				// Edges round as the routes ending on them do, so every endpoint lands on its mark.
				x: round(box.x),
				y: round(box.y),
				width: round(round(box.x + box.width) - round(box.x)),
				height: round(round(box.y + box.height) - round(box.y)),
				label,
				roughness: 0,
				fillStyle: "solid",
				strokeWidth: 1,
				...style,
			} satisfies NodeSceneElement,
			"middle",
		);
	}

	breakRulesUnderText(
		isRule: (id: string) => boolean,
		boxes: readonly Box[] = this.textBoxes,
	): void {
		const replaced = breakRulesUnderText(this.elements, boxes, isRule);
		if (!replaced.size) return;
		const elements = this.elements.flatMap((element) => replaced.get(element.id) ?? [element]);
		this.elements.splice(0, this.elements.length, ...elements);
		for (const layer of Object.values(this.layers)) {
			const ids = layer.flatMap((id) => replaced.get(id)?.map((element) => element.id) ?? [id]);
			layer.splice(0, layer.length, ...ids);
		}
	}

	bounds(): Box {
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		const include = (x0: number, y0: number, x1: number, y1: number) => {
			left = Math.min(left, x0);
			top = Math.min(top, y0);
			right = Math.max(right, x1);
			bottom = Math.max(bottom, y1);
		};
		for (const element of this.elements) {
			if (element.type === "line" || element.type === "arrow") {
				for (const point of element.points) include(point.x, point.y, point.x, point.y);
			} else if (element.type === "text") {
				const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
				const height = element.text.split("\n").length * element.fontSize * LINE_HEIGHT;
				include(
					element.x - width / 2,
					element.y - height / 2,
					element.x + width / 2,
					element.y + height / 2,
				);
			} else {
				include(element.x, element.y, element.x + element.width, element.y + element.height);
			}
		}
		return { left, top, right, bottom };
	}
}

/** A phase's span: from its first task's start to its last task's end. */
interface PhaseSpan {
	readonly index: number;
	readonly name: string;
	readonly start: number;
	readonly end: number;
}

function phaseSpans(
	diagram: GanttDiagram,
	schedules: ReadonlyMap<string, GanttSchedule>,
): PhaseSpan[] {
	return ganttRows(diagram).flatMap((group, index) => {
		if (group.phase === undefined) return [];
		const spans = group.tasks.map((task) => schedules.get(task.id)!);
		return [
			{
				index,
				name: group.phase,
				start: Math.min(...spans.map((span) => span.start)),
				end: Math.max(...spans.map((span) => Math.max(span.end, span.start + 1))),
			},
		];
	});
}

/** The date text a Gantt chart draws: per task, per phase, and for Today. */
export interface GanttCaptions {
	readonly tasks: ReadonlyMap<string, string>;
	readonly phases: ReadonlyMap<string, string>;
	readonly today?: string;
}

/**
 * Date captions in the timeline's style (`Mar 2–6, 2026`, `Mar 30`), one per
 * task and phase, with the year where it first appears and where it changes.
 */
export function ganttCaptions(diagram: GanttDiagram): GanttCaptions {
	const schedules = new Map(diagram.tasks.map((task) => [task.id, ganttTaskSchedule(task)!]));
	const spans = phaseSpans(diagram, schedules);
	const phaseKey = (index: number) => `\u0000phase:${index}`;
	const event = (id: string, label: string, start: number, end: number) => ({
		id,
		label,
		date: formatGanttDay(start),
		...(end - start > 1 ? { end: formatGanttDay(end - 1) } : {}),
	});
	const timeline: TimelineDiagram = {
		id: diagram.id,
		title: diagram.title,
		type: "timeline",
		events: [
			...spans.map((phase) => event(phaseKey(phase.index), phase.name, phase.start, phase.end)),
			...diagram.tasks.map((task) => {
				const schedule = schedules.get(task.id)!;
				return event(task.id, task.label, schedule.start, schedule.end);
			}),
		],
		...(diagram.today ? { today: diagram.today } : {}),
		style: diagram.style,
	};
	const captions = timelineCaptions(timeline);
	// Rows are read one at a time, so a plan across years states the year in every caption.
	const years = new Set(
		timeline.events.flatMap((event) =>
			[event.date, event.end].flatMap((day) => (day === undefined ? [] : [day.slice(0, 4)])),
		),
	);
	const caption = (id: string) => {
		if (years.size < 2) return captions.events.get(id) ?? "";
		const event = timeline.events.find((entry) => entry.id === id)!;
		return timelineCaptions({ ...timeline, events: [event] }).events.get(id) ?? "";
	};
	return {
		tasks: new Map(
			diagram.tasks.map((task) => {
				const dates = caption(task.id);
				return [task.id, task.progress === undefined ? dates : `${dates} · ${task.progress}%`];
			}),
		),
		phases: new Map(spans.map((phase) => [phase.name, caption(phaseKey(phase.index))])),
		...(captions.today ? { today: captions.today } : {}),
	};
}

interface TaskLayout {
	readonly task: GanttTask;
	readonly schedule: GanttSchedule;
	readonly color: string;
	readonly label: Measured;
	readonly caption: Measured;
	readonly height: number;
}

interface Row {
	readonly kind: "phase" | "task";
	readonly top: number;
	readonly height: number;
	readonly task?: TaskLayout;
	readonly phase?: { readonly index: number; readonly name: Measured; readonly caption: Measured };
}

/** How far into a bar its top and bottom entries sit. */
const ENTRY_INSETS = [7, 19, 31];
/** How far back from a bar's end its bottom and top exits sit. */
const EXIT_INSETS = [6, 16, 26];
/** A route out of a bar's right end may turn this soon to drop straight into a successor just past it. */
const SHORT_LEAD = 3;
/** Bars narrower than this keep their right end closed: it sits beside their arrivals' arrowheads. */
const RIGHT_EXIT_WIDTH = 8;
/** Exits in line with a successor's entries sit this close to the bar's end, at this cost. */
const ELBOW_EXIT_REACH = 32;
const ELBOW_EXIT_COST = 3;
/**
 * A route that turns once into a side entry runs this far into it: past the arrowhead's kept
 * clearance, so routes out of the same predecessor may pass its turn on their shared trunk.
 */
const ELBOW_RUN = 19;
/** Ports cost more where they point away from the other end, so routes leave and enter facing it. */
const AWAY_COST = 40;
/** Entering a bar through its top or bottom rather than at its start from the left. */
const TOP_ENTRY_COST = 20;
/**
 * Entering a diamond on its upper or lower edge beside the vertex, in line with a bar it passed:
 * as dear as a bend, so a route takes a vertex wherever one is in reach.
 */
const EDGE_ENTRY_COST = 24;
/** Edge entries keep this far in from a diamond's side vertices, where dependencies leave and arrive. */
const EDGE_ENTRY_INSET = 4;
/** A route may jog this far behind its predecessor's start and still count as going forward. */
const FORWARD_SLACK = 16;
/** Other routes keep this far from an arrowhead, and a new arrowhead this far from other routes. */
const HEAD_CLEARANCE = 6;
/**
 * No other route crosses this much of an arrow's last run: a line across it, even behind the
 * arrowhead, reads as ending there.
 */
const HEAD_KEEP_OUT = 40;

/**
 * Where a dependency may leave its predecessor: the bottom or top near the
 * bar's end, its right end, or a milestone's vertices. `align` adds a port
 * straight above or below the successor's milestone, and `aside` ports near
 * the bar's end in line with the successor's entries, from which a route drops
 * straight into its top or bottom, or turns once into its side.
 */
function sourcePorts(
	box: Box,
	milestone: boolean,
	below: boolean,
	align?: number,
	aside: readonly number[] = [],
): RoutePort[] {
	const middle = (box.top + box.bottom) / 2;
	const away = (direction: 1 | 3) => ((direction === 1) === below ? 0 : AWAY_COST);
	if (milestone) {
		const center = (box.left + box.right) / 2;
		const quarter = (box.right - box.left) / 4;
		// Vertices first, then the middles of the edges beside them.
		return [
			{ x: box.right, y: middle, direction: 0, cost: 2 },
			{ x: center, y: box.bottom, direction: 1, cost: away(1) },
			{ x: center, y: box.top, direction: 3, cost: away(3) },
			// The right half first: the left half is where dependencies arrive.
			...[-1, 1].map((side): RoutePort => ({
				x: box.right - quarter,
				y: middle + side * quarter,
				direction: 0,
				cost: 8,
			})),
			{ x: center + quarter, y: box.bottom - quarter, direction: 1, cost: 6 + away(1) },
			{ x: center + quarter, y: box.top + quarter, direction: 3, cost: 6 + away(3) },
			// The left half, where dependencies arrive, only when the rest is taken.
			{ x: center - quarter, y: box.bottom - quarter, direction: 1, cost: 16 + away(1) },
			{ x: center - quarter, y: box.top + quarter, direction: 3, cost: 16 + away(3) },
			// Points on the lower and upper edges in line with the successor or a bar beside the way.
			...aside
				.filter((x) => x > box.left + 2 && x < box.right - 2)
				.flatMap((x): RoutePort[] => {
					const rise = quarter * 2 - Math.abs(x - center);
					const cost = (x < center ? 16 : 6) + ELBOW_EXIT_COST;
					return [
						{ x, y: middle + rise, direction: 1, cost: cost + away(1) },
						{ x, y: middle - rise, direction: 3, cost: cost + away(3) },
					];
				}),
		];
	}
	// Exits sit apart near the bar's end, so routes leaving one bar never share a run; a short bar
	// packs them closer.
	const insets = EXIT_INSETS.filter((inset) => box.right - inset >= box.left + 3);
	const packed = Array.from({ length: 6 }, (_, index) => box.right - 6 - 2.5 * index).filter(
		(x) => x >= box.left + 2,
	);
	const xs =
		insets.length >= 3
			? insets.map((inset) => box.right - inset)
			: packed.length
				? packed
				: [(box.left + box.right) / 2];
	const aligned =
		align !== undefined && align > box.left + 1 && align < box.right - 1 ? [align] : [];
	const elbows = aside.filter(
		(x) =>
			x >= Math.max(box.left + 2, box.right - ELBOW_EXIT_REACH) &&
			x <= box.right - 2 &&
			xs.every((other) => Math.abs(other - x) >= 1),
	);
	return [
		...aligned.flatMap((x): RoutePort[] => [
			{ x, y: box.bottom, direction: 1, cost: away(1) },
			{ x, y: box.top, direction: 3, cost: away(3) },
		]),
		...xs.map((x, index): RoutePort => ({
			x,
			y: box.bottom,
			direction: 1,
			cost: away(1) + index * 3,
		})),
		...elbows.flatMap((x): RoutePort[] => [
			{ x, y: box.bottom, direction: 1, cost: away(1) + ELBOW_EXIT_COST },
			{ x, y: box.top, direction: 3, cost: away(3) + ELBOW_EXIT_COST },
		]),
		// Out of its right end, unless the bar is a sliver whose arrivals land right beside it.
		...(box.right - box.left >= RIGHT_EXIT_WIDTH
			? [{ x: box.right, y: middle, direction: 0, cost: 2 } satisfies RoutePort]
			: []),
		...xs.map((x, index): RoutePort => ({
			x,
			y: box.top,
			direction: 3,
			cost: away(3) + index * 3,
		})),
	];
}

/**
 * Where a dependency may enter its successor: the left end, or the top or
 * bottom near the bar's start, or a milestone's vertices. `align` adds ports
 * straight below or above where the predecessor's route turns, and on a diamond's
 * upper and lower edges beside its vertices, where a route passing a bar drops
 * onto it. A successor that awaits more dependencies (`crowded`) is entered from
 * the left above and below its middle, so another arrival fits beside, the upper
 * one first from above.
 */
function targetPorts(
	box: Box,
	milestone: boolean,
	below: boolean,
	align: readonly number[] = [],
	crowded = false,
): RoutePort[] {
	const middle = (box.top + box.bottom) / 2;
	// Entering downward through the top suits a predecessor above.
	const away = (direction: 1 | 3) => ((direction === 1) === below ? 0 : AWAY_COST);
	/** Beside the middle: the side nearer the predecessor first. */
	const beside = (side: -1 | 1) => ((side === -1) === below ? 0 : 4);
	if (milestone) {
		const center = (box.left + box.right) / 2;
		const quarter = (box.right - box.left) / 4;
		// Along the upper and lower edges, clear of the side vertices; dearer past their middles.
		const rise = (x: number) =>
			((box.bottom - box.top) / 2) * (1 - Math.abs(x - center) / (2 * quarter));
		const edges = align.filter(
			(x) => Math.abs(x - center) >= 1 && Math.abs(x - center) <= 2 * quarter - EDGE_ENTRY_INSET,
		);
		const edgeCost = (x: number) => EDGE_ENTRY_COST + (Math.abs(x - center) > quarter ? 6 : 0);
		return [
			{ x: box.left, y: middle, direction: 0, cost: crowded ? 16 : 0 },
			{ x: center, y: box.top, direction: 1, cost: 2 + away(1) },
			{ x: center, y: box.bottom, direction: 3, cost: 2 + away(3) },
			// The left half only: the right half is where dependencies leave.
			...([-1, 1] as const).map((side): RoutePort => ({
				x: box.left + quarter,
				y: middle + side * quarter,
				direction: 0,
				cost: crowded ? beside(side) : 16,
			})),
			{ x: center - quarter, y: box.top + quarter, direction: 1, cost: 16 + away(1) },
			{ x: center - quarter, y: box.bottom - quarter, direction: 3, cost: 16 + away(3) },
			...edges.flatMap((x): RoutePort[] => [
				{ x, y: middle - rise(x), direction: 1, cost: edgeCost(x) + away(1) },
				{ x, y: middle + rise(x), direction: 3, cost: edgeCost(x) + away(3) },
			]),
		];
	}
	// Entries sit an arrowhead's width apart, so several can arrive at once.
	const insets = ENTRY_INSETS.filter((inset) => box.left + inset <= box.right - 3);
	const xs = insets.length ? insets.map((inset) => box.left + inset) : [(box.left + box.right) / 2];
	const aligned = align.filter((x) => x > box.left + 1 && x < box.right - 1);
	return [
		{ x: box.left, y: middle, direction: 0, cost: crowded ? SIDE_ENTRY_COST : 0 },
		// Further arrivals from the left land above and below the middle.
		...([-1, 1] as const).map((side): RoutePort => ({
			x: box.left,
			y: middle + side * SIDE_ENTRY_OFFSET,
			direction: 0,
			cost: crowded ? beside(side) : SIDE_ENTRY_COST,
		})),
		...aligned.flatMap((x): RoutePort[] => [
			{ x, y: box.top, direction: 1, cost: away(1) },
			{ x, y: box.bottom, direction: 3, cost: away(3) },
		]),
		// A successor is entered at its start from the left; the top and bottom near the start serve
		// further predecessors.
		...xs.map((x, index): RoutePort => ({
			x,
			y: box.top,
			direction: 1,
			cost: TOP_ENTRY_COST + away(1) + index * 3,
		})),
		...xs.map((x, index): RoutePort => ({
			x,
			y: box.bottom,
			direction: 3,
			cost: TOP_ENTRY_COST + away(3) + index * 3,
		})),
	];
}

/** Every few pixels along a successor's outline, for when its usual entries are all taken. */
function outlinePorts(box: Box, milestone: boolean, below: boolean): RoutePort[] {
	const middle = (box.top + box.bottom) / 2;
	const center = (box.left + box.right) / 2;
	const away = (direction: 1 | 3) => ((direction === 1) === below ? 0 : AWAY_COST);
	const along = (from: number, to: number) =>
		Array.from(
			{ length: Math.max(0, Math.floor((to - from) / OUTLINE_STEP)) + 1 },
			(_, index) => from + index * OUTLINE_STEP,
		);
	if (milestone) {
		// Points on the diamond's edges: the left ones entered from the left, the upper and lower
		// ones from above and below.
		const halfWidth = (box.right - box.left) / 2;
		const halfHeight = (box.bottom - box.top) / 2;
		const edgeX = (y: number) => center - halfWidth * (1 - Math.abs(y - middle) / halfHeight);
		const edgeY = (x: number, side: -1 | 1) =>
			middle + side * halfHeight * (1 - Math.abs(x - center) / halfWidth);
		return [
			...along(box.top + 3, box.bottom - 3).map((y): RoutePort => ({
				x: edgeX(y),
				y,
				direction: 0,
				cost: 30,
			})),
			...along(box.left + 3, center).flatMap((x): RoutePort[] => [
				{ x, y: edgeY(x, -1), direction: 1, cost: 40 + away(1) },
				{ x, y: edgeY(x, 1), direction: 3, cost: 40 + away(3) },
			]),
		];
	}
	return [
		...along(box.top + 3, box.bottom - 3).map((y): RoutePort => ({
			x: box.left,
			y,
			direction: 0,
			cost: 30 + Math.abs(y - middle),
		})),
		...along(box.left + 3, box.right - 3).flatMap((x): RoutePort[] => [
			{ x, y: box.top, direction: 1, cost: 40 + away(1) + (x - box.left) / 4 },
			{ x, y: box.bottom, direction: 3, cost: 40 + away(3) + (x - box.left) / 4 },
		]),
	];
}

/** Rerouting passes over routes that pass an arrowhead or lie along another route. */
const REPAIR_PASSES = 2;
/** Search steps the repair passes may spend, on top of the chart's budget. */
export const REPAIR_BUDGET = 48_000;
/** How arrival orders compare once their conflicts tie: length, plus this per bend and per crossing. */
const REORDER_BEND_COST = 24;
const REORDER_CROSSING_COST = 60;
/** Arrivals into one successor are tried in the other order once they detour this far in all. */
const REORDER_DETOUR = 60;
/**
 * What reads as an arrowhead: a side entry's last stretch as far as other routes keep out of
 * it, the final pixels of a top or bottom entry, and a margin around them.
 */
const CONFLICT_HEAD = 12;
const CONFLICT_MARGIN = 4.5;
/** Parallel runs of two routes closer than this read as one line. */
const CONFLICT_GAP = 2;

/**
 * Where another route would read as running through this route's arrowhead: across a side
 * entry's kept-out last stretch, or, `strictly`, through the arrowhead itself.
 */
function conflictHead(points: readonly RoutePoint[], strictly = false): Box {
	const side = !strictly && Math.abs(points.at(-1)!.y - points.at(-2)!.y) < 0.01;
	return routeHead(points, side ? HEAD_KEEP_OUT : CONFLICT_HEAD, CONFLICT_MARGIN);
}

/** A route sharing another's last run into their successor pays this on top of the run it shares. */
const JOIN_COST = 48;
/**
 * Search steps a chart may spend, per dependency and at most, apart from its routing budget, on
 * routes that join another's last run or hooks run on to their successor's start; one such search
 * may take JOIN_SEARCH.
 */
export const JOIN_BUDGET_PER_ROUTE = 1_000;
export const JOIN_BUDGET = 24_000;
const JOIN_SEARCH = 1_000;
/** A route joins another's last run from the side this far at least before its end, clear of its arrowhead. */
const JOIN_HEAD_GAP = ROUTE_VERTICAL_APPROACH + HEAD_CLEARANCE + ROUTE_SEPARATION;

/**
 * Where a route may join an earlier route's last run into the same successor and share its
 * entry: in line with that run at its start, or from either side where a vertical one crosses a
 * gutter, short of its arrowhead. Each costs JOIN_COST and the length left to share.
 */
function joinPorts(run: RouteSegment, gutters: readonly number[]): RoutePort[] {
	const direction = routeDirection(run);
	const shared = (point: RoutePoint) => Math.abs(run.to.x - point.x) + Math.abs(run.to.y - point.y);
	const ports: RoutePort[] = [{ ...run.from, direction, cost: JOIN_COST + shared(run.from) }];
	if (direction % 2 === 0) return ports;
	for (const y of gutters) {
		const point = { x: run.from.x, y };
		if (
			(y - run.from.y) * (run.to.y - y) <= 0 ||
			Math.abs(y - run.from.y) < ROUTE_SEPARATION ||
			shared(point) < JOIN_HEAD_GAP
		)
			continue;
		const cost = JOIN_COST + shared(point);
		ports.push({ ...point, direction: 0, cost }, { ...point, direction: 2, cost });
	}
	return ports;
}

/** A route ending where it joins another's last run, carried on along that run into its entry. */
function joined(points: RoutePoint[], joins: readonly RouteSegment[]): RoutePoint[] {
	const end = points.at(-1)!;
	const within = (value: number, from: number, to: number) =>
		value >= Math.min(from, to) - 0.01 && value <= Math.max(from, to) + 0.01;
	const run = joins.find(
		({ from, to }) =>
			Math.hypot(to.x - end.x, to.y - end.y) > 1 &&
			within(end.x, from.x, to.x) &&
			within(end.y, from.y, to.y),
	);
	if (!run) return points;
	// In line with the run, the route's last run carries on; from the side, it turns into it.
	return collinear(points.at(-2)!, end, run)
		? [...points.slice(0, -1), run.to]
		: [...points, run.to];
}

/** Whether a route doubles back: a run heading against an earlier run along the same axis. */
function doublesBack(points: readonly RoutePoint[]): boolean {
	const headings = new Set<RouteDirection>();
	for (const run of routeSegments(points)) {
		const direction = routeDirection(run);
		if (headings.has(((direction + 2) % 4) as RouteDirection)) return true;
		headings.add(direction);
	}
	return false;
}

/** Whether two routes end at one point, where one joined the other's last run. */
function sharedEnd(a: readonly RoutePoint[], b: readonly RoutePoint[]): boolean {
	const [end, other] = [a.at(-1)!, b.at(-1)!];
	return Math.hypot(end.x - other.x, end.y - other.y) < 0.01;
}

/**
 * How often route `a` passes route `b`'s arrowhead or lies along one of its runs. Routes out of
 * one predecessor may share their first runs, and routes into one successor their last, as far
 * as one arrowhead when one joined the other's.
 */
function routeConflicts(
	a: readonly RoutePoint[],
	b: readonly RoutePoint[],
	kin: { readonly leaving: boolean; readonly arriving: boolean },
	strictly = false,
): number {
	const head = conflictHead(b, strictly);
	const runs = routeSegments(a);
	const others = routeSegments(b);
	// Routes out of one predecessor may share a trunk: carrying on along it, a route passes behind
	// a sibling's arrowhead, not through it.
	const trunk = kin.leaving && collinear(runs[0]!.from, runs[0]!.to, others[0]);
	const arrowhead = trunk ? conflictHead(b, true) : head;
	const joint = kin.arriving && sharedEnd(a, b);
	let count = 0;
	runs.forEach((run, index) => {
		const last = index === runs.length - 1;
		if (!(joint && last) && segmentEnters(run, index === 0 ? arrowhead : head)) count += 1;
		others.forEach((other, at) => {
			const shared =
				(kin.leaving && index === 0 && at === 0) ||
				(kin.arriving && index === runs.length - 1 && at === others.length - 1);
			if (!shared && runsBeside(run.from, run.to, other, CONFLICT_GAP) && overlapOf(run, other) > 1)
				count += 1;
		});
	});
	return count;
}

/** How far two parallel runs overlap along their length. */
function overlapOf(a: RouteSegment, b: RouteSegment): number {
	const horizontal = Math.abs(a.from.y - a.to.y) < 0.01;
	const span = (run: RouteSegment) =>
		horizontal
			? [Math.min(run.from.x, run.to.x), Math.max(run.from.x, run.to.x)]
			: [Math.min(run.from.y, run.to.y), Math.max(run.from.y, run.to.y)];
	const [aLow, aHigh] = span(a);
	const [bLow, bHigh] = span(b);
	return Math.min(aHigh!, bHigh!) - Math.max(aLow!, bLow!);
}

/** Which way a run heads. */
function routeDirection({ from, to }: RouteSegment): RouteDirection {
	if (Math.abs(from.y - to.y) < 0.01) return to.x > from.x ? 0 : 2;
	return to.y > from.y ? 1 : 3;
}

/** Whether two runs cross: one passes through the other's interior, not at either's end. */
function runsCross(a: RouteSegment, b: RouteSegment): boolean {
	const horizontal = (run: RouteSegment) => Math.abs(run.from.y - run.to.y) < 0.01;
	if (horizontal(a) === horizontal(b)) return false;
	const [level, upright] = horizontal(a) ? [a, b] : [b, a];
	const x = upright.from.x;
	const y = level.from.y;
	return (
		x > Math.min(level.from.x, level.to.x) + 0.01 &&
		x < Math.max(level.from.x, level.to.x) - 0.01 &&
		y > Math.min(upright.from.y, upright.to.y) + 0.01 &&
		y < Math.max(upright.from.y, upright.to.y) - 0.01
	);
}

/** Whether a route's run enters a box's interior. */
function segmentEnters(segment: RouteSegment, box: Box): boolean {
	const { from, to } = segment;
	return (
		Math.max(from.x, to.x) > box.left &&
		Math.min(from.x, to.x) < box.right &&
		Math.max(from.y, to.y) > box.top &&
		Math.min(from.y, to.y) < box.bottom
	);
}

/** A color mixed toward ink, for the completed part of a bar. */
function shade(hex: string): string {
	const channel = (offset: number) => {
		const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
		const ink = Number.parseInt(INK.slice(offset, offset + 2), 16);
		return Math.round(value + (ink - value) * PROGRESS_SHADE)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * The square inside a milestone's diamond. Its corners are the middles of the
 * diamond's edges, so routes may run to those ports without entering the diamond.
 */
/** Two thin boxes through a diamond's middle, out to its vertices, so no run cuts a corner. */
function diamondCross(box: Box): Box[] {
	const middle = (box.top + box.bottom) / 2;
	const center = (box.left + box.right) / 2;
	const eighthWidth = (box.right - box.left) / 8;
	const eighthHeight = (box.bottom - box.top) / 8;
	return [
		{ left: box.left, right: box.right, top: middle - eighthHeight, bottom: middle + eighthHeight },
		{ left: center - eighthWidth, right: center + eighthWidth, top: box.top, bottom: box.bottom },
	];
}

/** The four sides of a mark's bounds, as lines: runs keep off them lengthwise. */
function boundsSides(box: Box): Box[] {
	return [
		{ ...box, bottom: box.top },
		{ ...box, top: box.bottom },
		{ ...box, right: box.left },
		{ ...box, left: box.right },
	];
}

function inscribed(box: Box): Box {
	const quarterWidth = (box.right - box.left) / 4;
	const quarterHeight = (box.bottom - box.top) / 4;
	return {
		left: box.left + quarterWidth,
		right: box.right - quarterWidth,
		top: box.top + quarterHeight,
		bottom: box.bottom - quarterHeight,
	};
}

/** A task id with `%` and `:` escaped, so a dependency's two ids never run together. */
function escapeId(id: string): string {
	return id.replaceAll("%", "%25").replaceAll(":", "%3A");
}

/** Corridor routes try offsets this far apart, nearest the preferred one first. */
const CORRIDOR_STEP = 1;
/** The corridor's first column, clear of the date column's edge. */
const CORRIDOR_LEFT = 1.5;
/** Gaps a corridor route keeps from earlier routes, widest first; it settles for the widest it can keep. */
const CORRIDOR_GAPS = [2.5, 2, 0.3, 0.05, 0];
/** Exits along a short predecessor are tried this close together. */
const CORRIDOR_FINE_STEP = 0.5;
/** Exits are tried this far either side of a bar's preferred exit. */
const CORRIDOR_EXIT_REACH = 12;

/** Offsets around `center` within `reach`, `step` apart, nearest first. */
function nearest(center: number, reach: number, step = CORRIDOR_STEP): number[] {
	const steps = Math.max(0, Math.floor(reach / step));
	return [
		center,
		...Array.from({ length: steps }, (_, index) => (index + 1) * step).flatMap((offset) => [
			center + offset,
			center - offset,
		]),
	];
}

/** Whether a run lies along an earlier one closer than `gap`. */
function runsBeside(from: RoutePoint, to: RoutePoint, segment: RouteSegment, gap: number): boolean {
	const horizontal = Math.abs(from.y - to.y) < 0.01;
	if (horizontal !== Math.abs(segment.from.y - segment.to.y) < 0.01) return false;
	const offset = horizontal ? Math.abs(from.y - segment.from.y) : Math.abs(from.x - segment.from.x);
	if (offset >= gap) return false;
	const [low, high] = horizontal
		? [Math.min(from.x, to.x), Math.max(from.x, to.x)]
		: [Math.min(from.y, to.y), Math.max(from.y, to.y)];
	const [otherLow, otherHigh] = horizontal
		? [Math.min(segment.from.x, segment.to.x), Math.max(segment.from.x, segment.to.x)]
		: [Math.min(segment.from.y, segment.to.y), Math.max(segment.from.y, segment.to.y)];
	return Math.min(high, otherHigh) - Math.max(low, otherLow) > 0;
}

/**
 * The last resort when the search finds no route within its budget: down from the
 * predecessor's end into the gutter below its row, left to the corridor before the
 * axis, along it to the successor's row, and right into the successor's start.
 * Gutters, the corridor and a row's stretch before its task hold no bars or text; the
 * route keeps as clear of the bars and diamonds beside them as a searched route does.
 * Each run takes the nearest offset that keeps clear of earlier routes and
 * arrowheads, or failing that the nearest that at least never lies on a route.
 */
function corridorRoute(ends: {
	/** Marks its gutter run keeps above or below: every mark but its own, laid out clear. */
	readonly marks: readonly Box[];
	readonly source: Box;
	readonly sourceMilestone: boolean;
	readonly sourceRow: Row;
	readonly target: Box;
	readonly targetMilestone: boolean;
	readonly rowsTop: number;
	readonly rowsBottom: number;
	readonly routed: readonly RouteSegment[];
	readonly heads: readonly RouteObstacle[];
	readonly taken: readonly RoutePoint[];
	/** First runs of the routes leaving this one's predecessor, which its own first run may lie beside. */
	readonly siblings: ReadonlySet<RouteSegment>;
}): RoutePoint[] {
	const { source, target, routed } = ends;
	const heads = ends.heads.map(({ box }) => box);
	/** A run, and whether it is the route's first, which may lie beside its siblings'. */
	type Run = readonly [RoutePoint, RoutePoint, boolean?];
	const level = routed.filter((segment) => Math.abs(segment.from.y - segment.to.y) < 0.01);
	const upright = routed.filter((segment) => Math.abs(segment.from.y - segment.to.y) >= 0.01);
	/**
	 * How closely a run comes to earlier routes: 0 keeps every gap and arrowhead clear; through an
	 * arrowhead is as bad as nearly touching a route; 4 lies on one.
	 */
	const tierOf = ([from, to, leaving]: Run) => {
		const horizontal = Math.abs(from.y - to.y) < 0.01;
		const at = horizontal ? from.y : from.x;
		const low = horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
		const high = horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
		let gap = Infinity;
		for (const segment of horizontal ? level : upright) {
			// A route may leave beside the others leaving its predecessor, on its first run only.
			if (leaving && ends.siblings.has(segment)) continue;
			const offset = Math.abs((horizontal ? segment.from.y : segment.from.x) - at);
			if (offset >= gap) continue;
			const otherLow = horizontal
				? Math.min(segment.from.x, segment.to.x)
				: Math.min(segment.from.y, segment.to.y);
			const otherHigh = horizontal
				? Math.max(segment.from.x, segment.to.x)
				: Math.max(segment.from.y, segment.to.y);
			if (Math.min(high, otherHigh) - Math.max(low, otherLow) > 0) gap = offset;
		}
		const tier = CORRIDOR_GAPS.findIndex((distance) => gap >= distance);
		return heads.some((box) => segmentEnters({ from, to }, box)) ? Math.max(tier, 3) : tier;
	};
	/** The candidate whose closest run keeps the widest gap, then whose runs keep wider gaps overall. */
	const choose = <T>(
		candidates: readonly T[],
		runs: (candidate: T) => Run[],
		extra: (candidate: T) => boolean = () => true,
	): T => {
		let best: { candidate: T; score: number } | undefined;
		for (const candidate of candidates) {
			const tiers = runs(candidate).map((run) => tierOf(run));
			const score =
				Math.max(...tiers, extra(candidate) ? 0 : 1) * 100 +
				tiers.reduce((sum, tier) => sum + tier, 0);
			if (!best || score < best.score) best = { candidate, score };
			if (score === 0) break;
		}
		return best!.candidate;
	};
	const sourceCenter = (source.left + source.right) / 2;
	const halfWidth = (source.right - source.left) / 2;
	// A bar is left near its end, through its bottom or else its top; a milestone through the
	// vertices there or the edges beside them.
	const along = (side: 1 | -1) =>
		ends.sourceMilestone
			? nearest(sourceCenter, halfWidth - 4, CORRIDOR_FINE_STEP).map((x) => ({
					x,
					y: (side === 1 ? source.bottom : source.top) - side * Math.abs(x - sourceCenter),
				}))
			: nearest(
					Math.max(sourceCenter, source.right - 6),
					Math.min(2 * halfWidth, CORRIDOR_EXIT_REACH),
					CORRIDOR_FINE_STEP,
				)
					.filter((x) => x >= source.left + 0.5 && x <= source.right - 0.5)
					.map((x) => ({ x, y: side === 1 ? source.bottom : source.top }));
	// Whole-pixel gutter heights first; half and tenth pixels only when a crowded gutter leaves
	// nothing else.
	const heights = (at: number) => [
		...nearest(at, 8),
		...nearest(at, 8, CORRIDOR_FINE_STEP),
		...nearest(at + 0.1, 8, 0.1),
	];
	const corridorMiddle = CORRIDOR_WIDTH / 2;
	// A gutter run from the exit to the corridor keeps above or below every mark it passes.
	const clearOfMarks = (y: number, exitX: number) =>
		ends.marks.every(
			(box) =>
				box.right <= CORRIDOR_LEFT ||
				box.left >= exitX ||
				y <= box.top - BAR_CLEARANCE ||
				y >= box.bottom + BAR_CLEARANCE,
		);
	const below = heights(ends.sourceRow.top + ends.sourceRow.height).filter(
		(y) => y >= source.bottom + 2 && y <= ends.rowsBottom - 1,
	);
	const above = heights(ends.sourceRow.top).filter(
		(y) => y <= source.top - 2 && y >= ends.rowsTop + 1,
	);
	// The exit first, judged along its gutter's middle to the corridor; then the gutter height
	// that suits it.
	const exitsBy = (clear: boolean) =>
		[
			...along(1).map(
				(point) => [point, below.filter((y) => !clear || clearOfMarks(y, point.x))] as const,
			),
			...along(-1).map(
				(point) => [point, above.filter((y) => !clear || clearOfMarks(y, point.x))] as const,
			),
		].filter(([, gutters]) => gutters.length > 0);
	// Gutter heights clear of the marks beside them where any exit has one; else any height.
	const clearExits = exitsBy(true);
	const exits = clearExits.length > 0 ? clearExits : exitsBy(false);
	const [exit, gutters] = choose(exits, ([point, gutters]) => [
		[point, { x: point.x, y: gutters[0]! }, true],
		[
			{ x: point.x, y: gutters[0]! },
			{ x: corridorMiddle, y: gutters[0]! },
		],
	]);
	const gutter = choose(gutters, (y) => [
		[exit, { x: exit.x, y }, true],
		[
			{ x: exit.x, y },
			{ x: corridorMiddle, y },
		],
	]);
	const middle = (target.top + target.bottom) / 2;
	const half = (target.bottom - target.top) / 2;
	const aspect = (target.right - target.left) / (target.bottom - target.top);
	// A bar is entered through its left side; a milestone through its left vertex or the edges beside it.
	const entries = nearest(middle, half - (ends.targetMilestone ? 4 : 3)).map((y) => ({
		x: ends.targetMilestone ? target.left + Math.abs(y - middle) * aspect : target.left,
		y,
	}));
	// The entry first, judged from the corridor's middle; then the column that suits both ends.
	const entry = choose(
		entries,
		(point) => [[{ x: corridorMiddle, y: point.y }, point]],
		(point) => {
			const head = routeHead(
				[{ x: point.x - ROUTE_APPROACH, y: point.y }, point],
				ROUTE_APPROACH,
				CONFLICT_MARGIN,
			);
			return (
				ends.taken.every((other) => Math.hypot(other.x - point.x, other.y - point.y) >= 3) &&
				!routed.some((segment) => segmentEnters(segment, head))
			);
		},
	);
	// Half-pixel columns first; tenths only when a crowded corridor leaves nothing else.
	const reach = corridorMiddle - CORRIDOR_LEFT;
	const corridor = choose(
		[
			...nearest(corridorMiddle, reach, CORRIDOR_FINE_STEP),
			...nearest(corridorMiddle + 0.1, reach - 0.1, 0.1),
		],
		(x) => [
			[
				{ x: exit.x, y: gutter },
				{ x, y: gutter },
			],
			[
				{ x, y: gutter },
				{ x, y: entry.y },
			],
			[{ x, y: entry.y }, entry],
		],
	);
	return [
		exit,
		{ x: exit.x, y: gutter },
		{ x: corridor, y: gutter },
		{ x: corridor, y: entry.y },
		entry,
	];
}

/** The routing work one Gantt layout spent: deterministic, so tests can bound it. */
export interface GanttRoutingWork {
	/** Layouts tried: a crowded chart whose routes still meet is laid out again with roomier rows. */
	readonly layouts: number;
	/** Dependencies routed, rerouted ones included. */
	readonly placements: number;
	/** Search steps spent across every route. */
	readonly expansions: number;
	/** Routes that took the corridor fallback. */
	readonly corridors: number;
	/** Runs left through another route's arrowhead or along another route, in the layout kept. */
	readonly conflicts: number;
}

/** Lay out a Gantt chart deterministically: date axis, rows, bars, labels and dependencies. */
export function renderGanttDiagram(input: GanttDiagram): RenderedDiagramScene {
	return layoutGanttDiagram(input).scene;
}

/** A layout tried, with how its routes read: how often they cross, and what else a reader would flag. */
interface LayoutTry {
	readonly scene: RenderedDiagramScene;
	readonly work: GanttRoutingWork;
	readonly crossings: number;
	readonly findings: Findings;
	/** Whether every run keeps a bar's clearance from the marks it passes but doesn't connect to. */
	readonly clear: boolean;
}

/** What a reader would flag in a layout's routes, by kind. */
interface Findings {
	/** Runs through another's arrowhead or along another route. */
	readonly conflicts: number;
	/** Routes the search found no way for, drawn down the corridor. */
	readonly fallbacks: number;
	/** Routes that double back. */
	readonly detours: number;
	/** Short runs between turns, away from a route's ends. */
	readonly kinks: number;
	/** Zig-zags beside a route's ends. */
	readonly jogs: number;
	/** Runs beside the end of a bar a route doesn't connect to, closer than SIDE_DISTANCE. */
	readonly traces: number;
}

/**
 * A zig-zag's middle run shorter than JOG_LENGTH reads as a port jog within JOG_REACH of a route's
 * end: about 90 px in the delivered PNG, which draws the scene about twice its size.
 */
const JOG_LENGTH = 40;
const JOG_REACH = 46;
/** A forward layout may draw this many more findings of one kind than the earlier way, no more in all. */
const FINDING_TOLERANCE = 1;

/** What a reader would flag in a layout's routes. */
function findingsOf(
	routes: readonly { readonly from: string; readonly to: string; readonly points: RoutePoint[] }[],
	bars: readonly (readonly [string, Box])[],
	conflicts: number,
	fallbacks: WeakSet<RoutePoint[]>,
): Findings {
	let [detours, kinks, jogs, traces, corridor] = [0, 0, 0, 0, 0];
	for (const { from, to, points } of routes) {
		if (fallbacks.has(points)) corridor += 1;
		if (doublesBack(points)) detours += 1;
		const runs = routeSegments(points);
		const lengths = runs.map(({ from: a, to: b }) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
		const total = lengths.reduce((sum, length) => sum + length, 0);
		let along = lengths[0] ?? 0;
		for (let index = 1; index < runs.length - 1; index += 1) {
			const length = lengths[index]!;
			const nearEnd = along <= JOG_REACH || total - along - length <= JOG_REACH;
			if (nearEnd && length < JOG_LENGTH) jogs += 1;
			else if (length < KINK_LENGTH) kinks += 1;
			along += length;
		}
		for (const { from: a, to: b } of runs) {
			if (Math.abs(a.x - b.x) >= 0.01) continue;
			for (const [id, box] of bars)
				if (
					id !== from &&
					id !== to &&
					Math.min(Math.abs(a.x - box.left), Math.abs(a.x - box.right)) < SIDE_DISTANCE - 0.01 &&
					Math.min(Math.max(a.y, b.y), box.bottom) - Math.max(Math.min(a.y, b.y), box.top) > 1
				)
					traces += 1;
		}
	}
	return { conflicts, fallbacks: corridor, detours, kinks, jogs, traces };
}

/**
 * Whether a forward layout reads no worse than the earlier one: its routes cross no more often,
 * and draw no more findings in all, and at most FINDING_TOLERANCE more of any one kind.
 */
function noWorse(forward: LayoutTry, earlier: LayoutTry): boolean {
	const kinds = Object.keys(forward.findings) as (keyof Findings)[];
	const total = (findings: Findings) => kinds.reduce((sum, kind) => sum + findings[kind], 0);
	return (
		forward.crossings <= earlier.crossings &&
		total(forward.findings) <= total(earlier.findings) &&
		kinds.every((kind) => forward.findings[kind] <= earlier.findings[kind] + FINDING_TOLERANCE)
	);
}

/**
 * Whether every run keeps BAR_SIDE_CLEARANCE beside, and BAR_CLEARANCE above and below, each bar
 * and diamond it passes but doesn't connect to.
 */
function keepsClear(
	routes: readonly { readonly from: string; readonly to: string; readonly points: RoutePoint[] }[],
	marks: ReadonlyMap<string, Box>,
): boolean {
	return routes.every(({ from, to, points }) =>
		routeSegments(points).every(({ from: a, to: b }) => {
			const vertical = Math.abs(a.x - b.x) < 0.01;
			return [...marks].every(([id, box]) => {
				if (id === from || id === to) return true;
				const shared = vertical
					? Math.min(Math.max(a.y, b.y), box.bottom) - Math.max(Math.min(a.y, b.y), box.top)
					: Math.min(Math.max(a.x, b.x), box.right) - Math.max(Math.min(a.x, b.x), box.left);
				if (shared <= 1) return true;
				const gap = vertical
					? Math.max(box.left - a.x, a.x - box.right)
					: Math.max(box.top - a.y, a.y - box.bottom);
				return gap >= (vertical ? BAR_SIDE_CLEARANCE : BAR_CLEARANCE) - 0.02;
			});
		}),
	);
}

/** Whether a layout's routes neither cross nor draw any finding. */
function clean(layout: LayoutTry): boolean {
	return layout.crossings === 0 && Object.values(layout.findings).every((count) => count === 0);
}

/** How a layout routes: with the forward choices or as before them, and clear of every mark or as before. */
interface Choices {
	readonly forward: boolean;
	readonly clear: boolean;
}
const FORWARD: Choices = { forward: true, clear: true };
const EARLIER: Choices = { forward: false, clear: false };
const EARLIER_CLEAR: Choices = { forward: false, clear: true };

/**
 * A Gantt chart's scene and the routing work its layout took. The chart is laid out forward first;
 * unless that layout reads clean, it is laid out the earlier way too, and again keeping clear of
 * every mark where that way runs too close to one. The forward layout is kept unless that earlier
 * one crosses less often or draws fewer findings. When the kept layout's routes still pass
 * another's arrowhead or lie along it, the chart is laid out again that way with roomier rows,
 * whose wider gutters hold more lanes, and the layout with the fewest such conflicts is kept.
 */
export function layoutGanttDiagram(input: GanttDiagram): {
	readonly scene: RenderedDiagramScene;
	readonly work: GanttRoutingWork;
} {
	const diagram = validateGanttDiagram(input);
	const tried: LayoutTry[] = [layoutAt(diagram, ROW_HEIGHT, FORWARD)];
	let best = tried[0]!;
	let choices = FORWARD;
	if (!clean(best)) {
		let earlier = layoutAt(diagram, ROW_HEIGHT, EARLIER);
		let earlierChoices = EARLIER;
		tried.push(earlier);
		if (!earlier.clear) {
			earlier = layoutAt(diagram, ROW_HEIGHT, EARLIER_CLEAR);
			earlierChoices = EARLIER_CLEAR;
			tried.push(earlier);
		}
		if (earlier.clear && !noWorse(best, earlier)) {
			best = earlier;
			choices = earlierChoices;
		}
	}
	for (const extra of ROOMY_ROWS) {
		// A few conflicts may clear with more room; a tangle of them would not, and costs a layout each.
		if (best.work.conflicts === 0 || best.work.conflicts > ROOMY_CONFLICTS) break;
		const roomier = layoutAt(diagram, ROW_HEIGHT + extra, choices);
		tried.push(roomier);
		if (roomier.work.conflicts < best.work.conflicts) best = roomier;
	}
	return {
		scene: best.scene,
		work: {
			layouts: tried.length,
			placements: tried.reduce((sum, { work }) => sum + work.placements, 0),
			expansions: tried.reduce((sum, { work }) => sum + work.expansions, 0),
			corridors: best.work.corridors,
			conflicts: best.work.conflicts,
		},
	};
}

/**
 * One layout of a chart at a row height. Laid out `forward`, routes keep SIDE_DISTANCE clear of
 * the bars they pass, drop onto a diamond's edge past a bar near its vertex, join an earlier
 * arrival's last run rather than double back, and hook back to their successor's start; else they
 * route as before those choices, which the forward layout must not do worse than. Laid out
 * `clear`, fallback routes down the corridor keep a bar's clearance from every mark too.
 */
function layoutAt(
	diagram: GanttDiagram,
	rowHeight: number,
	{ forward, clear }: Choices,
): LayoutTry {
	const inset = clear ? PLOT_INSET : CORRIDOR_WIDTH;
	const schedules = new Map(diagram.tasks.map((task) => [task.id, ganttTaskSchedule(task)!]));
	const groups = ganttRows(diagram);
	const today = diagram.today === undefined ? undefined : parseGanttDay(diagram.today);
	const all = [...schedules.values()];
	const first = Math.min(...all.map((schedule) => schedule.start), today ?? Infinity);
	const last = Math.max(
		...all.map((schedule) => (schedule.milestone ? schedule.start + 1 : schedule.end)),
		today === undefined ? -Infinity : today + 1,
	);
	const captions = ganttCaptions(diagram);
	const taskLayout = (task: GanttTask, color: string): TaskLayout => {
		const label = wrapped(task.label, NAME_MAX_WIDTH, LABEL_FONT);
		return {
			task,
			schedule: schedules.get(task.id)!,
			color,
			label,
			caption: measure(captions.tasks.get(task.id)!, CAPTION_FONT),
			height: Math.max(rowHeight, label.height + 2 * ROW_PAD),
		};
	};

	// Rows top to bottom, under their phase headers.
	const rows: Row[] = [];
	let y = 0;
	groups.forEach((group, groupIndex) => {
		const color = CHART_SERIES_COLORS[groupIndex % CHART_SERIES_COLORS.length]!;
		if (group.phase !== undefined) {
			const name = wrapped(group.phase, PHASE_MAX_WIDTH, PHASE_FONT);
			const caption = measure(captions.phases.get(group.phase)!, CAPTION_FONT);
			const height = Math.max(PHASE_ROW_HEIGHT, name.height + 2 * ROW_PAD);
			rows.push({ kind: "phase", top: y, height, phase: { index: groupIndex, name, caption } });
			y += height;
		}
		for (const task of group.tasks) {
			const layout = taskLayout(task, color);
			rows.push({ kind: "task", top: y, height: layout.height, task: layout });
			y += layout.height;
		}
	});
	const rowsTop = 0;
	const rowsBottom = y;
	const taskRows = rows.filter((row) => row.kind === "task").length;
	/*
	 * A table left of the plot names every row, so the plot holds only bars, diamonds and the
	 * dependencies between them: a name column, indented under phase headers, and a date column
	 * ending just before the plot. A phase's header row names it and states its span.
	 */
	const indent = rows.some((row) => row.kind === "phase") ? NAME_INDENT : 0;
	const namesWidth = Math.max(...rows.map((row) => (row.task ? indent + row.task.label.width : 0)));
	const datesWidth = Math.max(
		...rows.map((row) => (row.task ? row.task.caption : row.phase!.caption).width),
	);
	const columnWidth = Math.max(
		namesWidth + NAME_GAP + datesWidth,
		...rows.map((row) =>
			row.phase ? row.phase.name.width + CAPTION_GAP + row.phase.caption.width : 0,
		),
	);
	const columnLeft = -COLUMN_GAP - columnWidth;
	// A short chart narrows its plot, so the chart stays no wider than MAX_ASPECT times its height.
	const height =
		Math.ceil(diagram.title.length ? TITLE_FONT * LINE_HEIGHT : 0) +
		TITLE_GAP +
		(today === undefined ? 0 : TODAY_ROW_HEIGHT) +
		2 * HEADER_ROW_HEIGHT +
		rowsBottom +
		(taskRows >= BOTTOM_AXIS_ROWS ? 2 * HEADER_ROW_HEIGHT : 0) +
		2 * PADDING;
	const axis = ganttAxis(
		first,
		last,
		Math.max(
			MIN_PLOT_WIDTH,
			Math.min(
				GANTT_PLOT_WIDTH,
				MAX_ASPECT * height - 2 * PADDING - columnWidth - COLUMN_GAP - inset,
			),
		),
	);
	// The axis starts a corridor's width into the plot, so dependencies can always pass left of every
	// mark: further still when a milestone in the axis's first days would reach into it.
	const overhang = Math.max(
		0,
		...all.map((schedule) =>
			schedule.milestone
				? MILESTONE_SIZE / 2 +
					CORRIDOR_MARK_GAP -
					(schedule.start + 0.5 - axis.start) * axis.pxPerDay
				: 0,
		),
	);
	const xOf = (day: number) => inset + overhang + (day - axis.start) * axis.pxPerDay;
	const plotWidth = xOf(axis.end);

	const builder = new SceneBuilder();
	const obstacles: RouteObstacle[] = [
		// Dependencies stay in the plot.
		{
			box: { left: columnLeft - 2 * COLUMN_GAP, right: -2, top: rowsTop, bottom: rowsBottom },
			clearance: 0,
		},
	];
	const markBoxes = new Map<string, Box>();

	for (const row of rows) {
		if (row.kind !== "phase") continue;
		const { index, name, caption } = row.phase!;
		const middle = row.top + row.height / 2;
		const group = { groupIds: [`gantt:phase:${index}`] };
		builder.text(
			`gantt:phase:${index}`,
			name,
			columnLeft,
			middle - name.height / 2,
			PHASE_FONT,
			INK,
			"left",
			group,
		);
		builder.text(
			`gantt:phase-caption:${index}`,
			caption,
			-COLUMN_GAP - caption.width,
			middle - caption.height / 2,
			CAPTION_FONT,
			MUTED_INK,
			"right",
			group,
		);
	}

	// Bars and milestones in the plot; names and dates in the table.
	for (const row of rows) {
		if (row.kind !== "task") continue;
		const layout = row.task!;
		const { task, schedule, color, label, caption } = layout;
		const middle = row.top + row.height / 2;
		// A milestone marks the middle of its day, like Today. A bar draws at least MIN_BAR_WIDTH
		// wide, so a one-day task on a multi-year axis stays visible.
		const left = schedule.milestone
			? xOf(schedule.start + 0.5) - MILESTONE_SIZE / 2
			: xOf(schedule.start);
		const right = schedule.milestone
			? xOf(schedule.start + 0.5) + MILESTONE_SIZE / 2
			: Math.max(xOf(schedule.end), xOf(schedule.start) + MIN_BAR_WIDTH);
		const nodeId = `gantt:task:${task.id}`;
		// A bar and its completed part move together, and a row's name and dates together, so a bar
		// dragged to new dates in Excalidraw leaves the table as it is.
		const group = { groupIds: [nodeId] };
		const cells = { groupIds: [`gantt:row:${task.id}`] };
		const markBox: Box = schedule.milestone
			? {
					left,
					right,
					top: middle - MILESTONE_SIZE / 2,
					bottom: middle + MILESTONE_SIZE / 2,
				}
			: { left, right, top: middle - BAR_HEIGHT / 2, bottom: middle + BAR_HEIGHT / 2 };
		markBoxes.set(task.id, markBox);
		builder.mark(
			nodeId,
			schedule.milestone ? "diamond" : "rectangle",
			{
				x: markBox.left,
				y: markBox.top,
				width: markBox.right - markBox.left,
				height: markBox.bottom - markBox.top,
			},
			task.label,
			schedule.milestone
				? { fillColor: INK, strokeColor: INK, ...group }
				: { fillColor: color, strokeColor: color, ...group },
		);
		// The completed part of a bar fills a darker shade of its color.
		const progress = task.progress ?? 0;
		const done = shade(color);
		const doneRight = markBox.left + ((markBox.right - markBox.left) * progress) / 100;
		if (!schedule.milestone && doneRight - markBox.left >= 1)
			builder.mark(
				`gantt:progress:${task.id}`,
				"rectangle",
				{
					x: markBox.left,
					y: markBox.top,
					width: doneRight - markBox.left,
					height: markBox.bottom - markBox.top,
				},
				`${task.label} · ${progress}%`,
				{ fillColor: done, strokeColor: done, ...group },
			);
		builder.text(
			`gantt:label:${task.id}`,
			label,
			columnLeft + indent,
			middle - label.height / 2,
			LABEL_FONT,
			INK,
			"left",
			cells,
		);
		builder.text(
			`gantt:caption:${task.id}`,
			caption,
			-COLUMN_GAP - caption.width,
			middle - caption.height / 2,
			CAPTION_FONT,
			MUTED_INK,
			"right",
			cells,
		);
	}

	// Dependencies: elbow arrows from each predecessor's end into its successor's start.
	const bars = [...markBoxes].filter(([id]) => !schedules.get(id)!.milestone);
	const rowOf = new Map(
		rows.flatMap((row, index) => (row.task ? [[row.task.task.id, index] as const] : [])),
	);
	const gutters = rows.slice(1).map((row) => row.top);
	const lanes = gutters.flatMap((gutter) => LANE_OFFSETS.map((offset) => gutter + offset));
	const denseLanes = rows
		.slice(1)
		.flatMap((row) => [...LANE_OFFSETS, ...DENSE_LANE_OFFSETS].map((offset) => row.top + offset));
	const dependencies = diagram.tasks
		.flatMap((task, taskIndex) =>
			(task.dependsOn ?? []).map((from, order) => ({ from, to: task.id, taskIndex, order })),
		)
		.toSorted(
			(a, b) =>
				Math.abs(rowOf.get(a.to)! - rowOf.get(a.from)!) -
					Math.abs(rowOf.get(b.to)! - rowOf.get(b.from)!) ||
				rowOf.get(a.to)! - rowOf.get(b.to)! ||
				rowOf.get(a.from)! - rowOf.get(b.from)! ||
				a.taskIndex - b.taskIndex ||
				a.order - b.order,
		);
	// Today's line counts as a route, so no dependency runs along it; crossing it is fine.
	const todayX = today === undefined ? undefined : xOf(today + 0.5);
	const todayRoute: RouteSegment[] =
		todayX === undefined
			? []
			: [{ from: { x: todayX, y: rowsTop }, to: { x: todayX, y: rowsBottom } }];
	// Every placed route, by its index in `dependencies`; what later routes avoid derives from them.
	const placed: (RoutePoint[] | undefined)[] = dependencies.map(() => undefined);
	const routed: RouteSegment[] = [...todayRoute];
	const entries = new Map<string, RoutePoint[]>();
	// Routes out of one predecessor, or into one successor, may run beside each other.
	const leaving = new Map<string, RouteSegment[]>();
	const arriving = new Map<string, RouteSegment[]>();
	/**
	 * Each arrowhead, and a longer stretch behind a side entry's, that other routes keep out of, by
	 * the predecessor whose route it ends: that predecessor's other routes keep out of the
	 * arrowhead alone while they share its trunk.
	 */
	interface HeadKeepOut {
		readonly from: string;
		readonly trunk: RouteSegment;
		readonly keepOut: RouteObstacle;
		readonly arrowhead: RouteObstacle;
	}
	const heads: HeadKeepOut[] = [];
	const keepOuts: HeadKeepOut[] = [];
	const lastRuns = new Set<RouteSegment>();
	const firstRuns = new Set<RouteSegment>();
	// Each task's left entry stays free for its own dependencies until they are all routed.
	const pending = new Map<string, number>();
	// Milestones whose arrivals take the entries above and below their left vertex first.
	const split = new Set<string>();
	// Routing work is bounded per route and per chart; past either, routes take the corridor.
	const chartBudget = Math.min(
		ROUTE_CHART_BUDGET,
		Math.max(ROUTE_BUDGET, dependencies.length * ROUTE_CHART_BUDGET_PER_ROUTE),
	);
	const budget = { remaining: chartBudget };
	const kinkChartBudget = Math.min(
		ROUTE_KINK_BUDGET,
		dependencies.length * ROUTE_KINK_BUDGET_PER_ROUTE,
	);
	const kinkBudget = { remaining: kinkChartBudget };
	const joinChartBudget = Math.min(JOIN_BUDGET, dependencies.length * JOIN_BUDGET_PER_ROUTE);
	const joinBudget = { remaining: joinChartBudget };
	let placements = 0;
	let corridors = 0;
	// Routes the search found no way for, drawn down the corridor instead.
	const fallbacks = new WeakSet<RoutePoint[]>();
	// Which way each task's own dependencies leave it: down to successors below, up to those above.
	const exitSides = new Map<string, Set<RouteDirection>>();
	for (const { from, to } of dependencies)
		exitSides.set(
			from,
			(exitSides.get(from) ?? new Set()).add(rowOf.get(to)! > rowOf.get(from)! ? 1 : 3),
		);
	const add = (dependency: (typeof dependencies)[number], points: RoutePoint[]) => {
		const segments = routeSegments(points);
		routed.push(...segments);
		lastRuns.add(segments.at(-1)!);
		firstRuns.add(segments[0]!);
		leaving.set(dependency.from, [...(leaving.get(dependency.from) ?? []), ...segments]);
		arriving.set(dependency.to, [...(arriving.get(dependency.to) ?? []), ...segments]);
		const arrowhead = { box: conflictHead(points, true), clearance: 0 };
		heads.push({
			from: dependency.from,
			trunk: segments[0]!,
			keepOut: { box: conflictHead(points), clearance: 0 },
			arrowhead,
		});
		keepOuts.push({
			from: dependency.from,
			trunk: segments[0]!,
			keepOut: {
				box: routeHead(
					points,
					Math.abs(points.at(-1)!.y - points.at(-2)!.y) < 0.01
						? HEAD_KEEP_OUT
						: ROUTE_VERTICAL_APPROACH,
					HEAD_CLEARANCE,
				),
				clearance: 0,
			},
			arrowhead,
		});
		pending.set(dependency.to, pending.get(dependency.to)! - 1);
		entries.set(dependency.to, [...(entries.get(dependency.to) ?? []), points.at(-1)!]);
	};
	/** Derive what routes avoid from the placed routes alone. */
	const rebuild = () => {
		routed.splice(0, routed.length, ...todayRoute);
		for (const store of [entries, leaving, arriving, pending]) store.clear();
		heads.length = 0;
		keepOuts.length = 0;
		lastRuns.clear();
		firstRuns.clear();
		for (const dependency of dependencies)
			pending.set(dependency.to, (pending.get(dependency.to) ?? 0) + 1);
		dependencies.forEach((dependency, index) => {
			const points = placed[index];
			if (points) add(dependency, points);
		});
	};
	rebuild();
	// A task keeps as many of its side entries free as it still awaits dependencies: no other
	// route, its own departing ones included, runs through where those arrowheads will land.
	const reservedEntries = (id: string): Box[] => {
		const count = pending.get(id) ?? 0;
		if (count <= 0) return [];
		const box = markBoxes.get(id)!;
		const middle = (box.top + box.bottom) / 2;
		const quarter = (box.right - box.left) / 4;
		const milestone = schedules.get(id)!.milestone;
		const sides = milestone
			? [
					{ x: box.left, y: middle },
					{ x: box.left + quarter, y: middle - quarter },
					{ x: box.left + quarter, y: middle + quarter },
				]
			: [0, -SIDE_ENTRY_OFFSET, SIDE_ENTRY_OFFSET].map((offset) => ({
					x: box.left,
					y: middle + offset,
				}));
		const taken = entries.get(id) ?? [];
		// With more than one arrival, the entries above and below the middle come first.
		const [middleSide, ...besides] = sides;
		return (count + taken.length > 1 ? [...besides, middleSide!] : sides)
			.filter((side) => taken.every((point) => Math.hypot(point.x - side.x, point.y - side.y) >= 3))
			.slice(0, count)
			.map((side) => ({
				left: side.x - ROUTE_APPROACH - HEAD_CLEARANCE,
				// Into a diamond too, so its own departures cannot leave through an awaited entry.
				right: side.x + (milestone ? HEAD_CLEARANCE : 0),
				top: side.y - HEAD_CLEARANCE,
				bottom: side.y + HEAD_CLEARANCE,
			}));
	};
	/** The best route for one dependency around everything placed so far. */
	const place = (dependency: (typeof dependencies)[number], pool = budget): RoutePoint[] => {
		placements += 1;
		const granted = Math.min(ROUTE_BUDGET, pool.remaining);
		const own = { remaining: granted };
		const source = markBoxes.get(dependency.from)!;
		const target = markBoxes.get(dependency.to)!;
		const sourceMilestone = schedules.get(dependency.from)!.milestone;
		const targetMilestone = schedules.get(dependency.to)!.milestone;
		const below = rowOf.get(dependency.to)! > rowOf.get(dependency.from)!;
		const center = (box: Box) => (box.left + box.right) / 2;
		/** Whether a task's row lies strictly between the predecessor's and the successor's. */
		const between = (id: string) =>
			(rowOf.get(id)! - rowOf.get(dependency.from)!) *
				(rowOf.get(dependency.to)! - rowOf.get(id)!) >
			0;
		// Each dependency enters its successor at its own point, clear of the others and of Today.
		const taken = entries.get(dependency.to) ?? [];
		const ports = targetPorts(
			target,
			targetMilestone,
			below,
			// Straight below or above the predecessor's diamond, or, near the successor's start, below
			// or above where a route out of its bar's right end turns, so a successor starting at the
			// bar's end takes one elbow. A diamond is also entered on its edge beside a bar in the rows
			// between that a route drops past, however near that bar ends to its vertex.
			targetMilestone
				? [
						...(sourceMilestone ? [center(source)] : []),
						...[...markBoxes].flatMap(([id, box]) =>
							forward && between(id) ? besideBar(box, forward) : [],
						),
					]
				: sourceMilestone
					? [center(source)]
					: source.right - source.left >= RIGHT_EXIT_WIDTH &&
						  source.right + ROUTE_LEAD <= target.left + ENTRY_INSETS.at(-1)!
						? [source.right + ROUTE_LEAD]
						: [],
			(pending.get(dependency.to)! > 1 || taken.length > 0) &&
				(!targetMilestone || split.has(dependency.to)),
		);
		const clearOfToday = (port: RoutePort) =>
			todayX === undefined ||
			(port.direction % 2 === 0
				? todayX < port.x - ROUTE_APPROACH - TODAY_CLEARANCE || todayX > port.x + TODAY_CLEARANCE
				: Math.abs(port.x - todayX) >= TODAY_CLEARANCE);
		const apart = (port: RoutePort, distance: number) =>
			taken.every((point) => Math.hypot(point.x - port.x, point.y - port.y) >= distance);
		// A new arrowhead keeps clear of every earlier route.
		const headClear = (port: RoutePort) => {
			const approach = routeApproach(port.direction);
			const head = routeHead(
				[
					{
						x: port.x - (port.direction === 0 ? approach : 0),
						y: port.y - (port.direction === 1 ? approach : port.direction === 3 ? -approach : 0),
					},
					port,
				],
				approach,
				HEAD_CLEARANCE,
			);
			return !routed.some((segment) => segmentEnters(segment, head));
		};
		// Arrivals through the top or bottom leave room for the successor's first exit there.
		const exits = [...(exitSides.get(dependency.to) ?? [])].flatMap(
			(direction) =>
				sourcePorts(target, targetMilestone, direction === 1).find(
					(port) => port.direction === direction,
				) ?? [],
		);
		const clearOfExits = (port: RoutePort) => {
			// A side entry's arrowhead keeps clear of where the successor's exits leave it, which on a
			// short bar sit close to its start.
			if (port.direction % 2 === 0) {
				const head = conflictHead([{ x: port.x - ROUTE_APPROACH, y: port.y }, port]);
				return exits.every(
					(exit) =>
						!segmentEnters(
							{
								from: exit,
								to: { x: exit.x, y: exit.y + (exit.direction === 1 ? 1 : -1) * ROUTE_LEAD },
							},
							head,
						),
				);
			}
			// An exit down through the bottom meets an arrival up into it, and likewise at the top.
			return exits.every(
				(exit) =>
					exit.direction !== (port.direction + 2) % 4 || Math.abs(exit.x - port.x) >= EXIT_SPACING,
			);
		};
		// When every usual entry is taken, a successor is entered anywhere along its outline that
		// keeps clear; then arrowheads may crowd one another, before any lands on a route.
		const outline = outlinePorts(target, targetMilestone, below);
		const tiers: [readonly RoutePort[], (port: RoutePort) => boolean][] = [
			[
				ports,
				(port) =>
					clearOfToday(port) && apart(port, ENTRY_SPACING) && headClear(port) && clearOfExits(port),
			],
			[
				ports,
				(port) =>
					clearOfToday(port) &&
					apart(port, SIDE_ENTRY_OFFSET - 1) &&
					headClear(port) &&
					clearOfExits(port),
			],
			[
				outline,
				(port) => clearOfToday(port) && apart(port, 3) && headClear(port) && clearOfExits(port),
			],
			[ports, (port) => clearOfToday(port) && apart(port, 1) && headClear(port)],
			[ports, (port) => apart(port, 1) && headClear(port)],
			[outline, (port) => apart(port, 1) && headClear(port)],
		];
		const open =
			tiers
				.map(([candidates, usable]) => candidates.filter(usable))
				.find((usable) => usable.length > 0) ?? ports;
		// The last runs of earlier routes into the same successor, which this one may join to share
		// their entry where its own would cost a detour: those heading its way, at or past where it
		// can leave its predecessor.
		const leaves = sourceMilestone
			? center(source) - (source.right - source.left) / 4
			: Math.max(source.left + 2, source.right - EXIT_INSETS.at(-1)!);
		const joins = (arriving.get(dependency.to) ?? []).filter((segment) => {
			const direction = routeDirection(segment);
			return (
				lastRuns.has(segment) &&
				segment.from.x >= leaves - 0.5 &&
				(direction % 2 === 0 || (direction === 1) === below)
			);
		});
		// The first runs of earlier routes out of the same predecessor, and where they leave it.
		const trunks = (leaving.get(dependency.from) ?? []).filter((segment) => firstRuns.has(segment));
		const trunkPorts = new Map(
			trunks.map((segment): [string, RoutePort] => {
				const direction = routeDirection(segment);
				const away = direction % 2 === 1 && (direction === 1) !== below;
				return [
					`${segment.from.x},${segment.from.y},${direction}`,
					{ ...segment.from, direction, cost: away ? AWAY_COST : 0 },
				];
			}),
		);
		// Bars, labels and the plot's edge never move; arrowheads and reserved entries grow as routes land.
		const fixed: RouteObstacle[] = [
			...[...markBoxes].flatMap(([id, box]): RouteObstacle[] =>
				id !== dependency.from && id !== dependency.to
					? [{ box, clearance: BAR_CLEARANCE, sideClearance: BAR_SIDE_CLEARANCE }]
					: schedules.get(id)!.milestone
						? // A diamond: its inner square, a thin cross out to its vertices, and its bounds'
							// sides, which runs may cross but not follow.
							[
								{ box: inscribed(box), clearance: OWN_CLEARANCE, own: true },
								...diamondCross(box).map((arm) => ({ box: arm, clearance: 0.5, own: true })),
								...boundsSides(box).map((side) => ({
									box: side,
									clearance: OWN_CLEARANCE,
									own: true,
									parallel: true,
								})),
							]
						: [{ box, clearance: OWN_CLEARANCE, own: true }],
			),
			...obstacles,
		];
		const routeRequest = {
			sources: [
				// Where earlier routes leave the predecessor, so this one may share their trunk.
				...trunkPorts.values(),
				// Out of a bar's right end with a shorter lead, to turn straight into a successor's top or
				// bottom entry just past it: a tiny successor starting at the bar's end takes one elbow.
				...(sourceMilestone || source.right - source.left < RIGHT_EXIT_WIDTH
					? []
					: (targetMilestone
							? [center(target)]
							: ENTRY_INSETS.some((inset) => target.left + inset <= target.right - 3)
								? ENTRY_INSETS.filter((inset) => target.left + inset <= target.right - 3).map(
										(inset) => target.left + inset,
									)
								: [center(target)]
						)
							.filter((x) => x - source.right >= SHORT_LEAD && x - source.right < ROUTE_LEAD)
							.map((x): RoutePort => ({
								x: source.right,
								y: (source.top + source.bottom) / 2,
								direction: 0,
								cost: 2,
								lead: x - source.right,
							}))),
				...sourcePorts(
					source,
					sourceMilestone,
					below,
					targetMilestone ? center(target) : undefined,
					// Exits from which a route drops straight into the successor's top or bottom entries,
					// turns once into its side entries, or passes straight down beside another bar.
					[
						...(targetMilestone
							? [
									target.left - ELBOW_RUN,
									target.left + (target.right - target.left) / 4 - ELBOW_RUN,
								]
							: [
									target.left - ELBOW_RUN,
									...ENTRY_INSETS.filter((inset) => target.left + inset <= target.right - 3).map(
										(inset) => target.left + inset,
									),
								]),
						...[...markBoxes].flatMap(([id, box]) =>
							id === dependency.from || id === dependency.to ? [] : besideBar(box, forward),
						),
					],
				),
			],
			targets: open,
			obstacles: [
				...fixed,
				...keepOuts.map((head) => (head.from === dependency.from ? head.arrowhead : head.keepOut)),
				...[...pending.keys()].flatMap((id) =>
					id === dependency.to ? [] : reservedEntries(id).map((box) => ({ box, clearance: 0 })),
				),
			],
			// Going back starts a short jog behind the predecessor's start, or before an earlier
			// successor's.
			behind:
				Math.min(
					source.left,
					target.left - ROUTE_APPROACH - BAR_SIDE_CLEARANCE - ROUTE_SEPARATION,
				) - FORWARD_SLACK,
			lanes,
			denseLanes,
			routed,
			kin: new Set([
				...(leaving.get(dependency.from) ?? []),
				...(arriving.get(dependency.to) ?? []),
			]),
			lastRuns,
			trunks: new Set(trunks),
			pastTrunk: new Map(
				keepOuts.flatMap((head) =>
					head.from === dependency.from ? [[head.keepOut, head.trunk] as const] : [],
				),
			),
			edges: bars.flatMap(([id, box]) =>
				id === dependency.from || id === dependency.to ? [] : [box],
			),
			...(forward
				? {
						sides: bars.flatMap(([id, box]) =>
							id === dependency.from || id === dependency.to ? [] : [box],
						),
						besides: bars.flatMap(([id, box]) => (between(id) ? [box] : [])),
					}
				: {}),
			top: rowsTop + 1,
			bottom: rowsBottom - 1,
			budget: own,
			kinkBudget,
		};
		// Boxed in, a route may pass closer behind other arrowheads and through reserved entries.
		const search = (request: RouteRequest) =>
			routeOrthogonal(request) ??
			routeOrthogonal({
				...request,
				obstacles: [
					...fixed,
					...heads.map((head) => (head.from === dependency.from ? head.arrowhead : head.keepOut)),
				],
				pastTrunk: new Map(
					heads.flatMap((head) =>
						head.from === dependency.from ? [[head.keepOut, head.trunk] as const] : [],
					),
				),
			});
		const alone = search(routeRequest);
		/*
		 * A route that doubles back into its own entry may instead join the last run of an earlier
		 * arrival and share its entry, when that costs less and runs forward. A join is worth a search
		 * only where a route can reach it without doubling back: down or up a column it can leave its
		 * predecessor by, or one beside a mark, clear of every mark between, then on into the join.
		 */
		const clearDown = (x: number, to: number) =>
			[...markBoxes].every(
				([id, box]) =>
					id === dependency.from ||
					id === dependency.to ||
					x <= box.left - BAR_SIDE_CLEARANCE ||
					x >= box.right + BAR_SIDE_CLEARANCE ||
					(below
						? box.top - BAR_CLEARANCE >= to || box.bottom <= source.bottom
						: box.bottom + BAR_CLEARANCE <= to || box.top >= source.top),
			);
		const columns = [
			...sourcePorts(source, sourceMilestone, below).map((port) => port.x),
			source.right + ROUTE_LEAD,
			...[...markBoxes].flatMap(([, box]) => besideBar(box, forward)),
		];
		const reachable = ({ x, y, direction }: RoutePort) =>
			direction % 2 === 1
				? x >= leaves - 0.5 && clearDown(x, y)
				: columns.some(
						(column) =>
							column >= leaves - 0.5 &&
							column <= source.right + ROUTE_LEAD + 0.5 &&
							(direction === 0 ? column <= x - ROUTE_APPROACH : column >= x + ROUTE_APPROACH) &&
							clearDown(column, y),
					);
		// Its share of the run lies along no other route: none but those ending where the run does.
		const alongNone = (port: RoutePort, run: RouteSegment) =>
			!routed.some(
				(segment) =>
					segment !== run &&
					!(
						lastRuns.has(segment) &&
						Math.hypot(segment.to.x - run.to.x, segment.to.y - run.to.y) < 0.01
					) &&
					runsBeside(port, run.to, segment, ROUTE_SEPARATION),
			);
		const joinTargets =
			forward && alone && doublesBack(alone)
				? joins.flatMap((run) =>
						joinPorts(run, gutters).filter((port) => reachable(port) && alongNone(port, run)),
					)
				: [];
		let shared: RoutePoint[] | undefined;
		if (joinTargets.length > 0 && joinBudget.remaining > 0) {
			const allowed = Math.min(JOIN_SEARCH, joinBudget.remaining);
			const steps = { remaining: allowed };
			shared = search({
				...routeRequest,
				targets: [...open, ...joinTargets],
				joins: new Set(joins),
				budget: steps,
				limit: allowed,
				// Plain searches only: weighing kinks draws on the chart's own budget.
				kinkBudget: { remaining: 0 },
			});
			joinBudget.remaining -= allowed - steps.remaining;
		}
		const merged = shared && joined(shared, joins);
		const chosen = merged && !doublesBack(merged) ? merged : alone;
		// A hook back into a later top or bottom entry runs on along its gutter to an entry nearer the
		// successor's start where it can, so its last turn keeps clear of its arrowhead: the last
		// arrival only, as an earlier one would take the entry a later one drops straight into.
		const onToStart = (points: RoutePoint[]): RoutePoint[] => {
			if (points.length < 4 || pending.get(dependency.to)! > 1 || !doublesBack(points))
				return points;
			const [corner, turn, end] = points.slice(-3) as [RoutePoint, RoutePoint, RoutePoint];
			if (
				Math.abs(turn.x - end.x) >= 0.01 ||
				Math.abs(corner.y - turn.y) >= 0.01 ||
				turn.x >= corner.x - 0.01
			)
				return points;
			const direction = end.y > turn.y ? 1 : 3;
			const earlier = open
				.filter(
					(port) =>
						port.direction === direction && Math.abs(port.y - end.y) < 0.01 && port.x < end.x - 1,
				)
				.toSorted((a, b) => a.x - b.x);
			for (const port of earlier) {
				if (joinBudget.remaining <= 0) break;
				const allowed = Math.min(JOIN_SEARCH, joinBudget.remaining);
				const steps = { remaining: allowed };
				const extended = routeOrthogonal({
					...routeRequest,
					sources: [{ ...corner, direction: 2, cost: 0 }],
					targets: [port],
					budget: steps,
					limit: allowed,
					kinkBudget: { remaining: 0 },
				});
				joinBudget.remaining -= allowed - steps.remaining;
				if (extended?.length === 3 && Math.abs(extended[1]!.y - corner.y) < 0.01)
					return [...points.slice(0, -2), extended[1]!, port];
			}
			return points;
		};
		const searched = chosen && (forward ? onToStart(chosen) : chosen);
		pool.remaining -= granted - own.remaining;
		if (searched) return searched;
		corridors += 1;
		const fallback = corridorRoute({
			marks: clear
				? [...markBoxes].flatMap(([id, box]) =>
						id === dependency.from || id === dependency.to ? [] : [box],
					)
				: [],
			source,
			sourceMilestone,
			sourceRow: rows[rowOf.get(dependency.from)!]!,
			target,
			targetMilestone,
			rowsTop,
			rowsBottom,
			routed,
			heads: heads.map((head) => head.keepOut),
			taken,
			siblings: new Set(trunks),
		});
		fallbacks.add(fallback);
		return fallback;
	};
	dependencies.forEach((dependency, index) => {
		const points = place(dependency);
		placed[index] = points;
		add(dependency, points);
	});

	/*
	 * Repair: a route placed early may lie where a later arrowhead had to land, or a
	 * crowded fallback may pass one. Reroute each route that comes near another's
	 * arrowhead or lies along another route, now that every other route is known, and
	 * keep the new route only when it has fewer such conflicts.
	 */
	const kinOf = (index: number, at: number) => ({
		leaving: dependencies[index]!.from === dependencies[at]!.from,
		arriving: dependencies[index]!.to === dependencies[at]!.to,
	});
	const conflicts = (index: number) => {
		const own = placed[index]!;
		let count = 0;
		placed.forEach((other, at) => {
			if (at === index || !other) return;
			const kin = kinOf(index, at);
			count += routeConflicts(own, other, kin) + routeConflicts(other, own, kin);
		});
		return count;
	};
	/*
	 * Arrivals into one successor take its entries in routing order, so the first can take the
	 * entry that suits a later one. Try them in reverse and keep whichever order draws shorter,
	 * straighter routes with fewer conflicts.
	 */
	const arrivals = new Map<string, number[]>();
	dependencies.forEach((dependency, index) =>
		arrivals.set(dependency.to, [...(arrivals.get(dependency.to) ?? []), index]),
	);
	const lengthOf = (points: readonly RoutePoint[]) =>
		routeSegments(points).reduce(
			(total, { from, to }) => total + Math.abs(to.x - from.x) + Math.abs(to.y - from.y),
			0,
		);
	/** How often a route crosses the others. */
	const crossingsOf = (index: number) => {
		const runs = routeSegments(placed[index]!);
		let count = 0;
		placed.forEach((other, at) => {
			if (at === index || !other) return;
			for (const theirs of routeSegments(other))
				for (const run of runs) if (runsCross(run, theirs)) count += 1;
		});
		return count;
	};
	/** How routes read: their conflicts first, then their length, bends, kinks and crossings. */
	const standing = (indices: readonly number[]) => ({
		conflicts: indices.reduce((sum, index) => sum + conflicts(index), 0),
		drawn: indices.reduce((sum, index) => {
			const points = placed[index]!;
			return (
				sum +
				lengthOf(points) +
				REORDER_BEND_COST * (points.length - 2) +
				routeKinkCost(points) +
				REORDER_CROSSING_COST * crossingsOf(index)
			);
		}, 0),
	});
	const better = (a: ReturnType<typeof standing>, b: ReturnType<typeof standing>) =>
		a.conflicts < b.conflicts || (a.conflicts === b.conflicts && a.drawn < b.drawn - 1e-6);
	// Only arrivals that detour, cross or conflict are worth trying in another order.
	const strained = (indices: readonly number[]) =>
		indices.some((index) => conflicts(index) > 0 || crossingsOf(index) > 0) ||
		indices.reduce((sum, index) => {
			const points = placed[index]!;
			const [start, end] = [points[0]!, points.at(-1)!];
			return sum + lengthOf(points) - Math.abs(end.x - start.x) - Math.abs(end.y - start.y);
		}, 0) > REORDER_DETOUR;
	for (const [target, indices] of arrivals) {
		if (indices.length < 2 || !strained(indices)) continue;
		// The other order; into a milestone, also the entries above and below its left vertex first.
		const plans = [
			{ order: indices.toReversed(), split: false },
			...(schedules.get(target)!.milestone ? [{ order: indices, split: true }] : []),
		];
		let kept = {
			routes: indices.map((index) => placed[index]),
			standing: standing(indices),
			split: false,
		};
		for (const plan of plans) {
			// Without search budget left, another plan could only take the corridor.
			if (budget.remaining <= 0) break;
			// The entries beside a milestone's vertex are worth trying only while arrivals still
			// cross or kink.
			if (plan.split) {
				indices.forEach((index, at) => (placed[index] = kept.routes[at]));
				const troubled = indices.some(
					(index) => crossingsOf(index) > 0 || routeKinkCost(placed[index]!) > 0,
				);
				if (!troubled) break;
			}
			for (const index of indices) placed[index] = undefined;
			rebuild();
			if (plan.split) split.add(target);
			for (const index of plan.order) {
				const points = place(dependencies[index]!);
				placed[index] = points;
				add(dependencies[index]!, points);
			}
			split.delete(target);
			const tried = standing(indices);
			if (better(tried, kept.standing))
				kept = {
					routes: indices.map((index) => placed[index]),
					standing: tried,
					split: plan.split,
				};
		}
		indices.forEach((index, at) => (placed[index] = kept.routes[at]));
		if (kept.split) split.add(target);
		rebuild();
	}
	// Repairs draw on their own budget, so a chart that spent its own can still clear a conflict.
	const repairBudget = { remaining: REPAIR_BUDGET };
	let reroutes = 0;
	/** A new route for one dependency around all the others, leaving the drawing as it was. */
	const tryAgain = (index: number) => {
		if (reroutes >= REPAIR_PASSES * dependencies.length) return undefined;
		reroutes += 1;
		const kept = placed[index];
		placed[index] = undefined;
		rebuild();
		const points = place(dependencies[index]!, repairBudget);
		placed[index] = kept;
		rebuild();
		return points;
	};
	/**
	 * Clear a conflict between a route and the one whose arrowhead it passes: reroute either,
	 * and keep whichever change leaves the pair with the fewest conflicts, then the shortest.
	 */
	const resolve = (passer: number, owner: number) => {
		const pair = [passer, owner];
		let best = standing(pair);
		let choice: { index: number; points: RoutePoint[] } | undefined;
		for (const index of pair) {
			const points = tryAgain(index);
			if (!points) continue;
			const kept = placed[index];
			placed[index] = points;
			rebuild();
			const after = standing(pair);
			if (after.conflicts < best.conflicts && better(after, best)) {
				best = after;
				choice = { index, points };
			}
			placed[index] = kept;
			rebuild();
		}
		if (!choice) return false;
		placed[choice.index] = choice.points;
		versions[choice.index] = versions[choice.index]! + 1;
		rebuild();
		return true;
	};
	// Each conflicting pair is resolved once; again only once either route has changed.
	const versions = dependencies.map(() => 0);
	const tried = new Set<string>();
	for (let pass = 0; pass < REPAIR_PASSES; pass += 1) {
		let improved = false;
		placed.forEach((_, index) => {
			placed.forEach((other, at) => {
				const own = placed[index];
				if (at === index || !own || !other || routeConflicts(own, other, kinOf(index, at)) === 0)
					return;
				const pair = `${index}.${versions[index]}:${at}.${versions[at]}`;
				if (tried.has(pair)) return;
				tried.add(pair);
				if (resolve(index, at)) improved = true;
			});
		});
		if (!improved) break;
	}
	const routes = dependencies.map((dependency, index) => ({
		id: `gantt:dependency:${escapeId(dependency.from)}:${escapeId(dependency.to)}`,
		...dependency,
		points: placed[index]!,
	}));
	const arrows: ArrowSceneElement[] = routes.map((route) => {
		const [first, ...rest] = withArrowheadRun(route.points).map((point) => ({
			x: round(point.x),
			y: round(point.y),
		}));
		return {
			type: "arrow",
			id: route.id,
			edgeId: route.id,
			sourceNodeId: `gantt:task:${route.from}`,
			targetNodeId: `gantt:task:${route.to}`,
			points: [first!, ...rest],
			strokeColor: ARROW_COLOR,
			strokeWidth: 1,
			roughness: 0,
			endArrowhead: "triangle",
		};
	});
	for (const arrow of arrows) builder.push(arrow, "front");

	// The date axis above the rows, and again below a tall chart when the budget allows.
	const axisCount = (side: "top" | "bottom") => {
		const before = builder.elements.length;
		drawAxis(side);
		return builder.elements.length - before;
	};
	const drawAxis = (side: "top" | "bottom") => {
		const suffix = side === "top" ? "" : "-bottom";
		const tickTop = side === "top" ? rowsTop - HEADER_ROW_HEIGHT : rowsBottom;
		const bandTop = side === "top" ? tickTop - HEADER_ROW_HEIGHT : tickTop + HEADER_ROW_HEIGHT;
		axis.cells.forEach((cell, index) => {
			const text = measure(cell.label, GANTT_TICK_FONT_SIZE);
			builder.text(
				`gantt:tick${suffix}:${index}`,
				text,
				(xOf(cell.start) + xOf(cell.end)) / 2 - text.width / 2,
				tickTop + (HEADER_ROW_HEIGHT - text.height) / 2,
				GANTT_TICK_FONT_SIZE,
				MUTED_INK,
				"center",
			);
		});
		axis.bands.forEach((band, index) => {
			const room = xOf(band.end) - xOf(band.start) - 8;
			const label = ganttBandLabels(band)
				.map((text) => measure(text, GANTT_BAND_FONT_SIZE))
				.find((text) => text.width <= room);
			if (label)
				builder.text(
					`gantt:band${suffix}:${index}`,
					label,
					(xOf(band.start) + xOf(band.end)) / 2 - label.width / 2,
					bandTop + (HEADER_ROW_HEIGHT - label.height) / 2,
					GANTT_BAND_FONT_SIZE,
					INK,
					"center",
				);
			if (index > 0)
				builder.line(
					`gantt:band-edge${suffix}:${index}`,
					[
						{ x: xOf(band.start), y: bandTop + 3 },
						{ x: xOf(band.start), y: bandTop + HEADER_ROW_HEIGHT - 3 },
					],
					{ strokeColor: BAND_GRID_COLOR },
				);
		});
		builder.line(
			`gantt:axis${suffix}`,
			[
				{ x: xOf(axis.start), y: side === "top" ? rowsTop : rowsBottom },
				{ x: plotWidth, y: side === "top" ? rowsTop : rowsBottom },
			],
			{ strokeColor: AXIS_COLOR },
		);
	};
	const bottomAxisCount = axisCount("top");

	// Today: a dashed line through every row, named above the axis.
	let headerTop = rowsTop - 2 * HEADER_ROW_HEIGHT;
	if (todayX !== undefined) {
		const caption = measure(captions.today ?? "Today", TODAY_FONT);
		headerTop -= TODAY_ROW_HEIGHT;
		builder.text(
			"gantt:today-label",
			caption,
			Math.min(
				Math.max(todayX - caption.width / 2, xOf(axis.start)),
				Math.max(xOf(axis.start), plotWidth - caption.width),
			),
			headerTop + (TODAY_ROW_HEIGHT - caption.height) / 2,
			TODAY_FONT,
			TODAY_COLOR,
			"center",
		);
	}
	const title = wrapped(diagram.title, Math.max(plotWidth - columnLeft, 360), TITLE_FONT);
	builder.text(
		"gantt:title",
		title,
		columnLeft,
		headerTop - TITLE_GAP - title.height,
		TITLE_FONT,
		INK,
		"left",
	);

	/*
	 * Rules break around every label they pass behind, and a scene holds at most
	 * CANVAS_LIMITS.maxElements elements. Take the richest plan that fits: every
	 * tick's gridline, the bottom axis on a tall chart, and weekly or monthly minor
	 * lines; then fewer.
	 */
	const bandEdges = new Set([axis.start, axis.end, ...axis.bands.map((band) => band.start)]);
	const tickDays = [...axis.cells.map((cell) => cell.start), axis.end];
	const wantsBottom = taskRows >= BOTTOM_AXIS_ROWS;
	const plans = [true, false].flatMap((rowRules) =>
		[
			{ grid: tickDays, minor: true, bottom: wantsBottom },
			{ grid: tickDays, minor: false, bottom: wantsBottom },
			{ grid: tickDays, minor: false, bottom: false },
			{ grid: tickDays.filter((day) => bandEdges.has(day)), minor: false, bottom: wantsBottom },
			{ grid: tickDays.filter((day) => bandEdges.has(day)), minor: false, bottom: false },
			{ grid: [axis.start, axis.end], minor: false, bottom: false },
		].map((plan) => ({ ...plan, rowRules })),
	);
	const rulesFor = (plan: (typeof plans)[number]): LineSceneElement[] => {
		const gridTop = rowsTop - HEADER_ROW_HEIGHT;
		const gridBottom = plan.bottom ? rowsBottom + HEADER_ROW_HEIGHT : rowsBottom;
		const rule = (
			id: string,
			x: number,
			top: number,
			bottom: number,
			style: Partial<LineSceneElement>,
		): LineSceneElement => ({
			type: "line",
			id,
			points: [
				{ x: round(x), y: round(top) },
				{ x: round(x), y: round(bottom) },
			],
			roughness: 0,
			strokeWidth: 1,
			...style,
		});
		return [
			// Rules between rows, from the table across the plot, so each name reads against its bar.
			...(plan.rowRules
				? [...rows.slice(1).map((row) => row.top), rowsBottom].map(
						(y, index): LineSceneElement => ({
							type: "line",
							id: `gantt:row-rule:${index}`,
							points: [
								{ x: round(columnLeft), y: round(y) },
								{ x: round(plotWidth), y: round(y) },
							],
							roughness: 0,
							strokeWidth: 1,
							strokeColor: ROW_RULE_COLOR,
						}),
					)
				: []),
			...(plan.minor
				? axis.minor.map((day) =>
						rule(`gantt:minor:${formatGanttDay(day)}`, xOf(day), rowsTop, rowsBottom, {
							strokeColor: MINOR_GRID_COLOR,
						}),
					)
				: []),
			...plan.grid.map((day) =>
				rule(`gantt:grid:${formatGanttDay(day)}`, xOf(day), gridTop, gridBottom, {
					strokeColor: bandEdges.has(day) ? BAND_GRID_COLOR : GRID_COLOR,
				}),
			),
			...(todayX === undefined
				? []
				: [
						rule("gantt:today", todayX, headerTop + TODAY_ROW_HEIGHT, gridBottom, {
							strokeColor: TODAY_COLOR,
							strokeStyle: "dashed",
						}),
					]),
		];
	};
	// Today breaks around every bar and diamond too, unless that alone would overflow the scene.
	const markMasks = [...markBoxes.values()].map((box) => ({
		left: box.left - TODAY_CLEARANCE,
		right: box.right + TODAY_CLEARANCE,
		top: box.top - 1,
		bottom: box.bottom + 1,
	}));
	const todayMasks = (aroundMarks: boolean) =>
		aroundMarks ? [...builder.textBoxes, ...markMasks] : builder.textBoxes;
	const isToday = (id: string) => id === "gantt:today";
	const [plan, todayAroundMarks] = [true, false]
		.flatMap((aroundMarks) => plans.map((candidate) => [candidate, aroundMarks] as const))
		.find(([candidate, aroundMarks]) => {
			const rules = rulesFor(candidate);
			const pieces = new Map([
				...breakRulesUnderText(rules, builder.textBoxes, (id) => !isToday(id)),
				...breakRulesUnderText(rules, todayMasks(aroundMarks), isToday),
			]);
			const count = rules.reduce((sum, rule) => sum + (pieces.get(rule.id)?.length ?? 1), 0);
			return (
				builder.elements.length + count + (candidate.bottom ? bottomAxisCount : 0) <=
				CANVAS_LIMITS.maxElements
			);
		}) ?? [plans.at(-1)!, false];
	if (plan.bottom) drawAxis("bottom");
	for (const rule of rulesFor(plan))
		builder.push(rule, rule.id === "gantt:today" ? "middle" : "back");

	builder.breakRulesUnderText(
		(id) =>
			id.startsWith("gantt:grid:") ||
			id.startsWith("gantt:minor:") ||
			id.startsWith("gantt:row-rule:") ||
			id.startsWith("gantt:axis") ||
			id.startsWith("gantt:band-edge"),
	);
	// Today passes behind every bar and diamond as well as every text, so it never meets a label.
	builder.breakRulesUnderText(isToday, todayMasks(todayAroundMarks));

	const box = builder.bounds();
	const dx = PADDING - box.left;
	const dy = PADDING - box.top;
	const shift = (point: RoutePoint) => ({ x: round(point.x + dx), y: round(point.y + dy) });
	const elements = builder.elements.map((element): SceneElement => {
		if (element.type === "line") {
			const [a, b, ...rest] = element.points.map(shift);
			return { ...element, points: [a!, b!, ...rest] };
		}
		if (element.type === "arrow") {
			const [a, ...rest] = element.points.map(shift);
			return { ...element, points: [a!, ...rest] };
		}
		return { ...element, x: round(element.x + dx), y: round(element.y + dy) };
	});
	const conflicted = placed.reduce(
		(sum, points, index) =>
			sum +
			placed.reduce(
				(pairs, other, at) =>
					at === index ? pairs : pairs + routeConflicts(points!, other!, kinOf(index, at), true),
				0,
			),
		0,
	);
	return {
		scene: {
			kind: "canvas",
			version: CANVAS_SPEC_VERSION,
			diagramId: diagram.id,
			title: diagram.title,
			width: Math.ceil(box.right - box.left + PADDING * 2),
			height: Math.ceil(box.bottom - box.top + PADDING * 2),
			accentColor: diagram.style.accentColor,
			backgroundColor: diagram.style.backgroundColor,
			elements,
			layers: [],
			layouts: [],
			zOrder: builder.zOrder(),
		},
		crossings: placed.reduce((sum, _, index) => sum + crossingsOf(index), 0) / 2,
		findings: findingsOf(
			placed.map((points, index) => ({ ...dependencies[index]!, points: points! })),
			bars,
			conflicted,
			fallbacks,
		),
		clear: keepsClear(
			placed.map((points, index) => ({ ...dependencies[index]!, points: points! })),
			markBoxes,
		),
		work: {
			layouts: 1,
			placements,
			expansions:
				chartBudget -
				budget.remaining +
				REPAIR_BUDGET -
				repairBudget.remaining +
				kinkChartBudget -
				kinkBudget.remaining +
				joinChartBudget -
				joinBudget.remaining,
			corridors,
			conflicts: conflicted,
		},
	};
}

export type { GanttAxis };
