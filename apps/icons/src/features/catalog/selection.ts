export const SELECTION_LIMIT = 300;

interface SelectionAddResult {
	/** How many slugs were newly added. */
	readonly added: number;
	readonly selected: ReadonlySet<string>;
	/** How many slugs were left out because the limit was reached. */
	readonly skipped: number;
}

function addToSelection(
	current: ReadonlySet<string>,
	slugs: readonly string[],
	limit: number = SELECTION_LIMIT,
): SelectionAddResult {
	const selected = new Set(current);
	let added = 0;
	let skipped = 0;
	for (const slug of slugs) {
		if (selected.has(slug)) continue;
		if (selected.size >= limit) {
			skipped += 1;
			continue;
		}
		selected.add(slug);
		added += 1;
	}
	return { added, selected, skipped };
}

/** How many more icons the selection can still take. */
export function remainingCapacity(
	current: ReadonlySet<string>,
	limit: number = SELECTION_LIMIT,
): number {
	return Math.max(0, limit - current.size);
}

/**
 * Visible label for the select-results checkbox. It names a number only when
 * the cap will truncate the click, so the common case stays "Select all" and a
 * large result set is never silently cut short.
 *
 * @param pendingCount matching icons that are not selected yet
 * @param remaining how many more icons the selection can hold
 */
export function selectResultsLabel(pendingCount: number, remaining: number): string {
	if (pendingCount > 0 && remaining <= 0) return "Selection full";
	if (pendingCount > remaining) return `Select ${remaining.toLocaleString()}`;
	return "Select all";
}

/**
 * Callers only run select-all when it can add something, so this describes an
 * addition rather than every possible no-op.
 */
function describeSelectAll(result: Pick<SelectionAddResult, "added" | "skipped">): string {
	if (result.skipped) {
		return `Selected ${result.added.toLocaleString()}, ${result.skipped.toLocaleString()} left out at the ${SELECTION_LIMIT.toLocaleString()} icon cap.`;
	}
	return `${result.added.toLocaleString()} ${result.added === 1 ? "icon" : "icons"} selected.`;
}

/** Something the last selection event needs to tell the user about. */
export type SelectionNotice =
	| {
			readonly added: number;
			readonly kind: "selected";
			readonly skipped: number;
	  }
	| { readonly kind: "cleared" }
	| { readonly kind: "deselected"; readonly removed: number }
	| { readonly kind: "full" };

export type SelectionEvent =
	| { readonly slug: string; readonly type: "toggle" }
	| { readonly slugs: readonly string[]; readonly type: "select-all" }
	| { readonly slugs: readonly string[]; readonly type: "deselect" }
	| { readonly type: "clear" };

export function applySelectionEvent(
	current: ReadonlySet<string>,
	event: SelectionEvent,
	limit: number = SELECTION_LIMIT,
): { readonly slugs: ReadonlySet<string>; readonly notice?: SelectionNotice } {
	switch (event.type) {
		case "clear": {
			if (!current.size) return { slugs: current };
			return { notice: { kind: "cleared" }, slugs: new Set() };
		}
		case "deselect": {
			const slugs = new Set(current);
			let removed = 0;
			for (const slug of event.slugs) if (slugs.delete(slug)) removed += 1;
			if (!removed) return { slugs: current };
			return { notice: { kind: "deselected", removed }, slugs };
		}
		case "select-all": {
			const result = addToSelection(current, event.slugs, limit);
			if (!result.added) return { slugs: current };
			return {
				notice: {
					added: result.added,
					kind: "selected",
					skipped: result.skipped,
				},
				slugs: result.selected,
			};
		}
		case "toggle": {
			const slugs = new Set(current);
			if (slugs.delete(event.slug)) {
				return { slugs };
			}
			if (slugs.size >= limit) {
				return { notice: { kind: "full" }, slugs: current };
			}
			slugs.add(event.slug);
			return { slugs };
		}
	}
}

export function describeSelectionNotice(notice: SelectionNotice): string {
	switch (notice.kind) {
		case "cleared":
			return "Selection cleared.";
		case "deselected":
			return `${notice.removed.toLocaleString()} ${notice.removed === 1 ? "icon" : "icons"} removed from the selection.`;
		case "full":
			return `Selection is full at ${SELECTION_LIMIT.toLocaleString()} icons.`;
		case "selected":
			return describeSelectAll(notice);
	}
}
