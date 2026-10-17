import { describe, expect, it } from "vitest";
import {
	boundLabelWidth,
	getCanvasValidationIssues,
	parseTimelineDiagram,
	timelineFixture,
	type CanvasLineElement,
	type CanvasShapeElement,
	type CanvasTextElement,
} from "@sketchi/diagram-core";
import { renderDiagram } from "../diagram.js";
import type { RenderedDiagramScene } from "../scene.js";

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

/** Deterministic pseudo-random timelines that mix clusters, ties, phases, lanes and today. */
function randomTimelines(count: number) {
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
		new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
	return Array.from({ length: count }, (_, index) => {
		const lanes = pick([[], [], ["Eng"], ["Eng", "Ops"], ["Eng", "Ops", "Sales"]]);
		const offsets = Array.from({ length: 3 }, () => Math.floor(random() * 60));
		const events = Array.from({ length: 2 + Math.floor(random() * 11) }, (_, event) => {
			const start =
				random() < 0.6 ? pick(offsets) + Math.floor(random() * 3) : Math.floor(random() * 90);
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
			id: `fuzz-${index}`,
			...(lanes.length ? { lanes } : {}),
			...(random() < 0.3 ? { today: day(Math.floor(random() * 90)) } : {}),
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

	it("marks an outsized gap with an axis break instead of empty axis", () => {
		const scene = renderDiagram(
			timeline([
				{ id: "a", label: "v0.1", date: "2026-01-05" },
				{ id: "b", label: "v0.2", date: "2026-01-12" },
				{ id: "c", label: "v0.3", date: "2026-01-19" },
				{ id: "d", label: "v1.0", date: "2026-06-30" },
				{ id: "e", label: "v2.0", date: "2028-03-01" },
			]),
		);
		expect(lines(scene).filter((line) => line.id.startsWith("break:"))).toHaveLength(2);
		const [a, b, , d, e] = ["a", "b", "c", "d", "e"].map((id) => centerX(marker(scene, id)));
		expect(d! - b!).toBeGreaterThan(2 * (b! - a!));
		expect(e! - d!).toBeLessThan(d! - a!);
		expectReadableLayout(scene);
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
		expectReadableLayout(
			renderDiagram(
				timeline(
					Array.from({ length: 60 }, (_, index) => ({
						id: `e${index}`,
						label: `Release ${index + 1}`,
						date: new Date(Date.UTC(2026, 0, 1 + index * 6 + (index % 7) * 3))
							.toISOString()
							.slice(0, 10),
						...(index % 4 === 0 ? { description: "Shipped to all regions." } : {}),
					})),
				),
			),
		);
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
		for (const diagram of randomTimelines(160)) expectReadableLayout(renderDiagram(diagram));
	});
});
