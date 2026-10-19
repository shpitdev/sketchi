import * as diagramCore from "@sketchi/diagram-core";
import {
	orgChartFixture,
	orgChartStressFixtures,
	parseOrgChartDiagram,
	resolveOrgChartShorthand,
} from "@sketchi/diagram-core";
import { describe, expect, it, vi } from "vitest";

import { layoutOrgChartDiagram, renderOrgChartDiagram } from "./org-chart";

// Count the box comparisons the layout packs subtrees with, and the label wraps it
// measures with, through diagram-core. Both are deterministic, so they bound layout work
// without a wall-clock timer, as does the number of placements the search tries.
const work = vi.hoisted(() => ({ comparisons: 0, wraps: 0 }));
vi.mock("@sketchi/diagram-core", async (importOriginal) => {
	const core = await importOriginal<typeof diagramCore>();
	const counted =
		<A extends readonly [readonly unknown[], readonly unknown[], ...unknown[]], R>(
			pack: (...args: A) => R,
		) =>
		(...args: A) => {
			work.comparisons += args[0].length * args[1].length;
			return pack(...args);
		};
	return {
		...core,
		clearanceRight: counted(core.clearanceRight),
		clearanceLeft: counted(core.clearanceLeft),
		wrapTextToWidth: (...args: Parameters<typeof core.wrapTextToWidth>) => {
			work.wraps += 1;
			return core.wrapTextToWidth(...args);
		},
	};
});

/** The most people a chart holds, each manager of a level with as many reports as fit. */
const largest = parseOrgChartDiagram(
	resolveOrgChartShorthand({
		id: "largest",
		title: "Largest",
		type: "org-chart",
		people: Array.from({ length: 100 }, (_, index) => ({
			id: `p${index}`,
			name: `Person number ${index} with a longer name`,
			title: "Senior Principal Engineer of Platform Reliability",
			department: `Department ${index % 7}`,
			...(index === 0
				? {}
				: { manager: `p${index < 8 ? 0 : index < 30 ? (index % 7) + 1 : (index % 22) + 8}` }),
		})),
		dottedLines: Array.from({ length: 12 }, (_, index) => ({
			report: `p${40 + index}`,
			manager: `p${10 + index}`,
		})),
	}),
);

describe("org chart layout work", () => {
	// Measured: the fixture places once (28 comparisons, 17 wraps); eighty people try 15
	// placements (424k comparisons, 167 wraps); a hundred with long titles and twelve dotted
	// lines 56 (2.37M, 1,885). A wrap is one step of a label's balanced-width search.
	it.each([
		["fixture", orgChartFixture, 1, 200, 100],
		["eighty", orgChartStressFixtures.eighty, 24, 900_000, 600],
		["largest", largest, 80, 4_000_000, 4_000],
	] as const)(
		"bounds placements, packing and measuring for the %s chart",
		(_, diagram, attempts, comparisons, wraps) => {
			work.comparisons = 0;
			work.wraps = 0;
			const layout = layoutOrgChartDiagram(diagram);
			const counted = { ...work };
			renderOrgChartDiagram(diagram);
			expect(layout.attempts).toBeLessThanOrEqual(attempts);
			expect(counted.comparisons).toBeLessThan(comparisons);
			expect(counted.wraps).toBeLessThan(wraps);
		},
	);
});
