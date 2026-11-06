import { TIMELINE_MAX_EVENTS, TIMELINE_MAX_LANES } from "../types/timeline.js";
import type { RuleSource } from "./source.js";

/** How a request becomes a timeline; see FLOWCHART_RULES. */
export const TIMELINE_RULES = {
	precision: (source: RuleSource) =>
		`Keep each date at ${source}'s precision: YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH:mm[:ss] with Z or the stated ±HH:MM offset.`,
	mode: "Use dates for every event, or numeric order for every event when no calendar dates are supplied. Never mix modes or add resources or dependencies.",
	optional: (source: RuleSource) =>
		`Optional: end (inclusive) makes a dated phase; kind "milestone" marks key moments; lane names a track for every event (lanes sets their order); today only when ${source} states it.`,
	ties: `Equal dates or orders retain input order. Use 1–${TIMELINE_MAX_EVENTS} events and at most ${TIMELINE_MAX_LANES} lanes.`,
	noInvention: "Never invent events or dates.",
	/** The execute code parameter's one-line form of the rules above. */
	compact: (source: RuleSource) =>
		`Dates keep ${source}'s precision (YYYY, YYYY-MM, YYYY-MM-DD or ISO time); without dates, give every event a numeric order. end draws a phase, lane a labeled track; today only when given.`,
} as const;
