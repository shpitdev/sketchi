import type { RuleSource } from "./source.js";

/** How a request becomes a Sankey diagram; see FLOWCHART_RULES. */
export const SANKEY_RULES = {
	links:
		"Return nodes: [{ id, label }] and links: [{ source, target, value, label? }]: value is the stated amount, greater than 0. Links run one way; no cycles or self-links.",
	optional: 'Optional: unit ("$k", "%", "visits"). Add no balancing node such as Other.',
	/** The execute code parameter's form of `links` and `optional`. */
	flows: "value is the stated amount (> 0); links run one way; add no balancing node.",
	copy: "Copy every node, flow and value stated.",
	structure: "No cycles or self-links, one link per source and target, ids without colons.",
	unit: 'unit formats as charts do ("$k" gives $310k; "visits" reads on totals).',
	dropOff: (source: RuleSource) =>
		`A stage that loses flow sends it to a drop-off node only when ${source} names one (one shared "Rejected" or one per stage); otherwise it keeps less outflow than inflow.`,
} as const;
