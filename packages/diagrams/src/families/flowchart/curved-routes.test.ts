import { describe, expect, it } from "vitest";
import { groupFixtures } from "./group-fixtures.js";
import { zoneFixtures, zoneStressFixtures } from "./zone-fixtures.js";
import { renderFlowchartDiagram } from "./render.js";
import { strays } from "../../../test/readability-helpers.js";

describe("curved routes", () => {
	it.each(["TB", "BT", "LR", "RL"] as const)(
		"curves every group and zone fixture %s without straying",
		(direction) => {
			const fixtures = { ...groupFixtures, ...zoneFixtures, ...zoneStressFixtures };
			expect(
				Object.entries(fixtures).flatMap(([name, fixture]) =>
					strays(
						renderFlowchartDiagram({
							...fixture,
							layout: { direction, edgeRouting: "curved" },
						}),
					).map((stray) => `${name}: ${stray}`),
				),
			).toEqual([]);
		},
		120_000,
	);
});
