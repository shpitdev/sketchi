import {
	boundLabelWidth,
	CANVAS_SPEC_VERSION,
	estimateTextWidth,
	orderedTimelineEvents,
	parseTimelineDate,
	SKETCHI_DIAGRAM_PALETTE,
	timelineLanes,
	validateTimelineDiagram,
	wrapTextToWidth,
	type TimelineDiagram,
	type TimelineEvent,
} from "@sketchi/diagram-core";
import type {
	LineSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	TextSceneElement,
} from "./scene.js";
import { timelineCaptions, timelineDurationCaption } from "./timeline-captions.js";

export const TIMELINE_MARKER_ROLE = "timeline-marker";

const PADDING = 40;
const TEXT_WIDTH = 200;
const CAPTION_FONT_SIZE = 14;
const LABEL_FONT_SIZE = 16;
const DESCRIPTION_FONT_SIZE = 13;
const HEADER_FONT_SIZE = 14;
const LANE_FONT_SIZE = 15;
const TEXT_LINE_HEIGHT = 1.35;
const PART_GAP = 2;
const DOT_SIZE = 12;
const DIAMOND_SIZE = 18;
const BAR_HEIGHT = 12;
const BAR_TRACK_GAP = 4;
const MIN_BAR_WIDTH = 12;
/** Distance from the axis to the nearest label edge. */
const LABEL_BASE = 22;
/**
 * A single row wider than this lengthens its stems, moving every label out
 * from the axis, until it reads this wide or its labels stand this far out.
 */
const STEM_ASPECT = 2.3;
const MAX_LABEL_BASE = 140;
const LABEL_BASE_STEP = 6;
const BLOCK_GAP_X = 16;
const BLOCK_GAP_Y = 10;
const STEM_CLEARANCE = 6;
/** A label keeps its stem at least this far inside its own edge. */
const STEM_INSET = 10;
/** Consecutive stems on a lane never sit closer than this. */
const MIN_MARKER_GAP = 28;
/**
 * A date may sit this far off its own stem and still be nearer it than any
 * neighbor, which is at least MIN_MARKER_GAP away.
 */
const CAPTION_SLACK = MIN_MARKER_GAP / 2 - 2;
const AXIS_OVERHANG = 24;
const CONTINUATION_LENGTH = 32;
/** A break's duration sits on the axis, with its ticks this far out from the text. */
const BREAK_LABEL_PAD = 6;
const BREAK_FONT_SIZE = 13;
/** How far a break tick leans either side of where it crosses the axis. */
const BREAK_TICK_RUN = 3;
/** A break keeps at least this far from any marker's center. */
const BREAK_CLEARANCE = DIAMOND_SIZE / 2 + 7;
/** Each doubling of the time a break leaves out adds this share of a break. */
const BREAK_GROWTH = 0.5;
/** The longest break draws at most this multiple of the shortest. */
const MAX_BREAK_RATIO = 2;
/** A gap with this multiple of another's time draws at least VISIBLE_STEP longer. */
const VISIBLE_RATIO = 1.5;
const VISIBLE_STEP = 12;
/** A wrapped row ends at least this far past its last marker. */
const ROW_TAIL = MIN_MARKER_GAP / 2;
const LANE_GAP = 28;
const ROW_GAP = 48;
const HEADER_GAP = 18;
const TODAY_LABEL_GAP = 6;
/** How much farther out a stacked bar's label may sit to stay on its own side. */
const STACKED_LABEL_BIAS = 120;
const TARGET_ASPECT = 2;
const ROW_PENALTY = 0.3;
/** A single row wider than this breaks its widest gaps, or wraps. */
const MAX_ASPECT = 3.5;
/** Hosted PNGs frame the drawing this tightly, so the cap is measured there. */
const EXPORT_PADDING = 20;

const MUTED_INK = "#4c4639";
const STEM_COLOR = "#b9ad95";
const TODAY_COLOR = "#c0392b";
/** Track colors: the diagram accent, then the theme's blueprint, ok and warn hues. */
const LANE_TONES = [
	{ stroke: "", ink: "#6a4e5c", wash: "#efe6ec" },
	{ stroke: "#1f44c9", ink: "#1a39a8", wash: "#e6eafb" },
	{ stroke: "#1c7a4d", ink: "#15613c", wash: "#def0e5" },
	{ stroke: "#9a6a1f", ink: "#7a5216", wash: "#f6e8cf" },
] as const;

interface TextPart {
	readonly id: string;
	readonly text: string;
	readonly fontSize: number;
	readonly color: string;
	readonly width: number;
	readonly height: number;
}

interface Item {
	readonly event: TimelineEvent;
	readonly index: number;
	readonly lane: number;
	readonly span: boolean;
	readonly startKey: number;
	readonly endKey: number;
	/** Where the label's stem meets the axis: the point itself, or a phase's midpoint. */
	readonly stemKey: number;
	/** How far the stem stays inside the label's edges, so the date stays over its marker. */
	readonly inset: number;
	readonly parts: readonly TextPart[];
	readonly width: number;
	readonly height: number;
}

interface Anchor {
	readonly time: number;
	readonly tie: number;
}

interface Placement {
	readonly item: Item;
	readonly stemX: number;
	readonly side: -1 | 1;
	/** Distance from the axis to the label's near edge. */
	readonly near: number;
	readonly left: number;
	/** Where the stem leaves the marker or bar, measured from the axis. */
	readonly stemStart: number;
	readonly track: number;
}

interface Spacing {
	/** Each anchor's position on the unwrapped axis. */
	readonly x: readonly number[];
	/** Gaps drawn as axis breaks, by the anchor they follow. */
	readonly breaks: ReadonlySet<number>;
}

interface Row {
	readonly first: number;
	readonly last: number;
	/** Where the row's solid axis starts and ends, on the unwrapped axis. */
	readonly start: number;
	readonly end: number;
}

/** Where a row may end inside the gap after anchor `key`. */
interface Cut {
	readonly key: number;
	readonly low: number;
	readonly high: number;
	/** A cut in a broken gap ends the row past the whole break. */
	readonly broken: boolean;
}

interface LaneRowLayout {
	readonly placements: readonly Placement[];
	readonly above: number;
	readonly below: number;
	readonly tracks: number;
}

/** Wrap to the narrowest width that keeps the line count, so lines balance. */
function balancedWrap(text: string, fontSize: number): string {
	const lines = (value: string) => value.split("\n").length;
	const wrapped = wrapTextToWidth(text, TEXT_WIDTH, fontSize);
	if (lines(wrapped) === 1) return wrapped;
	let low = fontSize;
	let high = TEXT_WIDTH;
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		if (lines(wrapTextToWidth(text, middle, fontSize)) <= lines(wrapped)) high = middle;
		else low = middle;
	}
	return wrapTextToWidth(text, high, fontSize);
}

function textPart(id: string, text: string, fontSize: number, color: string): TextPart {
	const wrapped = balancedWrap(text, fontSize);
	return {
		id,
		text: wrapped,
		fontSize,
		color,
		width: Math.ceil(
			Math.max(
				estimateTextWidth(wrapped, fontSize),
				boundLabelWidth(wrapped, fontSize, TEXT_WIDTH),
			),
		),
		height: Math.ceil(wrapped.split("\n").length * fontSize * TEXT_LINE_HEIGHT),
	};
}

function median(values: readonly number[]): number {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The middle of the widest stretch of `from`..`to` that no taken moment splits. */
function widestMiddle(from: number, to: number, taken: readonly number[]): number {
	const stops = [from, ...taken.filter((at) => at > from && at < to), to].toSorted((a, b) => a - b);
	let best = { from, to: from };
	for (const [index, at] of stops.slice(1).entries())
		if (at - stops[index]! > best.to - best.from) best = { from: stops[index]!, to: at };
	return (best.from + best.to) / 2;
}

/** Rendered timelines: a time-scaled axis per lane with labels on both sides. */
export function renderTimelineDiagram(diagram: TimelineDiagram): RenderedDiagramScene {
	const input = validateTimelineDiagram(diagram);
	const events = orderedTimelineEvents(input);
	const captions = timelineCaptions(input);
	const laneNames = timelineLanes(input);
	const tones = (laneNames.length ? laneNames : [""]).map((_, lane) => {
		const tone = LANE_TONES[lane % LANE_TONES.length]!;
		return { ...tone, stroke: tone.stroke || input.style.accentColor };
	});
	const dated = events[0]?.date !== undefined;

	// Anchors: every distinct position on the axis. Simultaneous points get
	// their own anchor so neither marker hides the other.
	const anchorKeys: Anchor[] = [];
	const keyOf = (anchor: Anchor) => {
		const found = anchorKeys.findIndex(
			(entry) => entry.time === anchor.time && entry.tie === anchor.tie,
		);
		if (found >= 0) return found;
		anchorKeys.push(anchor);
		return anchorKeys.length - 1;
	};
	const todayDate = input.today === undefined ? undefined : parseTimelineDate(input.today);
	// Simultaneous points on one lane get separate anchors; across lanes they align.
	// Points take the first ties, so a marker sits at its own moment. A phase's
	// label hangs from its midpoint, or from the middle of its widest stretch
	// free of other stems when the midpoint is taken.
	const ties = new Map<string, number>();
	const taken = new Map<string, number[]>();
	const rawItems = [false, true]
		.flatMap((spans) =>
			events.flatMap((event, index) => {
				const span = event.end !== undefined;
				if (span !== spans) return [];
				const start = dated ? parseTimelineDate(event.date!)! : undefined;
				const end = event.end === undefined ? undefined : parseTimelineDate(event.end)!;
				const time = start ? start.start : (event.order ?? index);
				const lane = event.lane ?? "";
				const tieOf = (at: number) => {
					const tieKey = `${lane}\u0000${at}`;
					const tie = ties.get(tieKey) ?? 0;
					ties.set(tieKey, tie + 1);
					taken.set(lane, [...(taken.get(lane) ?? []), at]);
					return tie;
				};
				const midpoint = end ? (time + end.end) / 2 : time;
				// The Today line crosses every tier, so a phase around it hangs its
				// label from the longer side.
				const today = todayDate && end && todayDate.start > time && todayDate.start < end.end;
				const stemTime =
					end && (today || ties.has(`${lane}\u0000${midpoint}`))
						? widestMiddle(time, end.end, [
								...(taken.get(lane) ?? []),
								...(today ? [todayDate.start] : []),
							])
						: midpoint;
				const stem = keyOf({ time: stemTime, tie: tieOf(stemTime) });
				return [
					{
						event,
						index,
						span,
						start: span ? keyOf({ time, tie: 0 }) : stem,
						end: end ? keyOf({ time: end.end, tie: 0 }) : undefined,
						stem,
					},
				];
			}),
		)
		.toSorted((a, b) => a.index - b.index);
	const todayRawKey = todayDate ? keyOf({ time: todayDate.start, tie: 0 }) : undefined;
	const order = anchorKeys
		.map((anchor, key) => ({ anchor, key }))
		.toSorted((a, b) => a.anchor.time - b.anchor.time || a.anchor.tie - b.anchor.tie);
	const rank = new Map(order.map((entry, position) => [entry.key, position]));
	const anchors = order.map((entry) => entry.anchor);

	const items: Item[] = rawItems.map((raw) => {
		const tone = tones[raw.event.lane ? laneNames.indexOf(raw.event.lane) : 0]!;
		const id = `event:${raw.event.id}`;
		const caption = captions.events.get(raw.event.id);
		const parts = [
			...(caption ? [textPart(`date:${id}`, caption, CAPTION_FONT_SIZE, tone.ink)] : []),
			textPart(`label:${id}`, raw.event.label, LABEL_FONT_SIZE, SKETCHI_DIAGRAM_PALETTE.ink),
			...(raw.event.description
				? [textPart(`description:${id}`, raw.event.description, DESCRIPTION_FONT_SIZE, MUTED_INK)]
				: []),
		];
		return {
			event: raw.event,
			index: raw.index,
			lane: raw.event.lane ? laneNames.indexOf(raw.event.lane) : 0,
			span: raw.span,
			startKey: rank.get(raw.start)!,
			endKey: rank.get(raw.end ?? raw.start)!,
			stemKey: rank.get(raw.stem)!,
			inset: Math.max(STEM_INSET, (caption ? parts[0]!.width : 0) / 2 - CAPTION_SLACK),
			parts,
			width: Math.max(...parts.map((part) => part.width)),
			height: parts.reduce((sum, part) => sum + part.height, 0) + PART_GAP * (parts.length - 1),
		};
	});
	const todayKey = todayRawKey === undefined ? undefined : rank.get(todayRawKey);

	// Spacing: one scale for the whole chronology, about one comfortable label
	// pitch per item and raised until same-lane neighbors clear each other. A gap
	// that scale would draw too long becomes a marked axis break that states the
	// time it leaves out; nothing else is drawn off scale.
	const unit = Math.min(
		128,
		Math.max(72, Math.round((median(items.map((item) => item.width)) + BLOCK_GAP_X) / 2 + 8)),
	);
	const breakLength = 1.5 * unit;
	// A phase keeps its true length, so no break falls inside one unless nothing else fits.
	const insideSpan = (key: number) =>
		items.some((item) => item.span && item.startKey <= key && item.endKey > key);
	const gaps = anchors.slice(1).map((anchor, key) => anchor.time - anchors[key]!.time);
	// A break writes its duration on the axis between its two ticks.
	const breakLabels = new Map<number, { readonly text: string; readonly half: number }>();
	const breakLabel = (key: number) => {
		let label = breakLabels.get(key);
		if (!label) {
			const text = timelineDurationCaption(gaps[key]!);
			label = {
				text,
				half: boundLabelWidth(text, BREAK_FONT_SIZE, TEXT_WIDTH) / 2 + BREAK_LABEL_PAD,
			};
			breakLabels.set(key, label);
		}
		return label;
	};
	/** Free axis a break needs between the markers either side of it. */
	const breakRoom = (key: number) => 2 * (breakLabel(key).half + BREAK_TICK_RUN + BREAK_CLEARANCE);
	// Moments the reader measures between: event dates and phase ends on any
	// lane, each at its first anchor. Today, phase stems and fanned-out ties fall
	// inside these gaps.
	const momentKeys = [
		...new Set(
			items
				.flatMap((item) => [item.startKey, item.endKey])
				.map((key) => anchors.findIndex((anchor) => anchor.time === anchors[key]!.time)),
		),
	].toSorted((a, b) => a - b);
	// `forced` gaps break even when the scale could draw them.
	const space = (forced: ReadonlySet<number>): Spacing => {
		const breaks = new Set(forced);
		if (!dated) return { x: anchors.map((_, key) => key * unit), breaks };
		if (anchors.length < 2) return { x: anchors.map(() => 0), breaks };
		const total = gaps.reduce((sum, gap) => sum + gap, 0);
		const target = items.length * unit;
		const maxGap = 10 * unit;
		const comfortable = total > 0 ? target / total : 0;
		// Minimum distances: stems on a lane stay apart, bars stay visible. A stem
		// sits farther from the previous one than the next label's inset, so that
		// label always fits flagged rightward without covering an earlier stem.
		const constraints = [
			...tones.flatMap((_, lane) =>
				items
					.filter((item) => item.lane === lane)
					.toSorted((a, b) => a.stemKey - b.stemKey)
					.flatMap((item, position, laneItems) => {
						const previous = laneItems[position - 1];
						return previous && previous.stemKey !== item.stemKey
							? [
									{
										from: previous.stemKey,
										to: item.stemKey,
										min: Math.max(MIN_MARKER_GAP, item.inset + STEM_CLEARANCE + 1),
									},
								]
							: [];
					}),
			),
			...items
				.filter((item) => item.span)
				// A marker may touch a bar's end, as a marker inside a bar sits on it.
				.map((item) => ({ from: item.startKey, to: item.endKey, min: MIN_BAR_WIDTH })),
		].filter((constraint) => constraint.to > constraint.from);
		// Simultaneous events fan out right of their true position, so the next
		// moment is still measured from where this one really falls. A break
		// starts past every earlier marker on any lane, so all of them stay on
		// its near side.
		const tieStep = Math.max(MIN_MARKER_GAP, ...constraints.map((constraint) => constraint.min));
		// While the scale settles, every break is one break length past the
		// farthest earlier marker. `lengths` then sets each one's final length,
		// measured from its own moment.
		const place = (scale: number, lengths?: ReadonlyMap<number, number>) => {
			const placed = [0];
			let moment = 0;
			let reach = 0;
			gaps.forEach((gap, key) => {
				const anchor = anchors[key + 1]!;
				if (anchor.tie > 0) placed.push(moment + anchor.tie * tieStep);
				else {
					moment = !breaks.has(key)
						? moment + gap * scale
						: lengths
							? Math.max(moment + lengths.get(key)!, reach + Math.max(breakLength, breakRoom(key)))
							: reach + breakLength;
					placed.push(moment);
				}
				reach = Math.max(reach, placed[key + 1]!);
			});
			return placed;
		};
		// Distances are affine in the scale, so each constraint sets a minimum scale.
		const distances = () => {
			const [at0, at1] = [place(0), place(1)];
			return constraints.map(({ from, to, min }) => {
				const fixed = at0[to]! - at0[from]!;
				return { from, to, min, fixed, perScale: at1[to]! - at0[to]! - (at1[from]! - at0[from]!) };
			});
		};
		// A phase cannot break, so its bar stops growing at twice an outsized gap.
		// Past that, neighbors too close to draw get a break between them.
		const longestSpan = Math.max(
			0,
			...items
				.filter((item) => item.span)
				.map((item) => anchors[item.endKey]!.time - anchors[item.startKey]!.time),
		);
		const maxScale = longestSpan > 0 ? Math.max(comfortable, (2 * maxGap) / longestSpan) : Infinity;
		let scale = comfortable;
		for (;;) {
			const kept = gaps.reduce((sum, gap, key) => sum + (breaks.has(key) ? 0 : gap), 0);
			const relaxed =
				breaks.size && kept > 0
					? Math.min(
							comfortable * 2,
							Math.max(comfortable, (target - breaks.size * breakLength) / kept),
						)
					: comfortable;
			const measured = distances();
			const needed = Math.max(
				relaxed,
				...measured.map(({ min, fixed, perScale }) =>
					perScale > 0 && fixed < min ? (min - fixed) / perScale : 0,
				),
			);
			scale = Math.min(needed, maxScale);
			// Once anything breaks, so does every gap a break would shorten by at
			// least its own length. Breaks then draw longer than any unbroken gap.
			const longest = breaks.size ? 2 * breakLength : maxGap;
			const added = gaps.flatMap((gap, key) =>
				!breaks.has(key) && gap * scale > longest && !insideSpan(key) ? [key] : [],
			);
			// A neighbor still too close gets a break on the longest gap between
			// them instead of a silent stretch.
			for (const { from, to, min, fixed, perScale } of measured)
				if (fixed + perScale * scale < min - 1e-6) {
					const range = gaps
						.map((gap, key) => ({ gap, key }))
						.slice(from, to)
						.filter(({ gap, key }) => gap > 0 && !breaks.has(key));
					const widest = range.toSorted((a, b) => b.gap - a.gap || a.key - b.key)[0];
					if (widest) added.push(widest.key);
				}
			if (!added.length) break;
			for (const key of added) breaks.add(key);
		}
		if (!breaks.size) return { x: place(scale), breaks };
		// Breaks draw on a log scale from the shortest gap a break compresses,
		// which draws as long as the longest unbroken gap, or one break length.
		// Each doubling of the time left out adds half that, and the longest
		// break draws at most twice the shortest. A break that only makes
		// room for crowded neighbors draws the base length.
		const base = Math.max(
			breakLength,
			...gaps.map((gap, key) => (breaks.has(key) || insideSpan(key) ? 0 : gap * scale)),
		);
		const compressed = [...breaks].filter((key) => gaps[key]! * scale >= breakLength);
		const shortest = Math.min(...compressed.map((key) => gaps[key]!));
		const doublings = Math.log2(Math.max(...compressed.map((key) => gaps[key]!)) / shortest);
		const growth = Math.min(
			BREAK_GROWTH,
			doublings > 0 ? (MAX_BREAK_RATIO - 1) / doublings : Infinity,
		);
		const lengths = new Map(
			[...breaks].map((key) => [
				key,
				base * (1 + growth * Math.log2(Math.max(1, gaps[key]! / shortest))),
			]),
		);
		// Then the gaps between moments are put in elapsed order: a gap with a
		// compressing break grows to the longest gap with less time in it, and
		// draws visibly longer than any with a third less. It shrinks the same
		// way below unbroken gaps with more time, as far as its break has room.
		// A gap stretched for crowded neighbors draws longer than its time at
		// scale, so it stays out of the order and its label says how short it is.
		let x = place(scale, lengths);
		const compressing = new Set(compressed);
		const segments = momentKeys.slice(1).flatMap((to, index) => {
			const from = momentKeys[index]!;
			const keys = gaps.slice(from, to).map((_, offset) => from + offset);
			const broken = keys.filter((key) => compressing.has(key)).at(-1);
			if (broken === undefined && keys.some((key) => breaks.has(key))) return [];
			return [{ from, to, elapsed: anchors[to]!.time - anchors[from]!.time, broken }];
		});
		const drawn = (segment: (typeof segments)[number]) => x[segment.to]! - x[segment.from]!;
		for (const segment of segments.toSorted((a, b) => a.elapsed - b.elapsed)) {
			if (segment.broken === undefined) continue;
			const { elapsed } = segment;
			const floor = Math.max(
				...segments.map((other) =>
					other.elapsed * VISIBLE_RATIO <= elapsed
						? drawn(other) + VISIBLE_STEP
						: other.elapsed < elapsed
							? drawn(other)
							: 0,
				),
			);
			const ceiling = Math.min(
				...segments.map((other) =>
					other.broken !== undefined
						? Infinity
						: other.elapsed >= elapsed * VISIBLE_RATIO
							? drawn(other) - VISIBLE_STEP
							: other.elapsed > elapsed
								? drawn(other)
								: Infinity,
				),
			);
			const target = Math.min(Math.max(drawn(segment), floor), ceiling);
			if (Math.abs(target - drawn(segment)) < 1e-9) continue;
			const key = segment.broken;
			const moment = anchors.findIndex((anchor) => anchor.time === anchors[key]!.time);
			lengths.set(key, x[key + 1]! - x[moment]! + target - drawn(segment));
			x = place(scale, lengths);
		}
		return { x, breaks };
	};

	// Rows wrap one continuous axis like lines of text. A row may end anywhere in
	// a gap that no span crosses, and the next row resumes at that same moment,
	// so the gap's length is split across the two rows and keeps its drawn
	// length. A row that ends in a break shows the whole break, with its
	// duration, before its dashed arrow. Cuts prefer breaks, then wide gaps.
	const axisPlan = ({ x, breaks }: Spacing) => {
		const reachBefore = x.map((_, key) => Math.max(...x.slice(0, key + 1)));
		const reachAfter = x.map((_, key) => Math.min(...x.slice(key)));
		// A break sits midway between the farthest earlier marker and the next one.
		const breakX = (key: number) => (reachBefore[key]! + x[key + 1]!) / 2;
		const cuts = anchors.slice(0, -1).flatMap((_, key): Cut[] => {
			if (insideSpan(key)) return [];
			const high = reachAfter[key + 1]! - ROW_TAIL;
			if (breaks.has(key)) {
				const low = breakX(key) + breakLabel(key).half + BREAK_TICK_RUN + ROW_TAIL / 2;
				return [{ key, low, high: Math.max(low, high), broken: true }];
			}
			const low = reachBefore[key]! + ROW_TAIL;
			return low <= high ? [{ key, low, high, broken: false }] : [];
		});
		const rowsFor = (count: number): Row[] => {
			const length = x[x.length - 1]!;
			const rows: Row[] = [];
			let first = 0;
			let start = -AXIS_OVERHANG;
			for (let row = 1; row < count; row += 1) {
				const ideal = (length * row) / count;
				const choice = cuts
					.filter((cut) => cut.key >= first)
					.map((cut) => {
						const at = Math.min(cut.high, Math.max(cut.low, ideal));
						return {
							cut,
							at,
							cost:
								Math.abs(at - ideal) -
								(cut.broken ? unit : 0) -
								Math.min(cut.high - cut.low, 2 * unit) / 4,
						};
					})
					.toSorted((a, b) => a.cost - b.cost || a.cut.key - b.cut.key)[0];
				if (!choice) break;
				rows.push({ first, last: choice.cut.key, start, end: choice.at });
				first = choice.cut.key + 1;
				start = choice.at;
			}
			rows.push({ first, last: anchors.length - 1, start, end: Math.max(...x) + AXIS_OVERHANG });
			return rows;
		};

		// A marker dated outside a phase but drawn over its bar would read as part of
		// it. Then every phase on that lane moves to a track below the axis, so the
		// lane's bars stay together and no date moves. A marker dated inside its own
		// phase may sit on the bar.
		const belowAxis = new Set(
			items.flatMap((bar) => {
				if (!bar.span) return [];
				const right = x[bar.startKey]! + Math.max(MIN_BAR_WIDTH, x[bar.endKey]! - x[bar.startKey]!);
				return items.some(
					(point) =>
						!point.span &&
						point.lane === bar.lane &&
						(point.startKey < bar.startKey || point.startKey >= bar.endKey) &&
						x[point.startKey]! + markerHalf(point) > x[bar.startKey]! &&
						x[point.startKey]! - markerHalf(point) < right,
				)
					? [bar.lane]
					: [];
			}),
		);
		const layout = (rows: readonly Row[], labelBase = LABEL_BASE) => {
			const laneCount = Math.max(1, laneNames.length);
			const rowLayouts = rows.map((row, rowIndex) => {
				const offset = row.start - (rowIndex > 0 ? CONTINUATION_LENGTH : 0);
				const localX = (key: number) => x[key]! - offset;
				const todayX =
					todayKey !== undefined && todayKey >= row.first && todayKey <= row.last
						? localX(todayKey)
						: undefined;
				const lanes = Array.from({ length: laneCount }, (_, lane) =>
					placeLane(
						items.filter(
							(item) =>
								item.lane === lane && item.startKey >= row.first && item.startKey <= row.last,
						),
						localX,
						todayX,
						belowAxis.has(lane) ? 1 : 0,
						labelBase,
					),
				);
				return {
					row,
					localX,
					breakX: (key: number) => breakX(key) - offset,
					todayX,
					lanes,
					axisStart: row.start - offset,
					axisEnd: row.end - offset,
				};
			});
			return rowLayouts;
		};
		return { x, breaks, reachBefore, rowsFor, layout };
	};
	type AxisPlan = ReturnType<typeof axisPlan>;
	type RowLayouts = ReturnType<AxisPlan["layout"]>;

	const laneLabelWidth = laneNames.length
		? Math.max(...laneNames.map((name) => boundLabelWidth(name, LANE_FONT_SIZE, 160))) + 20
		: 0;
	const header = captions.header;
	const todayCaption = captions.today;

	const compose = (breaks: ReadonlySet<number>, rowLayouts: RowLayouts) => {
		const elements: SceneElement[] = [];
		const back: string[] = [];
		const middle: string[] = [];
		const front: string[] = [];
		const push = (element: SceneElement, layer: string[]) => {
			elements.push(element);
			layer.push(element.id);
		};
		const line = (
			id: string,
			points: LineSceneElement["points"],
			extra: Partial<LineSceneElement> = {},
		): LineSceneElement => ({ type: "line", id, points, ...extra });
		const text = (
			id: string,
			value: string,
			centerX: number,
			centerY: number,
			fontSize: number,
			color: string,
			extra: Partial<TextSceneElement> = {},
		): TextSceneElement => ({
			type: "text",
			id,
			x: centerX,
			y: centerY,
			text: value,
			fontSize,
			maxWidth: TEXT_WIDTH,
			textColor: color,
			...extra,
		});
		const headerHeight = header ? Math.ceil(HEADER_FONT_SIZE * TEXT_LINE_HEIGHT) : 0;
		const todayHeight = todayCaption ? Math.ceil(13 * TEXT_LINE_HEIGHT) : 0;
		let y = header ? headerHeight + HEADER_GAP : 0;
		const left = laneLabelWidth;
		rowLayouts.forEach((rowLayout, rowIndex) => {
			const rowTop = y;
			const hasToday = rowLayout.todayX !== undefined;
			if (hasToday) y += todayHeight + TODAY_LABEL_GAP;
			const continued = rowIndex < rowLayouts.length - 1;
			const resumed = rowIndex > 0;
			rowLayout.lanes.forEach((lane, laneIndex) => {
				const tone = tones[laneIndex]!;
				const axisY = y + lane.above;
				const suffix = `${laneIndex}:${rowIndex}`;
				// Long rough strokes double up; structural lines draw clean.
				const stroke = { strokeColor: tone.stroke, strokeWidth: 2 as const, roughness: 0 as const };
				// Axis segments between breaks, then break ticks around each break's
				// duration, and row continuations. A row that ends in a break draws all
				// of it before the continuation.
				const rowBreaks = [...breaks]
					.toSorted((a, b) => a - b)
					.filter((key) => key >= rowLayout.row.first && key <= rowLayout.row.last)
					.map((key) => ({ x: left + rowLayout.breakX(key), ...breakLabel(key) }));
				const stops = [
					left + rowLayout.axisStart,
					...rowBreaks.flatMap((entry) => [entry.x - entry.half, entry.x + entry.half]),
					left + rowLayout.axisEnd,
				];
				for (let segment = 0; segment < stops.length; segment += 2)
					if (stops[segment + 1]! > stops[segment]!)
						push(
							line(
								`axis:${suffix}${segment ? `:${segment / 2}` : ""}`,
								[
									{ x: stops[segment]!, y: axisY },
									{ x: stops[segment + 1]!, y: axisY },
								],
								stroke,
							),
							back,
						);
				rowBreaks.forEach((entry, index) => {
					for (const side of [-1, 1])
						push(
							line(
								`break:${suffix}:${index}:${side < 0 ? "a" : "b"}`,
								[
									{ x: entry.x + side * entry.half - BREAK_TICK_RUN, y: axisY + 7 },
									{ x: entry.x + side * entry.half + BREAK_TICK_RUN, y: axisY - 7 },
								],
								stroke,
							),
							front,
						);
					push(
						text(
							`break-label:${suffix}:${index}`,
							entry.text,
							entry.x,
							axisY,
							BREAK_FONT_SIZE,
							tone.ink,
						),
						front,
					);
				});
				if (resumed)
					push(
						line(
							`continue-in:${suffix}`,
							[
								{ x: left, y: axisY },
								{ x: left + CONTINUATION_LENGTH, y: axisY },
							],
							{ ...stroke, strokeStyle: "dashed" },
						),
						back,
					);
				if (continued)
					push(
						line(
							`continue-out:${suffix}`,
							[
								{ x: left + rowLayout.axisEnd, y: axisY },
								{ x: left + rowLayout.axisEnd + CONTINUATION_LENGTH, y: axisY },
							],
							{ ...stroke, strokeStyle: "dashed", endArrowhead: "arrow" },
						),
						back,
					);
				if (laneNames.length)
					push(
						text(
							`lane:${suffix}`,
							laneNames[laneIndex]!,
							left - 16 - boundLabelWidth(laneNames[laneIndex]!, LANE_FONT_SIZE, 160) / 2,
							axisY,
							LANE_FONT_SIZE,
							tone.ink,
							{ maxWidth: 160, textAlign: "right" },
						),
						front,
					);
				for (const placement of lane.placements) {
					const { item } = placement;
					const id = `event:${item.event.id}`;
					const group = { groupIds: [id] };
					const trackY = axisY + placement.track * (BAR_HEIGHT + BAR_TRACK_GAP);
					const stemX = left + placement.stemX;
					if (item.span) {
						const startX = left + rowLayout.localX(item.startKey);
						const endX = left + rowLayout.localX(item.endKey);
						push(
							{
								type: "node",
								id: `node:${id}`,
								nodeId: id,
								rendererRole: TIMELINE_MARKER_ROLE,
								shape: "rectangle",
								x: startX,
								y: trackY - BAR_HEIGHT / 2,
								width: Math.max(MIN_BAR_WIDTH, endX - startX),
								height: BAR_HEIGHT,
								label: item.event.label,
								fillColor: tone.wash,
								strokeColor: tone.stroke,
								...group,
							} satisfies NodeSceneElement,
							middle,
						);
					} else {
						const milestone = item.event.kind === "milestone";
						const size = milestone ? DIAMOND_SIZE : DOT_SIZE;
						push(
							{
								type: "node",
								id: `node:${id}`,
								nodeId: id,
								rendererRole: TIMELINE_MARKER_ROLE,
								shape: milestone ? "diamond" : "ellipse",
								x: stemX - size / 2,
								y: axisY - size / 2,
								width: size,
								height: size,
								label: item.event.label,
								fillColor: tone.stroke,
								strokeColor: tone.stroke,
								...group,
							} satisfies NodeSceneElement,
							front,
						);
					}
					const nearY = axisY + placement.side * placement.near;
					push(
						line(
							`stem:${id}`,
							[
								{ x: stemX, y: axisY + placement.side * placement.stemStart },
								{ x: stemX, y: nearY },
							],
							{ strokeColor: STEM_COLOR, strokeWidth: 1, roughness: 0, ...group },
						),
						back,
					);
					const blockLeft = left + placement.left;
					let cursor = placement.side < 0 ? nearY - item.height : nearY;
					// Each line centers over the stem as far as its block allows, which
					// keeps the date over its own marker in a dense cluster.
					for (const part of item.parts) {
						const partWidth = boundLabelWidth(part.text, part.fontSize, TEXT_WIDTH);
						const centerX = Math.min(
							Math.max(stemX, blockLeft + partWidth / 2),
							blockLeft + item.width - partWidth / 2,
						);
						const align = centerX === stemX ? "center" : centerX < stemX ? "right" : "left";
						push(
							text(
								part.id,
								part.text,
								centerX,
								cursor + part.height / 2,
								part.fontSize,
								part.color,
								{
									textAlign: align,
									...group,
								},
							),
							front,
						);
						cursor += part.height + PART_GAP;
					}
				}
				y = axisY + lane.below + (laneIndex < rowLayout.lanes.length - 1 ? LANE_GAP : 0);
			});
			if (hasToday) {
				const todayX = left + rowLayout.todayX!;
				push(
					line(
						`today:${rowIndex}`,
						[
							{ x: todayX, y: rowTop + todayHeight + TODAY_LABEL_GAP / 2 },
							{ x: todayX, y },
						],
						{ strokeColor: TODAY_COLOR, strokeWidth: 1, strokeStyle: "dashed", roughness: 0 },
					),
					back,
				);
				push(
					text(
						`today-label:${rowIndex}`,
						todayCaption!,
						todayX,
						rowTop + todayHeight / 2,
						13,
						TODAY_COLOR,
					),
					front,
				);
			}
			y += ROW_GAP;
		});
		y -= ROW_GAP;
		if (header)
			push(
				text(
					"header",
					header,
					boundLabelWidth(header, HEADER_FONT_SIZE, 400) / 2,
					headerHeight / 2,
					HEADER_FONT_SIZE,
					MUTED_INK,
					{ maxWidth: 400, textAlign: "left" },
				),
				front,
			);
		return { elements, zOrder: [...back, ...middle, ...front], height: y };
	};

	const bounds = (elements: readonly SceneElement[]) => {
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		const include = (x0: number, y0: number, x1: number, y1: number) => {
			minX = Math.min(minX, x0);
			maxX = Math.max(maxX, x1);
			minY = Math.min(minY, y0);
			maxY = Math.max(maxY, y1);
		};
		for (const element of elements) {
			if (element.type === "line" || element.type === "arrow")
				for (const point of element.points) include(point.x, point.y, point.x, point.y);
			else if (element.type === "text") {
				const width = boundLabelWidth(
					element.text,
					element.fontSize,
					element.maxWidth ?? TEXT_WIDTH,
				);
				const height = element.text.split("\n").length * element.fontSize * TEXT_LINE_HEIGHT;
				include(
					element.x - width / 2,
					element.y - height / 2,
					element.x + width / 2,
					element.y + height / 2,
				);
			} else if (element.type === "node" || element.type === "frame")
				include(element.x, element.y, element.x + element.width, element.y + element.height);
		}
		return { minX, maxX, minY, maxY };
	};

	type Arrangement = NonNullable<ReturnType<typeof arrange>>;
	const arrange = (plan: AxisPlan, count: number, labelBase = LABEL_BASE) => {
		const rows = plan.rowsFor(count);
		if (rows.length < count) return undefined;
		const rowLayouts = plan.layout(rows, labelBase);
		const composed = compose(plan.breaks, rowLayouts);
		const box = bounds(composed.elements);
		const aspect = (box.maxX - box.minX + PADDING * 2) / (box.maxY - box.minY + PADDING * 2);
		const score = Math.abs(Math.log(aspect / TARGET_ASPECT)) + ROW_PENALTY * (count - 1);
		// Lane sides holding a label, each of which a longer stem moves out.
		const labeled = rowLayouts
			.flatMap(({ lanes }) => lanes)
			.reduce(
				(sum, { placements }) =>
					sum +
					(placements.some(({ side }) => side < 0) ? 1 : 0) +
					(placements.some(({ side }) => side > 0) ? 1 : 0),
				0,
			);
		return { count, composed, box, score, labeled };
	};
	const closest = (options: readonly Arrangement[]) =>
		options.reduce<Arrangement | undefined>(
			(best, option) => (!best || option.score < best.score - 1e-9 ? option : best),
			undefined,
		);
	const exportAspect = ({ box }: Arrangement) =>
		(box.maxX - box.minX + EXPORT_PADDING * 2) / (box.maxY - box.minY + EXPORT_PADDING * 2);
	// The widest gap on the axis that a break would shorten by at least its own length.
	const compressible = ({ x, breaks, reachBefore }: AxisPlan) =>
		gaps
			.map((gap, key) => ({ gap, key, free: x[key + 1]! - reachBefore[key]! }))
			.filter(
				({ gap, key, free }) =>
					gap > 0 && !breaks.has(key) && !insideSpan(key) && free >= 2 * breakLength,
			)
			.toSorted((a, b) => b.free - a.free || a.key - b.key)[0];

	// Wrap into the row count whose aspect is closest to the target.
	const maxRows = Math.max(1, Math.min(12, Math.ceil(items.length / 2)));
	const natural = axisPlan(space(new Set()));
	const arrangements: Arrangement[] = [];
	for (let count = 1; count <= maxRows; count += 1) {
		const arrangement = arrange(natural, count);
		if (!arrangement) break;
		arrangements.push(arrangement);
	}
	let best = closest(arrangements)!;
	// A single row past the cap breaks its widest gaps first, one at a time, so
	// each continuous stretch stays to scale. If that can't fit, it wraps.
	let plan = natural;
	if (dated && best.count === 1 && exportAspect(best) > MAX_ASPECT) {
		const forced = new Set<number>();
		let single = best;
		for (
			let widest = compressible(plan);
			widest && exportAspect(single) > MAX_ASPECT;
			widest = compressible(plan)
		) {
			forced.add(widest.key);
			plan = axisPlan(space(forced));
			single = arrange(plan, 1)!;
		}
		// With no wrap to fall back on, the broken row is still the narrowest.
		best = exportAspect(single) <= MAX_ASPECT ? single : (closest(arrangements.slice(1)) ?? single);
		if (best !== single) plan = natural;
	}
	// A single row still too wide stands its labels farther out on longer stems:
	// the fewest LABEL_BASE_STEP steps, up to MAX_LABEL_BASE, that bring it within
	// STEM_ASPECT, or all of them. Each step moves every label out by the step,
	// so the row grows by the step on each labeled lane side: that predicts the
	// count, and its neighbor confirms it, without laying out every step.
	if (best.count === 1 && exportAspect(best) > STEM_ASPECT) {
		const steps = Math.floor((MAX_LABEL_BASE - LABEL_BASE) / LABEL_BASE_STEP);
		const stepped = new Map<number, Arrangement>([[0, best]]);
		const at = (step: number) => {
			const known = stepped.get(step);
			if (known) return known;
			const arrangement = arrange(plan, 1, LABEL_BASE + step * LABEL_BASE_STEP)!;
			stepped.set(step, arrangement);
			return arrangement;
		};
		const fits = (step: number) => exportAspect(at(step)) <= STEM_ASPECT;
		const height = ({ box }: Arrangement) => box.maxY - box.minY;
		const width = best.box.maxX - best.box.minX;
		const growth = LABEL_BASE_STEP * best.labeled;
		const needed = (width + 2 * EXPORT_PADDING) / STEM_ASPECT - 2 * EXPORT_PADDING - height(best);
		let step = growth > 0 ? Math.min(steps, Math.max(1, Math.ceil(needed / growth))) : steps;
		if (fits(step)) while (step > 1 && fits(step - 1)) step -= 1;
		else while (step < steps && !fits(step)) step += 1;
		best = at(step);
	}
	const { composed, box } = best;
	const dx = PADDING - box.minX;
	const dy = PADDING - box.minY;
	const elements = composed.elements.map((element): SceneElement => {
		if (element.type === "line" || element.type === "arrow") {
			const [first, ...rest] = element.points.map((point) => ({
				x: point.x + dx,
				y: point.y + dy,
			}));
			return element.type === "line"
				? { ...element, points: [first!, rest[0]!, ...rest.slice(1)] }
				: { ...element, points: [first!, ...rest] };
		}
		return { ...element, x: element.x + dx, y: element.y + dy };
	});
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: input.id,
		title: input.title,
		width: Math.ceil(box.maxX - box.minX + PADDING * 2),
		height: Math.ceil(box.maxY - box.minY + PADDING * 2),
		accentColor: input.style.accentColor,
		backgroundColor: input.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder: composed.zOrder,
	};
}

interface Block {
	readonly left: number;
	readonly right: number;
	readonly near: number;
	readonly far: number;
}

interface PlacementStrategy {
	/** Leave the label two steps left room at the axis. */
	readonly lookahead: boolean;
	/** Cost, in pixels of shift, of covering an earlier stem beyond the adjacent one. */
	readonly coverPenalty: number;
}

const PLACEMENT_STRATEGIES: readonly PlacementStrategy[] = [
	{ lookahead: true, coverPenalty: 0 },
	{ lookahead: true, coverPenalty: 80 },
	{ lookahead: false, coverPenalty: 0 },
	{ lookahead: false, coverPenalty: 240 },
];

function markerHalf(item: Item): number {
	return item.span
		? BAR_HEIGHT / 2
		: (item.event.kind === "milestone" ? DIAMOND_SIZE : DOT_SIZE) / 2;
}

/** The shallowest of a few deterministic greedy placements. */
function placeLane(
	items: readonly Item[],
	localX: (key: number) => number,
	todayX: number | undefined,
	lowest: number,
	labelBase = LABEL_BASE,
): LaneRowLayout {
	let best: LaneRowLayout | undefined;
	for (const strategy of PLACEMENT_STRATEGIES) {
		const layout = placeLaneWith(items, localX, todayX, lowest, strategy, labelBase);
		if (!best || layout.above + layout.below < best.above + best.below) best = layout;
	}
	return best!;
}

/**
 * Place one lane's labels right to left. A label must contain its stem, never
 * cover a placed stem, and never sit behind another label from the axis. It
 * may cover a stem still to be placed only while the other side stays clear
 * of that stem, so every later label can still succeed by moving farther out.
 */
function placeLaneWith(
	items: readonly Item[],
	localX: (key: number) => number,
	todayX: number | undefined,
	lowest: number,
	strategy: PlacementStrategy,
	labelBase = LABEL_BASE,
): LaneRowLayout {
	// Overlapping spans stack into tracks below the axis line, from `lowest` down.
	const trackEnds: number[] = [];
	const trackOf = new Map<Item, number>();
	for (const item of items
		.filter((entry) => entry.span)
		.toSorted((a, b) => a.startKey - b.startKey)) {
		let track = trackEnds.findIndex((end, index) => index >= lowest && end <= item.startKey);
		if (track < 0) track = Math.max(lowest, trackEnds.length);
		while (trackEnds.length < track) trackEnds.push(-Infinity);
		trackEnds[track] = item.endKey;
		trackOf.set(item, track);
	}
	const tracks = trackEnds.length;
	const belowBase = labelBase + Math.max(0, tracks - 1) * (BAR_HEIGHT + BAR_TRACK_GAP);
	const stemOf = (item: Item) => localX(item.stemKey);
	const sorted = items.toSorted((a, b) => stemOf(b) - stemOf(a) || b.index - a.index);
	const blocks: Record<"-1" | "1", Block[]> = { "-1": [], "1": [] };
	const stems: Record<"-1" | "1", { x: number; reach: number }[]> = { "-1": [], "1": [] };
	const placements: Placement[] = [];
	const covers = (block: { left: number; right: number }, x: number, clearance = STEM_CLEARANCE) =>
		x > block.left - clearance && x < block.right + clearance;
	let preferred: -1 | 1 = -1;
	sorted.forEach((item, position) => {
		const stemX = stemOf(item);
		const pending = sorted.slice(position + 1).map(stemOf);
		// The label two steps left will likely share this side: leave it room at
		// the axis when possible, and prefer to share any shift from center.
		const twoBack = strategy.lookahead ? sorted[position + 2] : undefined;
		const roomCost = (left: number, near: number, base: number) => {
			if (!twoBack || near > base) return 0;
			const twoBackStem = stemOf(twoBack);
			if (twoBackStem + STEM_INSET + BLOCK_GAP_X > left) return 1000;
			return Math.max(0, twoBackStem + twoBack.width / 2 + BLOCK_GAP_X - left) / 2;
		};
		const lowest = stemX - item.width + item.inset;
		const highest = stemX - item.inset;
		const options = (side: -1 | 1, honorToday: boolean) => {
			const base = side < 0 ? labelBase : belowBase;
			const placed = blocks[side];
			const opposite = blocks[-side as -1 | 1];
			const placedStems = [
				...stems[side],
				...(honorToday && todayX !== undefined && Math.abs(todayX - stemX) >= MIN_MARKER_GAP / 2
					? [{ x: todayX, reach: Infinity }]
					: []),
			];
			const nears = [base, ...placed.map((block) => block.far + BLOCK_GAP_Y)]
				.filter((near) => near >= base)
				.toSorted((a, b) => a - b);
			const centered = stemX - item.width / 2;
			const lefts = [
				centered,
				lowest,
				highest,
				...placed.flatMap((block) => [
					block.right + BLOCK_GAP_X,
					block.left - BLOCK_GAP_X - item.width,
				]),
				...[...placedStems, ...pending.map((x) => ({ x, reach: 0 }))].flatMap((stem) => {
					const clearance = stem.reach === Infinity ? 3 * STEM_CLEARANCE : STEM_CLEARANCE;
					return [stem.x + clearance, stem.x - clearance - item.width];
				}),
				...(twoBack
					? [
							stemOf(twoBack) + STEM_INSET + BLOCK_GAP_X,
							stemOf(twoBack) + twoBack.width / 2 + BLOCK_GAP_X,
						]
					: []),
			].map((candidate) => Math.min(highest, Math.max(lowest, candidate)));
			for (const near of nears) {
				const far = near + item.height;
				const cost = (left: number) =>
					Math.abs(left - centered) +
					roomCost(left, near, base) +
					strategy.coverPenalty *
						pending.slice(1).filter((x) => covers({ left, right: left + item.width }, x)).length;
				for (const left of lefts.toSorted((a, b) => cost(a) - cost(b) || a - b)) {
					const right = left + item.width;
					const box = { left, right };
					const clear =
						placed.every(
							(block) =>
								left >= block.right + BLOCK_GAP_X ||
								block.left >= right + BLOCK_GAP_X ||
								near >= block.far + BLOCK_GAP_Y ||
								block.near >= far + BLOCK_GAP_Y,
						) &&
						placed.every((block) => !covers(block, stemX) || block.near > near) &&
						// The Today line runs through every tier, so labels keep wider clear of it.
						placedStems.every(
							(stem) =>
								!covers(
									box,
									stem.x,
									stem.reach === Infinity ? 3 * STEM_CLEARANCE : STEM_CLEARANCE,
								) || stem.reach <= near,
						) &&
						pending.every((x) => !covers(box, x) || opposite.every((block) => !covers(block, x)));
					if (clear) return { near, left };
				}
			}
			return undefined;
		};
		// A stacked bar sits below the axis; a label above would read as the upper bar's.
		const stacked = (trackOf.get(item) ?? 0) > 0;
		const favored = stacked ? 1 : preferred;
		const score = (entry: { side: -1 | 1; option: { near: number } }) =>
			entry.option.near - (entry.side === favored ? (stacked ? STACKED_LABEL_BIAS : 1) : 0);
		const choose = (honorToday: boolean) =>
			([favored, -favored as -1 | 1] as const)
				.flatMap((side) => {
					const option = options(side, honorToday);
					return option ? [{ side, option }] : [];
				})
				.toSorted((a, b) => score(a) - score(b))[0];
		// Stem spacing guarantees an option: on a side where no label covers this
		// stem, flagged rightward beyond every placed label. Only Today may yield.
		const chosen = choose(true) ?? choose(false);
		if (!chosen) throw new Error(`Timeline label for "${item.event.id}" has no clear placement.`);
		const { side, option } = chosen;
		const { near, left } = option;
		blocks[side].push({ left, right: left + item.width, near, far: near + item.height });
		stems[side].push({ x: stemX, reach: near });
		const track = trackOf.get(item) ?? 0;
		const trackOffset = track * (BAR_HEIGHT + BAR_TRACK_GAP);
		placements.push({
			item,
			stemX,
			side,
			near,
			left,
			stemStart: side > 0 ? trackOffset + markerHalf(item) : markerHalf(item) - trackOffset,
			track,
		});
		preferred = -side as -1 | 1;
	});
	const extent = (side: -1 | 1, base: number) =>
		Math.max(base, ...blocks[side].map((block) => block.far));
	return {
		placements,
		above: extent(-1, DIAMOND_SIZE / 2 + 6),
		below: extent(1, Math.max(DIAMOND_SIZE / 2, belowBase - labelBase + BAR_HEIGHT / 2) + 6),
		tracks,
	};
}

/** A marker keeps its role only while it still reads as one: a thin shape on its event id. */
export function isStructurallyValidTimelineMarker(element: {
	readonly id: string;
	readonly nodeId: string;
	readonly height: number;
	readonly icon?: unknown;
}): boolean {
	return (
		element.nodeId.startsWith("event:") &&
		element.id === `node:${element.nodeId}` &&
		element.height <= DIAMOND_SIZE &&
		element.icon === undefined
	);
}
