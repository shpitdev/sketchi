import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import { parseIntermediateDiagram, SKETCHI_DIAGRAM_STYLE } from "../intermediate";
import {
	type SequenceDiagram,
	SEQUENCE_MAX_ISSUES,
	SEQUENCE_MAX_MESSAGES,
	SEQUENCE_MAX_PARTICIPANTS,
	SequenceValidationError,
	apiRequestSequence,
	getSequenceValidationIssues,
	parseSequenceDiagram,
	sequenceActivations,
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

	it("derives activations from answered calls and nests re-entrant ones", () => {
		expect(
			sequenceActivations(sequenceFixture).map(({ participantId, startIndex, endIndex, depth }) => [
				participantId,
				startIndex,
				endIndex,
				depth,
			]),
		).toEqual([
			["store", 0, 3, 0],
			["payments", 1, 2, 0],
		]);
		// The analytics call is fire-and-forget, so it opens no span.
		expect(sequenceActivations(apiRequestSequence).map((span) => span.participantId)).toEqual([
			"api",
			"cache",
			"database",
		]);

		const reentrant = parseSequenceDiagram({
			id: "oauth",
			title: "OAuth callback",
			type: "sequence",
			participants: [
				{ id: "client", label: "Client" },
				{ id: "api", label: "API" },
				{ id: "auth", label: "Auth" },
			],
			messages: [
				{ id: "login", source: "client", target: "api", label: "Log in" },
				{ id: "authorize", source: "api", target: "auth", label: "Authorize" },
				{ id: "callback", source: "auth", target: "api", label: "Callback" },
				{ id: "ack", source: "api", target: "auth", label: "Ack", type: "return" },
				{ id: "token", source: "auth", target: "api", label: "Token", type: "return" },
				{ id: "notify", source: "api", target: "client", label: "Notify" },
				{ id: "stray", source: "auth", target: "client", label: "Stray", type: "return" },
				{ id: "session", source: "api", target: "client", label: "Session", type: "return" },
			],
		});
		expect(
			sequenceActivations(reentrant).map(
				({ participantId, callMessageId, returnMessageId, depth }) => [
					participantId,
					callMessageId,
					returnMessageId,
					depth,
				],
			),
		).toEqual([
			["api", "login", "session", 0],
			["auth", "authorize", "token", 0],
			["api", "callback", "ack", 1],
		]);
	});

	it("keeps interleaved calls open and stacks partially overlapping spans", () => {
		const interleaved = parseSequenceDiagram({
			id: "interleaved",
			title: "Interleaved calls",
			type: "sequence",
			participants: [
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
				{ id: "c", label: "C" },
			],
			messages: [
				{ id: "q1", source: "a", target: "b", label: "Query 1" },
				{ id: "q2", source: "c", target: "b", label: "Query 2" },
				{ id: "p1", source: "b", target: "a", label: "Reply 1", type: "return" },
				{ id: "p2", source: "b", target: "c", label: "Reply 2", type: "return" },
			],
		});
		expect(
			sequenceActivations(interleaved).map(({ callMessageId, returnMessageId, depth }) => [
				callMessageId,
				returnMessageId,
				depth,
			]),
		).toEqual([
			["q1", "p1", 0],
			["q2", "p2", 1],
		]);
	});

	it("gives a span the lowest free lane once an earlier overlap closes", () => {
		const diagram = parseSequenceDiagram({
			id: "lanes",
			title: "Lanes",
			type: "sequence",
			participants: [
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
				{ id: "c", label: "C" },
			],
			messages: [
				{ id: "q1", source: "a", target: "b", label: "Query 1" },
				{ id: "q2", source: "c", target: "b", label: "Query 2" },
				{ id: "p1", source: "b", target: "a", label: "Reply 1", type: "return" },
				{ id: "q3", source: "a", target: "b", label: "Query 3" },
				{ id: "p2", source: "b", target: "c", label: "Reply 2", type: "return" },
				{ id: "p3", source: "b", target: "a", label: "Reply 3", type: "return" },
			],
		});
		expect(
			sequenceActivations(diagram).map(({ callMessageId, startIndex, endIndex, depth }) => [
				callMessageId,
				startIndex,
				endIndex,
				depth,
			]),
		).toEqual([
			["q1", 0, 2, 0],
			["q2", 1, 4, 1],
			["q3", 3, 5, 0],
		]);
	});

	it("never stacks overlapping spans on one lane and keeps nested spans inside", () => {
		// Deterministic pseudo-random diagrams: calls, returns to open calls, and strays.
		let seed = 0x5eed;
		const random = (limit: number) => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return seed % limit;
		};
		const ids = ["a", "b", "c"];
		let overlaps = 0;
		for (let run = 0; run < 500; run += 1) {
			const open: { caller: string; callee: string }[] = [];
			const messages = Array.from({ length: 6 + random(24) }, (_, index) => {
				const roll = random(10);
				const returned =
					open.length > 0 && roll < 5 ? open.splice(random(open.length), 1)[0] : undefined;
				if (returned) {
					return {
						id: `m${index}`,
						source: returned.callee,
						target: returned.caller,
						label: "Reply",
						type: "return" as const,
					};
				}
				const source = ids[random(ids.length)] ?? "a";
				const others = ids.filter((id) => id !== source);
				const target = others[random(others.length)] ?? "b";
				if (roll < 9) open.push({ caller: source, callee: target });
				return {
					id: `m${index}`,
					source,
					target,
					label: roll < 9 ? "Call" : "Stray reply",
					...(roll < 9 ? {} : { type: "return" as const }),
				};
			});
			const spans = sequenceActivations(
				parseSequenceDiagram({
					id: `random-${run}`,
					title: "Random",
					type: "sequence",
					participants: ids.map((id) => ({ id, label: id.toUpperCase() })),
					messages,
				}),
			);
			for (const left of spans) {
				for (const right of spans) {
					if (left === right || left.participantId !== right.participantId) continue;
					const overlap = left.startIndex <= right.endIndex && right.startIndex <= left.endIndex;
					if (overlap) {
						overlaps += 1;
						expect(left.depth, `run ${run}`).not.toBe(right.depth);
					}
					if (left.startIndex < right.startIndex && right.endIndex < left.endIndex) {
						expect(right.depth, `run ${run}`).toBeGreaterThan(left.depth);
					}
				}
			}
		}
		// The generator must actually produce overlapping spans to check.
		expect(overlaps).toBeGreaterThan(100);
	});

	it("reserves every id under a participant's lifeline, including activation bars", () => {
		expect(
			issueCodes({
				...sequenceFixture,
				participants: [
					{ id: "api", label: "API" },
					{ id: "api:lifeline:activation:call", label: "Shadow" },
				],
				messages: [],
			}),
		).toEqual([["lifeline_id_collision", "participants.[1].id"]]);
	});

	it("rejects oversized diagrams and caps the issue list", () => {
		const participants = Array.from({ length: SEQUENCE_MAX_PARTICIPANTS + 1 }, (_, index) => ({
			id: `p${index}`,
			label: `Participant ${index}`,
		}));
		const messages = Array.from({ length: SEQUENCE_MAX_MESSAGES + 1 }, (_, index) => ({
			id: `m${index}`,
			source: "p0",
			// Every message also targets a missing participant.
			target: `ghost${index}`,
			label: `Message ${index}`,
		}));
		const issues = getSequenceValidationIssues({ ...sequenceFixture, participants, messages });
		expect(issues).toHaveLength(SEQUENCE_MAX_ISSUES);
		expect(issues.slice(0, 2).map((issue) => [issue.code, issue.path])).toEqual([
			["sequence_too_large", "participants"],
			["sequence_too_large", "messages"],
		]);
		expect(
			issueCodes({ ...sequenceFixture, participants: participants.slice(0, -1), messages: [] }),
		).toEqual([]);
	});
});
