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

/**
 * How far `boxes` must move right so that none sits within `margin` right of a
 * box of `placed` it shares rows with; boxes up to `slack` apart above and
 * below still share rows. -Infinity when no box shares rows.
 */
export function clearanceRight(
	placed: readonly EdgeBox[],
	boxes: readonly EdgeBox[],
	margin: number,
	slack = 0,
): number {
	let offset = -Infinity;
	for (const box of boxes) {
		for (const other of placed) {
			if (box.y0 < other.y1 + slack && other.y0 < box.y1 + slack) {
				offset = Math.max(offset, other.x1 + margin - box.x0);
			}
		}
	}
	return offset;
}

/**
 * How far `boxes` may move right and still sit `margin` left of every box of
 * `placed` it shares rows with: negative to move left. Infinity when no box
 * shares rows.
 */
export function clearanceLeft(
	placed: readonly EdgeBox[],
	boxes: readonly EdgeBox[],
	margin: number,
	slack = 0,
): number {
	let offset = Infinity;
	for (const box of boxes) {
		for (const other of placed) {
			if (box.y0 < other.y1 + slack && other.y0 < box.y1 + slack) {
				offset = Math.min(offset, other.x0 - margin - box.x1);
			}
		}
	}
	return offset;
}
