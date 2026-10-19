import { describe, expect, it } from "vitest";

import {
	getCanvasValidationIssues,
	type MindmapDiagram,
	parseMindmapDiagram,
} from "@sketchi/diagram-core";

import { renderMindmapDiagram } from "./mindmap";
import { mindmapLayoutIssues } from "./mindmap-readout";
import type { NodeSceneElement, RenderedDiagramScene } from "./scene";

/** CI draws a handful of seeds; `MINDMAP_FUZZ_SEEDS=2000` runs the full local proof. */
const SEEDS = Number(process.env["MINDMAP_FUZZ_SEEDS"] ?? 8);
/** Hosted PNGs frame the drawing this tightly. */
const EXPORT_PADDING = 20;
const MAX_ASPECT = 2.5;

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = [
	"plan",
	"budget",
	"launch",
	"review",
	"research",
	"design",
	"testing",
	"growth",
	"hiring",
	"customer",
	"onboarding",
	"analytics",
	"pricing",
	"retention",
	"infrastructure",
	"security",
	"documentation",
	"partnerships",
	"a",
	"of",
	"the",
	"and",
	"interoperability",
	"Kubernetes",
	"photosynthesis",
	"API",
	"UX",
	"Q3",
	"東京",
	"データ",
	"🚀",
];

interface Outline {
	readonly label: string;
	readonly children: Outline[];
}

/** A random tree: up to `limit` topics, bushy near the center and thinning with depth. */
function randomOutline(next: () => number, limit: number): Outline {
	let count = 1;
	const label = () => {
		const words = 1 + Math.floor(next() ** 2 * 9);
		return Array.from({ length: words }, () => WORDS[Math.floor(next() * WORDS.length)]!).join(" ");
	};
	const maxDepth = 1 + Math.floor(next() * 6);
	const grow = (depth: number): Outline => {
		const children: Outline[] = [];
		const wanted =
			depth === 0
				? 1 + Math.floor(next() * 12)
				: depth >= maxDepth
					? 0
					: Math.floor(next() * (depth === 1 ? 6 : 4));
		for (let index = 0; index < wanted && count < limit; index += 1) {
			count += 1;
			children.push(grow(depth + 1));
		}
		return { label: label(), children };
	};
	return grow(0);
}

/** The tree's shape for a failure message: child counts, nested. */
function sketch(outline: Outline): string {
	return outline.children.length === 0
		? "."
		: `${outline.children.length}(${outline.children.map(sketch).join(" ")})`;
}

function toDiagram(outline: Outline, id: string, direction: "LR" | "RL"): MindmapDiagram {
	const nodes: unknown[] = [];
	const edges: unknown[] = [];
	const visit = (topic: Outline, path: number[], parent?: string) => {
		const nodeId = `topic-${path.join("-")}`;
		const depth = path.length - 1;
		const siblingIndex = path.at(-1)!;
		nodes.push({
			id: nodeId,
			label: topic.label,
			kind: depth === 0 ? "root" : "topic",
			metadata: { depth, siblingIndex },
		});
		if (parent)
			edges.push({
				id: `branch-${path.join("-")}`,
				source: parent,
				target: nodeId,
				metadata: { depth, siblingIndex },
			});
		topic.children.forEach((child, index) => visit(child, [...path, index], nodeId));
	};
	visit(outline, [0]);
	return parseMindmapDiagram({
		id,
		title: id,
		type: "mindmap",
		nodes,
		edges,
		layout: { direction, edgeRouting: "curved" },
	});
}

function nodesOf(scene: RenderedDiagramScene): NodeSceneElement[] {
	return scene.elements.filter((element) => element.type === "node");
}

/** Width over height and height over width of the exported drawing. */
function exportAspects(scene: RenderedDiagramScene): { wide: number; tall: number } {
	const nodes = nodesOf(scene);
	const width =
		Math.max(...nodes.map((node) => node.x + node.width)) -
		Math.min(...nodes.map((node) => node.x)) +
		2 * EXPORT_PADDING;
	const height =
		Math.max(...nodes.map((node) => node.y + node.height)) -
		Math.min(...nodes.map((node) => node.y)) +
		2 * EXPORT_PADDING;
	return { wide: width / height, tall: height / width };
}

/**
 * Each side's stack of main branches, as tall as their drawn subtrees and the
 * gaps between them (lone topics sit closer), and the tallest branch.
 */
function sideStacks(scene: RenderedDiagramScene): { right: number; left: number; tallest: number } {
	const nodes = nodesOf(scene);
	const root = nodes.find((node) => node.kind === "root")!;
	const center = root.x + root.width / 2;
	const branches = new Map<string, NodeSceneElement[]>();
	for (const node of nodes) {
		const group = node.groupIds?.[0];
		if (group) branches.set(group, [...(branches.get(group) ?? []), node]);
	}
	const stacks = { right: [] as NodeSceneElement[][], left: [] as NodeSceneElement[][] };
	for (const [group, members] of branches) {
		const main = members.find((node) => `branch:${node.nodeId}` === group)!;
		stacks[main.x + main.width / 2 > center ? "right" : "left"].push(members);
	}
	const top = (members: readonly NodeSceneElement[]) => Math.min(...members.map((node) => node.y));
	const bottom = (members: readonly NodeSceneElement[]) =>
		Math.max(...members.map((node) => node.y + node.height));
	const height = (side: NodeSceneElement[][]) =>
		side
			.toSorted((a, b) => top(a) - top(b))
			.reduce(
				(sum, members, index, sorted) =>
					sum +
					bottom(members) -
					top(members) +
					(index === 0 ? 0 : members.length === 1 && sorted[index - 1]!.length === 1 ? 14 : 28),
				0,
			);
	return {
		right: height(stacks.right),
		left: height(stacks.left),
		tallest: Math.max(...[...branches.values()].map((members) => bottom(members) - top(members))),
	};
}

describe("mindmap layout fuzz", () => {
	for (let seed = 1; seed <= SEEDS; seed += 1) {
		it(`seed ${seed}: topics clear, no crossings, balanced sides, readable aspect`, () => {
			const next = random(seed);
			const outline = randomOutline(next, 8 + Math.floor(next() * 93));
			const diagram = toDiagram(outline, `fuzz-${seed}`, next() < 0.2 ? "RL" : "LR");
			const shape = sketch(outline);
			const scene = renderMindmapDiagram(diagram);
			expect(mindmapLayoutIssues(scene), shape).toEqual([]);
			expect(getCanvasValidationIssues(scene), shape).toEqual([]);
			const aspects = exportAspects(scene);
			expect(aspects.wide, shape).toBeLessThanOrEqual(MAX_ASPECT);
			expect(aspects.tall, shape).toBeLessThanOrEqual(MAX_ASPECT);
			const sides = sideStacks(scene);
			// The best clockwise split leaves the sides at most one branch apart.
			expect(Math.abs(sides.right - sides.left), shape).toBeLessThanOrEqual(sides.tallest + 28);
		});
	}
});
