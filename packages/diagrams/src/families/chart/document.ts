// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import {
	Effect,
	Schema,
	Array as Arr,
	Option,
	Result,
	String as Str,
	MutableHashSet as Set,
} from "effect";
import { cleanToolString, slug } from "../../clean-text";
import { DiagramStyle, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";

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
export const ChartSeries = Schema.Struct({
	/** Required when a chart has more than one series; the legend shows it. */
	name: Schema.optionalKey(Schema.NonEmptyString),
	values: Schema.Array(Schema.Finite).pipe(Schema.mutable),
}).annotate({ identifier: "ChartSeries" });

export interface ChartSeries extends Schema.Schema.Type<typeof ChartSeries> {}

/**
 * A bar, line or pie chart from categories and named series. The renderer
 * owns every coordinate, tick and label position.
 */
export const ChartDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.NonEmptyString,
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
		Schema.withDecodingDefaultKey(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
});
export interface ChartDocument extends Schema.Schema.Type<typeof ChartDocument> {}

/** Authored fields have one owner; rendering adds its stable id and family tag. */
export const ChartDiagram = ChartDocument.mapFields((fields) => ({
	...fields,
	id: Schema.NonEmptyString,
	type: Schema.Literal(chartDiagramType),
})).annotate({ identifier: "ChartDiagram" });

export interface ChartDiagram extends Schema.Schema.Type<typeof ChartDiagram> {}

/** Clean display text once without changing category/series pairing or numeric values. */
export function normalizeChart(document: ChartDocument): ChartDiagram {
	const title = cleanToolString(document.title);
	const optionalText = (value: string | undefined) =>
		value === undefined ? undefined : cleanToolString(value) || undefined;
	const unit = optionalText(document.unit);
	const categoryAxisTitle = optionalText(document.categoryAxisTitle);
	const valueAxisTitle = optionalText(document.valueAxisTitle);
	return {
		id: optionalText(document.id) ?? (slug(title) || "sketchi-chart"),
		title,
		type: chartDiagramType,
		kind: document.kind,
		categories: Arr.map(document.categories, cleanToolString),
		series: Arr.map(document.series, (series) => {
			const name = optionalText(series.name);
			return { ...(name ? { name } : {}), values: Arr.copy(series.values) };
		}),
		...(unit ? { unit } : {}),
		...(categoryAxisTitle ? { categoryAxisTitle } : {}),
		...(valueAxisTitle ? { valueAxisTitle } : {}),
		...(document.stacked !== undefined ? { stacked: document.stacked } : {}),
		...(document.donut !== undefined ? { donut: document.donut } : {}),
		...(document.orientation ? { orientation: document.orientation } : {}),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

export const ChartValidationIssueCodeSchema = Schema.Literals([
	"chart_too_large",
	"chart_series_mismatch",
	"duplicate_chart_category",
	"invalid_chart_series",
	"invalid_chart_value",
	"invalid_chart_option",
]);
export type ChartValidationIssueCode = typeof ChartValidationIssueCodeSchema.Type;
export const ChartValidationIssue = Schema.Struct({
	code: ChartValidationIssueCodeSchema,
	path: Schema.String,
	message: Schema.String,
	hint: Schema.String,
});
export interface ChartValidationIssue extends Schema.Schema.Type<typeof ChartValidationIssue> {}

const sameName = (name: string) => Str.toLowerCase(Str.trim(name));

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
	const seenCategories = Set.empty<string>();
	Arr.forEach(categories, (category, index) => {
		if (Set.has(seenCategories, sameName(category)))
			issues.push({
				code: "duplicate_chart_category",
				path: `categories.[${index}]`,
				message: `Category "${category}" is listed more than once.`,
				hint: "List each category once; put its values for every series at the same position.",
			});
		Set.add(seenCategories, sameName(category));
	});
	if (pie && series.length !== 1)
		issues.push({
			code: "invalid_chart_series",
			path: "series",
			message: "A pie chart has exactly one series.",
			hint: "Use one series of slice values, or a grouped bar chart to compare several series.",
		});
	const seenSeries = Set.empty<string>();
	Arr.forEach(series, (entry, index) => {
		const path = `series.[${index}]`;
		if (series.length > 1 && entry.name === undefined)
			issues.push({
				code: "invalid_chart_series",
				path: `${path}.name`,
				message: `Series ${index + 1} needs a name for the legend.`,
				hint: "Name every series when a chart has more than one.",
			});
		if (entry.name !== undefined) {
			if (Set.has(seenSeries, sameName(entry.name)))
				issues.push({
					code: "invalid_chart_series",
					path: `${path}.name`,
					message: `Series name "${entry.name}" is used more than once.`,
					hint: "Give each series a distinct name.",
				});
			Set.add(seenSeries, sameName(entry.name));
		}
		if (entry.values.length !== categories.length)
			issues.push({
				code: "chart_series_mismatch",
				path: `${path}.values`,
				message: `Series ${entry.name ? `"${entry.name}"` : index + 1} has ${entry.values.length} values for ${categories.length} categories.`,
				hint: "Give every series exactly one value per category, in category order.",
			});
		if (pie && Arr.some(entry.values, (value) => value < 0))
			issues.push({
				code: "invalid_chart_value",
				path: `${path}.values`,
				message: "Pie slice values cannot be negative.",
				hint: "Use a bar chart for data with negative values.",
			});
	});
	if (pie && series[0] && !Arr.some(series[0].values, (value) => value > 0))
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
	return Arr.take(issues, 20);
}

export class ChartValidationError extends Schema.TaggedError<
	ChartValidationError,
	{ readonly brand: unique symbol }
>()("ChartValidationError", {
	message: Schema.String,
	issues: Schema.Array(ChartValidationIssue),
}) {
	static fromIssues(issues: readonly ChartValidationIssue[]): ChartValidationError {
		return ChartValidationError.make({
			issues,
			message: Option.match(Arr.head(issues), {
				onNone: () => "Chart failed validation.",
				onSome: (issue) => issue.message,
			}),
		});
	}
}
export function validateChartDiagram(
	diagram: ChartDiagram,
): Result.Result<ChartDiagram, ChartValidationError> {
	const issues = getChartValidationIssues(diagram);
	return issues.length > 0
		? Result.fail(ChartValidationError.fromIssues(issues))
		: Result.succeed(diagram);
}
export function parseChartDiagram(
	input: unknown,
): Result.Result<ChartDiagram, Schema.SchemaError | ChartValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(ChartDiagram, { errors: "all" })(input),
		validateChartDiagram,
	);
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
}).pipe(Result.getOrThrow);

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: ChartDiagram) {
	return {
		nodeCount: diagram.categories.length,
		nodeNoun: diagram.kind === "pie" ? "slices" : "categories",
		edgeCount: diagram.series.length,
		edgeNoun: "series",
	};
}
