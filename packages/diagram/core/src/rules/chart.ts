import { CHART_MAX_CATEGORIES, CHART_MAX_PIE_SLICES, CHART_MAX_SERIES } from "../types/chart.js";
import type { RuleSource } from "./source.js";

/** How a request becomes a chart; see FLOWCHART_RULES. */
export const CHART_RULES = {
	categories:
		"Return categories (x-axis labels, or pie slice names) and series: [{ name, values }] with exactly one value per category, in category order. Name every series when there are several.",
	kinds:
		'kind "bar" compares categories (stacked: true stacks the series; long names turn bars horizontal, or set orientation), "line" shows change across ordered categories, "pie" splits one whole (donut: true for a ring).',
	limits: `A pie has exactly one series of non-negative values and at most ${CHART_MAX_PIE_SLICES} slices. Bars and lines allow negative values, up to ${CHART_MAX_CATEGORIES} categories and ${CHART_MAX_SERIES} series.`,
	/** The execute code parameter's form of `categories` and `limits`. */
	series:
		"Give every series exactly one value per category, in category order, and name every series when there are several.",
	pieCompact: `A pie has one series of non-negative values, at most ${CHART_MAX_PIE_SLICES} slices and no axis titles.`,
	copy: (source: RuleSource) =>
		`Copy every number, category, series name, unit and axis title from ${source}; invent none.`,
	noRounding: "Never round data.",
	unit: 'unit labels ticks and values: currency symbols lead ("$", "$M"), others follow ("%", "ms", "k").',
} as const;
