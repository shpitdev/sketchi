import { describe, expect, it } from "vitest";

import {
	getCanvasValidationIssues,
	groupRegionIssues,
	type OrgChartDiagram,
	orgChartFixture,
	orgChartStressFixtures,
	parseOrgChartDiagram,
	resolveOrgChartShorthand,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram.js";
import { layoutOrgChartDiagram, renderOrgChartDiagram } from "../org-chart.js";
import { orgChartLayoutIssues } from "../org-chart-readout.js";
import type {
	ArrowSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	TextSceneElement,
} from "../scene.js";

const chart = (people: unknown[], extra: Record<string, unknown> = {}): OrgChartDiagram =>
	parseOrgChartDiagram(
		resolveOrgChartShorthand({ id: "team", title: "Team", type: "org-chart", people, ...extra }),
	);

function element<T extends RenderedDiagramScene["elements"][number]["type"]>(
	scene: RenderedDiagramScene,
	id: string,
	type: T,
): Extract<RenderedDiagramScene["elements"][number], { type: T }> {
	const found = scene.elements.find((candidate) => candidate.id === id);
	if (found?.type !== type) throw new Error(`No ${type} "${id}" in the scene.`);
	return found as Extract<RenderedDiagramScene["elements"][number], { type: T }>;
}
const card = (scene: RenderedDiagramScene, id: string) => element(scene, `node:${id}`, "node");
const line = (scene: RenderedDiagramScene, id: string) => element(scene, `edge:${id}`, "arrow");
const cards = (scene: RenderedDiagramScene) =>
	scene.elements.filter(
		(candidate): candidate is NodeSceneElement =>
			candidate.type === "node" && (candidate.kind === "person" || candidate.kind === "assistant"),
	);
/** The cards of a manager's direct reports. */
const reportsOf = (scene: RenderedDiagramScene, manager: string) =>
	cards(scene).filter((box) =>
		scene.elements.some(
			(candidate) =>
				candidate.type === "arrow" &&
				candidate.id === `edge:${box.nodeId}` &&
				candidate.sourceNodeId === manager,
		),
	);
const center = (box: NodeSceneElement) => box.x + box.width / 2;
const bottom = (box: NodeSceneElement) => box.y + box.height;

/** Export width over height, as hosted PNGs frame the drawing. */
const aspect = (scene: RenderedDiagramScene) => (scene.width - 40) / (scene.height - 40);

describe("org chart renderer", () => {
	it("renders the fixture into a valid, deterministic scene", () => {
		const scene = renderDiagram(orgChartFixture);
		expect(scene.diagramId).toBe("startup-team");
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(orgChartLayoutIssues(scene)).toEqual([]);
		expect(renderDiagram(orgChartFixture)).toEqual(scene);
	});

	it("draws a card of name over title and department, grouped so it moves as one", () => {
		const scene = renderOrgChartDiagram(orgChartFixture);
		const ada = card(scene, "ada");
		expect(ada).toMatchObject({ kind: "person", shape: "rectangle", label: "Ada Lovelace" });
		expect(element(scene, "label:ada", "text")).toMatchObject({
			containerId: "node:ada",
			text: "Chief Executive Officer\nExecutive",
			verticalAlign: "bottom",
			groupIds: ["person:ada"],
		});
		const name = element(scene, "text:ada:name", "text");
		expect(name).toMatchObject({ text: "Ada Lovelace", groupIds: ["person:ada"] });
		expect(name.y).toBeLessThan(element(scene, "label:ada", "text").y);
		expect(ada.groupIds).toEqual(["person:ada"]);
	});

	it("names a department only where it starts", () => {
		const scene = renderOrgChartDiagram(orgChartFixture);
		expect(element(scene, "label:linus", "text").text).toBe(
			"Chief Technology Officer\nEngineering",
		);
		expect(element(scene, "label:margaret", "text").text).toBe("Engineering Manager");
		// Its department's color marks the card instead.
		expect(card(scene, "margaret").strokeColor).toBe(card(scene, "linus").strokeColor);
		expect(card(scene, "radia").strokeColor).not.toBe(card(scene, "linus").strokeColor);
	});

	it("colors each branch below the top when no department is named", () => {
		const scene = renderOrgChartDiagram(
			chart([
				{ id: "ceo", name: "Maya Chen", title: "CEO" },
				{ id: "cto", name: "Jordan Patel", manager: "ceo" },
				{ id: "dev", name: "Alex Kim", manager: "cto" },
				{ id: "cpo", name: "Priya Nair", manager: "ceo" },
			]),
		);
		expect(card(scene, "dev").strokeColor).toBe(card(scene, "cto").strokeColor);
		expect(card(scene, "cpo").strokeColor).not.toBe(card(scene, "cto").strokeColor);
		expect(card(scene, "ceo").strokeColor).toBe(scene.accentColor);
	});

	it("runs a bus from each manager's stem down to each report's top, with no heads", () => {
		const scene = renderOrgChartDiagram(orgChartFixture);
		const ada = card(scene, "ada");
		for (const report of ["linus", "radia"]) {
			const reportLine = line(scene, report);
			const target = card(scene, report);
			expect(reportLine).toMatchObject({
				sourceNodeId: "ada",
				targetNodeId: report,
				startArrowhead: null,
				endArrowhead: null,
				roughness: 0,
			});
			expect(reportLine.points[0]).toEqual({ x: center(ada), y: bottom(ada) });
			expect(reportLine.points.at(-1)).toEqual({ x: center(target), y: target.y });
		}
		// Both lines leave the stem at one bus height.
		expect(line(scene, "linus").points[1]!.y).toBe(line(scene, "radia").points[1]!.y);
		expect(card(scene, "linus").y).toBe(card(scene, "radia").y);
	});

	it("hangs an assistant off their manager's stem, beside it and above the reports", () => {
		const scene = renderOrgChartDiagram(orgChartFixture);
		const ada = card(scene, "ada");
		const grace = card(scene, "grace");
		const assistantLine = line(scene, "grace");
		expect(grace.kind).toBe("assistant");
		expect(grace.x).toBeGreaterThan(center(ada));
		expect(grace.y).toBeGreaterThan(bottom(ada));
		expect(bottom(grace)).toBeLessThan(card(scene, "linus").y);
		expect(assistantLine.points).toEqual([
			{ x: center(ada), y: bottom(ada) },
			{ x: center(ada), y: grace.y + grace.height / 2 },
			{ x: grace.x, y: grace.y + grace.height / 2 },
		]);
	});

	it("stacks a manager's eight leaf reports in two columns either side of the stem", () => {
		const scene = renderOrgChartDiagram(
			chart([
				{ id: "lead", name: "Aisha Bello", title: "Director" },
				...Array.from({ length: 8 }, (_, index) => ({
					id: `e${index}`,
					name: `Engineer ${index + 1}`,
					title: "Engineer",
					manager: "lead",
				})),
			]),
		);
		const manager = card(scene, "lead");
		const leaves = reportsOf(scene, "lead");
		expect(leaves).toHaveLength(8);
		const stem = center(manager);
		const left = leaves.filter((box) => box.x + box.width < stem);
		const right = leaves.filter((box) => box.x > stem);
		expect([left.length, right.length]).toEqual([4, 4]);
		expect(new Set(leaves.map((box) => box.y)).size).toBe(4);
		for (const box of leaves) {
			const points = line(scene, box.nodeId).points;
			expect(points[0]).toEqual({ x: stem, y: bottom(manager) });
			expect(points.at(-1)!.x).toBe(box.x > stem ? box.x : box.x + box.width);
			expect(points.at(-1)!.y).toBe(box.y + box.height / 2);
		}
	});

	it("stacks in one column, rather than wrap the level above, when two would read too wide", () => {
		const scene = renderOrgChartDiagram(orgChartStressFixtures.department);
		const managers = reportsOf(scene, "p0");
		// Every manager stays level, each team in one column down their left.
		expect(new Set(managers.map((box) => box.y)).size).toBe(1);
		for (const manager of managers) {
			const team = reportsOf(scene, manager.nodeId);
			expect(new Set(team.map((box) => box.x)).size, manager.nodeId).toBe(1);
			expect(team[0]!.x).toBeGreaterThan(manager.x);
		}
		expect(layoutOrgChartDiagram(orgChartStressFixtures.department).wraps.size).toBe(0);
	});

	it("keeps the top two levels in rows, listing small teams along their manager's stem", () => {
		const diagram = orgChartStressFixtures.eighty;
		const scene = renderOrgChartDiagram(diagram);
		const layout = layoutOrgChartDiagram(diagram);
		const vps = reportsOf(scene, "p0");
		expect(vps).toHaveLength(6);
		expect(new Set(vps.map((box) => box.y)).size).toBe(1);
		expect(layout.wraps.size).toBe(0);
		expect(layout.outlines.size).toBeGreaterThan(0);
		for (const [id] of layout.outlines) {
			// Each listed report hangs off the stem by a short stub at its middle.
			const manager = card(scene, id);
			for (const report of reportsOf(scene, id)) {
				const points = line(scene, report.nodeId).points;
				expect(points[0].y).toBe(bottom(manager));
				expect(points.at(-1)!.y).toBe(report.y + report.height / 2);
			}
		}
	});

	it("stacks twenty reports in two columns of ten rather than one long row", () => {
		const scene = renderOrgChartDiagram(orgChartStressFixtures.twentyReports);
		const leaves = reportsOf(scene, "p1");
		expect(leaves).toHaveLength(20);
		expect(new Set(leaves.map((box) => box.x)).size).toBe(2);
		expect(new Set(leaves.map((box) => box.y)).size).toBe(10);
	});

	it("wraps a row too wide to read into rows hung from a trunk", () => {
		const scene = renderOrgChartDiagram(orgChartStressFixtures.wide);
		const vps = reportsOf(scene, "p0");
		expect(vps).toHaveLength(12);
		expect(new Set(vps.map((box) => box.y)).size).toBeGreaterThan(1);
		expect(aspect(scene)).toBeLessThanOrEqual(2.5);
		expect(layoutOrgChartDiagram(orgChartStressFixtures.wide).wraps.get("p0")).toBeGreaterThan(1);
	});

	it("keeps a small team as a tree, stacking leaves only when the chart reads too wide", () => {
		const small = layoutOrgChartDiagram(
			chart([
				{ id: "lead", name: "Lead" },
				{ id: "a", name: "A", manager: "lead" },
				{ id: "b", name: "B", manager: "lead" },
			]),
		);
		expect(small.stackMin).toBe(5);
		expect(small.cards.get("a")!.y).toBe(small.cards.get("b")!.y);
		expect(layoutOrgChartDiagram(orgChartFixture).stackMin).toBe(5);
		expect(layoutOrgChartDiagram(orgChartStressFixtures.eighty).stackMin).toBe(2);
	});

	it("gives every card of a level one width", () => {
		const scene = renderOrgChartDiagram(orgChartStressFixtures.eighty);
		const layout = layoutOrgChartDiagram(orgChartStressFixtures.eighty);
		const depthOf = new Map<string, number>([["p0", 0]]);
		for (const person of orgChartStressFixtures.eighty.people)
			if (person.manager) depthOf.set(person.id, depthOf.get(person.manager)! + 1);
		const widths = new Map<number, Set<number>>();
		for (const box of cards(scene)) {
			const depth = depthOf.get(box.nodeId)!;
			widths.set(depth, new Set([...(widths.get(depth) ?? []), box.width]));
		}
		for (const set of widths.values()) expect(set.size).toBe(1);
		expect(layout.cards.size).toBe(80);
	});

	it("draws dotted lines dashed with a head at the second manager, clear of every card", () => {
		const scene = renderOrgChartDiagram(orgChartFixture);
		const dotted = element(scene, "edge:dotted:ken-to-radia", "arrow");
		expect(dotted).toMatchObject({
			edgeId: "dotted:ken-to-radia",
			sourceNodeId: "ken",
			targetNodeId: "radia",
			strokeStyle: "dashed",
			startArrowhead: null,
			endArrowhead: "arrow",
		});
		expect(dotted.strokeColor).not.toBe(line(scene, "ken").strokeColor);
		expect(orgChartLayoutIssues(scene)).toEqual([]);
	});

	it("routes a dotted line around the hierarchy, labeled on its line and clear of every card", () => {
		// Nina sits in Rahul's stack, boxed in by his spine; Linda's team stands between them.
		const people = [
			["sarah", "Dr. Sarah Okafor", "Chief Executive Officer"],
			["daniel", "Daniel Kim", "Executive Assistant", "sarah"],
			["michael", "Michael Torres", "Chief Financial Officer", "sarah"],
			["linda", "Linda Park", "Chief Operating Officer", "sarah"],
			["rahul", "Rahul Mehta", "Chief Technology Officer", "sarah"],
			["grace", "Grace Liu", "Controller", "michael"],
			["owen", "Owen Hughes", "FP&A Manager", "michael"],
			["fatima", "Fatima Hassan", "Director of Clinical Operations", "linda"],
			["ben", "Ben Carter", "Director of Facilities", "linda"],
			["nina", "Nina Rossi", "Director of IT", "rahul"],
			["victor", "Victor Alvarez", "Security Lead", "rahul"],
		].map(([id, name, title, manager]) => ({
			id,
			name,
			title,
			...(manager ? { manager } : {}),
			...(id === "daniel" ? { assistant: true } : {}),
		}));
		const scene = renderOrgChartDiagram(
			chart(people, {
				dottedLines: [{ report: "nina", manager: "linda", label: "for clinical systems" }],
			}),
		);
		expect(orgChartLayoutIssues(scene)).toEqual([]);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		const dotted = element(scene, "edge:dotted:nina-dotted-linda", "arrow");
		const runsOf = (arrow: ArrowSceneElement) =>
			arrow.points.slice(1).map((to, index) => ({ from: arrow.points[index]!, to }));
		const runs = runsOf(dotted);
		// It crosses no reporting line.
		const solid = scene.elements.flatMap((candidate) =>
			candidate.type === "arrow" && !candidate.edgeId.startsWith("dotted:")
				? runsOf(candidate)
				: [],
		);
		type Run = (typeof runs)[number];
		const crosses = (left: Run, right: Run) => {
			const [across, along] = left.from.y === left.to.y ? [left, right] : [right, left];
			if (across.from.y !== across.to.y || along.from.x !== along.to.x) return false;
			const { x } = along.from;
			const { y } = across.from;
			return (
				x > Math.min(across.from.x, across.to.x) + 0.5 &&
				x < Math.max(across.from.x, across.to.x) - 0.5 &&
				y > Math.min(along.from.y, along.to.y) + 0.5 &&
				y < Math.max(along.from.y, along.to.y) - 0.5
			);
		};
		expect(runs.filter((run) => solid.some((other) => crosses(run, other)))).toEqual([]);
		// The label sits beside one of its runs, as near as the text allows.
		const label = element(scene, "text:dotted:nina-dotted-linda", "text");
		expect(label.text.replace(/\s+/gu, " ")).toBe("for clinical systems");
		const half = { x: label.maxWidth! / 2, y: (label.text.split("\n").length * 13 * 1.35) / 2 };
		const gap = Math.min(
			...runs.map(({ from, to }) =>
				Math.max(
					Math.min(from.x, to.x) - (label.x + half.x),
					label.x - half.x - Math.max(from.x, to.x),
					Math.min(from.y, to.y) - (label.y + half.y),
					label.y - half.y - Math.max(from.y, to.y),
				),
			),
		);
		expect(gap).toBeLessThanOrEqual(16);
	});

	it("draws each department below the top as a region, without nesting", () => {
		const diagram = orgChartStressFixtures.regions;
		const scene = renderOrgChartDiagram(diagram);
		const frames = scene.elements.filter((candidate) => candidate.type === "frame");
		const departments = new Set(
			diagram.people.filter((person) => person.manager === "p0").map((person) => person.department),
		);
		expect(new Set(frames.map((frame) => frame.name))).toEqual(departments);
		expect(groupRegionIssues(scene)).toEqual([]);
		for (const box of cards(scene).filter((candidate) => candidate.nodeId !== "p0"))
			expect(box.frameId, box.nodeId).toMatch(/^frame:p[1-4]$/u);
		// Inside a region of its own department, a card leaves the name to the region.
		const vp = diagram.people.find((person) => person.manager === "p0")!;
		expect(element(scene, `label:${vp.id}`, "text").text).not.toContain(vp.department!);
	});

	it("draws an avatar placeholder of initials above the name", () => {
		const scene = renderOrgChartDiagram(
			chart([{ id: "ceo", name: "Ada Lovelace", title: "CEO", avatar: true }]),
		);
		const avatar = element(scene, "node:ceo:avatar", "node");
		const box = card(scene, "ceo");
		expect(avatar).toMatchObject({ shape: "ellipse", label: "AL", groupIds: ["person:ceo"] });
		expect(avatar.x).toBeGreaterThan(box.x);
		expect(avatar.y).toBeGreaterThan(box.y);
		expect(avatar.y + avatar.height).toBeLessThan(element(scene, "text:ceo:name", "text").y);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("wraps long names and titles whole, never cutting them", () => {
		const name = "Maximiliana Alexandrovna Konstantinopoulou-Wetherby";
		const title = "Senior Vice President of Global Partnerships and Strategic Alliances";
		const scene = renderOrgChartDiagram(
			chart([{ id: "svp", name, title, department: "Business Development" }]),
		);
		// Lines break at spaces and after hyphens; every character stays.
		const letters = (text: string) => text.replace(/\s+/gu, "");
		expect(letters(element(scene, "text:svp:name", "text").text)).toBe(letters(name));
		expect(letters(element(scene, "label:svp", "text").text)).toBe(
			letters(`${title} Business Development`),
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(orgChartLayoutIssues(scene)).toEqual([]);
	});

	it.each(Object.entries(orgChartStressFixtures))(
		"lays out %s with no overlap, no crossing and orthogonal lines",
		(_, diagram) => {
			const scene = renderOrgChartDiagram(diagram);
			expect(getCanvasValidationIssues(scene)).toEqual([]);
			expect(orgChartLayoutIssues(scene)).toEqual([]);
			const arrows = scene.elements.filter(
				(candidate): candidate is ArrowSceneElement => candidate.type === "arrow",
			);
			expect(arrows).toHaveLength(diagram.people.length - (diagram.forest ? 3 : 1));
			const texts = scene.elements.filter(
				(candidate): candidate is TextSceneElement => candidate.type === "text",
			);
			expect(texts.length).toBeGreaterThanOrEqual(diagram.people.length);
		},
	);

	it("keeps eighty people readable: under 2.5 to 1 and inside the PNG ceiling", () => {
		const scene = renderOrgChartDiagram(orgChartStressFixtures.eighty);
		expect(aspect(scene)).toBeLessThanOrEqual(2.5);
		expect(scene.width * (scene.height + 64)).toBeLessThan(6_291_456);
	});
});
