import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	getCanvasValidationIssues,
	parseSankeyDiagram,
	SANKEY_MAX_LINKS,
	type SankeyDiagram,
} from "@sketchi/diagram-core";
import {
	layoutSankeyDiagram,
	readSankeyScene,
	renderSankeyDiagram,
	sankeyLayoutIssues,
	sankeyWeightedCrossings,
	SANKEY_MIN_BAND,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

const LABELS = [
	"Engineering",
	"Data",
	"Marketing",
	"Compute",
	"Storage",
	"Organic search",
	"Paid ads",
	"Pricing page",
	"Signed up",
	"Bounced",
	"Rejected after onsite interview",
	"Customer relationship management hosting",
	"Observability, logging and incident tooling",
	"Natural gas",
	"Electricity",
	"Rejected energy",
	"Self-serve checkout",
	"研究開発",
	"Ops",
	"QA",
	"Façade renovation",
	"Hired",
];
const UNITS = [undefined, undefined, "$", "$k", "$M", "%", "GWh", "visits", "people"] as const;
const LINK_LABELS = ["losses", "via referral", "heat", "renewals and expansions"];

/** A seeded random number source: a 32-bit LCG in exact integer arithmetic. */
function seeded(start: number) {
	let seed = start >>> 0;
	const random = () => {
		seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
		return seed / 4_294_967_296;
	};
	return {
		random,
		int: (low: number, high: number) => low + Math.floor(random() * (high - low + 1)),
		pick: <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!,
	};
}

/**
 * Seeded random flows of every shape: two-column budgets, funnels with
 * drop-offs (shared or per stage), layered flows with links that skip
 * columns, splitting trees and merges, with values across five orders of
 * magnitude, slivers, long and non-Latin labels, units and link labels.
 */
function randomDiagrams(count: number, start: number): SankeyDiagram[] {
	const { random, int, pick } = seeded(start);
	const value = () => {
		const roll = random();
		if (roll < 0.12) return int(1, 4);
		if (roll < 0.2) return Math.round(random() * 1000 + 1) / 100;
		return Math.round(10 ** (random() * 4.2));
	};
	return Array.from({ length: count }, (_, index) => {
		const shape = pick(["bipartite", "funnel", "layered", "tree", "merge"] as const);
		const layers: number[][] = [];
		let next = 0;
		const layer = (size: number) => {
			const ids = Array.from({ length: size }, () => next++);
			layers.push(ids);
			return ids;
		};
		const links = new Map<
			string,
			{ source: number; target: number; value: number; label?: string }
		>();
		const link = (source: number, target: number, amount = value()) => {
			const key = `${source}>${target}`;
			if (source === target || links.has(key) || links.size >= SANKEY_MAX_LINKS) return;
			links.set(key, {
				source,
				target,
				value: amount,
				...(random() < 0.05 ? { label: pick(LINK_LABELS) } : {}),
			});
		};
		if (shape === "bipartite" || shape === "merge") {
			const left = layer(shape === "merge" ? int(4, 12) : int(2, 8));
			const right = layer(shape === "merge" ? int(1, 3) : int(2, 10));
			for (const source of left)
				for (const target of right) if (random() < 0.45) link(source, target);
		} else if (shape === "funnel") {
			const stages = int(3, 7);
			const shared = random() < 0.5 ? next++ : undefined;
			let stage = layer(1)[0]!;
			let volume = int(200, 20_000);
			for (let step = 1; step < stages; step += 1) {
				const kept = Math.max(1, Math.round(volume * (0.1 + random() * 0.6)));
				const following = layer(1)[0]!;
				link(stage, following, kept);
				const dropped = volume - kept;
				if (dropped > 0) link(stage, shared ?? next++, dropped);
				if (random() < 0.3) link(stage, next++, Math.max(1, Math.round(dropped * random() * 0.2)));
				stage = following;
				volume = kept;
			}
		} else if (shape === "tree") {
			let frontier = layer(1);
			for (let depth = 1; depth < int(2, 4) + 1; depth += 1) {
				const children: number[] = [];
				for (const parent of frontier) {
					const kids = layer(int(1, 3));
					layers.pop();
					for (const child of kids) {
						link(parent, child);
						children.push(child);
					}
				}
				layers.push(children);
				frontier = children.filter(() => random() < 0.6);
				if (frontier.length === 0 || next > 30) break;
			}
		} else {
			const depth = int(3, 6);
			for (let column = 0; column < depth; column += 1) layer(int(1, 6));
			for (let column = 1; column < depth; column += 1) {
				for (const target of layers[column]!) {
					link(pick(layers[column - 1]!), target);
					if (random() < 0.5) link(pick(layers[column - 1]!), target);
				}
				for (const source of layers[column - 1]!)
					if (!layers[column]!.some((target) => links.has(`${source}>${target}`)))
						link(source, pick(layers[column]!));
			}
			// A few links skip a column.
			for (let skip = 0; skip < int(0, 4); skip += 1) {
				const from = int(0, depth - 3);
				if (from < 0 || !layers[from + 2]) continue;
				link(pick(layers[from]!), pick(layers[from + 2]!));
			}
		}
		if (links.size === 0) link(0, next + 1, value());
		const kept = new Set(
			[...new Set([...links.values()].flatMap((entry) => [entry.source, entry.target]))]
				.toSorted((a, b) => a - b)
				.slice(0, 40),
		);
		const keptLinks = [...links.values()].filter(
			(entry) => kept.has(entry.source) && kept.has(entry.target),
		);
		const used = new Set(keptLinks.flatMap((entry) => [entry.source, entry.target]));
		const nodes = [...used]
			.toSorted((a, b) => a - b)
			.map((id) => ({
				id: `n${id}`,
				label: `${pick(LABELS)}${random() < 0.3 ? ` ${id}` : ""}`,
				...(random() < 0.05 ? { color: "#555555" } : {}),
			}));
		const unit = pick(UNITS);
		return parseSankeyDiagram({
			id: `random-${start}-${index}-${shape}`,
			title: "Random flow",
			type: "sankey",
			...(unit === undefined ? {} : { unit }),
			nodes,
			links: keptLinks.map((entry) => ({
				...entry,
				source: `n${entry.source}`,
				target: `n${entry.target}`,
			})),
		});
	});
}

/** The export's width over its height, as hosted PNGs frame it. */
const aspect = (scene: RenderedDiagramScene) => (scene.width - 80) / (scene.height - 80);

/** Bands at the floor aside, every band is as wide as its value at one shared scale. */
function scaleIssues(diagram: SankeyDiagram, scene: RenderedDiagramScene): string[] {
	const { bands } = readSankeyScene(scene);
	const valueOf = new Map(
		diagram.links.map((link) => [`${link.source}>${link.target}`, link.value]),
	);
	// The widest band gives the scale; its 0.01 px rounding is negligible at its width.
	const widest = bands.reduce((best, band) => (band.width > best.width ? band : best));
	const scale = widest.width / valueOf.get(`${widest.source}>${widest.target}`)!;
	return bands.flatMap((band) => {
		const value = valueOf.get(`${band.source}>${band.target}`)!;
		const expected = Math.max(value * scale, SANKEY_MIN_BAND);
		return Math.abs(band.width - expected) > 0.05 + expected * 0.002
			? [
					`band ${band.source}>${band.target} is ${band.width} px for ${value} (expected ${expected.toFixed(2)})`,
				]
			: [];
	});
}

/** CI draws a small fixed sample; `SANKEY_FUZZ=full` runs the local proof. */
const FULL = process.env["SANKEY_FUZZ"] === "full";
const COUNT = FULL ? 400 : 10;
const SEEDS = FULL ? [7, 31, 59] : [7];

describe("Sankey fuzz", () => {
	for (const seed of SEEDS)
		it(`draws ${COUNT} random flows of seed ${seed} cleanly`, () => {
			const defects: string[] = [];
			const shortfalls: string[] = [];
			let leaders = 0;
			let values = 0;
			let papers = 0;
			const byShape = new Map<string, number>();
			for (const diagram of randomDiagrams(COUNT, seed)) {
				const scene = renderSankeyDiagram(diagram);
				const exported = convertSceneToExcalidraw(scene);
				// Crossings weigh the product of the crossing flows' values, as a reader sees them.
				const valueOf = new Map(
					diagram.links.map((link) => [`${link.source}>${link.target}`, link.value]),
				);
				const crossings = sankeyWeightedCrossings(scene, (band) =>
					valueOf.get(`${band.source}>${band.target}`)!,
				);
				const baseline = layoutSankeyDiagram(diagram, { ordering: "authored" }).weightedCrossings;
				const problems = [
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					// Overlaps, plus label-on-band: a label on its own bands has paper behind it,
					// that paper hides no other band, and a value away from its band's ends keeps
					// clear of every other band.
					...sankeyLayoutIssues(scene).map((issue) => issue.message),
					...scaleIssues(diagram, scene),
					...(crossings > baseline * (1 + 1e-9)
						? [`${crossings} weighted crossings, baseline ${baseline}`]
						: []),
				];
				const { nodes, bands } = readSankeyScene(scene);
				for (const node of diagram.nodes) {
					const drawn = nodes.find((entry) => entry.id === node.id)?.text?.replace(/\s+/gu, " ");
					if (!drawn?.startsWith(node.label.replace(/\s+/gu, " ")))
						problems.push(`node "${node.id}" reads "${drawn}" for "${node.label}"`);
				}
				if (bands.length !== diagram.links.length || bands.some((band) => !band.text))
					problems.push("a flow has no band or no value");
				if (aspect(scene) > 2.45) shortfalls.push(`aspect ${aspect(scene).toFixed(2)}`);
				leaders += bands.filter((band) => band.leader).length;
				papers += nodes.filter((node) => node.knockout).length;
				const shape = diagram.id.split("-").at(-1)!;
				byShape.set(shape, (byShape.get(shape) ?? 0) + bands.filter((band) => band.leader).length);
				values += bands.length;
				const name = `${diagram.id} (${diagram.nodes.length} nodes, ${diagram.links.length} links)`;
				if (problems.length > 0) defects.push(`${name}: ${problems.slice(0, 3).join("; ")}`);
				if (
					(problems.length > 0 || bands.filter((band) => band.leader).length > 3) &&
					process.env["SANKEY_FUZZ_DUMP"]
				)
					writeFileSync(
						`${process.env["SANKEY_FUZZ_DUMP"]}/${diagram.id}.json`,
						JSON.stringify(diagram),
					);
				if (shortfalls.length > 0 && shortfalls.at(-1)!.startsWith("aspect"))
					shortfalls[shortfalls.length - 1] = `${name}: ${shortfalls.at(-1)}`;
			}
			console.log(
				`seed ${seed}: ${leaders} of ${values} values on leaders (${[...byShape].map(([shape, count]) => `${shape} ${count}`).join(", ")}); ${papers} labels on paper; ${shortfalls.length} shortfalls`,
			);
			expect(defects).toEqual([]);
			expect(shortfalls.length, shortfalls.join("\n")).toBeLessThanOrEqual(COUNT / 50);
		});
});
