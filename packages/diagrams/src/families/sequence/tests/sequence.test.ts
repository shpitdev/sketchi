// Positive fixtures deliberately unwrap Results: failure here is invalid test data, not user input.
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";

import {
	getSequenceValidationIssues,
	parseSequenceDiagram,
	SEQUENCE_MAX_MESSAGES,
	SEQUENCE_MAX_PARTICIPANTS,
	type SequenceDiagram,
	SequenceValidationIssueCodeSchema,
	sequenceLifelineId,
} from "../document";
import { sequenceFixture } from "../fixtures";
import { renderSequenceDiagram } from "../render";

describe("sequence diagrams", () => {
	it("export a valid Excalidraw file with nested activation bars bound to their messages", () => {
		const nested = parseSequenceDiagram({
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
				{ id: "direct", source: "auth", target: "client", label: "Direct notice" },
				{ id: "session", source: "api", target: "client", label: "Session", type: "return" },
			],
		}).pipe(Result.getOrThrow);
		expect(
			validateExcalidrawScene(convertSceneToExcalidraw(renderSequenceDiagram(nested))),
		).toEqual({ ok: true, issues: [] });

		const scene = convertSceneToExcalidraw(renderSequenceDiagram(sequenceFixture));
		expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
		expect(
			scene.elements.find((element) => element.id === "node:store:lifeline:activation:checkout"),
		).toMatchObject({
			type: "rectangle",
			boundElements: expect.arrayContaining([
				{ id: "arrow:checkout", type: "arrow" },
				{ id: "arrow:receipt", type: "arrow" },
			]),
		});
	});
});

const many = <T>(count: number, make: (index: number) => T) =>
	Array.from({ length: count }, (_, index) => make(index));

/** One minimal bad diagram per code the validator owns. */
const bad: Record<string, Partial<SequenceDiagram>> = {
	sequence_too_large: {
		participants: many(SEQUENCE_MAX_PARTICIPANTS + 1, (index) => ({
			id: `p${index}`,
			label: `Participant ${index}`,
		})),
		messages: many(SEQUENCE_MAX_MESSAGES + 1, (index) => ({
			id: `m${index}`,
			source: "p0",
			target: "p1",
			label: `Message ${index}`,
		})),
	},
	duplicate_participant_id: {
		participants: [...sequenceFixture.participants, { id: "store", label: "Second store" }],
	},
	// Ids under a lifeline, activation bars included, belong to the drawing.
	lifeline_id_collision: {
		participants: [
			{ id: "api", label: "API" },
			{ id: `${sequenceLifelineId("api")}:activation:call`, label: "Shadow" },
		],
		messages: [],
	},
	duplicate_message_id: { messages: [...sequenceFixture.messages, sequenceFixture.messages[0]!] },
	missing_message_source: {
		messages: [
			...sequenceFixture.messages,
			{ id: "charge", source: "ghost", target: "store", label: "Unknown sender" },
		],
	},
	missing_message_target: {
		messages: [
			...sequenceFixture.messages,
			{ id: "loop", source: "store", target: "nowhere", label: "Unknown target" },
		],
	},
};

describe("sequence validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(SequenceValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad diagram", (code, change) => {
		const issues = getSequenceValidationIssues({ ...sequenceFixture, ...change });
		expect(issues.map((issue) => issue.code)).toContain(code);
	});
});
