/** Lengths resolve in the current SVG user viewport, before transforms. */
export interface SvgViewport {
	readonly minX: number;
	readonly minY: number;
	readonly width: number;
	readonly height: number;
}

export function viewportDiagonal(viewport: SvgViewport): number {
	return Math.hypot(viewport.width, viewport.height) / Math.SQRT2;
}

/** null means unsupported syntax or an unresolved percentage reference. */
export function parseLength(value: string | undefined, reference: number | null): number | null {
	const match = /^\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)(px|%)?\s*$/i.exec(value ?? "");
	if (!match) return null;
	const number = Number(match[1]);
	const resolved =
		match[2] === "%" ? (reference === null ? NaN : (number * reference) / 100) : number;
	return Number.isFinite(resolved) ? resolved : null;
}
