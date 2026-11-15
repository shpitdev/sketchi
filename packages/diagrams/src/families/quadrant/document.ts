// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Effect, Schema, Array as Arr, Option, Result } from "effect";

import { DiagramStyle, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";

export const quadrantDiagramType = "quadrant" as const;

/** More points or groups stop reading as one chart; split them instead. */
export const QUADRANT_MAX_POINTS = 30;
export const QUADRANT_MAX_GROUPS = 6;
export const QUADRANT_MAX_LABEL_LENGTH = 40;
export const QUADRANT_MAX_NAME_LENGTH = 40;
export const QUADRANT_MAX_AXIS_TITLE_LENGTH = 40;
export const QUADRANT_MAX_END_LABEL_LENGTH = 30;
export const QUADRANT_MAX_GROUP_LENGTH = 30;
export const QUADRANT_MAX_ISSUES = 20;

/**
 * The four quadrants by corner, which fixes their order: `topLeft` is low x
 * and high y, `topRight` high x and high y, `bottomLeft` low x and low y,
 * `bottomRight` high x and low y.
 */
export const QUADRANT_KEYS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
export type QuadrantKey = (typeof QUADRANT_KEYS)[number];

/** An axis: its title, the label at its low end (left or bottom) and at its high end. */
export const QuadrantAxis = Schema.Struct({
	title: Schema.NonEmptyString,
	low: Schema.NonEmptyString,
	high: Schema.NonEmptyString,
}).annotate({ identifier: "QuadrantAxis" });

export interface QuadrantAxis extends Schema.Schema.Type<typeof QuadrantAxis> {}

/** The four quadrant names, by corner. */
export const QuadrantNames = Schema.Struct({
	topLeft: Schema.NonEmptyString,
	topRight: Schema.NonEmptyString,
	bottomLeft: Schema.NonEmptyString,
	bottomRight: Schema.NonEmptyString,
}).annotate({ identifier: "QuadrantNames" });

export interface QuadrantNames extends Schema.Schema.Type<typeof QuadrantNames> {}

/**
 * One item placed on the chart. `x` and `y` run from 0 (the low end) to 1 (the
 * high end) of their axes; 0.5 sits on the line between two quadrants.
 */
export const QuadrantPoint = Schema.Struct({
	label: Schema.NonEmptyString,
	x: Schema.Finite,
	y: Schema.Finite,
	/** Points of one group share a color, and the legend names the group. */
	group: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "QuadrantPoint" });

export interface QuadrantPoint extends Schema.Schema.Type<typeof QuadrantPoint> {}

/**
 * A quadrant chart: two axes split a square plot into four named quadrants,
 * and each point sits at its `x`, `y`. The renderer owns every position.
 */
export const QuadrantDiagram = Schema.Struct({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(quadrantDiagramType),
	xAxis: QuadrantAxis,
	yAxis: QuadrantAxis,
	quadrants: QuadrantNames,
	points: Schema.Array(QuadrantPoint).pipe(Schema.mutable),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}).annotate({ identifier: "QuadrantDiagram" });

export interface QuadrantDiagram extends Schema.Schema.Type<typeof QuadrantDiagram> {}

export const QuadrantValidationIssueCodeSchema = Schema.Literals([
	"quadrant_too_large",
	"invalid_quadrant_point",
	"invalid_quadrant_text",
]);
export type QuadrantValidationIssueCode = typeof QuadrantValidationIssueCodeSchema.Type;

export const QuadrantValidationIssue = Schema.Struct({
	code: QuadrantValidationIssueCodeSchema,
	path: Schema.String,
	message: Schema.String,
	hint: Schema.String,
});
export interface QuadrantValidationIssue extends Schema.Schema.Type<
	typeof QuadrantValidationIssue
> {}

const sameText = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

/** The key two group names share when they differ only in case or spacing. */
export function quadrantGroupKey(group: string): string {
	return sameText(group);
}

/** The groups a chart's points name, in first-appearance order. */
export function quadrantGroups(diagram: Pick<QuadrantDiagram, "points">): string[] {
	const groups = new Map<string, string>();
	for (const point of diagram.points)
		if (point.group !== undefined && !groups.has(sameText(point.group)))
			groups.set(sameText(point.group), point.group);
	return [...groups.values()];
}

export function getQuadrantValidationIssues(diagram: QuadrantDiagram): QuadrantValidationIssue[] {
	const issues: QuadrantValidationIssue[] = [];
	const text = (path: string, value: string, max: number, what: string) => {
		if (!value.trim())
			issues.push({
				code: "invalid_quadrant_text",
				path,
				message: `${what} is blank.`,
				hint: "Give it the words the request uses, or drop the item it belongs to.",
			});
		else if (value.length > max)
			issues.push({
				code: "invalid_quadrant_text",
				path,
				message: `${what} "${value.slice(0, 24)}…" is longer than ${max} characters.`,
				hint: `Shorten it to at most ${max} characters; the chart has no room for prose.`,
			});
	};
	for (const axis of ["xAxis", "yAxis"] as const) {
		text(`${axis}.title`, diagram[axis].title, QUADRANT_MAX_AXIS_TITLE_LENGTH, "Axis title");
		text(`${axis}.low`, diagram[axis].low, QUADRANT_MAX_END_LABEL_LENGTH, "Axis end label");
		text(`${axis}.high`, diagram[axis].high, QUADRANT_MAX_END_LABEL_LENGTH, "Axis end label");
	}
	for (const key of QUADRANT_KEYS)
		text(`quadrants.${key}`, diagram.quadrants[key], QUADRANT_MAX_NAME_LENGTH, "Quadrant name");
	if (diagram.points.length > QUADRANT_MAX_POINTS)
		issues.push({
			code: "quadrant_too_large",
			path: "points",
			message: `A quadrant chart supports at most ${QUADRANT_MAX_POINTS} points.`,
			hint: "Keep the points the request names, or split them into several charts.",
		});
	const groups = quadrantGroups(diagram);
	if (groups.length > QUADRANT_MAX_GROUPS)
		issues.push({
			code: "quadrant_too_large",
			path: "points",
			message: `A quadrant chart supports at most ${QUADRANT_MAX_GROUPS} groups; this one has ${groups.length}.`,
			hint: "Merge groups, or leave group off points that need no color of their own.",
		});
	const seen = new Set<string>();
	diagram.points.forEach((point, index) => {
		const path = `points.[${index}]`;
		text(`${path}.label`, point.label, QUADRANT_MAX_LABEL_LENGTH, "Point label");
		if (point.group !== undefined)
			text(`${path}.group`, point.group, QUADRANT_MAX_GROUP_LENGTH, "Group name");
		for (const axis of ["x", "y"] as const)
			if (point[axis] < 0 || point[axis] > 1)
				issues.push({
					code: "invalid_quadrant_point",
					path: `${path}.${axis}`,
					message: `Point "${point.label}" has ${axis} ${point[axis]}, outside 0 to 1.`,
					hint: `Scale ${axis} to 0..1 along its axis: 0 is the low end, 1 the high end, 0.5 the middle line. Divide a score out of 100 by 100, or out of 10 by 10.`,
				});
		if (seen.has(sameText(point.label)))
			issues.push({
				code: "invalid_quadrant_point",
				path: `${path}.label`,
				message: `Point "${point.label}" is listed more than once.`,
				hint: "List each item once, or tell repeated items apart in their labels.",
			});
		seen.add(sameText(point.label));
	});
	return issues.slice(0, QUADRANT_MAX_ISSUES);
}

export class QuadrantValidationError extends Schema.TaggedError<
	QuadrantValidationError,
	{ readonly brand: unique symbol }
>()("QuadrantValidationError", {
	message: Schema.String,
	issues: Schema.Array(QuadrantValidationIssue),
}) {
	static fromIssues(issues: readonly QuadrantValidationIssue[]): QuadrantValidationError {
		return QuadrantValidationError.make({
			issues,
			message: Option.match(Arr.head(issues), {
				onNone: () => "Quadrant chart failed validation.",
				onSome: (issue) => issue.message,
			}),
		});
	}
}

export function validateQuadrantDiagram(
	diagram: QuadrantDiagram,
): Result.Result<QuadrantDiagram, QuadrantValidationError> {
	const issues = getQuadrantValidationIssues(diagram);
	return issues.length > 0
		? Result.fail(QuadrantValidationError.fromIssues(issues))
		: Result.succeed(diagram);
}

export function parseQuadrantDiagram(
	input: unknown,
): Result.Result<QuadrantDiagram, Schema.SchemaError | QuadrantValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(QuadrantDiagram, { errors: "all" })(input),
		validateQuadrantDiagram,
	);
}

export const quadrantFixture = parseQuadrantDiagram({
	id: "effort-impact-backlog",
	title: "Effort vs impact",
	type: quadrantDiagramType,
	xAxis: { title: "Effort", low: "Low effort", high: "High effort" },
	yAxis: { title: "Impact", low: "Low impact", high: "High impact" },
	quadrants: {
		topLeft: "Quick wins",
		topRight: "Major projects",
		bottomLeft: "Fill-ins",
		bottomRight: "Thankless tasks",
	},
	points: [
		{ label: "Dark mode", x: 0.2, y: 0.7 },
		{ label: "SSO login", x: 0.75, y: 0.85 },
		{ label: "CSV export", x: 0.3, y: 0.35 },
		{ label: "Rewrite billing", x: 0.9, y: 0.3 },
		{ label: "Onboarding tour", x: 0.45, y: 0.6 },
	],
}).pipe(Result.getOrThrow);

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: QuadrantDiagram) {
	return {
		nodeCount: diagram.points.length,
		nodeNoun: "points",
		edgeCount: new Set(diagram.points.flatMap((point) => point.group ?? [])).size,
		edgeNoun: "groups",
	};
}
