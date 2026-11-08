import { describe, expect, it } from "vitest";

import {
	dropBlankEdgeLabels,
	FLOWCHART_MAX_EDGES,
	FLOWCHART_MAX_NODES,
} from "../types/flowchart.js";
import { SEQUENCE_MAX_MESSAGES, SEQUENCE_MAX_PARTICIPANTS } from "../types/sequence.js";
import { splitContinuingFinalStates } from "../types/state-machine.js";
import { ER_RULES, FLOWCHART_RULES, SEQUENCE_RULES } from "./index.js";

describe("shared family rules", () => {
	it("state limits from the core constants, so a raised limit reaches every surface", () => {
		expect(FLOWCHART_RULES.limits).toBe(
			`At most ${FLOWCHART_MAX_NODES} nodes and ${FLOWCHART_MAX_EDGES} edges.`,
		);
		expect(SEQUENCE_RULES.limits).toBe(
			`at most ${SEQUENCE_MAX_PARTICIPANTS} participants and ${SEQUENCE_MAX_MESSAGES} messages`,
		);
	});

	it("name the request in each surface's own word", () => {
		expect(FLOWCHART_RULES.documentLanes("the prompt")).toContain("in the prompt's order");
		expect(FLOWCHART_RULES.documentLanes("the user")).toContain("in the user's order");
		expect(ER_RULES.direction("the scenario")).toContain(
			"when the scenario states the key columns",
		);
	});

	it("keep a foreign key at an ER relationship's from end", () => {
		expect(ER_RULES.direction("the prompt")).toContain("from is the end holding the foreign key");
		expect(ER_RULES.example).toContain('from "orders.customer_id"');
	});
});

describe("shared cleanup", () => {
	it("drops only blank edge labels", () => {
		const edges = [
			{ source: "a", target: "b", label: "  " },
			{ source: "b", target: "c", label: "yes" },
			"not an edge",
		];
		expect(dropBlankEdgeLabels(edges)).toEqual([
			{ source: "a", target: "b" },
			edges[1],
			"not an edge",
		]);
	});

	it("ends a final state that something leaves in its own final state", () => {
		expect(
			splitContinuingFinalStates({
				states: [{ id: "open" }, { id: "closed", kind: "final", parent: "ticket" }],
				transitions: [
					{ source: "open", target: "closed" },
					{ id: "closed-ends", source: "closed", target: "open" },
				],
			}),
		).toEqual({
			states: [
				{ id: "open" },
				{ id: "closed", parent: "ticket" },
				{ id: "end", kind: "final", parent: "ticket" },
			],
			transitions: [
				{ source: "open", target: "closed" },
				{ id: "closed-ends", source: "closed", target: "open" },
				{ id: "closed-ends-2", source: "closed", target: "end" },
			],
		});
		const untouched = { states: [{ id: "done", kind: "final" }], transitions: [] };
		expect(splitContinuingFinalStates(untouched)).toBe(untouched);
	});
});
