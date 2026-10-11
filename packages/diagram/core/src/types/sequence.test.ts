import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import { parseIntermediateDiagram, SKETCHI_DIAGRAM_STYLE } from "../intermediate";
import {
	type SequenceDiagram,
	SequenceValidationError,
	apiRequestSequence,
	getSequenceValidationIssues,
	parseSequenceDiagram,
	sequenceDiagramType,
	sequenceFixture,
	sequenceLifelineId,
} from "./sequence";

function issueCodes(diagram: SequenceDiagram) {
	return getSequenceValidationIssues(diagram).map((issue) => [issue.code, issue.path]);
}

describe("Sequence diagram type", () => {
	it("keeps participant and chronological message order in the typed fixture", () => {
		expect(sequenceFixture.type).toBe(sequenceDiagramType);
		expect(parseCanonicalDiagram(sequenceFixture)).toEqual(sequenceFixture);
		expect(sequenceFixture.participants.map((participant) => participant.id)).toEqual([
			"customer",
			"store",
			"payments",
		]);
		expect(sequenceFixture.messages.map((message) => message.id)).toEqual([
			"checkout",
			"charge",
			"charged",
			"receipt",
		]);
		expect(apiRequestSequence.messages.filter((message) => message.type === "return")).toHaveLength(
			3,
		);
	});

	it("defaults messages and the Sketchi style without a separate authoring shape", () => {
		const diagram = parseSequenceDiagram({
			id: "lonely",
			title: "Lonely participant",
			type: "sequence",
			participants: [{ id: "only", label: "Only" }],
		});
		expect(diagram.messages).toEqual([]);
		expect(diagram.style).toEqual(SKETCHI_DIAGRAM_STYLE);
	});

	it("reports every broken participant and message reference with a repair hint", () => {
		expect(
			issueCodes({
				...sequenceFixture,
				participants: [...sequenceFixture.participants, { id: "store", label: "Second store" }],
				messages: [
					...sequenceFixture.messages,
					{ id: "charge", source: "ghost", target: "store", label: "Unknown sender" },
					{ id: "loop", source: "store", target: "nowhere", label: "Unknown target" },
					{ id: "self", source: "store", target: "store", label: "Self message" },
				],
			}),
		).toEqual([
			["duplicate_participant_id", "participants.[3].id"],
			["duplicate_message_id", "messages.[4].id"],
			["missing_message_source", "messages.[4].source"],
			["missing_message_target", "messages.[5].target"],
			["self_message", "messages.[6]"],
		]);
	});

	it("rejects participant ids that collide with generated lifelines", () => {
		const input: SequenceDiagram = {
			...sequenceFixture,
			participants: [
				{ id: "api", label: "API" },
				{ id: sequenceLifelineId("api"), label: "Worker" },
			],
			messages: [],
		};
		expect(issueCodes(input)).toEqual([["lifeline_id_collision", "participants.[1].id"]]);
		expect(() => parseSequenceDiagram(input)).toThrow(SequenceValidationError);
	});

	it("is not a node/edge graph: the graph IR refuses the sequence type", () => {
		expect(() =>
			parseIntermediateDiagram({
				id: "sequence-as-graph",
				title: "Sequence as graph",
				type: "sequence",
				nodes: [{ id: "a", label: "A" }],
			}),
		).toThrow(/Expected "flowchart" \| "mindmap"/u);
		expect(() =>
			parseSequenceDiagram({
				id: "graph-as-sequence",
				title: "Graph as sequence",
				type: "sequence",
				nodes: [{ id: "a", label: "A" }],
			}),
		).toThrow(/participants/u);
	});
});
