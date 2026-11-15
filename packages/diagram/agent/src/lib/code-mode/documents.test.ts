import { describe, expect, it } from "vitest";
import { sequenceFixture } from "@sketchi/diagram-core";

import { canonicalDocumentFromDiagram } from "./documents.js";

describe("canonical diagram documents", () => {
	it("carries sequence participants and ordered messages with their types", () => {
		const document = canonicalDocumentFromDiagram(sequenceFixture);
		expect(document.type).toBe("sequence");
		if (document.type !== "sequence") return;
		expect(document.spec.participants.map((participant) => participant.id)).toEqual([
			"customer",
			"store",
			"payments",
		]);
		expect(document.spec.messages.map((message) => [message.id, message.type])).toEqual([
			["checkout", undefined],
			["charge", undefined],
			["charged", "return"],
			["receipt", "return"],
		]);
	});
});
