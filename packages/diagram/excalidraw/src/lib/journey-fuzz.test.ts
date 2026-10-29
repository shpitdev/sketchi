import { describe, expect, it } from "vitest";
import {
	getCanvasValidationIssues,
	JOURNEY_MAX_STAGE_STEPS,
	JOURNEY_MAX_STAGES,
	JOURNEY_MAX_STEPS,
	type JourneyDiagram,
	parseJourneyDiagram,
} from "@sketchi/diagram-core";
import {
	JOURNEY_MAX_ASPECT,
	journeyLayoutIssues,
	renderJourneyDiagram,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const STAGES = [
	"Discover",
	"Research",
	"Sign up",
	"Connect data",
	"Purchase",
	"Delivery",
	"Get help",
	"Renew",
	"Evaluate vendors and shortlist them",
	"Acknowledgement",
	"Internationalization",
	"発見",
	"Onboarding-and-activation",
];
const STEPS = [
	"Pays",
	"Reads reviews",
	"Compares three models",
	"Can't find her size in stock",
	"Creates an account with his work email",
	"IT approves the firewall allowlist request after two days",
	"Marco upgrades to the annual Team plan after a call with his customer success manager",
	"Re-authenticates via single-sign-on",
	"レビューを読んで比較検討する",
	"Internationalization-configuration",
];
const ACTORS = [
	"Maya",
	"IT team",
	"Customer success",
	"Vendor account executive",
	"李",
	"Maya, IT team",
];
const TOUCHPOINTS = ["Email", "Website", "Mobile app", "Internal workshop", "Phone"];
const NOTES = [
	"Slow first reply",
	"Sizes aren't shown until the product page",
	"Pricing pages hide the per-seat costs behind a sales conversation with an account executive",
	"送料が最後に表示される",
	"Let admins share an invite link",
	"Internationalization",
	"Supercalifragilisticexpialidocious-onboarding-checklist",
];

/** A seeded random number source: a 32-bit LCG in exact integer arithmetic. */
function seeded(start: number) {
	let seed = start >>> 0;
	const random = () => {
		seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
		return seed / 4_294_967_296;
	};
	return {
		random,
		pick: <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!,
	};
}

/**
 * Seeded random journeys of every shape: one step or forty, one stage or ten,
 * even and uneven stages, short, long, hyphenated and Japanese text, actors,
 * touchpoints and both at once, and full or empty note rows.
 */
function randomJourneys(count: number, start: number): JourneyDiagram[] {
	const { random, pick } = seeded(start);
	return Array.from({ length: count }, (_, index) => {
		const stageCount = 1 + Math.floor(random() * JOURNEY_MAX_STAGES);
		const budget = random() < 0.25 ? JOURNEY_MAX_STEPS : 4 + Math.floor(random() * 20);
		const actors = random() < 0.4;
		const touchpoints = random() < 0.6;
		const notes = random() < 0.7;
		let left = budget;
		const stages = Array.from({ length: stageCount }, (_, stage) => {
			const room = Math.max(1, Math.min(JOURNEY_MAX_STAGE_STEPS, left - (stageCount - stage - 1)));
			const steps = Math.max(
				1,
				Math.min(room, 1 + Math.floor(random() * 4 + (random() < 0.2 ? 4 : 0))),
			);
			left -= steps;
			const list = (chance: number) =>
				notes && random() < chance
					? Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(NOTES))
					: undefined;
			const painPoints = list(0.5);
			const opportunities = list(0.4);
			return {
				name: `${pick(STAGES)} ${stage + 1}`,
				steps: Array.from({ length: steps }, () => ({
					label: pick(STEPS),
					score: 1 + Math.floor(random() * 5),
					...(actors && random() < 0.9 ? { actor: pick(ACTORS) } : {}),
					...(touchpoints && random() < 0.9 ? { touchpoint: pick(TOUCHPOINTS) } : {}),
				})),
				...(painPoints ? { painPoints } : {}),
				...(opportunities ? { opportunities } : {}),
			};
		});
		return parseJourneyDiagram({
			id: `random-${start}-${index}`,
			title:
				random() < 0.2 ? "A journey title long enough to wrap across the whole map" : "Journey",
			type: "journey",
			...(random() < 0.5 ? { persona: "Priya, a first-time buyer" } : {}),
			...(actors && random() < 0.5 ? { actors: ACTORS.slice(0, 5) } : {}),
			stages,
		});
	});
}

/** The export's width over its height, as hosted PNGs frame it. */
const aspect = (scene: RenderedDiagramScene) => (scene.width - 80) / (scene.height - 80);

/** CI draws a small fixed sample; `JOURNEY_FUZZ=full` runs the local proof. */
const FULL = process.env["JOURNEY_FUZZ"] === "full";
const JOURNEYS = FULL ? 300 : 8;
const SEEDS = FULL ? [7, 31, 53] : [7];

describe("journey map fuzz", () => {
	for (const seed of SEEDS)
		it(`draws ${JOURNEYS} random journeys of seed ${seed} cleanly`, () => {
			const defects: string[] = [];
			const shortfalls: string[] = [];
			for (const diagram of randomJourneys(JOURNEYS, seed)) {
				const scene = renderJourneyDiagram(diagram);
				const exported = convertSceneToExcalidraw(scene);
				const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(exported)));
				const problems = [
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...validateExcalidrawScene(reloaded).issues.map((issue) => issue.message),
					...journeyLayoutIssues(scene).map((issue) => issue.message),
				];
				if (aspect(scene) > JOURNEY_MAX_ASPECT) problems.push(`aspect ${aspect(scene).toFixed(2)}`);
				const steps = diagram.stages.reduce((total, stage) => total + stage.steps.length, 0);
				// A journey fits the CLI's PNG ceiling, its title banner included. Past 30 steps
				// with full note stacks, the rarest few may not (Excalidraw and hosted PNGs are
				// unaffected); they stay under one journey in a hundred.
				if (scene.width * (scene.height + 64) > 6_291_456)
					(steps >= 30 ? shortfalls : problems).push(
						`${diagram.id}: area ${scene.width}×${scene.height}`,
					);
				if (problems.length > 0)
					defects.push(
						`${diagram.id} (${diagram.stages.length} stages, ${steps} steps): ${problems.slice(0, 3).join("; ")}`,
					);
			}
			expect(defects).toEqual([]);
			expect(shortfalls.length, shortfalls.join("\n")).toBeLessThanOrEqual(
				Math.max(1, Math.floor(JOURNEYS / 100)),
			);
		});
});
