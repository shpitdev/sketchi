import { SVGPathData, SVGPathDataTransformer } from "svg-pathdata";

/**
 * Transcribe a Lucide icon into a hand-drawn recipe, primitive by primitive.
 *
 * Lucide draws on a 24-unit grid with 2-unit centerline strokes, which is how
 * a person sketches: a circle becomes an ellipse, a rect a rectangle, and each
 * path subpath one stroke, smooth where it curves and split at sharp corners
 * so smoothing never rounds them. A zero-length stroke is a dot.
 */

/** One `[tag, attributes]` entry of a Lucide icon node. */
export type LucideIconNode = readonly (readonly [string, Readonly<Record<string, string>>])[];

type Point = readonly [number, number];

/** The recipe parts this transcription emits (the IconRecipe format in diagram-core). */
export type TranscribedPart =
	| {
			readonly kind: "ellipse";
			readonly cx: number;
			readonly cy: number;
			readonly rx: number;
			readonly ry: number;
			readonly fill?: "ink";
	  }
	| {
			readonly kind: "rect";
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly rounded?: true;
	  }
	| {
			readonly kind: "stroke";
			readonly points: readonly Point[];
			readonly smooth?: true;
			readonly closed?: true;
	  };

export interface TranscribedRecipe {
	readonly parts: readonly TranscribedPart[];
}

/** A Lucide dot (a round-capped zero-length stroke) drawn as a filled disc. */
const DOT_RADIUS = 1;
/** Corners turning more than this split a stroke so smoothing keeps them sharp. */
const SHARP_TURN_DEGREES = 35;
/** A straight side longer than this keeps a midpoint, so smoothing cannot bow it. */
const STRAIGHT_SIDE = 4;
/**
 * A curve shorter than this that turns a corner is a rounded corner, drawn as
 * a sharp one: at node-logo size a 2-unit radius reads as a wobble, and a hand
 * sketching a box draws its corners square.
 */
const CORNER_CHORD = 3;
const CORNER_TURN_DEGREES = 45;
const MAX_PARTS = 8;

type Segment =
	| { readonly kind: "line"; readonly from: Point; readonly to: Point }
	| {
			readonly kind: "curve";
			readonly from: Point;
			readonly c1: Point;
			readonly c2: Point;
			readonly to: Point;
	  };

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function point(x: number, y: number): Point {
	return [round(x), round(y)];
}

function distance(a: Point, b: Point): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function cubicAt(segment: Extract<Segment, { kind: "curve" }>, t: number): Point {
	const u = 1 - t;
	const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
	const controls = [segment.from, segment.c1, segment.c2, segment.to] as const;
	return point(
		controls.reduce((sum, control, index) => sum + weights[index]! * control[0], 0),
		controls.reduce((sum, control, index) => sum + weights[index]! * control[1], 0),
	);
}

function direction(from: Point, to: Point, segment: Segment): Point {
	let dx = to[0] - from[0];
	let dy = to[1] - from[1];
	if (Math.hypot(dx, dy) < 1e-6) {
		dx = segment.to[0] - segment.from[0];
		dy = segment.to[1] - segment.from[1];
	}
	const length = Math.hypot(dx, dy) || 1;
	return [dx / length, dy / length];
}

function turnDegrees(incoming: Segment, outgoing: Segment): number {
	const a = direction(
		incoming.kind === "line" ? incoming.from : incoming.c2,
		incoming.to,
		incoming,
	);
	const b = direction(
		outgoing.from,
		outgoing.kind === "line" ? outgoing.to : outgoing.c1,
		outgoing,
	);
	return (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI;
}

function intersection(a: Point, da: Point, b: Point, db: Point): Point | undefined {
	const cross = da[0] * db[1] - da[1] * db[0];
	if (Math.abs(cross) < 1e-6) return undefined;
	const t = ((b[0] - a[0]) * db[1] - (b[1] - a[1]) * db[0]) / cross;
	return [a[0] + t * da[0], a[1] + t * da[1]];
}

/** Replace each small rounded corner with two lines meeting at its sharp corner. */
function squareCorners(segments: readonly Segment[]): Segment[] {
	return segments.flatMap((segment): Segment[] => {
		if (segment.kind === "line" || distance(segment.from, segment.to) >= CORNER_CHORD) {
			return [segment];
		}
		const start = direction(segment.from, segment.c1, segment);
		const end = direction(segment.c2, segment.to, segment);
		const turn =
			(Math.acos(Math.max(-1, Math.min(1, start[0] * end[0] + start[1] * end[1]))) * 180) / Math.PI;
		const corner =
			turn >= CORNER_TURN_DEGREES ? intersection(segment.from, start, segment.to, end) : undefined;
		if (!corner) return [segment];
		return [
			{ kind: "line", from: segment.from, to: corner },
			{ kind: "line", from: corner, to: segment.to },
		];
	});
}

/** Merge consecutive collinear lines, so a squared corner leaves one vertex. */
function mergeLines(segments: readonly Segment[]): Segment[] {
	const merged: Segment[] = [];
	for (const segment of segments) {
		const previous = merged.at(-1);
		if (
			previous?.kind === "line" &&
			segment.kind === "line" &&
			turnDegrees(previous, segment) < 1
		) {
			merged[merged.length - 1] = { kind: "line", from: previous.from, to: segment.to };
		} else {
			merged.push(segment);
		}
	}
	return merged.filter((segment) => distance(segment.from, segment.to) > 1e-6);
}

function subpaths(
	d: string,
): { readonly segments: Segment[]; readonly closed: boolean; readonly start: Point }[] {
	const commands = new SVGPathData(d)
		.transform(SVGPathDataTransformer.TO_ABS())
		.transform(SVGPathDataTransformer.NORMALIZE_ST())
		.transform(SVGPathDataTransformer.QT_TO_C())
		.transform(SVGPathDataTransformer.A_TO_C())
		.transform(SVGPathDataTransformer.NORMALIZE_HVZ(false)).commands;
	const result: { segments: Segment[]; closed: boolean; start: Point }[] = [];
	let cursor: Point = [0, 0];
	for (const command of commands) {
		const current = result.at(-1);
		if (command.type === SVGPathData.MOVE_TO) {
			cursor = [command.x, command.y];
			result.push({ segments: [], closed: false, start: cursor });
		} else if (command.type === SVGPathData.LINE_TO) {
			const to: Point = [command.x, command.y];
			current?.segments.push({ kind: "line", from: cursor, to });
			cursor = to;
		} else if (command.type === SVGPathData.CURVE_TO) {
			const to: Point = [command.x, command.y];
			current?.segments.push({
				kind: "curve",
				from: cursor,
				c1: [command.x1, command.y1],
				c2: [command.x2, command.y2],
				to,
			});
			cursor = to;
		} else if (command.type === SVGPathData.CLOSE_PATH && current) {
			if (distance(cursor, current.start) > 1e-6) {
				current.segments.push({ kind: "line", from: cursor, to: current.start });
			}
			current.closed = true;
			cursor = current.start;
		}
	}
	return result;
}

function runPoints(run: readonly Segment[]): {
	readonly points: Point[];
	readonly smooth: boolean;
} {
	const smooth = run.some((segment) => segment.kind === "curve");
	const points: Point[] = [point(...run[0]!.from)];
	for (const segment of run) {
		if (segment.kind === "line") {
			if (smooth && distance(segment.from, segment.to) > STRAIGHT_SIDE) {
				points.push(
					point((segment.from[0] + segment.to[0]) / 2, (segment.from[1] + segment.to[1]) / 2),
				);
			}
			points.push(point(...segment.to));
		} else {
			const samples = Math.max(1, Math.min(4, Math.round(distance(segment.from, segment.to) / 3)));
			for (let step = 1; step <= samples; step += 1) points.push(cubicAt(segment, step / samples));
		}
	}
	return { points, smooth };
}

function dot([cx, cy]: Point): TranscribedPart {
	return {
		kind: "ellipse",
		cx: round(cx),
		cy: round(cy),
		rx: DOT_RADIUS,
		ry: DOT_RADIUS,
		fill: "ink",
	};
}

function stroke(points: readonly Point[], smooth: boolean, closed: boolean): TranscribedPart {
	return {
		kind: "stroke",
		points,
		...(smooth ? { smooth: true as const } : {}),
		...(closed ? { closed: true as const } : {}),
	};
}

function pathParts(d: string): TranscribedPart[] {
	return subpaths(d).flatMap(({ segments: source, closed, start }): TranscribedPart[] => {
		const length = source.reduce((sum, segment) => sum + distance(segment.from, segment.to), 0);
		if (length < 0.5) return [dot(start)];
		const segments = mergeLines(squareCorners(source));
		const runs: Segment[][] = [[]];
		segments.forEach((segment, index) => {
			const previous = segments[index - 1];
			if (
				previous &&
				(previous.kind === "curve" || segment.kind === "curve") &&
				turnDegrees(previous, segment) > SHARP_TURN_DEGREES
			) {
				runs.push([]);
			}
			runs.at(-1)!.push(segment);
		});
		if (runs.length === 1) {
			const { points, smooth } = runPoints(runs[0]!);
			// A closed recipe stroke returns to its start on its own.
			return [stroke(closed ? points.slice(0, -1) : points, smooth, closed)];
		}
		return runs.map((run) => {
			const { points, smooth } = runPoints(run);
			return stroke(points, smooth, false);
		});
	});
}

function number(attributes: Readonly<Record<string, string>>, key: string): number {
	const value = Number(attributes[key] ?? 0);
	if (!Number.isFinite(value)) throw new Error(`Lucide attribute ${key} is not a number.`);
	return value;
}

function listPoints(value: string | undefined): Point[] {
	const values = (value ?? "")
		.trim()
		.split(/[\s,]+/u)
		.map(Number);
	const points: Point[] = [];
	for (let index = 0; index + 1 < values.length; index += 2)
		points.push(point(values[index]!, values[index + 1]!));
	return points;
}

/** Transcribe one Lucide icon; throws when it needs more parts than a recipe holds. */
export function transcribeLucideIcon(name: string, node: LucideIconNode): TranscribedRecipe {
	const parts = node.flatMap(([tag, attributes]): TranscribedPart[] => {
		switch (tag) {
			case "circle": {
				const r = round(number(attributes, "r"));
				return [
					{
						kind: "ellipse",
						cx: number(attributes, "cx"),
						cy: number(attributes, "cy"),
						rx: r,
						ry: r,
					},
				];
			}
			case "ellipse":
				return [
					{
						kind: "ellipse",
						cx: number(attributes, "cx"),
						cy: number(attributes, "cy"),
						rx: number(attributes, "rx"),
						ry: number(attributes, "ry"),
					},
				];
			case "rect":
				return [
					{
						kind: "rect",
						x: number(attributes, "x"),
						y: number(attributes, "y"),
						width: number(attributes, "width"),
						height: number(attributes, "height"),
						...(number(attributes, "rx") > 0 ? { rounded: true as const } : {}),
					},
				];
			case "line": {
				const from = point(number(attributes, "x1"), number(attributes, "y1"));
				const to = point(number(attributes, "x2"), number(attributes, "y2"));
				return distance(from, to) < 0.5 ? [dot(from)] : [stroke([from, to], false, false)];
			}
			case "polyline":
				return [stroke(listPoints(attributes["points"]), false, false)];
			case "polygon":
				return [stroke(listPoints(attributes["points"]), false, true)];
			case "path":
				return pathParts(attributes["d"] ?? "");
			default:
				throw new Error(`Lucide icon ${name} uses <${tag}>, which recipes cannot draw.`);
		}
	});
	if (parts.length > MAX_PARTS) {
		throw new Error(
			`Lucide icon ${name} needs ${parts.length} parts; a recipe holds ${MAX_PARTS}.`,
		);
	}
	return { parts };
}
