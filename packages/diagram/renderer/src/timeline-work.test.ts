import type * as diagramCore from "@sketchi/diagram-core";
import { parseTimelineDiagram } from "@sketchi/diagram-core";
import { describe, expect, it, vi } from "vitest";
import { renderTimelineDiagram } from "./timeline";

// Count label measurements: each layout of the row measures every label once,
// so the count bounds how many layouts a render tries, without a wall-clock timer.
const work = vi.hoisted(() => ({ measures: 0 }));
vi.mock("@sketchi/diagram-core", async (importOriginal) => {
	const core = await importOriginal<typeof diagramCore>();
	return {
		...core,
		boundLabelWidth: (...args: Parameters<typeof core.boundLabelWidth>) => {
			work.measures += 1;
			return core.boundLabelWidth(...args);
		},
	};
});

describe("timeline stem work", () => {
	// The #511 review's row: a 2020-2026 phase under 59 releases 35 days apart.
	// The phase covers every gap, so the row can neither break nor wrap, and no
	// stem length brings it within 2.3:1. Measured: 364 label measurements on
	// main, 4,962 laying out each of the 19 stem lengths in turn (87174525),
	// 606 predicting the stem length and laying out only that one.
	it("lays the stretched row out once more, not once per stem length", () => {
		const day = 86_400_000;
		const start = Date.UTC(2020, 0, 1);
		const diagram = parseTimelineDiagram({
			id: "releases",
			title: "Releases",
			type: "timeline",
			events: [
				{ id: "platform", label: "Platform build-out", date: "2020", end: "2026" },
				...Array.from({ length: 59 }, (_, index) => ({
					id: `release-${index + 1}`,
					label: `Release ${index + 1}`,
					date: new Date(start + index * 35 * day).toISOString().slice(0, 10),
				})),
			],
		});
		work.measures = 0;
		renderTimelineDiagram(diagram);
		expect(work.measures).toBeGreaterThan(0);
		expect(work.measures).toBeLessThan(900);
	});
});
