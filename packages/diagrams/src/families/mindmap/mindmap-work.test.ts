// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import * as drawing from "@sketchi/drawing";
import { type MindmapTopic, parseMindmap, renderMindmap } from "./index.js";
import { describe, expect, it, vi } from "vitest";

// Count the box comparisons the layout packs subtrees with, and the label wraps
// it measures with, through diagram-core. Both are deterministic, so they bound
// layout work without a wall-clock timer.
const work = vi.hoisted(() => ({ comparisons: 0, wraps: 0 }));
vi.mock("@sketchi/drawing", async (importOriginal) => {
	const core = await importOriginal<typeof drawing>();
	return {
		...core,
		clearanceBelow: (...args: Parameters<typeof core.clearanceBelow>) => {
			work.comparisons += args[0].length * args[1].length;
			return core.clearanceBelow(...args);
		},
		wrapTextToWidth: (...args: Parameters<typeof core.wrapTextToWidth>) => {
			work.wraps += 1;
			return core.wrapTextToWidth(...args);
		},
	};
});

const topic = (label: string, children: MindmapTopic[] = []): MindmapTopic => ({
	label,
	children,
});

/** The most topics a mindmap may hold: 9 main branches of 10 topics whose labels wrap. */
const widest = parseMindmap({
	id: "widest",
	title: "Widest",
	root: topic(
		"Company knowledge base",
		Array.from({ length: 9 }, (_, branch) =>
			topic(
				`Department number ${branch + 1}`,
				Array.from({ length: 10 }, (_, leaf) =>
					topic(`Team topic ${branch}.${leaf} with a longer description to wrap`),
				),
			),
		),
	),
}).pipe(Result.getOrThrow);

/** As many topics as deep as they go: three main branches doubling down six levels, which folds. */
let budget = 99;
const bushy = (depth: number): MindmapTopic =>
	topic(
		`Level ${depth} topic with words`,
		depth === 6
			? []
			: Array.from({ length: depth === 0 ? 3 : 2 }, () =>
					budget-- > 0 ? [bushy(depth + 1)] : [],
				).flat(),
	);
const deepest = parseMindmap({ id: "deepest", title: "Deepest", root: bushy(0) }).pipe(
	Result.getOrThrow,
);

describe("mindmap layout work", () => {
	// Measured: 405 comparisons and 900 wraps for the widest map; 4,706 and 901 for the
	// deepest, which tries fold depths. A wrap is one step of a label's balanced-width search.
	it.each([
		["widest", widest, 2_000, 1_500],
		["deepest", deepest, 20_000, 1_500],
	] as const)("bounds packing and measuring for the %s map", (_, diagram, comparisons, wraps) => {
		work.comparisons = 0;
		work.wraps = 0;
		renderMindmap(diagram);
		expect(work.comparisons).toBeGreaterThan(0);
		expect(work.comparisons).toBeLessThan(comparisons);
		expect(work.wraps).toBeLessThan(wraps);
	});
});
