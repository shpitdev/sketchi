import { describe, expect, it } from "vitest";
import {
	boundLabelWidth,
	getCanvasValidationIssues,
	parseTimelineDate,
	parseTimelineDiagram,
	timelineFixture,
	type CanvasLineElement,
	type CanvasShapeElement,
	type CanvasTextElement,
	type TimelineDiagram,
} from "@sketchi/diagram-core";
import { renderDiagram } from "../diagram.js";
import { timelineDurationCaption } from "../timeline-captions.js";
import type { RenderedDiagramScene } from "../scene.js";
import { readTimelineAxis, readTimelineGaps, readTimelineMomentGaps } from "../timeline-readout.js";

function timeline(events: unknown[], extra: Record<string, unknown> = {}) {
	return parseTimelineDiagram({ id: "t", title: "T", type: "timeline", events, ...extra });
}
const texts = (scene: RenderedDiagramScene) =>
	scene.elements.filter((element): element is CanvasTextElement => element.type === "text");
const lines = (scene: RenderedDiagramScene) =>
	scene.elements.filter((element): element is CanvasLineElement => element.type === "line");
const markers = (scene: RenderedDiagramScene) =>
	scene.elements.filter((element): element is CanvasShapeElement => element.type === "node");
const marker = (scene: RenderedDiagramScene, id: string) =>
	markers(scene).find((element) => element.nodeId === `event:${id}`)!;
const centerX = (element: CanvasShapeElement) => element.x + element.width / 2;
const text = (scene: RenderedDiagramScene, id: string) =>
	texts(scene).find((element) => element.id === id)?.text;
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

/** Rows of a wrapped timeline: every row but the last ends in a continuation on each lane. */
const rows = (scene: RenderedDiagramScene) =>
	lines(scene).filter((line) => line.id.startsWith("continue-out:0:")).length + 1;
/** Aspect of the hosted PNG, which frames the drawing 20px out instead of the scene's 40. */
const exportAspect = (scene: RenderedDiagramScene) => (scene.width - 40) / (scene.height - 40);

/** Labels never overlap each other, and no stem or axis runs through a label. */
function expectReadableLayout(scene: RenderedDiagramScene) {
	expect(getCanvasValidationIssues(scene)).toEqual([]);
	const boxes = texts(scene).map((element) => ({ id: element.id, ...box(element) }));
	for (const [index, a] of boxes.entries())
		for (const b of boxes.slice(index + 1))
			expect(
				a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
				`${a.id} overlaps ${b.id}`,
			).toBe(true);
	for (const line of lines(scene)) {
		const [start, end] = [line.points[0], line.points[line.points.length - 1]!];
		for (const label of boxes) {
			const vertical = start.x === end.x;
			const crosses = vertical
				? start.x > label.left &&
					start.x < label.right &&
					Math.max(start.y, end.y) > label.top + 1 &&
					Math.min(start.y, end.y) < label.bottom - 1
				: start.y > label.top &&
					start.y < label.bottom &&
					Math.max(start.x, end.x) > label.left &&
					Math.min(start.x, end.x) < label.right;
			if (line.id.startsWith("today:")) continue;
			expect(crosses, `${line.id} crosses ${label.id}`).toBe(false);
		}
	}
	// Each date sits nearer its own stem than any other stem on the same axis.
	const stems = lines(scene).filter((line) => line.id.startsWith("stem:"));
	for (const caption of texts(scene).filter((element) => element.id.startsWith("date:"))) {
		const own = stems.find((stem) => stem.id === `stem:${caption.id.slice("date:".length)}`)!;
		const distance = (stem: CanvasLineElement) => Math.abs(caption.x - stem.points[0].x);
		for (const other of stems)
			if (other !== own && Math.abs(other.points[0].y - own.points[0].y) < 30)
				expect(distance(own) < distance(other), `${caption.id} sits nearer ${other.id}`).toBe(true);
	}
}

/** Every gap without a break mark is drawn at one shared scale. Returns the gaps. */
function expectToScale(diagram: TimelineDiagram, scene = renderDiagram(diagram)) {
	const moments = new Map(
		diagram.events.map((event) => [
			event.id,
			{
				start: parseTimelineDate(event.date!)!.start,
				...(event.end ? { end: parseTimelineDate(event.end)!.end } : {}),
			},
		]),
	);
	const gaps = readTimelineGaps(scene, moments);
	const rates = gaps.filter((gap) => !gap.broken).map((gap) => gap.drawn / gap.elapsed);
	for (const [index, gap] of gaps.entries())
		if (!gap.broken)
			expect(
				Math.abs(gap.drawn / gap.elapsed / rates[0]! - 1),
				`${diagram.id} ${gap.from} → ${gap.to} (gap ${index}) is off scale`,
			).toBeLessThan(1e-6);
	return gaps;
}

/**
 * Gaps between moments on any lane are drawn in elapsed order, broken or not,
 * and every break states, rounded, the time of the gap it stands in. Returns
 * the gaps.
 */
function expectGapOrder(diagram: TimelineDiagram, scene: RenderedDiagramScene) {
	const moments = new Map<string, { start: number; end?: number }>(
		diagram.events.map((event) => {
			const { start, end } = periodOf(event);
			return [event.id, event.end === undefined ? { start } : { start, end }];
		}),
	);
	const gaps = readTimelineMomentGaps(scene, moments);
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
				const name = `${diagram.id}: ${longer.from} → ${longer.to} against ${shorter.from} → ${shorter.to}`;
				expect(longer.drawn, name).toBeGreaterThanOrEqual(shorter.drawn - 1e-6);
				// Half again the time beside a break draws visibly longer.
				if (
					longer.elapsed >= 1.5 * shorter.elapsed &&
					(longer.breaks.length || shorter.breaks.length)
				)
					expect(longer.drawn - shorter.drawn, name).toBeGreaterThanOrEqual(12 - 1e-6);
			}
	for (const lane of readTimelineAxis(scene))
		for (const mark of lane.breaks)
			expect(mark.duration, `${diagram.id}: break "${mark.label}"`).toBeDefined();
	const bars = readTimelineAxis(scene).flatMap((lane) =>
		[...lane.markers.values()].flatMap((marker) =>
			marker.end === undefined ? [] : [{ start: marker.start, end: marker.end }],
		),
	);
	for (const gap of gaps)
		for (const mark of gap.breaks) {
			const ratio = mark.duration! / gap.elapsed;
			expect(ratio, `${diagram.id}: ${gap.from} → ${gap.to} labeled "${mark.label}"`).toBeLessThan(
				1.25,
			);
			// A Today line, a phase's label stem or a second break splits the gap, so
			// its label states a part of it.
			const split =
				gap.today ||
				gap.breaks.length > 1 ||
				bars.some((bar) => bar.start < mark.at && bar.end > mark.at);
			if (!split)
				expect(
					ratio,
					`${diagram.id}: ${gap.from} → ${gap.to} labeled "${mark.label}"`,
				).toBeGreaterThan(0.75);
		}
	return gaps;
}

const periodOf = (event: TimelineDiagram["events"][number]) => ({
	start: parseTimelineDate(event.date!)!.start,
	end: parseTimelineDate(event.end ?? event.date!)!.end,
});

/**
 * Breaks stay clear of every point marker, on any lane, and never fall between
 * simultaneous markers. A marker shares a bar only when it is dated inside that phase.
 */
function expectHonestMarkers(diagram: TimelineDiagram, scene: RenderedDiagramScene) {
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
			expect(
				Math.abs(point.at - at),
				`${diagram.id}: a break at ${at.toFixed(1)} crosses ${point.id}`,
			).toBeGreaterThanOrEqual(point.half + 7);
		for (const time of new Set(points.map((point) => point.time))) {
			const sides = new Set(
				points.filter((point) => point.time === time).map((point) => point.at < at),
			);
			expect(sides.size, `${diagram.id}: a break splits the markers at ${time}`).toBe(1);
		}
	}
	const axisYs = lines(scene)
		.filter((line) => line.id.startsWith("axis:"))
		.map((line) => line.points[0].y);
	// The axis a marker hangs from: the nearest at or above its center.
	const axisOf = (node: CanvasShapeElement) =>
		Math.max(...axisYs.filter((y) => y <= node.y + node.height / 2 + 0.5));
	for (const lane of lanes) {
		const ids = [...lane.markers.keys()];
		// When an unrelated marker spans a phase's x-range, every phase on that lane leaves the axis.
		const barIds = ids.filter((id) => events.get(id)!.end !== undefined);
		const crowded = barIds.some((barId) => {
			const bar = nodes.get(barId)!;
			const phase = periodOf(events.get(barId)!);
			return ids.some((id) => {
				const point = nodes.get(id)!;
				const time = periodOf(events.get(id)!).start;
				return (
					events.get(id)!.end === undefined &&
					axisOf(point) === axisOf(bar) &&
					(time < phase.start || time >= phase.end) &&
					point.x < bar.x + bar.width - 0.5 &&
					bar.x < point.x + point.width - 0.5
				);
			});
		});
		if (crowded)
			for (const barId of barIds) {
				const bar = nodes.get(barId)!;
				expect(
					axisYs.some((y) => Math.abs(bar.y + bar.height / 2 - y) < 0.5),
					`${diagram.id}: ${barId} stays on the axis while its lane's phases moved below`,
				).toBe(false);
			}
		for (const barId of ids.filter((id) => events.get(id)!.end !== undefined)) {
			const bar = nodes.get(barId)!;
			const phase = periodOf(events.get(barId)!);
			for (const pointId of ids.filter((id) => events.get(id)!.end === undefined)) {
				const point = nodes.get(pointId)!;
				const time = periodOf(events.get(pointId)!).start;
				if (time >= phase.start && time < phase.end) continue;
				const overlaps =
					point.x < bar.x + bar.width - 0.5 &&
					bar.x < point.x + point.width - 0.5 &&
					point.y < bar.y + bar.height - 0.5 &&
					bar.y < point.y + point.height - 0.5;
				expect(overlaps, `${diagram.id}: ${pointId} overlaps the unrelated phase ${barId}`).toBe(
					false,
				);
			}
		}
	}
}

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

describe("native timeline layout", () => {
	it("renders deterministically regardless of input order", () => {
		const scene = renderDiagram({
			...timelineFixture,
			events: [...timelineFixture.events].reverse(),
		});
		expect(scene).toEqual(renderDiagram(timelineFixture));
		expect(markers(scene).map((element) => element.nodeId)).toEqual([
			"event:release",
			"event:beta",
			"event:plan",
		]);
		expectReadableLayout(scene);
	});

	it("draws one axis with dot and diamond markers, never a numbered arrow chain", () => {
		const scene = renderDiagram(timelineFixture);
		expect(scene.elements.some((element) => element.type === "arrow")).toBe(false);
		expect(lines(scene).filter((line) => line.id.startsWith("axis:"))).toHaveLength(1);
		expect(marker(scene, "plan").shape).toBe("ellipse");
		expect(marker(scene, "release").shape).toBe("diamond");
		expect(markers(scene).every((element) => element.rendererRole === "timeline-marker")).toBe(
			true,
		);
		for (const element of texts(scene)) expect(element.text).not.toMatch(/^\d+$|^Order \d/u);
	});

	it("humanizes dates at their granularity and states the year once", () => {
		const scene = renderDiagram(timelineFixture);
		expect(text(scene, "date:event:plan")).toBe("Sep 1, 2026");
		expect(text(scene, "date:event:beta")).toBe("Sep 15");
		expect(text(scene, "date:event:release")).toBe("Oct 1");
		expect(text(scene, "description:event:beta")?.replace("\n", " ")).toBe(
			"Collect feedback from early users.",
		);
		const mixed = renderDiagram(
			timeline([
				{ id: "a", label: "Founded", date: "2019" },
				{ id: "b", label: "Seed", date: "2020-03" },
				{ id: "c", label: "Launch", date: "2021-06-14" },
				{ id: "d", label: "Enterprise", date: "2021-11" },
			]),
		);
		expect(["a", "b", "c", "d"].map((id) => text(mixed, `date:event:${id}`))).toEqual([
			"2019",
			"Mar 2020",
			"Jun 14, 2021",
			"Nov 2021",
		]);
	});

	it("shows a same-day chronology as times under one dated, zoned header", () => {
		const scene = renderDiagram(
			timeline([
				{ id: "alert", label: "Alert fired", date: "2026-10-12T09:05:00Z" },
				{ id: "rollback", label: "Rollback started", date: "2026-10-12T09:12:00Z" },
				{ id: "recovered", label: "Service recovered", date: "2026-10-12T09:18:00Z" },
				{ id: "closed", label: "Incident closed", date: "2026-10-12T09:40:00Z" },
			]),
		);
		expect(text(scene, "header")).toBe("Oct 12, 2026 · UTC");
		expect(
			["alert", "rollback", "recovered", "closed"].map((id) => text(scene, `date:event:${id}`)),
		).toEqual(["09:05", "09:12", "09:18", "09:40"]);
		for (const element of texts(scene)) expect(element.text).not.toMatch(/\d{4}-\d{2}|T\d{2}:|Z$/u);
		// Elapsed time drives spacing: 7, 6 and 22 minute gaps.
		const [a, b, c, d] = ["alert", "rollback", "recovered", "closed"].map((id) =>
			centerX(marker(scene, id)),
		);
		expect((d! - c!) / (b! - a!)).toBeCloseTo(22 / 7, 1);
		expect((c! - b!) / (b! - a!)).toBeCloseTo(6 / 7, 1);
		// Alternating labels keep a short chronology compact.
		expect(scene.width / scene.height).toBeLessThan(3);
		expectReadableLayout(scene);
	});

	it("keeps an explicit offset and renders mixed offsets in UTC", () => {
		const eastern = renderDiagram(
			timeline([
				{ id: "a", label: "Alert", date: "2026-11-03T13:58:00-05:00" },
				{ id: "b", label: "Clear", date: "2026-11-03T14:47:00-05:00" },
			]),
		);
		expect(text(eastern, "header")).toBe("Nov 3, 2026 · UTC-05:00");
		expect(text(eastern, "date:event:a")).toBe("13:58");
		const mixed = renderDiagram(
			timeline([
				{ id: "a", label: "Build", date: "2026-10-12T09:05:00+02:00" },
				{ id: "b", label: "Rollout", date: "2026-10-12T04:45:30-05:00" },
			]),
		);
		expect(text(mixed, "header")).toBe("Oct 12, 2026 · UTC");
		expect([text(mixed, "date:event:a"), text(mixed, "date:event:b")]).toEqual([
			"07:05:00",
			"09:45:30",
		]);
	});

	it("spaces ordered events evenly without captions", () => {
		const scene = renderDiagram(
			timeline(
				["Discovery", "Prototype", "Pilot", "Launch", "Retrospective"].map((label, order) => ({
					id: label.toLowerCase(),
					label,
					order,
				})),
			),
		);
		const xs = markers(scene)
			.map(centerX)
			.toSorted((a, b) => a - b);
		const gaps = xs.slice(1).map((x, index) => x - xs[index]!);
		expect(new Set(gaps.map(Math.round)).size).toBe(1);
		expect(texts(scene).some((element) => element.id.startsWith("date:"))).toBe(false);
		expect(text(scene, "header")).toBeUndefined();
		expectReadableLayout(scene);
	});

	it("draws spans as bars from start to inclusive end with a deterministic Today marker", () => {
		const diagram = timeline(
			[
				{ id: "discovery", label: "Discovery", date: "2026-01-05", end: "2026-02-13" },
				{ id: "freeze", label: "Design freeze", date: "2026-02-13", kind: "milestone" },
				{ id: "build", label: "Build", date: "2026-02-16", end: "2026-05-29" },
				{ id: "launch", label: "Launch", date: "2026-08-04", kind: "milestone" },
			],
			{ today: "2026-03-10" },
		);
		const scene = renderDiagram(diagram);
		const discovery = marker(scene, "discovery");
		const build = marker(scene, "build");
		expect(discovery.shape).toBe("rectangle");
		expect(text(scene, "date:event:discovery")).toBe("Jan 5 – Feb 13, 2026");
		// The freeze on the last day of Discovery sits at the bar's end.
		expect(centerX(marker(scene, "freeze"))).toBeGreaterThan(discovery.x);
		expect(centerX(marker(scene, "freeze"))).toBeLessThanOrEqual(discovery.x + discovery.width);
		const today = lines(scene).find((line) => line.id.startsWith("today:"))!;
		expect(today.points[0].x).toBeGreaterThan(build.x);
		expect(today.points[0].x).toBeLessThan(build.x + build.width);
		expect(text(scene, "today-label:0")).toBe("Today · Mar 10");
		expect(
			lines(renderDiagram({ ...diagram, today: undefined } as never)).some((line) =>
				line.id.startsWith("today:"),
			),
		).toBe(false);
		expectReadableLayout(scene);
	});

	it("gives each lane a labeled axis on one shared time scale", () => {
		const scene = renderDiagram(
			timeline(
				[
					{ id: "waitlist", label: "Waitlist opens", date: "2026-02-16", lane: "Marketing" },
					{ id: "api", label: "API beta", date: "2026-03-02", lane: "Engineering" },
					{ id: "sdk", label: "SDK release", date: "2026-04-15", lane: "Engineering" },
					{ id: "blog", label: "Launch blog", date: "2026-04-15", lane: "Marketing" },
				],
				{ lanes: ["Engineering", "Marketing"] },
			),
		);
		expect(text(scene, "lane:0:0")).toBe("Engineering");
		expect(text(scene, "lane:1:0")).toBe("Marketing");
		const axes = lines(scene).filter((line) => line.id.startsWith("axis:"));
		expect(axes).toHaveLength(2);
		const engineeringY = axes.find((line) => line.id === "axis:0:0")!.points[0].y;
		const sdk = marker(scene, "sdk");
		expect(sdk.y + sdk.height / 2).toBe(engineeringY);
		expect(centerX(sdk)).toBe(centerX(marker(scene, "blog")));
		expectReadableLayout(scene);
	});

	it("breaks the widest gaps of a too-wide row, in elapsed order and labeled with their time", () => {
		const diagram = timeline([
			{ id: "a", label: "v0.1", date: "2026-01-05" },
			{ id: "b", label: "v0.2", date: "2026-01-12" },
			{ id: "c", label: "v0.3", date: "2026-01-19" },
			{ id: "d", label: "v1.0", date: "2026-06-30" },
			{ id: "e", label: "v2.0", date: "2028-03-01" },
		]);
		const scene = renderDiagram(diagram);
		// Drawn to scale, the 162-day gap is 23 weeks wide and the row runs past 4:1.
		expect(rows(scene)).toBe(1);
		expect(exportAspect(scene)).toBeLessThanOrEqual(2.5);
		const gaps = expectToScale(diagram, scene);
		expect(gaps.map((gap) => gap.broken)).toEqual([false, false, true, true]);
		expect(gaps[1]!.drawn / gaps[0]!.drawn).toBeCloseTo(1, 6);
		// The 610-day break draws visibly longer than the 162-day one, which
		// draws longer than either week.
		expect(gaps[2]!.drawn).toBeGreaterThan(gaps[1]!.drawn);
		expect(gaps[3]!.drawn / gaps[2]!.drawn).toBeGreaterThan(1.5);
		expect(
			texts(scene)
				.filter((element) => element.id.startsWith("break-label:"))
				.map((element) => element.text),
		).toEqual(["5 months", "20 months"]);
		expectGapOrder(diagram, scene);
		expectHonestMarkers(diagram, scene);
		expectReadableLayout(scene);
	});

	it("keeps the breaks of a row that still exceeds the cap and cannot wrap", () => {
		// Two phases cannot wrap, and Beta keeps its true length past the cap.
		const diagram = timeline([
			{ id: "a", label: "Alpha", date: "2026-01-01", end: "2026-01-03" },
			{ id: "b", label: "Beta", date: "2026-06-12", end: "2027-04-08" },
		]);
		const scene = renderDiagram(diagram);
		expect(rows(scene)).toBe(1);
		const gaps = expectToScale(diagram, scene);
		expect(gaps.map((gap) => gap.broken)).toEqual([false, true, false]);
		// The break draws the 160 days between the phases at a fraction of their scale.
		const rate = gaps[0]!.drawn / gaps[0]!.elapsed;
		expect(gaps[1]!.drawn).toBeLessThan((gaps[1]!.elapsed * rate) / 4);
		expectHonestMarkers(diagram, scene);
		expectReadableLayout(scene);
	});

	it("draws a long gap to scale while the row stays within the cap", () => {
		const diagram = timeline([
			{ id: "a", label: "v0.1", date: "2026-01-05" },
			{ id: "b", label: "v0.2", date: "2026-01-12" },
			{ id: "c", label: "v0.3", date: "2026-01-19" },
			{ id: "d", label: "v1.0", date: "2026-04-06" },
		]);
		const scene = renderDiagram(diagram);
		expect(exportAspect(scene)).toBeLessThanOrEqual(3.5);
		const gaps = expectToScale(diagram, scene);
		expect(gaps.map((gap) => gap.broken)).toEqual([false, false, false]);
		expect(gaps[2]!.drawn / gaps[0]!.drawn).toBeCloseTo(11, 6);
	});

	it("breaks each outsized gap, and every gap a break would halve, where it falls", () => {
		const diagram = timeline([
			{ id: "a", label: "Kickoff", date: "2026-01-05" },
			{ id: "b", label: "Design review", date: "2026-01-06" },
			{ id: "c", label: "Prototype", date: "2026-01-09" },
			{ id: "d", label: "Pilot", date: "2027-03-01" },
			{ id: "e", label: "Pilot review", date: "2027-03-03" },
			{ id: "f", label: "Rollout", date: "2027-03-17" },
			{ id: "g", label: "Sunset", date: "2031-06-30" },
		]);
		const scene = renderDiagram(diagram);
		const gaps = expectToScale(diagram, scene);
		// Two weeks would draw longer than the shortest break, so it breaks too.
		expect(gaps.map((gap) => gap.broken)).toEqual([false, false, true, false, true, true]);
		expect(gaps[1]!.drawn / gaps[0]!.drawn).toBeCloseTo(3, 6);
		expect(gaps[3]!.drawn / gaps[0]!.drawn).toBeCloseTo(2, 6);
		expect(gaps[4]!.drawn).toBeLessThan(gaps[2]!.drawn);
		expect(gaps[2]!.drawn).toBeLessThan(gaps[5]!.drawn);
		expect(
			texts(scene)
				.filter((element) => element.id.startsWith("break-label:"))
				.map((element) => element.text),
		).toEqual(["14 months", "14 days", "4.3 years"]);
		expectGapOrder(diagram, scene);
		expectReadableLayout(scene);
	});

	it("states each break's time in the unit a reader would use", () => {
		const minute = 60_000;
		const day = 1_440 * minute;
		expect(
			[
				1,
				99,
				1_500,
				12_400,
				0.5 * minute,
				45 * minute,
				36 * 60 * minute,
				day,
				24 * day,
				162 * day,
				610 * day,
				1_566 * day,
				4_400 * day,
			].map(timelineDurationCaption),
		).toEqual([
			"1 millisecond",
			"99 milliseconds",
			"1.5 seconds",
			"12 seconds",
			"30 seconds",
			"45 minutes",
			"36 hours",
			"24 hours",
			"24 days",
			"5 months",
			"20 months",
			"4.3 years",
			"12 years",
		]);
	});

	it("states a break under a second in milliseconds", () => {
		const diagram = timeline([
			{ id: "a", label: "Request", date: "2026-10-12T09:00:00.000Z" },
			{ id: "b", label: "Cache hit", date: "2026-10-12T09:00:00.001Z" },
			{ id: "c", label: "Render", date: "2026-10-12T09:00:00.002Z" },
			{ id: "d", label: "Response", date: "2026-10-12T09:00:00.101Z" },
		]);
		const scene = renderDiagram(diagram);
		expect(
			texts(scene)
				.filter((element) => element.id.startsWith("break-label:"))
				.map((element) => element.text),
		).toEqual(["99 milliseconds"]);
		expectGapOrder(diagram, scene);
		expectReadableLayout(scene);
	});

	it("keeps breaks clear of simultaneous markers on any lane", () => {
		const diagram = timeline(
			[
				{ id: "a0", label: "A0", date: "2026-01-01", lane: "A" },
				{ id: "a1", label: "A1", date: "2026-01-01", lane: "A" },
				{ id: "a2", label: "A2", date: "2026-01-01", lane: "A" },
				{ id: "b0", label: "Phase", date: "2026-01-01", end: "2026-12-31", lane: "B" },
				{ id: "b1", label: "B1", date: "2026-01-02", lane: "B" },
				{ id: "b2", label: "B2", date: "2026-01-03", lane: "B" },
			],
			{ lanes: ["A", "B"] },
		);
		const scene = renderDiagram(diagram);
		expect(lines(scene).some((line) => line.id.startsWith("break:"))).toBe(true);
		expectHonestMarkers(diagram, scene);
		expectToScale(diagram, scene);
		expectReadableLayout(scene);
	});

	it("keeps a milestone just past a phase off that phase's bar, without moving its date", () => {
		const diagram = timeline(
			[
				{ id: "discovery", label: "Discovery", date: "2026-01-05", end: "2026-02-13" },
				{ id: "freeze", label: "Design freeze", date: "2026-02-13", kind: "milestone" },
				{ id: "build", label: "Build", date: "2026-02-16", end: "2026-05-29" },
				{ id: "beta", label: "Beta", date: "2026-06-01", end: "2026-07-31" },
				{ id: "launch", label: "Launch", date: "2026-08-04", kind: "milestone" },
			],
			{ today: "2026-03-10" },
		);
		const scene = renderDiagram(diagram);
		expectHonestMarkers(diagram, scene);
		expectToScale(diagram, scene);
		expectReadableLayout(scene);
		// The lane's phases move below the axis together; the milestones stay on it.
		const bars = ["discovery", "build", "beta"].map((id) => marker(scene, id));
		const freeze = marker(scene, "freeze");
		expect(new Set(bars.map((bar) => bar.y)).size).toBe(1);
		expect(bars[0]!.y).toBeGreaterThan(freeze.y + freeze.height / 2);
		expect(marker(scene, "launch").y).toBe(freeze.y);
		expect(scene.width / scene.height).toBeLessThan(3);
		// Build spans Today, so its label hangs from the longer side, clear of the line.
		const todayX = lines(scene).find((line) => line.id === "today:0")!.points[0].x;
		for (const element of texts(scene).filter((entry) => entry.id.endsWith("event:build"))) {
			const { left, right } = box(element);
			expect(todayX < left || todayX > right, `${element.id} crosses Today`).toBe(true);
		}
	});

	it("wraps a long chronology into left-to-right rows that continue the axis", () => {
		const diagram = timeline(
			Array.from({ length: 60 }, (_, index) => ({
				id: `event-${index}`,
				order: index,
				label: `Milestone ${index + 1}`,
				description: "Preserve all supplied details in a readable multiline card.",
			})),
		);
		const scene = renderDiagram(diagram);
		expect(scene.width / scene.height).toBeLessThan(3);
		expect(scene.height / scene.width).toBeLessThan(3);
		expect(markers(scene)).toHaveLength(60);
		const rows = lines(scene).filter((line) => line.id.startsWith("axis:"));
		expect(rows.length).toBeGreaterThan(1);
		expect(lines(scene).filter((line) => line.id.startsWith("continue-out:"))).toHaveLength(
			rows.length - 1,
		);
		expect(lines(scene).filter((line) => line.id.startsWith("continue-in:"))).toHaveLength(
			rows.length - 1,
		);
		// Rows read like lines of text: later events sit right of, or below, earlier ones.
		const positions = Array.from({ length: 60 }, (_, index) => {
			const element = marker(scene, `event-${index}`);
			return { x: centerX(element), y: element.y + element.height / 2 };
		});
		expect(new Set(positions.map((position) => position.y)).size).toBe(rows.length);
		for (const [index, position] of positions.slice(1).entries()) {
			const previous = positions[index]!;
			expect(
				position.y > previous.y || (position.y === previous.y && position.x > previous.x),
			).toBe(true);
		}
		expectReadableLayout(scene);
	});

	it("keeps dense same-day clusters and overlapping lane phases readable", () => {
		expectReadableLayout(
			renderDiagram(
				timeline([
					{ id: "a", label: "Contract signed", date: "2026-04-01" },
					{ id: "b", label: "Kickoff call", date: "2026-04-01" },
					{ id: "c", label: "Repo created", date: "2026-04-01" },
					{ id: "d", label: "First commit", date: "2026-04-02" },
					{ id: "e", label: "Demo", date: "2026-04-20" },
				]),
			),
		);
		expectReadableLayout(
			renderDiagram(
				timeline(
					[
						{
							id: "p1",
							label: "API redesign",
							date: "2026-03-01",
							end: "2026-05-31",
							lane: "Platform",
						},
						{
							id: "p2",
							label: "Auth migration",
							date: "2026-04-15",
							end: "2026-07-15",
							lane: "Platform",
						},
						{
							id: "p3",
							label: "API v2 GA",
							date: "2026-07-20",
							kind: "milestone",
							lane: "Platform",
						},
						{
							id: "m1",
							label: "iOS rebuild",
							date: "2026-03-15",
							end: "2026-08-31",
							lane: "Mobile",
						},
						{ id: "m2", label: "TestFlight", date: "2026-06-01", lane: "Mobile" },
					],
					{ today: "2026-06-15" },
				),
			),
		);
		const releases = timeline(
			Array.from({ length: 60 }, (_, index) => ({
				id: `e${index}`,
				label: `Release ${index + 1}`,
				date: new Date(Date.UTC(2026, 0, 1 + index * 6 + (index % 7) * 3))
					.toISOString()
					.slice(0, 10),
				...(index % 4 === 0 ? { description: "Shipped to all regions." } : {}),
			})),
		);
		const wrapped = renderDiagram(releases);
		expectReadableLayout(wrapped);
		// Gaps split across a row wrap stay to scale too.
		expect(
			lines(wrapped).filter((line) => line.id.startsWith("continue-out:")).length,
		).toBeGreaterThan(0);
		expect(expectToScale(releases, wrapped).every((gap) => !gap.broken)).toBe(true);
	});

	it("re-spaces a phase label that would crowd simultaneous events instead of crossing stems", () => {
		for (const labels of [
			["Beta", "Release", "Rollout"],
			["Public beta milestone", "Public beta milestone", "Public beta milestone"],
		])
			expectReadableLayout(
				renderDiagram(
					timeline([
						{ id: "beta", label: labels[0], date: "2026-01-08" },
						{ id: "release", label: labels[1], date: "2026-01-08" },
						{
							id: "rollout",
							label: labels[2],
							date: "2026-01-01",
							end: "2026-01-12",
							description: "Preserve all details of the product rollout.",
						},
					]),
				),
			);
	});

	it("keeps each date caption over its own marker in a dense cluster", () => {
		expectReadableLayout(
			renderDiagram(
				timeline([
					{ id: "launch", label: "Launch", date: "2027-03-14" },
					{ id: "tli", label: "Trans-lunar injection", date: "2027-03-15" },
					{ id: "loi", label: "Lunar orbit insertion", date: "2027-03-19" },
					{ id: "image", label: "First science image", date: "2027-03-24" },
					{ id: "lowered", label: "Orbit lowered to 50 km", date: "2027-04-08" },
					{ id: "separation", label: "Lander separation", date: "2027-05-02" },
					{ id: "touchdown", label: "Touchdown", date: "2027-05-03" },
					{ id: "drive", label: "First rover drive", date: "2027-05-10" },
				]),
			),
		);
	});

	it("never needs an unchecked placement across generated timelines", () => {
		for (const diagram of [
			...randomTimelines(160),
			...randomTimelines(80, 2000),
			...randomTimelines(40, 2000, "hour"),
		]) {
			const scene = renderDiagram(diagram);
			expectReadableLayout(scene);
			expectToScale(diagram, scene);
			expectHonestMarkers(diagram, scene);
			expectGapOrder(diagram, scene);
			// A single row stays within the cap unless phases cover every gap, so
			// nothing may break or wrap.
			if (rows(scene) === 1 && !phasesCoverEveryGap(diagram))
				expect(exportAspect(scene), `${diagram.id} is too wide for one row`).toBeLessThanOrEqual(
					3.5 + 0.02,
				);
		}
	});
});
