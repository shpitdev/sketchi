interface Point {
	readonly x: number;
	readonly y: number;
}

/** Where a cubic is sampled for a curved connector; Excalidraw draws a smooth curve through them. */
const SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const;

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * The points a curved connector carries for a cubic Bézier through its four
 * control points: sampled at quarters, the end points exact.
 */
export function cubicConnectorPoints(
	controls: readonly [Point, Point, Point, Point],
): [Point, ...Point[]] {
	const [p0, p1, p2, p3] = controls;
	return SAMPLES.map((t) => {
		const u = 1 - t;
		const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
		return {
			x: round(a * p0.x + b * p1.x + c * p2.x + d * p3.x),
			y: round(a * p0.y + b * p1.y + c * p2.y + d * p3.y),
		};
	}) as [Point, ...Point[]];
}
