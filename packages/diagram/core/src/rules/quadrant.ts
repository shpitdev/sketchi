import { QUADRANT_MAX_POINTS } from "../types/quadrant.js";
import type { RuleSource } from "./source.js";

/** How a request becomes a quadrant chart; see FLOWCHART_RULES. */
export const QUADRANT_RULES = {
	axisEnds: (source: RuleSource) =>
		`Return xAxis and yAxis: { title, low, high }, where low and high label the axis ends (left or bottom, then right or top) as ${source} words them.`,
	names:
		"Return quadrants: { topLeft, topRight, bottomLeft, bottomRight }, each name in the corner its two conditions describe through those end labels.",
	usualNames: (source: RuleSource) =>
		`When ${source} names a known matrix (Eisenhower, BCG) without naming its quadrants, or asks for its usual names, name each quadrant as that matrix conventionally does, not by the two conditions that place it.`,
	points:
		"Return points: [{ label, x, y, group? }] with x and y from 0 (low end) to 1 (high end): a score out of 100 is score / 100, and 0.5 sits on a middle line. Place an item given only its quadrant well inside it (0.25 or 0.75).",
	axes: (source: RuleSource) =>
		`An axis may run from Urgent to Not urgent when ${source} draws it that way; topLeft is low x and high y as labeled.`,
	groups: (source: RuleSource) => `group colors points ${source} sets apart and adds a legend.`,
	limits: `At most ${QUADRANT_MAX_POINTS} points, each label unique.`,
	copy: (source: RuleSource) =>
		`Copy every item, axis label and quadrant name ${source} states; invent none.`,
	/**
	 * The execute code parameter's one-line form of axisEnds, names and points. That parameter has
	 * a length budget; every other surface states the full sentences.
	 */
	placementCompact:
		"low and high are the axis end labels as stated (x left to right, y bottom up); name each quadrant by the corner its conditions describe; x and y run 0 (low end) to 1 (high end), so a score out of 100 is score / 100.",
} as const;
