import {
	parseQuadrantDiagram,
	QUADRANT_KEYS,
	type QuadrantDiagram,
	type QuadrantKey,
} from "@sketchi/diagram-core";
import {
	quadrantLayoutIssues,
	readQuadrantScene,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

type End = "low" | "high";

/** An axis the prompt states: its variable and the words for each of its ends. */
export interface QuadrantScenarioAxis {
	/** Forms of the variable the axis title names ("Urgency" or "Urgent"). */
	readonly variable: readonly string[];
	readonly low: readonly string[];
	readonly high: readonly string[];
}

/** A quadrant the prompt names, by the end of each stated axis it covers. */
export interface QuadrantScenarioQuadrant {
	readonly names: readonly string[];
	readonly x: End;
	readonly y: End;
}

/**
 * An item the prompt places: by its scores on each stated axis (0–1 from the
 * stated low end), or only by the quadrant it belongs in.
 */
export interface QuadrantScenarioPoint {
	readonly labels: readonly string[];
	readonly x?: number;
	readonly y?: number;
	/** The key of its quadrant, for an item the prompt places only by membership. */
	readonly quadrant?: string;
	/** The prompt sets it apart in color from every other point. */
	readonly highlight?: true;
}

export interface QuadrantScenario {
	readonly assertions: {
		readonly xAxis: QuadrantScenarioAxis;
		readonly yAxis: QuadrantScenarioAxis;
		/** Whether the prompt fixes which variable goes on which axis. */
		readonly axesFixed: boolean;
		readonly quadrants: Readonly<Record<string, QuadrantScenarioQuadrant>>;
		readonly points: Readonly<Record<string, QuadrantScenarioPoint>>;
		/** Quadrants no stated point falls in. */
		readonly emptyQuadrants: readonly string[];
	};
	readonly description: string;
	readonly diagramType: "quadrant";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: QuadrantDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/** Labels compare without case, spaces or punctuation: "Two-factor authentication" matches "two factor authentication". */
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const matchesAny = (found: string | undefined, accepted: readonly string[]) =>
	found !== undefined && accepted.some((value) => key(value) === key(found));

/** A stated position sits within this of where the prompt puts it, on each axis. */
export const QUADRANT_POSITION_TOLERANCE = 0.02;
/** An item placed only by its quadrant sits at least this far from both middle lines. */
export const QUADRANT_MEMBERSHIP_MARGIN = 0.03;

/**
 * How the drawn axes carry the stated ones: which drawn axis holds each stated
 * variable, and whether it runs from the stated low end to the high end or
 * the other way, as its end labels read.
 */
interface Orientation {
	/** The drawn axis carrying the stated x variable. */
	readonly statedX: "xAxis" | "yAxis";
	readonly reversed: { readonly x: boolean; readonly y: boolean };
	/** Each stated axis's ends read as stated, in one direction or the other. */
	readonly endsRead: { readonly x: boolean; readonly y: boolean };
	/** Each stated variable titles the axis that carries it. */
	readonly titled: { readonly x: boolean; readonly y: boolean };
}

function axisDirection(
	drawn: QuadrantDiagram["xAxis"],
	stated: QuadrantScenarioAxis,
): { readonly read: boolean; readonly reversed: boolean } {
	if (matchesAny(drawn.low, stated.low) && matchesAny(drawn.high, stated.high))
		return { read: true, reversed: false };
	if (matchesAny(drawn.low, stated.high) && matchesAny(drawn.high, stated.low))
		return { read: true, reversed: true };
	return { read: false, reversed: false };
}

const titles = (drawn: QuadrantDiagram["xAxis"], stated: QuadrantScenarioAxis) =>
	stated.variable.some((variable) => key(drawn.title).includes(key(variable)));

function orientation(scenario: QuadrantScenario, diagram: QuadrantDiagram): Orientation {
	const { xAxis, yAxis, axesFixed } = scenario.assertions;
	const swapped =
		!axesFixed &&
		!titles(diagram.xAxis, xAxis) &&
		titles(diagram.xAxis, yAxis) &&
		titles(diagram.yAxis, xAxis);
	const onX = swapped ? diagram.yAxis : diagram.xAxis;
	const onY = swapped ? diagram.xAxis : diagram.yAxis;
	const x = axisDirection(onX, xAxis);
	const y = axisDirection(onY, yAxis);
	return {
		statedX: swapped ? "yAxis" : "xAxis",
		reversed: { x: x.reversed, y: y.reversed },
		endsRead: { x: x.read, y: y.read },
		titled: { x: titles(onX, xAxis), y: titles(onY, yAxis) },
	};
}

/** A drawn point's position on the stated axes, each from its stated low end. */
function statedPosition(
	point: { readonly x: number; readonly y: number },
	turn: Orientation,
): { readonly x: number; readonly y: number } {
	const [onX, onY] = turn.statedX === "xAxis" ? [point.x, point.y] : [point.y, point.x];
	return {
		x: turn.reversed.x ? 1 - onX : onX,
		y: turn.reversed.y ? 1 - onY : onY,
	};
}

/** The stated ends a drawn corner covers. */
function cornerEnds(corner: QuadrantKey, turn: Orientation): { readonly x: End; readonly y: End } {
	const drawnX: End = corner.endsWith("Left") ? "low" : "high";
	const drawnY: End = corner.startsWith("bottom") ? "low" : "high";
	const [onX, onY] = turn.statedX === "xAxis" ? [drawnX, drawnY] : [drawnY, drawnX];
	const flip = (end: End, reversed: boolean): End =>
		reversed ? (end === "low" ? "high" : "low") : end;
	return { x: flip(onX, turn.reversed.x), y: flip(onY, turn.reversed.y) };
}

const side = (value: number, margin: number): End | undefined =>
	value < 0.5 - margin ? "low" : value > 0.5 + margin ? "high" : undefined;

/**
 * Quadrant checks score what the prompt states, each on its own and read
 * through the axis ends as drawn, so an axis that runs high to low passes when
 * every name and point follows it: each axis's variable and end labels, each
 * quadrant name in the corner its conditions describe, every item by label at
 * its stated scores (or strictly inside its stated quadrant), a stated
 * highlight, a stated empty quadrant, and no item the prompt does not state.
 */
export function quadrantScenarioChecks(
	scenario: QuadrantScenario,
	diagram: QuadrantDiagram,
): ScenarioCheck[] {
	const { xAxis, yAxis, quadrants, points, emptyQuadrants } = scenario.assertions;
	const turn = orientation(scenario, diagram);
	const axisChecks: ScenarioCheck[] = (["x", "y"] as const).flatMap((axis) => {
		const stated = axis === "x" ? xAxis : yAxis;
		return [
			{
				id: `axis:${axis}`,
				passed: turn.titled[axis],
				message: `Expected the ${stated.variable[0]} axis titled "${stated.variable.join('" or "')}".`,
			},
			{
				id: `axis-ends:${axis}`,
				passed: turn.endsRead[axis],
				message: `Expected the ${stated.variable[0]} axis to run between "${stated.low[0]}" and "${stated.high[0]}" (either way).`,
			},
		];
	});
	const quadrantChecks = Object.entries(quadrants).map(([quadrantKey, expected]): ScenarioCheck => {
		const corner = QUADRANT_KEYS.find((candidate) => {
			const ends = cornerEnds(candidate, turn);
			return ends.x === expected.x && ends.y === expected.y;
		})!;
		const drawn = diagram.quadrants[corner];
		return {
			id: `quadrant:${quadrantKey}`,
			passed: matchesAny(drawn, expected.names),
			message: `Expected "${expected.names[0]}" in the ${expected.x} ${xAxis.variable[0]}, ${expected.y} ${yAxis.variable[0]} corner (${corner} as drawn); found "${drawn}".`,
		};
	});
	const matched = new Map(
		Object.entries(points).map(([pointKey, expected]) => [
			pointKey,
			diagram.points.find((point) => matchesAny(point.label, expected.labels)),
		]),
	);
	const pointChecks = Object.entries(points).flatMap(([pointKey, expected]): ScenarioCheck[] => {
		const point = matched.get(pointKey);
		const label = expected.labels[0]!;
		const position = point ? statedPosition(point, turn) : undefined;
		const checks: ScenarioCheck[] = [
			{
				id: `point:${pointKey}`,
				passed: point !== undefined,
				message: `Expected a point labeled "${expected.labels.join('" or "')}".`,
			},
		];
		if (expected.x !== undefined && expected.y !== undefined) {
			const { x, y } = expected;
			checks.push({
				id: `position:${pointKey}`,
				passed:
					position !== undefined &&
					Math.abs(position.x - x) <= QUADRANT_POSITION_TOLERANCE &&
					Math.abs(position.y - y) <= QUADRANT_POSITION_TOLERANCE,
				message: `Expected "${label}" at ${xAxis.variable[0]} ${x}, ${yAxis.variable[0]} ${y} from each axis's low end${position ? `; found ${position.x.toFixed(2)}, ${position.y.toFixed(2)}` : ""}.`,
			});
		}
		if (expected.quadrant !== undefined) {
			const stated = quadrants[expected.quadrant]!;
			checks.push({
				id: `quadrant-of:${pointKey}`,
				passed:
					position !== undefined &&
					side(position.x, QUADRANT_MEMBERSHIP_MARGIN) === stated.x &&
					side(position.y, QUADRANT_MEMBERSHIP_MARGIN) === stated.y,
				message: `Expected "${label}" well inside "${stated.names[0]}", at least ${QUADRANT_MEMBERSHIP_MARGIN} from both middle lines.`,
			});
		}
		if (expected.highlight) {
			const group = point?.group;
			checks.push({
				id: `highlight:${pointKey}`,
				passed:
					point !== undefined &&
					group !== undefined &&
					diagram.points.every(
						(other) =>
							other === point || other.group === undefined || key(other.group) !== key(group),
					),
				message: `Expected "${label}" in a group of its own, so its color differs from every other point's.`,
			});
		}
		return checks;
	});
	const emptyChecks = emptyQuadrants.map((quadrantKey): ScenarioCheck => {
		const stated = quadrants[quadrantKey]!;
		const inside = diagram.points.filter((point) => {
			const position = statedPosition(point, turn);
			return side(position.x, 0) === stated.x && side(position.y, 0) === stated.y;
		});
		return {
			id: `empty:${quadrantKey}`,
			passed: inside.length === 0,
			message: `Expected "${stated.names[0]}" to stay empty${inside.length ? `; found ${inside.map((point) => `"${point.label}"`).join(", ")}` : ""}.`,
		};
	});
	const count = Object.keys(points).length;
	return [
		...axisChecks,
		...quadrantChecks,
		...pointChecks,
		{
			id: "points-exact",
			passed: diagram.points.length === count,
			message: `Expected exactly ${count} points; found ${diagram.points.length}.`,
		},
		...emptyChecks,
	];
}

const flat = (text: string | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

/** The pixel tolerance for a drawn dot's center against its point's position. */
const DOT_TOLERANCE = 0.5;

/**
 * The drawn scene says what the diagram says: every dot at its point's x and y
 * in plot coordinates with its label, each quadrant's name in its own
 * quadrant, and both axes' titles and end labels.
 */
export function quadrantDrawnCheck(
	diagram: QuadrantDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const readout = readQuadrantScene(scene);
	const problems: string[] = [];
	const { plot } = readout;
	if (!plot) problems.push("plot");
	const size = plot ? plot.right - plot.left : 0;
	diagram.points.forEach((point, index) => {
		const dot = readout.dots.find((entry) => entry.index === index);
		const label = readout.labels.find((entry) => entry.index === index);
		if (
			!dot ||
			!plot ||
			Math.abs(dot.center.x - (plot.left + point.x * size)) > DOT_TOLERANCE ||
			Math.abs(dot.center.y - (plot.top + (1 - point.y) * size)) > DOT_TOLERANCE
		)
			problems.push(`${point.label} dot`);
		if (flat(label?.text) !== flat(point.label)) problems.push(`${point.label} label`);
	});
	for (const corner of QUADRANT_KEYS) {
		const name = readout.names.find((entry) => entry.key === corner);
		const region = readout.regions[corner];
		if (
			!name ||
			!region ||
			flat(name.text) !== flat(diagram.quadrants[corner]) ||
			name.box.left < region.left - 0.5 ||
			name.box.right > region.right + 0.5 ||
			name.box.top < region.top - 0.5 ||
			name.box.bottom > region.bottom + 0.5
		)
			problems.push(`${corner} name`);
	}
	const text = (id: string) => flat(readout.texts.find((entry) => entry.id === id)?.text);
	for (const axis of ["x", "y"] as const)
		for (const part of ["title", "low", "high"] as const)
			if (text(`quadrant:axis:${axis}:${part}`) !== flat(diagram[`${axis}Axis`][part]))
				problems.push(`${axis} axis ${part}`);
	return {
		id: "quadrant-drawn",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every dot sits at its point's position with its label, each quadrant's name sits in its quadrant, and both axes carry their titles and end labels."
				: `Drawn differently from the diagram: ${problems.slice(0, 8).join(", ")}.`,
	};
}

/** No label overlaps another text or a dot, every label stays in the plot, and each reads as its own dot's. */
export function quadrantLayoutCheck(
	diagram: QuadrantDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const issues = quadrantLayoutIssues(scene, diagram).filter(
		(issue) => issue.code !== "dot-position",
	);
	return {
		id: "quadrant-layout",
		passed: issues.length === 0,
		message:
			issues.length === 0
				? "No label overlaps another text or a dot, every label sits in the plot nearest its own dot or on a leader to it, none lines up with another dot instead of its own, and no line crosses text."
				: issues
						.slice(0, 6)
						.map((issue) => issue.message)
						.join(" "),
	};
}

type PointDefinition = readonly [
	key: string,
	/** The label as stated, or every form it may take. */
	labels: string | readonly string[],
	/** Scores out of 100 on the stated axes, or the key of the stated quadrant. */
	place: readonly [x: number, y: number] | string,
	extra?: { readonly highlight?: true; readonly group?: string },
];

interface QuadrantScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly xAxis: QuadrantScenarioAxis;
	readonly yAxis: QuadrantScenarioAxis;
	readonly axesFixed?: boolean;
	readonly quadrants: Readonly<Record<string, QuadrantScenarioQuadrant>>;
	readonly points: readonly PointDefinition[];
	readonly emptyQuadrants?: readonly string[];
}

const list = (value: string | readonly string[]): readonly string[] =>
	typeof value === "string" ? [value] : value;

function defineQuadrantScenario(definition: QuadrantScenarioDefinition): QuadrantScenario {
	const {
		xAxis,
		yAxis,
		axesFixed = true,
		quadrants,
		points,
		emptyQuadrants = [],
		...scenario
	} = definition;
	const corner = (quadrantKey: string): QuadrantKey => {
		const { x, y } = quadrants[quadrantKey]!;
		return `${y === "high" ? "top" : "bottom"}${x === "high" ? "Right" : "Left"}`;
	};
	// An item placed only by its quadrant sits inside it, spread so no two coincide.
	const membership = new Map<string, number>();
	const memberPosition = (quadrantKey: string) => {
		const at = membership.get(quadrantKey) ?? 0;
		membership.set(quadrantKey, at + 1);
		const { x, y } = quadrants[quadrantKey]!;
		const offset = [0.25, 0.15, 0.35, 0.2, 0.3][at % 5]!;
		const along = [0.25, 0.35, 0.15, 0.3, 0.2][at % 5]!;
		return {
			x: x === "high" ? 1 - offset : offset,
			y: y === "high" ? 1 - along : along,
		};
	};
	return {
		...scenario,
		diagramType: "quadrant",
		logos: [],
		assertions: {
			xAxis,
			yAxis,
			axesFixed,
			quadrants,
			points: Object.fromEntries(
				points.map(([pointKey, labels, place, extra]) => [
					pointKey,
					{
						labels: list(labels),
						...(typeof place === "string"
							? { quadrant: place }
							: { x: place[0] / 100, y: place[1] / 100 }),
						...(extra?.highlight ? { highlight: true as const } : {}),
					},
				]),
			),
			emptyQuadrants,
		},
		expectedDiagram: parseQuadrantDiagram({
			id: definition.id,
			title: definition.title,
			type: "quadrant",
			xAxis: { title: xAxis.variable[0], low: xAxis.low[0], high: xAxis.high[0] },
			yAxis: { title: yAxis.variable[0], low: yAxis.low[0], high: yAxis.high[0] },
			quadrants: Object.fromEntries(
				Object.entries(quadrants).map(([quadrantKey, quadrant]) => [
					corner(quadrantKey),
					quadrant.names[0],
				]),
			),
			points: points.map(([, labels, place, extra]) => ({
				label: list(labels)[0],
				...(typeof place === "string"
					? memberPosition(place)
					: { x: place[0] / 100, y: place[1] / 100 }),
				...(extra?.group ? { group: extra.group } : {}),
			})),
		}),
	};
}

const quadrantScenarioDefinitions: readonly QuadrantScenarioDefinition[] = [
	{
		id: "effort-impact-quadrant",
		title: "Q3 backlog: effort vs impact",
		difficulty: "challenge",
		tags: ["quadrant", "prioritization", "crowded", "midline", "long-labels"],
		description:
			"Fifteen backlog items by effort and impact scores out of 100: eight crowded into Quick wins, several nearly coinciding, and one on the effort midline.",
		prompt:
			"Draw an effort vs impact quadrant chart for our Q3 backlog, with effort on the x-axis from Low effort to High effort and impact on the y-axis from Low impact to High impact. Name the quadrants Quick wins (low effort, high impact), Major projects (high effort, high impact), Fill-ins (low effort, low impact) and Thankless tasks (high effort, low impact). Place each item by its effort and impact scores out of 100: Single sign-on (30, 85), Dark mode (20, 40), CSV export (15, 70), Usage-based billing (80, 90), Mobile offline mode (85, 75), Custom report builder (70, 80), Audit log (35, 78), Slack notifications (18, 72), Bulk user import (25, 82), Two-factor authentication (28, 88), API rate limit dashboard (32, 66), Onboarding checklist (22, 76), Legacy theme cleanup (75, 20), Localization for 12 languages (90, 35), Admin role templates (50, 60).",
		xAxis: { variable: ["Effort"], low: ["Low effort"], high: ["High effort"] },
		yAxis: { variable: ["Impact"], low: ["Low impact"], high: ["High impact"] },
		quadrants: {
			"quick-wins": { names: ["Quick wins"], x: "low", y: "high" },
			"major-projects": { names: ["Major projects"], x: "high", y: "high" },
			"fill-ins": { names: ["Fill-ins"], x: "low", y: "low" },
			"thankless-tasks": { names: ["Thankless tasks"], x: "high", y: "low" },
		},
		points: [
			["single-sign-on", "Single sign-on", [30, 85]],
			["dark-mode", "Dark mode", [20, 40]],
			["csv-export", "CSV export", [15, 70]],
			["usage-based-billing", "Usage-based billing", [80, 90]],
			["mobile-offline-mode", "Mobile offline mode", [85, 75]],
			["custom-report-builder", "Custom report builder", [70, 80]],
			["audit-log", "Audit log", [35, 78]],
			["slack-notifications", "Slack notifications", [18, 72]],
			["bulk-user-import", "Bulk user import", [25, 82]],
			["two-factor-authentication", "Two-factor authentication", [28, 88]],
			["api-rate-limit-dashboard", "API rate limit dashboard", [32, 66]],
			["onboarding-checklist", "Onboarding checklist", [22, 76]],
			["legacy-theme-cleanup", "Legacy theme cleanup", [75, 20]],
			["localization", "Localization for 12 languages", [90, 35]],
			["admin-role-templates", "Admin role templates", [50, 60]],
		],
	},
	{
		id: "eisenhower-matrix-quadrant",
		title: "This week's Eisenhower matrix",
		difficulty: "smoke",
		tags: ["quadrant", "eisenhower", "membership"],
		description:
			"Eight tasks by quadrant only, urgency against importance, with the axis direction left to the model.",
		prompt:
			"Draw an Eisenhower matrix of my tasks this week as a quadrant chart, with urgency on the x-axis and importance on the y-axis. Name the quadrants Do first (urgent and important), Schedule (important, not urgent), Delegate (urgent, not important) and Eliminate (neither). Urgent and important: Fix the production outage, Submit the board deck. Important, not urgent: Plan the Q4 roadmap, Mentor the new hire. Urgent, not important: Reply to vendor invoices, Book the offsite venue. Neither: Reorganize the shared drive, Browse conference swag.",
		xAxis: {
			variable: ["Urgency", "Urgent"],
			low: ["Not urgent", "Less urgent", "Low urgency"],
			high: ["Urgent", "More urgent", "High urgency", "Very urgent"],
		},
		yAxis: {
			variable: ["Importance", "Important"],
			low: ["Not important", "Less important", "Low importance", "Unimportant"],
			high: ["Important", "More important", "High importance", "Very important"],
		},
		quadrants: {
			"do-first": { names: ["Do first"], x: "high", y: "high" },
			schedule: { names: ["Schedule"], x: "low", y: "high" },
			delegate: { names: ["Delegate"], x: "high", y: "low" },
			eliminate: { names: ["Eliminate"], x: "low", y: "low" },
		},
		points: [
			["production-outage", "Fix the production outage", "do-first"],
			["board-deck", "Submit the board deck", "do-first"],
			["q4-roadmap", "Plan the Q4 roadmap", "schedule"],
			["mentor", "Mentor the new hire", "schedule"],
			["vendor-invoices", "Reply to vendor invoices", "delegate"],
			["offsite-venue", "Book the offsite venue", "delegate"],
			["shared-drive", "Reorganize the shared drive", "eliminate"],
			["conference-swag", "Browse conference swag", "eliminate"],
		],
	},
	{
		id: "competitor-positioning-quadrant",
		title: "Project management tools by price and ease",
		difficulty: "standard",
		tags: ["quadrant", "positioning", "highlight", "empty-quadrant"],
		description:
			"Nine products by price and ease of use, one quadrant left empty and our product set apart in color.",
		prompt:
			"Draw a competitor positioning quadrant chart of project management tools, with price on the x-axis from Low price to High price and ease of use on the y-axis from Hard to use to Easy to use. Name the quadrants Best value (low price, easy), Premium and simple (high price, easy), Budget and complex (low price, hard) and Overpriced (high price, hard). Scores out of 100 (price, ease of use): Trello (25, 85), Asana (60, 75), Monday.com (65, 80), Jira (55, 30), Wrike (70, 45), ClickUp (35, 55), Smartsheet (75, 40), Basecamp (45, 70), Our product (40, 82). Show Our product in a different colour from the competitors.",
		xAxis: { variable: ["Price"], low: ["Low price"], high: ["High price"] },
		yAxis: { variable: ["Ease of use", "Ease"], low: ["Hard to use"], high: ["Easy to use"] },
		quadrants: {
			"best-value": { names: ["Best value"], x: "low", y: "high" },
			"premium-and-simple": { names: ["Premium and simple"], x: "high", y: "high" },
			"budget-and-complex": { names: ["Budget and complex"], x: "low", y: "low" },
			overpriced: { names: ["Overpriced"], x: "high", y: "low" },
		},
		points: [
			["trello", "Trello", [25, 85]],
			["asana", "Asana", [60, 75]],
			["monday", "Monday.com", [65, 80]],
			["jira", "Jira", [55, 30]],
			["wrike", "Wrike", [70, 45]],
			["clickup", "ClickUp", [35, 55]],
			["smartsheet", "Smartsheet", [75, 40]],
			["basecamp", "Basecamp", [45, 70]],
			["our-product", "Our product", [40, 82], { highlight: true, group: "Our product" }],
		],
		emptyQuadrants: ["budget-and-complex"],
	},
];

export const quadrantScenarios: readonly QuadrantScenario[] =
	quadrantScenarioDefinitions.map(defineQuadrantScenario);
