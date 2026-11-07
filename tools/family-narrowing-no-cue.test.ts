import { readFileSync } from "node:fs";
import { join } from "node:path";

import { routeDiagramFamilies } from "@sketchi/diagram-generation";
import { diagramScenarios } from "@sketchi/diagram-scenarios";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { withoutFamilyNames } from "./family-narrowing-no-cue";

describe("rewording a request to name no family", () => {
	it("replaces a family's name with a generic noun, keeping a plural", () => {
		expect(withoutFamilyNames("A Gantt chart of the release.")).toBe("A chart of the release.");
		expect(withoutFamilyNames("Two sequence diagrams for login.")).toBe("Two diagrams for login.");
		expect(withoutFamilyNames("a timeline of our year")).toBe("a diagram of our year");
	});

	it("merges a replacement into the generic noun beside it", () => {
		expect(withoutFamilyNames("a Venn diagram of the two teams")).toBe(
			"a diagram of the two teams",
		);
		expect(withoutFamilyNames("an Eisenhower matrix of my tasks")).toBe("a matrix of my tasks");
	});

	it("reads a name used as a verb as 'draw'", () => {
		expect(withoutFamilyNames("Wireframe the settings page.")).toBe("Draw the settings page.");
	});

	it("capitalizes a replacement only where it starts a sentence", () => {
		expect(withoutFamilyNames("Use ER diagrams. Timelines help.")).toBe(
			"Use diagrams. Diagrams help.",
		);
	});

	it("keeps the checked-in no-cue set current, and every prompt in it names no family", () => {
		const file = Schema.decodeUnknownSync(
			Schema.Struct({
				cases: Schema.Array(Schema.Struct({ id: Schema.String, noCue: Schema.String })),
			}),
		)(JSON.parse(readFileSync(join(import.meta.dirname, "family-narrowing-cases.json"), "utf8")));
		expect(file.cases.length).toBeGreaterThan(0);
		for (const { id, noCue } of file.cases) {
			const scenario = diagramScenarios.find((candidate) => candidate.id === id);
			expect(scenario, id).toBeDefined();
			expect(noCue, id).toBe(withoutFamilyNames(scenario?.prompt ?? ""));
			expect(routeDiagramFamilies(noCue)?.cue, id).not.toBe("named");
		}
	});
});
