import { describe, expect, it } from "vitest";
import {
	getCanvasValidationIssues,
	parseVennDiagram,
	VENN_COLOR_NAMES,
	VENN_MAX_ITEMS,
	VENN_MAX_REGION_ITEMS,
	type VennDiagram,
} from "@sketchi/diagram-core";
import {
	readVennScene,
	renderVennDiagram,
	type RenderedDiagramScene,
	vennLayoutIssues,
} from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const LABELS = [
	"Design",
	"Engineering",
	"Product",
	"iOS",
	"Android",
	"Customer success and support operations",
	"Go-to-market",
	"日本語",
	"Data science",
	"Platform infrastructure engineering",
];
const WORDS = [
	"SSO",
	"audit",
	"logs",
	"with",
	"1-year",
	"retention",
	"real-time",
	"collaboration",
	"internationalization",
	"API",
	"access",
	"offline",
	"mode",
	"dashboards",
	"for",
	"every",
	"team",
	"漢字",
	"Zürich",
	"99.9%",
	"uptime",
	"SLA",
	"single",
	"sign-on",
	"api.example.com/v2/organizations",
];
const REGION_LABELS = [
	"Both",
	"Shared",
	"Everywhere",
	"The sweet spot",
	"Overlap of all three teams",
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
 * Seeded random Venn diagrams: two or three sets with short, long and non-Latin
 * labels and colors, and regions that are empty, sparse, or packed to the item
 * caps with phrases up to 60 characters, sometimes labeled or counted instead.
 */
function randomDiagrams(count: number, start: number): VennDiagram[] {
	const { random, pick } = seeded(start);
	return Array.from({ length: count }, (_, index) => {
		const size = random() < 0.4 ? 2 : 3;
		const labels = new Set<string>();
		while (labels.size < size) labels.add(pick(LABELS));
		const sets = [...labels].map((label, at) => ({
			id: `s${at}`,
			label,
			...(random() < 0.25 ? { color: pick(VENN_COLOR_NAMES) } : {}),
		}));
		const keys: string[][] = [];
		for (let mask = 1; mask < 1 << size; mask += 1)
			keys.push(sets.filter((_, at) => mask & (1 << at)).map((set) => set.id));
		const counted = random() < 0.15;
		const heavy = random() < 0.3 ? pick(keys) : undefined;
		let total = 0;
		const regions = keys.flatMap((key): Record<string, unknown>[] => {
			if (random() < 0.2) return [];
			const label = random() < 0.15 ? { label: pick(REGION_LABELS) } : {};
			if (counted) return [{ sets: key, ...label, count: Math.floor(random() * 5000) }];
			const wanted =
				key === heavy ? VENN_MAX_REGION_ITEMS : Math.floor(random() * (random() < 0.2 ? 8 : 4));
			const items = new Set<string>();
			while (items.size < Math.min(wanted, VENN_MAX_ITEMS - total)) {
				const words = 1 + Math.floor(random() * (random() < 0.2 ? 9 : 3));
				const suffix = ` ${items.size + total}`;
				let item = Array.from({ length: words }, () => pick(WORDS)).join(" ");
				// Trim whole words to the 60-character cap.
				while (item.length + suffix.length > 60) item = item.slice(0, item.lastIndexOf(" "));
				items.add(`${item}${suffix}`);
			}
			total += items.size;
			return [{ sets: random() < 0.5 ? [...key].reverse() : key, ...label, items: [...items] }];
		});
		return parseVennDiagram({
			id: `random-${start}-${index}`,
			title: "Random Venn",
			type: "venn",
			sets,
			regions,
		});
	});
}

const aspect = (scene: RenderedDiagramScene) => scene.width / scene.height;

/** CI draws a small fixed sample; `VENN_FUZZ=full` runs the local proof. */
const FULL = process.env["VENN_FUZZ"] === "full";
const DIAGRAMS = FULL ? 300 : 12;
const SEEDS = FULL ? [7, 31, 53] : [7];

describe("Venn fuzz", () => {
	for (const seed of SEEDS)
		it(`draws ${DIAGRAMS} random Venn diagrams of seed ${seed} cleanly`, () => {
			const defects: string[] = [];
			for (const diagram of randomDiagrams(DIAGRAMS, seed)) {
				const scene = renderVennDiagram(diagram);
				const exported = convertSceneToExcalidraw(scene);
				const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(exported)));
				const readout = readVennScene(scene);
				const problems = [
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...validateExcalidrawScene(reloaded).issues.map((issue) => `reloaded: ${issue.message}`),
					...vennLayoutIssues(scene).map((issue) => issue.message),
				];
				if (aspect(scene) > 2.45 || 1 / aspect(scene) > 1.4)
					problems.push(`aspect ${aspect(scene).toFixed(2)}`);
				if (readout.sets.length !== diagram.sets.length) problems.push("a set is missing");
				// Every item is drawn once, whole, in exactly its region.
				for (const region of diagram.regions) {
					const key = region.sets
						.map((id) => diagram.sets.findIndex((set) => set.id === id))
						.sort((a, b) => a - b)
						.join("+");
					const drawn = readout.regions.find((entry) => entry.key.join("+") === key);
					const items = region.items ?? [];
					if (JSON.stringify(drawn?.items ?? []) !== JSON.stringify(items))
						problems.push(
							`region ${key} draws ${JSON.stringify(drawn?.items)} for ${JSON.stringify(items)}`,
						);
					if (region.count !== undefined && drawn?.count !== region.count.toLocaleString("en-US"))
						problems.push(`region ${key} count ${drawn?.count} for ${region.count}`);
				}
				if (problems.length > 0)
					defects.push(
						`${diagram.id} (${diagram.sets.length} sets): ${problems.slice(0, 3).join("; ")}`,
					);
			}
			expect(defects).toEqual([]);
		});
});
