import type { LineSceneElement, SceneElement } from "./scene.js";

export interface RuleBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Break axis-aligned rules (gridlines, baselines, axes) wherever they would
 * run behind a text box, so no rule crosses a label. Each kept stretch keeps
 * the rule's style; the first keeps its id and later ones get `:<n>`.
 * Returns the replacements by original id; rules that cross nothing are absent.
 */
export function breakRulesUnderText(
	elements: readonly SceneElement[],
	boxes: readonly RuleBox[],
	isRule: (id: string) => boolean,
	clearance = 2,
): Map<string, LineSceneElement[]> {
	const replaced = new Map<string, LineSceneElement[]>();
	for (const element of elements) {
		if (element.type !== "line" || !isRule(element.id) || element.points.length !== 2) continue;
		const [a, b] = element.points;
		const horizontal = Math.abs(a.y - b.y) < 0.01;
		if (!horizontal && Math.abs(a.x - b.x) >= 0.01) continue;
		const fixed = horizontal ? a.y : a.x;
		const start = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
		const end = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
		const blocked = boxes
			.filter((box) =>
				horizontal
					? box.top - clearance < fixed && fixed < box.bottom + clearance
					: box.left - clearance < fixed && fixed < box.right + clearance,
			)
			.map((box) =>
				horizontal
					? [box.left - clearance, box.right + clearance]
					: [box.top - clearance, box.bottom + clearance],
			)
			.filter(([low, high]) => high! > start && low! < end)
			.toSorted((left, right) => left[0]! - right[0]!);
		if (!blocked.length) continue;
		const pieces: [number, number][] = [];
		let cursor = start;
		for (const [low, high] of blocked) {
			if (low! > cursor) pieces.push([cursor, Math.min(low!, end)]);
			cursor = Math.max(cursor, high!);
		}
		if (cursor < end) pieces.push([cursor, end]);
		replaced.set(
			element.id,
			pieces
				.filter(([low, high]) => high - low >= 1)
				.map(([low, high], index) => ({
					...element,
					id: index === 0 ? element.id : `${element.id}:${index}`,
					points: horizontal
						? [
								{ x: round(low), y: fixed },
								{ x: round(high), y: fixed },
							]
						: [
								{ x: fixed, y: round(low) },
								{ x: fixed, y: round(high) },
							],
				})),
		);
	}
	return replaced;
}
