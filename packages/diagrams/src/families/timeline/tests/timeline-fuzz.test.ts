// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import {
	boundLabelWidth,
	getCanvasValidationIssues,
	type CanvasElement,
	type CanvasLineElement,
	type CanvasShapeElement,
	type CanvasTextElement,
	type CanvasSpec,
} from "@sketchi/drawing";
import type * as drawing from "@sketchi/drawing";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { renderDiagram } from "../../../family";
import { parseTimelineDate, parseTimelineDiagram, type TimelineDiagram } from "../document";
import { readTimelineAxis, readTimelineGaps, readTimelineMomentGaps } from "../readout";

// Count label measurements: each layout of the row measures every label once,
// so the count bounds how many layouts a render tries, without a wall-clock timer.
const work = vi.hoisted(() => ({ measures: 0 }));
vi.mock("@sketchi/drawing", async (importOriginal) => {
	const core = await importOriginal<typeof drawing>();
	return {
		...core,
		boundLabelWidth: (...args: Parameters<typeof core.boundLabelWidth>) => {
			work.measures += 1;
			return core.boundLabelWidth(...args);
		},
	};
});

function timeline(events: unknown[], extra: Record<string, unknown> = {}) {
	return parseTimelineDiagram({ id: "t", title: "T", type: "timeline", events, ...extra }).pipe(
		Result.getOrThrow,
	);
}
const texts = (scene: CanvasSpec) =>
	scene.elements.filter((element): element is CanvasTextElement => element.type === "text");
const lines = (scene: CanvasSpec) =>
	scene.elements.filter((element): element is CanvasLineElement => element.type === "line");
const markers = (scene: CanvasSpec) =>
	scene.elements.filter((element): element is CanvasShapeElement => element.type === "node");
function box(element: CanvasTextElement) {
	const width = boundLabelWidth(element.text, element.fontSize, element.maxWidth ?? 160);
	const height = element.text.split("\n").length * element.fontSize * 1.35;
	return {
		left: element.x - width / 2,
		right: element.x + width / 2,
		top: element.y - height / 2,
		bottom: element.y + height / 2,
	};
}

/** #701: a five-lane, 40-event project about six weeks apart, with operations opening a day apart. */
const TRAM_PROJECT: readonly (readonly [date: string, label: string, lane: string])[] = [
	["2024-01-15", "Feasibility study starts", "Planning"],
	["2024-03-04", "Public consultation opens", "Planning"],
	["2024-04-29", "Consultation closes", "Planning"],
	["2024-06-10", "Route options published", "Planning"],
	["2024-07-22", "Preferred route chosen", "Planning"],
	["2024-09-02", "Environmental survey begins", "Planning"],
	["2024-10-14", "Funding bid submitted", "Planning"],
	["2024-12-09", "Federal grant awarded", "Planning"],
	["2025-01-20", "Design consultants hired", "Design"],
	["2025-02-17", "Station locations fixed", "Design"],
	["2025-03-31", "Land acquisition starts", "Design"],
	["2025-05-12", "Utility relocation begins", "Construction"],
	["2025-06-23", "Preliminary design approved", "Design"],
	["2025-08-04", "Main contractor selected", "Design"],
	["2025-09-15", "Groundbreaking ceremony", "Construction"],
	["2025-10-27", "Depot construction begins", "Construction"],
	["2025-12-08", "First track section laid", "Construction"],
	["2026-01-19", "Bridge foundations poured", "Construction"],
	["2026-03-02", "Tunnel boring starts", "Construction"],
	["2026-04-13", "First station roof completed", "Construction"],
	["2026-05-25", "Signalling contract signed", "Design"],
	["2026-07-06", "Tunnel breakthrough", "Construction"],
	["2026-08-17", "Overhead power lines installed", "Construction"],
	["2026-09-28", "First trams delivered", "Systems"],
	["2026-11-09", "Depot handed over", "Systems"],
	["2026-12-21", "Track welding complete", "Systems"],
	["2027-02-01", "Power-on testing", "Systems"],
	["2027-03-15", "First test run", "Systems"],
	["2027-04-26", "Driver training begins", "Systems"],
	["2027-06-07", "Ticketing system live", "Systems"],
	["2027-07-19", "Safety certification granted", "Systems"],
	["2027-08-30", "Trial operations start", "Systems"],
	["2027-10-11", "Accessibility audit passed", "Systems"],
	["2027-11-22", "Opening ceremony", "Operations"],
	["2027-11-23", "Passenger service begins", "Operations"],
	["2028-01-10", "Timetable expanded to 7 minutes", "Operations"],
	["2028-03-20", "Park-and-ride lot opens", "Operations"],
	["2028-05-01", "One millionth passenger", "Operations"],
	["2028-07-03", "Northern extension approved", "Operations"],
	["2028-09-11", "First-year review published", "Operations"],
];

/** Rows of a wrapped timeline: every row but the last ends in a continuation on each lane. */
const rows = (scene: CanvasSpec) =>
	lines(scene).filter((line) => line.id.startsWith("continue-out:0:")).length + 1;
/** Aspect of the hosted PNG, which frames the drawing 20px out instead of the scene's 40. */
const exportAspect = (scene: CanvasSpec) => (scene.width - 40) / (scene.height - 40);

const periodOf = (event: TimelineDiagram["events"][number]) => ({
	start: parseTimelineDate(event.date!)!.start,
	end: parseTimelineDate(event.end ?? event.date!)!.end,
});

/** Whether phases cover the chronology from its first start to its last, leaving no gap to break or cut. */
function phasesCoverEveryGap(diagram: TimelineDiagram) {
	const periods = diagram.events.map(periodOf);
	const last = Math.max(...periods.map((period) => period.start));
	let covered = Math.min(...periods.map((period) => period.start));
	for (const phase of diagram.events
		.filter((event) => event.end !== undefined)
		.map(periodOf)
		.toSorted((a, b) => a.start - b.start))
		if (phase.start <= covered) covered = Math.max(covered, phase.end);
	return covered > last;
}

/**
 * Deterministic pseudo-random timelines that mix clusters, ties, phases, lanes
 * and today, over `horizon` days, or hours as instants.
 */
function randomTimelines(count: number, horizon = 90, unit: "day" | "hour" = "day") {
	let seed = 20261017;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	const words = [
		"Beta",
		"Release",
		"Rollout",
		"Public beta milestone",
		"Launch announcement",
		"Review",
		"Migration window",
		"GA",
	];
	const day = (offset: number) =>
		unit === "day"
			? new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10)
			: new Date(Date.UTC(2026, 0, 1, offset)).toISOString();
	return Array.from({ length: count }, (_, index) => {
		const lanes = pick([[], [], ["Eng"], ["Eng", "Ops"], ["Eng", "Ops", "Sales"]]);
		const offsets = Array.from({ length: 3 }, () => Math.floor((random() * horizon * 2) / 3));
		const events = Array.from({ length: 2 + Math.floor(random() * 11) }, (_, event) => {
			const start =
				random() < 0.6 ? pick(offsets) + Math.floor(random() * 3) : Math.floor(random() * horizon);
			const span = random() < 0.25;
			return {
				id: `e${event}`,
				label: pick(words),
				date: day(start),
				...(span ? { end: day(start + 1 + Math.floor(random() * 30)) } : {}),
				...(!span && random() < 0.2 ? { kind: "milestone" } : {}),
				...(lanes.length ? { lane: pick(lanes) } : {}),
				...(random() < 0.3
					? { description: pick(["Preserve all details of the product rollout.", "Short note."]) }
					: {}),
			};
		});
		return timeline(events, {
			id: `fuzz-${horizon}${unit[0]}-${index}`,
			...(lanes.length ? { lanes } : {}),
			...(random() < 0.3 ? { today: day(Math.floor(random() * horizon)) } : {}),
		});
	});
}

const momentsOf = (diagram: TimelineDiagram) =>
	new Map<string, { start: number; end?: number }>(
		diagram.events.map((event) => {
			const { start, end } = periodOf(event);
			return [event.id, event.end === undefined ? { start } : { start, end }];
		}),
	);

/** Labels never overlap each other, no stem or axis runs through a label, and each date sits by its stem. */
function readableProblems(scene: CanvasSpec): string[] {
	const problems: string[] = [];
	const boxes = texts(scene).map((element) => ({ id: element.id, ...box(element) }));
	for (const [index, a] of boxes.entries())
		for (const b of boxes.slice(index + 1))
			if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top))
				problems.push(`text-overlap: ${a.id} overlaps ${b.id}`);
	for (const line of lines(scene)) {
		if (line.id.startsWith("today:")) continue;
		const [start, end] = [line.points[0], line.points[line.points.length - 1]!];
		for (const label of boxes) {
			const crosses =
				start.x === end.x
					? start.x > label.left &&
						start.x < label.right &&
						Math.max(start.y, end.y) > label.top + 1 &&
						Math.min(start.y, end.y) < label.bottom - 1
					: start.y > label.top &&
						start.y < label.bottom &&
						Math.max(start.x, end.x) > label.left &&
						Math.min(start.x, end.x) < label.right;
			if (crosses) problems.push(`line-crosses-text: ${line.id} crosses ${label.id}`);
		}
	}
	// Each date sits nearer its own stem than any other stem on the same axis.
	const stems = lines(scene).filter((line) => line.id.startsWith("stem:"));
	for (const caption of texts(scene).filter((element) => element.id.startsWith("date:"))) {
		const own = stems.find((stem) => stem.id === `stem:${caption.id.slice("date:".length)}`)!;
		const distance = (stem: CanvasLineElement) => Math.abs(caption.x - stem.points[0].x);
		for (const other of stems)
			if (
				other !== own &&
				Math.abs(other.points[0].y - own.points[0].y) < 30 &&
				distance(own) >= distance(other)
			)
				problems.push(`date-off-stem: ${caption.id} sits nearer ${other.id}`);
	}
	return problems;
}

/** Every gap without a break mark is drawn at one shared scale. */
function scaleProblems(diagram: TimelineDiagram, scene: CanvasSpec): string[] {
	const moments = new Map(
		diagram.events.map((event) => [
			event.id,
			{
				start: parseTimelineDate(event.date!)!.start,
				...(event.end ? { end: parseTimelineDate(event.end)!.end } : {}),
			},
		]),
	);
	const gaps = readTimelineGaps(scene, moments).filter((gap) => !gap.broken);
	const rate = gaps[0] && gaps[0].drawn / gaps[0].elapsed;
	return gaps.flatMap((gap) =>
		Math.abs(gap.drawn / gap.elapsed / rate! - 1) < 1e-6
			? []
			: [`off-scale: ${gap.from} → ${gap.to}`],
	);
}

/**
 * Gaps between moments on any lane are drawn in elapsed order, broken or not,
 * and every break states, rounded, the time of the gap it stands in.
 */
function gapProblems(diagram: TimelineDiagram, scene: CanvasSpec): string[] {
	const problems: string[] = [];
	const gaps = readTimelineMomentGaps(scene, momentsOf(diagram));
	// A break that makes room for crowded neighbors stretches its gap past the
	// shared scale instead of compressing it, so it stays out of the order.
	const rate = Math.max(
		0,
		...gaps.filter((gap) => !gap.breaks.length).map((gap) => gap.drawn / gap.elapsed),
	);
	const ordered = gaps.filter(
		(gap) => !gap.breaks.length || !rate || gap.drawn <= gap.elapsed * rate * 1.01,
	);
	for (const longer of ordered)
		for (const shorter of ordered)
			if (longer.elapsed > shorter.elapsed) {
				const name = `${longer.from} → ${longer.to} against ${shorter.from} → ${shorter.to}`;
				if (longer.drawn < shorter.drawn - 1e-6) problems.push(`gap-order: ${name}`);
				// Half again the time beside a break draws visibly longer.
				else if (
					longer.elapsed >= 1.5 * shorter.elapsed &&
					(longer.breaks.length || shorter.breaks.length) &&
					longer.drawn - shorter.drawn < 12 - 1e-6
				)
					problems.push(`gap-too-close: ${name}`);
			}
	for (const lane of readTimelineAxis(scene))
		for (const mark of lane.breaks)
			if (mark.duration === undefined) problems.push(`break-unlabeled: "${mark.label}"`);
	const bars = readTimelineAxis(scene).flatMap((lane) =>
		[...lane.markers.values()].flatMap((marker) =>
			marker.end === undefined ? [] : [{ start: marker.start, end: marker.end }],
		),
	);
	for (const gap of gaps)
		for (const mark of gap.breaks) {
			if (mark.duration === undefined) continue;
			const ratio = mark.duration / gap.elapsed;
			const name = `${gap.from} → ${gap.to} labeled "${mark.label}"`;
			if (ratio >= 1.25) problems.push(`break-label-long: ${name}`);
			// A Today line, a phase's label stem or a second break splits the gap, so
			// its label states a part of it.
			const split =
				gap.today ||
				gap.breaks.length > 1 ||
				bars.some((bar) => bar.start < mark.at && bar.end > mark.at);
			if (!split && ratio <= 0.75) problems.push(`break-label-short: ${name}`);
		}
	return problems;
}

/**
 * Breaks stay clear of every point marker, on any lane, and never fall between
 * simultaneous markers. A marker shares a bar only when it is dated inside that phase.
 */
function markerProblems(diagram: TimelineDiagram, scene: CanvasSpec): string[] {
	const problems: string[] = [];
	const lanes = readTimelineAxis(scene);
	const nodes = new Map(
		markers(scene).map((element) => [element.nodeId.slice("event:".length), element]),
	);
	const events = new Map(diagram.events.map((event) => [event.id, event]));
	const points = lanes.flatMap((lane) =>
		[...lane.markers].flatMap(([id, marker]) =>
			marker.end === undefined
				? [
						{
							id,
							at: marker.start,
							half: nodes.get(id)!.width / 2,
							time: periodOf(events.get(id)!).start,
						},
					]
				: [],
		),
	);
	for (const { at } of lanes.flatMap((lane) => lane.breaks)) {
		for (const point of points)
			if (Math.abs(point.at - at) < point.half + 7)
				problems.push(`break-crosses-marker: a break at ${at.toFixed(1)} crosses ${point.id}`);
		for (const time of new Set(points.map((point) => point.time)))
			if (
				new Set(points.filter((point) => point.time === time).map((point) => point.at < at)).size >
				1
			)
				problems.push(`break-splits-tie: a break splits the markers at ${time}`);
	}
	const axisYs = lines(scene)
		.filter((line) => line.id.startsWith("axis:"))
		.map((line) => line.points[0].y);
	// The axis a marker hangs from: the nearest at or above its center.
	const axisOf = (node: CanvasShapeElement) =>
		Math.max(...axisYs.filter((y) => y <= node.y + node.height / 2 + 0.5));
	const apart = (point: CanvasShapeElement, bar: CanvasShapeElement) =>
		point.x >= bar.x + bar.width - 0.5 || bar.x >= point.x + point.width - 0.5;
	for (const lane of lanes) {
		const ids = [...lane.markers.keys()];
		const barIds = ids.filter((id) => events.get(id)!.end !== undefined);
		const pointIds = ids.filter((id) => events.get(id)!.end === undefined);
		const unrelated = (pointId: string, barId: string) => {
			const time = periodOf(events.get(pointId)!).start;
			const phase = periodOf(events.get(barId)!);
			return time < phase.start || time >= phase.end;
		};
		// When an unrelated marker spans a phase's x-range, every phase on that lane leaves the axis.
		const crowded = barIds.some((barId) =>
			pointIds.some(
				(id) =>
					unrelated(id, barId) &&
					axisOf(nodes.get(id)!) === axisOf(nodes.get(barId)!) &&
					!apart(nodes.get(id)!, nodes.get(barId)!),
			),
		);
		if (crowded)
			for (const barId of barIds) {
				const bar = nodes.get(barId)!;
				if (axisYs.some((y) => Math.abs(bar.y + bar.height / 2 - y) < 0.5))
					problems.push(`phase-on-crowded-axis: ${barId}`);
			}
		for (const barId of barIds)
			for (const pointId of pointIds) {
				const bar = nodes.get(barId)!;
				const point = nodes.get(pointId)!;
				if (
					unrelated(pointId, barId) &&
					!apart(point, bar) &&
					point.y < bar.y + bar.height - 0.5 &&
					bar.y < point.y + point.height - 0.5
				)
					problems.push(`marker-on-unrelated-phase: ${pointId} on ${barId}`);
			}
	}
	return problems;
}

/** Every promise a dated timeline's layout makes, read from its scene. Each problem starts with its kind. */
function timelineProblems(diagram: TimelineDiagram, scene: CanvasSpec): string[] {
	return [
		...readableProblems(scene),
		...scaleProblems(diagram, scene),
		...markerProblems(diagram, scene),
		...gapProblems(diagram, scene),
		// A single row stays within the cap unless phases cover every gap, so nothing may break or wrap.
		...(rows(scene) === 1 && !phasesCoverEveryGap(diagram) && exportAspect(scene) > 3.5 + 0.02
			? [`too-wide: ${exportAspect(scene).toFixed(2)} for one row`]
			: []),
	];
}

function expectReadableTimeline(diagram: TimelineDiagram): CanvasSpec {
	const scene = renderDiagram(diagram).pipe(Result.getOrThrow);
	expect(getCanvasValidationIssues(scene), diagram.id).toEqual([]);
	expect(validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues, diagram.id).toEqual([]);
	expect(timelineProblems(diagram, scene), diagram.id).toEqual([]);
	return scene;
}

describe("timeline layout", () => {
	it("keeps every promise across generated timelines", () => {
		for (const diagram of [
			...randomTimelines(160),
			...randomTimelines(80, 2000),
			...randomTimelines(40, 2000, "hour"),
		])
			expectReadableTimeline(diagram);
	});

	// #701: the one-day pair used to set the scale, breaking 38 gaps on all five lanes: 950 elements.
	it("breaks a lone close pair once instead of nearly every gap on every lane", () => {
		const scene = expectReadableTimeline(tramProject("2027-11-23"));
		expect(scene.elements.length).toBeLessThanOrEqual(210);
		expect(lines(scene).filter((line) => line.id.startsWith("break:"))).toHaveLength(
			2 * TRAM_LANES.length,
		);
	});

	// The #511 review's row: a 2020-2026 phase under 59 releases 35 days apart.
	// The phase covers every gap, so the row can neither break nor wrap, and no
	// stem length brings it within 2.3:1. Measured: 4,962 label measurements
	// laying out each of the 19 stem lengths in turn, 606 predicting the stem length.
	it("lays the stretched row out once more, not once per stem length", () => {
		const day = 86_400_000;
		const start = Date.UTC(2020, 0, 1);
		const diagram = timeline([
			{ id: "platform", label: "Platform build-out", date: "2020", end: "2026" },
			...Array.from({ length: 59 }, (_, index) => ({
				id: `release-${index + 1}`,
				label: `Release ${index + 1}`,
				date: new Date(start + index * 35 * day).toISOString().slice(0, 10),
			})),
		]);
		work.measures = 0;
		renderDiagram(diagram).pipe(Result.getOrThrow);
		expect(work.measures).toBeGreaterThan(0);
		expect(work.measures).toBeLessThan(900);
	});
});

const TRAM_LANES = ["Planning", "Design", "Construction", "Systems", "Operations"];
const tramProject = (opening: string) =>
	timeline(
		TRAM_PROJECT.map(([date, label, lane], index) => ({
			id: `e${index}`,
			label,
			date: label === "Passenger service begins" ? opening : date,
			lane,
		})),
		{ id: "tram", lanes: TRAM_LANES },
	);

type SceneEdit = (element: CanvasElement) => CanvasElement | undefined;

/** The scene with the element of this id or node id replaced, or removed where the edit returns undefined. */
function edit(scene: CanvasSpec, id: string, change: SceneEdit): CanvasSpec {
	const matches = (element: CanvasElement) =>
		element.id === id || (element.type === "node" && element.nodeId === id);
	if (!scene.elements.some(matches)) throw new Error(`no element ${id}`);
	return {
		...scene,
		elements: scene.elements.flatMap((element) => {
			if (!matches(element)) return [element];
			const changed = change(element);
			return changed ? [changed] : [];
		}),
	};
}
const find = (scene: CanvasSpec, id: string) =>
	scene.elements.find(
		(element) => element.id === id || (element.type === "node" && element.nodeId === id),
	)!;
const shiftX =
	(dx: number): SceneEdit =>
	(element) =>
		({ ...element, x: (element as CanvasShapeElement).x + dx }) as CanvasElement;
const retext =
	(text: string): SceneEdit =>
	(element) =>
		({ ...element, text }) as CanvasElement;
/** The diagram with one event's fields changed: the scene drawn for the original no longer matches it. */
const redate = (diagram: TimelineDiagram, id: string, change: object): TimelineDiagram => ({
	...diagram,
	events: diagram.events.map((event) => (event.id === id ? { ...event, ...change } : event)),
});
const breakLabel = (scene: CanvasSpec) =>
	texts(scene).find((element) => element.id.startsWith("break-label:"))!.id;

const plain = timeline(
	[
		{ id: "a", label: "Kickoff", date: "2026-01-01" },
		{ id: "b", label: "Review", date: "2026-01-11" },
		{ id: "c", label: "Launch", date: "2026-01-31" },
	],
	{ id: "plain" },
);
/** A compressed break stands in for the long last gap. */
const gapped = timeline(
	[
		{ id: "a", label: "Kickoff", date: "2026-01-01" },
		{ id: "b", label: "Review", date: "2026-01-11" },
		{ id: "c", label: "Beta", date: "2026-01-21" },
		{ id: "d", label: "Launch", date: "2028-09-01" },
	],
	{ id: "gapped" },
);
const phased = timeline(
	[
		{ id: "build", label: "Build", date: "2026-01-01", end: "2026-01-31" },
		{ id: "check", label: "Check", date: "2026-01-15" },
	],
	{ id: "phased" },
);

/** One deliberately broken scene, or a diagram it was not drawn from, per problem kind the oracle reports. */
const broken: Record<
	string,
	[TimelineDiagram, (scene: CanvasSpec, diagram: TimelineDiagram) => [TimelineDiagram, CanvasSpec]]
> = {
	"text-overlap": [
		plain,
		(scene, diagram) => {
			const { x, y } = find(scene, "label:event:a") as CanvasTextElement;
			return [
				diagram,
				edit(scene, "label:event:b", (element) => ({ ...element, x, y }) as CanvasElement),
			];
		},
	],
	"line-crosses-text": [
		plain,
		(scene, diagram) => {
			const label = find(scene, "label:event:a") as CanvasTextElement;
			return [
				diagram,
				edit(
					scene,
					"stem:event:b",
					(line) =>
						({
							...line,
							points: [
								{ x: label.x, y: label.y - 40 },
								{ x: label.x, y: label.y + 40 },
							],
						}) as CanvasElement,
				),
			];
		},
	],
	"date-off-stem": [
		plain,
		(scene, diagram) => {
			const stem = find(scene, "stem:event:b") as CanvasLineElement;
			return [
				diagram,
				edit(
					scene,
					"date:event:a",
					(element) => ({ ...element, x: stem.points[0].x }) as CanvasElement,
				),
			];
		},
	],
	"off-scale": [plain, (scene, diagram) => [redate(diagram, "b", { date: "2026-01-12" }), scene]],
	"gap-order": [plain, (scene, diagram) => [redate(diagram, "b", { date: "2026-01-25" }), scene]],
	"gap-too-close": [
		gapped,
		(scene, diagram) => {
			// Draw the compressed gap barely longer than a plain one, its break still inside it.
			const gaps = readTimelineMomentGaps(scene, momentsOf(diagram));
			const compressed = gaps.find((gap) => gap.breaks.length)!;
			const plainGap = gaps.find((gap) => !gap.breaks.length)!;
			const shrink = plainGap.drawn + 6 - compressed.drawn;
			const mark = compressed.breaks[0]!.at;
			const c = readTimelineAxis(scene)[0]!.markers.get("c")!.start;
			const moveBreak = (c + (c + plainGap.drawn + 6)) / 2 - mark;
			const shifted = scene.elements.map((element) =>
				element.type === "line" && element.id.startsWith("break:")
					? {
							...element,
							points: element.points.map((point) => ({ ...point, x: point.x + moveBreak })),
						}
					: element,
			) as CanvasElement[];
			return [diagram, edit({ ...scene, elements: shifted }, "event:d", shiftX(shrink))];
		},
	],
	"break-unlabeled": [
		gapped,
		(scene, diagram) => [diagram, edit(scene, breakLabel(scene), () => undefined)],
	],
	"break-label-long": [
		gapped,
		(scene, diagram) => [diagram, edit(scene, breakLabel(scene), retext("40 years"))],
	],
	"break-label-short": [
		gapped,
		(scene, diagram) => [diagram, edit(scene, breakLabel(scene), retext("2 days"))],
	],
	"break-crosses-marker": [
		gapped,
		(scene, diagram) => {
			const [lane] = readTimelineAxis(scene);
			const c = lane!.markers.get("c")!;
			return [diagram, edit(scene, "event:c", shiftX(lane!.breaks[0]!.at - c.start))];
		},
	],
	"break-splits-tie": [
		gapped,
		(scene, diagram) => [redate(diagram, "c", { date: "2028-09-01" }), scene],
	],
	"phase-on-crowded-axis": [
		phased,
		(scene, diagram) => {
			const axis = lines(scene).find((line) => line.id.startsWith("axis:"))!;
			const bar = find(scene, "event:build") as CanvasShapeElement;
			const onAxis = edit(
				scene,
				"event:build",
				(element) =>
					({
						...element,
						y: axis.points[0].y - bar.height / 2,
					}) as CanvasElement,
			);
			return [redate(diagram, "check", { date: "2025-12-01" }), onAxis];
		},
	],
	"marker-on-unrelated-phase": [
		phased,
		(scene, diagram) => {
			const bar = find(scene, "event:build") as CanvasShapeElement;
			const point = find(scene, "event:check") as CanvasShapeElement;
			return [
				redate(diagram, "check", { date: "2025-12-01" }),
				edit(
					scene,
					"event:check",
					(element) =>
						({
							...element,
							y: bar.y + bar.height / 2 - point.height / 2,
						}) as CanvasElement,
				),
			];
		},
	],
	"too-wide": [plain, (scene, diagram) => [diagram, { ...scene, width: scene.width * 4 }]],
};

describe("timeline oracle", () => {
	it.each(Object.entries(broken))("reports %s on a broken scene", (kind, [diagram, breakScene]) => {
		const scene = expectReadableTimeline(diagram);
		const [claimed, drawn] = breakScene(scene, diagram);
		expect(timelineProblems(claimed, drawn).map((problem) => problem.split(":")[0])).toContain(
			kind,
		);
	});
});
