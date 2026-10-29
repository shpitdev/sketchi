import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

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
export class QuadrantAxis extends Schema.Class<QuadrantAxis>("QuadrantAxis")({
	title: Schema.NonEmptyString,
	low: Schema.NonEmptyString,
	high: Schema.NonEmptyString,
}) {}
export const QuadrantAxisSchema = QuadrantAxis;

/** The four quadrant names, by corner. */
export class QuadrantNames extends Schema.Class<QuadrantNames>("QuadrantNames")({
	topLeft: Schema.NonEmptyString,
	topRight: Schema.NonEmptyString,
	bottomLeft: Schema.NonEmptyString,
	bottomRight: Schema.NonEmptyString,
}) {}
export const QuadrantNamesSchema = QuadrantNames;

/**
 * One item placed on the chart. `x` and `y` run from 0 (the low end) to 1 (the
 * high end) of their axes; 0.5 sits on the line between two quadrants.
 */
export class QuadrantPoint extends Schema.Class<QuadrantPoint>("QuadrantPoint")({
	label: Schema.NonEmptyString,
	x: Schema.Finite,
	y: Schema.Finite,
	/** Points of one group share a color, and the legend names the group. */
	group: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const QuadrantPointSchema = QuadrantPoint;

/**
 * A quadrant chart: two axes split a square plot into four named quadrants,
 * and each point sits at its `x`, `y`. The renderer owns every position.
 */
export class QuadrantDiagram extends Schema.Class<QuadrantDiagram>("QuadrantDiagram")({
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
}) {}
export const QuadrantDiagramSchema = QuadrantDiagram;

export type QuadrantValidationIssueCode =
	| "quadrant_too_large"
	| "invalid_quadrant_point"
	| "invalid_quadrant_text";

export interface QuadrantValidationIssue {
	readonly code: QuadrantValidationIssueCode;
	readonly path: string;
	readonly message: string;
	readonly hint: string;
}

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

export class QuadrantValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly QuadrantValidationIssue[]) {
		super(issues[0]?.message ?? "Quadrant chart failed validation.");
		this.name = "QuadrantValidationError";
	}
}

export function validateQuadrantDiagram(diagram: QuadrantDiagram): QuadrantDiagram {
	const issues = getQuadrantValidationIssues(diagram);
	if (issues.length) throw new QuadrantValidationError(issues);
	return diagram;
}

export function parseQuadrantDiagram(input: unknown): QuadrantDiagram {
	return validateQuadrantDiagram(
		Schema.decodeUnknownSync(QuadrantDiagram, { errors: "all" })(input),
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
});
