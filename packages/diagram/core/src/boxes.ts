/** An axis-aligned box by its edges. */
export interface EdgeBox {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}

/**
 * How far `boxes` must move down so that none sits within `margin` below a
 * box of `placed` it shares columns with. Boxes up to `slack` apart side by
 * side still share columns, so diagonal neighbors keep clear too. Negative
 * when they could move up; -Infinity when no box shares columns.
 */
export function clearanceBelow(
	placed: readonly EdgeBox[],
	boxes: readonly EdgeBox[],
	margin: number,
	slack = 0,
): number {
	let offset = -Infinity;
	for (const box of boxes) {
		for (const other of placed) {
			if (box.x0 < other.x1 + slack && other.x0 < box.x1 + slack) {
				offset = Math.max(offset, other.y1 + margin - box.y0);
			}
		}
	}
	return offset;
}
