// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { type CanvasConnectorElement as ArrowSceneElement } from "@sketchi/drawing";

import { parseOrgChartDiagram, resolveOrgChartShorthand } from "../document.js";
import { orgChartLayoutIssues } from "../readout.js";
import { renderOrgChartDiagram } from "../render.js";

/**
 * The Northwind Health scenario. The fuzz tolerates rare dotted-line shortfalls,
 * so this case pins the one the scenario catalog asks for.
 */
describe("org chart regressions", () => {
	it("routes Nina's dotted line to Linda clear of every card, crossing no reporting line", () => {
		// Nina sits in Rahul's stack, boxed in by his spine; Linda's team stands between them.
		const people = [
			["sarah", "Dr. Sarah Okafor", "Chief Executive Officer"],
			["daniel", "Daniel Kim", "Executive Assistant", "sarah"],
			["michael", "Michael Torres", "Chief Financial Officer", "sarah"],
			["linda", "Linda Park", "Chief Operating Officer", "sarah"],
			["rahul", "Rahul Mehta", "Chief Technology Officer", "sarah"],
			["grace", "Grace Liu", "Controller", "michael"],
			["owen", "Owen Hughes", "FP&A Manager", "michael"],
			["fatima", "Fatima Hassan", "Director of Clinical Operations", "linda"],
			["ben", "Ben Carter", "Director of Facilities", "linda"],
			["nina", "Nina Rossi", "Director of IT", "rahul"],
			["victor", "Victor Alvarez", "Security Lead", "rahul"],
		].map(([id, name, title, manager]) => ({
			id,
			name,
			title,
			...(manager ? { manager } : {}),
			...(id === "daniel" ? { assistant: true } : {}),
		}));
		const scene = renderOrgChartDiagram(
			parseOrgChartDiagram(
				resolveOrgChartShorthand({
					id: "northwind",
					title: "Northwind Health",
					type: "org-chart",
					people,
					dottedLines: [{ report: "nina", manager: "linda", label: "for clinical systems" }],
				}),
			).pipe(Result.getOrThrow),
		);
		expect(orgChartLayoutIssues(scene)).toEqual([]);
		const runsOf = (arrow: ArrowSceneElement) =>
			arrow.points.slice(1).map((to, index) => ({ from: arrow.points[index]!, to }));
		type Run = ReturnType<typeof runsOf>[number];
		const dotted = scene.elements.find(
			(element): element is ArrowSceneElement => element.id === "edge:dotted:nina-dotted-linda",
		)!;
		const solid = scene.elements.flatMap((element) =>
			element.type === "arrow" && !element.edgeId.startsWith("dotted:") ? runsOf(element) : [],
		);
		const crosses = (left: Run, right: Run) => {
			const [across, along] = left.from.y === left.to.y ? [left, right] : [right, left];
			if (across.from.y !== across.to.y || along.from.x !== along.to.x) return false;
			const { x } = along.from;
			const { y } = across.from;
			return (
				x > Math.min(across.from.x, across.to.x) + 0.5 &&
				x < Math.max(across.from.x, across.to.x) - 0.5 &&
				y > Math.min(along.from.y, along.to.y) + 0.5 &&
				y < Math.max(along.from.y, along.to.y) - 0.5
			);
		};
		expect(runsOf(dotted).filter((run) => solid.some((other) => crosses(run, other)))).toEqual([]);
	});
});
