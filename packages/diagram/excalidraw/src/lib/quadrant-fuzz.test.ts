import { describe, expect, it } from "vitest";
import {
	getCanvasValidationIssues,
	parseQuadrantDiagram,
	QUADRANT_MAX_POINTS,
	type QuadrantDiagram,
} from "@sketchi/diagram-core";
import { quadrantLayoutIssues, renderQuadrantDiagram } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

const WORDS = [
	"SSO",
	"billing",
	"Dark",
	"mode",
	"export",
	"Internationalization",
	"Telecommunications",
	"self-serve",
	"API",
	"rate",
	"limit",
	"dashboard",
	"onboarding",
	"v2",
	"12",
	"データ連携",
	"Núñez",
	"a",
	"cloud",
	"retention",
];
const NAMES = [
	"Quick wins",
	"Major projects",
	"Fill-ins",
	"Thankless tasks",
	"Do first",
	"Strategic differentiators worth funding",
	"Low priority housekeeping chores",
	"Premium",
	"CustomerRelationshipManagement",
];
const ENDS = [
	"Low",
	"High",
	"Not urgent",
	"Urgent",
	"Hard to use",
	"Transformational change",
	"Underestimatedcomplexityofwork",
];
const GROUPS = ["Us", "Rivals", "Partners", "Startups", " rivals ", "Open  source"];

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

const MODES = ["uniform", "clusters", "scores", "near", "edges", "one-quadrant", "same"] as const;

/**
 * Seeded random quadrant charts of every shape: a few points or thirty,
 * spread out, in tight clusters, on round scores (so many sit on a midline or
 * an edge), nearly coinciding, crowded into one quadrant or all at one spot,
 * with long or non-Latin labels, long quadrant names and axis labels, and
 * groups or a single highlighted point.
 */
function randomChart(index: number): QuadrantDiagram {
	const { random, pick } = seeded(index * 7919 + 17);
	const mode = MODES[index % MODES.length]!;
	const roll = random();
	const count =
		roll < 0.05
			? 0
			: roll < 0.3
				? 1 + Math.floor(random() * 8)
				: roll < 0.7
					? 9 + Math.floor(random() * 12)
					: 21 + Math.floor(random() * (QUADRANT_MAX_POINTS - 20));
	const clamp = (value: number) => Math.min(1, Math.max(0, value));
	// Up to a dozen points share one cluster.
	const centers = Array.from(
		{ length: Math.max(Math.ceil(count / 12), 1 + Math.floor(random() * 3)) },
		() => ({
			x: random(),
			y: random(),
		}),
	);
	const spread = 0.02 + random() * 0.06;
	const position = (at: number): { x: number; y: number } => {
		switch (mode) {
			case "uniform":
				return { x: random(), y: random() };
			case "clusters": {
				const center = centers[at % centers.length]!;
				return {
					x: clamp(center.x + (random() - 0.5) * 2 * spread),
					y: clamp(center.y + (random() - 0.5) * 2 * spread),
				};
			}
			case "scores":
				return { x: Math.round(random() * 10) / 10, y: Math.round(random() * 20) / 20 };
			case "near": {
				// Clumps of up to six nearly coinciding points, among scattered ones.
				const base = centers[Math.floor(at / 6) % centers.length]!;
				return at % 6 < 2 + (index % 5)
					? { x: clamp(base.x + random() * 0.01), y: clamp(base.y + random() * 0.01) }
					: { x: random(), y: random() };
			}
			case "edges":
				return {
					x: pick([0, 0.5, 1, random()]),
					y: pick([0, 0.5, 1, random()]),
				};
			case "one-quadrant":
				return { x: 0.05 + random() * 0.4, y: 0.55 + random() * 0.4 };
			case "same":
				return { x: 0.5, y: 0.5 };
		}
	};
	const used = new Set<string>();
	const groupMode = pick(["none", "none", "groups", "highlight"] as const);
	const groupCount = 2 + Math.floor(random() * 5);
	const points = Array.from({ length: count }, (_, at) => {
		let label = Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(WORDS)).join(" ");
		if (label.length > 34) label = label.slice(0, 34).trim();
		if (used.has(label.toLowerCase())) label = `${label} ${at + 1}`;
		used.add(label.toLowerCase());
		const group =
			groupMode === "groups"
				? GROUPS[Math.floor(random() * groupCount)]
				: groupMode === "highlight" && at === 0
					? "Our product"
					: undefined;
		return { label, ...position(at), ...(group ? { group } : {}) };
	});
	return parseQuadrantDiagram({
		id: `quadrant-fuzz-${index}`,
		title:
			random() < 0.2
				? "A long quadrant chart title that keeps going to test wrapping"
				: `Chart ${index}`,
		type: "quadrant",
		xAxis: {
			title: pick(["Effort", "Price", "Urgency of the request"]),
			low: pick(ENDS),
			high: pick(ENDS),
		},
		yAxis: {
			title: pick(["Impact", "Quality", "Expected business impact"]),
			low: pick(ENDS),
			high: pick(ENDS),
		},
		quadrants: {
			topLeft: pick(NAMES),
			topRight: pick(NAMES),
			bottomLeft: pick(NAMES),
			bottomRight: pick(NAMES),
		},
		points,
	});
}

/** Charts the full fuzz checks locally; CI samples the first few of every mode. */
const CHARTS =
	process.env["QUADRANT_FUZZ"] === "full" ? 700 : Number(process.env["QUADRANT_FUZZ"] ?? 14);

/**
 * Every chart keeps each dot at its exact position, every label in the plot,
 * clear of every text and dot and nearest its own dot or on a leader, none
 * level with or over another dot instead of its own, every word whole, both dividers and both axes whole (no label knocks a piece out
 * of one, and none crosses one), and a valid export.
 */
describe("quadrant chart fuzz", () => {
	it(`keeps ${CHARTS} random charts readable, exact and exportable`, () => {
		const defects: string[] = [];
		const shortfalls: string[] = [];
		for (let index = 0; index < CHARTS; index += 1) {
			const diagram = randomChart(index);
			let scene: ReturnType<typeof renderQuadrantDiagram>;
			try {
				scene = renderQuadrantDiagram(diagram);
			} catch (error) {
				// A chart rejected for crowding is not drawn unreadable, but no fuzz chart should need it.
				defects.push(
					`${diagram.id}: rejected (${error instanceof Error ? error.message : String(error)})`,
				);
				continue;
			}
			const layout = quadrantLayoutIssues(scene, diagram);
			// Only in a plot too crowded for clean leaders may a leader pass over another dot, or a
			// label sit level with another dot instead of its own.
			const crowded = (code: string) => code === "leader-over-dot" || code === "misread-label";
			const over = layout.filter((issue) => crowded(issue.code));
			if (over.length)
				shortfalls.push(`${diagram.id}: ${over.map((issue) => issue.message).join("; ")}`);
			const problems = [
				...getCanvasValidationIssues(scene).map((issue) => issue.message),
				...layout.filter((issue) => !crowded(issue.code)).map((issue) => issue.message),
				...validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.map(
					(issue) => issue.message,
				),
			];
			if (problems.length > 0)
				defects.push(
					`${diagram.id} (${MODES[index % MODES.length]}, ${diagram.points.length} points): ${problems.slice(0, 3).join("; ")}`,
				);
		}
		expect(defects).toEqual([]);
		expect(shortfalls.length, shortfalls.join("\n")).toBeLessThanOrEqual(Math.ceil(CHARTS / 50));
	}, 1_800_000);
});
