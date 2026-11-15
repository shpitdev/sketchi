import { describe, expect, it } from "vitest";
import { crossingStateMachines } from "./crossing-fixtures.js";
import { renderStateMachineDiagram } from "./render.js";
import { crossings, cornerEnds, ambiguousLabels } from "../../../test/readability-helpers.js";

describe("avoidable crossings in generated state machines", () => {
	const machines = Object.keys(crossingStateMachines) as (keyof typeof crossingStateMachines)[];
	const layouts = machines.flatMap((name) =>
		([undefined, "TB", "LR"] as const).map((direction) => ({
			name,
			direction: direction ?? "auto",
			scene: renderStateMachineDiagram(
				direction
					? { ...crossingStateMachines[name], layout: { direction } }
					: crossingStateMachines[name],
			),
		})),
	);

	it.each(layouts)("draws $name ($direction) without crossings", ({ scene }) => {
		expect(crossings(scene)).toEqual([]);
	});

	it.each(layouts)(
		"sets each of $name's ($direction) labels clearly nearer its own line than any other",
		({ scene }) => {
			expect(ambiguousLabels(scene)).toEqual([]);
		},
	);

	it.each(layouts)(
		"meets each of $name's ($direction) states on the straight part of a side",
		({ scene }) => {
			// Round 22, Sol: seek's self-loop left Playing's foot and came back into
			// its side 16 px from the corner, inside the 27.5 px curve.
			expect(cornerEnds(scene)).toEqual([]);
		},
	);
});
