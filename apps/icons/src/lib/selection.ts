/**
 * Selection is capped so that "select all" over a large filtered set stays a
 * sane operation: every bulk action fetches one SVG per selected icon and then
 * either joins them into a single clipboard payload or zips them in the main
 * thread. The catalog is ~1,400 icons / ~4.8 MB, and the biggest single
 * collection is 216, so this limit clears every realistic filtered query and
 * only bites when someone selects most of the library at once.
 */
export const SELECTION_LIMIT = 300;

export interface SelectionAddResult {
  /** How many slugs were newly added. */
  readonly added: number;
  readonly selected: ReadonlySet<string>;
  /** How many slugs were left out because the limit was reached. */
  readonly skipped: number;
}

export function addToSelection(
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
 * Label for the select-all control. It states the cap up front so a large
 * result set is never silently truncated after the click, and it counts only
 * the results that are not selected yet, so it never promises work it will not
 * do.
 *
 * @param resultCount every icon matching the current filter
 * @param pendingCount matching icons that are not selected yet
 * @param remaining how many more icons the selection can hold
 */
export function selectAllLabel(
  resultCount: number,
  pendingCount: number,
  remaining: number,
): string {
  if (pendingCount <= 0) return `All ${resultCount.toLocaleString()} selected`;
  if (remaining <= 0) return "Selection full";
  if (pendingCount <= remaining) {
    return `Select all ${resultCount.toLocaleString()}`;
  }
  return `Select ${remaining.toLocaleString()} more of ${resultCount.toLocaleString()}`;
}

/**
 * Callers only run select-all when it can add something, so this describes an
 * addition rather than every possible no-op.
 */
export function describeSelectAll(
  result: Pick<SelectionAddResult, "added" | "skipped">,
): string {
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
  | { readonly kind: "full" };

export interface SelectionState {
  /** Set only when the last event has something to announce. */
  readonly notice: SelectionNotice | undefined;
  /**
   * Bumped on every event that changes anything, so two identical notices in a
   * row are still two distinct states for the announcing effect.
   */
  readonly revision: number;
  readonly slugs: ReadonlySet<string>;
}

export type SelectionEvent =
  | { readonly slug: string; readonly type: "toggle" }
  | { readonly slugs: readonly string[]; readonly type: "select-all" }
  | { readonly type: "clear" };

export const initialSelectionState: SelectionState = {
  notice: undefined,
  revision: 0,
  slugs: new Set(),
};

/**
 * Selection lives in a reducer rather than in `useState` closures so that every
 * mutation is computed from the authoritative current state. Several toggles
 * dispatched in a single React batch each see the previous one's result; a
 * handler reading `selectedSlugs` from its render closure would instead have
 * every update in the batch overwrite the last.
 *
 * The reducer stays pure — notices are returned as data for an effect to
 * announce, never fired from inside the update.
 */
export function applySelectionEvent(
  state: SelectionState,
  event: SelectionEvent,
  limit: number = SELECTION_LIMIT,
): SelectionState {
  const revision = state.revision + 1;
  switch (event.type) {
    case "clear": {
      if (!state.slugs.size) return state;
      return { notice: { kind: "cleared" }, revision, slugs: new Set() };
    }
    case "select-all": {
      const result = addToSelection(state.slugs, event.slugs, limit);
      if (!result.added) return state;
      return {
        notice: {
          added: result.added,
          kind: "selected",
          skipped: result.skipped,
        },
        revision,
        slugs: result.selected,
      };
    }
    case "toggle": {
      const slugs = new Set(state.slugs);
      if (slugs.delete(event.slug)) {
        return { notice: undefined, revision, slugs };
      }
      if (slugs.size >= limit) {
        return { notice: { kind: "full" }, revision, slugs: state.slugs };
      }
      slugs.add(event.slug);
      return { notice: undefined, revision, slugs };
    }
  }
}

/** `useReducer`-shaped wrapper around {@link applySelectionEvent}. */
export function selectionReducer(
  state: SelectionState,
  event: SelectionEvent,
): SelectionState {
  return applySelectionEvent(state, event);
}

export function describeSelectionNotice(notice: SelectionNotice): string {
  switch (notice.kind) {
    case "cleared":
      return "Selection cleared.";
    case "full":
      return `Selection is full at ${SELECTION_LIMIT.toLocaleString()} icons.`;
    case "selected":
      return describeSelectAll(notice);
  }
}
