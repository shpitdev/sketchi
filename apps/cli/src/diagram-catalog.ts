import { Effect } from "effect";

import type { DiagramListEntry, DiagramSummary } from "./contracts.js";
import { validateStorageId } from "./document.js";
import { CliStorageError } from "./errors.js";
import { DiagramStore } from "./storage.js";

/** The id alias that names the newest diagram. */
export const LATEST_DIAGRAM = "latest";

function isAvailable(entry: DiagramListEntry): entry is DiagramSummary {
	return !("status" in entry);
}

/** Creation time, or for records older than createdAt, when the record last changed. */
export function entryTime(entry: DiagramListEntry): number | undefined {
	for (const value of [entry.createdAt, entry.updatedAt]) {
		if (value === undefined) continue;
		const time = Date.parse(value);
		if (Number.isFinite(time)) return time;
	}
	return undefined;
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/** Newest first; undated records follow by id, and unreadable records come last. */
export function newestFirst(entries: ReadonlyArray<DiagramListEntry>): DiagramListEntry[] {
	return [...entries].sort((left, right) => {
		const leftAvailable = isAvailable(left);
		if (leftAvailable !== isAvailable(right)) return leftAvailable ? -1 : 1;
		const leftTime = entryTime(left);
		const rightTime = entryTime(right);
		if (leftTime !== rightTime) {
			if (leftTime === undefined) return 1;
			if (rightTime === undefined) return -1;
			return rightTime - leftTime;
		}
		return compareCodeUnits(left.id, right.id);
	});
}

export interface DiagramQuery {
	readonly text?: string;
	readonly type?: string;
}

/** Every word of the text must appear in the title, id, or prompt; case-insensitive. */
export function matchesQuery(entry: DiagramListEntry, query: DiagramQuery): boolean {
	if (query.type !== undefined && entry.type !== query.type) return false;
	const words = (query.text ?? "").toLowerCase().split(/\s+/u).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = [entry.id, entry.title ?? "", entry.prompt ?? ""].join("\n").toLowerCase();
	return words.every((word) => haystack.includes(word));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short relative time for people: "just now", "5m ago", "3h ago", "yesterday", "4d ago", then a date. */
export function relativeTime(time: number, now: number): string {
	const elapsed = now - time;
	if (elapsed < MINUTE) return "just now";
	if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))}m ago`;
	if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))}h ago`;
	if (elapsed < 2 * DAY) return "yesterday";
	if (elapsed < 30 * DAY) return `${String(Math.floor(elapsed / DAY))}d ago`;
	return new Date(time).toISOString().slice(0, 10);
}

function editDistance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let row = 1; row <= left.length; row += 1) {
		const current = [row];
		for (let column = 1; column <= right.length; column += 1) {
			current[column] = Math.min(
				(previous[column] ?? 0) + 1,
				(current[column - 1] ?? 0) + 1,
				(previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[right.length] ?? 0;
}

/** Up to three ids that look like what was typed: containing it, or a few edits away. */
export function closestIds(input: string, ids: ReadonlyArray<string>): string[] {
	const needle = input.toLowerCase();
	const budget = Math.max(2, Math.floor(needle.length / 3));
	return ids
		.map((id) => {
			const candidate = id.toLowerCase();
			const distance = candidate.includes(needle)
				? 0
				: Math.min(
						editDistance(needle, candidate),
						editDistance(needle, candidate.slice(0, needle.length)),
					);
			return { id, distance };
		})
		.filter(({ distance }) => distance <= budget)
		.sort((left, right) => left.distance - right.distance || compareCodeUnits(left.id, right.id))
		.slice(0, 3)
		.map(({ id }) => id);
}

function notFound(input: string, suggestions: ReadonlyArray<string>) {
	return CliStorageError.make({
		code: "diagram_not_found",
		diagramId: input,
		message: `Diagram "${input}" does not exist.`,
		hint:
			suggestions.length > 0
				? `Did you mean ${suggestions.join(", ")}? Run sketchi list to search.`
				: "Run sketchi list to search stored diagrams.",
	});
}

/**
 * Resolve what a person typed to a stored id: an exact id first, then `latest` for the
 * newest diagram, then a unique id prefix. Anything else fails with the closest ids.
 */
export const resolveDiagramId = Effect.fn("sketchi.cli.resolveDiagramId")(function* (
	input: string,
) {
	const store = yield* DiagramStore;
	const ids = yield* store.ids();
	if (ids.includes(input)) return input;
	if (input === LATEST_DIAGRAM) {
		const newest = newestFirst(yield* store.list()).find(isAvailable);
		if (newest) return newest.id;
		return yield* CliStorageError.make({
			code: "diagram_not_found",
			message: "There are no stored diagrams yet.",
			hint: "Create one with sketchi generate.",
		});
	}
	const id = yield* validateStorageId(input);
	const prefixed = ids.filter((candidate) => candidate.startsWith(id));
	if (prefixed.length === 1 && prefixed[0] !== undefined) return prefixed[0];
	if (prefixed.length > 1) {
		const shown = prefixed.slice(0, 5);
		return yield* CliStorageError.make({
			code: "ambiguous_diagram_id",
			diagramId: id,
			message: `"${id}" matches ${String(prefixed.length)} diagrams.`,
			hint: `Use a longer id: ${shown.join(", ")}${prefixed.length > shown.length ? ", …" : ""}.`,
		});
	}
	return yield* notFound(id, closestIds(id, ids));
});
