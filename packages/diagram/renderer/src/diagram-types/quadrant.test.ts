import {
	getCanvasValidationIssues,
	parseQuadrantDiagram,
	quadrantFixture,
	QuadrantValidationError,
	type QuadrantDiagram,
} from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { CHART_SERIES_COLORS } from "../chart.js";
import { QUADRANT_PLOT_SIZES, renderQuadrantDiagram } from "../quadrant.js";
import { quadrantLayoutIssues, readQuadrantScene } from "../quadrant-readout.js";
import type { RenderedDiagramScene, SceneElement } from "../scene.js";

type NodeElement = Extract<SceneElement, { type: "node" }>;
type LineElement = Extract<SceneElement, { type: "line" }>;

function quadrant(points: QuadrantDiagram["points"], extra: object = {}): QuadrantDiagram {
	return parseQuadrantDiagram({
		...quadrantFixture,
		id: "test-quadrant",
		points,
		...extra,
	});
}

function expectReadable(diagram: QuadrantDiagram): RenderedDiagramScene {
	const scene = renderQuadrantDiagram(diagram);
	expect(getCanvasValidationIssues(scene)).toEqual([]);
	expect(quadrantLayoutIssues(scene, diagram).map((issue) => issue.message)).toEqual([]);
	return scene;
}

const node = (scene: RenderedDiagramScene, nodeId: string) =>
	scene.elements.find(
		(element): element is NodeElement => element.type === "node" && element.nodeId === nodeId,
	)!;
const line = (scene: RenderedDiagramScene, id: string) =>
	scene.elements.find(
		(element): element is LineElement => element.type === "line" && element.id === id,
	)!;
const text = (scene: RenderedDiagramScene, id: string) =>
	scene.elements.find((element) => element.type === "text" && element.id === id);

describe("quadrant chart renderer", () => {
	it("renders the fixture into a valid, deterministic, readable scene", () => {
		const scene = expectReadable(quadrantFixture);
		expect(scene.diagramId).toBe("effort-impact-backlog");
		expect(renderQuadrantDiagram(quadrantFixture)).toEqual(scene);
		const aspect = scene.width / scene.height;
		expect(aspect).toBeGreaterThan(1 / 1.4);
		expect(aspect).toBeLessThan(1.4);
	});

	it("splits a square plot into four tinted quadrants with their names in their outer corners", () => {
		const scene = renderQuadrantDiagram(quadrantFixture);
		const { plot, regions, names } = readQuadrantScene(scene);
		expect(plot!.right - plot!.left).toBe(plot!.bottom - plot!.top);
		const half = (plot!.right - plot!.left) / 2;
		const fills = new Set<string>();
		for (const key of ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const) {
			const region = node(scene, `quadrant:region:${key}`);
			expect(region).toMatchObject({
				shape: "rectangle",
				rendererRole: "quadrant-mark",
				roughness: 0,
			});
			expect([region.width, region.height]).toEqual([half, half]);
			fills.add(region.fillColor!);
			const box = regions[key]!;
			const name = names.find((entry) => entry.key === key)!;
			const corner = {
				x: key.endsWith("Left") ? box.left : box.right,
				y: key.startsWith("top") ? box.top : box.bottom,
			};
			const near = {
				x: key.endsWith("Left") ? name.box.left : name.box.right,
				y: key.startsWith("top") ? name.box.top : name.box.bottom,
			};
			expect(Math.abs(near.x - corner.x)).toBeLessThanOrEqual(11);
			expect(Math.abs(near.y - corner.y)).toBeLessThanOrEqual(11);
		}
		expect(fills.size).toBe(4);
		expect(names.map((name) => name.text)).toEqual([
			"Quick wins",
			"Major projects",
			"Fill-ins",
			"Thankless tasks",
		]);
	});

	it("draws each axis as an arrow toward its high end, carrying its title and end labels", () => {
		const scene = renderQuadrantDiagram(quadrantFixture);
		const { plot } = readQuadrantScene(scene);
		const x = line(scene, "quadrant:axis:x");
		const y = line(scene, "quadrant:axis:y");
		expect(x.endArrowhead).toBe("arrow");
		expect(y.endArrowhead).toBe("arrow");
		expect(x.points[1].x).toBeGreaterThan(x.points[0].x);
		expect(x.points[0].y).toBeGreaterThan(plot!.bottom);
		expect(y.points[1].y).toBeLessThan(y.points[0].y);
		expect(y.points[0].x).toBeLessThan(plot!.left);
		for (const [id, value] of [
			["quadrant:axis:x:low", "Low effort"],
			["quadrant:axis:x:high", "High effort"],
			["quadrant:axis:x:title", "Effort"],
			["quadrant:axis:y:low", "Low impact"],
			["quadrant:axis:y:high", "High impact"],
			["quadrant:axis:y:title", "Impact"],
		] as const)
			expect(text(scene, id), id).toMatchObject({
				text: value,
				groupIds: [id.split(":").slice(0, 3).join(":")],
			});
		const xLow = readQuadrantScene(scene).texts.find(
			(entry) => entry.id === "quadrant:axis:x:low",
		)!;
		const yHigh = readQuadrantScene(scene).texts.find(
			(entry) => entry.id === "quadrant:axis:y:high",
		)!;
		expect(xLow.box.left).toBeCloseTo(plot!.left, 0);
		expect(yHigh.box.top).toBeCloseTo(plot!.top, 0);
	});

	it("puts every dot at its exact position, grouped with its label", () => {
		const scene = renderQuadrantDiagram(quadrantFixture);
		const { plot, dots } = readQuadrantScene(scene);
		const size = plot!.right - plot!.left;
		quadrantFixture.points.forEach((point, index) => {
			const dot = dots.find((entry) => entry.index === index)!;
			expect(dot.center.x).toBeCloseTo(plot!.left + point.x * size, 1);
			expect(dot.center.y).toBeCloseTo(plot!.top + (1 - point.y) * size, 1);
			expect(node(scene, `quadrant:point:${index}`)).toMatchObject({
				shape: "ellipse",
				rendererRole: "quadrant-mark",
				label: point.label,
				groupIds: [`quadrant:point:${index}`],
			});
			expect(text(scene, `quadrant:label:${index}`)).toMatchObject({
				text: point.label,
				groupIds: [`quadrant:point:${index}`],
			});
		});
	});

	it("keeps points on the plot's edges, corners and middle lines readable", () => {
		const points = [
			{ label: "Origin", x: 0, y: 0 },
			{ label: "Far corner", x: 1, y: 1 },
			{ label: "Center", x: 0.5, y: 0.5 },
			{ label: "Left edge", x: 0, y: 0.5 },
			{ label: "Top middle", x: 0.5, y: 1 },
			{ label: "On the vertical line", x: 0.5, y: 0.25 },
			{ label: "On the horizontal line", x: 0.8, y: 0.5 },
			{ label: "Right edge", x: 1, y: 0.1 },
		];
		const scene = expectReadable(quadrant(points));
		// Dots draw over the middle lines, so a point on a line stays visible.
		const order = scene.zOrder;
		const lastRule = Math.max(
			...order.flatMap((id, at) => (id.startsWith("quadrant:midline:") ? [at] : [])),
		);
		for (let index = 0; index < points.length; index += 1)
			expect(order.indexOf(`node:quadrant:point:${index}`)).toBeGreaterThan(lastRule);
	});

	it("moves a quadrant's name off its corner when a dot sits there", () => {
		const scene = expectReadable(
			quadrant([
				{ label: "Corner item", x: 0.03, y: 0.97 },
				{ label: "Edge item", x: 0.2, y: 0.97 },
			]),
		);
		const { names, dots } = readQuadrantScene(scene);
		const topLeft = names.find((name) => name.key === "topLeft")!;
		for (const dot of dots)
			expect(
				topLeft.box.right <= dot.box.left ||
					dot.box.right <= topLeft.box.left ||
					topLeft.box.bottom <= dot.box.top ||
					dot.box.bottom <= topLeft.box.top,
			).toBe(true);
	});

	it("labels a crowded cluster on leader lines that cross no dot, label or other leader", () => {
		const points = Array.from({ length: 14 }, (_, index) => ({
			label: `Feature ${index + 1}`,
			x: 0.3 + ((index * 7) % 5) * 0.012,
			y: 0.7 + ((index * 3) % 4) * 0.012,
		}));
		const scene = expectReadable(quadrant(points));
		expect(readQuadrantScene(scene).leaders.length).toBeGreaterThan(0);
	});

	it("separates the labels of points that share one position", () => {
		const points = Array.from({ length: 10 }, (_, index) => ({
			label: `Same spot ${index + 1}`,
			x: 0.5,
			y: 0.5,
		}));
		expectReadable(quadrant(points));
	});

	it("grows the plot only when a crowded chart cannot read at the smallest size", () => {
		expect(readQuadrantScene(renderQuadrantDiagram(quadrantFixture)).plot!.right).toBeGreaterThan(
			0,
		);
		const sparse = readQuadrantScene(renderQuadrantDiagram(quadrantFixture)).plot!;
		expect(sparse.right - sparse.left).toBe(QUADRANT_PLOT_SIZES[0]);
		const dense = quadrant(
			Array.from({ length: 30 }, (_, index) => ({
				label: `Initiative ${index + 1}`,
				x: 0.56 + (index % 6) * 0.075,
				y: 0.58 + Math.floor(index / 6) * 0.09,
			})),
		);
		const plot = readQuadrantScene(expectReadable(dense)).plot!;
		expect(plot.right - plot.left).toBeGreaterThan(QUADRANT_PLOT_SIZES[0]);
	});

	it("colors dots by group in palette order with a legend, and ungrouped dots neutral", () => {
		const diagram = quadrant([
			{ label: "Acme", x: 0.2, y: 0.8, group: "Us" },
			{ label: "Globex", x: 0.7, y: 0.6, group: "Rivals" },
			{ label: "Initech", x: 0.6, y: 0.3, group: "rivals" },
			{ label: "Hooli", x: 0.3, y: 0.2 },
		]);
		const scene = expectReadable(diagram);
		expect(node(scene, "quadrant:point:0").fillColor).toBe(CHART_SERIES_COLORS[0]);
		expect(node(scene, "quadrant:point:1").fillColor).toBe(CHART_SERIES_COLORS[1]);
		expect(node(scene, "quadrant:point:2").fillColor).toBe(CHART_SERIES_COLORS[1]);
		expect(CHART_SERIES_COLORS).not.toContain(node(scene, "quadrant:point:3").fillColor);
		expect(text(scene, "quadrant:legend:0:label")).toMatchObject({ text: "Us" });
		expect(text(scene, "quadrant:legend:1:label")).toMatchObject({ text: "Rivals" });
		expect(text(scene, "quadrant:legend:2:label")).toBeUndefined();
		expect(node(scene, "quadrant:key:1").fillColor).toBe(CHART_SERIES_COLORS[1]);
		// Without groups, every dot shares the first color and no legend draws.
		const plain = renderQuadrantDiagram(quadrantFixture);
		expect(plain.elements.some((element) => element.id.startsWith("quadrant:legend:"))).toBe(false);
	});

	it("wraps long labels and names at whole words", () => {
		const diagram = quadrant(
			[
				{ label: "Internationalization consolidation", x: 0.25, y: 0.75 },
				{ label: "Telecommunications infrastructure", x: 0.75, y: 0.25 },
			],
			{
				quadrants: {
					topLeft: "Strategic differentiators worth funding",
					topRight: "Major transformational initiatives",
					bottomLeft: "Low priority housekeeping chores",
					bottomRight: "Thankless operational burdens",
				},
				yAxis: {
					title: "Expected business impact",
					low: "Barely noticeable",
					high: "Transformational change",
				},
			},
		);
		expectReadable(diagram);
	});

	it("breaks authored newlines in labels, names and axis text as lines, never as a crash", () => {
		const diagram = quadrant(
			[
				{ label: "Two-factor\nauthentication", x: 0.3, y: 0.8 },
				{ label: "Audit\nlog", x: 0.32, y: 0.78 },
				{ label: "Line one\n\nline three", x: 0.8, y: 0.2 },
			],
			{
				quadrants: { ...quadrantFixture.quadrants, topLeft: "Quick\nwins" },
				xAxis: { title: "Effort\n(story points)", low: "Low\neffort", high: "High effort" },
			},
		);
		const scene = expectReadable(diagram);
		const label = scene.elements.find((element) => element.id === "quadrant:label:0");
		expect(label?.type === "text" && label.text.split("\n")).toEqual([
			"Two-factor",
			"authentication",
		]);
		const name = scene.elements.find((element) => element.id === "quadrant:name:topLeft");
		expect(name?.type === "text" && name.text).toBe("Quick\nwins");
	});

	it("colors groups named like constructor and __proto__ as any other", () => {
		const diagram = quadrant([
			{ label: "__proto__", x: 0.2, y: 0.8, group: "constructor" },
			{ label: "constructor", x: 0.7, y: 0.3, group: "__proto__" },
			{ label: "hasOwnProperty", x: 0.4, y: 0.4, group: "constructor" },
		]);
		const scene = expectReadable(diagram);
		expect(node(scene, "quadrant:point:0").fillColor).toBe(CHART_SERIES_COLORS[0]);
		expect(node(scene, "quadrant:point:1").fillColor).toBe(CHART_SERIES_COLORS[1]);
		expect(node(scene, "quadrant:point:2").fillColor).toBe(CHART_SERIES_COLORS[0]);
		expect(text(scene, "quadrant:legend:1:label")).toMatchObject({ text: "__proto__" });
	});

	it("draws an empty matrix with its quadrants and axes", () => {
		const scene = expectReadable(quadrant([]));
		expect(readQuadrantScene(scene).names).toHaveLength(4);
	});

	it("keeps both dividers and both axes whole, with no label crossing one", () => {
		const crowded = quadrant(
			Array.from({ length: 16 }, (_, index) => ({
				label: `Long item name ${index + 1}`,
				x: 0.42 + (index % 4) * 0.05,
				y: 0.42 + Math.floor(index / 4) * 0.05,
			})),
		);
		for (const diagram of [quadrantFixture, crowded]) {
			const scene = expectReadable(diagram);
			const { plot } = readQuadrantScene(scene);
			const rules = scene.elements.filter(
				(element): element is LineElement =>
					element.type === "line" && /^quadrant:(midline:|axis:[xy]$)/u.test(element.id),
			);
			expect(rules.map((rule) => rule.id).toSorted()).toEqual([
				"quadrant:axis:x",
				"quadrant:axis:y",
				"quadrant:midline:horizontal",
				"quadrant:midline:vertical",
			]);
			const vertical = line(scene, "quadrant:midline:vertical");
			expect(vertical.points.map((point) => point.y)).toEqual([plot!.top, plot!.bottom]);
			const horizontal = line(scene, "quadrant:midline:horizontal");
			expect(horizontal.points.map((point) => point.x)).toEqual([plot!.left, plot!.right]);
		}
	});

	it("reports a divider broken under a label", () => {
		const scene = renderQuadrantDiagram(quadrantFixture);
		const vertical = line(scene, "quadrant:midline:vertical");
		const [top, bottom] = vertical.points;
		const broken = {
			...scene,
			elements: scene.elements.flatMap((element) =>
				element.id === vertical.id
					? [
							{ ...vertical, points: [top, { x: top.x, y: top.y + 100 }] as const },
							{
								...vertical,
								id: `${vertical.id}:1`,
								points: [{ x: top.x, y: top.y + 140 }, bottom] as const,
							},
						]
					: [element],
			),
		} as RenderedDiagramScene;
		expect(quadrantLayoutIssues(broken, quadrantFixture).map((issue) => issue.code)).toContain(
			"broken-divider",
		);
	});

	it("sets each label where it reads as its own dot's, not level with or over another", () => {
		// A backlog whose Slack notifications and Onboarding checklist sit 0.04 apart on both
		// axes: either label set off its dot's corner would sit level with the other's dot.
		expectReadable(
			quadrant([
				{ label: "Single sign-on", x: 0.3, y: 0.85 },
				{ label: "Dark mode", x: 0.2, y: 0.4 },
				{ label: "CSV export", x: 0.15, y: 0.7 },
				{ label: "Usage-based billing", x: 0.8, y: 0.9 },
				{ label: "Mobile offline mode", x: 0.85, y: 0.75 },
				{ label: "Custom report builder", x: 0.7, y: 0.8 },
				{ label: "Audit log", x: 0.35, y: 0.78 },
				{ label: "Slack notifications", x: 0.18, y: 0.72 },
				{ label: "Bulk user import", x: 0.25, y: 0.82 },
				{ label: "Two-factor authentication", x: 0.28, y: 0.88 },
				{ label: "API rate limit dashboard", x: 0.32, y: 0.66 },
				{ label: "Onboarding checklist", x: 0.22, y: 0.76 },
				{ label: "Legacy theme cleanup", x: 0.75, y: 0.2 },
				{ label: "Localization for 12 languages", x: 0.9, y: 0.35 },
				{ label: "Admin role templates", x: 0.5, y: 0.6 },
			]),
		);
	});

	it("reports a label off its dot's corner that sits level with another dot", () => {
		const diagram = quadrant([
			{ label: "Alpha", x: 0.3, y: 0.3 },
			{ label: "Beta", x: 0.34, y: 0.34 },
		]);
		const scene = renderQuadrantDiagram(diagram);
		const own = node(scene, "quadrant:point:0");
		const ownCenter = { x: own.x + own.width / 2, y: own.y + own.height / 2 };
		// Up and left of its own dot, nearer it than Beta's, but level with Beta's dot.
		const moved = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "text" && element.id === "quadrant:label:0"
					? {
							...element,
							x: ownCenter.x - 9 - element.maxWidth! / 2,
							y: ownCenter.y - 9 - (element.fontSize * 1.35) / 2,
						}
					: element,
			),
		} as RenderedDiagramScene;
		const codes = quadrantLayoutIssues(moved, diagram).map((issue) => issue.code);
		expect(codes).toContain("misread-label");
		expect(codes).not.toContain("detached-label");
	});

	it("never publishes a chart whose labels cannot all sit clear: it places them or rejects it", () => {
		// Ten items scored alike in a corner still fit, in a column beside their dots.
		expectReadable(
			quadrant(
				Array.from({ length: 10 }, (_, index) => ({ label: `Item ${index + 1}`, x: 0, y: 0 })),
			),
		);
		// Thirty in one corner leave no clean layout, so the chart is rejected with a repair hint.
		for (const label of ["Item", "Telecommunications backlog"]) {
			const crowded = quadrant(
				Array.from({ length: 30 }, (_, index) => ({ label: `${label} ${index + 1}`, x: 0, y: 0 })),
			);
			let scene: RenderedDiagramScene | undefined;
			let thrown: unknown;
			try {
				scene = renderQuadrantDiagram(crowded);
			} catch (error) {
				thrown = error;
			}
			if (scene) {
				expect(quadrantLayoutIssues(scene, crowded)).toEqual([]);
				continue;
			}
			expect(thrown).toBeInstanceOf(QuadrantValidationError);
			const issue = (thrown as QuadrantValidationError).issues[0]!;
			expect(issue).toMatchObject({ code: "quadrant_too_large" });
			expect(issue.hint).toMatch(/Spread the scores/u);
		}
	});

	describe("before it rejects a chart", () => {
		// Labels on the middle line that no wrap can narrow, too wide for half of the smaller plots.
		const midline = (label: string, extra: object = {}) =>
			quadrant(
				[0.15, 0.35, 0.65, 0.85].map((y, index) => ({ label: `${label}${index}`, x: 0.5, y })),
				extra,
			);
		const sized = (scene: RenderedDiagramScene) => {
			const { plot } = readQuadrantScene(scene);
			const label = text(scene, "quadrant:label:0");
			return [plot!.right - plot!.left, label?.type === "text" ? label.fontSize : undefined];
		};

		it("tries every larger plot, though the labels block no fewer as it grows", () => {
			// All four stay blocked up to 720 pixels and sit beside their dots at 880.
			expect(sized(expectReadable(midline("あ".repeat(28))))).toEqual([880, 14]);
		});

		it("sets labels a size smaller, however many are blocked", () => {
			// A long name starts the plot at its largest, where all four fit only a size smaller.
			const diagram = midline("あ".repeat(34), {
				quadrants: { ...quadrantFixture.quadrants, topLeft: "あ".repeat(28) },
			});
			expect(sized(expectReadable(diagram))).toEqual([960, 12]);
		});
	});

	it("grows the plot until a name's longest word fits its quadrant", () => {
		const diagram = quadrant(quadrantFixture.points, {
			quadrants: { ...quadrantFixture.quadrants, topRight: "CustomerRelationshipManagement" },
		});
		const scene = expectReadable(diagram);
		const { plot } = readQuadrantScene(scene);
		expect(plot!.right - plot!.left).toBeGreaterThan(QUADRANT_PLOT_SIZES[0]);
	});

	it("grows the plot until both long end labels of the x axis sit apart", () => {
		const diagram = quadrant(quadrantFixture.points, {
			xAxis: {
				title: "Effort",
				low: "Underestimatedcomplexityofwork",
				high: "Overestimatedcomplexityofwork",
			},
		});
		expectReadable(diagram);
		const cjk = quadrant(quadrantFixture.points, {
			xAxis: {
				title: "工数",
				low: "データ連携".repeat(6),
				high: "データ連携".repeat(6),
			},
		});
		expectReadable(cjk);
	});

	it("gives groups that differ only in spacing one color and one legend entry", () => {
		const scene = expectReadable(
			quadrant([
				{ label: "Acme", x: 0.2, y: 0.8, group: "Our team" },
				{ label: "Globex", x: 0.7, y: 0.3, group: " our  team " },
			]),
		);
		expect(node(scene, "quadrant:point:1").fillColor).toBe(
			node(scene, "quadrant:point:0").fillColor,
		);
		expect(text(scene, "quadrant:legend:1:label")).toBeUndefined();
	});

	it("reports a dot moved off its position", () => {
		const scene = renderQuadrantDiagram(quadrantFixture);
		const moved = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "node" && element.nodeId === "quadrant:point:0"
					? { ...element, x: element.x + 3 }
					: element,
			),
		};
		expect(quadrantLayoutIssues(moved, quadrantFixture).map((issue) => issue.code)).toContain(
			"dot-position",
		);
	});
});
