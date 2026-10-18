import type { RenderedDiagramScene } from "./scene.js";
import { TIMELINE_MARKER_ROLE } from "./timeline.js";

export interface TimelineMarkerReadout {
	/** Where the event starts: a point marker's center or a bar's left edge. */
	readonly start: number;
	/** A phase bar's right edge. */
	readonly end?: number;
}

export interface TimelineLaneReadout {
	/** Markers by event id, on the lane's axis unwrapped across rows. */
	readonly markers: ReadonlyMap<string, TimelineMarkerReadout>;
	/** Axis break marks on the same unwrapped axis. */
	readonly breaks: readonly number[];
}

/**
 * Read a rendered timeline back as one straight axis per lane: each row's solid
 * axis is laid end to end, so a gap split across a row wrap is measured whole.
 */
export function readTimelineAxis(scene: RenderedDiagramScene): readonly TimelineLaneReadout[] {
	const rows = new Map<
		string,
		{ lane: number; row: number; y: number; start: number; end: number }
	>();
	const ends = new Map<string, number>();
	const breakTicks = new Map<string, { key: string; x: number }[]>();
	const markers: { id: string; x: number; y: number; width: number; bar: boolean }[] = [];
	for (const element of scene.elements) {
		if (element.type === "node" && element.rendererRole === TIMELINE_MARKER_ROLE) {
			markers.push({
				id: element.nodeId.slice("event:".length),
				x: element.x,
				y: element.y + element.height / 2,
				width: element.width,
				bar: element.shape === "rectangle",
			});
			continue;
		}
		if (element.type !== "line") continue;
		const [first, last] = [element.points[0], element.points[element.points.length - 1]!];
		const axis = /^axis:(\d+):(\d+)(?::\d+)?$/.exec(element.id);
		if (axis) {
			const key = `${axis[1]}:${axis[2]}`;
			const found = rows.get(key);
			const low = Math.min(first.x, last.x);
			const high = Math.max(first.x, last.x);
			rows.set(key, {
				lane: Number(axis[1]),
				row: Number(axis[2]),
				y: first.y,
				start: Math.min(found?.start ?? low, low),
				end: Math.max(found?.end ?? high, high),
			});
			continue;
		}
		const out = /^continue-out:(\d+:\d+)$/.exec(element.id);
		if (out) ends.set(out[1]!, first.x);
		const tick = /^break:(\d+:\d+):\d+:[ab]$/.exec(element.id);
		if (tick)
			breakTicks.set(tick[1]!, [
				...(breakTicks.get(tick[1]!) ?? []),
				{ key: element.id.slice(0, -2), x: (first.x + last.x) / 2 },
			]);
	}
	const laneCount = Math.max(-1, ...[...rows.values()].map((row) => row.lane)) + 1;
	return Array.from({ length: laneCount }, (_, lane) => {
		const laneRows = [...rows.entries()]
			.filter(([, row]) => row.lane === lane)
			.toSorted(([, a], [, b]) => a.row - b.row);
		let offset = 0;
		const unwrapped = laneRows.map(([key, row]) => {
			const end = ends.get(key) ?? row.end;
			const entry = { key, ...row, offset };
			offset += end - row.start;
			return entry;
		});
		const at = (entry: (typeof unwrapped)[number], x: number) => entry.offset + x - entry.start;
		const breaks = unwrapped.flatMap((entry) => {
			const ticks = breakTicks.get(entry.key) ?? [];
			const marks = new Map<string, number[]>();
			for (const tick of ticks) marks.set(tick.key, [...(marks.get(tick.key) ?? []), tick.x]);
			return [...marks.values()].map((xs) =>
				at(entry, xs.reduce((sum, value) => sum + value, 0) / xs.length),
			);
		});
		const owned = new Map<string, TimelineMarkerReadout>();
		for (const marker of markers) {
			// A marker belongs to the nearest axis at or above it: bars stack below theirs.
			const entry = [...rows.values()]
				.filter((row) => row.y <= marker.y + 0.5)
				.toSorted((a, b) => b.y - a.y)[0];
			if (entry?.lane !== lane) continue;
			const row = unwrapped.find((candidate) => candidate.row === entry.row)!;
			owned.set(
				marker.id,
				marker.bar
					? { start: at(row, marker.x), end: at(row, marker.x + marker.width) }
					: { start: at(row, marker.x + marker.width / 2) },
			);
		}
		return { markers: owned, breaks };
	});
}

export interface TimelineGapReadout {
	readonly lane: number;
	/** Event ids at each end; a phase's end reads as `<id>:end`. */
	readonly from: string;
	readonly to: string;
	/** Elapsed time, in the moments' unit. */
	readonly elapsed: number;
	/** Drawn length along the unwrapped axis. */
	readonly drawn: number;
	/** An axis break lies inside the gap. */
	readonly broken: boolean;
}

/**
 * Consecutive gaps between distinct moments on each lane, given each event's
 * real start and phase end. Simultaneous events read at the leftmost marker.
 */
export function readTimelineGaps(
	scene: RenderedDiagramScene,
	moments: ReadonlyMap<string, { readonly start: number; readonly end?: number }>,
): TimelineGapReadout[] {
	return readTimelineAxis(scene).flatMap((lane, laneIndex) => {
		const points = new Map<number, { id: string; at: number }>();
		const add = (time: number, id: string, at: number) => {
			const found = points.get(time);
			if (!found || at < found.at) points.set(time, { id, at });
		};
		for (const [id, marker] of lane.markers) {
			const moment = moments.get(id);
			if (!moment) continue;
			add(moment.start, id, marker.start);
			if (moment.end !== undefined && marker.end !== undefined)
				add(moment.end, `${id}:end`, marker.end);
		}
		const sorted = [...points.entries()].toSorted(([a], [b]) => a - b);
		return sorted.slice(1).map(([time, point], index) => {
			const [previousTime, previous] = sorted[index]!;
			return {
				lane: laneIndex,
				from: previous.id,
				to: point.id,
				elapsed: time - previousTime,
				drawn: point.at - previous.at,
				broken: lane.breaks.some((at) => at > previous.at && at < point.at),
			};
		});
	});
}
