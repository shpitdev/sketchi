import { estimateTextWidth, formatGanttDay } from "@sketchi/diagram-core";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type GanttTickUnit = "day" | "week" | "month" | "quarter" | "year";

/** One tick cell `[start, end)` in days, labeled at its center. */
export interface GanttAxisCell {
	readonly start: number;
	readonly end: number;
	readonly label: string;
}

/** A to-scale date axis: tick cells, the context band above them, and days per pixel. */
export interface GanttAxis {
	readonly unit: GanttTickUnit;
	/** Units per tick: 1 for days to quarters; 1, 2, 5 or 10 for years. */
	readonly step: number;
	/** Aligned to tick boundaries, so the cells cover the plan's span exactly. */
	readonly start: number;
	readonly end: number;
	readonly pxPerDay: number;
	readonly cells: readonly GanttAxisCell[];
	/** Months above day ticks, otherwise years; none above year ticks. */
	readonly bands: readonly GanttAxisCell[];
	/** Unlabeled gridlines inside month cells (weeks) and quarter cells (months). */
	readonly minor: readonly number[];
}

export const GANTT_TICK_FONT_SIZE = 12;
export const GANTT_BAND_FONT_SIZE = 13;
/** A tick label needs this much room in its cell beyond its own width. */
const TICK_LABEL_PAD = 8;
/** Plots spread toward this width, and a day never draws wider than the cap. */
const TARGET_PLOT_WIDTH = 960;
const MAX_PX_PER_DAY = 56;
/** Past this many cells, ticks coarsen even when labels still fit. */
const MAX_CELLS = 36;
/** Minor gridlines only where they stay at least this far apart. */
const MIN_MINOR_GAP = 12;

interface Calendar {
	readonly year: number;
	/** 1–12. */
	readonly month: number;
	readonly day: number;
	/** 0 Monday … 6 Sunday. */
	readonly weekday: number;
}

function calendar(day: number): Calendar {
	const date = new Date(day * 86_400_000);
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		weekday: (date.getUTCDay() + 6) % 7,
	};
}

function dayOf(year: number, month: number, day = 1): number {
	// Date.UTC reads years 0–99 as 1900–1999; setUTCFullYear keeps them.
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	return Math.round(date.getTime() / 86_400_000);
}

/** Each candidate tick, from finest to coarsest. */
const TICKS: readonly { readonly unit: GanttTickUnit; readonly step: number }[] = [
	{ unit: "day", step: 1 },
	{ unit: "week", step: 1 },
	{ unit: "month", step: 1 },
	{ unit: "quarter", step: 1 },
	{ unit: "year", step: 1 },
	{ unit: "year", step: 2 },
	{ unit: "year", step: 5 },
	{ unit: "year", step: 10 },
];

/** The tick boundary on or before `day`. */
function floorTo(day: number, unit: GanttTickUnit, step: number): number {
	const date = calendar(day);
	switch (unit) {
		case "day":
			return day;
		case "week":
			return day - date.weekday;
		case "month":
			return dayOf(date.year, date.month);
		case "quarter":
			return dayOf(date.year, date.month - ((date.month - 1) % 3));
		case "year":
			return dayOf(date.year - (((date.year % step) + step) % step), 1);
	}
}

/** The tick boundary after the one at `day`. */
function next(day: number, unit: GanttTickUnit, step: number): number {
	const date = calendar(day);
	switch (unit) {
		case "day":
			return day + 1;
		case "week":
			return day + 7;
		case "month":
			return dayOf(date.year, date.month + 1);
		case "quarter":
			return dayOf(date.year, date.month + 3);
		case "year":
			return dayOf(date.year + step, 1);
	}
}

function cellLabel(day: number, unit: GanttTickUnit, step: number): string {
	const date = calendar(day);
	switch (unit) {
		case "day":
			return String(date.day);
		case "week":
			return `${MONTHS[date.month - 1]} ${date.day}`;
		case "month":
			return MONTHS[date.month - 1]!;
		case "quarter":
			return `Q${Math.floor((date.month - 1) / 3) + 1}`;
		case "year":
			return step === 1 ? String(date.year) : `${date.year}–${String(date.year + step - 1)}`;
	}
}

/** The cells covering `[start, end)`, or undefined once there would be more than `limit`. */
function cellsOf(
	start: number,
	end: number,
	unit: GanttTickUnit,
	step: number,
	label: (day: number) => string,
	limit = Infinity,
): GanttAxisCell[] | undefined {
	const cells: GanttAxisCell[] = [];
	for (let day = floorTo(start, unit, step); day < end;) {
		if (cells.length >= limit) return undefined;
		const after = next(day, unit, step);
		cells.push({ start: day, end: after, label: label(day) });
		day = after;
	}
	return cells;
}

/**
 * Choose the finest tick whose every label fits its cell at a scale that
 * spreads the aligned span toward the target width. The span `[start, end)`
 * is in days; the axis starts and ends on tick boundaries around it.
 */
export function ganttAxis(start: number, end: number): GanttAxis {
	const last = Math.max(end, start + 1);
	for (const { unit, step } of TICKS) {
		// Only the coarsest tick may run past the cells an axis can label; validated plans keep it short.
		const coarsest = unit === "year" && step === 10;
		const cells = cellsOf(
			start,
			last,
			unit,
			step,
			(day) => cellLabel(day, unit, step),
			coarsest ? Infinity : MAX_CELLS,
		);
		if (!cells) continue;
		const axisStart = cells[0]!.start;
		const axisEnd = cells.at(-1)!.end;
		const pxPerDay = Math.min(MAX_PX_PER_DAY, TARGET_PLOT_WIDTH / (axisEnd - axisStart));
		const fits = cells.every(
			(cell) =>
				estimateTextWidth(cell.label, GANTT_TICK_FONT_SIZE) + TICK_LABEL_PAD <=
				(cell.end - cell.start) * pxPerDay,
		);
		if (!fits && !coarsest) continue;
		const bands =
			(unit === "year"
				? []
				: unit === "day"
					? cellsOf(
							axisStart,
							axisEnd,
							"month",
							1,
							(day) => `${MONTHS[calendar(day).month - 1]} ${calendar(day).year}`,
						)
					: cellsOf(axisStart, axisEnd, "year", 1, (day) => String(calendar(day).year))) ?? [];
		const boundaries = new Set(cells.map((cell) => cell.start));
		const minorUnit = unit === "month" ? "week" : unit === "quarter" ? "month" : undefined;
		const minor =
			minorUnit && (minorUnit === "week" ? 7 : 28) * pxPerDay >= MIN_MINOR_GAP
				? (cellsOf(axisStart, axisEnd, minorUnit, 1, () => "") ?? [])
						.map((cell) => cell.start)
						.filter((day) => day > axisStart && !boundaries.has(day))
				: [];
		return {
			unit,
			step,
			start: axisStart,
			end: axisEnd,
			pxPerDay,
			cells,
			minor,
			bands: bands.map((band) => ({
				start: Math.max(band.start, axisStart),
				end: Math.min(band.end, axisEnd),
				label: band.label,
			})),
		};
	}
	throw new Error("unreachable: ten-year ticks always fit");
}

/** Shorter band labels for a band too narrow for its full label: `Mar` for `Mar 2026`, `’26` for `2026`. */
export function ganttBandLabels(band: GanttAxisCell): readonly string[] {
	const month = /^([A-Z][a-z]{2}) \d{4}$/u.exec(band.label);
	if (month) return [band.label, month[1]!];
	return /^\d{4}$/u.test(band.label) ? [band.label, `’${band.label.slice(2)}`] : [band.label];
}

/** Every tick boundary as `YYYY-MM-DD`, start of each cell then the axis end. */
export function ganttAxisBoundaries(axis: GanttAxis): string[] {
	return [...axis.cells.map((cell) => cell.start), axis.end].map(formatGanttDay);
}
