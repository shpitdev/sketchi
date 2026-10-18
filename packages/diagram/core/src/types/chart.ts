import { Effect, Schema } from "effect";
import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const chartDiagramType = "chart" as const;
export const CHART_KINDS = ["bar", "line", "pie"] as const;
export const CHART_ORIENTATIONS = ["vertical", "horizontal"] as const;
export const ChartKindSchema = Schema.Literals(CHART_KINDS);
export const ChartOrientationSchema = Schema.Literals(CHART_ORIENTATIONS);
export type ChartKind = (typeof CHART_KINDS)[number];
export type ChartOrientation = (typeof CHART_ORIENTATIONS)[number];

/** More categories, series or slices stop reading as one chart; split or fold them instead. */
export const CHART_MAX_CATEGORIES = 40;
export const CHART_MAX_SERIES = 6;
export const CHART_MAX_VALUES = 120;
export const CHART_MAX_PIE_SLICES = 8;

/** One named run of values, in category order. */
export class ChartSeries extends Schema.Class<ChartSeries>("ChartSeries")({
	/** Required when a chart has more than one series; the legend shows it. */
	name: Schema.optionalKey(Schema.NonEmptyString),
	values: Schema.Array(Schema.Finite).pipe(Schema.mutable),
}) {}

/**
 * A bar, line or pie chart from categories and named series. The renderer
 * owns every coordinate, tick and label position.
 */
export class ChartDiagram extends Schema.Class<ChartDiagram>("ChartDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(chartDiagramType),
	kind: ChartKindSchema,
	/** Bar and line x-axis categories, or pie slice names, in display order. */
	categories: Schema.Array(Schema.NonEmptyString).pipe(
		Schema.mutable,
		Schema.check(Schema.isMinLength(1)),
	),
	series: Schema.Array(ChartSeries).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	/** Value unit: currency symbols lead ("$" → $12, "$M" → $12M); anything else follows (%, ms, users). */
	unit: Schema.optionalKey(Schema.NonEmptyString),
	categoryAxisTitle: Schema.optionalKey(Schema.NonEmptyString),
	valueAxisTitle: Schema.optionalKey(Schema.NonEmptyString),
	/** Bars only: stack series within each category instead of grouping them. */
	stacked: Schema.optionalKey(Schema.Boolean),
	/** Pies only: draw a ring. */
	donut: Schema.optionalKey(Schema.Boolean),
	/** Bars only. Omitted, bars turn horizontal when category names would not fit under columns. */
	orientation: Schema.optionalKey(ChartOrientationSchema),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const ChartDiagramSchema = ChartDiagram;

export interface ChartValidationIssue {
	readonly code:
		| "chart_too_large"
		| "chart_series_mismatch"
		| "duplicate_chart_category"
		| "invalid_chart_series"
		| "invalid_chart_value"
		| "invalid_chart_option";
	readonly path: string;
	readonly message: string;
	readonly hint: string;
}

const sameName = (name: string) => name.trim().toLowerCase();

export function getChartValidationIssues(diagram: ChartDiagram): ChartValidationIssue[] {
	const issues: ChartValidationIssue[] = [];
	const { categories, kind, series } = diagram;
	const pie = kind === "pie";
	const maxCategories = pie ? CHART_MAX_PIE_SLICES : CHART_MAX_CATEGORIES;
	if (categories.length > maxCategories)
		issues.push({
			code: "chart_too_large",
			path: "categories",
			message: `A ${kind} chart supports at most ${maxCategories} ${pie ? "slices" : "categories"}.`,
			hint: pie
				? 'Fold the smallest slices into one "Other" slice, or use a bar chart.'
				: "Group categories, or split the data into several charts.",
		});
	if (series.length > CHART_MAX_SERIES)
		issues.push({
			code: "chart_too_large",
			path: "series",
			message: `A chart supports at most ${CHART_MAX_SERIES} series.`,
			hint: "Keep the series the request compares, or split them into several charts.",
		});
	if (categories.length * series.length > CHART_MAX_VALUES)
		issues.push({
			code: "chart_too_large",
			path: "series",
			message: `A chart supports at most ${CHART_MAX_VALUES} values (categories × series).`,
			hint: "Split the data into several charts.",
		});
	const seenCategories = new Set<string>();
	categories.forEach((category, index) => {
		if (seenCategories.has(sameName(category)))
			issues.push({
				code: "duplicate_chart_category",
				path: `categories.[${index}]`,
				message: `Category "${category}" is listed more than once.`,
				hint: "List each category once; put its values for every series at the same position.",
			});
		seenCategories.add(sameName(category));
	});
	if (pie && series.length !== 1)
		issues.push({
			code: "invalid_chart_series",
			path: "series",
			message: "A pie chart has exactly one series.",
			hint: "Use one series of slice values, or a grouped bar chart to compare several series.",
		});
	const seenSeries = new Set<string>();
	series.forEach((entry, index) => {
		const path = `series.[${index}]`;
		if (series.length > 1 && entry.name === undefined)
			issues.push({
				code: "invalid_chart_series",
				path: `${path}.name`,
				message: `Series ${index + 1} needs a name for the legend.`,
				hint: "Name every series when a chart has more than one.",
			});
		if (entry.name !== undefined) {
			if (seenSeries.has(sameName(entry.name)))
				issues.push({
					code: "invalid_chart_series",
					path: `${path}.name`,
					message: `Series name "${entry.name}" is used more than once.`,
					hint: "Give each series a distinct name.",
				});
			seenSeries.add(sameName(entry.name));
		}
		if (entry.values.length !== categories.length)
			issues.push({
				code: "chart_series_mismatch",
				path: `${path}.values`,
				message: `Series ${entry.name ? `"${entry.name}"` : index + 1} has ${entry.values.length} values for ${categories.length} categories.`,
				hint: "Give every series exactly one value per category, in category order.",
			});
		if (pie && entry.values.some((value) => value < 0))
			issues.push({
				code: "invalid_chart_value",
				path: `${path}.values`,
				message: "Pie slice values cannot be negative.",
				hint: "Use a bar chart for data with negative values.",
			});
	});
	if (pie && series[0] && !series[0].values.some((value) => value > 0))
		issues.push({
			code: "invalid_chart_value",
			path: "series.[0].values",
			message: "A pie chart needs at least one positive slice value.",
			hint: "Supply the slice values from the request.",
		});
	const option = (field: string, applies: boolean, message: string, hint: string) => {
		if (!applies) issues.push({ code: "invalid_chart_option", path: field, message, hint });
	};
	if (diagram.stacked)
		option(
			"stacked",
			kind === "bar",
			"Only bar charts stack.",
			'Remove stacked, or use kind: "bar".',
		);
	if (diagram.donut)
		option("donut", pie, "Only pie charts draw as a donut.", 'Remove donut, or use kind: "pie".');
	if (diagram.orientation !== undefined)
		option(
			"orientation",
			kind === "bar",
			"Only bar charts have an orientation.",
			"Remove orientation for line and pie charts.",
		);
	for (const field of ["categoryAxisTitle", "valueAxisTitle"] as const)
		if (diagram[field] !== undefined)
			option(field, !pie, "A pie chart has no axes.", `Remove ${field} from the pie chart.`);
	return issues.slice(0, 20);
}

export class ChartValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly ChartValidationIssue[]) {
		super(issues[0]?.message ?? "Chart failed validation.");
		this.name = "ChartValidationError";
	}
}
export function validateChartDiagram(diagram: ChartDiagram): ChartDiagram {
	const issues = getChartValidationIssues(diagram);
	if (issues.length) throw new ChartValidationError(issues);
	return diagram;
}
export function parseChartDiagram(input: unknown): ChartDiagram {
	return validateChartDiagram(Schema.decodeUnknownSync(ChartDiagram, { errors: "all" })(input));
}

export const chartFixture = parseChartDiagram({
	id: "quarterly-revenue-chart",
	title: "Quarterly revenue",
	type: "chart",
	kind: "bar",
	categories: ["Q1", "Q2", "Q3", "Q4"],
	series: [
		{ name: "2025", values: [42, 51, 47, 63] },
		{ name: "2026", values: [48, 57, 61, 72] },
	],
	unit: "$M",
	categoryAxisTitle: "Quarter",
	valueAxisTitle: "Revenue",
});
