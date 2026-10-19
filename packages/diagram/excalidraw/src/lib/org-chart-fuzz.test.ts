import { describe, expect, it } from "vitest";
import {
	getCanvasValidationIssues,
	groupRegionIssues,
	type OrgChartDiagram,
	parseOrgChartDiagram,
} from "@sketchi/diagram-core";
import {
	orgChartLayoutIssues,
	renderOrgChartDiagram,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

const FIRST = ["Ada", "Grace", "Linus", "Margaret", "Ken", "Radia", "Don", "Barbara", "李", "José"];
const LAST = [
	"Lovelace",
	"Hopper",
	"Torvalds",
	"Hamilton-Wetherby",
	"Thompson",
	"Perlman",
	"Konstantinopoulou",
	"Liskov",
	"雷",
	"Núñez",
];
const TITLES = [
	"CEO",
	"Engineer",
	"Senior Vice President of Global Partnerships and Strategic Alliances",
	"Director of Platform Engineering",
	"Product Designer",
	"Head of People",
	"データエンジニア",
	"Executive Assistant to the Chief Operating Officer",
];
const DEPARTMENTS = ["Engineering", "Product", "Sales", "Customer Success", "Finance", "法務"];
const LABELS = ["matrix", "clinical systems", "for the platform migration program"];

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
 * Seeded random org charts of every shape: a few people or a hundred, flat,
 * deep, bushy or one wide team, with assistants, dotted lines, departments
 * (sometimes as regions), avatars, long and non-Latin names, and forests.
 */
function randomCharts(count: number, start: number): OrgChartDiagram[] {
	const { random, pick } = seeded(start);
	return Array.from({ length: count }, (_, index) => {
		const size = random() < 0.3 ? 2 + Math.floor(random() * 12) : 12 + Math.floor(random() * 89);
		const shape = pick(["flat", "deep", "bushy", "random", "wide-team"] as const);
		const roots = random() < 0.15 ? 2 + Math.floor(random() * 2) : 1;
		const depth = new Map<number, number>();
		const managers: (number | undefined)[] = [];
		for (let at = 0; at < size; at += 1) {
			if (at < roots) {
				managers.push(undefined);
				depth.set(at, 0);
				continue;
			}
			const candidates = [...depth].filter(([, level]) => level < 11).map(([id]) => id);
			const manager =
				shape === "flat"
					? Math.floor(random() * roots)
					: shape === "deep"
						? candidates[Math.max(0, candidates.length - 1 - Math.floor(random() * 3))]!
						: shape === "wide-team"
							? at < roots + 3
								? Math.floor(random() * roots)
								: roots + Math.floor(random() * Math.min(3, at - roots))
							: shape === "bushy"
								? candidates[Math.floor(random() * Math.min(candidates.length, 1 + at / 4))]!
								: pick(candidates);
			managers.push(manager);
			depth.set(at, depth.get(manager)! + 1);
		}
		const reports = new Map<number, number>();
		for (const manager of managers)
			if (manager !== undefined) reports.set(manager, (reports.get(manager) ?? 0) + 1);
		const departments = random() < 0.6;
		const departmentOf = (at: number): string => {
			const manager = managers[at];
			if (manager === undefined) return pick(DEPARTMENTS);
			return random() < 0.2 ? pick(DEPARTMENTS) : departmentOf(manager);
		};
		const people = managers.map((manager, at) => ({
			id: `p${at}`,
			name:
				random() < 0.1
					? `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`
					: `${pick(FIRST)} ${pick(LAST)}`,
			...(random() < 0.9 ? { title: pick(TITLES) } : {}),
			...(departments && random() < 0.95 ? { department: departmentOf(at) } : {}),
			...(manager === undefined ? {} : { manager: `p${manager}` }),
			...(manager !== undefined && !reports.has(at) && random() < 0.06 ? { assistant: true } : {}),
			...(random() < 0.08 ? { avatar: true } : {}),
		}));
		const dottedLines: { id: string; report: string; manager: string; label?: string }[] = [];
		for (let line = 0; line < Math.floor(random() * 6); line += 1) {
			const report = Math.floor(random() * size);
			const manager = Math.floor(random() * size);
			if (
				report === manager ||
				managers[report] === manager ||
				dottedLines.some(
					(entry) => entry.report === `p${report}` && entry.manager === `p${manager}`,
				)
			)
				continue;
			dottedLines.push({
				id: `d${line}`,
				report: `p${report}`,
				manager: `p${manager}`,
				...(random() < 0.3 ? { label: pick(LABELS) } : {}),
			});
		}
		return parseOrgChartDiagram({
			id: `random-${start}-${index}`,
			title: "Random org chart",
			type: "org-chart",
			people,
			dottedLines,
			...(roots > 1 ? { forest: true } : {}),
			...(departments && random() < 0.4 ? { groupByDepartment: true } : {}),
		});
	});
}

/** The export's width over its height, as hosted PNGs frame it. */
const aspect = (scene: RenderedDiagramScene) => (scene.width - 40) / (scene.height - 40);

/** CI draws a small fixed sample; `ORG_CHART_FUZZ=full` runs the local proof. */
const FULL = process.env["ORG_CHART_FUZZ"] === "full";
const CHARTS = FULL ? 300 : 6;
const SEEDS = FULL ? [11, 29, 47] : [11];

describe("org chart fuzz", () => {
	for (const seed of SEEDS)
		it(`draws ${CHARTS} random charts of seed ${seed} cleanly`, () => {
			// Every export is valid, and no card, reporting line or region is ever wrong.
			const defects: string[] = [];
			// Dotted lines, their labels and the bounds of a random tree may fall short on
			// rare shapes no organization has; they stay under two charts in a hundred.
			const shortfalls: string[] = [];
			for (const diagram of randomCharts(CHARTS, seed)) {
				const scene = renderOrgChartDiagram(diagram);
				const exported = convertSceneToExcalidraw(scene);
				const dotted = (id: string) =>
					id.startsWith("edge:dotted:") || id.startsWith("text:dotted:");
				// A dotted line's label never covers a card, whatever its route.
				const short = (issue: { code: string; elementId: string }) =>
					dotted(issue.elementId) && issue.code !== "label-over-card";
				const problems = [
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...orgChartLayoutIssues(scene)
						.filter((issue) => !short(issue))
						.map((issue) => issue.message),
					...groupRegionIssues(scene)
						.filter((issue) => !dotted(issue.elementId))
						.map((issue) => issue.message),
				];
				const shortfall = [
					...orgChartLayoutIssues(scene)
						.filter(short)
						.map((issue) => issue.message),
					...groupRegionIssues(scene)
						.filter((issue) => dotted(issue.elementId))
						.map((issue) => issue.message),
				];
				// Fifty people or more read no wider than 2.5 to 1. Up to fifty fit the CLI's PNG
				// ceiling; past that, random trees with long titles may not (Excalidraw is unaffected).
				if (diagram.people.length >= 50 && !diagram.forest && aspect(scene) > 2.5)
					shortfall.push(`aspect ${aspect(scene).toFixed(2)}`);
				if (diagram.people.length <= 50 && scene.width * (scene.height + 64) > 6_291_456)
					shortfall.push(`area ${scene.width}×${scene.height}`);
				const name = `${diagram.id} (${diagram.people.length} people)`;
				if (problems.length > 0) defects.push(`${name}: ${problems.slice(0, 3).join("; ")}`);
				if (shortfall.length > 0) shortfalls.push(`${name}: ${shortfall.slice(0, 3).join("; ")}`);
				// With a label on every dotted line, the export stays valid and no label covers a card.
				if (diagram.dottedLines.length === 0) continue;
				const labeled = renderOrgChartDiagram({
					...diagram,
					dottedLines: diagram.dottedLines.map((line, at) => ({
						...line,
						label: line.label ?? LABELS[at % LABELS.length]!,
					})),
				});
				const labelProblems = [
					...getCanvasValidationIssues(labeled).map((issue) => issue.message),
					...validateExcalidrawScene(convertSceneToExcalidraw(labeled)).issues.map(
						(issue) => issue.message,
					),
					...orgChartLayoutIssues(labeled)
						.filter((issue) => !short(issue))
						.map((issue) => issue.message),
				];
				if (labelProblems.length > 0)
					defects.push(`${name}, labeled: ${labelProblems.slice(0, 3).join("; ")}`);
			}
			expect(defects).toEqual([]);
			expect(shortfalls.length, shortfalls.join("\n")).toBeLessThanOrEqual(CHARTS / 50);
		});
});
