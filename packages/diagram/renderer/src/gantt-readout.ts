import { parseGanttDay } from "@sketchi/diagram-core";

import { GANTT_MARK_ROLE } from "./gantt.js";
import type { RenderedDiagramScene, SceneElement, ScenePoint } from "./scene.js";

type TextElement = Extract<SceneElement, { type: "text" }>;

export interface GanttMarkReadout {
	readonly id: string;
	readonly milestone: boolean;
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
	/** The day the mark starts, read off the axis: a bar's left edge, a diamond's center. */
	readonly start: number;
	/** The day after a bar's right edge; equal to `start` for a milestone. */
	readonly end: number;
}

export interface GanttDependencyReadout {
	readonly from: string;
	readonly to: string;
	readonly points: readonly ScenePoint[];
}

/** A rendered Gantt chart read back from its scene alone. */
export interface GanttReadout {
	/** Day number of each axis gridline, keyed by x. */
	readonly gridlines: readonly { readonly day: number; readonly x: number }[];
	/** Pixels per day, from the outermost gridlines. */
	readonly pxPerDay: number;
	readonly marks: ReadonlyMap<string, GanttMarkReadout>;
	readonly dependencies: readonly GanttDependencyReadout[];
	/** Phase headers top to bottom, each with the tasks drawn under it. */
	readonly phases: readonly { readonly name: string; readonly tasks: readonly string[] }[];
	readonly labels: ReadonlyMap<string, string>;
	readonly captions: ReadonlyMap<string, string>;
	readonly texts: readonly TextElement[];
	/** The day the Today line falls in. */
	readonly today?: number;
}

/** Read the dates, rows and dependencies a rendered Gantt chart draws. */
export function readGanttScene(scene: RenderedDiagramScene): GanttReadout {
	const gridlines = new Map<number, number>();
	const texts: TextElement[] = [];
	let todayX: number | undefined;
	for (const element of scene.elements) {
		if (element.type === "text") texts.push(element);
		if (element.type !== "line") continue;
		const grid = /^gantt:grid:(\d{4}-\d{2}-\d{2})(?::\d+)?$/u.exec(element.id);
		const day = grid ? parseGanttDay(grid[1]!) : undefined;
		if (day !== undefined) gridlines.set(day, element.points[0].x);
		if (element.id === "gantt:today" || element.id.startsWith("gantt:today:"))
			todayX = element.points[0].x;
	}
	const sorted = [...gridlines].map(([day, x]) => ({ day, x })).toSorted((a, b) => a.day - b.day);
	const first = sorted[0];
	const last = sorted.at(-1);
	const pxPerDay =
		first && last && last.day > first.day ? (last.x - first.x) / (last.day - first.day) : 0;
	const dayAt = (x: number) => (first ? first.day + (x - first.x) / pxPerDay : Number.NaN);
	const marks = new Map<string, GanttMarkReadout>();
	for (const element of scene.elements) {
		if (
			element.type !== "node" ||
			element.rendererRole !== GANTT_MARK_ROLE ||
			!element.nodeId.startsWith("gantt:task:")
		)
			continue;
		const id = element.nodeId.slice("gantt:task:".length);
		const milestone = element.shape === "diamond";
		const center = element.x + element.width / 2;
		const start = milestone ? dayAt(center) - 0.5 : dayAt(element.x);
		marks.set(id, {
			id,
			milestone,
			left: element.x,
			right: element.x + element.width,
			top: element.y,
			bottom: element.y + element.height,
			start,
			end: milestone ? start : dayAt(element.x + element.width),
		});
	}
	const dependencies = scene.elements.flatMap((element) =>
		element.type === "arrow" && element.id.startsWith("gantt:dependency:")
			? [
					{
						from: element.sourceNodeId.slice("gantt:task:".length),
						to: element.targetNodeId.slice("gantt:task:".length),
						points: element.points,
					},
				]
			: [],
	);
	const byId = (prefix: string) =>
		new Map(
			texts.flatMap((text) =>
				text.id.startsWith(prefix) ? [[text.id.slice(prefix.length), text.text] as const] : [],
			),
		);
	const headers = texts
		.filter((text) => /^gantt:phase:\d+$/u.test(text.id))
		.toSorted((a, b) => a.y - b.y);
	const rows = [...marks.values()].toSorted((a, b) => a.top - b.top);
	const phases = headers.map((header, index) => {
		const below = headers[index + 1]?.y ?? Infinity;
		return {
			name: header.text.replace(/\n/gu, " "),
			tasks: rows.filter((mark) => mark.top > header.y && mark.top < below).map((mark) => mark.id),
		};
	});
	return {
		gridlines: sorted,
		pxPerDay,
		marks,
		dependencies,
		phases,
		labels: byId("gantt:label:"),
		captions: byId("gantt:caption:"),
		texts,
		...(todayX === undefined ? {} : { today: Math.floor(dayAt(todayX)) }),
	};
}
