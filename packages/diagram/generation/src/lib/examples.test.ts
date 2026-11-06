import { describe, expect, it } from "vitest";

import { buildDiagramGenerationMessages } from "./messages.js";

describe("the worked example of a typed request", () => {
	it("replaces the family's JSON shape with a curated request and answer", () => {
		const { user } = buildDiagramGenerationMessages({
			id: "x",
			request: "users table",
			requestedType: "er",
		});
		expect(user).toContain("Worked example: a different request and a correct answer.");
		expect(user).toContain("create table enrollments");
	});

	it("keeps the JSON shape of a typed family without one, and the general example untyped", () => {
		const timeline = buildDiagramGenerationMessages({
			id: "x",
			request: "Apollo program",
			requestedType: "timeline",
		});
		expect(timeline.user).not.toContain("Worked example");
		expect(timeline.user).toContain('"type":"timeline"');
		const untyped = buildDiagramGenerationMessages({ id: "x", request: "ER diagram of users" });
		expect(untyped.user).not.toContain("Worked example");
		expect(untyped.user).toContain("Response example:");
	});
});
