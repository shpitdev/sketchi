import { SVGPathData, SVGPathDataTransformer, type SVGCommand } from "svg-pathdata";

import { pointToSegmentDistance, signedArea, squaredDistance } from "./geometry";
import { parseLength, viewportDiagonal, type SvgViewport } from "./length";
import type { SvgAttributes } from "./style";
import { parseNumberList, transformPoint } from "./transform";
import type {
	CanonicalSubpath,
	EffectiveAdaptiveFlatteningOptions,
	Matrix,
	Point,
	SvgDiagnostic,
	SvgPrimitiveName,
} from "./types";

interface MutableFlatteningMetrics {
	arcSegments: number;
	cubicSegments: number;
	flattenedSegments: number;
}

export interface FlattenedPrimitive {
	readonly diagnostics: readonly SvgDiagnostic[];
	readonly metrics: {
		readonly arcSegments: number;
		readonly cubicSegments: number;
		readonly flattenedSegments: number;
	};
	readonly subpaths: readonly CanonicalSubpath[];
}

const POINT_EPSILON = 1e-10;

function diagnostic(
	code: "adaptive-flattening-depth-exceeded" | "invalid-geometry" | "parse-error",
	message: string,
	sourcePath: string,
): SvgDiagnostic {
	return {
		code,
		elementId: null,
		feature: null,
		message,
		severity: "warning",
		sourcePath,
	};
}

function midpoint(left: Point, right: Point): Point {
	return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function cubicFlatness(start: Point, control1: Point, control2: Point, end: Point): number {
	return Math.max(
		pointToSegmentDistance(control1, { start, end }, POINT_EPSILON),
		pointToSegmentDistance(control2, { start, end }, POINT_EPSILON),
	);
}

function appendPoint(points: Point[], point: Point): void {
	const previous = points.at(-1);
	if (!previous || squaredDistance(previous, point) > POINT_EPSILON) {
		points.push(point);
	}
}

function flattenCubic(
	start: Point,
	control1: Point,
	control2: Point,
	end: Point,
	options: EffectiveAdaptiveFlatteningOptions,
	depth: number,
	points: Point[],
): boolean {
	const flatness = cubicFlatness(start, control1, control2, end);
	if (flatness <= options.tolerance) {
		appendPoint(points, end);
		return false;
	}
	if (depth >= options.maxDepth) {
		appendPoint(points, end);
		return true;
	}

	const startControl = midpoint(start, control1);
	const controls = midpoint(control1, control2);
	const controlEnd = midpoint(control2, end);
	const leftControl = midpoint(startControl, controls);
	const rightControl = midpoint(controls, controlEnd);
	const split = midpoint(leftControl, rightControl);
	const leftExceeded = flattenCubic(
		start,
		startControl,
		leftControl,
		split,
		options,
		depth + 1,
		points,
	);
	const rightExceeded = flattenCubic(
		split,
		rightControl,
		controlEnd,
		end,
		options,
		depth + 1,
		points,
	);
	return leftExceeded || rightExceeded;
}

function normalizedCommands(pathData: string): readonly SVGCommand[] {
	return new SVGPathData(pathData)
		.transform(SVGPathDataTransformer.TO_ABS())
		.transform(SVGPathDataTransformer.NORMALIZE_ST())
		.transform(SVGPathDataTransformer.QT_TO_C())
		.transform(SVGPathDataTransformer.NORMALIZE_HVZ(false, true, true, true))
		.transform(SVGPathDataTransformer.ANNOTATE_ARCS()).commands;
}

function flattenExactEllipseSection(
	center: Point,
	basisU: Point,
	basisV: Point,
	startAngle: number,
	endAngle: number,
	exactEnd: Point,
	matrix: Matrix,
	options: EffectiveAdaptiveFlatteningOptions,
	points: Point[],
): boolean {
	const transformedU = {
		x: matrix[0] * basisU.x + matrix[2] * basisU.y,
		y: matrix[1] * basisU.x + matrix[3] * basisU.y,
	};
	const transformedV = {
		x: matrix[0] * basisV.x + matrix[2] * basisV.y,
		y: matrix[1] * basisV.x + matrix[3] * basisV.y,
	};
	// For p(theta)=c+u*cos(theta)+v*sin(theta), |p''| is bounded by
	// |u|+|v|. Linear interpolation error over an interval h is therefore
	// at most (|u|+|v|)*h^2/8.
	const secondDerivativeBound =
		Math.hypot(transformedU.x, transformedU.y) + Math.hypot(transformedV.x, transformedV.y);
	const angleSpan = endAngle - startAngle;
	const requiredSegments = Math.max(
		1,
		Math.ceil(Math.abs(angleSpan) * Math.sqrt(secondDerivativeBound / (8 * options.tolerance))),
	);
	const segmentLimit = 2 ** options.maxDepth;
	const segmentCount = Number.isFinite(requiredSegments)
		? Math.min(requiredSegments, segmentLimit)
		: segmentLimit;
	for (let index = 1; index <= segmentCount; index += 1) {
		if (index === segmentCount) {
			appendPoint(points, transformPoint(exactEnd, matrix));
			continue;
		}
		const angle = startAngle + (angleSpan * index) / segmentCount;
		appendPoint(
			points,
			transformPoint(
				{
					x: center.x + basisU.x * Math.cos(angle) + basisV.x * Math.sin(angle),
					y: center.y + basisU.y * Math.cos(angle) + basisV.y * Math.sin(angle),
				},
				matrix,
			),
		);
	}
	return requiredSegments > segmentLimit || !Number.isFinite(requiredSegments);
}

function flattenArc(
	command: Extract<SVGCommand, { readonly type: typeof SVGPathData.ARC }>,
	current: Point,
	matrix: Matrix,
	options: EffectiveAdaptiveFlatteningOptions,
	points: Point[],
): boolean {
	const end = { x: command.x, y: command.y };
	if (
		Math.abs(command.rX) <= POINT_EPSILON ||
		Math.abs(command.rY) <= POINT_EPSILON ||
		(current.x === end.x && current.y === end.y)
	) {
		appendPoint(points, transformPoint(end, matrix));
		return false;
	}
	if (
		command.cX === undefined ||
		command.cY === undefined ||
		command.phi1 === undefined ||
		command.phi2 === undefined
	) {
		appendPoint(points, transformPoint(end, matrix));
		return true;
	}

	const rotation = (command.xRot * Math.PI) / 180;
	const cosine = Math.cos(rotation);
	const sine = Math.sin(rotation);
	return flattenExactEllipseSection(
		{ x: command.cX, y: command.cY },
		{ x: command.rX * cosine, y: command.rX * sine },
		{ x: -command.rY * sine, y: command.rY * cosine },
		(command.phi1 * Math.PI) / 180,
		(command.phi2 * Math.PI) / 180,
		end,
		matrix,
		options,
		points,
	);
}

function canonicalSubpath(closed: boolean, points: readonly Point[]): CanonicalSubpath | null {
	if (points.length === 0) {
		return null;
	}
	return { closed, points, signedArea: signedArea(points) };
}

function pathSubpaths(
	pathData: string,
	matrix: Matrix,
	options: EffectiveAdaptiveFlatteningOptions,
	sourcePath: string,
	metrics: MutableFlatteningMetrics,
	diagnostics: SvgDiagnostic[],
): readonly CanonicalSubpath[] {
	const subpaths: CanonicalSubpath[] = [];
	let points: Point[] = [];
	let current: Point = { x: 0, y: 0 };
	let start: Point = current;
	let closed = false;
	let hasDrawingCommand = false;
	let depthExceeded = false;

	const finish = () => {
		const subpath = hasDrawingCommand ? canonicalSubpath(closed, points) : null;
		if (subpath) {
			subpaths.push(subpath);
			metrics.flattenedSegments += Math.max(0, subpath.points.length - 1);
		}
		points = [];
		closed = false;
		hasDrawingCommand = false;
	};

	for (const command of normalizedCommands(pathData)) {
		if (
			points.length === 0 &&
			command.type !== SVGPathData.MOVE_TO &&
			command.type !== SVGPathData.CLOSE_PATH
		) {
			start = current;
			appendPoint(points, transformPoint(current, matrix));
		}
		if (command.type === SVGPathData.MOVE_TO) {
			finish();
			current = { x: command.x, y: command.y };
			start = current;
			appendPoint(points, transformPoint(current, matrix));
		} else if (command.type === SVGPathData.LINE_TO) {
			hasDrawingCommand = true;
			current = { x: command.x, y: command.y };
			appendPoint(points, transformPoint(current, matrix));
		} else if (command.type === SVGPathData.CURVE_TO) {
			hasDrawingCommand = true;
			const end = { x: command.x, y: command.y };
			metrics.cubicSegments += 1;
			depthExceeded =
				flattenCubic(
					transformPoint(current, matrix),
					transformPoint({ x: command.x1, y: command.y1 }, matrix),
					transformPoint({ x: command.x2, y: command.y2 }, matrix),
					transformPoint(end, matrix),
					options,
					0,
					points,
				) || depthExceeded;
			current = end;
		} else if (command.type === SVGPathData.ARC) {
			hasDrawingCommand = true;
			metrics.arcSegments += 1;
			depthExceeded = flattenArc(command, current, matrix, options, points) || depthExceeded;
			current = { x: command.x, y: command.y };
		} else if (command.type === SVGPathData.CLOSE_PATH && points.length > 0) {
			hasDrawingCommand = true;
			appendPoint(points, transformPoint(start, matrix));
			current = start;
			closed = true;
			finish();
		}
	}
	finish();
	if (depthExceeded) {
		diagnostics.push(
			diagnostic(
				"adaptive-flattening-depth-exceeded",
				`Adaptive flattening reached maxDepth=${options.maxDepth} before tolerance=${options.tolerance}.`,
				sourcePath,
			),
		);
	}
	return subpaths;
}

function pointsSubpath(
	value: string | undefined,
	matrix: Matrix,
	closed: boolean,
	metrics: MutableFlatteningMetrics,
	sourcePath: string,
	diagnostics: SvgDiagnostic[],
): readonly CanonicalSubpath[] {
	if (!value?.trim()) return [];
	const values = parseNumberList(value);
	if (!values || values.length % 2 !== 0) {
		diagnostics.push(
			diagnostic(
				"invalid-geometry",
				"Points must be a list of finite coordinate pairs.",
				sourcePath,
			),
		);
		return [];
	}
	const points: Point[] = [];
	for (let index = 0; index + 1 < values.length; index += 2) {
		appendPoint(
			points,
			transformPoint({ x: values[index] ?? 0, y: values[index + 1] ?? 0 }, matrix),
		);
	}
	if (closed && points[0]) {
		appendPoint(points, points[0]);
	}
	const subpath = canonicalSubpath(closed, points);
	if (subpath) {
		metrics.flattenedSegments += Math.max(0, subpath.points.length - 1);
	}
	return subpath ? [subpath] : [];
}

function ellipseSubpath(
	centerX: number,
	centerY: number,
	radiusX: number,
	radiusY: number,
	matrix: Matrix,
	options: EffectiveAdaptiveFlatteningOptions,
	sourcePath: string,
	metrics: MutableFlatteningMetrics,
	diagnostics: SvgDiagnostic[],
): readonly CanonicalSubpath[] {
	if (radiusX <= 0 || radiusY <= 0) {
		diagnostics.push(diagnostic("invalid-geometry", "Ellipse radii must be positive.", sourcePath));
		return [];
	}
	const first = { x: centerX + radiusX, y: centerY };
	const points: Point[] = [transformPoint(first, matrix)];
	metrics.arcSegments += 1;
	const depthExceeded = flattenExactEllipseSection(
		{ x: centerX, y: centerY },
		{ x: radiusX, y: 0 },
		{ x: 0, y: radiusY },
		0,
		2 * Math.PI,
		first,
		matrix,
		options,
		points,
	);
	if (depthExceeded) {
		diagnostics.push(
			diagnostic(
				"adaptive-flattening-depth-exceeded",
				`Adaptive flattening reached maxDepth=${options.maxDepth} before tolerance=${options.tolerance}.`,
				sourcePath,
			),
		);
	}
	const subpath = canonicalSubpath(true, points);
	if (subpath) {
		metrics.flattenedSegments += Math.max(0, subpath.points.length - 1);
	}
	return subpath ? [subpath] : [];
}

function rectPath(
	length: (attribute: string, reference?: number) => number,
	attributes: SvgAttributes,
): string | null {
	const x = length("x");
	const y = length("y");
	const width = length("width");
	const height = length("height");
	if (width <= 0 || height <= 0) {
		return null;
	}
	const specifiedRadiusX = attributes.rx === undefined ? null : length("rx", width);
	const specifiedRadiusY = attributes.ry === undefined ? null : length("ry", height);
	const radiusX = Math.min(width / 2, Math.max(0, specifiedRadiusX ?? specifiedRadiusY ?? 0));
	const radiusY = Math.min(height / 2, Math.max(0, specifiedRadiusY ?? specifiedRadiusX ?? 0));
	if (radiusX === 0 || radiusY === 0) {
		return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
	}
	return [
		`M${x + radiusX} ${y}`,
		`H${x + width - radiusX}`,
		`A${radiusX} ${radiusY} 0 0 1 ${x + width} ${y + radiusY}`,
		`V${y + height - radiusY}`,
		`A${radiusX} ${radiusY} 0 0 1 ${x + width - radiusX} ${y + height}`,
		`H${x + radiusX}`,
		`A${radiusX} ${radiusY} 0 0 1 ${x} ${y + height - radiusY}`,
		`V${y + radiusY}`,
		`A${radiusX} ${radiusY} 0 0 1 ${x + radiusX} ${y}`,
		"Z",
	].join(" ");
}

function isMoveOnlyPath(pathData: string): boolean {
	const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;
	let cursor = 0;
	const skipWhitespace = () => {
		while (cursor < pathData.length && /\s/.test(pathData[cursor] ?? "")) {
			cursor += 1;
		}
	};
	while (cursor < pathData.length) {
		if (pathData[cursor] !== "M" && pathData[cursor] !== "m") {
			return false;
		}
		cursor += 1;
		// One coordinate pair per move; additional pairs are implicit lines.
		for (let coordinate = 0; coordinate < 2; coordinate += 1) {
			skipWhitespace();
			if (coordinate === 1 && pathData[cursor] === ",") {
				cursor += 1;
				skipWhitespace();
			}
			numberPattern.lastIndex = cursor;
			const number = numberPattern.exec(pathData);
			if (!number || !Number.isFinite(Number(number[0]))) {
				return false;
			}
			cursor = numberPattern.lastIndex;
		}
		skipWhitespace();
	}
	return true;
}

/** Prove no rendering without parsing path commands or flattening geometry. */
export function isNonRenderingPrimitive(
	name: SvgPrimitiveName,
	attributes: SvgAttributes,
	viewport: SvgViewport,
): boolean {
	if (name === "path") {
		const pathData = attributes.d?.trim();
		return !pathData || isMoveOnlyPath(pathData);
	}
	if (name === "polygon" || name === "polyline") {
		return !attributes.points?.trim();
	}
	const isZeroLength = (attribute: string, reference: number): boolean =>
		parseLength(attributes[attribute] ?? "0", reference) === 0;
	return (
		(name === "rect" &&
			(isZeroLength("width", viewport.width) || isZeroLength("height", viewport.height))) ||
		(name === "circle" && isZeroLength("r", viewportDiagonal(viewport))) ||
		(name === "ellipse" &&
			(isZeroLength("rx", viewport.width) || isZeroLength("ry", viewport.height)))
	);
}

export function flattenPrimitive(
	name: SvgPrimitiveName,
	attributes: SvgAttributes,
	matrix: Matrix,
	options: EffectiveAdaptiveFlatteningOptions,
	sourcePath: string,
	viewport: SvgViewport,
): FlattenedPrimitive {
	const diagnostics: SvgDiagnostic[] = [];
	const metrics: MutableFlatteningMetrics = {
		arcSegments: 0,
		cubicSegments: 0,
		flattenedSegments: 0,
	};
	// A zero dimension suppresses the primitive before positions or other lengths
	// matter. Unsupported lengths on otherwise rendered geometry still diagnose.
	if (isNonRenderingPrimitive(name, attributes, viewport)) {
		return { diagnostics, metrics, subpaths: [] };
	}
	const length = (attribute: string, referenceOverride?: number): number => {
		const value = attributes[attribute];
		if (value === undefined) return 0;
		const reference =
			referenceOverride ??
			(["y", "y1", "y2", "cy", "height", "ry"].includes(attribute)
				? viewport.height
				: attribute === "r"
					? viewportDiagonal(viewport)
					: viewport.width);
		const parsed = parseLength(value, reference);
		if (parsed === null) {
			diagnostics.push(
				diagnostic("invalid-geometry", `Invalid SVG length for ${attribute}: ${value}`, sourcePath),
			);
		}
		return parsed ?? 0;
	};
	try {
		let subpaths: readonly CanonicalSubpath[] = [];
		if (name === "path") {
			subpaths = attributes.d
				? pathSubpaths(attributes.d, matrix, options, sourcePath, metrics, diagnostics)
				: [];
		} else if (name === "polyline" || name === "polygon") {
			subpaths = pointsSubpath(
				attributes.points,
				matrix,
				name === "polygon",
				metrics,
				sourcePath,
				diagnostics,
			);
		} else if (name === "line") {
			subpaths = pointsSubpath(
				`${length("x1")},${length("y1")} ${length("x2")},${length("y2")}`,
				matrix,
				false,
				metrics,
				sourcePath,
				diagnostics,
			);
		} else if (name === "rect") {
			const path = rectPath(length, attributes);
			if (!path) {
				diagnostics.push(
					diagnostic("invalid-geometry", "Rectangle dimensions must be positive.", sourcePath),
				);
			} else {
				subpaths = pathSubpaths(path, matrix, options, sourcePath, metrics, diagnostics);
			}
		} else {
			const radius = name === "circle" ? length("r") : 0;
			subpaths = ellipseSubpath(
				length("cx"),
				length("cy"),
				name === "circle" ? radius : length("rx"),
				name === "circle" ? radius : length("ry"),
				matrix,
				options,
				sourcePath,
				metrics,
				diagnostics,
			);
		}
		return { diagnostics, metrics, subpaths };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown geometry parser error";
		diagnostics.push(diagnostic("parse-error", `Unable to parse ${name}: ${message}`, sourcePath));
		return { diagnostics, metrics, subpaths: [] };
	}
}
