import { describe, expect, it } from "vitest";

import {
	getCanvasValidationIssues,
	type JourneyDiagram,
	journeyFixture,
	journeyStressFixtures,
	parseJourneyDiagram,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram.js";
import { JOURNEY_MAX_ASPECT, renderJourneyDiagram } from "../journey.js";
import { journeyLayoutIssues, readJourneyScene } from "../journey-readout.js";
import type { RenderedDiagramScene, SceneElement } from "../scene.js";

const aspect = (scene: RenderedDiagramScene) => (scene.width - 80) / (scene.height - 80);
const find = (scene: RenderedDiagramScene, id: string) => {
	const element = scene.elements.find((entry) => entry.id === id);
	if (!element) throw new Error(`No element ${id}`);
	return element;
};
const journey = (stages: unknown[], extra: Record<string, unknown> = {}): JourneyDiagram =>
	parseJourneyDiagram({ id: "test", title: "Test journey", type: "journey", stages, ...extra });
/** The rise of one score in a band, read off its level labels. */
const pitchOf = (scene: RenderedDiagramScene, band = 0) => {
	const level = readJourneyScene(scene).levels[band]!;
	return level[2]! - level[3]!;
};
const steps = (count: number, prefix = "Step", score = 3) =>
	Array.from({ length: count }, (_, index) => ({ label: `${prefix} ${index + 1}`, score }));

describe("journey renderer", () => {
	it("renders the fixture into a valid deterministic scene", () => {
		const scene = renderDiagram(journeyFixture);
		expect(scene.diagramId).toBe("online-purchase-journey");
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(journeyLayoutIssues(scene)).toEqual([]);
		expect(renderDiagram(journeyFixture)).toEqual(scene);
	});

	it("draws stages across the top in order, each step's card under its stage in reading order", () => {
		const read = readJourneyScene(renderJourneyDiagram(journeyFixture));
		expect(read.stages.map((stage) => stage.name)).toEqual(["Discover", "Purchase", "Delivery"]);
		expect(read.stages.map((stage) => stage.box.left)).toEqual(
			read.stages.map((stage) => stage.box.left).toSorted((a, b) => a - b),
		);
		expect(read.steps.map((step) => step.label)).toEqual([
			"Sees an ad for running shoes",
			"Reads reviews",
			"Adds shoes to cart",
			"Creates an account to pay",
			"Pays by card",
			"Waits for the parcel",
			"Unboxes the shoes",
		]);
		for (const step of read.steps) {
			const stage = read.stages[step.stage]!;
			expect(step.box.left).toBeGreaterThanOrEqual(stage.box.left);
			expect(step.box.right).toBeLessThanOrEqual(stage.box.right);
			expect(step.box.top).toBeGreaterThan(stage.box.bottom);
		}
		// Every card shares one width and, in its band, one height.
		expect(new Set(read.steps.map((step) => step.box.right - step.box.left)).size).toBe(1);
		expect(new Set(read.steps.map((step) => step.box.bottom - step.box.top)).size).toBe(1);
		expect(read.steps[0]?.details).toBe("Instagram");
		expect(read.steps[6]?.details).toBeUndefined();
	});

	it("places a face per step under its card at its score, on a curve over a neutral baseline", () => {
		const scene = renderJourneyDiagram(journeyFixture);
		const read = readJourneyScene(scene);
		const baseline = read.baselines[0]!;
		for (const step of read.steps) {
			const face = step.face!;
			expect(face.center.x).toBeCloseTo((step.box.left + step.box.right) / 2, 5);
			expect(face.center.y).toBeCloseTo(baseline - (face.score - 3) * pitchOf(scene), 5);
			// A smile above neutral, a flat mouth on it, a frown below.
			expect(Math.sign(Math.round(face.mouth))).toBe(Math.sign(face.score - 3));
		}
		expect(read.steps.map((step) => step.face?.score)).toEqual([4, 3, 4, 2, 3, 2, 5]);
		expect(read.curves[0]).toEqual(read.steps.map((step) => step.face!.center));
		expect(find(scene, "line:journey:baseline:0")).toMatchObject({ strokeStyle: "dashed" });
		expect(find(scene, "node:journey:face:2-1")).toMatchObject({
			rendererRole: "journey-mark",
			label: "Very positive (5)",
			groupIds: ["journey:face:2-1"],
		});
		// The face's eyes and mouth move with it.
		for (const id of [
			"node:journey:face:2-1:eye-left",
			"node:journey:face:2-1:eye-right",
			"line:journey:face:2-1:mouth",
		])
			expect(find(scene, id)).toMatchObject({ groupIds: ["journey:face:2-1"] });
		// Rules and the curve lie behind every card and face.
		const order = scene.zOrder;
		expect(order.indexOf("line:journey:curve:0")).toBeLessThan(
			order.indexOf("node:journey:face:0-0"),
		);
	});

	it("puts each stage's pain points and opportunities in rows beneath it, and draws no empty row", () => {
		const scene = renderJourneyDiagram(journeyFixture);
		const read = readJourneyScene(scene);
		expect(read.notes.map((note) => [note.kind, note.stage, note.text])).toEqual([
			["pain-point", 0, "Reviews are hard to filter"],
			["pain-point", 1, "Forced account creation"],
			["pain-point", 1, "Shipping cost shown late"],
			["opportunity", 0, "Highlight reviews by runners"],
			["opportunity", 1, "Offer guest checkout"],
			["opportunity", 2, "Send live tracking updates"],
		]);
		for (const note of read.notes) {
			const stage = read.stages[note.stage]!;
			expect(note.box.left).toBe(stage.box.left);
			expect(note.box.right).toBe(stage.box.right);
		}
		// Every first note of a row starts on one line, under the curve.
		const tops = (kind: string) =>
			new Set(
				read.notes
					.filter((note) => note.kind === kind && note.index === 0)
					.map((note) => note.box.top),
			);
		expect(tops("pain-point").size).toBe(1);
		expect(tops("opportunity").size).toBe(1);
		expect(find(scene, "text:journey:row:0:pain-points")).toMatchObject({ text: "Pain points" });
		const bare = renderJourneyDiagram(journey([{ name: "Only", steps: steps(2) }]));
		expect(bare.elements.some((element) => element.id.startsWith("text:journey:row:0:pain"))).toBe(
			false,
		);
		expect(journeyLayoutIssues(bare)).toEqual([]);
	});

	it("names the persona and declared actors under the title, and each step's actor and touchpoint on its card", () => {
		const scene = renderJourneyDiagram(journeyStressFixtures.wordy);
		expect(find(scene, "text:journey:subtitle:0")).toMatchObject({
			text: "Persona: Priya Raman, head of procurement at a regulated healthcare company",
		});
		expect(find(scene, "text:journey:subtitle:1")).toMatchObject({
			text: "Actors: Procurement lead, Vendor account executive, Security reviewer",
		});
		const details = readJourneyScene(scene).steps.map((step) => step.details);
		// Each on its own lines when "actor · touchpoint" would not fit one.
		expect(details).toEqual([
			"Procurement lead Internal workshop",
			"Vendor account executive Video call",
			"Security reviewer Email",
		]);
		expect(find(scene, "text:journey:step:1-0:details")).toMatchObject({
			text: "Security reviewer\nEmail",
		});
		const both = renderJourneyDiagram(
			journey([
				{ name: "A", steps: [{ label: "Calls", score: 3, actor: "Dana", touchpoint: "Phone" }] },
			]),
		);
		expect(find(both, "text:journey:step:0-0:details")).toMatchObject({ text: "Dana · Phone" });
		const label = find(scene, "label:journey:step:0-0");
		expect(label).toMatchObject({ containerId: "node:journey:step:0-0", verticalAlign: "top" });
	});

	it("wraps every label at whole words and fits it in its card", () => {
		for (const diagram of [journeyFixture, ...Object.values(journeyStressFixtures)]) {
			const scene = renderJourneyDiagram(diagram);
			const words = new Set(
				diagram.stages.flatMap((stage) => [
					...stage.name.split(/\s+/u),
					...stage.steps.flatMap((step) => step.label.split(/\s+/u)),
				]),
			);
			for (const element of scene.elements)
				if (element.type === "text" && /^label:journey:(stage|step):/u.test(element.id))
					for (const word of element.text.split(/[\s]+/u))
						if (/^[\p{Script=Latin}\p{P}\d]+$/u.test(word)) expect(words.has(word)).toBe(true);
			expect(getCanvasValidationIssues(scene)).toEqual([]);
			expect(journeyLayoutIssues(scene)).toEqual([]);
		}
	});

	it("widens a stage's column to fit its header and notes, centering its steps", () => {
		const scene = renderJourneyDiagram(
			journey([
				{ name: "Report", steps: [{ label: "Opens a ticket", score: 2 }] },
				{
					name: "Acknowledgement",
					steps: [{ label: "Reads reply", score: 3 }],
					painPoints: ["Internationalization"],
				},
			]),
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(journeyLayoutIssues(scene)).toEqual([]);
		const read = readJourneyScene(scene);
		const stage = read.stages[1]!;
		const card = read.steps.find((step) => step.stage === 1)!;
		expect(stage.box.right - stage.box.left).toBeGreaterThan(card.box.right - card.box.left);
		expect((card.box.left + card.box.right) / 2).toBeCloseTo(
			(stage.box.left + stage.box.right) / 2,
			5,
		);
	});

	it("prints each step's score above its face and labels every level of the scale", () => {
		const scene = renderJourneyDiagram(journeyFixture);
		const read = readJourneyScene(scene);
		for (const step of read.steps) {
			expect(step.face?.written).toBe(step.face?.score);
			const score = find(scene, `text:journey:score:${step.stage}-${step.index}`);
			expect(score).toMatchObject({ groupIds: [`journey:face:${step.stage}-${step.index}`] });
			if (score.type !== "text") throw new Error("Expected a text.");
			expect(score.y).toBeLessThan(step.face!.center.y - 14);
		}
		const levels = [1, 2, 3, 4, 5].map((level) => find(scene, `text:journey:level:0:${level}`));
		expect(levels.map((level) => (level.type === "text" ? level.text : ""))).toEqual([
			"1",
			"2",
			"3 · Neutral",
			"4",
			"5",
		]);
		// Every face sits exactly on its level's line, and each level has a faint rule but neutral's dash.
		for (const step of read.steps) {
			const level = find(scene, `text:journey:level:0:${step.face!.score}`);
			expect(level.type === "text" && level.y).toBeCloseTo(step.face!.center.y, 5);
		}
		for (const level of [1, 2, 4, 5])
			expect(find(scene, `line:journey:level:0:${level}`)).toMatchObject({ type: "line" });
		expect(read.levels[0]).toEqual(levels.map((level) => (level.type === "text" ? level.y : NaN)));
	});

	it("narrows cards and raises the curve before a wide journey wraps", () => {
		// Eight steps fit one band once the cards narrow.
		const eight = renderJourneyDiagram(
			journey([
				{
					name: "One",
					steps: steps(2, "Compares three running shoe models"),
					painPoints: ["Sizes aren't shown until the product page"],
					opportunities: ["Show stock by size in search results"],
				},
				{
					name: "Two",
					steps: steps(2, "Reads every review on the brand site"),
					painPoints: ["No notice of the delay"],
				},
				{ name: "Three", steps: steps(2, "Checks out as a guest") },
				{ name: "Four", steps: steps(2, "Gets a shipping confirmation") },
			]),
		);
		expect(readJourneyScene(eight).baselines).toHaveLength(1);
		expect(aspect(eight)).toBeLessThanOrEqual(JOURNEY_MAX_ASPECT);
		expect(journeyLayoutIssues(eight)).toEqual([]);
	});

	it("wraps a journey too wide for one band into bands of whole stages, its curve running on", () => {
		const scene = renderJourneyDiagram(journeyStressFixtures.longest);
		const read = readJourneyScene(scene);
		expect(aspect(scene)).toBeLessThanOrEqual(JOURNEY_MAX_ASPECT);
		expect(read.baselines.length).toBeGreaterThan(1);
		// Earlier bands are at least as full as later ones.
		const tops = [...new Set(read.stages.map((stage) => stage.box.top))];
		const perBand = tops.map((top) => read.stages.filter((stage) => stage.box.top === top).length);
		expect(perBand).toEqual(perBand.toSorted((a, b) => b - a));
		expect(journeyLayoutIssues(scene)).toEqual([]);
		// The curve leaves each band toward the next step's score and enters the next from the last one's.
		const out = find(scene, "line:journey:curve-out:0");
		const into = find(scene, "line:journey:curve-in:1");
		expect(out).toMatchObject({ strokeStyle: "dashed" });
		expect(into).toMatchObject({ strokeStyle: "dashed" });
		const lastOfBand = read.steps
			.filter((step) => read.stages[step.stage]!.box.top === tops[0])
			.at(-1)!;
		const firstOfNext = read.steps.find((step) => read.stages[step.stage]!.box.top === tops[1])!;
		const points = (element: SceneElement) => (element.type === "line" ? element.points : []);
		expect(points(out)[0]).toEqual(lastOfBand.face!.center);
		expect(points(out)[1].y).toBeCloseTo(
			read.baselines[0]! - (firstOfNext.face!.score - 3) * pitchOf(scene, 0),
			5,
		);
		expect(points(into).at(-1)).toEqual(firstOfNext.face!.center);
		expect(points(into)[0].y).toBeCloseTo(
			read.baselines[1]! - (lastOfBand.face!.score - 3) * pitchOf(scene, 1),
			5,
		);
		expect(find(scene, "text:journey:continued:1")).toMatchObject({ text: "continued" });
		expect(scene.elements.some((element) => element.id === "line:journey:curve-in:0")).toBe(false);
	});

	it("runs a stage too long for one band on into the next, its header marked as continued", () => {
		const scene = renderJourneyDiagram(journeyStressFixtures.longStage);
		const read = readJourneyScene(scene);
		expect(aspect(scene)).toBeLessThanOrEqual(JOURNEY_MAX_ASPECT);
		expect(read.stages).toHaveLength(1);
		expect(read.stages[0]?.continued).toHaveLength(1);
		const continued = scene.elements.find(
			(element) => element.type === "node" && element.kind === "journey-stage-continued",
		);
		expect(continued).toMatchObject({ label: "Stage 1 (continued)" });
		// Its notes stand under its first part.
		const pain = read.notes.find((note) => note.kind === "pain-point")!;
		expect(pain.box.left).toBe(read.stages[0]!.box.left);
		expect(pain.box.top).toBeLessThan(read.stages[0]!.continued[0]!.top);
		expect(journeyLayoutIssues(scene)).toEqual([]);
	});

	it("holds every stress journey to its layout rules and a readable aspect", () => {
		for (const [name, diagram] of Object.entries(journeyStressFixtures)) {
			const scene = renderJourneyDiagram(diagram);
			expect(getCanvasValidationIssues(scene), name).toEqual([]);
			expect(journeyLayoutIssues(scene), name).toEqual([]);
			expect(aspect(scene), name).toBeLessThanOrEqual(JOURNEY_MAX_ASPECT);
		}
	});

	it("flags a face moved off its step, a sad face on a 5 and a curve off its faces", () => {
		const scene = renderJourneyDiagram(journeyFixture);
		const edit = (id: string, change: (element: SceneElement) => SceneElement) => ({
			...scene,
			elements: scene.elements.map((element) => (element.id === id ? change(element) : element)),
		});
		const shifted = edit("node:journey:face:0-0", (element) =>
			element.type === "node" ? { ...element, x: element.x + 60 } : element,
		);
		expect(journeyLayoutIssues(shifted).map((issue) => issue.code)).toContain("face-off-step");
		const sad = edit("line:journey:face:2-1:mouth", (element) =>
			element.type === "line"
				? {
						...element,
						points: element.points.map((point, index) =>
							index === 1 ? { ...point, y: point.y - 12 } : point,
						) as typeof element.points,
					}
				: element,
		);
		expect(journeyLayoutIssues(sad).map((issue) => issue.code)).toEqual(["face-wrong-expression"]);
		const rescored = edit("node:journey:face:2-1", (element) =>
			element.type === "node" ? { ...element, label: "Negative (2)" } : element,
		);
		expect(journeyLayoutIssues(rescored).map((issue) => issue.code)).toContain("face-off-score");
		const straight = edit("line:journey:curve:0", (element) =>
			element.type === "line"
				? { ...element, points: [element.points[0], element.points.at(-1)!] }
				: element,
		);
		expect(journeyLayoutIssues(straight).map((issue) => issue.code)).toEqual(["curve-off-faces"]);
	});
});
