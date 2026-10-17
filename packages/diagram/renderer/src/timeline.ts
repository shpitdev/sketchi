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
import { timelineCaptions } from "./timeline-captions.js";

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
const BREAK_HALF_GAP = 4;
const LANE_GAP = 28;
const ROW_GAP = 48;
const HEADER_GAP = 18;
const TODAY_LABEL_GAP = 6;
const BREAK_RATIO = 6;
/** How much farther out a stacked bar's label may sit to stay on its own side. */
const STACKED_LABEL_BIAS = 120;
const TARGET_ASPECT = 2;
const ROW_PENALTY = 0.3;

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

interface Row {
	readonly first: number;
	readonly last: number;
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
	// Simultaneous points on one lane get separate anchors; across lanes they align.
	const ties = new Map<string, number>();
	const rawItems = events.map((event, index) => {
		const start = dated ? parseTimelineDate(event.date!)! : undefined;
		const end = event.end === undefined ? undefined : parseTimelineDate(event.end)!;
		const time = start ? start.start : (event.order ?? index);
		const span = end !== undefined;
		const tieOf = (at: number) => {
			const tieKey = `${event.lane ?? ""}\u0000${at}`;
			const tie = ties.get(tieKey) ?? 0;
			ties.set(tieKey, tie + 1);
			return tie;
		};
		// A phase's label hangs from its own anchor at the midpoint, spaced like a point.
		const stemTime = end ? (time + end.end) / 2 : time;
		const stem = keyOf({ time: stemTime, tie: tieOf(stemTime) });
		return {
			event,
			index,
			span,
			start: span ? keyOf({ time, tie: 0 }) : stem,
			end: end ? keyOf({ time: end.end, tie: 0 }) : undefined,
			stem,
		};
	});
	const todayDate = input.today === undefined ? undefined : parseTimelineDate(input.today);
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

	// Spacing: about one comfortable label pitch per item, distributed by
	// elapsed time; outsized gaps become marked axis breaks.
	const unit = Math.min(
		128,
		Math.max(72, Math.round((median(items.map((item) => item.width)) + BLOCK_GAP_X) / 2 + 8)),
	);
	const x = Array.from({ length: anchors.length }, () => 0);
	const breaks = new Set<number>();
	if (!dated) {
		anchors.forEach((_, key) => (x[key] = key * unit));
	} else if (anchors.length > 1) {
		const gaps = anchors.slice(1).map((anchor, key) => anchor.time - anchors[key]!.time);
		const total = gaps.reduce((sum, gap) => sum + gap, 0);
		const target = items.length * unit;
		const maxGap = 3 * unit;
		const breakLength = 1.5 * unit;
		let scale = total > 0 ? target / total : 0;
		// Only an outlier breaks: long on the page and far beyond the typical gap.
		// A phase keeps its true length, so no break falls inside one.
		const insideSpan = (key: number) =>
			items.some((item) => item.span && item.startKey <= key && item.endKey > key);
		gaps.forEach((gap, key) => {
			const others = gaps.filter((other, index) => index !== key && other > 0);
			if (
				gap * scale > maxGap &&
				(!others.length || gap > BREAK_RATIO * median(others)) &&
				!insideSpan(key)
			)
				breaks.add(key);
		});
		const kept = gaps.reduce((sum, gap, key) => sum + (breaks.has(key) ? 0 : gap), 0);
		if (breaks.size && kept > 0)
			scale = Math.min(scale * 2, Math.max(scale, (target - breaks.size * breakLength) / kept));
		gaps.forEach((gap, key) => {
			x[key + 1] =
				x[key]! + (anchors[key + 1]!.tie > 0 ? 0 : breaks.has(key) ? breakLength : gap * scale);
		});
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
				.flatMap((item) => [
					{ from: item.startKey, to: item.endKey, min: MIN_BAR_WIDTH },
					// A marker just outside a bar stays clear of its end.
					...items
						.filter((point) => !point.span && point.lane === item.lane)
						.flatMap((point) =>
							anchors[point.startKey]!.time >= anchors[item.endKey]!.time
								? [{ from: item.endKey, to: point.startKey, min: DIAMOND_SIZE / 2 + 4 }]
								: anchors[point.startKey]!.time < anchors[item.startKey]!.time
									? [{ from: point.startKey, to: item.startKey, min: DIAMOND_SIZE / 2 + 4 }]
									: [],
						),
				]),
		]
			.filter((constraint) => constraint.to > constraint.from)
			.toSorted((a, b) => a.to - b.to || a.from - b.from);
		for (const { from, to, min } of constraints) {
			const distance = x[to]! - x[from]!;
			if (distance >= min) continue;
			const stretch = distance > 0 ? min / distance : 0;
			for (let key = from + 1; key < x.length; key += 1)
				x[key] =
					key < to
						? distance > 0
							? x[from]! + (x[key]! - x[from]!) * stretch
							: x[from]!
						: x[key]! + min - distance;
		}
	}

	// Row cuts fall between anchors that no span crosses, preferring breaks.
	const cuttable = anchors
		.slice(0, -1)
		.flatMap((_, key) =>
			items.some((item) => item.span && item.startKey <= key && item.endKey > key) ? [] : [key],
		);
	const rowsFor = (count: number): Row[] => {
		const length = x[x.length - 1]!;
		const rows: Row[] = [];
		let first = 0;
		for (let row = 1; row < count; row += 1) {
			const ideal = (length * row) / count;
			const choice = cuttable
				.filter((key) => key >= first && key < anchors.length - 1)
				.map((key) => ({
					key,
					cost:
						Math.abs((x[key]! + x[key + 1]!) / 2 - ideal) -
						(breaks.has(key) ? unit : 0) -
						(x[key + 1]! - x[key]!) / 4,
				}))
				.toSorted((a, b) => a.cost - b.cost || a.key - b.key)[0];
			if (!choice) break;
			rows.push({ first, last: choice.key });
			first = choice.key + 1;
		}
		rows.push({ first, last: anchors.length - 1 });
		return rows;
	};

	const layout = (rows: readonly Row[]) => {
		const laneCount = Math.max(1, laneNames.length);
		const rowLayouts = rows.map((row, rowIndex) => {
			const offset =
				x[row.first]! - (rowIndex > 0 ? CONTINUATION_LENGTH + AXIS_OVERHANG : AXIS_OVERHANG);
			const localX = (key: number) => x[key]! - offset;
			const todayX =
				todayKey !== undefined && todayKey >= row.first && todayKey <= row.last
					? localX(todayKey)
					: undefined;
			const lanes = Array.from({ length: laneCount }, (_, lane) =>
				placeLane(
					items.filter(
						(item) => item.lane === lane && item.startKey >= row.first && item.startKey <= row.last,
					),
					localX,
					todayX,
				),
			);
			return {
				row,
				localX,
				todayX,
				lanes,
				axisStart: rowIndex > 0 ? CONTINUATION_LENGTH : 0,
				axisEnd: localX(row.last) + AXIS_OVERHANG,
			};
		});
		return rowLayouts;
	};

	const laneLabelWidth = laneNames.length
		? Math.max(...laneNames.map((name) => boundLabelWidth(name, LANE_FONT_SIZE, 160))) + 20
		: 0;
	const header = captions.header;
	const todayCaption = captions.today;

	const compose = (rowLayouts: ReturnType<typeof layout>) => {
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
				// Axis segments between breaks, then break ticks and row continuations.
				const breakXs = [...breaks]
					.filter((key) => key >= rowLayout.row.first && key < rowLayout.row.last)
					.map((key) => left + (rowLayout.localX(key) + rowLayout.localX(key + 1)) / 2);
				const stops = [
					left + rowLayout.axisStart,
					...breakXs.flatMap((breakX) => [breakX - BREAK_HALF_GAP, breakX + BREAK_HALF_GAP]),
					left + rowLayout.axisEnd,
				];
				for (let segment = 0; segment < stops.length; segment += 2)
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
				breakXs.forEach((breakX, index) =>
					[-1, 1].forEach((side) =>
						push(
							line(
								`break:${suffix}:${index}:${side < 0 ? "a" : "b"}`,
								[
									{ x: breakX + side * BREAK_HALF_GAP - 3, y: axisY + 7 },
									{ x: breakX + side * BREAK_HALF_GAP + 3, y: axisY - 7 },
								],
								stroke,
							),
							back,
						),
					),
				);
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

	// Wrap into the row count whose aspect is closest to the target.
	const maxRows = Math.max(1, Math.min(12, Math.ceil(items.length / 2)));
	let best:
		| { composed: ReturnType<typeof compose>; box: ReturnType<typeof bounds>; score: number }
		| undefined;
	for (let count = 1; count <= maxRows; count += 1) {
		const rows = rowsFor(count);
		if (rows.length < count) break;
		const composed = compose(layout(rows));
		const box = bounds(composed.elements);
		const aspect = (box.maxX - box.minX + PADDING * 2) / (box.maxY - box.minY + PADDING * 2);
		const score = Math.abs(Math.log(aspect / TARGET_ASPECT)) + ROW_PENALTY * (count - 1);
		if (!best || score < best.score - 1e-9) best = { composed, box, score };
	}
	const { composed, box } = best!;
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

/** The shallowest of a few deterministic greedy placements. */
function placeLane(
	items: readonly Item[],
	localX: (key: number) => number,
	todayX: number | undefined,
): LaneRowLayout {
	let best: LaneRowLayout | undefined;
	for (const strategy of PLACEMENT_STRATEGIES) {
		const layout = placeLaneWith(items, localX, todayX, strategy);
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
	strategy: PlacementStrategy,
): LaneRowLayout {
	// Overlapping spans stack into tracks below the axis line.
	const trackEnds: number[] = [];
	const trackOf = new Map<Item, number>();
	for (const item of items
		.filter((entry) => entry.span)
		.toSorted((a, b) => a.startKey - b.startKey)) {
		let track = trackEnds.findIndex((end) => end <= item.startKey);
		if (track < 0) track = trackEnds.length;
		trackEnds[track] = item.endKey;
		trackOf.set(item, track);
	}
	const tracks = trackEnds.length;
	const belowBase = LABEL_BASE + Math.max(0, tracks - 1) * (BAR_HEIGHT + BAR_TRACK_GAP);
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
			const base = side < 0 ? LABEL_BASE : belowBase;
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
		const markerHalf = item.span
			? BAR_HEIGHT / 2
			: (item.event.kind === "milestone" ? DIAMOND_SIZE : DOT_SIZE) / 2;
		const trackOffset = track * (BAR_HEIGHT + BAR_TRACK_GAP);
		placements.push({
			item,
			stemX,
			side,
			near,
			left,
			stemStart: side > 0 ? trackOffset + markerHalf : markerHalf - trackOffset,
			track,
		});
		preferred = -side as -1 | 1;
	});
	const extent = (side: -1 | 1, base: number) =>
		Math.max(base, ...blocks[side].map((block) => block.far));
	return {
		placements,
		above: extent(-1, DIAMOND_SIZE / 2 + 6),
		below: extent(1, Math.max(DIAMOND_SIZE / 2, belowBase - LABEL_BASE + BAR_HEIGHT / 2) + 6),
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
